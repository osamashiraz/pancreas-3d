#!/usr/bin/env python3
"""Assemble the standalone zoom viewer (one self-contained HTML file) from its sources and the module's data.

  python3 viewer/build_viewer.py <path to MouseBio_3D checkout with the module installed> [out.html]

Inputs:  viewer/template.html, viewer/src/generator.js, viewer/src/app.js, and from the repo
         public/atlas-human/{tissue-block.json, tissue-block-head.json, tissue-block-tail.json, pancreas-region-male.glb,
         islets-male.glb, islets.manifest.json}, and data/human-pancreas-markers.json
Output:  dist/pancreas-organ-to-cell.html (about 8 MB; the published page must stay under 16 MB)

viewer/src/generator.js is src/domain/human-pancreas-generator.ts compiled to plain JavaScript and wrapped as window.HPGen;
regenerate it with viewer/compile_generator.mjs after changing the TypeScript.
"""
import base64, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    repo = Path(sys.argv[1]); atlas = repo / 'public' / 'atlas-human'
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / 'dist' / 'pancreas-organ-to-cell.html'
    t = (HERE / 'template.html').read_text()
    esc = lambda s: s.strip().replace('</', '<\\/')
    islets = json.loads((atlas / 'islets.manifest.json').read_text())
    male = next(r for r in islets['references'] if r['sex'] == 'male')
    organ = {'densities': {k: v['densityPerMm3'] for k, v in male['regions'].items()}}
    parts = {
        '__GENERATOR_JS__': (HERE / 'src' / 'generator.js').read_text(),
        '__APP_JS__': (HERE / 'src' / 'app.js').read_text(),
        '__BLOCK_BODY__': esc((atlas / 'tissue-block.json').read_text()),
        '__BLOCK_HEAD__': esc((atlas / 'tissue-block-head.json').read_text()),
        '__BLOCK_TAIL__': esc((atlas / 'tissue-block-tail.json').read_text()),
        '__ORGAN_JSON__': json.dumps(organ),
        '__REGION_GLB_B64__': base64.b64encode((atlas / 'pancreas-region-male.glb').read_bytes()).decode(),
        '__ISLETS_GLB_B64__': base64.b64encode((atlas / 'islets-male.glb').read_bytes()).decode(),
        '__MARKERS_JSON__': esc((repo / 'data' / 'human-pancreas-markers.json').read_text()),
    }
    for k, v in parts.items():
        assert t.count(k) == 1, k
        t = t.replace(k, v)
    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(t)
    print(f'{out}: {len(t) / 1e6:.2f} MB')
    if len(t) > 16e6:
        raise SystemExit('Too large to publish as a single page (16 MB limit).')

if __name__ == '__main__':
    main()
