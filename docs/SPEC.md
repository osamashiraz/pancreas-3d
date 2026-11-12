# Specification — Human pancreas 3D, from organ to cell

## 1. Purpose

A source-grounded, explorable 3D model of the human pancreas for teaching and research communication, built as a module of MouseBio_3D and as a standalone zoom viewer. A user can move continuously from the whole organ (about 15 cm) to a 4 mm piece of tissue, a 300 µm block, a single acinus, islet or duct, their separated cells, and one cell with its organelles, at true scale, in H&E or cell-type colours, with narration. Every element states what it rests on: drawn from the Visible Human (via HRA), or simulated by a written rule from published measurements.

## 2. Architecture

- **Repo module** (`repo/`, installed into MouseBio_3D): TypeScript domain data (inventory, circuits, tissue levels, generators), a loader using MouseBio_3D's checksum-bounded fetch, tests, Python builders, and model data under `public/atlas-human/`.
- **Standalone viewer** (`viewer/`, built to `dist/pancreas-organ-to-cell.html`): one self-contained HTML page (about 8 MB, under the 16 MB publishing limit) with three.js r147 from jsDelivr, the region model, islet distribution and three tested tissue blocks embedded, and the TypeScript generator compiled to `window.HPGen` so further sites are generated in the browser. The viewer is not yet integrated into MouseBio_3D's React app (see the backlog).
- **World**: one coordinate system in micrometres. The chosen tissue site in the organ is the origin; the tissue block is centred there; finer levels sit inside coarser ones at true scale.

## 3. Organ level (`src/domain/human-pancreas-structures.ts`)

