/** Original integration code: MIT.
 *
 * Builds the human pancreas and its neighbours from the extracted HRA region file, and the simulated
 * vessels and lymph node stations placed on it by scripts/human/place_simulated.py.
 * The bytes are fetched through the same bounded, checksum-checked path as every
 * MouseBio_3D model, and only structures marked `ready` in the inventory are built.
 * A ready structure whose node is absent is reported, never drawn from another node.
 *
 * Coordinates stay in the HRA frame, converted from metres to millimetres and centred
 * on the pancreas, so measurements read directly and the organ sits at the origin.
 */
import * as THREE from 'three';
import { fetchBoundGlb } from './region-detail';
import type { AssetFetchOptions } from './asset-fetch';
import { ISLET_ASSET, ISLET_CELL_TYPES, ISLET_DISTRIBUTION_ASSETS, type IsletCellType } from '../domain/human-pancreas-tissue';
import { assetOf, branchNode, lymphNode, readyStructures, simulatedAssetOf, type Layer, type Sex, type StructurePlan } from '../domain/human-pancreas-structures';

/** Registered bytes of each extracted file, from public/atlas-human/pancreas-region.manifest.json. */
export const HUMAN_PANCREAS_ASSETS: Readonly<Record<Sex, { readonly url: string; readonly bytes: number; readonly sha256: string }>> = Object.freeze({
  male: { url: '/atlas-human/pancreas-region-male.glb', bytes: 3451104, sha256: '36bba84f7ad333b756813bc3b9394ee4bfb617e474dc7852134b273f69da0883' },
  female: { url: '/atlas-human/pancreas-region-female.glb', bytes: 1715844, sha256: '48cc2fee6eae2c659ff1b8fbeb34a5c9bcdedac1c1adbbd1974e21db97ed6f3a' },
});

/** Registered bytes of each simulated file, from public/atlas-human/pancreas-simulated.manifest.json. */
export const HUMAN_PANCREAS_SIMULATED_ASSETS: Readonly<Record<Sex, { readonly url: string; readonly bytes: number; readonly sha256: string }>> = Object.freeze({
  male: { url: '/atlas-human/pancreas-simulated-male.glb', bytes: 745968, sha256: '49d45df8937a222f1e2784b0a73e56530446ba2891a94e6fa0e512b6e746224b' },
  female: { url: '/atlas-human/pancreas-simulated-female.glb', bytes: 840048, sha256: '3d7b7c5abedb47bbb934a0e2545325a96b99684c27e7dfa93b9606159fecc8b1' },
});

/** What the scene carries for one built structure. Only facts from the inventory and the mesh itself. */
export interface BuiltStructure {
  readonly plan: StructurePlan;
  readonly object: THREE.Group;
  /** Size of the box round the drawn geometry, in millimetres. Not a measurement of a person. */
  readonly extentMm: THREE.Vector3;
  readonly triangles: number;
}

export interface HumanPancreasScene {
  readonly sex: Sex;
  readonly root: THREE.Group;
  readonly structures: ReadonlyMap<string, BuiltStructure>;
  /** Ready structures with at least one node missing from the file, with the missing node names. */
  readonly missing: readonly { readonly id: string; readonly nodes: readonly string[] }[];
  /** Offset subtracted from HRA coordinates (millimetres) to centre the pancreas. */
  readonly originMm: THREE.Vector3;
}

const OPACITY: Readonly<Record<Layer, number>> = { pancreas: 1, ducts: 1, arteries: 1, veins: 1, neighbours: 0.35, lymph: 1, nerves: 1 };

function trianglesOf(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}

