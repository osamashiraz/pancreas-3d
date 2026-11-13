import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { branchNode, lymphNode, inventoryAsData, pancreasStructures, readyStructures, REFS, type Sex } from '../src/domain/human-pancreas-structures';
import { PANCREAS_ROUTES } from '../src/domain/human-pancreas-circuits';
import { EXOCRINE_CELL_TYPES, TISSUE_BLOCK_ASSET, TISSUE_BLOCK_REGION_ASSETS, ISLET_ASSET, ISLET_CELL_TYPES, ISLET_DISTRIBUTION_ASSETS, OMITTED_CELL_TYPES, TISSUE_LEVELS } from '../src/domain/human-pancreas-tissue';
import { loadIsletDistribution, loadRepresentativeIslet } from '../src/viewer/human-pancreas-loader';
import { HUMAN_PANCREAS_ASSETS, HUMAN_PANCREAS_SIMULATED_ASSETS, loadHumanPancreas, setLayerVisible } from '../src/viewer/human-pancreas-loader';

const SEXES: readonly Sex[] = ['male', 'female'];
const manifest = JSON.parse(await readFile(new URL('../public/atlas-human/pancreas-region.manifest.json', import.meta.url), 'utf8')) as {
  references: { sex: Sex; output: { file: string; bytes: number; sha256: string }; nodes: { node: string }[]; missing: string[] }[];
};
const ontology = JSON.parse(await readFile(new URL('../data/human-pancreas-ontology-candidates.json', import.meta.url), 'utf8')) as {
  anatomicalStructures: { termId: string | null }[];
};
const simulated = JSON.parse(await readFile(new URL('../public/atlas-human/pancreas-simulated.manifest.json', import.meta.url), 'utf8')) as {
  references: { sex: Sex; derivedFrom: { sha256: string }; output: { file: string; bytes: number; sha256: string };
    landmarks: { name: string; rule: string; pointMm: number[]; placedMm?: number[] }[];
    routes: { structure: string; branch: string; node: string; via: string[]; contacts: unknown[]; maxStepMm: number; maxTurnDeg: number;
      medianDistanceToFollowedSurfaceMm: number; targetDistanceMm: number }[];
    nodes: { structure: string; station: string; node: string; rule: string; centreMm: number[]; semiAxesMm: number[] }[] }[];
};
const glb = async (sex: Sex) => readFile(new URL(`../public/atlas-human/pancreas-region-${sex}.glb`, import.meta.url));
const simGlb = async (sex: Sex) => readFile(new URL(`../public/atlas-human/pancreas-simulated-${sex}.glb`, import.meta.url));
/** Serves each registered file by its URL, as the static host would. */
const fetcherFor = (files: Record<string, Uint8Array>) => (async (input: RequestInfo | URL) => {
  const url = String(input), name = Object.keys(files).find((key) => url.endsWith(key));
  return name ? new Response(new Uint8Array(files[name])) : new Response(null, { status: 404 });
}) as typeof fetch;
const filesFor = async (sex: Sex) => ({ [`pancreas-region-${sex}.glb`]: await glb(sex), [`pancreas-simulated-${sex}.glb`]: await simGlb(sex) });
const local = (id: string) => id.replace(/^human-(male|female):/, '');

test('the inventory has unique ids, and every structure states evidence, basis and status', () => {
  for (const sex of SEXES) {
    const all = pancreasStructures(sex);
    assert.equal(new Set(all.map((s) => s.id)).size, all.length);
    for (const s of all) {
      assert.ok(s.basis.length > 0, s.id);
      assert.ok(s.description.length > 40, s.id);
      if (s.evidence === 'simulated') assert.ok(['route', 'nodes', 'patches'].includes(s.plan.kind), s.id);
      if (s.evidence === 'source') assert.equal(s.plan.kind, 'reference-node', s.id);
      if (s.status === 'ready') assert.ok(s.plan.kind !== 'patches', `${s.id}: no builder for ${s.plan.kind} yet`);
    }
  }
});

test('the registry matches the extracted files and their manifest', async () => {
  for (const sex of SEXES) {
    const data = await glb(sex), entry = manifest.references.find((r) => r.sex === sex)!;
    assert.equal(data.length, HUMAN_PANCREAS_ASSETS[sex].bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), HUMAN_PANCREAS_ASSETS[sex].sha256);
    assert.equal(entry.output.sha256, HUMAN_PANCREAS_ASSETS[sex].sha256);
    assert.deepEqual(entry.missing, []);
  }
});

