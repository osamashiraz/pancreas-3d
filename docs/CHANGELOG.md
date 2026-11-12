# How the project got here (summary)

1. Organ: HRA reference pancreas regions; inventory with evidence levels and statuses; ontology copied from HRA with errors listed.
2. Extraction of ducts, vessels, duodenum and spleen from the HRA united models, bytes unchanged; loader through the bounded fetch.
3. Simulated vessels on landmark rules; grid shortest-path routing replaced point pushing after contacts and kinks; arcades close.
4. Splenic branches and lymph node stations with nearest-free placement.
5. Representative islet calibrated to Cabrera's 71% (random intermixing suffices once cells pack as tissue); islet distribution through the organ.
6. Tissue block: tube acini (21%) → rounded acini → overlap bug found (reported 66% was false) → fill pass → deformation by power diagram (52%).
7. Viewer: organ-to-cell zoom → continuous nested zoom → stages with hysteresis → structure alone, cells separated, one cell → duct branch → slice apart, names, picking, motion, journey → regions and gross level → 60 sites and generated blocks/islets → split screen, voice → 3D H&E with cut-face fill and stain grain → cell-type stain for all structures → professional voices, narration from StatPearls and histology sources, journey continues during interaction, cut open off by default. → lobule level shows the duct hierarchy (large, interlobular, intralobular, terminal ducts) with acinar clusters and scattered islets.
