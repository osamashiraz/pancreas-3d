# Book-sourced lesion facts for the pancreas 3D model

Sources (page refs are PDF index / printed page):
- **R9** Kumar, Abbas, Aster. Robbins and Cotran Pathologic Basis of Disease, 9th ed., Elsevier/Saunders 2015. Printed page = PDF page minus 15. Pancreas = Ch 19 (printed 884-896), Endocrine = Ch 24.
- **P4** Beger et al. (eds). The Pancreas: An Integrated Textbook, 4th ed., Wiley 2023. Printed page = PDF page minus 7 to 14 depending on chapter (each fact in lesions.json carries both numbers).
- **G24** Golson (ed). Molecular and Cell Biology of Pancreas Development, Function and Regeneration, Springer 2024 (Adv Anat Embryol Cell Biol vol 239). Only the beta-cell chapter (Yong, Wang; printed 65-68) bears on disease.
- **H07** Hingorani, Gastroenterology 133:345-350 (2007). Cross-check only.

All 103 facts are in `lesions.json` (one entry per fact, paraphrased, with value, chapter, pdfPage, printedPage, confidence). Nothing here comes from outside these four texts. Evidence class for the model: these are literature descriptions, not measurements of our own geometry, so any drawn size is `simulated` or `traced` from the cited range, not `source`.

Note for CLAUDE.md rule 2: P4 contains the Japan Pancreas Society resectability table (Ch 135, Table 135.2, PDF 1057, printed 1050). It could be used to check that unverified reference; I did not verify it.

---

## 1. PanIN
Microscopic, noninvasive lesion of small ducts. Low-grade (old 1A, 1B, 2) vs high-grade (old 3). KRAS >90% even at low grade; telomere shortening earliest.

| Parameter | Value | Source |
|---|---|---|
| Size | usually <0.5 cm (macroscopically invisible) | P4 Ch126 PDF 976 / p969 |
| Duct level | small ducts / terminal ductules (periphery) | H07 p345, Table 1 p347; R9 PDF 907 / p892 |
| Location in gland | head > tail (Ch126); head = tail (Ch119 table); progresses to cancer most readily in head/uncinate (H07) | see disagreements |
| Epithelium | cuboidal to columnar, apical mucin, gastric-foveolar, flat or (micro)papillary | P4 p969 |
| 1A | flat, minimal atypia, no mitoses | P4 PDF 976-977 / p969-970 |
| 1B | micropapillary, slight nuclear stratification | same |
| 2 / "LG" | pseudostratification, loss of polarity, hyperchromasia, rare mitoses | same |
| 3 / "HG" | marked atypia, atypical mitoses, loss of polarity, papillary/micropapillary or flat; cribriform, necrosis, luminal budding | same |
| Prevalence | 82% of pancreata with PDAC, 60% with chronic pancreatitis, 16% of normal; rises with age; sexes equal | P4 p969 |
| Gene order | telomere shortening, KRAS early; CDKN2A mid; TP53, SMAD4 (BRCA2) late | R9 Fig 19-12 p892; P4 p971 |
| Mucins | MUC1, MUC4, MUC5AC positive; MUC2 negative | P4 p971 |

Drawing notes: HG-PanIN vs "cancerization" (invasive cells colonising a duct) differ by an abrupt normal-to-malignant transition within one duct (P4 p970). Mouse data (P4 Ch120 p922-924): acinar cell, acinar-to-ductal metaplasia, PanIN, PDAC; duct-origin tumors tend to skip PanIN. Not human-proven.

## 2. IPMN
Mucin-producing, papillary, intraductal; usually >=1 cm. Main-duct, branch-duct, mixed (imaging classification).

