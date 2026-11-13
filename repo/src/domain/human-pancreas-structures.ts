/**
 * The inventory of the human pancreas module. Every structure declares its evidence,
 * following scripts/living/structures.ts of MouseBio_3D. It lives in src/domain because the
 * viewer reads it directly; there is no build step between it and the scene.
 *
 * Differences from the mouse inventory:
 * - The base is not one segmented volume but the HRA 3D reference organs, which are
 *   meshes drawn from the Visible Human Male and Female (NLM). Each organ region is a
 *   named node in a GLB, so "source" means "this node of that file", not a label number.
 * - The inventory is built per sex, because HRA ships a male and a female pancreas with
 *   different node names (including a typo in the female uncinate node, kept verbatim).
 * - Each structure has a `status`. "ready" means its nodes are in the extracted region file
 *   public/atlas-human/pancreas-region-<sex>.glb, made by extract_pancreas_region.py from the
 *   HRA united models (ccf-releases v2.0, commit b036a91) with the geometry bytes unchanged.
 *   "planned" means the geometry does not exist yet. The viewer must never show a planned structure.
 * - Each structure has a `layer`, so the viewer can show the organ, ducts, vessels and
 *   neighbours separately.
 * - Simulated routes are placed on named landmarks of the reference meshes, never on
 *   hand-typed coordinates, so they move with the reference they are bound to.
 */

export type Evidence = 'source' | 'traced' | 'simulated';
export type Status = 'ready' | 'planned';
export type Sex = 'male' | 'female';
export type Layer = 'pancreas' | 'ducts' | 'arteries' | 'veins' | 'neighbours' | 'lymph' | 'nerves';

/** A named point that the build resolves on a reference mesh, e.g. 'head:centroid' or 'tail:tip'. */
export type Landmark = string;

export type Plan =
  /** Nodes of the extracted HRA region file, used as drawn. Several nodes make one structure, e.g. the parts of the duodenum. */
  | { readonly kind: 'reference-node'; readonly asset: ReferenceAsset; readonly nodes: readonly string[] }
  /** A tube along landmarks, for vessels, ducts and nerves that no source draws. */
  /**
   * Tubes along named landmarks, for vessels, ducts and nerves that no source draws. Each branch is built
   * separately; branches that end on the same landmark meet there, which is how the arcades close.
   * `hug` names the structures whose surface the tube follows. Built by scripts/human/place_simulated.py.
   */
  | { readonly kind: 'route'; readonly asset: SimulatedAsset; readonly branches: readonly Branch[]; readonly hug: readonly string[]; readonly radiusMm: readonly [number, number] }
  /**
   * Lymph nodes, by station. Each station's anchors and preferred side are a rule in scripts/human/place_simulated.py;
   * each node is placed at the nearest spot where it touches no drawn structure, vessel or other node.
   */
  | { readonly kind: 'nodes'; readonly asset: SimulatedAsset; readonly stations: readonly Station[]; readonly radiusMm: readonly [number, number] }
  /** Small bodies scattered on the surface of structures built earlier, for ganglia. Not built yet. */
  | { readonly kind: 'patches'; readonly on: readonly string[]; readonly count: number; readonly radiusMm: number }
  /** Segmented from the Visible Human images. Not started. */
  | { readonly kind: 'traced'; readonly images: 'vhp-ct' | 'vhp-cryosection'; readonly method: string };

/** Extracted from the HRA united body models; see public/atlas-human/pancreas-region.manifest.json. */
export type ReferenceAsset = 'pancreas-region-male.glb' | 'pancreas-region-female.glb';
export const assetOf = (sex: Sex): ReferenceAsset => `pancreas-region-${sex}.glb`;
/** Generated from the region file by scripts/human/place_simulated.py; see pancreas-simulated.manifest.json. */
export type SimulatedAsset = 'pancreas-simulated-male.glb' | 'pancreas-simulated-female.glb';
export const simulatedAssetOf = (sex: Sex): SimulatedAsset => `pancreas-simulated-${sex}.glb`;

/**
 * One tube of a route. Its node in the simulated file is named `sim--human-<sex>--<structure>--<branch>`:
 * three.js removes '/', ':', '.', '[' and ']' from node names when it loads a glTF, so none are used.
 */