export async function loadHumanPancreas(sex: Sex, signal: AbortSignal, fetcher: typeof fetch = fetch,
  options: AssetFetchOptions = {}): Promise<HumanPancreasScene> {
  const asset = HUMAN_PANCREAS_ASSETS[sex], simulatedAsset = HUMAN_PANCREAS_SIMULATED_ASSETS[sex];
  const [bytes, simulatedBytes] = await Promise.all([
    fetchBoundGlb(asset.url, asset.bytes, asset.sha256, signal, fetcher, options),
    fetchBoundGlb(simulatedAsset.url, simulatedAsset.bytes, simulatedAsset.sha256, signal, fetcher),
  ]);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const [source, simulated] = await Promise.all([new GLTFLoader().parseAsync(bytes, ''), new GLTFLoader().parseAsync(simulatedBytes, '')])
    .then((models) => models.map((model) => model.scene));
  source.updateMatrixWorld(true);
  simulated.updateMatrixWorld(true);

  // Each ready structure names the nodes it is made of: drawn nodes in the region file, or one simulated node per branch.
  const nodesOf = (plan: StructurePlan): { file: THREE.Object3D; names: readonly string[] } | null =>
    plan.plan.kind === 'reference-node' && plan.plan.asset === assetOf(sex) ? { file: source, names: plan.plan.nodes }
      : plan.plan.kind === 'route' && plan.plan.asset === simulatedAssetOf(sex) ? { file: simulated, names: plan.plan.branches.map((b) => branchNode(plan.id, b.name)) }
        : plan.plan.kind === 'nodes' && plan.plan.asset === simulatedAssetOf(sex)
          ? { file: simulated, names: plan.plan.stations.flatMap((st) => Array.from({ length: st.count }, (_, i) => lymphNode(plan.id, st.name, i + 1))) }
          : null;
  const plans = readyStructures(sex).filter((plan) => nodesOf(plan) !== null);
  const root = new THREE.Group();
  root.name = `human-${sex}:pancreas-region`;
  const built = new Map<string, BuiltStructure>();
  const missing: { id: string; nodes: string[] }[] = [];

  for (const plan of plans) {
    const { file, names } = nodesOf(plan)!;
    const absent = names.filter((name) => !(file.getObjectByName(name) instanceof THREE.Mesh));
    if (absent.length) { missing.push({ id: plan.id, nodes: absent }); continue; }
    const group = new THREE.Group();
    group.name = plan.id;
    let triangles = 0;
    for (const name of names) {
      const node = file.getObjectByName(name) as THREE.Mesh;
      // The extractor guarantees identity transforms; applying matrixWorld keeps this true if a file ever differs.
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld).scale(1000, 1000, 1000);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      triangles += trianglesOf(geometry);
      const opacity = OPACITY[plan.layer];
      // Simulated structures are drawn slightly glossier, so they read as a different kind of evidence at a glance.
      const material = new THREE.MeshStandardMaterial({
        color: plan.color, roughness: plan.evidence === 'simulated' ? 0.3 : 0.6, metalness: 0,
        // HRA meshes are not consistently wound, so both faces are drawn.
        side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.userData = { structureId: plan.id, sourceNode: name };
      group.add(mesh);
    }
    group.userData = { structureId: plan.id, layer: plan.layer, evidence: plan.evidence, ontology: plan.ontology, basis: plan.basis };
    root.add(group);
    built.set(plan.id, { plan, object: group, extentMm: new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()), triangles });
  }

  // Centre on the pancreas, not on everything, so the spleen and vessels do not shift the organ.
  const pancreasBox = new THREE.Box3();
  for (const entry of built.values()) if (entry.plan.layer === 'pancreas') pancreasBox.expandByObject(entry.object);
  const originMm = pancreasBox.isEmpty() ? new THREE.Vector3() : pancreasBox.getCenter(new THREE.Vector3());
  root.position.copy(originMm).negate();
  root.updateMatrixWorld(true);
  for (const entry of built.values()) entry.object.traverse((child) => {
    if (child instanceof THREE.Mesh) { child.geometry.computeBoundingBox(); child.geometry.computeBoundingSphere(); }
  });
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return { sex, root, structures: built, missing, originMm };
}

/** The representative islet, in micrometres (its root node's scale to metres is removed), one group per cell type and one for capillaries. */
export async function loadRepresentativeIslet(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ readonly root: THREE.Group; readonly counts: Readonly<Record<IsletCellType, number>> }> {
  const bytes = await fetchBoundGlb(ISLET_ASSET.url, ISLET_ASSET.bytes, ISLET_ASSET.sha256, signal, fetcher);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const scene = (await new GLTFLoader().parseAsync(bytes, '')).scene;
  const root = new THREE.Group();
  root.name = 'islet-representative';
  const counts = {} as Record<IsletCellType, number>;
  for (const type of Object.keys(ISLET_CELL_TYPES) as IsletCellType[]) {
    const mesh = scene.getObjectByName(`cells--${type}`);
    if (!(mesh instanceof THREE.Mesh)) throw new Error(`The islet model has no ${type} cells.`);
    counts[type] = Number(mesh.userData.count);
    root.add(new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({ color: ISLET_CELL_TYPES[type].color, roughness: 0.55 })));
    root.children.at(-1)!.name = `cells--${type}`;
  }
  const capillaries = scene.getObjectByName('capillaries');
  if (!(capillaries instanceof THREE.Mesh)) throw new Error('The islet model has no capillaries.');
  root.add(new THREE.Mesh(capillaries.geometry, new THREE.MeshStandardMaterial({ color: '#b2182b', roughness: 0.4 })));
  root.children.at(-1)!.name = 'capillaries';
  root.userData = { evidence: 'simulated', units: 'micrometres' };
  return { root, counts };
}

/**
 * The islet distribution sample for one body: one point per 100 islets, in millimetres, shifted by the same origin as
 * loadHumanPancreas so it sits inside the organ. Background and clustered islets are separate point clouds.
 */
export async function loadIsletDistribution(sex: Sex, originMm: THREE.Vector3, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<THREE.Group> {
  const asset = ISLET_DISTRIBUTION_ASSETS[sex];
  const bytes = await fetchBoundGlb(asset.url, asset.bytes, asset.sha256, signal, fetcher);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const scene = (await new GLTFLoader().parseAsync(bytes, '')).scene;
  const root = new THREE.Group();
  root.name = `human-${sex}:islets`;
  for (const [name, color] of [['islets--background', '#f2f2ee'], ['islets--clustered', '#ffe08a']] as const) {
    const source = scene.getObjectByName(name);
    if (!(source instanceof THREE.Points)) throw new Error(`The islet file has no ${name}.`);
    const geometry = source.geometry.clone().scale(1000, 1000, 1000).translate(-originMm.x, -originMm.y, -originMm.z);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.6, sizeAttenuation: true }));
    points.name = name;
    points.userData = { evidence: 'simulated', represents: 100 };
    root.add(points);
  }
  return root;
}

/** Show or hide a whole layer, e.g. the neighbours. */
export function setLayerVisible(scene: HumanPancreasScene, layer: Layer, visible: boolean): void {
  for (const entry of scene.structures.values()) if (entry.plan.layer === layer) entry.object.visible = visible;
}
