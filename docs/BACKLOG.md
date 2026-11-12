# Backlog

## Open issues
1. Some nuclei in cut acinar cells render as rings rather than solid dots (cause not found; cut-face shading works for cells and islet nuclei).
2. The 4 mm piece in Cell types colours was not visually checked (same code path as the acinus, which was).
3. Narration voice depends on the browser: Google UK English Female exists only in Chrome; others fall back (Microsoft Sonia/Libby, Google UK English Male, Daniel/Serena/Kate). Audio was never testable in headless runs.
4. Islet | Acinus split preset: in software rendering, the islet half was still in flight when checked; Beta cell | Acinar cell was confirmed.
5. Organ slices show hollow shells (HRA meshes have no interior); capping not done.
6. Verify two citations against the books: Gray's Anatomy 42nd ed. (vessel anatomy), Japan Pancreas Society classification (lymph node stations).
7. Report the HRA crosswalk error (male superior mesenteric vein mapped to UBERON:0001182, the artery).

## Next steps (agreed or proposed)
- Integrate the zoom viewer into MouseBio_3D's React app (it is standalone now; the repo already has loaders and data).
- Marker genes on click from the ASCT+B table (CPA1, PRSS1 for acinar; KRT19, CFTR for duct; INS, GCG, SST, PPY).
- Disease states: type 1 diabetes (beta-cell loss), type 2 (reduced beta cells, head preferentially; Wang 2013), PanIN in ducts, pancreatitis, fibrosis.
- Overlay user data (single-cell, spatial, CODEX) onto cell types.
- Secretion in motion: exocytosis, bicarbonate flow, glucose-stimulated insulin release.
- Nerves (coeliac plexus, splanchnic, vagal, intrapancreatic ganglia) — needs more of the HRA body model.
- Superior pancreaticoduodenal veins, minor papilla.
- Measured human sizes to replace not-yet-sourced values (stereology literature, electron microscopy full texts).
- Alpha and delta cells at cell level; measuring ruler; image and video export; shareable links to a stage.