export interface Branch { readonly name: string; readonly via: readonly Landmark[] }
export const branchNode = (structureId: string, branch: string) => `sim--${structureId.replace(':', '--')}--${branch}`;

/** A lymph node station, numbered as the Japan Pancreas Society does (eighth edition, Table 1; see REFS.JPS). */
export interface Station { readonly name: string; readonly label: string; readonly count: number }
/** Node of one lymph node in the simulated file: `node--human-<sex>--<structure>--<station>-<n>`, counting from 1. */
export const lymphNode = (structureId: string, station: string, n: number) => `node--${structureId.replace(':', '--')}--${station}-${n}`;

export interface OntologyTerm {
  readonly id: string;
  readonly label: string;
  /** Where the mapping was read. A term is never typed from memory. */
  readonly from: 'hra-3d-crosswalk-v2.0' | 'hra-asct-b-pancreas-v1.3';
}

export interface StructurePlan {
  readonly id: string;
  readonly name: string;
  readonly systems: readonly string[];
  readonly layer: Layer;
  readonly evidence: Evidence;
  readonly status: Status;
  readonly description: string;
  readonly basis: readonly string[];
  readonly color: string;
  readonly defaultOpacity?: number;
  readonly scale: 'organ';
  /** null means no verified mapping. It must not be filled with a guess. */
  readonly ontology: OntologyTerm | null;
  readonly plan: Plan;
}

// References. `verified` means the citation was checked against the source this session.
// Unverified ones must be checked before they are committed.
export const REFS = {
  HRA: { verified: true, text: 'Börner K, et al. Human BioMolecular Atlas Program (HuBMAP): 3D Human Reference Atlas construction and usage. Nat Methods 2025;22(4):845-860. doi:10.1038/s41592-024-02563-5' },
  HRA_ORGANS: { verified: true, text: 'HRA 3D Reference Object Library, pancreas (male and female), ccf-releases v2.0. CC BY 4.0. https://humanatlas.io/3d-reference-library' },
  ASCTB: { verified: true, text: 'Campbell-Thompson M, Eskaros A, Saunders D. ASCT+B table for the pancreas, v1.3, 2023. doi:10.48539/HBM336.TBNP.923' },
  VHM: { verified: true, text: 'Spitzer V, Ackerman MJ, Scherzinger AL, Whitlock D. The Visible Human Male: a technical report. J Am Med Inform Assoc 1996;3(2):118-30. doi:10.1136/jamia.1996.96236280' },
  VHP: { verified: true, text: 'Ackerman MJ. The Visible Human Project. Proc IEEE 1998;86(3):504-11. doi:10.1109/5.662875' },
  CABRERA: { verified: true, text: 'Cabrera O, Berman DM, Kenyon NS, Ricordi C, Berggren PO, Caicedo A. The unique cytoarchitecture of human pancreatic islets has implications for islet cell function. Proc Natl Acad Sci U S A 2006;103(7):2334-9. doi:10.1073/pnas.0510790103' },
  WALKER: { verified: true, text: 'Walker JT, Saunders DC, Brissova M, Powers AC. The human islet: mini-organ with mega-impact. Endocr Rev 2021;42(5):605-657. doi:10.1210/endrev/bnab010' },
  GRAY: { verified: false, text: 'Standring S, ed. Gray\'s Anatomy: The Anatomical Basis of Clinical Practice. 42nd ed. Elsevier, 2021. Chapter on the pancreas.' },
  JPS: { verified: true, text: 'Ishida M, Fujii T, Kishiwada M, et al. Japanese classification of pancreatic carcinoma by the Japan Pancreas Society: eighth edition. J Hepatobiliary Pancreat Sci 2024;31(11):755-68. doi:10.1002/jhbp.12056. (Table 1: station numbers and names of lymph nodes.)' },
} as const;
const R = (...keys: (keyof typeof REFS)[]) => keys.map((key) => REFS[key].text);

const POSE = 'The Visible Human was imaged supine after death; the organ is shown as drawn by HRA, not in a living posture.';
const SIDE = 'In the HRA frame the tail lies at higher x than the head, so +x is taken as the left of the body. This is inferred from the mesh and not stated by the source.';

