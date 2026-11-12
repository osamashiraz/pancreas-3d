# Human pancreas module

This module is the first organ of a human counterpart to MouseBio_3D. It keeps the mouse project's rule that every structure says what it rests on, and adds a `status` field, so the inventory can list planned structures without the viewer ever showing them as if they existed.

## Files

`src/domain/human-pancreas-structures.ts` is the inventory, built per sex: 38 structures for each of the male and female references, of which 32 are ready: 22 drawn by HRA, 6 simulated vessels and 4 simulated lymph node groups. `src/domain/human-pancreas-circuits.ts` holds 14 schematic routes for blood, lymph and nerves. `src/viewer/human-pancreas-loader.ts` builds the ready structures through the repo's own checksum-checked `fetchBoundGlb`. `scripts/human/extract_pancreas_region.py` makes the model files in `public/atlas-human/` from the HRA united body models, and writes `pancreas-region.manifest.json`. `scripts/human/export_inventory.ts` writes the inventory as plain data to `data/human-pancreas-inventory.json`, and `scripts/human/place_simulated.py` reads it to build the simulated vessels and lymph nodes into `pancreas-simulated-<sex>.glb`, with `pancreas-simulated.manifest.json`. `data/human-pancreas-ontology-candidates.json` holds the UBERON, FMA and CL terms copied from HRA, with the errors found in HRA's files listed. `tests/human-pancreas.test.ts` checks all of these against each other.

## Sources and how the models are made

The HRA 3D Reference Object Library (ccf-releases v2.0, commit b036a91, CC BY 4.0) draws the pancreas, its ducts, the trunk vessels, the duodenum and the spleen as named nodes in two united body models, one from the Visible Human Male and one from the Visible Human Female. The extraction script refuses either united file if its SHA-256 differs from the recorded value, then copies the position, normal and index bytes of 29 named nodes unchanged. Every one of those nodes has an identity world transform, so the coordinates stay in the HRA frame, in metres. The manifest records the SHA-256 of each node's positions, which is the same in source and output, and the test suite confirms the output files match the registry.

The result is 3.4 MB for the male and 1.7 MB for the female, against 154 MB and 212 MB for the united models.

## Evidence and status

A `source` structure is one or more HRA nodes used as drawn. A `simulated` structure is placed by rule where no source draws it. A `traced` kind is reserved for vessels too fine for HRA, to be segmented from the Visible Human images.

Six simulated vessels are built, eleven tubes per body: the gastroduodenal artery; the superior and inferior pancreaticoduodenal arteries, which form the anterior and posterior arcades round the head; the dorsal pancreatic artery with its transverse branch; the great pancreatic artery; and two caudal pancreatic arteries. Four groups of lymph nodes are built, 21 nodes per body at stations 8a, 8p, 10, 11p, 11d, 13a, 13b, 14, 17a and 17b. Six structures remain planned: the minor papilla, the superior pancreaticoduodenal veins, and four nerve structures.

## How simulated vessels are placed

Each route in the inventory lists branches, each a sequence of named landmarks, and the structures whose surface it follows. Every landmark name must be defined in the `LANDMARKS` table of `place_simulated.py` with a rule in words; an undefined name stops the build. The manifest records each rule beside the point it resolved to. A landmark on a surface is placed once, lifted off that surface by the vessel's radius plus 0.6 mm and moved clear of other structures, so every branch that uses it meets at the same point: this is how the superior and inferior arteries close the arcades.

The rules for the head are these. The gastroduodenal artery leaves the common hepatic artery where the proper hepatic artery continues, and divides on the most anterior point of the head or neck 25 mm lower, its typical length. The arcades pass through points on the front and back of the head 3 to 12 mm from the curve of the duodenum, at three heights. The inferior arteries leave the superior mesenteric artery 5 mm above the lowest point of the uncinate process and pass that point.

Each leg between two landmarks is the cheapest path through a grid of 0.75 mm cells. A cell is forbidden if it lies inside the followed organ, inside another drawn structure, or nearer to one than the vessel's radius plus clearance; it costs more the farther it lies from that distance off the followed surface. So the vessels follow the head and never pass through the bile duct, portal vein or duodenum; the tests require this, and also that no branch has a gap over 1 mm or a kink over 75 degrees. The build is deterministic.

The branches of the splenic artery start at its axis beside where each enters the gland: the dorsal artery 12 mm from the coeliac trunk, then down behind the neck and along the lower back border of the body; the great artery into the back of the body at its middle; the caudal arteries into the back of the tail at 35% and 70% of its length. The male great pancreatic artery is only 4.7 mm long because in that body the splenic artery runs along the back of the body at mid-height; it enters the gland almost at once.

The female gastroduodenal artery lies on average 9 mm off the head rather than 2, because in that body the common hepatic artery lies 17 mm above the head and the artery crosses open space to reach it. That is a property of the specimen, not an error.

## How lymph nodes are placed

Each station in the inventory names how many nodes it has; its rule is in the `STATIONS` table of `place_simulated.py`, and an undefined station stops the build. A rule gives anchors beside a vessel (the drawn common hepatic, superior mesenteric and splenic arteries, the splenic vein at the hilum, or the simulated arcades for stations 13 and 17) and a preferred side. Each node, an ellipsoid of 2.5 by 2.5 by 3.5 mm semi-axes with its long axis along the vessel, goes at the nearest free spot: first the preferred side, then turning round the vessel and moving outward, then the next anchor along the vessel. Free means at least 0.5 mm from every drawn structure, every simulated vessel and every node already placed. The manifest records each node's anchor, how far it turned and how far it moved out, so a node that had to move far from its station's usual place is visible; the viewer shows this too. The stations follow the Japan Pancreas Society numbering, whose citation is still marked unverified.

## Known limits

The HRA meshes are not closed surfaces, so no volume may be computed from them. The front and left directions of the HRA frame are inferred from the glTF convention and from where the tail lies, not stated by the source. The male and female organs differ in length (111 and 172 mm) because they are two people, not because of sex. Two references in `REFS`, Gray's Anatomy and the Japan Pancreas Society classification, are marked unverified, and a test fails if that list changes without review.

## Tissue levels

See `human-pancreas-tissue.md`: the representative islet and the islet distribution are built; the acinus, lobule and cells are planned.

## Running

`python3 scripts/human/extract_pancreas_region.py <dir with unpacked united GLBs> public/atlas-human` rebuilds the models (needs numpy). After changing the inventory, run `npx tsx scripts/human/export_inventory.ts`, then `python3 scripts/human/place_simulated.py` (needs numpy and scipy), then copy the byte counts and checksums it prints into the registry in `src/viewer/human-pancreas-loader.ts`; the tests fail until all three agree. The build takes several minutes; run it in the background if your shell has a time limit. `python3 scripts/human/build_islet.py` rebuilds the islet and `python3 scripts/human/build_islet_distribution.py` the distribution. `npx tsx --test tests/human-pancreas.test.ts` runs the module's 19 tests. The build is deterministic: rerunning it gives identical files.