| Parameter | Value | Source |
|---|---|---|
| Size | >=1.0 cm; 0.5-1.0 cm = large PanIN or small IPMN | P4 PDF 979 / p972 |
| Location | proximal gland (head, uncinate) | P4 p972; R9 p891; H07 p346 |
| Main duct | dilated >5 mm (segmental or diffuse), thick mucus, long finger-like papillae; 5-9 mm worrisome, >=10 mm high-risk | P4 PDF 657 / p647; PDF 686 / p676; PDF 968 / p961 |
| Branch duct | cysts >10 mm, "grape-like" cluster beside a non-dilated main duct, head/neck/uncinate | P4 PDF 676 / p666; PDF 636 / p626 |
| Invasive carcinoma (pooled) | main 43.6%, branch 16.6%, mixed 45.3%; one-third of all resected | P4 p972; p962 |
| Multifocal | 10-20% (R9) or 20-40% (P4 Ch81) | see disagreements |
| Gastric subtype | monolayer columnar, basal nuclei, mucin; branch ducts; low-grade; commonest | P4 p972 |
| Intestinal subtype | villous like colonic adenoma, long papillae, cigar nuclei, goblet cells; main duct; usually HG; MUC2, CDX2; colloid carcinoma | P4 PDF 981 / p974 |
| Pancreatobiliary subtype | mucin-poor, irregular nuclei, prominent nucleoli, arborizing; HG; tubular carcinoma | P4 p974 |
| Oncocytic | now separate "IOPN": 1-5 layers eosinophilic cells, punched-out spaces, mean 4.6-6 cm, ~2/3 head, PRKACA/PRKACB fusions, no KRAS/GNAS | P4 PDF 982 / p975 |
| LG vs HG | LG: single layer, small uniform nuclei, regular papillae. HG: polarity loss, pleomorphism, cribriform | P4 PDF 969 / p962 |
| Genes | KRAS and GNAS each 50-80%; RNF43 14-75%; TP53 in HG; SMAD4 usually only once invasive | P4 PDF 980 / p973 |
| Demographics | mean ~65 y; men > women (Asia both types; West main-duct men, branch-duct women); 1.5:1 (H07) | P4 p971-972; R9 p891; H07 p346 |
| Prevalence | cysts >2% on imaging, >80% IPMN; 12.2% IPMN over age 80 | P4 p972 |
| Prognosis | 5-yr after resection 94% HG-IPMN vs 31% invasive; colloid median 107 vs 20 mo for PDAC | P4 p971; p669 |

## 3. MCN
| Parameter | Value | Source |
|---|---|---|
| Location | body/tail, >90% | P4 PDF 634 / p624; PDF 680 / p670; H07 p345; R9 p891 (tail) |
| Sex, age | women 90-95%+ (1:10-20); mean 45-48 y; perimenopausal | P4 p624, p670, p976; H07; R9 |
| Size | median 3.5-5 cm (range 0.5-20), mean 6.5 cm, range 2-35 cm | see disagreements |
| Shape | solitary round, thick wall/fibrous pseudocapsule, calcification, cyst-in-cyst; papillae/mural nodules signal malignancy | P4 p624, p976 |
| Duct link | none (key distinction from IPMN) | P4 p976, p962 |
| Epithelium | columnar mucinous, flat to tall with supranuclear mucin; LG and HG often coexist; denuded areas | P4 PDF 984 / p977 |
| Stroma | dense "ovarian" spindle cells under epithelium, ER/PR positive; luteinised cells inhibin positive | P4 p977; R9 p891 |
| Invasion | 6-25% (Ch126), 15-20% (Ch86), up to 30% (Ch125), up to one third (R9, Ch81) | see disagreements |
| Genes | KRAS, RNF43; TP53, CDKN2A in ~half of HG/invasive; GNAS absent | P4 PDF 985 / p978 |

## 4. Other cystic and solid lesions (brief)
- **Serous cystic neoplasm (serous cystadenoma)**: tail (R9) or body and tail (P4); microcystic sponge with central scar, cysts 1-3 mm (R9) to mean lesion 4-6 cm (P4); clear-cell glycogen-rich cuboidal monolayer; benign; VHL (R9 PDF 905 / p890; P4 p623, p670, p963).
- **SPN**: young women (median 30 y), mean 8 cm, solid and cystic with hemorrhage, pseudopapillae, CTNNB1 (R9 p891; P4 p671, p627, p963). Location differs (see below).
- **ITPN**: solid, noncystic, little mucin, tubular back-to-back growth, high-grade, head slight predominance, ~25% diffuse; **size not found** (P4 PDF 982-983 / p975-976).
- **Pseudocyst** (Robbins): no epithelium, 2-30 cm, lesser sac or retroperitoneum (R9 p890).