// ---------------------------------------------------------------------------
// Helpers, one per kind of evidence, as in the mouse inventory.

/** One region of the HRA pancreas, exactly as the reference organ draws it. */
const region = (sex: Sex, id: string, name: string, node: string, ontology: OntologyTerm, color: string, note: string): StructurePlan => ({
  id: `human-${sex}:${id}`, name, layer: 'pancreas', systems: ['digestive', 'endocrine'], evidence: 'source', status: 'ready', scale: 'organ', color, ontology,
  description: `The node "${node}" of the HRA ${sex} pancreas, drawn by a medical illustrator from the Visible Human ${sex === 'male' ? 'Male' : 'Female'} and reviewed by organ experts. ${note} ${POSE} ${SIDE}`,
  basis: R('HRA_ORGANS', 'HRA', sex === 'male' ? 'VHM' : 'VHP'),
  plan: { kind: 'reference-node', asset: assetOf(sex), nodes: [node] },
});

/** A structure HRA draws in its united body model, copied unchanged into the region file. */
const drawn = (sex: Sex, layer: Layer, id: string, name: string, nodes: string[], systems: string[], ontology: OntologyTerm | null, color: string, note: string): StructurePlan => ({
  id: `human-${sex}:${id}`, name, layer, systems, evidence: 'source', status: 'ready', scale: 'organ', color, ontology,
  description: `${nodes.length === 1 ? `The node "${nodes[0]}"` : `The nodes ${nodes.map((n) => `"${n}"`).join(', ')}`} of the HRA ${sex} united body model. ${note} ${POSE}`,
  basis: R('HRA_ORGANS', 'HRA'),
  plan: { kind: 'reference-node', asset: assetOf(sex), nodes },
});

/** A tube placed on landmarks, after a textbook description. `status` is 'ready' only once the builder places it. */
const route = (sex: Sex, layer: Layer, id: string, name: string, systems: string[], color: string, branches: Branch[] | Landmark[], hug: string[],
  radiusMm: [number, number], description: string, status: Status = 'planned', basis = R('GRAY')): StructurePlan => ({
  id: `human-${sex}:${id}`, name, layer, systems, evidence: 'simulated', status, scale: 'organ', color, ontology: null,
  description: `Simulated. ${description} The course and calibre are estimates placed by rule on landmarks of the reference meshes, and they are not measured. Branching varies widely between people; this is one common pattern.`,
  basis, plan: { kind: 'route', asset: simulatedAssetOf(sex), radiusMm, hug,
    branches: typeof branches[0] === 'string' ? [{ name: 'main', via: branches as Landmark[] }] : branches as Branch[] },
});

/** Lymph node stations, placed by rule. Sizes are typical, not measured: 2.5 by 3.5 mm semi-axes, the long one along the vessel. */
const stations = (sex: Sex, id: string, name: string, list: Station[], description: string): StructurePlan => ({
  id: `human-${sex}:${id}`, name, layer: 'lymph', systems: ['lymphatic', 'immune'], evidence: 'simulated', status: 'ready', scale: 'organ', color: '#3f9e9a', ontology: null,
  description: `Simulated. ${description} Each node is placed by rule beside its vessel, at the nearest spot where it touches no drawn structure, vessel or other node. `
    + 'How many nodes there are, where and how large varies between people; these show where each station lies, not this person\'s nodes.',
  basis: R('JPS', 'GRAY'), plan: { kind: 'nodes', asset: simulatedAssetOf(sex), stations: list, radiusMm: [2.5, 3.5] },
});

/** A group of small bodies, for ganglia. */
const group = (sex: Sex, layer: Layer, id: string, name: string, systems: string[], color: string, on: string[], count: number, radiusMm: number, description: string, basis = R('GRAY')): StructurePlan => ({
  id: `human-${sex}:${id}`, name, layer, systems, evidence: 'simulated', status: 'planned', scale: 'organ', color, ontology: null,
  description: `Simulated. ${description} Number, size and place are estimates, and no node or ganglion is measured.`,
  basis, plan: { kind: 'patches', on, count, radiusMm },
});