test('the committed inventory data matches the inventory (run scripts/human/export_inventory.ts)', async () => {
  const committed = JSON.parse(await readFile(new URL('../data/human-pancreas-inventory.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(inventoryAsData())));
});

test('the simulated files match their registry and were built from the current region files', async () => {
  for (const sex of SEXES) {
    const data = await simGlb(sex), entry = simulated.references.find((r) => r.sex === sex)!;
    assert.equal(data.length, HUMAN_PANCREAS_SIMULATED_ASSETS[sex].bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), HUMAN_PANCREAS_SIMULATED_ASSETS[sex].sha256);
    assert.equal(entry.output.sha256, HUMAN_PANCREAS_SIMULATED_ASSETS[sex].sha256);
    assert.equal(entry.derivedFrom.sha256, HUMAN_PANCREAS_ASSETS[sex].sha256, 'rebuild with scripts/human/place_simulated.py');
  }
});

test('every ready simulated branch was built, from defined landmarks, without entering a drawn structure', () => {
  for (const sex of SEXES) {
    const entry = simulated.references.find((r) => r.sex === sex)!;
    const built = new Map(entry.routes.map((r) => [r.node, r]));
    const defined = new Set(entry.landmarks.map((l) => l.name));
    for (const s of readyStructures(sex)) if (s.plan.kind === 'route') for (const b of s.plan.branches) {
      const r = built.get(branchNode(s.id, b.name));
      assert.ok(r, `${s.id}/${b.name} not built`);
      assert.deepEqual(r.via, b.via, `${s.id}/${b.name}: inventory changed since the build`);
      for (const name of b.via) assert.ok(defined.has(name), name);
      assert.deepEqual(r.contacts, [], `${s.id}/${b.name} enters a drawn structure`);
      assert.ok(r.maxStepMm <= 1.0, `${s.id}/${b.name}: a gap of ${r.maxStepMm} mm`);
      assert.ok(r.maxTurnDeg <= 75, `${s.id}/${b.name}: a kink of ${r.maxTurnDeg} degrees`);
    }
    for (const l of entry.landmarks) assert.ok(l.rule.length > 20, `${l.name} has no rule in words`);
  }
});

test('every lymph node station has its nodes, each with a rule, and no two nodes overlap', () => {
  for (const sex of SEXES) {
    const entry = simulated.references.find((r) => r.sex === sex)!;
    const placed = new Map(entry.nodes.map((n) => [n.node, n]));
    let expected = 0;
    for (const s of readyStructures(sex)) if (s.plan.kind === 'nodes') for (const st of s.plan.stations) for (let i = 1; i <= st.count; i++) {
      const n = placed.get(lymphNode(s.id, st.name, i));
      assert.ok(n, `${s.id} ${st.name}-${i} not placed`);
      assert.equal(n.station, st.name);
      assert.ok(n.rule.length > 30, `${st.name} has no rule in words`);
      expected++;
    }
    assert.equal(entry.nodes.length, expected);
    const nodes = entry.nodes;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(...nodes[i].centreMm.map((v, k) => v - nodes[j].centreMm[k]));
      assert.ok(d >= nodes[i].semiAxesMm[2] + nodes[j].semiAxesMm[2], `${nodes[i].node} overlaps ${nodes[j].node}`);
    }
  }
});

test('the arcades close: superior and inferior branches meet on the same side of the head', async () => {
  for (const sex of SEXES) {
    const scene = await loadHumanPancreas(sex, new AbortController().signal, fetcherFor(await filesFor(sex)));
    const ends = (id: string, branch: string) => {
      const mesh = scene.structures.get(`human-${sex}:${id}`)!.object.getObjectByName(branchNode(`human-${sex}:${id}`, branch)) as THREE.Mesh;
      const p = mesh.geometry.getAttribute('position');
      // The last vertex is the centre of the end cap: the end of the centreline.
      return new THREE.Vector3().fromBufferAttribute(p, p.count - 1);
    };
    for (const side of ['anterior', 'posterior']) {
      const gap = ends('superior-pancreaticoduodenal-arteries', side).distanceTo(ends('inferior-pancreaticoduodenal-arteries', side));
      assert.ok(gap < 1e-3, `${sex} ${side} arcade is open by ${gap} mm`);
    }
    scene.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
});

test('every node of a ready structure was extracted, and every extracted node is used', () => {
  for (const sex of SEXES) {
    const extracted = new Set(manifest.references.find((r) => r.sex === sex)!.nodes.map((n) => n.node));
    const used = new Set<string>();
    for (const s of readyStructures(sex)) if (s.plan.kind === 'reference-node') for (const node of s.plan.nodes) {
      assert.ok(extracted.has(node), `${s.id} needs ${node}`);
      used.add(node);
    }
    assert.deepEqual([...extracted].filter((n) => !used.has(n)), []);
  }
});

test('ontology terms are copied from the candidates file, never typed in', () => {
  const known = new Set(ontology.anatomicalStructures.map((a) => a.termId).filter(Boolean));
  // Terms that come from the ASCT+B table rather than the crosswalk rows copied into the candidates file.
  const fromAsctb = new Set(['UBERON:0004915', 'UBERON:0012271']);
  for (const sex of SEXES) for (const s of pancreasStructures(sex)) if (s.ontology) {
    if (s.ontology.from === 'hra-asct-b-pancreas-v1.3') assert.ok(fromAsctb.has(s.ontology.id), s.id);
    else assert.ok(known.has(s.ontology.id), `${s.id}: ${s.ontology.id}`);
  }
});

test('every circuit route joins structures of the inventory', () => {
  for (const sex of SEXES) {
    const ids = new Set(pancreasStructures(sex).map((s) => local(s.id)));
    for (const route of PANCREAS_ROUTES) for (const end of [route.from, route.to, ...(route.via ?? [])]) assert.ok(ids.has(end), `${route.id}: ${end}`);
  }
});

test('unverified references are marked so they cannot be committed unnoticed', () => {
  const unverified = Object.entries(REFS).filter(([, ref]) => !ref.verified).map(([key]) => key);
  assert.deepEqual(unverified.sort(), ['GRAY']);
});

test('the loader builds only ready structures, in millimetres, centred on the pancreas', async () => {
  for (const sex of SEXES) {
    const scene = await loadHumanPancreas(sex, new AbortController().signal, fetcherFor(await filesFor(sex)));
    try {
      const ready = readyStructures(sex);
      assert.deepEqual(scene.missing, []);
      assert.equal(scene.structures.size, ready.length);
      for (const s of pancreasStructures(sex)) assert.equal(scene.structures.has(s.id), s.status === 'ready', s.id);
      const pancreas = new THREE.Box3();
      for (const entry of scene.structures.values()) if (entry.plan.layer === 'pancreas') pancreas.expandByObject(entry.object);
      const size = pancreas.getSize(new THREE.Vector3()), centre = pancreas.getCenter(new THREE.Vector3());
      assert.ok(size.x > 90 && size.x < 200, `pancreas length ${size.x} mm`);
      assert.ok(centre.length() < 1e-6, 'centred');
      setLayerVisible(scene, 'neighbours', false);
      assert.equal(scene.structures.get(`human-${sex}:spleen`)!.object.visible, false);
      assert.equal(scene.structures.get(`human-${sex}:gastroduodenal-artery`)!.plan.evidence, 'simulated');
      assert.equal(scene.structures.get(`human-${sex}:nodes-hepatic-artery`)!.object.children.length, 4);
    } finally {
      scene.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    }
  }
});

test('the loader refuses a file whose checksum differs', async () => {
  for (const file of ['pancreas-region-female.glb', 'pancreas-simulated-female.glb']) {
    const files = await filesFor('female');
    const data = new Uint8Array(files[file]);
    data[data.length - 1] ^= 1;
    await assert.rejects(loadHumanPancreas('female', new AbortController().signal, fetcherFor({ ...files, [file]: data })), /checksum/, file);
  }
});

const islet = JSON.parse(await readFile(new URL('../public/atlas-human/islet-representative.manifest.json', import.meta.url), 'utf8')) as {
  parameters: Record<string, { value: unknown; source: string | null; verified: boolean }>;
  result: { cells: number; composition: Record<string, number>; compositionTarget: Record<string, number>; cellsWithinReachOfCapillary: number;
    betaHeterotypicFractionInSections: number; betaHeterotypicFractionTarget: number; betaHeterotypicFractionStandardError: number };
  cells: { type: string; centreUm: number[] }[]; output: { bytes: number; sha256: string };
};

test('the islet model meets its published targets', () => {
  const r = islet.result;
  for (const [type, share] of Object.entries(r.compositionTarget)) assert.ok(Math.abs(r.composition[type] - share) <= 0.01, `${type}: ${r.composition[type]} vs ${share}`);
  assert.ok(Math.abs(r.betaHeterotypicFractionInSections - r.betaHeterotypicFractionTarget) <= r.betaHeterotypicFractionStandardError,
    'beta cells touching another type, outside one standard error of Cabrera et al.');
  assert.ok(r.cellsWithinReachOfCapillary >= 0.95);
  assert.equal(islet.cells.length, r.cells);
  for (const c of islet.cells) assert.ok(Math.hypot(...c.centreUm) <= 55, 'a cell lies outside the 110 um islet');
});

test('every islet parameter names its source or is marked unverified', () => {
  for (const [name, p] of Object.entries(islet.parameters)) assert.ok(p.verified ? !!p.source : p.source === null, name);
  assert.deepEqual(Object.entries(islet.parameters).filter(([, p]) => !p.verified).map(([n]) => n).sort(),
    ['capillaryRadiusUm', 'capillaryReachCells', 'cellDiameterUm']);
});

test('islet cell types carry Cell Ontology terms copied from the ASCT+B table', async () => {
  const cand = JSON.parse(await readFile(new URL('../data/human-pancreas-ontology-candidates.json', import.meta.url), 'utf8')) as { cellTypes: { termId: string }[] };
  const known = new Set(cand.cellTypes.map((c) => c.termId));
  for (const t of Object.values(ISLET_CELL_TYPES)) assert.ok(known.has(t.cl), t.cl);
  for (const cl of OMITTED_CELL_TYPES) assert.ok(known.has(cl), cl);
  assert.ok(TISSUE_LEVELS.some((l) => l.id === 'islet' && l.status === 'ready'));
});

test('the islet loads through the checked path, with one group per cell type', async () => {
  const data = await readFile(new URL('../public/atlas-human/islet-representative.glb', import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), ISLET_ASSET.sha256);
  assert.equal(data.length, ISLET_ASSET.bytes);
  assert.equal(islet.output.sha256, ISLET_ASSET.sha256);
  const { root, counts } = await loadRepresentativeIslet(new AbortController().signal, fetcherFor({ 'islet-representative.glb': data }));
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), islet.result.cells);
  assert.equal(root.children.length, 5);
  root.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
});