## 5. Pancreatic ductal adenocarcinoma
| Parameter | Value | Source |
|---|---|---|
| Site | head 60%, body 15%, tail 5%, diffuse 20% (R9); ~25% body/tail (P4 Ch137) | R9 PDF 908 / p893; P4 PDF 1070 / p1063 |
| Size | >4 cm in 21% head, 40% body, 51% tail; typical overall size **not found** (EUS series mean 21 mm, selected) | P4 p1063; PDF 1046 / p1039 |
| Gross | white-gray, hard, stellate, ill-defined; upstream duct dilation and atrophy | R9 PDF 909 / p894; P4 PDF 964 / p957 |
| Microscopy | haphazard glands, cuboidal-columnar pleomorphic cells with mucin, dense desmoplasia; well-differentiated mimics keep no lobular pattern | R9 p894; P4 PDF 965 / p958 |
| Stroma | dense fibrosis; activated stellate cells (CAFs) make it; stroma **percentage not found** | P4 PDF 949-950 / p942-943 |
| Perineural invasion | practically all cases; pain ~70% | P4 p958; PDF 990 / p983; R9 p894 |
| Bile duct | head tumors obstruct distal CBD: biliary dilation ~50%, most jaundiced; body/tail silent | R9 p894; P4 p983 |
| Vessels | portal vein, celiac, SMA near; contact >180 degrees SMV/PV borderline; SMA >180 locally advanced; 30-40% locally advanced at diagnosis | P4 p983; PDF 1071 / p1064; PDF 1044 / p1037 |
| Nodes, spread | peripancreatic, gastric, mesenteric, omental, portohepatic nodes; liver and lungs; para-aortic nodes 16-26% head, 13-17% body/tail; 40-50% metastatic at diagnosis | R9 p894; P4 PDF 1058 / p1051; p1037 |
| Genes | KRAS 90-95%; CDKN2A 90-95%; TP53 ~50-75%; SMAD4 ~55%; MSI 2-3% | R9 PDF 908 / p893; P4 PDF 920-921 / p913-914 |
| Imaging | upstream atrophy, abrupt duct cutoff, double duct sign | P4 PDF 1006, 1011 / p999, p1004 |
| Survival | 5-yr <5% (R9, 2013 data); ~10% (P4); resected 15-25%; localized 39%, regional 13%, distant 3% | R9 p892; P4 p899, PDF 1040 / p1033 |
| Cell types | ~70% acinar, 18.5% ductal in gland; cell of origin acinar via PanIN (mouse), ductal possible | P4 PDF 928 / p921 |

## 6. Pancreatic neuroendocrine tumours
Anywhere in the gland; size 0.5-20 cm; insulinomas usually <2 cm, nonfunctioning larger; well circumscribed, tan, sometimes cystic; ~2% of pancreatic neoplasms (R9) or <3% (P4); insulinoma <10% malignant, gastrinoma and most others >50%; functioning <40%. (R9 PDF 1136 / p1121; P4 PDF 771-773 / p763-765; PDF 761-763 / p753-755.) **Head/body/tail percentages not found.**

## 7. Acute pancreatitis
| Parameter | Value | Source |
|---|---|---|
| Types | interstitial edematous 90-95%; necrotizing 5-10% | P4 PDF 177 / p164 |
| Causes | biliary + alcohol ~80%; gallstones in 35-60%; alcohol 65% US, 20% Sweden, <=5% S. France/UK; only <=5% of heavy drinkers get it | R9 PDF 899 / p884; P4 PDF 120 / p107 |
| Mechanism | duct obstruction, acinar injury, faulty proenzyme transport; trypsin activates other zymogens; lipase causes fat necrosis | R9 PDF 900 / p885 |
| Fat necrosis | fatty acid + calcium soaps, granular blue; tiny (<10 mm) in mild, large confluent in severe; >5 cm may wall off by 20-30 days | R9 PDF 902 / p887; P4 PDF 178-179 / p165-166 |
| Hemorrhage | red-black gland when vessel walls/veins damaged | R9 p887; P4 p165 |
| Outcome | ~5% severe cases die in week 1; 40-60% of necrosis infected | R9 p887 |
| Genes | PRSS1, SPINK1, CFTR, CASR, CTRC, CPA1 | R9 PDF 901 / p886 |

## 8. Chronic pancreatitis
Fibrosis and acinar dropout with irregular firm gland; duct dilation from strictures and stones (~50% have stones, ~100% by 14 y); calcified protein plugs in alcoholic type; islets relatively spared early, embedded in scar, lost late; stellate cells (4-7% of parenchymal cells) activate to myofibroblasts. Causes: alcohol (commonest), obstruction, autoimmune, hereditary (genes PRSS1 dominant, SPINK1 recessive, CFTR, CTRC; up to 25% genetic). Cancer risk: pooled RR 12 (definite CP), 69 (hereditary); 4% cumulative at 20 y; R9 quotes 40% lifetime for hereditary. Diabetes in 70%. (R9 PDF 903-904 / p888-889; P4 PDF 436-439 / p424-427; PDF 493 / p481; PDF 100-101 / p86-87; PDF 387-388 / p375-376; PDF 113 / p99.)

