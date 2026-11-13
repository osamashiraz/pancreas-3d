#!/usr/bin/env python3
"""Rendering profile of the built viewer: draw calls, triangles, shader programs, scene size and frame times at each stage.
  python3 viewer/test/profile.py dist/pancreas-organ-to-cell.html [--soft] [--dpr2]
--dpr2 renders at twice the pixel density, as on a Retina screen. Uses the installed Chrome with its GPU (or software WebGL with --soft). Frame times are measured over 3 s of idle and
3 s of slow orbiting at each stage; JS time per frame is the main-thread time spent inside requestAnimationFrame callbacks."""
import asyncio, functools, re, sys, tempfile
print = functools.partial(print, flush=True)
from pathlib import Path
from playwright.async_api import async_playwright

STAGES = [
    ('organ', None),
    ('lobules', "window.__zoom.flyTo(4200, undefined, 'tissue')"),
    ('tissue', "window.__zoom.flyTo(800, undefined, 'tissue')"),
    ('acinus', "document.querySelector('[data-go=\"detail:acinus\"]').click()"),
    ('acinar-cell', "document.querySelector('[data-go=\"cell:acinus\"]').click()"),
    ('islet', "document.querySelector('[data-go=\"detail:islet\"]').click()"),
    ('islet-cells', "document.querySelector('[data-go=\"cells:islet\"]') && document.querySelector('[data-go=\"cells:islet\"]').click()"),
    ('beta-cell', "document.querySelector('[data-kind=beta]').click()"),
    ('duct', "document.querySelector('[data-go=\"detail:duct\"]').click()"),
    ('duct-cell', "document.querySelector('[data-go=\"cell:duct\"]').click()"),
    ('organ-again', "window.__zoom.flyTo(2.6e5, undefined, 'tissue')"),
    ('precursors', "document.querySelector('[data-mode=precursors]').click()"),
    ('pancreatitis', "document.querySelector('[data-mode=pancreatitis]').click()"),
    ('pda', "document.querySelector('[data-mode=pda]').click()"),
]
MEASURE = """async (ms) => { const t = []; let js = 0; const raf = window.requestAnimationFrame.bind(window);
  return await new Promise((done) => { const t0 = performance.now(); let last = t0;
    const tick = (now) => { t.push(now - last); last = now; if (now - t0 < ms) raf(tick); else { t.sort((a, b) => a - b);
      done({ fps: +(1000 * t.length / (now - t0)).toFixed(1), median: +t[Math.floor(t.length / 2)].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), worst: +t[t.length - 1].toFixed(1) }); } };
    raf(tick); }); }"""

async def main(path, soft):
    html = re.sub(r'<link href="https://fonts[^>]*>', '', Path(path).read_text())
    tmp = Path(tempfile.mkdtemp()) / 'pz-profile.html'; tmp.write_text(html)
    async with async_playwright() as p:
        args = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] if soft else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
        b = await (p.chromium.launch(args=args) if soft else p.chromium.launch(channel='chrome', args=args))
        pg = await b.new_page(viewport={'width': 1440, 'height': 860}, device_scale_factor=2 if '--dpr2' in sys.argv else 1); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        cdp = await pg.context.new_cdp_session(pg); await cdp.send('Performance.enable')
        t0 = await pg.evaluate('performance.now()')
        await pg.goto(tmp.as_uri(), wait_until='commit', timeout=240000); await pg.wait_for_function('window.__zoom && window.__zoom.stats', timeout=240000)
        print('page ready after', round((await pg.evaluate('performance.now()')) / 1000, 1), 's (from navigation)')
        await pg.wait_for_timeout(4000)
        print(f"{'stage':14} {'level':28} {'calls':>6} {'tris':>9} {'progs':>5} {'geoms':>6} {'objs':>6} {'vis':>6} | idle fps med p95 | orbit fps med p95 worst | JS ms/frame")
        for name, js in STAGES:
            if js: await pg.evaluate(js)
            await pg.wait_for_timeout(6000)
            st = await pg.evaluate('window.__zoom.stats()'); lv = await pg.evaluate("document.querySelector('.levelname').textContent")
            m0 = {x['name']: x['value'] for x in (await cdp.send('Performance.getMetrics'))['metrics']}
            idle = await pg.evaluate(MEASURE, 3000)
            box = await pg.evaluate("(() => { const r = document.querySelector('.view').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
            await pg.mouse.move(box[0], box[1]); await pg.mouse.down()
            orbit_task = asyncio.ensure_future(pg.evaluate(MEASURE, 3000))
            for k in range(30): await pg.mouse.move(box[0] + 4 * k, box[1] + k); await pg.wait_for_timeout(90)
            orbit = await orbit_task; await pg.mouse.up()
            m1 = {x['name']: x['value'] for x in (await cdp.send('Performance.getMetrics'))['metrics']}
            frames = max(1, (idle['fps'] + orbit['fps']) * 3); jsms = 1000 * (m1['ScriptDuration'] - m0['ScriptDuration']) / frames
            print(f"{name:14} {lv[:28]:28} {st['calls']:>6} {st['triangles']:>9} {st['programs']:>5} {st['geometries']:>6} {st['objects']:>6} {st['visible']:>6} | {idle['fps']:>5} {idle['median']:>5} {idle['p95']:>5} | {orbit['fps']:>5} {orbit['median']:>5} {orbit['p95']:>5} {orbit['worst']:>6} | {jsms:.2f}")
        heap = await pg.evaluate('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1')
        print('JS heap MB:', heap, '| page errors:', errs or 'none')
        await b.close()

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], '--soft' in sys.argv))