const dist = JSON.parse(await readFile(new URL('../public/atlas-human/islets.manifest.json', import.meta.url), 'utf8')) as {
  parameters: Record<string, { value: unknown; source: string | null; verified: boolean }>;
  references: { sex: Sex; organVolumeCm3: number; islets: number; tailToHeadBodyDensity: number; clusteredShare: number;
    output: { bytes: number; sha256: string; sampleEvery: number; points: { background: number; clustered: number } } }[];
};

test('the islet distribution meets its published targets in both bodies', () => {
  const P = dist.parameters as Record<string, { value: any }>;
  for (const r of dist.references) {
    assert.ok(Math.abs(r.tailToHeadBodyDensity - P.regionalDensity.value['pancreas-tail']) <= 0.05, `${r.sex} tail density ${r.tailToHeadBodyDensity}`);
    assert.ok(Math.abs(r.clusteredShare - P.clusterShare.value) <= 0.005, `${r.sex} clustered ${r.clusteredShare}`);
    // The HRA organ should be of human size; Hahn et al. give about 73 cm3 on average.
    assert.ok(r.organVolumeCm3 > 50 && r.organVolumeCm3 < 120, `${r.sex} organ ${r.organVolumeCm3} cm3`);
    const expected = P.endocrineFraction.value * r.organVolumeCm3 * 1000 / (4 / 3 * Math.PI * (P.isletDiameterUm.value / 2000) ** 3);
    assert.ok(Math.abs(r.islets - expected) / expected < 0.01, `${r.sex} islet count`);
  }
  assert.deepEqual(Object.entries(dist.parameters).filter(([, p]) => !p.verified).map(([n]) => n).sort(), ['clusterIslets', 'peripheryMm']);
  for (const [n, p] of Object.entries(dist.parameters)) assert.ok(p.verified ? !!p.source : p.source === null, n);
});

