/** Original integration code: MIT.
 *
 * The tissue levels of the human pancreas module: what exists, what it rests on, and what is planned.
 * Below about 0.1 mm there are no Visible Human data, so every level here is a model built from published
 * measurements (evidence 'simulated'), never a picture of this person's tissue. Each parameter names its
 * source, or says plainly that it has none yet.
 */

export type TissueLevelStatus = 'ready' | 'planned';

export interface TissueLevel {
  readonly id: string;
  readonly name: string;
  readonly scale: string;
  readonly status: TissueLevelStatus;
  readonly description: string;
}

/** From the organ down. The organ level is the HRA geometry; everything below it is modelled. */
export const TISSUE_LEVELS: readonly TissueLevel[] = Object.freeze([
  { id: 'organ', name: 'Organ', scale: 'about 15 cm', status: 'ready', description: 'The HRA reference organ with ducts, vessels, simulated arcades and lymph node stations.' },
  { id: 'islet-distribution', name: 'Where the islets are', scale: 'centimetres', status: 'ready',
    description: 'About 1.7 million islets placed through the organ: density similar in head and body, twice as high in the tail (Wang 2013), 40% in dense clusters near the surface (Hahn 2021). Built by scripts/human/build_islet_distribution.py; one point is stored per 100 islets.' },
  { id: 'lobule', name: 'Tissue block inside a lobule', scale: '300 µm', status: 'ready',
    description: 'An intralobular duct tree ramifying through the block, intercalated ducts each ending in one rounded acinus, centroacinar cells inside each acinus, capillaries and stroma between the acini, and an islet among them. Built by scripts/human/build_tissue_block.py.' },
  { id: 'islet', name: 'Islet of Langerhans', scale: '110 µm', status: 'ready',
    description: 'A representative human islet: beta, alpha, delta and PP cells intermixed along capillaries, built by scripts/human/build_islet.py.' },
  { id: 'acinus', name: 'Acinus and intercalated duct', scale: '26 to 38 µm', status: 'ready',
    description: 'Wedge-shaped acinar cells converging on a narrow lumen like orange segments, centroacinar cells lining the intra-acinar duct, and the intercalated duct leaving it. Cell dimensions are typical values not yet sourced.' },
  { id: 'cell', name: 'Cells', scale: 'about 10 µm', status: 'ready', description: 'An acinar cell along the secretory pathway, and a beta cell with insulin granules beside a capillary; organelle sizes and numbers illustrative.' },
]);

/** Islet cell types, with the Cell Ontology terms of the HRA ASCT+B table for the pancreas. */
export const ISLET_CELL_TYPES = Object.freeze({
  beta: { name: 'Beta cell', cl: 'CL:0000169', clLabel: 'type B pancreatic cell', hormone: 'insulin', color: '#4f86c6' },
  alpha: { name: 'Alpha cell', cl: 'CL:0000171', clLabel: 'pancreatic A cell', hormone: 'glucagon', color: '#d6604d' },
  delta: { name: 'Delta cell', cl: 'CL:0000173', clLabel: 'pancreatic D cell', hormone: 'somatostatin', color: '#5aae61' },
  pp: { name: 'PP cell', cl: 'CL:0002275', clLabel: 'pancreatic PP cell', hormone: 'pancreatic polypeptide', color: '#9970ab' },
});
export type IsletCellType = keyof typeof ISLET_CELL_TYPES;
/** Epsilon cells (CL:0005019, ghrelin) are in the ASCT+B table but so rare in the adult that the HRA unit draws none; neither does the model. */
export const OMITTED_CELL_TYPES = Object.freeze(['CL:0005019']);

/** The registered islet model, from public/atlas-human/islet-representative.manifest.json. */
export const ISLET_ASSET = Object.freeze({ url: '/atlas-human/islet-representative.glb', bytes: 1001452, sha256: 'c4f780db9b366ee08e92ec99060211fe9d127648ec170efec27dd7355a6ffd27' });

/** The islet distribution samples, one point per 100 islets, from public/atlas-human/islets.manifest.json. */
export const ISLET_DISTRIBUTION_ASSETS = Object.freeze({
  male: { url: '/atlas-human/islets-male.glb', bytes: 200524, sha256: 'fec4aa19404cf4c1932efaba494b34b39fabe14b75347ed0565335e36a11f023' },
  female: { url: '/atlas-human/islets-female.glb', bytes: 218564, sha256: '6fe9d77d2d6d374cce53269619c4fd18d8ae6794d050ccf7c94d581092b879d9' },
});

/** The tissue block layout, from public/atlas-human/tissue-block.json (micrometres). */
export const TISSUE_BLOCK_ASSET = Object.freeze({ url: '/atlas-human/tissue-block.json', bytes: 1017829, sha256: '87aba14b6c217c561aeeff6fbb42146921ae9a9a57871857733a6279e0478b66' });
/** Exocrine cell types in the block, with Cell Ontology terms of the HRA ASCT+B table. */
export const EXOCRINE_CELL_TYPES = Object.freeze({
  acinar: { name: 'Acinar cell', cl: 'CL:0002064', clLabel: 'pancreatic acinar cell' },
  centroacinar: { name: 'Centroacinar cell', cl: 'CL:0002080', clLabel: 'pancreatic centro-acinar cell' },
  ductal: { name: 'Duct cell', cl: 'CL:0002079', clLabel: 'pancreatic ductal cell' },
});

/** One tissue block per region, each built independently by scripts/human/build_tissue_block.py <region>. The body block is TISSUE_BLOCK_ASSET. */
export const TISSUE_BLOCK_REGION_ASSETS = Object.freeze({
  body: { url: '/atlas-human/tissue-block.json', bytes: 1017829, sha256: '87aba14b6c217c561aeeff6fbb42146921ae9a9a57871857733a6279e0478b66' },
  head: { url: '/atlas-human/tissue-block-head.json', bytes: 1116983, sha256: '732629a39a5652840a746aaa6b249f366a4ab5e76702725549569c70d92c884c' },
  tail: { url: '/atlas-human/tissue-block-tail.json', bytes: 994299, sha256: 'e59be29f856782ee28aa7a4c555f46e93c5bf3e5d9050835af2f8414151cdefa' },
});