// Ontology terms, copied from the HRA files named in `from`. See data/human-pancreas-ontology-candidates.json.
const T = {
  pancreas: { id: 'UBERON:0001264', label: 'pancreas', from: 'hra-3d-crosswalk-v2.0' },
  head: { id: 'UBERON:0001069', label: 'head of pancreas', from: 'hra-3d-crosswalk-v2.0' },
  uncinate: { id: 'UBERON:0010373', label: 'uncinate process of pancreas', from: 'hra-3d-crosswalk-v2.0' },
  neck: { id: 'FMA:14517', label: 'Neck of pancreas', from: 'hra-3d-crosswalk-v2.0' },
  body: { id: 'UBERON:0001150', label: 'body of pancreas', from: 'hra-3d-crosswalk-v2.0' },
  tail: { id: 'UBERON:0001151', label: 'tail of pancreas', from: 'hra-3d-crosswalk-v2.0' },
  mainDuct: { id: 'UBERON:0001064', label: 'ventral pancreatic duct (main duct, of Wirsung)', from: 'hra-3d-crosswalk-v2.0' },
  accessoryDuct: { id: 'UBERON:0005429', label: 'dorsal pancreatic duct (accessory duct, of Santorini)', from: 'hra-3d-crosswalk-v2.0' },
  bileDuct: { id: 'UBERON:0001174', label: 'common bile duct', from: 'hra-3d-crosswalk-v2.0' },
  ampulla: { id: 'UBERON:0004913', label: 'hepatopancreatic ampulla', from: 'hra-3d-crosswalk-v2.0' },
  sphincter: { id: 'UBERON:0004915', label: 'hepatopancreatic sphincter (of Oddi)', from: 'hra-asct-b-pancreas-v1.3' },
  majorPapilla: { id: 'UBERON:0012271', label: 'major duodenal papilla', from: 'hra-asct-b-pancreas-v1.3' },
  coeliac: { id: 'FMA:14812', label: 'Celiac trunk', from: 'hra-3d-crosswalk-v2.0' },
  commonHepatic: { id: 'UBERON:0005436', label: 'common hepatic artery', from: 'hra-3d-crosswalk-v2.0' },
  splenicArtery: { id: 'UBERON:0001194', label: 'splenic artery', from: 'hra-3d-crosswalk-v2.0' },
  sma: { id: 'UBERON:0001182', label: 'superior mesenteric artery', from: 'hra-3d-crosswalk-v2.0' },
  smv: { id: 'UBERON:0001138', label: 'superior mesenteric vein', from: 'hra-3d-crosswalk-v2.0' },
  splenicVein: { id: 'UBERON:0003713', label: 'splenic vein', from: 'hra-3d-crosswalk-v2.0' },
  portal: { id: 'UBERON:0001639', label: 'hepatic portal vein', from: 'hra-3d-crosswalk-v2.0' },
  properHepatic: { id: 'FMA:14772', label: 'Hepatic artery proper', from: 'hra-3d-crosswalk-v2.0' },
  duodenum: { id: 'UBERON:0002114', label: 'duodenum', from: 'hra-3d-crosswalk-v2.0' },
  duodenalAmpulla: { id: 'UBERON:0013644', label: 'duodenal ampulla', from: 'hra-3d-crosswalk-v2.0' },
  spleen: { id: 'UBERON:0002106', label: 'spleen', from: 'hra-3d-crosswalk-v2.0' },
} as const satisfies Record<string, OntologyTerm>;

// ---------------------------------------------------------------------------

