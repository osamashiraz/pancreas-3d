# Book-sourced values for the "not yet sourced" pancreas sizes

Books searched (text only; figures not seen):
- **gorelick2021**: Gorelick FS, Williams JA (eds). The Pancreas: Biology and Physiology. American Pancreatic Association / Michigan Publishing, 2021, CC BY-NC-ND 4.0. The excerpt holds front matter plus ch.1 "Anatomy and histology of the pancreas" (Daniel S. Longnecker, printed pp. 3-16) and ch.2 "Development of the pancreas" (Christopher L. Pin, Melissa Fenech, pp. 17-33). Printed page = PDF page - 11.
- **beger2023**: Beger HG et al. (eds). The Pancreas: An Integrated Textbook of Basic Science, Medicine, and Surgery, 4th ed., Wiley, 2023. Ch.2 (Longnecker & Thompson) is a revision of the Gorelick chapter, so it is NOT independent evidence. Printed page = PDF page - 16 in ch.2, -14 in ch.4-9, -12 later.
- **golson2024**: Golson ML (ed). Molecular and Cell Biology of Pancreas Development, Function and Regeneration. Advances in Anatomy, Embryology and Cell Biology vol. 239, Springer Nature Switzerland, 2024 (doi 10.1007/978-3-031-62232-8). Page numbers printed in the page headers.
- **robbins9**: Robbins and Cotran Pathologic Basis of Disease, 9th ed., Saunders 2015, ch.19 (Hruban, Iacobuzio-Donahue); used only for two numbers.
- The fifth file (PIIS0016508507011109, Gastroenterology 2007 editorial) was not relevant.

None of the three books gives cell-level sizes of the kind in the model (cell height, nucleus size, duct radii, capillary or RBC size, lobule or septum size). These books are histology/physiology/clinical texts, not morphometry. Machine-readable list: `normal_params.json` (43 entries).

## Best values found

| Parameter (model value) | Best book value | Source (PDF p / printed p) | Confidence |
|---|---|---|---|
| Organ length (12-15 cm) | 14-23 cm (Gorelick); 14-25 cm (Beger) | gorelick pdf15/p4; beger pdf25/p9 | medium-high; model is too short |
| Organ weight (80-100 g) | about 100 g | same | medium-high |
| Exocrine share of mass | >95% of mass (incl. ducts, stroma); Robbins: exocrine 80-85% of organ | gorelick pdf14/p3; robbins pdf898/p883 | medium; different definitions |
| Acinar cells % of volume | 82% acinar, 4% duct, 4% vessels, 2% endocrine, 8% matrix | beger pdf49/p35 (Petersen, ch.4) | medium; species NOT stated, cited ref is Bolender 1974 guinea pig stereology (inferred from reference list) |
| Acinar cells % of epithelial cells | >90% | beger pdf113/p99 (Furuyama & Kawaguchi) | medium |
| Ductal cells % (exocrine) | ~20% of exocrine tissue | golson pdf109/p102 | low-medium; conflicts with 4% by volume |
| Acinar cell size (height 12, base 10 µm) | only "about 20 µm diameter" cell | beger pdf52/p38 (Petersen) | low; species unstated |
| Cells per acinus (~33) | "up to several hundred" | beger pdf49/p35 | low; contradicts 33 |
| Zymogen granule diameter (1 µm) | typically ~1 µm, range 0.5-1.4 µm | gorelick pdf21/p10 (Fig 19, 22 legends) | medium-high; micrograph species not stated in legend |
| Islet diameter (mean ~110 µm) | ~70% are 50-250 µm; average 100-150 µm | gorelick pdf22/p11; beger pdf35/p19 | high |
| Number of islets (~1 million+) | 500,000-1 million; Robbins "about 1 million" | gorelick pdf23/p12; beger pdf36/p20; robbins pdf898/p883 | high |
| Endocrine fraction (1-2%) | 1-2% of pancreas | gorelick pdf23/p12 | high |
| Islet cell diameter (11 µm) | alpha and beta cells average 9-10 µm | golson pdf154/p149-150 (Golson, cites Sasaki 2021, Marchetti 2017) | medium |
| Beta / alpha / delta / PP | Dorsal-derived part: beta 75-80%, alpha ~15%, delta ~5%, PP very few. Uncinate: PP = 54-94% of islet volume, few alpha cells. Other: beta 55-70%; delta 5-10% in human | gorelick pdf24/p13; beger pdf36-37/p20-21; golson pdf100/p93, pdf147/p142 | medium-high; region-dependent |
| Pancreatic stellate cells (% cells; shape) | 4-7% of parenchymal cells; thin periacinar cells with extensions between acinar cells, lipid droplets; no size | beger pdf100/p86; gorelick pdf23/p12 (Fig 29) | medium |
| Main duct diameter ("several mm") | EUS normal MPD: head 2.4, body 1.8, tail 1.2 mm | beger pdf373/p361 (Irisawa & Yamamiya) | medium; lumen on imaging; ~1-2.5 mm, not "several" |
| Daily juice volume | about 1 L/day | beger pdf79/p65 (Owyang & DiMagno) | medium; single source |
| Duct vs acinar share of fluid | acinar fluid small volume, ducts add the bulk | beger pdf62/p48 (Lin, Sarkar, Muallem) | medium-high |
| Duct hierarchy / wall | ductule = intercalated duct; single cuboidal layer; wall thickens with size; smallest ducts lack smooth muscle | beger pdf31,33/p15,17; gorelick pdf18/p7 | high (qualitative only) |
| Centroacinar cells | pale, granule-free, less RER, many mitochondria; at acinus-ductule junction or inside tubule; no count or size | gorelick pdf20/p9; beger pdf29/p13 | high (qualitative) |
| Acinus topology | acini and tubules form an anastomosing tubular network; an acinus may be a blind end or a mid-tubule segment | beger pdf28/p12; gorelick pdf19/p8 | high |
| Binucleate acinar cells | "many", evidence from rat | beger pdf29/p13 | medium |
| Capillary / acinus | lobular capillary plexus supplies each acinus; intralobular arteries run beside ducts; islet capillaries link to acinar capillaries; no sizes | beger pdf236/p223; pdf37/p21 | medium (qualitative) |
| Arteries (gastroduodenal, PD arcades, dorsal, great, transverse) | Verified by name (see below) | beger pdf29/p13 (Fig 2.7), pdf236/p223, pdf727/p717, pdf520/p508 | medium-high |
| Lymph node stations | Node groups named in Fig 2.8; station numbers exist but are not listed in text | beger pdf30/p14, pdf28/p12; gorelick pdf17/p6 | medium (figure labels from text extraction) |

