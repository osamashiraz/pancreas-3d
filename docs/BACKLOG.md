# Backlog

## Open issues
1. Some nuclei in cut acinar cells render as rings rather than solid dots (cause not found; cut-face shading works for cells and islet nuclei).
2. The 4 mm piece in Cell types colours was not visually checked (same code path as the acinus, which was).
3. Narration offers Google UK English Female (default) and Male, which exist only in Chrome; other browsers fall back to standard UK narrators (Microsoft Sonia/Libby/Ryan, Apple Daniel/Serena/Kate). Audio was never testable in headless runs.
4. Islet | Acinus split preset: in software rendering, the islet half was still in flight when checked; Beta cell | Acinar cell was confirmed.
5. Organ slices show hollow shells (HRA meshes have no interior); capping not done.
6. Verify two citations against the books: Gray's Anatomy 42nd ed. (vessel anatomy), Japan Pancreas Society classification (lymph node stations).
7. Report the HRA crosswalk error (male superior mesenteric vein mapped to UBERON:0001182, the artery).

8. Layers opened in place: turning the view far from the line going in while deep in the opening looks into the wall of the lobule column (as in MouseBio_3D); names behind that wall are hidden. Around 2 mm from the site the duct tree near the line can crowd the view (the large interlobular duct may pass close to it).

9. Marker data (`repo/data/human-pancreas-markers.json`) was extracted by one-off scripts (provenance, URLs and checksums are in the file); add a builder script to reproduce it from the pinned ASCT+B file and the HPA release.
10. HPA lumps human islet endocrine cells; beta and alpha HPA lists come from bulk-derived cell-type enrichment intersected with the islet list and are noisy. Delta granule size: Brereton 2015 legend and text disagree (drawn at 250 nm, as the text). Primary sources for delta-cell process length (Grube & Bohn 1983; Baskin 1984) not checked.
11. Secretion in motion is not yet shown at the islet level (hormones into the islet capillaries) or as glucose-dependent switching between insulin and glucagon.

## Next steps (agreed or proposed)
- Disease states: type 1 diabetes (beta-cell loss), type 2 (reduced beta cells, head preferentially; Wang 2013), PanIN in ducts, pancreatitis, fibrosis.
- Overlay user data (single-cell, spatial, CODEX) onto cell types.
- Nerves (coeliac plexus, splanchnic, vagal, intrapancreatic ganglia) — needs more of the HRA body model.
- Superior pancreaticoduodenal veins, minor papilla.
- Measured human sizes to replace not-yet-sourced values (stereology literature, electron microscopy full texts).
- Measuring ruler; image and video export.