export function pancreasStructures(sex: Sex): readonly StructurePlan[] {
  const m = sex === 'male';
  const P = m ? 'VH_M_' : 'VH_F_';
  return [
    // 1. The organ: five source regions.
    region(sex, 'pancreas-head', 'Head of pancreas', `${P}head_of_pancreas`, T.head, '#c0703a',
      'Lies in the curve of the duodenum, to the right of the superior mesenteric vessels; the common bile duct runs behind or through it.'),
    region(sex, 'pancreas-uncinate', 'Uncinate process', m ? 'VH_M_uncinate_process_of_the_pancreas' : 'VH_F_ucinate_process1', T.uncinate, '#964f2c',
      `Hooks behind the superior mesenteric vein. It forms from the ventral bud.${m ? '' : ' The node name is spelled "ucinate" in the source and is kept as it is.'}`),
    region(sex, 'pancreas-neck', 'Neck of pancreas', `${P}neck_of_pancreas`, T.neck, '#d29257',
      'Lies in front of the superior mesenteric and portal veins. Ontology term is FMA, because the source gives no UBERON term.'),
    region(sex, 'pancreas-body', 'Body of pancreas', `${P}body_of_pancreas`, T.body, '#c77f6e',
      'Runs to the left behind the stomach and the lesser sac; the splenic vein lies along its back.'),
    region(sex, 'pancreas-tail', 'Tail of pancreas', `${P}tail_of_pancreas`, T.tail, '#a8687f',
      'Reaches towards the hilum of the spleen.'),

    // 2. Ducts, as HRA draws them. The minor papilla is simulated.
    drawn(sex, 'ducts', 'main-pancreatic-duct', 'Main pancreatic duct (of Wirsung)', [`${P}ventral_pancreatic_duct`], ['digestive'], T.mainDuct, '#f1d36b',
      'HRA names it the ventral pancreatic duct. In the adult it carries the dorsal duct of the body and tail into the ventral duct of the head, and HRA draws it along the whole gland.'),
    drawn(sex, 'ducts', 'accessory-pancreatic-duct', 'Accessory pancreatic duct (of Santorini)', [`${P}dorsal_pancreatic_duct`], ['digestive'], T.accessoryDuct, '#f6e2a0',
      'The remnant of the proximal dorsal duct, opening at the minor papilla when it is patent.'),
    drawn(sex, 'ducts', 'common-bile-duct', 'Common bile duct', [`${P}common_bile_duct`], ['digestive'], T.bileDuct, '#7da34a', 'Crosses behind or through the head to the ampulla.'),
    drawn(sex, 'ducts', 'hepatopancreatic-ampulla', 'Hepatopancreatic ampulla (of Vater)', [`${P}hepatopancreatic_ampulla`], ['digestive'], T.ampulla, '#c9a95a', 'Where bile and pancreatic ducts meet before the major papilla.'),
    drawn(sex, 'ducts', 'sphincter-of-oddi', 'Sphincter of the ampulla (of Oddi)', [`${P}sphincter_of_${m ? 'hepatopancreatic' : 'heptopancreatic'}_ampulla`], ['digestive', 'muscular'], T.sphincter, '#b98a6a',
      `Drawn with the small intestine in HRA.${m ? '' : ' The female node name is spelled "heptopancreatic" in the source and is kept as it is.'}`),
    route(sex, 'ducts', 'minor-papilla', 'Minor duodenal papilla', ['digestive'], '#d8b98c', ['accessory-pancreatic-duct:end', 'duodenum:wall-nearest'], ['duodenum'], [1.5, 1.5],
      'Where the accessory duct opens into the duodenum, above and in front of the major papilla. No ontology term is mapped: the ASCT+B table reuses the duct\'s term for it.'),

    // 3. Arteries. HRA draws the trunks; the arcades and pancreatic branches are simulated.
    drawn(sex, 'arteries', 'coeliac-trunk', 'Coeliac trunk', [`${P}celiac_trunk`], ['cardiovascular'], T.coeliac, '#c8333a', 'From the aorta above the pancreas.'),
    drawn(sex, 'arteries', 'common-hepatic-artery', 'Common hepatic artery', [`${P}common_hepatic_artery`], ['cardiovascular'], T.commonHepatic, '#c8333a', 'Runs to the right along the upper border of the head.'),
    drawn(sex, 'arteries', 'proper-hepatic-artery', 'Proper hepatic artery', [`${P}proper_hepatic_artery`], ['cardiovascular'], T.properHepatic, '#c8333a',
      'Continues the common hepatic artery to the liver after the gastroduodenal artery leaves it. HRA does not draw the gastroduodenal artery, so the junction is shown without it.'),
    drawn(sex, 'arteries', 'splenic-artery', 'Splenic artery', [`${P}splenic_artery`], ['cardiovascular'], T.splenicArtery, '#c8333a', 'Runs tortuously along the upper border of the body and tail.'),
    drawn(sex, 'arteries', 'superior-mesenteric-artery', 'Superior mesenteric artery', [`${P}superior_mesenteric_artery`], ['cardiovascular'], T.sma, '#c8333a', 'Behind the neck, to the left of the superior mesenteric vein. Its contact with a tumour decides resectability.'),
    route(sex, 'arteries', 'gastroduodenal-artery', 'Gastroduodenal artery', ['cardiovascular'], '#e0636a',
      [{ name: 'trunk', via: ['common-hepatic-artery:gastroduodenal-origin', 'pancreas-head:gastroduodenal-division'] }],
      ['pancreas-head', 'pancreas-neck'], [1.6, 1.3],
      'From the common hepatic artery where the proper hepatic artery continues, down over the front of the head, behind the first part of the duodenum, to where it divides at the lower border of that part.',
      'ready'),
    route(sex, 'arteries', 'superior-pancreaticoduodenal-arteries', 'Anterior and posterior superior pancreaticoduodenal arteries', ['cardiovascular'], '#e0636a',
      [{ name: 'anterior', via: ['pancreas-head:gastroduodenal-division', 'pancreas-head:anterior-groove-middle'] },
       { name: 'posterior', via: ['gastroduodenal-artery:upper-third', 'pancreas-head:posterior-groove-upper', 'pancreas-head:posterior-groove-middle'] }],
      ['pancreas-head', 'pancreas-neck'], [1.0, 0.7],
      'The anterior artery continues the gastroduodenal artery down the front of the head; the posterior arises higher from it and passes round to the back of the head. Both run near the curve of the duodenum.',
      'ready'),
    route(sex, 'arteries', 'inferior-pancreaticoduodenal-arteries', 'Anterior and posterior inferior pancreaticoduodenal arteries', ['cardiovascular'], '#e0636a',
      [{ name: 'anterior', via: ['superior-mesenteric-artery:inferior-pancreaticoduodenal-origin', 'pancreas-uncinate:inferior', 'pancreas-head:anterior-groove-lower', 'pancreas-head:anterior-groove-middle'] },
       { name: 'posterior', via: ['superior-mesenteric-artery:inferior-pancreaticoduodenal-origin', 'pancreas-uncinate:inferior', 'pancreas-head:posterior-groove-lower', 'pancreas-head:posterior-groove-middle'] }],
      ['pancreas-head', 'pancreas-uncinate'], [1.0, 0.7],
      'From the superior mesenteric artery near the lower border of the pancreas, often by a common trunk, up to the front and back of the head. They meet the superior arteries at the middle of the head, closing the anterior and posterior arcades.',
      'ready'),
    route(sex, 'arteries', 'dorsal-pancreatic-artery', 'Dorsal and transverse pancreatic arteries', ['cardiovascular'], '#e0636a',
      [{ name: 'dorsal', via: ['splenic-artery:dorsal-pancreatic-origin', 'pancreas-neck:posterior-inferior'] },
       { name: 'transverse', via: ['pancreas-neck:posterior-inferior', 'pancreas-body:inferior-border-middle', 'pancreas-tail:inferior-border-start'] }],
      ['pancreas-neck', 'pancreas-body', 'pancreas-tail'], [1.0, 0.6],
      'The dorsal pancreatic artery leaves the first part of the splenic artery and descends behind the neck; its left branch, the transverse pancreatic artery, runs along the lower border of the body towards the tail. Its origin varies: it may arise from the coeliac trunk, the common hepatic or the superior mesenteric artery.',
      'ready'),
    route(sex, 'arteries', 'great-pancreatic-artery', 'Great pancreatic artery', ['cardiovascular'], '#e0636a',
      [{ name: 'main', via: ['splenic-artery:great-pancreatic-origin', 'pancreas-body:posterior-middle'] }],
      ['pancreas-body'], [0.9, 0.6],
      'The largest branch of the splenic artery to the gland, entering the back of the body near its middle.',
      'ready'),
    route(sex, 'arteries', 'caudal-pancreatic-arteries', 'Caudal pancreatic arteries', ['cardiovascular'], '#e0636a',
      [{ name: 'first', via: ['splenic-artery:caudal-origin-1', 'pancreas-tail:posterior-1'] },
       { name: 'second', via: ['splenic-artery:caudal-origin-2', 'pancreas-tail:posterior-2'] }],
      ['pancreas-tail'], [0.6, 0.4],
      'Small branches of the distal splenic artery to the back of the tail; two are drawn, and their number varies.',
      'ready'),

    // 4. Veins.
    drawn(sex, 'veins', 'splenic-vein', 'Splenic vein', [`${P}splenic_vein`], ['cardiovascular'], T.splenicVein, '#3f5a9a', 'Along the back of the body and tail, receiving many short pancreatic veins.'),
    drawn(sex, 'veins', 'superior-mesenteric-vein', 'Superior mesenteric vein', [`${P}superior_mesenteric_vein`], ['cardiovascular'], T.smv, '#3f5a9a',
      'Behind the neck, in front of the uncinate process. The term is taken from the female row of the HRA crosswalk; the male row maps this node to the superior mesenteric artery (UBERON:0001182), an error in the source.'),
    drawn(sex, 'veins', 'hepatic-portal-vein', 'Hepatic portal vein', [`${P}hepatic_portal_vein`], ['cardiovascular'], T.portal, '#3f5a9a', 'Formed behind the neck by the splenic and superior mesenteric veins.'),
    drawn(sex, 'veins', 'inferior-pancreaticoduodenal-vein', 'Inferior pancreaticoduodenal vein', [`${P}inferior_pancreaticoduodenal_vein`], ['cardiovascular'], null, '#3f5a9a',
      'Drains the lower head to the superior mesenteric vein. Ontology left unmapped: the crosswalk writes the FMA identifier in an unusual form (FMA:0329299).'),
    route(sex, 'veins', 'superior-pancreaticoduodenal-veins', 'Superior pancreaticoduodenal veins', ['cardiovascular'], '#3f5a9a',
      ['pancreas-head:anterior-groove', 'pancreas-head:posterior-groove', 'hepatic-portal-vein:origin'], ['pancreas-head'], [1.0, 0.6],
      'The upper half of the venous arcades round the head, draining to the portal vein. HRA draws only the inferior vein.'),

    // 5. Neighbours, for orientation. Drawn by HRA.
    drawn(sex, 'neighbours', 'duodenum', 'Duodenum', [`${P}duodenum_superior`, `${P}duodenum_descending`, `${P}duodenum_${m ? 'horizonal' : 'horizontal'}`, `${P}duodenum_ascending`],
      ['digestive'], T.duodenum, '#b9a49c',
      `Its four parts curve round the head of the pancreas.${m ? ' The male node for the horizontal part is spelled "horizonal" in the source and is kept as it is.' : ''}`),
    drawn(sex, 'neighbours', 'duodenal-bulb', 'Duodenal bulb', [`${P}duodenal_ampulla`], ['digestive'], T.duodenalAmpulla, '#b9a49c',
      'HRA calls it the duodenal ampulla: the first widened part of the duodenum after the pylorus, not the ampulla of Vater.'),
    drawn(sex, 'neighbours', 'spleen', 'Spleen', ['hilum_of_spleen', 'gastric_surface_of_spleen', 'renal_surface_of_spleen', 'colic_surface_of_spleen', 'diaphragmatic_surface_of_spleen'].map((n) => P + n),
      ['lymphatic', 'immune'], T.spleen, '#7a3b52', 'HRA draws it as five surfaces; here they make one structure. The tail of the pancreas reaches its hilum.'),

    // 6. Lymph node stations, numbered after the Japan Pancreas Society.
    stations(sex, 'nodes-pancreaticoduodenal', 'Pancreaticoduodenal lymph nodes (stations 13 and 17)', [
      { name: '13a', label: 'Posterior, above the papilla', count: 2 }, { name: '13b', label: 'Posterior, below the papilla', count: 2 },
      { name: '17a', label: 'Anterior, above the papilla', count: 2 }, { name: '17b', label: 'Anterior, below the papilla', count: 2 }],
      'Along the arcades, behind (13) and in front of (17) the head. The eighth edition records 13 and 17 without the division above (a) and below (b) the papilla used by earlier editions; it is kept here only to spread the nodes along the arcades. They are placed on the simulated arcades, so they inherit their uncertainty.'),
    stations(sex, 'nodes-hepatic-artery', 'Nodes along the common hepatic artery (station 8)', [
      { name: '8a', label: 'Anterosuperior', count: 3 }, { name: '8p', label: 'Posterior', count: 1 }],
      'In front of and above (8a) and behind (8p) the common hepatic artery.'),
    stations(sex, 'nodes-sma', 'Nodes along the superior mesenteric artery (station 14)', [
      { name: '14', label: 'Round the root of the superior mesenteric artery', count: 3 }],
      'Round the root of the superior mesenteric artery, from its origin to the inferior pancreaticoduodenal artery. The eighth edition divides 14 by the side of a tumour (14t, 14op), which a model without a tumour cannot show. Their removal is part of resection for cancer of the head.'),
    stations(sex, 'nodes-splenic', 'Nodes along the splenic artery and at the splenic hilum (stations 10 and 11)', [
      { name: '11p', label: 'Along the proximal splenic artery', count: 2 }, { name: '11d', label: 'Along the distal splenic artery', count: 2 },
      { name: '10', label: 'At the splenic hilum', count: 2 }],
      'Along the splenic artery, proximal (11p) and distal (11d), and at the hilum of the spleen (10). They drain the body and tail.'),

    // 7. Nerves. Sympathetic, parasympathetic and sensory, which the mouse module lacks apart from the vagus.
    group(sex, 'nerves', 'coeliac-ganglia', 'Coeliac ganglia and plexus', ['nervous'], '#e9d98f', ['coeliac-trunk', 'superior-mesenteric-artery'], 2, 8,
      'Paired ganglia round the coeliac trunk, where preganglionic sympathetic fibres synapse. The target of a coeliac plexus block for pancreatic pain.'),
    route(sex, 'nerves', 'greater-splanchnic-nerves', 'Greater splanchnic nerves', ['nervous'], '#e9d98f', ['sympathetic-trunk:T5', 'sympathetic-trunk:T9', 'diaphragm:crus', 'coeliac-ganglia:centroid'], [], [1.0, 1.0],
      'From the thoracic sympathetic trunk through the crus of the diaphragm to the coeliac ganglia. They carry sympathetic efferents and the pain afferents of the pancreas. The thoracic landmarks need more of the united body model.'),
    route(sex, 'nerves', 'vagal-coeliac-branch', 'Coeliac branch of the posterior vagal trunk', ['nervous'], '#e9d98f', ['oesophagus:hiatus', 'coeliac-ganglia:centroid'], [], [0.8, 0.8],
      'Parasympathetic fibres that pass through the coeliac plexus without synapsing and end on ganglia within the pancreas.'),
    group(sex, 'nerves', 'intrapancreatic-ganglia', 'Intrapancreatic ganglia', ['nervous'], '#e9d98f', ['pancreas-head', 'pancreas-body', 'pancreas-tail'], 20, 0.5,
      'Small parasympathetic ganglia in the connective tissue between lobules. Drawn far larger than to scale so they can be seen.', R('GRAY', 'WALKER')),
  ];
}

/** The structures a viewer may build now. */
export const readyStructures = (sex: Sex) => pancreasStructures(sex).filter((s) => s.status === 'ready');

/** Every term carried by a ready or planned structure, for the ontology check in tests. */
export const mappedTerms = (sex: Sex) => pancreasStructures(sex).flatMap((s) => (s.ontology ? [s.ontology.id] : []));

/** The whole inventory as plain data, for scripts/human/export_inventory.ts and its staleness test. */
export const inventoryAsData = () => ({
  schemaVersion: 'humanbio.inventory.v1',
  note: 'Generated from src/domain/human-pancreas-structures.ts by scripts/human/export_inventory.ts. Do not edit by hand.',
  references: Object.fromEntries((['male', 'female'] as const).map((sex) => [sex, pancreasStructures(sex).map((s) => ({
    id: s.id, name: s.name, layer: s.layer, evidence: s.evidence, status: s.status, color: s.color, plan: s.plan,
  }))])),
});
