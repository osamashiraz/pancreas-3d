#!/usr/bin/env python3
"""Smoke test for the built viewer in headless Chromium.
  pip install playwright && playwright install chromium
  python3 viewer/test/smoke.py dist/pancreas-organ-to-cell.html [--chrome]
Loads the page and walks it: the layers opened in place (organ surface, lobules, tissue core), a site picked by zooming in
over the organ, the acinus, islet and duct branches down to their cells, alpha and delta cells, marker genes, the
cell-type stain, the head/body/tail comparison and a link to a view (#site=..&view=..). Fails on any page error or if a stage is not reached. Screenshots go to
viewer/test/out/. Software WebGL (the default, as in CI) is slow: each step waits up to 12 x SMOKE_WAIT (ms, default 6000)
for its stage. --chrome uses the installed Chrome with its GPU instead. three.js comes from the CDN; offline, point THREE_DIR at
a local three@0.147.0 package and the script rewrites the URLs."""
import asyncio, os, re, sys, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

WAIT = int(os.environ.get('SMOKE_WAIT', '6000'))
STEPS = [   # name, script, expected [stage, branch or None], expected level shown
    ('opening', "window.__zoom.flyTo(15000, undefined, 'tissue')", ['tissue', None], 'Lobules'),
    ('lobules', "window.__zoom.flyTo(4200, undefined, 'tissue')", ['tissue', None], 'Lobules'),
    ('tissue', "window.__zoom.flyTo(800, undefined, 'tissue')", ['tissue', None], 'Tissue'),
    ('acinus', "document.querySelector('[data-go=\"detail:acinus\"]').click()", ['structure', 'acinus'], 'Acinus'),
    ('acinar-cell', "document.querySelector('[data-go=\"cell:acinus\"]').click()", ['cell', 'acinus'], 'Acinar cell'),
    ('islet-celltypes', "document.querySelector('[data-stain=if]').click(); document.querySelector('[data-go=\"detail:islet\"]').click()", ['structure', 'islet'], 'Islet'),
    ('beta-cell', "document.querySelector('[data-kind=beta]').click()", ['cell', 'islet'], 'Beta cell'),
    ('alpha-cell', "document.querySelector('[data-kind=alpha]').click()", ['cell', 'islet'], 'Alpha cell'),
    ('delta-cell', "document.querySelector('[data-kind=delta]').click()", ['cell', 'islet'], 'Delta cell'),
    ('duct', "document.querySelector('[data-stain=he]').click(); document.querySelector('[data-go=\"detail:duct\"]').click()", ['structure', 'duct'], 'Duct'),
    ('duct-cell', "document.querySelector('[data-go=\"cell:duct\"]').click()", ['cell', 'duct'], 'Duct cell'),
    ('organ', "window.__zoom.flyTo(2.6e5, undefined, 'tissue')", ['tissue', None], 'Organ'),
    ('precursors', "document.querySelector('[data-mode=precursors]').click()", ['tissue', None], 'Precursor lesions'),
    ('panin-view', "document.querySelector('[data-lesion=panin]').click()", ['tissue', None], 'PanIN'),
    ('ipmn-view', "document.querySelector('[data-lesion=ipmn]').click()", ['tissue', None], 'IPMN'),
    ('mcn-view', "document.querySelector('[data-lesion=mcn]').click()", ['tissue', None], 'MCN'),
    ('precursors-back', "document.querySelector('[data-lesion=overview]').click()", ['tissue', None], 'Precursor lesions'),
    ('pancreas-mode', "document.querySelector('[data-mode=pancreas]').click()", ['tissue', None], 'Organ'),
    ('compare', "document.getElementById('compare').click()", ['tissue', None], 'Head, body and tail compared'),
    ('compare-off', "document.getElementById('compare').click()", ['tissue', None], 'Lobules'),
]

async def main(page_path, chrome):
    html = Path(page_path).read_text(); three = os.environ.get('THREE_DIR')
    if three: html = html.replace('https://cdn.jsdelivr.net/npm/three@0.147.0/', f'file://{three}/')
    html = re.sub(r'<link href="https://fonts[^>]*>', '', html)
    tmp = Path(tempfile.mkdtemp()) / 'pz-smoke.html'; tmp.write_text(html)
    out = Path(__file__).parent / 'out'; out.mkdir(exist_ok=True)
    failures = []
    async with async_playwright() as p:
        args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] if chrome else ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
        b = await (p.chromium.launch(channel='chrome', args=args) if chrome else p.chromium.launch(args=args))
        pg = await b.new_page(viewport={'width': 960, 'height': 640}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(tmp.as_uri(), wait_until='commit', timeout=240000); await pg.wait_for_function('window.__zoom', timeout=240000); await pg.wait_for_timeout(WAIT)
        level = lambda: pg.evaluate("document.querySelector('.levelname').textContent")
        site = lambda: pg.evaluate("document.getElementById('sitelabel').textContent")
        # Zooming in over the organ picks a site near the pointer.
        before = await site(); await pg.mouse.move(420, 420)
        for _ in range(12): await pg.mouse.wheel(0, -120); await pg.wait_for_timeout(100)
        await pg.wait_for_timeout(WAIT); print('zoom in over the organ:', before, '->', await site())
        for name, js, (stage, br), lv in STEPS:
            await pg.evaluate(js)
            # Wait for the stage to be reached (software rendering can take many seconds per flight), then let it settle.
            cond = "(() => { const v = window.__zoom.views()[0]; return v[0] === %r && (%s || v[1] === %r) && document.querySelector('.levelname').textContent.startsWith(%r); })()" % (stage, 'true' if br is None else 'false', br or '', lv)
            try: await pg.wait_for_function(cond, timeout=WAIT * 12, polling=500)
            except Exception: pass
            await pg.wait_for_timeout(WAIT // 2)
            v = (await pg.evaluate('window.__zoom.views()'))[0]; shown = await level()
            ok = v[0] == stage and (br is None or v[1] == br) and shown.startswith(lv)
            print(('ok  ' if ok else 'FAIL'), name, v, repr(shown))
            if name.endswith('-cell') and await pg.evaluate("document.getElementById('markerbox').hidden"): ok = False; print('FAIL', name, 'marker genes not shown')
            if not ok: failures.append(name)
            try: await pg.screenshot(path=str(out / f'{name}.png'), timeout=120000)
            except Exception: print('     (screenshot skipped: the frame took too long in software rendering)')   # the checks above decide pass or fail
        # A link to a view opens the page there.
        await pg.goto('about:blank'); await pg.goto(tmp.as_uri() + '#site=9&view=islet', wait_until='commit'); await pg.wait_for_function('window.__zoom', timeout=240000)
        try: await pg.wait_for_function("window.__zoom.views()[0][0] === 'structure' && window.__zoom.views()[0][1] === 'islet' && window.__zoom.distance() < 2000", timeout=WAIT * 12, polling=500)
        except Exception: pass
        v = (await pg.evaluate('window.__zoom.views()'))[0]; s = await site(); ok = v[0] == 'structure' and v[1] == 'islet' and s.startswith('Site 9 ')
        print(('ok  ' if ok else 'FAIL'), 'link #site=9&view=islet', v, s, await pg.evaluate('location.hash'))
        if not ok: failures.append('link')
        await b.close()
    print('page errors:', errs or 'none'); print('failed steps:', failures or 'none')
    sys.exit(1 if errs or failures else 0)

if __name__ == '__main__':
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    asyncio.run(main(argv[0] if argv else 'dist/pancreas-organ-to-cell.html', '--chrome' in sys.argv))