## 9. Diabetes
| Parameter | Value | Source |
|---|---|---|
| T1D beta mass | >90% destroyed when classic symptoms appear (R9); mass reduced by >90% at onset (G24); "up to 90%" in table | R9 PDF 1125 / p1110; G24 PDF 73 / p66; PDF 72 / p65 |
| T1D immune | CD8+ cytotoxic T cells and TH1 cytokines; insulitis mostly T cells, uneven; autoantigens insulin, GAD, ICA512 | R9 p1110; PDF 1132 / p1117 |
| T1D islets | fewer, smaller islets | R9 p1117 |
| T2D islets | amyloid in >90% of islets of long-standing disease; begins around capillaries; late obliteration and fibrosis; made of IAPP | R9 PDF 1127 / p1112; PDF 1132 / p1117; PDF 275 / p260 |
| T2D beta loss | 24-65%; smaller islets; dedifferentiation up ~3-fold (human) | G24 PDF 75 / p68 |
| Exocrine | pancreas ~45% smaller in T1D; low fecal elastase-1 in 31.8% (T1D 37.7%, T2D 26.2%) | P4 PDF 112-113 / p98-99 |

---

## Disagreements between sources
1. **PanIN location**: P4 Ch126 says head more than tail (p969); P4 Ch119 table says head = tail (p916); H07 says progression is most ready in head/uncinate. Use head-weighted, flag as uncertain.
2. **PDAC site**: R9 gives head 60%, body 15%, tail 5%, diffuse 20%; P4 Ch137 says ~25% body/tail. P4 does not give a head percentage.
3. **PDAC genes**: CDKN2A 95% (R9) vs ~90% (P4); TP53 70-75% in R9 text, 50-70% in R9 table, ~75% in P4. KRAS 90-95% vs >90%.
4. **PDAC survival**: <5% (R9, 2013) vs ~10% (P4, 2023); a period difference, not a conflict.
5. **MCN size**: median 3.5-5 cm and range 0.5-20 (Ch126), range 2-35 (Ch81), mean 6.5 (Ch86). **MCN invasive rate**: 6-25%, 15-20%, up to 30%, up to one third.
6. **IPMN multifocality**: 10-20% (R9) vs 20-40% (P4 Ch81). **IPMN invasion by type** also varies: 43.6/16.6/45.3% (Ch126) vs 11-81% main and 6-38% branch (Ch86) vs 30-50% main and 24% branch (Ch81).
7. **Serous cystic neoplasm site**: tail (R9) vs body and tail (P4). **SPN site**: equal head/body/tail (P4 Ch125) vs tail most frequent, 60% body/tail (P4 Ch86).
8. **IPMN size threshold**: "usually >=1 cm" (Ch126) vs branch-duct cysts ">10 mm" (Ch86); consistent but note 0.5-1.0 cm overlap zone.
9. **Acute pancreatitis initiating lesion**: R9 stresses primary acinar injury and premature intracellular trypsin activation; P4 Ch17 (Kloppel) states acinar necrosis as the first lesion is not proven in alcohol/gallstone disease and fat necrosis dominates. For drawing, show fat necrosis and edema as the histologic findings; show trypsin activation only as the proposed mechanism.
10. **Hereditary pancreatitis cancer risk**: 40% lifetime (R9 text) vs 25-40% by age 70 (R9 Table 19-4) vs RR 69 (P4 Ch61).
11. **T1D beta loss**: ">90% at classic presentation, after a long lag" (R9) vs "at onset" (G24, and its own table says up to 90%).

## Not found (honest list)
- R9 gives no grade-by-grade PanIN cytology, PanIN size, prevalence, or IPMN/MPD millimetre thresholds, and no MCN size range. Those come from P4.
- Percentage of PDAC volume that is stroma: not found in any text.
- Typical overall PDAC size at diagnosis: not found (only body/tail >4 cm fractions and one selected EUS series).
- Numeric SMV/portal vein or SMA involvement rate other than 30-40% locally advanced: not found. Liver metastasis percentage specifically: not found (only 40-50% metastatic overall, and by site).
- ITPN size: not found. Head/body/tail split for PanNET: not found (all parts).
- % of T1D islets with insulitis, CD8 vs CD4 proportions: not found; R9 only names the cell types.
- IAPP wording for type 2 islet amyloid is in R9 only in the amyloidosis chapter (printed page of the table PDF 274 inferred as 259).
- G24 has nothing on PanIN, PDAC or pancreatitis morphology (its chapters are developmental); only the beta-cell chapter was used.
- Gray's Anatomy 42nd ed.: not covered by these texts.