### Vessel anatomy: what the books verify
- Arterial supply is from celiac trunk and SMA; anastomoses give collateral flow (beger p.12).
- Fig 2.7 (after Hruban et al., AFIP fascicle 2007) labels: dorsal, great/greater (pancreatica magna), inferior, transverse pancreatic arteries; gastroduodenal; anterior and posterior superior and inferior pancreaticoduodenal arteries. Labels came from text extraction; confirm on the image.
- Beger p.223: splenic a. supplies body/tail by penetrating branches; GDA (from common hepatic) gives superior PD arteries to head; inferior PD arteries (from SMA) supply head and neck and anastomose with the superior ones.
- Beger p.717: transverse pancreatic a. is the left branch of the dorsal pancreatic a.; Beger p.508 mentions dorsal PD arcades.
- **Caudal pancreatic artery: not found** in any of the books. Great pancreatic (pancreatica magna): found.
- Lymph: two node systems (around pancreatic edges; along aorta/celiac trunk). Figure 2.8 groups: suprapancreatic, infrapancreatic, splenic/gastrosplenic, gastroduodenal, pancreaticoduodenal, mesenteric, hepatic, celiac, SMA, renal, middle colic. Station numbers (Japan Pancreas Society) appear only as an image in Gorelick (Fig 9); both books say they are rarely used in Western literature. The Japan Pancreas Society item in the project's unverified list is only partly addressed: the books cite it but give no station table in text.
- Gray's Anatomy is not checked by these books.

## Conflicts between and within sources
1. Organ length: model 12-15 cm; Gorelick 14-23 cm; Beger 14-25 cm (one autopsy specimen 22.5 cm).
2. Beta fraction: 75-80% (Longnecker) versus 55-70% (Golson book chapter 4). Delta: ~5% versus 5-10% in human (Golson ch.6). Region matters (uncinate is PP-rich), which the single composition in the model ignores.
3. Ductal cells: 4% of volume (Petersen, species unclear) versus ~20% of exocrine tissue (Golson ch.4). Probably volume versus cell number, but not stated.
4. Cells per acinus: model ~33; Petersen "up to several hundred" (upper bound only).
5. Islet cell diameter: model 11 µm versus 9-10 µm average for alpha and beta cells.
6. Islet number: model "~1 million+"; books say 0.5-1 million.
7. Exocrine fraction: >95% of mass (Longnecker) versus 80-85% of organ (Robbins).
8. Gorelick ch.1 and Beger ch.2 are the same author's text; do not count them as two sources.

## Not found in these books
Acinar cell height and base width; acinar nucleus diameter; acinus diameter or radius; acinar lumen size; zymogen granules per cell; centroacinar cells per acinus and their size; intercalated, intralobular and interlobular duct diameters; duct cell heights; anatomical main duct outer diameter (only EUS lumen); capillary diameter and distance to acinus; red blood cell size; stellate cell dimensions; lobule size; septum thickness; delta cell and alpha cell body size beyond 9-10 µm; RER, Golgi or mitochondria volume fractions; enzyme output per day; caudal pancreatic artery; human-specific data for the 82/4/4/2/8 volume split.

## Cautions for the project rules
- Mark the 82/4/4/2/8 split as guinea-pig-derived (inferred from the cited reference), not human.
- The Petersen ~20 µm cell and "several hundred cells" are loose statements from calcium-signalling work; use as bounds, not as parameter sources.
- Page numbers for Beger are from the PDF text split on form feeds; chapter-2 print offset checked on several pages.
