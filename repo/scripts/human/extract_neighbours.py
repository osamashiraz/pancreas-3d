#!/usr/bin/env python3
"""Extract the organs round the pancreas from the HRA united body model, by the same rules as the pancreas region.

Original integration code: MIT. The output GLB is derived from the HRA 3D Reference Object Library and keeps its licence,
CC BY 4.0. Accessor bytes are copied unchanged from named nodes with identity world transforms (see extract_pancreas_region.py);
nothing is smoothed, decimated or repaired. The HRA v2.0 united model has no stomach and no adrenal glands, so they are not here.

Usage:
  python3 scripts/human/extract_neighbours.py <dir with the united GLBs> public/atlas-human [male|female ...]
Writes neighbours-<sex>.glb and neighbours.manifest.json. Needs numpy.
"""
import json, sys
from pathlib import Path
from extract_pancreas_region import extract

# Node names without the sex prefix: the liver and gallbladder above the head, the kidneys and their vessels behind,
# the great vessels, and the transverse colon with its flexures below.
NEIGHBOURS = [
    'liver_capsule', 'gallbladder',
    'kidney_capsule_L', 'kidney_capsule_R', 'renal_vein_L', 'renal_vein_R', 'left_renal_artery', 'right_renal_artery',
    'descending_aorta_a', 'descending_aorta_b', 'inferior_vena_cava_a', 'inferior_vena_cava_b',
    'transverse_colon', 'hepatic_flexure_of_colon', 'splenic_flexure_of_colon',
]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    src_dir, out_dir, sexes = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:] or ['male']
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 'humanbio.region-extract.v1', 'license': 'CC-BY-4.0',
                'attribution': 'Human Reference Atlas 3D Reference Object Library (HuBMAP), from the Visible Human Project of the U.S. National Library of Medicine.',
                'method': 'Accessor bytes copied unchanged from named nodes with identity world transforms; tangents, texture coordinates and materials dropped.',
                'note': 'The HRA v2.0 united models have no stomach and no adrenal glands.',
                'references': [extract(sex, src_dir, out_dir, NEIGHBOURS, f'neighbours-{sex}.glb', 'neighbours') for sex in sexes]}
    (out_dir / 'neighbours.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for ref in manifest['references']:
        print(f'{ref["output"]["file"]}: {len(ref["nodes"])} nodes, {ref["output"]["bytes"]:,} bytes, missing {ref["missing"] or "none"}')


if __name__ == '__main__':
    main()
