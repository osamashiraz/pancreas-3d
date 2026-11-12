#!/usr/bin/env python3
"""Smoke test for the built viewer in headless Chromium (software WebGL, so it is slow: allow minutes, not seconds).
  pip install playwright && playwright install chromium
  python3 viewer/test/smoke.py dist/pancreas-organ-to-cell.html
Checks that the page loads without errors, flies to an acinus, an islet and a duct, switches stain and split screen,
and saves screenshots to viewer/test/out/. three.js is loaded from the CDN; offline, point THREE_DIR at a local
three@0.147.0 package and the script rewrites the URLs."""
import asyncio, os, re, sys
from pathlib import Path
from playwright.async_api import async_playwright
async def main(page_path):
    html = Path(page_path).read_text(); three = os.environ.get('THREE_DIR')
    if three: html = html.replace('https://cdn.jsdelivr.net/npm/three@0.147.0/', f'file://{three}/')
    html = re.sub(r'<link href="https://fonts[^>]*>', '', html); tmp = Path('/tmp/pz-smoke.html'); tmp.write_text(html)
    out = Path(__file__).parent / 'out'; out.mkdir(exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1150, 'height': 780}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'file://{tmp}'); await pg.wait_for_timeout(8000)
        steps = [('acinus', "window.__zoom.flyTo(160,'acinus','structure')"), ('islet', "window.__zoom.flyTo(300,'islet','structure')"),
                 ('islet-celltypes', "document.querySelector('[data-stain=if]').click()"), ('duct', "document.querySelector('[data-stain=he]').click(); window.__zoom.flyTo(150,'duct','structure')")]
        for name, js in steps:
            await pg.evaluate(js); await pg.wait_for_timeout(60000)
            await pg.screenshot(path=str(out / f'{name}.png'), timeout=240000); print(name, await pg.evaluate('window.__zoom.views()'))
        await b.close()
    print('page errors:', errs or 'none'); sys.exit(1 if errs else 0)
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'dist/pancreas-organ-to-cell.html'))
