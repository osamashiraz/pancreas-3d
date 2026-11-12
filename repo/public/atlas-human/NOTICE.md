# Human pancreas region models

`pancreas-region-male.glb` and `pancreas-region-female.glb` are derived from the Human Reference Atlas 3D Reference Object Library (HuBMAP), files `3d-vh-m-united.glb` and `3d-vh-f-united.glb` of ccf-releases v2.0 (commit b036a91aaf7234f462b1249d4a5f4fb0e982f412), which were drawn from the Visible Human Project of the U.S. National Library of Medicine.

They are licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: 29 named nodes were selected per file; their position, normal and index bytes were copied unchanged; tangents, texture coordinates and materials were dropped. `pancreas-region.manifest.json` records the checksums of the source and output files and of each node's positions. `scripts/human/extract_pancreas_region.py` reproduces the files.

Cite: Börner K, et al. Human BioMolecular Atlas Program (HuBMAP): 3D Human Reference Atlas construction and usage. Nat Methods 2025;22(4):845-860. doi:10.1038/s41592-024-02563-5