- Source: HRA 3D Reference Object Library v2.0 (CC BY 4.0), male and female, from the Visible Human Project. `scripts/human/extract_pancreas_region.py` copies 29 named nodes per sex unchanged from the united body models into `pancreas-region-<sex>.glb` (positions verified by per-node SHA-256).
- Inventory: 38 structures per sex. Ready: 22 drawn by HRA (head, uncinate, neck, body, tail; main and accessory ducts, bile duct, ampulla, sphincter; coeliac trunk, common and proper hepatic, splenic and superior mesenteric arteries; splenic, superior mesenteric, portal and inferior pancreaticoduodenal veins; duodenum, duodenal bulb, spleen), 6 simulated vessel structures (gastroduodenal artery; superior and inferior pancreaticoduodenal arteries forming anterior and posterior arcades; dorsal and transverse, great and caudal pancreatic arteries), 4 simulated lymph node groups (21 nodes per body; Japan Pancreas Society stations 8a, 8p, 10, 11p, 11d, 13a, 13b, 14, 17a, 17b). Planned: minor papilla, superior pancreaticoduodenal veins, four nerve structures.
- Simulated vessels (`place_simulated.py`): landmarks defined by written rules (recorded with their points in `pancreas-simulated.manifest.json`); each leg is the cheapest path through a 0.75 mm grid that forbids entering any drawn structure and prefers lying radius + 0.6 mm off the followed surface; smoothed; tubes with parallel-transport frames. Tests: no contacts, no step over 1 mm, no turn over 75°, arcades close.
- Lymph nodes: per-station anchor rules and preferred side; each node at the nearest free spot; deviations recorded.
- Circuits (`human-pancreas-circuits.ts`): 14 schematic routes for supply, drainage, lymph and nerves.
- Ontology (`data/human-pancreas-ontology-candidates.json`): UBERON/FMA/CL terms copied from HRA; known errors listed (male SMV mapped to the SMA term; papilla of Santorini given the accessory duct's term; malformed FMA id; misspelt node names).

## 4. Islet distribution and gross level

- `build_islet_distribution.py`: organ volume from the voxelized union of the five regions (77.2 cm³ male, 84.1 cm³ female; Hahn et al. give about 73 cm³); islet count = 1.5% endocrine fraction × volume ÷ volume of a 110 µm islet (1.66 and 1.81 million); density in tail twice head and body (Wang et al. 2013); 40% in dense peripheral clusters at three times the density (Hahn et al. 2021). Assumed: cluster sizes 100–400, periphery depth 3 mm.
- Gross level (viewer): a 4 mm piece per site with Voronoi lobules (seeds about 1.25 mm apart, 50 µm septa; assumed). Default view, the duct tree: faint lobule outlines; interlobular ducts along the minimum spanning tree of septal points, each segment bent onto the septum between the two nearest lobules and smoothed (Chaikin), the longest path being the large interlobular duct (80 µm radius) with an artery and vein beside it; an intralobular duct from the nearest point of that network to each lobule's centre, branching (6-8 primary branches) into terminal (intercalated) ducts (4-6 each) ending in clusters of acini (drawn sparser than real so the ducts show); islets at the region's density with lognormal sizes about 110 µm. Calibres assumed: interlobular 26-45 µm, intralobular 11-14 µm, terminal 7 µm radius. Alternative view (switch): solid lobules like an H&E section, connective tissue filling the septa, thick-section islets near the cut. A comparison view sets head, body and tail side by side.

## 5. Tissue block (300 µm)

- Python builder `build_tissue_block.py <region>` (tested blocks for body, head, tail) and TypeScript generator `generateBlock(seed, region)` (any seed; about 5 s in the browser), same rules:
  - intralobular duct tree by space colonization, tapering by Murray's law;
  - acini (13–19 µm radius) budding in grape-like clusters (CODA) on their own intercalated ducts, then a grid pass filling remaining pockets; no anastomoses (Endo 2002, rat);
  - capillaries: minimum spanning tree plus loops through free space; every acinus within 6 µm;
  - stroma: collagen aligned along ducts (CODA), interstitial fibres, stellate cells;
  - deformation: each acinar cell reaches out until a neighbouring acinus's power-diagram territory, a capillary, a duct, the islet or the edge (packing about 52%);
  - one islet per block.
- Islets: `build_islet.py` (representative, 110 µm, 346 cells, HRA composition, Cabrera's 71% heterotypic contact met by random intermixing) and `generateIslet(seed)` (lognormal size about 110 µm, sigma 0.3 assumed; composition drawn about HRA's average with an assumed spread, reflecting Brissova 2005; ellipsoidal, 15% axis jitter assumed).

## 6. Viewer features (`viewer/src/app.js`)

- Continuous zoom from organ to cell, with levels fading in and out by distance and the camera target drifting to the chosen structure; stages below the tissue (structure alone, its cells separated, one cell) hold with hysteresis so one can zoom out well before stepping back; Esc steps back.
- Three branches: acinus (with its intercalated duct and the ducts it drains into) → separated orange-segment acinar cells → acinar cell (rough ER, Golgi, zymogen granules, mitochondria); islet → separated islet cells → beta cell (insulin granules as dense cores in halos, primary cilium, beside a capillary); intralobular duct (with its collagen) → separated duct cells → duct cell (microvilli, primary cilium, tight junctions, CFTR and SLC26A6 markers, basement membrane).
- Sixty tissue sites (20 per region; the first per region the tested block, others generated from seeds), shown as dots; 25 acini and 25 ducts per block chosen by farthest-point sampling; islets differ per site; pickers step through them.
- Stain: H&E (default; hematoxylin purple bases, eosin pink apices, red granules, pale islets with uniform nuclei, pink collagen; cut cells filled with their stain; stain-like grain) or Cell types (multiplex-immunofluorescence colours on a dark ground: acinar orange, duct teal, beta green, alpha magenta, delta cyan, PP amber, capillaries red, stellate yellow, collagen lavender, nuclei blue).
- Cut open (off by default): a cutaway facing the viewer through the point being zoomed into (ducts opened lengthwise).
- Slice apart: organ into eight transverse slices, block into six serial sections, with spacing knob.
- Split screen: two independent views; presets Islet | Acinus, Islet | Duct, Acinus | Duct, Beta cell | Acinar cell, Tissue | Cell, Organ | Tissue.
- Play the journey: 13 narrated steps (text paraphrased from StatPearls and histology teaching sources), professional English voices only (Google UK English Female by default), adjustable speed (0.88× default), sentence-by-sentence pacing; continues while the user interacts; Stop ends it.
- Names on structures, click to identify with isolate and opacity, illustrative red cell flow, scale bar, regions and compare view, faint surroundings option.

## 7. Acceptance checks

- `npx tsx --test tests/human-pancreas.test.ts`: 23 tests (inventory, registries, extraction, simulated vessels and nodes, islet model and distribution, tissue blocks per region, generators, ontology).
- Full MouseBio_3D suite passes with the module (699 at handover).
- `viewer/build_viewer.py` reproduces `dist/` byte for byte from sources; `viewer/test/smoke.py` loads the page and visits each branch without page errors.

## 8. Data sources (details and DOIs in `docs/SOURCES.md`)

HRA 3D reference organs and ASCT+B table; Visible Human Project; Hahn 2021; Wang 2013; Cabrera 2006; Brissova 2005; Poudel 2016; Reers 2009; Kiemen 2022 (CODA); Endo 2002; Beer 2016; Messenger 2014; Nadelhaft 1973; Ermak and Rothman 1981; Berclaz 2016; Palade 1975; Steward and Ishiguro 2009; Ishiguro 2012; Hegyi and Rakonczay 2015; diIorio 2014; StatPearls anatomy and endocrine chapters; Columbia and Basel histology notes; Human Protein Atlas.

## 9. Not yet sourced (marked in code)

Acinar cell height and base, acinar nucleus size, acinus radius range and lumen, centroacinar size and number, intra-acinar duct length, duct radii and cell heights, capillary radius and reach, red cell and stellate cell sizes, islet cell diameter, islet size spread, composition spread and shape jitter, lobule size and septum thickness, cluster sizes and periphery depth, organelle sizes and numbers. Unverified citations: Gray's Anatomy 42nd ed.; Japan Pancreas Society classification (lymph node stations).