test('the islet sample loads through the checked path and sits inside the organ', async () => {
  for (const sex of SEXES) {
    const data = await readFile(new URL(`../public/atlas-human/islets-${sex}.glb`, import.meta.url));
    const entry = dist.references.find((r) => r.sex === sex)!;
    assert.equal(createHash('sha256').update(data).digest('hex'), ISLET_DISTRIBUTION_ASSETS[sex].sha256);
    assert.equal(entry.output.sha256, ISLET_DISTRIBUTION_ASSETS[sex].sha256);
    const scene = await loadHumanPancreas(sex, new AbortController().signal, fetcherFor(await filesFor(sex)));
    const islets = await loadIsletDistribution(sex, scene.originMm, new AbortController().signal, fetcherFor({ [`islets-${sex}.glb`]: data }));
    const count = islets.children.reduce((n, p) => n + ((p as THREE.Points).geometry.getAttribute('position').count), 0);
    assert.equal(count, entry.output.points.background + entry.output.points.clustered);
    const organ = new THREE.Box3();
    for (const e of scene.structures.values()) if (e.plan.layer === 'pancreas') organ.expandByObject(e.object);
    const box = new THREE.Box3().setFromObject(islets);
    assert.ok(organ.expandByScalar(1).containsBox(box), `${sex}: islets outside the organ box`);
    scene.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
});

test('the tissue block: one acinus per intercalated duct, none inside the islet, parameters sourced or flagged', async () => {
  const data = await readFile(new URL('../public/atlas-human/tissue-block.json', import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), TISSUE_BLOCK_ASSET.sha256);
  assert.equal(data.length, TISSUE_BLOCK_ASSET.bytes);
  const b = JSON.parse(data.toString('utf8')) as { parameters: Record<string, { value: any; source: string | null; verified: boolean }>;
    acini: { centre: number[]; r: number; cells: number; ext: number[] }[]; ducts: { a: number[]; b: number[]; kind: string; r: number }[]; islet: { centreUm: number[]; radiusUm: number; cells: unknown[] };
    capillaries: { nodes: number[][]; edges: number[][] }; stroma: { fibres: unknown[]; stellateCells: unknown[] };
    result: { acinarVolumeFraction: number; aciniWithinReachOfCapillary: number } };
  const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]));
  const ic = b.ducts.filter((d) => d.kind === 'intercalated');
  assert.equal(ic.length, b.acini.length, 'each acinus has its own intercalated duct');
  for (const [i, d] of ic.entries()) assert.ok(Math.abs(dist(d.b, b.acini[i].centre) - b.acini[i].r) < 0.05, 'the duct ends at its acinus surface');
  for (const [i, a] of b.acini.entries()) {
    assert.ok(dist(a.centre, b.islet.centreUm) > b.islet.radiusUm + a.r, 'acinus inside the islet');
    for (let j = i + 1; j < b.acini.length; j++) assert.ok(dist(a.centre, b.acini[j].centre) >= a.r + b.acini[j].r, 'acini overlap');
  }
  // Rigid spheres on a duct tree pack loosely; real acini deform and fill most of a lobule. Guard against regressions.
  assert.ok(b.result.acinarVolumeFraction > 0.45, 'acinar packing regressed');
  for (const a of b.acini) {  // deformation: every cell reaches at least the sphere, at most twice its radius
    assert.equal(a.ext.length, a.cells);
    for (const e of a.ext) assert.ok(e >= a.r - 0.051 && e <= 2 * a.r + 0.051,  // stored to 0.1 um
      `cell reach ${e} outside [r, 2r] for r = ${a.r}`);
  }
  assert.ok(b.result.aciniWithinReachOfCapillary >= 0.95);
  for (const [i, j] of b.capillaries.edges) assert.ok(i < b.capillaries.nodes.length && j < b.capillaries.nodes.length);
  assert.ok(b.stroma.fibres.length > 0 && b.stroma.stellateCells.length > 0);
  for (const [n, p] of Object.entries(b.parameters)) assert.ok(p.verified ? !!p.source : p.source === null, n);
  assert.ok(b.parameters.zymogenGranuleDiameterUm.verified && b.parameters.intraAcinarDuct.verified);
  assert.ok(b.acini.length > 300);
  const cand = JSON.parse(await readFile(new URL('../data/human-pancreas-ontology-candidates.json', import.meta.url), 'utf8')) as { cellTypes: { termId: string }[] };
  const known = new Set(cand.cellTypes.map((c) => c.termId));
  for (const t of Object.values(EXOCRINE_CELL_TYPES)) assert.ok(known.has(t.cl), t.cl);
});

test('each region has its own block, built independently, meeting the same rules', async () => {
  const seeds = new Set<number>();
  for (const [region, asset] of Object.entries(TISSUE_BLOCK_REGION_ASSETS)) {
    const data = await readFile(new URL('../public' + asset.url, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, region);
    assert.equal(data.length, asset.bytes, region);
    const b = JSON.parse(data.toString('utf8')) as { seed: number; region?: string; acini: { centre: number[]; r: number; cells: number; ext: number[] }[];
      ducts: { kind: string; b: number[] }[]; islet: { centreUm: number[]; radiusUm: number }; result: { acinarVolumeFraction: number; aciniWithinReachOfCapillary: number } };
    if (b.region) assert.equal(b.region, region);
    seeds.add(b.seed);
    const ic = b.ducts.filter((d) => d.kind === 'intercalated'), dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]));
    assert.equal(ic.length, b.acini.length, `${region}: one intercalated duct per acinus`);
    for (const [i, a] of b.acini.entries()) {
      assert.ok(dist(a.centre, b.islet.centreUm) > b.islet.radiusUm + a.r, `${region}: acinus inside the islet`);
      for (let j = i + 1; j < b.acini.length; j++) assert.ok(dist(a.centre, b.acini[j].centre) >= a.r + b.acini[j].r, `${region}: acini overlap`);
      for (const e of a.ext) assert.ok(e >= a.r - 0.051 && e <= 2 * a.r + 0.051, `${region}: cell reach`);
    }
    assert.ok(b.result.acinarVolumeFraction > 0.45, `${region}: packing`);
    assert.ok(b.result.aciniWithinReachOfCapillary >= 0.95, `${region}: capillaries`);
  }
  assert.equal(seeds.size, 3, 'the regions use different seeds');
});

test('generated tissue blocks follow the builder\'s rules', async () => {
  const { generateBlock } = await import('../src/domain/human-pancreas-generator');
  for (const seed of [2001, 2047]) {
    const b = generateBlock(seed, 'body'), dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const ic = b.ducts.filter((d) => d.kind === 'intercalated');
    assert.equal(ic.length, b.acini.length, 'one intercalated duct per acinus');
    for (const [i, d] of ic.entries()) assert.ok(Math.abs(dist(d.b, b.acini[i].centre) - b.acini[i].r) < 0.05, 'each duct ends at its own acinus');
    for (const [i, a] of b.acini.entries()) {
      assert.ok(dist(a.centre, b.islet.centreUm) > b.islet.radiusUm + a.r, 'acinus inside the islet');
      for (let j = i + 1; j < b.acini.length; j++) assert.ok(dist(a.centre, b.acini[j].centre) >= a.r + b.acini[j].r, 'acini overlap');
      assert.equal(a.ext.length, a.cells);
      for (const e of a.ext) assert.ok(e >= a.r - 0.051 && e <= 2 * a.r + 0.051, 'cell reach');
    }
    assert.ok(b.acini.length > 250 && b.result.acinarVolumeFraction > 0.45, `packing ${b.result.acinarVolumeFraction}`);
    assert.ok(b.result.aciniWithinReachOfCapillary >= 0.95);
    assert.ok(b.result.isletCells > 20);
    assert.deepEqual(JSON.stringify(generateBlock(seed, 'body').acini.slice(0, 5)), JSON.stringify(b.acini.slice(0, 5)), 'deterministic');
  }
});

test('generated islets vary about the measured mean size and the average composition', async () => {
  const { generateIslet } = await import('../src/domain/human-pancreas-generator');
  const islets = Array.from({ length: 25 }, (_, k) => generateIslet(5001 + k));
  const mean = islets.reduce((s, i) => s + i.diameterUm, 0) / islets.length;
  assert.ok(Math.abs(mean - 110) < 15, `mean diameter ${mean}`);   // Hahn 2021: 110 um
  assert.ok(Math.max(...islets.map((i) => i.diameterUm)) - Math.min(...islets.map((i) => i.diameterUm)) > 40, 'sizes vary');
  const beta = islets.map((i) => i.composition.beta), meanBeta = beta.reduce((a, b) => a + b, 0) / beta.length;
  assert.ok(Math.abs(meanBeta - 117 / 215) < 0.08, `mean beta share ${meanBeta}`);
  assert.ok(Math.max(...beta) - Math.min(...beta) > 0.1, 'composition varies between islets (Brissova 2005)');
  for (const i of islets) for (const [, x, y, z] of i.cells) assert.ok((x / i.semiAxesUm[0]) ** 2 + (y / i.semiAxesUm[1]) ** 2 + (z / i.semiAxesUm[2]) ** 2 <= 1.0001, 'cell outside its islet');
});
