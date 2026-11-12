(() => {
  // One world, in micrometres. The zoom point on the organ is the origin; the tissue block is centred there, and each
  // finer level sits inside the coarser one at true scale. Levels fade in and out with the camera's distance, so zooming
  // is one continuous movement from the organ to a single cell.
  // One tissue block per region of the gland, each built independently (scripts/human/build_tissue_block.py <region>).
  const BLOCKS = { body: JSON.parse(document.getElementById('block').textContent), head: JSON.parse(document.getElementById('block-head').textContent), tail: JSON.parse(document.getElementById('block-tail').textContent) };
  let B = BLOCKS.body, blockRegion = 'body';
  // Sixty tissue sites through the gland. The first in each region uses the block built and tested in the repo; the rest
  // are generated here, on demand, from their seeds by the repo's generator (src/domain/human-pancreas-generator.ts).
  const SITE_LIST = [], GEN = new Map(); let site = -1;
  const PICK = { acinus: 0, duct: 0 }, PICKS = { acinus: [], duct: [], of: null };
  function makePicks() {   // 25 acini and 25 ducts spread through the block, by farthest-point sampling
    if (PICKS.of === B) return; PICKS.of = B; PICK.acinus = 0; PICK.duct = 0;
    const Ic = new THREE.Vector3(...B.islet.centreUm), inner = (p, m) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < m;
    const fps = (items, n) => { if (!items.length) return []; const out = [items[0]];
      while (out.length < Math.min(n, items.length)) { let best = null, bd = -1; items.forEach((it) => { if (out.includes(it)) return; const d = Math.min(...out.map((o) => o.p.distanceTo(it.p))); if (d > bd) { bd = d; best = it; } }); out.push(best); }
      return out.map((o) => o.i); };
    PICKS.acinus = fps(B.acini.map((a, i) => ({ i, p: new THREE.Vector3(...a.centre) })).filter((o) => o.p.distanceTo(Ic) > B.islet.radiusUm + 25 && inner(o.p, 125)).sort((a, b) => a.p.length() - b.p.length()), 25);
    PICKS.duct = fps(B.ducts.map((d, i) => ({ i, d, p: new THREE.Vector3(...d.a).add(new THREE.Vector3(...d.b)).multiplyScalar(0.5) }))
      .filter((o) => o.d.kind === 'intralobular' && new THREE.Vector3(...o.d.a).distanceTo(new THREE.Vector3(...o.d.b)) > 10 && o.d.r > 6.6 && inner(o.p, 120)).sort((a, b) => b.d.r - a.d.r), 25);
    if (!PICKS.duct.length) PICKS.duct = [B.ducts.findIndex((d) => d.kind === 'intralobular')];
  }
  const blockKey = (region) => (region === 'tail' ? 'tail' : region === 'head' || region === 'uncinate process' ? 'head' : 'body');
  const ORG = JSON.parse(document.getElementById('organ').textContent);
  const V = Object.fromEntries(Object.entries(B.parameters).map(([k, p]) => [k, p.value]));
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const col = (n) => new THREE.Color(css(n));
  const stage = $('stage');
  if (!window.THREE || !THREE.OrbitControls || !THREE.GLTFLoader) { $('status').textContent = 'The 3D library did not load. Check the connection and reload the page.'; return; }
  THREE.ColorManagement.legacyMode = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.toneMapping = THREE.NoToneMapping;   // keep stain colours true
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputEncoding = THREE.sRGBEncoding; renderer.localClippingEnabled = true;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Zoomable 3D view of the pancreas from organ to cell. Scroll or pinch to zoom, drag to turn.');
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(); let camera = new THREE.PerspectiveCamera(32, 1, 1, 1e7);
  // Soft image-based light from a studio room, so surfaces shade smoothly from every side.
  if (THREE.RoomEnvironment) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; }
  // ---------- views: one, or two side by side, each with its own camera, zoom stage and branch
  const VIEWS = [], VIEW_LISTENERS = []; let focus = 0, UI = null, splitOn = false;
  function attach(v, ev, fn, opts) { v.el.addEventListener(ev, (e) => { setFocus(v.i); fn(e); }, opts); }
  function onViews(ev, fn, opts) { VIEW_LISTENERS.push([ev, fn, opts]); VIEWS.forEach((v) => attach(v, ev, fn, opts)); }
  function makeView(i, cam) {
    const el = document.createElement('div'); el.className = 'view'; el.tabIndex = 0; el.setAttribute('aria-label', `View ${i + 1}: drag to turn, scroll or pinch to zoom.`);
    el.innerHTML = '<div class="labels" aria-hidden="true"></div><div class="levelname" aria-live="polite"></div><div class="scale"><div class="bar"></div><span class="barlabel"></span></div>';
    stage.appendChild(el);
    const c = cam || new THREE.PerspectiveCamera(32, 1, 1, 1e7), ctr = new THREE.OrbitControls(c, el);
    ctr.enableDamping = !reduced; ctr.minDistance = 4; ctr.maxDistance = 6.5e5; ctr.zoomSpeed = 0.9; ctr.enablePan = false;
    const v = { i, el, camera: c, controls: ctr, STAGE: { mode: 'tissue', detail: 0, explode: 0, cell: 0, last: 0, anchor: new THREE.Vector3(), locked: false }, branch: 'acinus', flight: null, lastLevel: '',
      ui: { labels: el.querySelector('.labels'), pool: [], levelname: el.querySelector('.levelname'), bar: el.querySelector('.bar'), barlabel: el.querySelector('.barlabel'), x: 0, w: 1, h: 1 } };
    VIEWS.push(v); VIEW_LISTENERS.forEach(([ev, fn, o]) => attach(v, ev, fn, o)); return v;
  }
  const controls0 = makeView(0, camera).controls; let controls = controls0; UI = VIEWS[0].ui;
  controls.enableDamping = !reduced; controls.minDistance = 4; controls.maxDistance = 6.5e5; controls.zoomSpeed = 0.9; controls.enablePan = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cdd6, 0.78));
  const sun = new THREE.DirectionalLight(0xffffff, 0.42); sun.position.set(0.5, 1, 0.8); scene.add(sun);
  const fillL = new THREE.DirectionalLight(0xffffff, 0.25); fillL.position.set(-1, -0.3, -0.6); scene.add(fillL);
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false);
    VIEWS.forEach((v, k) => { const n = splitOn ? 2 : 1, vw = k < n ? Math.floor((w - (n - 1) * 3) / n) : 0, x = k * (vw + 3);
      Object.assign(v.ui, { x, w: vw, h }); v.el.style.left = x + 'px'; v.el.style.width = vw + 'px'; v.el.style.display = k < n ? '' : 'none';
      v.camera.aspect = vw / Math.max(h, 1); v.camera.updateProjectionMatrix(); }); }
  new ResizeObserver(resize).observe(stage); resize();
  const bytesOf = (id) => { const b = atob($(id).textContent.trim()), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const parse = (u) => new Promise((res, rej) => new THREE.GLTFLoader().parse(u.buffer, '', res, rej));
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);
  const quatFromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a, b.clone().normalize());

  // ---------- shapes
  const wedge = (() => {   // an acinar cell: a smooth wedge, apex (y = 0) at the lumen, rounded base (y = 1)
    const prof = [[0.001, 0], [0.09, 0.03], [0.16, 0.12], [0.31, 0.36], [0.47, 0.62], [0.58, 0.82], [0.56, 0.92], [0.42, 0.98], [0.001, 1]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 12), p = g.getAttribute('position'), c = new Float32Array(p.count * 3), apex = col('--apex'), base = col('--base'), t = new THREE.Color();
    for (let i = 0; i < p.count; i++) { t.copy(apex).lerp(base, THREE.MathUtils.smoothstep(p.getY(i), 0.32, 0.86)); c.set([t.r, t.g, t.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); return g; })();
  const roundedBox = (() => {   // a box with smooth edges: a superellipsoid spanning -1..1
    const g = new THREE.SphereGeometry(1, 18, 14), p = g.getAttribute('position'), e = 0.32, f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i)), f(p.getY(i)), f(p.getZ(i)));
    g.computeVertexNormals(); return g; })();
  const wedgeHi = (() => {   // the same wedge, smoother: profile refined by a spline, more segments round
    const P = [[0.001, 0], [0.09, 0.03], [0.16, 0.12], [0.31, 0.36], [0.47, 0.62], [0.58, 0.82], [0.56, 0.92], [0.42, 0.98], [0.001, 1]].map(([r, y]) => new THREE.Vector2(r, y));
    const prof = new THREE.SplineCurve(P).getPoints(40), g = new THREE.LatheGeometry(prof, 30), p = g.getAttribute('position'), c = new Float32Array(p.count * 3), apex = col('--apex'), base = col('--base'), t = new THREE.Color();
    for (let i = 0; i < p.count; i++) { t.copy(apex).lerp(base, THREE.MathUtils.smoothstep(p.getY(i), 0.32, 0.86)); c.set([t.r, t.g, t.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); return g; })();
  const ballHi = new THREE.IcosahedronGeometry(1, 3), roundedBoxHi = (() => { const g = new THREE.SphereGeometry(1, 32, 24), p = g.getAttribute('position'), f = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.32);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i)), f(p.getY(i)), f(p.getZ(i))); g.computeVertexNormals(); return g; })();
  const ball = new THREE.IcosahedronGeometry(1, 1), lowball = new THREE.IcosahedronGeometry(1, 0), rod = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  function fib(n) { const out = [], ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - z * z); out.push(new THREE.Vector3(Math.cos(i * ga) * r, Math.sin(i * ga) * r, z)); } return out; }

  // ---------- materials, remembered per group so a group can fade as a whole
  const HE_GLSL = `varying vec3 vHE; uniform float uHeFreq; uniform float uHeAmp;
    float heHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float heNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(heHash(i), heHash(i + vec3(1,0,0)), f.x), mix(heHash(i + vec3(0,1,0)), heHash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(heHash(i + vec3(0,0,1)), heHash(i + vec3(1,0,1)), f.x), mix(heHash(i + vec3(0,1,1)), heHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
  function heify(m, freq = 0.9, amp = 0.16) {
    m.side = THREE.DoubleSide;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHeFreq = { value: freq }; sh.uniforms.uHeAmp = { value: amp };
      sh.vertexShader = 'varying vec3 vHE;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 heP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          heP = instanceMatrix * heP;
        #endif
        vHE = (modelMatrix * heP).xyz;`);
      sh.fragmentShader = HE_GLSL + '\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float heN = heNoise(vHE * uHeFreq) * 0.65 + heNoise(vHE * uHeFreq * 2.7) * 0.35;
          diffuseColor.rgb *= 1.0 + uHeAmp * (heN - 0.5) * 2.0;`)
        .replace('#include <tonemapping_fragment>', `if (!gl_FrontFacing) { gl_FragColor.rgb = diffuseColor.rgb * 0.96; }   // a cut cell shows its stained inside
          #include <tonemapping_fragment>`);
    };
    m.customProgramCacheKey = () => 'he';
  }
  function M(group, color, planes, extra = {}) {
    extra = Object.assign({}, extra); const Ctor = extra.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial; delete extra.physical;
    const he = extra.he === undefined ? [0.9, 0.16] : extra.he; delete extra.he;
    const m = new Ctor(Object.assign({ color: color.startsWith('--') ? col(color) : new THREE.Color(color), roughness: 0.55, clippingPlanes: planes || [] }, extra));
    m.envMapIntensity = 0.22;   // a matte, evenly lit look, like light through a slide
    if (he && !m.transparent) heify(m, he[0], he[1]);
    m.userData.base = m.transparent ? m.opacity : 1; m.userData.baseDepth = m.depthWrite;
    (group.userData.mats = group.userData.mats || []).push(m); return m;
  }
  function fade(group, w) {
    if (!group) return; group.visible = w > 0.01; if (!group.visible) return;
    for (const m of group.userData.mats || []) {
      const o = m.userData.base * w, tr = o < 0.995;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = o; m.depthWrite = tr ? (m.userData.base >= 0.995 && w > 0.6) : m.userData.baseDepth;
    }
    for (const p of group.userData.points || []) { p.material.opacity = w; p.material.transparent = true; }
  }
  const JITTER = new Set(['acinar', 'intercalated', 'intralobular', 'cac', 'beta', 'alpha', 'delta', 'pp', 'stellate', 'nucleus', 'redcell']);
  function inst(group, geo, mat, list, name) { const m = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1)); list.forEach((x, i) => m.setMatrixAt(i, x)); m.count = list.length; m.instanceMatrix.needsUpdate = true; m.name = name;
    if (JITTER.has(name)) { const c = new THREE.Color(); list.forEach((_, i) => { const k = 0.92 + 0.16 * (((i * 2654435761) >>> 0) % 1000) / 1000; m.setColorAt(i, c.setRGB(k, k * (0.98 + 0.04 * ((i * 97) % 7) / 7), k)); }); m.instanceColor.needsUpdate = true; }
    group.add(m); return m; }
  const MP = (group, color, planes, extra = {}) => M(group, color, planes, Object.assign({ physical: true, sheen: 0.12, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffd9e6'), roughness: 0.55 }, extra));

  // ---------- tissue pieces
  const lumen = V.acinarLumenRadiusUm, cac = V.centroacinarSizeUm;
  const granulePattern = Array.from({ length: 28 }, (_, i) => { const r1 = ((i * 7919) % 97) / 97, r2 = ((i * 104729) % 89) / 89, r3 = ((i * 1299709) % 83) / 83;
    const y = 0.07 + 0.3 * r1, rad = (0.09 + 0.62 * y) * 0.7 * Math.sqrt(r2), th = r3 * Math.PI * 2; return new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad); });
  function acinusCells(ac) {   // per cell: the cell matrix, its direction in the world, its reach and base width
    const A = new THREE.Matrix4().compose(new THREE.Vector3(...ac.centre), new THREE.Quaternion(...ac.q), new THREE.Vector3(1, 1, 1));
    const n = Math.ceil(ac.cells / 0.92), dirs = fib(n).filter((d) => d.z > -0.86).slice(0, ac.cells), alpha = Math.acos(1 - 2 / n), Q = new THREE.Quaternion(...ac.q);
    return dirs.map((d, i) => { const reach = ac.ext ? ac.ext[i] : ac.r, bw = reach * Math.sin(alpha) * 1.9, len = reach - lumen;
      const q = quatFromTo(Y, d).multiply(new THREE.Quaternion().setFromAxisAngle(Y, i * 2.4));
      return { m: A.clone().multiply(new THREE.Matrix4().compose(d.clone().multiplyScalar(lumen), q, new THREE.Vector3(bw, len, bw))), A, local: d, world: d.clone().applyQuaternion(Q), q, reach, bw, len }; });
  }
  function acinusParts(ac, out, withGranules, skip) {
    acinusCells(ac).forEach((c, i) => {
      if (skip === i) return;
      out.acinar.push(c.m);
      const nr = V.acinarNucleusDiameterUm / 2; out.nucleus.push(new THREE.Matrix4().makeScale(nr, nr, nr).setPosition(new THREE.Vector3(0, 0.7, 0).applyMatrix4(c.m)));
      if (withGranules) granulePattern.forEach((g) => { const s = V.zymogenGranuleDiameterUm / 2; out.granule.push(new THREE.Matrix4().makeScale(s, s, s).setPosition(g.clone().applyMatrix4(c.m))); });
    });
    const A = new THREE.Matrix4().compose(new THREE.Vector3(...ac.centre), new THREE.Quaternion(...ac.q), new THREE.Vector3(1, 1, 1));
    for (let k = 0; k < V.centroacinarCellsPerAcinus; k++) {
      const th = k * 2 * Math.PI / V.centroacinarCellsPerAcinus, rad = new THREE.Vector3(Math.cos(th), Math.sin(th), 0), tang = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
      const L = Math.min(cac[0], ac.r * 0.7), c = rad.clone().multiplyScalar(1.6).add(new THREE.Vector3(0, 0, -ac.r * 0.5));
      out.cac.push(A.clone().multiply(new THREE.Matrix4().makeBasis(tang.clone().multiplyScalar(cac[1] / 2), rad.clone().multiplyScalar(cac[2] / 2), Z.clone().multiplyScalar(L / 2)).setPosition(c)));
      out.cacNucleus.push(A.clone().multiply(new THREE.Matrix4().makeBasis(tang.clone().multiplyScalar(1.3), rad.clone().multiplyScalar(0.7), Z.clone().multiplyScalar(3)).setPosition(c)));
    }
  }
  function ductCells(d) {   // per duct cell: centre, outward direction, along-duct axis, and its three sizes
    const a = new THREE.Vector3(...d.a), b = new THREE.Vector3(...d.b), ax = b.clone().sub(a), len = ax.length(); if (len < 0.5) return []; ax.normalize();
    const hc = d.kind === 'intercalated' ? V.intercalatedCellHeightUm : Math.min(V.intralobularCellHeightUm, 0.5 * d.r);
    const u = new THREE.Vector3().crossVectors(ax, Math.abs(ax.z) < 0.9 ? Z : X).normalize(), v = new THREE.Vector3().crossVectors(ax, u);
    const rings = Math.max(1, Math.round(len / V.ductCellLengthUm)), rm = d.r - hc / 2, around = Math.max(4, Math.round(2 * Math.PI * rm / 7)), out = [];
    for (let i = 0; i < rings; i++) for (let k = 0; k < around; k++) {
      const th = (k + (i % 2) * 0.5) * 2 * Math.PI / around, rad = u.clone().multiplyScalar(Math.cos(th)).add(v.clone().multiplyScalar(Math.sin(th)));
      out.push({ c: a.clone().add(ax.clone().multiplyScalar((i + 0.5) * len / rings)).add(rad.clone().multiplyScalar(rm)), rad, ax, w: 2 * Math.PI * rm / around * 0.95, h: hc * 0.95, l: len / rings * 0.95, kind: d.kind });
    }
    return out;
  }
  const cellMatrix = (c) => { const x = new THREE.Vector3().crossVectors(c.rad, c.ax); return new THREE.Matrix4().makeBasis(x.multiplyScalar(c.w / 2), c.rad.clone().multiplyScalar(c.h / 2), c.ax.clone().multiplyScalar(c.l / 2)).setPosition(c.c); };
  function rodMatrix(a, b, r) { const ax = b.clone().sub(a), L = ax.length(); return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), quatFromTo(Y, ax), new THREE.Vector3(r, L, r)); }
  function capillaryParts(a, b, out) {
    const r = V.capillaryRadiusUm; out.capillary.push(rodMatrix(a, b, r));
    const ax = b.clone().sub(a), L = ax.length(), q = quatFromTo(Y, ax), [d, t] = V.redCellSizeUm;
    for (let s = 6; s < L - 2; s += 24) { out.redcell.push(new THREE.Matrix4().compose(a.clone().add(ax.clone().multiplyScalar(s / L)), q, new THREE.Vector3(d / 2 * 0.8, t / 2, d / 2 * 0.8)));
      out.flow.push({ a: a.clone(), u: ax.clone().normalize(), L, s, q, scale: new THREE.Vector3(d / 2 * 0.8, t / 2, d / 2 * 0.8) }); }
  }
  const ISLET_TYPES = ['beta', 'alpha', 'delta', 'pp'];
  function buildTissue(planes, keep, focal, skip) {
    const out = { isletNucleus: [], flow: [], acinar: [], nucleus: [], granule: [], cac: [], cacNucleus: [], intercalated: [], intralobular: [], ductNucleus: [], capillary: [], node: [], redcell: [], fibre: [], stellate: [], stellateNucleus: [], beta: [], alpha: [], delta: [], pp: [] };
    B.acini.forEach((ac, i) => { if (keep(new THREE.Vector3(...ac.centre), ac.r)) acinusParts(ac, out, i === focal.acinus, i === focal.acinus ? focal.skipCell : undefined); });
    B.ducts.forEach((d, di) => { const m = new THREE.Vector3(...d.a).add(new THREE.Vector3(...d.b)).multiplyScalar(0.5); if (!keep(m, d.r + 10)) return;
      ductCells(d).forEach((c, ci) => { if (di === focal.duct && ci === focal.skipDuctCell) return; out[d.kind].push(cellMatrix(c)); const nr = Math.min(c.h * 0.3, 1.7); out.ductNucleus.push(new THREE.Matrix4().makeScale(nr, nr, nr * 1.3).setPosition(c.c)); }); });
    const N = B.capillaries.nodes.map((n) => new THREE.Vector3(...n));
    B.capillaries.edges.forEach(([i, j]) => { if (keep(N[i].clone().add(N[j]).multiplyScalar(0.5), 12)) capillaryParts(N[i], N[j], out); });
    B.capillaries.isletSegments.forEach(([a, b]) => { const A = new THREE.Vector3(...a); if (keep(A, 4)) capillaryParts(A, new THREE.Vector3(...b), out); });
    N.forEach((p) => { if (keep(p, 4)) out.node.push(new THREE.Matrix4().makeScale(V.capillaryRadiusUm, V.capillaryRadiusUm, V.capillaryRadiusUm).setPosition(p)); });
    B.stroma.fibres.forEach((f) => { const a = new THREE.Vector3(...f.a), b = new THREE.Vector3(...f.b); if (keep(a.clone().add(b).multiplyScalar(0.5), 15)) out.fibre.push(rodMatrix(a, b, f.r)); });
    const S = V.stellateCellSizeUm;
    B.stroma.stellateCells.forEach((s) => { const c = new THREE.Vector3(...s.c); if (!keep(c, 12)) return; const q = new THREE.Quaternion(...s.q);
      out.stellate.push(new THREE.Matrix4().compose(c, q, new THREE.Vector3(S[1] / 2, S[2] / 2, S[0] / 2))); out.stellateNucleus.push(new THREE.Matrix4().compose(c, q, new THREE.Vector3(1.4, 1, 4))); });
    B.islet.cells.forEach(([t, x, y, z], i) => { if (i === focal.skipIsletCell) return; const p = new THREE.Vector3(x, y, z); if (keep(p, 6)) { out[t].push(new THREE.Matrix4().makeScale(5, 5, 5).setPosition(p)); out.isletNucleus.push(new THREE.Matrix4().makeScale(2.3, 2.3, 2.3).setPosition(p)); } });
    const g = new THREE.Group(), add = (name, geo, color, extra) => { if (out[name].length) inst(g, geo, M(g, color, planes, extra), out[name], name); };
    add('acinar', wedge, '#ffffff', { vertexColors: true, roughness: 0.75, he: [1.1, 0.2] });
    add('nucleus', lowball, '--nucleus'); add('granule', lowball, '--granule', { roughness: 0.35 });
    add('cac', ball, '--cac'); add('cacNucleus', ball, '--cacnucleus');
    add('intercalated', roundedBox, '--intercalated'); add('intralobular', roundedBox, '--intralobular'); add('ductNucleus', lowball, '--ductnucleus');
    add('capillary', rod, '--capillary', { transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    add('node', lowball, '--capillary', { transparent: true, opacity: 0.32, depthWrite: false });
    add('redcell', ball, '--redcell', { roughness: 0.4 }); add('fibre', rod, '--collagen', { roughness: 0.8 });
    add('stellate', ball, '--stellate'); add('stellateNucleus', lowball, '--nucleus');
    ISLET_TYPES.forEach((t) => add(t, ball, '--' + t)); add('isletNucleus', lowball, '--isletnucleus');
    g.userData.flow = { mesh: g.getObjectByName('redcell'), info: out.flow };
    return g;
  }

  // ---------- one structure on its own, whose cells can be pulled apart
  function buildStructure(k) {
    const g = new THREE.Group(), lists = {}, push = (name, m, off) => { (lists[name] = lists[name] || { base: [], off: [] }).base.push(m); lists[name].off.push(off); };
    const zero = new THREE.Vector3();
    if (k === 'acinus') {
      const ac = B.acini[fa];
      acinusCells(ac).forEach((c) => { const off = c.world.clone().multiplyScalar(0.38 * c.reach);   // orange segments ease out along their own axis
        push('acinar', c.m, off);
        const nr = V.acinarNucleusDiameterUm / 2; push('nucleus', new THREE.Matrix4().makeScale(nr, nr, nr).setPosition(new THREE.Vector3(0, 0.7, 0).applyMatrix4(c.m)), off);
        granulePattern.forEach((p) => { const s = V.zymogenGranuleDiameterUm / 2; push('granule', new THREE.Matrix4().makeScale(s, s, s).setPosition(p.clone().applyMatrix4(c.m)), off); }); });
      const tmp = { cac: [], cacNucleus: [], acinar: [], nucleus: [], granule: [] }; acinusParts({ ...ac, cells: 0, ext: [] }, tmp, false);
      tmp.cac.forEach((m) => push('cac', m, zero)); tmp.cacNucleus.forEach((m) => push('cacNucleus', m, zero));
      // Its own intercalated duct, and the ducts it drains into, back toward the intralobular duct (up to three segments).
      const ic = B.ducts.filter((d) => d.kind === 'intercalated')[fa], chain = [ic];
      for (let k2 = 0; k2 < 3; k2++) { const start = new THREE.Vector3(...chain[chain.length - 1].a);
        const parent = B.ducts.find((d) => !chain.includes(d) && (() => { const a = new THREE.Vector3(...d.a), b = new THREE.Vector3(...d.b), u = b.clone().sub(a), t = THREE.MathUtils.clamp(start.clone().sub(a).dot(u) / u.lengthSq(), 0, 1); return a.addScaledVector(u, t).distanceTo(start) < 0.8; })());
        if (!parent) break; chain.push(parent); if (parent.kind === 'intralobular') break; }
      chain.forEach((seg) => ductCells(seg).forEach((c) => { const back = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...ac.q)).multiplyScalar(14);
        push(seg.kind, cellMatrix(c), back.clone().addScaledVector(c.rad, c.h * 1.2)); const nr = Math.min(c.h * 0.3, 1.7); push('ductNucleus', new THREE.Matrix4().makeScale(nr, nr, nr * 1.3).setPosition(c.c), back.clone().addScaledVector(c.rad, c.h * 1.2)); }));
    } else if (k === 'islet') {
      B.islet.cells.forEach(([t, x, y, z]) => { const p = new THREE.Vector3(x, y, z), off = p.clone().sub(I).multiplyScalar(0.4); push(t, new THREE.Matrix4().makeScale(5, 5, 5).setPosition(p), off); push('isletNucleus', new THREE.Matrix4().makeScale(2.3, 2.3, 2.3).setPosition(p), off); });
      B.capillaries.isletSegments.forEach(([a, b]) => push('capillary', rodMatrix(new THREE.Vector3(...a), new THREE.Vector3(...b), V.capillaryRadiusUm), zero));
    } else {
      const near = (p, q) => p.distanceTo(q) < 0.5, segs = B.ducts.filter((d) => d.kind === 'intralobular' && (d === Dseg || [d.a, d.b].some((e) => near(new THREE.Vector3(...e), Da) || near(new THREE.Vector3(...e), Db))));
      // Its own collagen, aligned along it (CODA), as the pink sheath around a duct in H&E.
      B.stroma.fibres.filter((f) => f.kind === 'periductal').forEach((f) => { const a = new THREE.Vector3(...f.a), b = new THREE.Vector3(...f.b), m = a.clone().add(b).multiplyScalar(0.5);
        if (segs.some((d) => { const A = new THREE.Vector3(...d.a), Bb = new THREE.Vector3(...d.b), u = Bb.clone().sub(A), t = THREE.MathUtils.clamp(m.clone().sub(A).dot(u) / u.lengthSq(), 0, 1); return A.addScaledVector(u, t).distanceTo(m) < d.r + 4; }))
          push('fibre', rodMatrix(a, b, f.r * 1.6), zero); });
      segs.forEach((d) => ductCells(d).forEach((c) => { const off = c.rad.clone().multiplyScalar(c.h * 0.9).addScaledVector(c.ax, c.c.clone().sub(D).dot(c.ax) * 0.25);
        push(d.kind, cellMatrix(c), off); const nr = Math.min(c.h * 0.3, 1.7); push('ductNucleus', new THREE.Matrix4().makeScale(nr, nr, nr * 1.3).setPosition(c.c), off); }));
    }
    const C = { physical: true, sheen: 0.12, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffd9e6'), roughness: 0.55 }, G = { physical: true, clearcoat: 0.3, clearcoatRoughness: 0.5, roughness: 0.6 };
    const look = { acinar: [wedgeHi, '#ffffff', { ...C, vertexColors: true, he: [1.1, 0.2] }], nucleus: [ball, '--nucleus', G], granule: [lowball, '--granule', G], cac: [ballHi, '--cac', C], cacNucleus: [ball, '--cacnucleus', G],
      intercalated: [roundedBoxHi, '--intercalated', C], intralobular: [roundedBoxHi, '--intralobular', C], ductNucleus: [ball, '--ductnucleus', G], capillary: [rod, '--capillary', { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }],
      beta: [ballHi, '--beta', C], alpha: [ballHi, '--alpha', C], delta: [ballHi, '--delta', C], pp: [ballHi, '--pp', C], isletNucleus: [ball, '--isletnucleus', G], fibre: [rod, '--collagen', { roughness: 0.85, he: [0.6, 0.2] }] };
    for (const [name, L] of Object.entries(lists)) { const [geo, color, extra] = look[name], m = inst(g, geo, M(g, color, [BRANCHES[k].plane], extra), L.base, name); m.userData.base = L.base; m.userData.off = L.off; }
    g.userData.explode = -1; return g;
  }
  function setExplode(g, e) { if (!g || Math.abs(g.userData.explode - e) < 0.002) return; g.userData.explode = e; const M4 = new THREE.Matrix4();
    g.traverse((o) => { if (!o.isInstancedMesh || !o.userData.base) return; o.userData.base.forEach((b, i) => { M4.copy(b); const f = o.userData.off[i]; M4.elements[12] += f.x * e; M4.elements[13] += f.y * e; M4.elements[14] += f.z * e; o.setMatrixAt(i, M4); }); o.instanceMatrix.needsUpdate = true; }); }

  // ---------- focal points: one acinus, one acinar cell, the islet, one beta cell, one duct, one duct cell
  const cutNormal = X.clone();   // every detail is cut by a plane facing +x; the camera looks from +x
let fa, F, faCells, fc, Pc, I, fb, Pb, fdu, Dseg, Da, Db, D, Dax, dCells, fdc, Pd, OFF;
  function computeFocal() {
    makePicks(); fa = PICKS.acinus[PICK.acinus % PICKS.acinus.length]; let best;
  F = new THREE.Vector3(...B.acini[fa].centre);
  faCells = acinusCells(B.acini[fa]);
  fc = 0; best = -1e9; faCells.forEach((c, i) => { const s = c.world.y - Math.abs(c.world.x + 0.25) * 3; if (s > best) { best = s; fc = i; } });
  Pc = new THREE.Vector3(0, 0.5, 0).applyMatrix4(faCells[fc].m);
  I = new THREE.Vector3(...B.islet.centreUm);
  fb = 0; best = 1e9; B.islet.cells.forEach(([t, x, y, z], i) => { if (t !== 'beta') return; const p = new THREE.Vector3(x, y, z), s = Math.abs(p.x - (I.x - 3)) + 0.3 * Math.hypot(p.y - I.y, p.z - I.z); if (s < best) { best = s; fb = i; } });
  Pb = new THREE.Vector3(...B.islet.cells[fb].slice(1));
  fdu = PICKS.duct[PICK.duct % PICKS.duct.length];
  Dseg = B.ducts[fdu]; Da = new THREE.Vector3(...Dseg.a); Db = new THREE.Vector3(...Dseg.b); D = Da.clone().add(Db).multiplyScalar(0.5); Dax = Db.clone().sub(Da).normalize();
  dCells = ductCells(Dseg);
  fdc = 0; best = 1e9; dCells.forEach((c, i) => { const s = Math.abs(c.c.x - D.x + 2) + 0.5 * c.c.distanceTo(D) - 3 * c.rad.y; if (s < best) { best = s; fdc = i; } });
  Pd = dCells[fdc].c.clone();
  OFF = { acinus: faCells[fc].world.clone().multiplyScalar(0.38 * faCells[fc].reach), islet: Pb.clone().sub(I).multiplyScalar(0.4),
    duct: dCells[fdc].rad.clone().multiplyScalar(dCells[fdc].h * 0.9).addScaledVector(dCells[fdc].ax, dCells[fdc].c.clone().sub(D).dot(dCells[fdc].ax) * 0.25) };
  }
  computeFocal();

  // ---------- names: invisible markers placed in the scene, shown as labels when names are on
  const LABELS = {};
  function tag(set, parent, text, pos) { const o = new THREE.Object3D(); o.position.copy(pos); o.userData.label = text; parent.add(o); (LABELS[set] = LABELS[set] || []).push(o); return o; }

  // ---------- the enlarged cells, at their true places
  function buildAcinarCell(group) {
    const c = faCells[fc], g = new THREE.Group(), h = c.len, bw = c.bw;
    const body = new THREE.Mesh(wedgeHi, MP(group, '#ffffff', null, { vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })); body.scale.set(bw, h, bw); g.add(body);
    const P = (y) => new THREE.Vector3(0, y * h, 0), prof = (y) => (0.09 + 0.6 * y) * bw;
    const nuc = new THREE.Mesh(ballHi, MP(group, '--nucleus')); nuc.position.copy(P(0.7)); nuc.scale.setScalar(Math.min(V.acinarNucleusDiameterUm / 2, prof(0.7) * 0.42)); g.add(nuc);
    const nl = new THREE.Mesh(ballHi, MP(group, '--nucleolus')); nl.position.copy(P(0.7)).add(new THREE.Vector3(0.6, 0.3, 0.4)); nl.scale.setScalar(0.6); g.add(nl);
    const rer = MP(group, '--rer', null, { side: THREE.DoubleSide });
    for (let k = 0; k < 7; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(prof(0.78) * 0.45 + k * 0.32, 0.08, 6, 48, Math.PI * 1.25), rer); t.rotation.x = Math.PI / 2; t.rotation.z = -0.4 + k * 0.05; t.position.copy(P(0.76 + k * 0.012)); g.add(t); }
    const gol = MP(group, '--golgi');
    for (let k = 0; k < 5; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(1.1 + k * 0.24, 0.1, 6, 32, Math.PI * 0.9), gol); t.rotation.set(Math.PI / 2 + 0.25, 0, 0.6); t.position.copy(P(0.47 + k * 0.025)); g.add(t); }
    const mito = MP(group, '--mito'), mg = new THREE.CapsuleGeometry(0.26, 1.2, 4, 8);
    for (let k = 0; k < 24; k++) { const y = 0.3 + 0.6 * ((k * 37) % 19) / 19, rad = prof(y) * 0.7 * Math.sqrt(((k * 61) % 23) / 23), th = k * 2.4, p = new THREE.Vector3(Math.cos(th) * rad, y * h, Math.sin(th) * rad);
      if (p.distanceTo(P(0.7)) < 3.4) continue; const m = new THREE.Mesh(mg, mito); m.position.copy(p); m.rotation.set(k * 0.7, k * 1.3, k * 0.4); g.add(m); }
    const gr = MP(group, '--granule', null, { roughness: 0.35 });
    for (let k = 0; k < 110; k++) { const y = 0.05 + 0.32 * ((k * 53) % 89) / 89, rad = prof(y) * 0.75 * Math.sqrt(((k * 31) % 97) / 97), th = k * 2.39996;
      const m = new THREE.Mesh(lowball, gr); m.position.set(Math.cos(th) * rad, y * h, Math.sin(th) * rad); m.scale.setScalar(V.zymogenGranuleDiameterUm / 2); g.add(m); }
    // Place it where the cell really is: the acinus frame, then the cell's own direction, apex at the lumen.
    const T = new THREE.Matrix4().compose(new THREE.Vector3(...B.acini[fa].centre), new THREE.Quaternion(...B.acini[fa].q), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().compose(c.local.clone().multiplyScalar(lumen), c.q, new THREE.Vector3(1, 1, 1)));
    tag('acinusCell', g, 'Nucleus', P(0.7).add(new THREE.Vector3(prof(0.7) * 0.42, 0, 0))); tag('acinusCell', g, 'Rough ER', P(0.86).add(new THREE.Vector3(-prof(0.86) * 0.5, 0, 0)));
    tag('acinusCell', g, 'Golgi', P(0.5).add(new THREE.Vector3(1.6, 0, 0))); tag('acinusCell', g, 'Zymogen granules', P(0.2)); tag('acinusCell', g, 'Lumen', P(-0.03)); tag('acinusCell', g, 'Mitochondria', P(0.4).add(new THREE.Vector3(-prof(0.4) * 0.6, 0, 0)));
    g.applyMatrix4(T); group.add(g);
  }
  function buildBetaCell(group) {
    const g = new THREE.Group(), R = 5;
    const body = new THREE.Mesh(roundedBoxHi, MP(group, '--beta', null, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })); body.material.userData.isletType = 'beta'; body.scale.set(R, R * 0.92, R * 0.88); g.add(body);
    const nuc = new THREE.Mesh(ballHi, MP(group, '--nucleus')); nuc.scale.setScalar(2.1); nuc.position.set(-0.6, 0.2, 0); g.add(nuc);
    const nl = new THREE.Mesh(ballHi, MP(group, '--nucleolus')); nl.scale.setScalar(0.5); nl.position.set(-0.1, 0.7, 0.5); g.add(nl);
    const gol = MP(group, '--golgi');
    for (let k = 0; k < 5; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.8 + k * 0.17, 0.07, 6, 28, Math.PI * 0.9), gol); t.position.set(1.4, 1.6 + k * 0.13, 0.2); t.rotation.set(Math.PI / 2 + 0.3, 0, 0.8); g.add(t); }
    const rer = MP(group, '--rer', null, { side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(2.6 + k * 0.3, 0.06, 6, 40, Math.PI * 0.8), rer); t.position.set(-0.6, 0.2, 0); t.rotation.set(Math.PI / 2, 0, Math.PI * 0.75 + k * 0.05); g.add(t); }
    const core = MP(group, '--insulincore', null, { roughness: 0.3 }), halo = MP(group, '--insulinhalo', null, { transparent: true, opacity: 0.35, depthWrite: false });
    const inside = (p) => (p.x / (R * 0.85)) ** 2 + (p.y / (R * 0.78)) ** 2 + (p.z / (R * 0.75)) ** 2 < 1 && p.distanceTo(nuc.position) > 2.6;
    for (let k = 0, made = 0; made < 240 && k < 6000; k++) { const p = new THREE.Vector3(((k * 7919) % 1000) / 500 - 1, ((k * 104729) % 1000) / 500 - 1, ((k * 1299709) % 1000) / 500 - 1).multiplyScalar(R);
      if (!inside(p)) continue; made++; const c = new THREE.Mesh(lowball, core); c.position.copy(p); c.scale.setScalar(0.1); g.add(c); const hh = new THREE.Mesh(ballHi, halo); hh.position.copy(p); hh.scale.setScalar(0.15); g.add(hh); }
    const mito = MP(group, '--mito'), mg = new THREE.CapsuleGeometry(0.2, 0.9, 4, 8);
    for (let i = 0, n = 0; n < 12 && i < 2000; i++) { const p = new THREE.Vector3(((i * 31) % 97) / 48.5 - 1, ((i * 57) % 89) / 44.5 - 1, ((i * 73) % 83) / 41.5 - 1).multiplyScalar(R * 0.8);
      if (!inside(p)) continue; n++; const m = new THREE.Mesh(mg, mito); m.position.copy(p); m.rotation.set(i, i * 1.7, i * 0.3); g.add(m); }
    const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), MP(group, '--cilium')); cil.position.set(0, R * 0.95 + 1.1, 0.4); cil.rotation.z = 0.3; g.add(cil);
    tag('isletCell', g, 'Nucleus', new THREE.Vector3(-0.6, -1.5, 0)); tag('isletCell', g, 'Insulin granules', new THREE.Vector3(3, -2, 1.5)); tag('isletCell', g, 'Golgi', new THREE.Vector3(1.6, 2.4, 0.2));
    tag('isletCell', g, 'Primary cilium', new THREE.Vector3(0.4, R * 0.95 + 2.3, 0.4)); tag('isletCell', g, 'Mitochondria', new THREE.Vector3(-3, 1.8, 1));
    g.position.copy(Pb); group.add(g);
  }
  function buildDuctCell(group) {
    const c = dCells[fdc], g = new THREE.Group(), w = c.w, h = c.h, l = c.l;   // local frame: x across, y outward (basal), z along the duct; the apex faces the lumen at -y
    const body = new THREE.Mesh(roundedBoxHi, MP(group, '--intralobular', null, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })); body.scale.set(w / 2, h / 2, l / 2); g.add(body);
    const nuc = new THREE.Mesh(ballHi, MP(group, '--ductnucleus')); nuc.scale.set(w * 0.22, h * 0.24, l * 0.22); nuc.position.set(0, h * 0.06, 0); g.add(nuc);
    const mito = MP(group, '--mito'), mg = new THREE.CapsuleGeometry(0.13, 0.6, 4, 8);
    for (let k = 0; k < 16; k++) { const p = new THREE.Vector3((((k * 37) % 19) / 19 - 0.5) * w * 0.75, (((k * 53) % 17) / 17 - 0.5) * h * 0.7, (((k * 71) % 23) / 23 - 0.5) * l * 0.75);
      if (Math.abs(p.x) < w * 0.25 && Math.abs(p.z) < l * 0.25 && Math.abs(p.y - h * 0.06) < h * 0.25) continue; const m = new THREE.Mesh(mg, mito); m.position.copy(p); m.rotation.set(k, k * 1.3, k * 0.7); g.add(m); }
    const mv = MP(group, '--microvilli'), mvg = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6);
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const m = new THREE.Mesh(mvg, mv); m.position.set(i * w * 0.11, -h / 2 - 0.15, j * l * 0.11); g.add(m); }
    const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 8), MP(group, '--cilium')); cil.position.set(0.2, -h / 2 - 1.3, 0.3); cil.rotation.x = 0.35; g.add(cil);
    const tj = MP(group, '--tightjunction');   // tight junctions: a belt round the apical edge
    [[0, l / 2, w, 0.12], [0, -l / 2, w, 0.12]].forEach(([x, z, sx]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.9, 0.22, 0.14), tj); b.position.set(x, -h / 2 + 0.35, z * 0.95); g.add(b); });
    [[w / 2, 0], [-w / 2, 0]].forEach(([x]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, l * 0.9), tj); b.position.set(x * 0.95, -h / 2 + 0.35, 0); g.add(b); });
    const cf = MP(group, '--cftr'), sl = MP(group, '--slc26');   // apical transporters, drawn as markers far larger than the molecules
    for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(lowball, k % 2 ? sl : cf); m.scale.setScalar(0.16); m.position.set((((k * 37) % 13) / 13 - 0.5) * w * 0.8, -h / 2 + 0.02, (((k * 59) % 11) / 11 - 0.5) * l * 0.8); g.add(m); }
    const bm = new THREE.Mesh(new THREE.BoxGeometry(w * 1.7, 0.08, l * 1.7), MP(group, '--basement', null, { transparent: true, opacity: 0.6 })); bm.position.set(0, h / 2 + 0.08, 0); g.add(bm);
    tag('ductCell', g, 'Nucleus', new THREE.Vector3(0, h * 0.06, 0)); tag('ductCell', g, 'Microvilli', new THREE.Vector3(w * 0.3, -h / 2 - 0.3, 0)); tag('ductCell', g, 'Primary cilium', new THREE.Vector3(0.2, -h / 2 - 2.6, 0.7));
    tag('ductCell', g, 'Tight junction', new THREE.Vector3(w / 2, -h / 2 + 0.35, 0)); tag('ductCell', g, 'CFTR and SLC26A6', new THREE.Vector3(-w * 0.3, -h / 2, l * 0.2)); tag('ductCell', g, 'Basement membrane', new THREE.Vector3(0, h / 2 + 0.1, l * 0.7));
    tag('ductCell', g, 'Mitochondria', new THREE.Vector3(w * 0.3, h * 0.2, -l * 0.25));
    const x = new THREE.Vector3().crossVectors(c.rad, c.ax);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(x, c.rad, c.ax).setPosition(c.c)); group.add(g);
  }

  const explodeTags = [], labelRoots = [];
  function makeBlockLabels() {
  { const near = (pts, p) => pts.reduce((b, q) => (q.distanceTo(p) < b.distanceTo(p) ? q : b));
    const root = new THREE.Group(); scene.add(root); labelRoots.push(root);
    const nodes = B.capillaries.nodes.map((n) => new THREE.Vector3(...n)), fibres = B.stroma.fibres.filter((f) => f.kind === 'periductal').map((f) => new THREE.Vector3(...f.a).add(new THREE.Vector3(...f.b)).multiplyScalar(0.5));
    tag('tissue', root, 'Islet', I); tag('tissue', root, 'Intralobular duct', D); tag('tissue', root, 'Acinus', F);
    tag('tissue', root, 'Stellate cell', near(B.stroma.stellateCells.map((s) => new THREE.Vector3(...s.c)), new THREE.Vector3(60, 60, 60)));
    tag('tissue', root, 'Capillary', near(nodes.filter((p) => p.distanceTo(F) > B.acini[fa].r + 4), F.clone().add(new THREE.Vector3(0, 40, 0))));
    const Q = new THREE.Quaternion(...B.acini[fa].q), r = B.acini[fa].r;
    tag('acinus', root, 'Lumen', F); tag('acinus', root, 'Centroacinar cells', F.clone().add(new THREE.Vector3(0, 0, -r * 0.5).applyQuaternion(Q)));
    tag('acinus', root, 'Intercalated duct', F.clone().add(new THREE.Vector3(0, 0, -r - 4).applyQuaternion(Q)));
    tag('acinus', root, 'Acinar cell', new THREE.Vector3(0, 0.8, 0).applyMatrix4(faCells[fc].m)); tag('acinus', root, 'Zymogen granules', new THREE.Vector3(0, 0.2, 0).applyMatrix4(faCells[(fc + 5) % faCells.length].m));
    const cellsOf = (t) => B.islet.cells.filter((c) => c[0] === t).map((c) => new THREE.Vector3(...c.slice(1)));
    tag('islet', root, 'Beta cell', Pb); ['alpha', 'delta', 'pp'].forEach((t) => tag('islet', root, { alpha: 'Alpha cell', delta: 'Delta cell', pp: 'PP cell' }[t], near(cellsOf(t), I.clone().add(new THREE.Vector3(-8, t === 'delta' ? 20 : t === 'pp' ? -20 : 0, 0)))));
    tag('islet', root, 'Capillary', near(B.capillaries.isletSegments.map(([a]) => new THREE.Vector3(...a)), I.clone().add(new THREE.Vector3(-6, 12, 12))));
    tag('duct', root, 'Duct lumen', D); tag('duct', root, 'Duct epithelium', Pd); tag('duct', root, 'Periductal collagen', near(fibres, D));
    tag('duct', root, 'Acinus', near(B.acini.map((a) => new THREE.Vector3(...a.centre)), D)); }
  { const root = new THREE.Group(); scene.add(root); labelRoots.push(root); const mv = (set, text, base, off) => { const o = tag(set, root, text, base); o.userData.base = base.clone(); o.userData.off = off.clone(); explodeTags.push(o); };
    const c0 = faCells[fc], c1 = faCells[(fc + 7) % faCells.length], Q = new THREE.Quaternion(...B.acini[fa].q);
    mv('acinusCells', 'Acinar cell', new THREE.Vector3(0, 0.75, 0).applyMatrix4(c0.m), OFF.acinus); mv('acinusCells', 'Zymogen granules', new THREE.Vector3(0, 0.2, 0).applyMatrix4(c1.m), c1.world.clone().multiplyScalar(0.38 * c1.reach));
    mv('acinusCells', 'Centroacinar cells', F.clone().add(new THREE.Vector3(0, 0, -B.acini[fa].r * 0.5).applyQuaternion(Q)), new THREE.Vector3());
    mv('acinusCells', 'Basal nucleus', new THREE.Vector3(0, 0.7, 0).applyMatrix4(c1.m), c1.world.clone().multiplyScalar(0.38 * c1.reach));
    const firstOf = (t) => B.islet.cells.map((c, i) => [c, i]).filter(([c]) => c[0] === t).map(([c]) => new THREE.Vector3(...c.slice(1))).sort((p, q) => Math.abs(p.x - I.x + 4) + 0.2 * p.distanceTo(I) - Math.abs(q.x - I.x + 4) - 0.2 * q.distanceTo(I))[0];
    mv('isletCells', 'Beta cell', Pb, OFF.islet); ['alpha', 'delta', 'pp'].forEach((t) => { const p = firstOf(t); mv('isletCells', { alpha: 'Alpha cell', delta: 'Delta cell', pp: 'PP cell' }[t], p, p.clone().sub(I).multiplyScalar(0.4)); });
    mv('ductCells', 'Duct cell', Pd, OFF.duct); }
  }
  makeBlockLabels();

  // ---------- groups and how each fades with distance (micrometres from the camera to its target)
  const lg = (x) => Math.log(x), ramp = (d, a, b) => THREE.MathUtils.smoothstep((lg(d) - lg(a)) / (lg(b) - lg(a)), 0, 1);   // 0 at a, 1 at b
  const planes = { block: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6) };
  const groups = { organ: new THREE.Group(), block: null };
  let BRANCHES;
  function makeBranches() {
    BRANCHES = {
    acinus: { name: 'Acinus', cellName: 'Acinar cell', anchor: F, cell: Pc, normal: cutNormal, keep: (p, r) => p.distanceTo(F) < B.acini[fa].r * 2 + 30 + r, build: buildAcinarCell, focal: { acinus: fa, skipCell: fc } },
    islet: { name: 'Islet', cellName: 'Beta cell', anchor: I, cell: Pb, normal: cutNormal, keep: (p, r) => p.distanceTo(I) < B.islet.radiusUm + 16 + r * 0.3, build: buildBetaCell, focal: { skipIsletCell: fb } },
    duct: { name: 'Duct', cellName: 'Duct cell', anchor: D, cell: Pd, normal: null, keep: (p, r) => { const t = THREE.MathUtils.clamp(p.clone().sub(Da).dot(Dax), -25, Da.distanceTo(Db) + 25); return p.distanceTo(Da.clone().add(Dax.clone().multiplyScalar(t))) < Dseg.r + 34 + r; }, build: buildDuctCell, focal: { duct: fdu, skipDuctCell: fdc } },
  };
  // The duct is cut lengthwise: the plane contains its axis and faces the camera side.
  { const n = new THREE.Vector3().crossVectors(Dax, Y).normalize(); if (n.x < 0) n.negate(); BRANCHES.duct.normal = n; }
  for (const b of Object.values(BRANCHES)) { b.plane = new THREE.Plane(b.normal.clone().negate(), b.normal.dot(b.anchor)); b.detail = null; b.cellGroup = null; }
  }
  makeBranches();
  let branch = 'acinus';
  // Zoom distances (µm) for each structure, scaled to its size: when its cells start and finish parting, where the
  // separated view sits, where the whole structure sits, and where the level name changes.
  const SIZE = { acinus: { ex: [170, 105], cells: 100, whole: 210, cut: 140 }, islet: { ex: [330, 215], cells: 215, whole: 360, cut: 270 }, duct: { ex: [160, 95], cells: 90, whole: 200, cut: 125 } };
  function refocus() {
    const drop = (g) => { if (g) scene.remove(g); };
    Object.values(BRANCHES).forEach((b) => { drop(b.detail); drop(b.cellGroup); });
    labelRoots.forEach(drop); labelRoots.length = 0; explodeTags.length = 0;
    ['tissue', 'acinus', 'islet', 'duct', 'acinusCells', 'isletCells', 'ductCells', 'acinusCell', 'isletCell', 'ductCell'].forEach((k) => { delete LABELS[k]; });
    computeFocal(); makeBranches(); makeBlockLabels(); scaleIsletStages(); if (typeof selected !== 'undefined') { selected = null; showSelection(); } updatePickers();
  }
  function blockOf(i) { const S0 = SITE_LIST[i]; if (S0.verified) return BLOCKS[S0.region];
    if (!GEN.has(i)) { GEN.set(i, HPGen.generateBlock(S0.seed, S0.region)); if (GEN.size > 6) GEN.delete(GEN.keys().next().value); } return GEN.get(i); }
  function switchSite(i) {
    if (i === site) return; site = i; blockRegion = SITE_LIST[i].region; B = blockOf(i);
    const drop = (g) => { if (g) scene.remove(g); };
    drop(groups.block); groups.block = null; if (SLICE.block) { drop(SLICE.block); SLICE.block = null; }
    refocus();
  }
  // The block is drawn single-sided (it is mostly seen whole); its cut faces are filled only while it is being cut.
  function blockSides() { if (!groups.block) return; const cut = planes.block.constant < 1e5; groups.block.traverse((o) => { if (o.isMesh && !o.material.transparent) { const sd = cut ? THREE.DoubleSide : THREE.FrontSide; if (o.material.side !== sd) { o.material.side = sd; o.material.needsUpdate = true; } } }); }
  function ensureBlock() { if (!groups.block) { groups.block = buildTissue([planes.block], () => true, {}); scene.add(groups.block); blockSides(); } return groups.block; }
  function ensureBranch(k) { const b = BRANCHES[k];
    if (!b.detail) { b.detail = buildStructure(k); scene.add(b.detail); }
    if (!b.cellGroup) { b.cellGroup = new THREE.Group(); b.build(b.cellGroup); scene.add(b.cellGroup); } return b; }
  // ---------- stages below the tissue. Each stage holds once entered: you can zoom well out before it steps back.
  let STAGE = VIEWS[0].STAGE;
  const ENTER = { acinus: 330, islet: 460, duct: 330 }, LEAVE = { acinus: 1700, islet: 2600, duct: 1700 };
  const CELLS_IN = { acinus: 120, islet: 245, duct: 110 }, CELLS_OUT = { acinus: 600, islet: 1000, duct: 560 };
  const CELL_IN = 34, CELL_OUT = { acinus: 150, islet: 170, duct: 140 };
  let surroundings = false, stain = 'he';
  const HE_ISLET = { beta: '#efcfdf', alpha: '#ecc3d6', delta: '#f0d5e3', pp: '#eccbdc' };   // in H&E islet cells look alike: pale, lightly eosinophilic
  // Cell types: every kind of cell in its own marker colour on a dark ground, as in a multiplex immunofluorescence panel
  // (acinar orange, duct and centroacinar teal, islet types green, magenta, cyan and amber, capillaries red, stellate cells
  // yellow, collagen lavender, all nuclei blue as with a DAPI counterstain). H&E colours are kept and restored exactly.
  const IF_COLORS = { acinar: '#f0893c', granule: '#ffc46b', nucleus: '#4f7dff', cac: '#4fd1d9', cacNucleus: '#4f7dff', intercalated: '#2cc0c9', intralobular: '#1fa3b3', ductNucleus: '#4f7dff',
    capillary: '#ff4d5a', node: '#ff4d5a', redcell: '#c2303b', fibre: '#bfb2ff', stellate: '#ffd84a', stellateNucleus: '#4f7dff', beta: '#3fcf55', alpha: '#ff3d9a', delta: '#2fc2ff', pp: '#ffc21f', isletNucleus: '#4f7dff',
    lobule: '#d9772f', lobuleHull: '#d9772f', grossAcinus: '#f0893c', mainDuct: '#2cc0c9', intralobularDuct: '#2cc0c9', terminalDuct: '#2cc0c9', joint: '#2cc0c9', vein: '#ff4d5a', artery: '#ff4d5a',
    septa: '#8f84c9', grossIslet: '#3fcf55', interlobularDuct: '#2cc0c9', interlobularVein: '#ff4d5a', interlobularArtery: '#ff4d5a' };
  function stainGroup(g) { if (!g || g.userData.stain === stain) return; g.userData.stain = stain;
    g.traverse((o) => { if (!o.isMesh || !o.material) return; const m = o.material, key = IF_COLORS[o.name] ? o.name : m.userData.isletType; if (!key) return;
      if (!m.userData.heSaved) m.userData.heSaved = { color: m.color.clone(), vc: m.vertexColors };
      const sv = m.userData.heSaved, vc = stain === 'if' ? false : sv.vc;
      m.color.set(stain === 'if' ? IF_COLORS[key] : (HE_ISLET[key] || sv.color));
      if (m.vertexColors !== vc) { m.vertexColors = vc; m.needsUpdate = true; } }); }
  const ISLET_BASE = { enter: 460, leave: 2600, cellsIn: 245, cellsOut: 1000, cellOut: 170, size: { ex: [330, 215], cells: 215, whole: 360, cut: 270 } };
  function scaleIsletStages() { const f = Math.max(0.6, (B.islet.radiusUm || 55) / 55);
    ENTER.islet = ISLET_BASE.enter * f; LEAVE.islet = ISLET_BASE.leave * f; CELLS_IN.islet = ISLET_BASE.cellsIn * f; CELLS_OUT.islet = ISLET_BASE.cellsOut * f;
    SIZE.islet = { ex: ISLET_BASE.size.ex.map((x) => x * f), cells: ISLET_BASE.size.cells * f, whole: ISLET_BASE.size.whole * f, cut: ISLET_BASE.size.cut * f }; }
  function stageStep(d, now) {
    const dt = Math.min(0.1, (now - (STAGE.last || now)) / 1000); STAGE.last = now; const b = branch, m = STAGE.mode;
    if (!STAGE.locked && !COMPARE.on) {
      if (m === 'tissue' && d < ENTER[b]) STAGE.mode = 'structure';
      else if (m === 'structure' && d > LEAVE[b]) STAGE.mode = 'tissue';
      else if (m === 'structure' && d < CELLS_IN[b]) STAGE.mode = 'cells';
      else if (m === 'cells' && d > CELLS_OUT[b]) STAGE.mode = 'structure';
      else if (m === 'cells' && d < CELL_IN) STAGE.mode = 'cell';
      else if (m === 'cell' && d > CELL_OUT[b]) STAGE.mode = 'cells';
    }
    const M_ = STAGE.mode, k = reduced ? 1 : 1 - Math.exp(-dt * 4.8), go = (cur, tgt) => cur + (tgt - cur) * k;
    STAGE.detail = go(STAGE.detail, M_ === 'tissue' ? 0 : 1); STAGE.explode = go(STAGE.explode, M_ === 'cells' || M_ === 'cell' ? 1 : 0); STAGE.cell = go(STAGE.cell, M_ === 'cell' ? 1 : 0);
    const Bb = BRANCHES[b], tgt = M_ === 'tissue' ? new THREE.Vector3() : M_ === 'cell' ? Bb.cell.clone().addScaledVector(OFF[b], STAGE.explode) : Bb.anchor;
    STAGE.anchor.lerp(tgt, reduced ? 1 : 1 - Math.exp(-dt * 4.2));
  }
  function weights(d) {
    const sm = (x) => x * x * (3 - 2 * x), det = sm(STAGE.detail), ex = sm(STAGE.explode), ce = sm(STAGE.cell);
    if (COMPARE.on) return { organ: 0, gross: 1, block: 0, detail: 0, cell: 0, explode: 0 };
    return { organ: ramp(d, 14000, 40000), gross: ramp(d, 50000, 20000) * (1 - ramp(d, 2700, 1300)), block: ramp(d, 3400, 1500) * Math.max(1 - det, surroundings ? 0.12 * det : 0), detail: det * (1 - 0.95 * ce), cell: ce, explode: ex };
  }
  function weightsOld(d) {
    // The tissue gives way to the chosen structure alone; its cells separate as you go on; then one cell stands alone.
    const S = SIZE[branch], top = branch === 'islet' ? 560 * Math.max(0.6, B.islet.radiusUm / 55) : 430, bot = branch === 'islet' ? 390 * Math.max(0.6, B.islet.radiusUm / 55) : 270;
    return { organ: ramp(d, 3500, 12000), block: Math.min(ramp(d, 16000, 6000), ramp(d, bot - 20, top)), detail: ramp(d, top, bot) * (1 - ramp(d, 42, 27)), cell: ramp(d, 40, 24), explode: ramp(d, S.ex[0], S.ex[1]) };
  }
  // The camera's target drifts from the block's centre to the branch's structure and then to its cell as you zoom in.
  function anchorAt() { return STAGE.anchor.clone(); }
  function anchorAtOld(d) {
    const b = BRANCHES[branch], t1 = ramp(d, branch === 'islet' ? 800 : 700, branch === 'islet' ? 420 : 280), t2 = ramp(d, 62, 30), e = ramp(d, SIZE[branch].ex[0], SIZE[branch].ex[1]);
    return new THREE.Vector3().lerpVectors(new THREE.Vector3(), b.anchor, t1).lerp(b.cell.clone().addScaledVector(OFF[branch], e), t2);
  }
  function levelAt(d) { const m = STAGE.mode; if (COMPARE.on) return 'compare'; return m === 'tissue' ? (d > 40000 ? 'organ' : d > 2000 ? 'gross' : 'tissue') : m === 'structure' ? 'detail' : m; }
  function levelAtOld(d) { const S = SIZE[branch]; return d > 6000 ? 'organ' : d > (branch === 'islet' ? 450 : 320) ? 'tissue' : d > S.cut ? 'detail' : d > 32 ? 'cells' : 'cell'; }

  // ---------- the organ, in micrometres, moved so the zoom point sits at the origin
  let pancreasMeshes = [], islets, marker, organLocal = new THREE.Vector3(), region = 'body';
  const SITES = {};   // the middle of each region, inside the organ: where each region's tissue is taken from
  const REGION_NAMES = { head_of_pancreas: 'head', uncinate_process_of_the_pancreas: 'uncinate process', neck_of_pancreas: 'neck', body_of_pancreas: 'body', tail_of_pancreas: 'tail' };
  const REGION_KEYS = { head: 'pancreas-head', 'uncinate process': 'pancreas-uncinate', neck: 'pancreas-neck', body: 'pancreas-body', tail: 'pancreas-tail' };
  async function buildOrgan() {
    const g = await parse(bytesOf('glb-region')); g.scene.updateMatrixWorld(true);
    const grp = groups.organ, inner = new THREE.Group(); grp.add(inner); grp.userData.inner = inner;
    g.scene.traverse((o) => { if (!o.isMesh) return; const n = o.name.slice(5);
      const kind = REGION_NAMES[n] ? 'pancreas' : /duodenal_ampulla|duodenum|spleen/.test(n) ? 'other' : /duct|ampulla|sphincter|bile/.test(n) ? 'duct' : /artery|celiac/.test(n) ? 'artery' : /vein/.test(n) ? 'vein' : 'other';
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld).scale(1e6, 1e6, 1e6), op = kind === 'other' ? 0.22 : kind === 'pancreas' ? 0.92 : 1;
      const m = new THREE.Mesh(geo, M(grp, { pancreas: '--organ', duct: '--organduct', artery: '--artery', vein: '--vein', other: '--neighbour' }[kind], null, { transparent: op < 1, opacity: op, depthWrite: op === 1, side: THREE.DoubleSide, roughness: 0.65, he: false }));
      m.userData = { kind, region: REGION_NAMES[n] }; m.name = n; inner.add(m); if (kind === 'pancreas') pancreasMeshes.push(m);
      if (kind === 'pancreas') { const p = geo.getAttribute('position'), c = new THREE.Vector3(); for (let i = 0; i < p.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(p, i)); SITES[REGION_NAMES[n]] = c.divideScalar(p.count); }
      const ORGAN_NAMES = { head_of_pancreas: 'Head', uncinate_process_of_the_pancreas: 'Uncinate process', ucinate_process1: 'Uncinate process', neck_of_pancreas: 'Neck', body_of_pancreas: 'Body', tail_of_pancreas: 'Tail',
        ventral_pancreatic_duct: 'Main pancreatic duct', common_bile_duct: 'Common bile duct', splenic_vein: 'Splenic vein', superior_mesenteric_vein: 'Superior mesenteric vein', superior_mesenteric_artery: 'Superior mesenteric artery',
        hepatic_portal_vein: 'Portal vein', splenic_artery: 'Splenic artery', duodenum_descending: 'Duodenum', hilum_of_spleen: 'Spleen' };
      if (ORGAN_NAMES[n]) { geo.computeBoundingBox(); tag('organ', inner, ORGAN_NAMES[n], geo.boundingBox.getCenter(new THREE.Vector3())); } });
    const ig = await parse(bytesOf('glb-islets')); islets = new THREE.Group(); grp.userData.points = [];
    [['islets--background', '#2f4f86', 1100], ['islets--clustered', '#e8a400', 1300]].forEach(([n, c, s]) => { const src = ig.scene.getObjectByName(n); if (!src) return;
      const p = new THREE.Points(src.geometry.clone().scale(1e6, 1e6, 1e6), new THREE.PointsMaterial({ color: c, size: s, depthWrite: false, transparent: true })); islets.add(p); grp.userData.points.push(p); });
    islets.visible = false; inner.add(islets);
    marker = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2500, 20, 14), new THREE.MeshBasicMaterial({ color: '#2a1060', depthTest: false, transparent: true })); dot.renderOrder = 9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6000, 900, 8, 40), new THREE.MeshBasicMaterial({ color: '#ff3d7f', depthTest: false, transparent: true })); ring.renderOrder = 9;
    marker.add(dot, ring); grp.add(marker);   // the marker stays at the origin: the zoom point
    // Sites: the first of each region at its middle (the tested block), the rest spread through the region by seed.
    const MEMBERS = { head: ['head', 'uncinate process'], body: ['neck', 'body'], tail: ['tail'] };
    ['head', 'body', 'tail'].forEach((rk, ri) => { const pool = []; pancreasMeshes.filter((m) => MEMBERS[rk].includes(m.userData.region)).forEach((m) => { const p = m.geometry.getAttribute('position'); for (let v = 0; v < p.count; v += 7) pool.push(new THREE.Vector3().fromBufferAttribute(p, v)); });
      const centre = SITES[rk], R2 = rng(9001 + ri);
      for (let k = 0; k < 20; k++) { const local = k === 0 ? centre.clone() : centre.clone().lerp(pool[Math.floor(R2() * pool.length)], 0.25 + 0.45 * R2());
        SITE_LIST.push({ i: SITE_LIST.length, region: rk, local, seed: 2000 + SITE_LIST.length, verified: k === 0 }); } });
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false }), SITE_LIST.length);
    const DOT = { head: new THREE.Color('#c0703a'), body: new THREE.Color('#6a3fb0'), tail: new THREE.Color('#1f8a70') };
    SITE_LIST.forEach((S0, k) => { dots.setMatrixAt(k, new THREE.Matrix4().setPosition(S0.local)); dots.setColorAt(k, DOT[S0.region]); });
    dots.renderOrder = 8; dots.name = 'sites'; groups.organ.userData.inner.add(dots); groups.organ.userData.dots = dots;
    setSite(SITE_LIST.findIndex((S0) => S0.region === 'body' && S0.verified), true); groups.organ.userData.inner.position.copy(organLocal).negate();
    scene.add(grp);
  }
  function setSite(i, now) {
    const S0 = SITE_LIST[i]; if (SLICE.organ) { scene.remove(SLICE.organ); SLICE.organ = null; } organLocal.copy(S0.local); region = S0.region;
    document.querySelectorAll('[data-region]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.region === S0.region)));
    const finish = () => { switchSite(i); $('status').style.display = 'none'; updatePickers(); };
    if (now || S0.verified || GEN.has(i)) finish();
    else { $('status').style.display = 'grid'; $('status').textContent = `Building the tissue of site ${i + 1} (${S0.region}) from seed ${S0.seed}…`; setTimeout(finish, 40); }
    $('target').innerHTML = `Tissue site <strong>${i + 1} of ${SITE_LIST.length}</strong>, in the <strong>${S0.region}</strong>, where the model places about ${Math.round(ORG.densities[KEY_OF[S0.region]])} islets per mm³. ${S0.verified ? 'Its block is the one built and tested in the repo.' : `Its block is generated in your browser from seed ${S0.seed}, by the same rules.`} Click a dot, or use the arrows, to choose another site.`;
  }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  onViews('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  onViews('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || camera.position.distanceTo(controls.target) < 15000) { down = null; return; } down = null;
    const r = VIEWS[focus].el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(pancreasMeshes, false)[0];
    const dotHit = groups.organ.userData.dots && ray.intersectObject(groups.organ.userData.dots, false)[0];
    if (dotHit) { setSite(dotHit.instanceId); return; }
    if (hit) { const local = hit.point.clone().sub(groups.organ.userData.inner.position); let bi = 0, bd = Infinity; SITE_LIST.forEach((S0, k) => { const d = S0.local.distanceTo(local); if (d < bd) { bd = d; bi = k; } }); setSite(bi); }
  });

  // ---------- gross view: a 4 mm piece of a region, at low magnification
  const GROSS = {}, CUBE = 4000, LOBULE = 1250, SEPTUM = 50;
  const KEY_OF = { head: 'pancreas-head', body: 'pancreas-body', tail: 'pancreas-tail' };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function buildGross(key) {   // key: a site index
    if (GROSS[key]) return GROSS[key];
    const SITE = SITE_LIST[key], g = new THREE.Group(), R = rng(SITE.seed * 3 + 1), h = CUBE / 2, plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6);
    g.userData.plane = plane; g.userData.key = key;
    // Lobules: the Voronoi cells of jittered seeds, each shrunk by half a septum, clipped to the cube.
    const seeds = [], n = Math.ceil(CUBE / LOBULE) + 2;
    for (let i = -1; i < n - 1; i++) for (let j = -1; j < n - 1; j++) for (let k = -1; k < n - 1; k++)
      seeds.push(new THREE.Vector3(-h + (i + 0.5 + (R() - 0.5) * 0.7) * LOBULE, -h + (j + 0.5 + (R() - 0.5) * 0.7) * LOBULE, -h + (k + 0.5 + (R() - 0.5) * 0.7) * LOBULE));
    const inside = seeds.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < h), base = new THREE.IcosahedronGeometry(1, 3), bp = base.getAttribute('position');
    const back = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6); g.userData.back = back;
    const solid = new THREE.Group(), tree = new THREE.Group(); g.add(solid, tree); g.userData.solid = solid; g.userData.tree = tree; const lobGeo = [];
    const hullMat = M(g, '--parenchyma', [plane], { transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, he: false });
    const parMat = M(g, '--parenchyma', [plane], { roughness: 0.85, he: [1 / 26, 0.32] }), faces = [X, Y, Z, X.clone().negate(), Y.clone().negate(), Z.clone().negate()];
    inside.forEach((s0) => {
      const geo = base.clone(), p = geo.getAttribute('position'), near = seeds.filter((q) => q !== s0 && q.distanceTo(s0) < LOBULE * 2.2);
      for (let v = 0; v < p.count; v++) { const dir = new THREE.Vector3().fromBufferAttribute(bp, v).normalize(); let t = LOBULE * 1.6;
        near.forEach((q) => { const dq = q.clone().sub(s0), c = dq.dot(dir); if (c > 1e-6) t = Math.min(t, (dq.lengthSq() / 2 - SEPTUM / 2 * dq.length()) / c); });
        faces.forEach((f) => { const c = dir.dot(f); if (c > 1e-6) t = Math.min(t, (h - s0.dot(f)) / c); });
        p.setXYZ(v, s0.x + dir.x * t, s0.y + dir.y * t, s0.z + dir.z * t); }
      geo.computeVertexNormals(); const m = new THREE.Mesh(geo, parMat); m.name = 'lobule'; solid.add(m);
      const hull = new THREE.Mesh(geo, hullMat); hull.name = 'lobuleHull'; tree.add(hull); lobGeo.push(geo); });
    // Interlobular ducts and vessels run in the septa: joined septal points (between neighbouring lobules) by a minimum spanning tree.
    // Connective tissue fills the septa: the inside walls of the piece, seen between the lobules.
    const fill = new THREE.Mesh(new THREE.BoxGeometry(CUBE * 0.999, CUBE * 0.999, CUBE * 0.999), M(g, '--collagen', [plane], { roughness: 0.9, he: [1 / 18, 0.22] })); fill.material.side = THREE.BackSide; fill.name = 'septa'; solid.add(fill);
    const sept = []; inside.forEach((a, i) => inside.forEach((b, j) => { if (j > i && a.distanceTo(b) < LOBULE * 1.45) sept.push(a.clone().add(b).multiplyScalar(0.5)); }));
    const inTree = [0], edges = [];
    while (inTree.length < sept.length) { let best = [1e12, -1, -1]; inTree.forEach((i) => sept.forEach((q, j) => { if (inTree.includes(j)) return; const d = sept[i].distanceTo(q); if (d < best[0]) best = [d, i, j]; })); if (best[1] < 0) break; edges.push([best[1], best[2]]); inTree.push(best[2]); }
    // The duct hierarchy. The interlobular ducts follow the minimum spanning tree of septal points, each segment bent onto
    // the septum (the plane between the two nearest lobule seeds) so it runs between lobules, not through them. The longest
    // path through that tree is the large duct. Each lobule gets an intralobular duct from the nearest point of that network
    // to its centre, branching inside it into terminal (intercalated) ducts that end in clusters of acini. Calibres are
    // typical values, not yet sourced: large 80 um, interlobular 26-45 um, intralobular 14 um, terminal 7 um radius.
    const toSeptum = (x) => { const ds = seeds.map((q, k) => [q.distanceTo(x), k]).sort((a, b) => a[0] - b[0]), s1 = seeds[ds[0][1]], s2 = seeds[ds[1][1]], n = s2.clone().sub(s1).normalize();
      const dd = (x.distanceToSquared(s1) - x.distanceToSquared(s2)) / (2 * s1.distanceTo(s2)); return x.clone().addScaledVector(n, dd); };
    const bend = (a, b, depth) => { if (depth === 0 || a.distanceTo(b) < 120) return [a, b]; const m = toSeptum(a.clone().add(b).multiplyScalar(0.5)); return bend(a, m, depth - 1).concat(bend(m, b, depth - 1).slice(1)); };
    const adj = sept.map(() => []); edges.forEach(([i, j]) => { adj[i].push(j); adj[j].push(i); });
    const far = (start) => { const dist = sept.map(() => -1), prev = sept.map(() => -1); dist[start] = 0; const q = [start];
      while (q.length) { const u = q.shift(); adj[u].forEach((v) => { if (dist[v] < 0) { dist[v] = dist[u] + sept[u].distanceTo(sept[v]); prev[v] = u; q.push(v); } }); }
      let best = start; dist.forEach((d, k) => { if (d > dist[best]) best = k; }); return { best, prev }; };
    const A = far(0).best, { best: Bend, prev } = far(A), main = new Set(); for (let k = Bend; k !== -1 && k !== undefined; k = prev[k]) { main.add(k); if (k === A) break; }
    const L = { mainDuct: [], interlobularDuct: [], intralobularDuct: [], terminalDuct: [], joint: [], vein: [], artery: [], grossAcinus: [] }, net = [];
    const smooth = (pts) => { let p = pts; for (let it = 0; it < 2; it++) { const q = [p[0]]; for (let k = 0; k + 1 < p.length; k++) { q.push(p[k].clone().lerp(p[k + 1], 0.25), p[k].clone().lerp(p[k + 1], 0.75)); } q.push(p[p.length - 1]); p = q; } return p; };   // Chaikin corner cutting
    const tube = (pts, r, list) => { for (let k = 0; k + 1 < pts.length; k++) { list.push(rodMatrix(pts[k], pts[k + 1], r)); L.joint.push(new THREE.Matrix4().makeScale(r, r, r).setPosition(pts[k + 1])); } };
    edges.forEach(([i, j]) => { const big = main.has(i) && main.has(j), pts = smooth(bend(sept[i], sept[j], 2)), r = big ? 80 : 26 + 19 * R();
      tube(pts, r, big ? L.mainDuct : L.interlobularDuct); pts.forEach((p) => net.push(p));
      if (!big) return;   // the artery and vein are drawn beside the large duct only, to keep the tree readable
      const u = pts[pts.length - 1].clone().sub(pts[0]).normalize(), side = new THREE.Vector3().crossVectors(u, Math.abs(u.y) < 0.9 ? Y : X).normalize().multiplyScalar(r + 60);
      tube(pts.map((p) => p.clone().add(side)), 50, L.vein); tube(pts.map((p) => p.clone().sub(side)), 32, L.artery); });
    const inLobule = (p, s0) => { const d0 = p.distanceTo(s0); return Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < h - 30 && seeds.every((q) => q === s0 || p.distanceTo(q) > d0 + SEPTUM); };
    const toward = (from, to, s0) => { let t = 1; while (t > 0.15 && !inLobule(from.clone().lerp(to, t), s0)) t *= 0.8; return from.clone().lerp(to, t); };
    inside.forEach((s0) => {
      const entry = net.reduce((b, p) => (p.distanceTo(s0) < b.distanceTo(s0) ? p : b), net[0]);
      tube([entry, s0], 14, L.intralobularDuct);
      const nPrim = 6 + Math.floor(R() * 3);
      for (let a = 0; a < nPrim; a++) {
        const d1 = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), p1 = toward(s0, s0.clone().addScaledVector(d1, LOBULE * 0.28), s0);
        tube([s0, p1], 11, L.intralobularDuct);
        for (let b = 0, nT = 4 + Math.floor(R() * 3); b < nT; b++) {
          const d2 = d1.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(1.4)).normalize(), tip = toward(p1, p1.clone().addScaledVector(d2, LOBULE * (0.12 + 0.1 * R())), s0);
          tube([p1, tip], 7, L.terminalDuct);
          // A cluster of acini at the end of each terminal duct: each sphere stands for a few acini.
          for (let c = 0; c < 16; c++) { const q = tip.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(150)); if (inLobule(q, s0)) L.grossAcinus.push(new THREE.Matrix4().makeScale(30, 30, 30).setPosition(q)); }
        }
      }
    });
    const T = (k, geo, color, extra) => inst(tree, geo, M(g, color, [plane, back], extra || {}), L[k], k);
    T('mainDuct', rod, '--grossduct', { he: [1 / 20, 0.15] }); T('interlobularDuct', rod, '--grossduct', { he: [1 / 20, 0.15] }); T('joint', ball, '--grossduct', { he: false });
    T('intralobularDuct', rod, '--grossduct', { he: false }); T('terminalDuct', rod, '--grossduct', { he: false });
    T('vein', rod, '--grossvein'); T('artery', rod, '--grossartery');
    T('grossAcinus', ballHi, '--parenchyma', { he: [1 / 12, 0.25] });
    g.userData.ductCounts = { main: L.mainDuct.length, interlobular: L.interlobularDuct.length, intralobular: L.intralobularDuct.length, terminal: L.terminalDuct.length, acini: L.grossAcinus.length };
    // The old septal ducts and vessels, for the solid view.
    const lists = { duct: [], artery: [], vein: [] };
    edges.forEach(([i, j]) => { const a = sept[i], b = sept[j], u = b.clone().sub(a).normalize(), side = new THREE.Vector3().crossVectors(u, Math.abs(u.y) < 0.9 ? Y : X).normalize().multiplyScalar(70);
      lists.duct.push(rodMatrix(a, b, 30)); lists.vein.push(rodMatrix(a.clone().add(side), b.clone().add(side), 32)); lists.artery.push(rodMatrix(a.clone().sub(side), b.clone().sub(side), 20)); });
    inst(solid, rod, M(g, '--grossduct', [plane, back]), lists.duct, 'interlobularDuct'); inst(solid, rod, M(g, '--grossvein', [plane, back]), lists.vein, 'interlobularVein'); inst(solid, rod, M(g, '--grossartery', [plane, back]), lists.artery, 'interlobularArtery');
    const mainMid = sept[[...main][Math.floor(main.size / 2)]] || sept[0];
    tag('gross:' + key, tree, 'Large (interlobular) duct', mainMid); tag('gross:' + key, tree, 'Intralobular duct', inside[Math.floor(inside.length / 2)]);
    const tipM = L.terminalDuct[Math.floor(L.terminalDuct.length / 3)]; if (tipM) tag('gross:' + key, tree, 'Terminal (intercalated) duct', new THREE.Vector3().setFromMatrixPosition(tipM));
    const acM = L.grossAcinus[Math.floor(L.grossAcinus.length / 5)]; if (acM) tag('gross:' + key, tree, 'Acini', new THREE.Vector3().setFromMatrixPosition(acM));
    // Islets at the region's density in this model, inside lobules, sizes lognormal about the mean of 110 um (Hahn 2021).
    const dens = ORG.densities[KEY_OF[SITE.region]], count = Math.round(dens * (CUBE / 1000) ** 3), isl = [];
    const inSeptum = (p) => { const ds = seeds.map((q) => q.distanceTo(p)).sort((a, b) => a - b); return ds[1] - ds[0] < SEPTUM * 1.5; };
    for (let tries = 0; isl.length < count && tries < count * 20; tries++) {
      const p = new THREE.Vector3((R() - 0.5) * CUBE * 0.98, (R() - 0.5) * CUBE * 0.98, (R() - 0.5) * CUBE * 0.98); if (inSeptum(p)) continue;
      const u1 = Math.max(R(), 1e-9), z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * R()), r = 52.5 * Math.exp(0.3 * z);
      isl.push(new THREE.Matrix4().makeScale(r, r, r).setPosition(p)); }
    inst(g, ball, M(g, '--isletgross', [plane, back], { roughness: 0.85, he: [1 / 9, 0.18] }), isl, 'grossIslet');
    g.userData.stats = { key: SITE.region, density: dens, count: isl.length, lobules: inside.length };
    const near0 = (pts, p) => pts.reduce((b, q) => (q.distanceTo(p) < b.distanceTo(p) ? q : b));
    tag('gross:' + key, g, 'Lobule', near0(inside, new THREE.Vector3(h * 0.4, h * 0.3, h * 0.6))); tag('gross:' + key, g, 'Septum', near0(sept, new THREE.Vector3(-h * 0.3, h * 0.5, h * 0.5)));
    tag('gross:' + key, tree, 'Interlobular duct', sept[edges[Math.floor(edges.length / 4)][1]]); tag('gross:' + key, g, 'Islet', new THREE.Vector3().setFromMatrixPosition(isl[0] || new THREE.Matrix4()));
    scene.add(g); GROSS[key] = g; return g;
  }
  function grossCut(g) { const pl = g.userData.plane, c = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld), view = c.clone().sub(camera.position).normalize();
    pl.normal.copy(view); pl.constant = cutOpen ? -view.dot(c) : 1e6;
    // Islets, ducts and vessels only within 150 um behind the cut (more than an islet's width), like a thick section.
    const bk = g.userData.back; if (bk) { bk.normal.copy(view).negate(); bk.constant = cutOpen ? view.dot(c) + 150 : 1e6; } }
  const COMPARE = { on: false };
  $('compare').addEventListener('click', () => { COMPARE.on = !COMPARE.on; $('compare').textContent = COMPARE.on ? 'Leave the comparison' : 'Compare head, body and tail';
    if (COMPARE.on) { STAGE.mode = 'tissue'; controls.target.set(0, 0, 0); flyTo(28000 / Math.min(1, camera.aspect * 1.2), undefined, 'tissue'); } else flyTo(STOPS.gross, undefined, 'tissue'); });
  document.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    const r = b.dataset.region, d = camera.position.distanceTo(controls.target), back = d < 2500 ? STOPS.tissue : d < 40000 ? STOPS.gross : null;
    if (COMPARE.on) { COMPARE.on = false; $('compare').textContent = 'Compare head, body and tail'; }
    const to = SITE_LIST.findIndex((S0) => S0.region === r && S0.verified); goSite(to, back); }));
  function goSite(to, back) { if (back === null || back === undefined) { setSite(to); return; }
    flight = { legs: [{ d: 90000, mode: 'tissue', then: () => setSite(to) }, { d: 90000 }, { d: back, mode: 'tissue' }], start: null }; }

  { const root = new THREE.Group(); scene.add(root); ['Head', 'Body', 'Tail'].forEach((t, i) => tag('compare', root, t, new THREE.Vector3((i - 1) * 5600, 2700, 0))); }

  // ---------- pickers: step through sites, and through the acini, ducts and islets
  let showSites = true, grossSolid = false;
  $('grosssolid').addEventListener('change', (e) => { grossSolid = e.target.checked; });
  function updatePickers() {
    if (!SITE_LIST.length || site < 0) return; const S0 = SITE_LIST[site];
    $('sitelabel').textContent = `Site ${site + 1} of ${SITE_LIST.length} · ${S0.region} · ${S0.verified ? 'tested block' : 'seed ' + S0.seed}`;
    const a = B.acini[fa], d = B.ducts[fdu];
    const txt = branch === 'acinus' ? `Acinus ${PICK.acinus + 1} of ${PICKS.acinus.length} · ${Math.round(a.r * 2)} µm across, ${a.cells} cells`
      : branch === 'duct' ? `Duct ${PICK.duct + 1} of ${PICKS.duct.length} · ${Math.round(new THREE.Vector3(...d.a).distanceTo(new THREE.Vector3(...d.b)))} µm long, ${Math.round(d.r * 2)} µm across`
      : `Islet of site ${site + 1} of ${SITE_LIST.length} · ${Math.round(B.islet.model ? B.islet.model.diameterUm : B.islet.radiusUm * 2)} µm, ${B.islet.cells.length} cells`;
    $('picklabel').textContent = txt;
  }
  function stepSite(dir) { const n = SITE_LIST.length, to = (site + dir + n) % n, d = camera.position.distanceTo(controls.target);
    if (STAGE.mode !== 'tissue') { setSite(to); return; }   // deep inside: the organ is out of sight, so change in place
    goSite(to, d < 2500 ? STOPS.tissue : d < 40000 ? STOPS.gross : null); }
  $('siteprev').addEventListener('click', () => stepSite(-1)); $('sitenext').addEventListener('click', () => stepSite(1));
  function stepPick(dir) { if (branch === 'islet') { stepSite(dir); return; }
    const n = PICKS[branch].length; PICK[branch] = (PICK[branch] + dir + n) % n; refocus(); }
  $('pickprev').addEventListener('click', () => stepPick(-1)); $('picknext').addEventListener('click', () => stepPick(1));
  $('showsites').addEventListener('change', (e) => { showSites = e.target.checked; });

  // ---------- split screen: two views side by side, each showing its own part
  const PRESETS = {
    'islet-acinus': [['detail', 'islet'], ['detail', 'acinus']], 'islet-duct': [['detail', 'islet'], ['detail', 'duct']], 'acinus-duct': [['detail', 'acinus'], ['detail', 'duct']],
    'beta-acinar': [['cell', 'islet'], ['cell', 'acinus']], 'tissue-cell': [['tissue', null], ['cell', 'acinus']], 'organ-tissue': [['organ', null], ['tissue', null]],
  };
  function setSplit(on) {
    splitOn = on; if (on && !VIEWS[1]) { const v = makeView(1); v.camera.position.copy(VIEWS[0].camera.position); v.controls.target.copy(VIEWS[0].controls.target); v.controls.update(); }
    if (!on) { setFocus(0); if (tour) tour.view = 0; } resize(); VIEWS.forEach((v) => v.el.classList.toggle('focused', splitOn && v.i === focus));
    $('split').setAttribute('aria-pressed', String(on)); $('split').textContent = on ? 'One view' : 'Split screen'; $('presets').style.display = on ? '' : 'none';
  }
  $('split').addEventListener('click', () => setSplit(!splitOn));
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    if (!splitOn) setSplit(true); const was = focus;
    PRESETS[b.dataset.preset].forEach(([lvl, br], k) => { setFocus(k); flyTo(stopFor(lvl, br || branch), br || undefined, MODE_OF[lvl]); save(VIEWS[k]); });
    setFocus(was); }));

  // ---------- flying between levels
  const STOPS = { organ: 2.6e5, gross: 7000, tissue: 1100, detail: 200, cells: 100, cell: 24 };
  const MODE_OF = { organ: 'tissue', gross: 'tissue', tissue: 'tissue', detail: 'structure', cells: 'cells', cell: 'cell' };
  const stopFor = (lvl, br) => (lvl === 'detail' || lvl === 'cells') ? SIZE[br || branch][lvl === 'detail' ? 'whole' : 'cells'] : STOPS[lvl];
  let flight = null;
  function flyTo(dGoal, newBranch, mode) {
    const legs = [];
    if (newBranch && newBranch !== branch && STAGE.mode !== 'tissue') legs.push({ d: 1100, mode: 'tissue', then: () => { branch = newBranch; } }); else if (newBranch) branch = newBranch;
    legs.push({ d: dGoal, mode });
    flight = { legs, start: null };
  }
  function stepFlight(now) {
    if (!flight) return; const leg = flight.legs[0];
    if (!flight.start) { flight.start = now; flight.from = camera.position.distanceTo(controls.target); if (leg.mode) { STAGE.mode = leg.mode; STAGE.locked = true; } }
    const T = reduced ? 1 : Math.min(1, (now - flight.start) / (450 + 230 * Math.abs(lg(leg.d) - lg(flight.from)))), e = T < 0.5 ? 4 * T * T * T : 1 - Math.pow(-2 * T + 2, 3) / 2;
    const d = Math.exp(lg(flight.from) + (lg(leg.d) - lg(flight.from)) * e);
    const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).add(dir.multiplyScalar(d));
    if (T >= 1) { if (leg.then) leg.then(); flight.legs.shift(); flight.start = null; if (!flight.legs.length) { flight = null; STAGE.locked = false; } }
  }
  document.querySelectorAll('.ladder button').forEach((b) => b.addEventListener('click', () => {
    const [lvl, br] = b.dataset.go.split(':'); if (br) document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === br)));
    flyTo(stopFor(lvl, br), br, MODE_OF[lvl]); }));
  document.querySelectorAll('[data-branch]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const lv = levelAt(camera.position.distanceTo(controls.target));
    if (STAGE.mode === 'tissue') branch = b.dataset.branch; else flyTo(stopFor(lv, b.dataset.branch), b.dataset.branch, STAGE.mode); }));
  $('reset').addEventListener('click', () => { const lv = levelAt(camera.position.distanceTo(controls.target)); flyTo(stopFor(lv) || STOPS.organ, undefined, MODE_OF[lv]); });
  // Escape steps back one stage.
  window.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const lv = levelAt(camera.position.distanceTo(controls.target));
    const up = { cell: 'cells', cells: 'detail', detail: 'tissue', tissue: 'organ' }[lv]; if (up) flyTo(stopFor(up), undefined, MODE_OF[up]); });
  $('surround').addEventListener('change', (e) => { surroundings = e.target.checked; });
  document.querySelectorAll('[data-stain]').forEach((b) => b.addEventListener('click', () => { stain = b.dataset.stain;
    document.querySelectorAll('[data-stain]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); document.body.dataset.stain = stain; }));

  // ---------- toggles
  const TOGGLES = { acinar: ['acinar', 'nucleus', 'granule'], duct: ['intercalated', 'intralobular', 'ductNucleus', 'cac', 'cacNucleus'], capillary: ['capillary', 'node'], redcell: ['redcell'], stroma: ['fibre', 'stellate', 'stellateNucleus'], islet: ISLET_TYPES.concat(['isletNucleus']) };
  const shown = Object.fromEntries(Object.keys(TOGGLES).map((k) => [k, true]));
  function applyToggles(g) { if (!g) return; g.traverse((o) => { if (!o.isInstancedMesh) return; for (const [k, list] of Object.entries(TOGGLES)) if (list.includes(o.name)) o.visible = shown[k]; }); }
  document.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => { shown[el.dataset.toggle] = el.checked; applyToggles(groups.block); Object.values(BRANCHES).forEach((b) => applyToggles(b.detail)); }));
  $('islets').addEventListener('change', (e) => { if (islets) islets.visible = e.target.checked; pancreasMeshes.forEach((m) => { m.material.userData.base = e.target.checked ? 0.3 : 0.92; }); });
  $('cut').addEventListener('input', (e) => { const v = +e.target.value; planes.block.constant = v >= 150 ? 1e6 : v; blockSides(); });
  let cutOpen = false;   // whole structures by default; tick Cut open to see inside
  $('cutopen').addEventListener('change', (e) => { cutOpen = e.target.checked; });
  // The cutaway always faces the viewer: it passes through the point being zoomed into and removes what lies in front.
  // A duct is opened lengthwise: its cut also contains the duct's axis.
  function updateCut(b) {
    const view = controls.target.clone().sub(camera.position).normalize();
    if (b === BRANCHES.duct) { view.sub(Dax.clone().multiplyScalar(view.dot(Dax))); if (view.lengthSq() < 1e-6) view.copy(Y); view.normalize(); }
    b.plane.normal.copy(view); b.plane.constant = cutOpen ? -view.dot(controls.target) : 1e6;
  }

  // ---------- slice apart: cut the organ or the block into parallel slabs and spread them, like serial sections
  const SLICE = { value: 0, organ: null, block: null };
  function sliceSet(src, n, lo, hi, axis, skip, margin = 0) {
    const set = new THREE.Group(); set.userData.mats = []; set.userData.slabs = []; src.updateMatrixWorld(true);
    const th = (hi - lo) / n;
    for (let k = 0; k < n; k++) {
      const slab = new THREE.Group(), pA = new THREE.Plane(axis.clone(), 0), pB = new THREE.Plane(axis.clone().negate(), 0);
      src.traverse((o) => { if (!o.isMesh || skip.includes(o.name) || o.visible === false) return;
        const mat = o.material.clone(); mat.clippingPlanes = [pA, pB]; mat.userData = Object.assign({}, o.material.userData); set.userData.mats.push(mat);
        let m;
        if (o.isInstancedMesh) {   // each slab draws only the instances near it, so slicing costs about one block, not six
          const keep = [], tmp = new THREE.Matrix4(), ax = axis, lo_ = lo + k * th - margin, hi_ = lo + (k + 1) * th + margin;
          for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, tmp); const c = ax.x * tmp.elements[12] + ax.y * tmp.elements[13] + ax.z * tmp.elements[14]; if (c >= lo_ && c <= hi_) keep.push(tmp.clone()); }
          if (!keep.length) return;
          m = new THREE.InstancedMesh(o.geometry, mat, keep.length); keep.forEach((x, i) => m.setMatrixAt(i, x)); m.instanceMatrix.needsUpdate = true;
        } else m = new THREE.Mesh(o.geometry, mat);
        m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.name = o.name; slab.add(m); });
      set.userData.slabs.push({ slab, pA, pB, lo: lo + k * th, hi: lo + (k + 1) * th, k }); set.add(slab);
    }
    Object.assign(set.userData, { n, axis, th }); scene.add(set); return set;
  }
  function layoutSlices(set, spacing) { const { n, axis } = set.userData;
    for (const s of set.userData.slabs) { const off = (s.k - (n - 1) / 2) * spacing; s.slab.position.copy(axis).multiplyScalar(off); s.pA.constant = -(s.lo + off); s.pB.constant = s.hi + off; } }
  $('slice').addEventListener('input', (e) => { SLICE.value = +e.target.value; $('slicelabel').textContent = SLICE.value > 0 ? `Slice apart: ${Math.round(SLICE.value * 100)}%` : 'Slice apart'; });

  // ---------- play the journey
  const TOUR = [
    { d: 2.6e5, br: 'acinus', m: 'tissue', say: 'The pancreas lies across the back of the abdomen, behind the stomach. Its head sits in the C-shaped curve of the duodenum, and its neck, body and tail run to the left, the tail reaching towards the spleen. It is two glands in one: an exocrine gland that makes digestive juice, and scattered endocrine islets that release hormones into the blood.' },
    { d: 7000, m: 'tissue', say: 'At low magnification, thin septa of connective tissue divide the gland into lobules, and carry its larger ducts and vessels. Most of each lobule is densely stained exocrine tissue. The islets of Langerhans stand out among it as paler, rounded islands.' },
    { d: 1100, m: 'tissue', say: 'Inside a lobule, grape-like acini bud from a branching tree of small ducts, with capillaries and a little connective tissue between them. The islet sits among the acini without a duct of its own. Its hormones leave through its capillaries.' },
    { d: 210, m: 'structure', say: 'Each acinus is a cluster of pyramidal cells around a tiny central lumen. In an H and E stain, the base of each cell is purple, because it is packed with rough endoplasmic reticulum, and its apex is pink with zymogen granules: the stored digestive enzymes.' },
    { d: 100, m: 'cells', say: 'Pulled apart, the cells show their shape: broad at the base, narrow at the lumen, with a round nucleus near the base. The pale cells left at the centre are centroacinar cells. They are the first cells of the duct, and are found only in the pancreas.' },
    { d: 26, m: 'cell', say: 'Inside one acinar cell, enzymes are made on the rough endoplasmic reticulum, packaged in the Golgi apparatus, and stored as zymogen granules at the apex, until a meal signals their release into the lumen.' },
    { d: 200, br: 'duct', m: 'structure', say: 'Secretions drain from intercalated ducts, which begin inside the acini, into intralobular ducts lined by pale cuboidal cells, and then into interlobular ducts in the septa. Unlike the salivary glands, the pancreas has no striated ducts, and no myoepithelial cells.' },
    { d: 90, m: 'cells', say: 'The duct wall is a single layer of these cells. Together they add the watery, bicarbonate-rich part of pancreatic juice, which neutralises the acid arriving from the stomach.' },
    { d: 22, m: 'cell', say: 'A duct cell has microvilli and a single primary cilium on the surface facing the lumen, and tight junctions that seal it to its neighbours. Channels in that surface, such as CFTR and the exchanger SLC26A6, move chloride and bicarbonate into the duct.' },
    { d: 360, br: 'islet', m: 'structure', say: 'An islet is a compact cluster of endocrine cells in cords, threaded by a rich network of capillaries, with no capsule of its own. In H and E it looks pale, and its cell types cannot be told apart. Special stains, like the cell-type view here, reveal them.' },
    { d: 215, m: 'cells', say: 'In human islets the cell types are intermixed. Beta cells make insulin, alpha cells glucagon, delta cells somatostatin, and PP cells pancreatic polypeptide. Together they keep the level of glucose in the blood in balance.' },
    { d: 24, m: 'cell', say: 'A beta cell takes up glucose, and as glucose rises, it releases insulin from its granules into the nearby capillary. Each granule stores insulin with zinc, in a dense crystalline core.' },
    { d: 2.6e5, m: 'tissue', say: 'From the whole organ to a single cell, the pancreas joins digestion and metabolism in one gland.' },
  ];


  let tour = null;
  let voiceOn = true, voiceRate = 0.88, voiceName = '';
  try { voiceRate = +(localStorage.getItem('pz-rate') || 0.88); voiceName = localStorage.getItem('pz-voice-pro') || ''; } catch (e) { /* storage may be unavailable */ }
  // Prefer the most natural voices a browser offers (neural or enhanced voices), in English.
  // Only clear, measured voices suited to a lecture: Google's UK and US English voices, Microsoft's natural voices and
  // Apple's standard narrators. Novelty and character voices are left out. Google UK English Female is the default.
  const PROFESSIONAL = /^(google uk english (female|male)|google us english)$|microsoft (sonia|libby|ryan|maisie|thomas|aria|jenny|guy|andrew|emma|brian|ava|christopher|michelle|natasha|william)\b|^(daniel|serena|kate|oliver|samantha|moira|karen|tessa|arthur|martha|catherine|gordon)\b/i;
  const RANK = [/^google uk english female$/i, /microsoft sonia.*natural|microsoft libby.*natural/i, /^google uk english male$/i, /natural|neural|online/i, /^(daniel|serena|kate)\b/i, /premium|enhanced/i];
  function englishVoices() { if (!window.speechSynthesis) return []; const en = speechSynthesis.getVoices().filter((x) => /^en([-_]|$)/i.test(x.lang)), pro = en.filter((x) => PROFESSIONAL.test(x.name)); return pro.length ? pro : en; }
  function bestVoice() { const vs = englishVoices(); if (voiceName) { const v = vs.find((x) => x.name === voiceName); if (v) return v; }
    for (const r of RANK) { const v = vs.find((x) => r.test(x.name)); if (v) return v; } return vs[0]; }
  function fillVoices() { const sel = $('voicepick'); if (!sel) return; const vs = englishVoices(), best = bestVoice();
    sel.innerHTML = vs.map((x) => `<option value="${x.name.replace(/"/g, '&quot;')}"${best && x.name === best.name ? ' selected' : ''}>${x.name.replace(/</g, '&lt;')}</option>`).join('') || '<option>No voice available</option>'; }
  if (window.speechSynthesis) { fillVoices(); speechSynthesis.addEventListener('voiceschanged', fillVoices); }
  $('voicepick').addEventListener('change', (e) => { voiceName = e.target.value; try { localStorage.setItem('pz-voice-pro', voiceName); } catch (err) { /* ignore */ } });
  $('voicerate').value = voiceRate; $('ratelabel').textContent = voiceRate.toFixed(2) + '×';
  $('voicerate').addEventListener('input', (e) => { voiceRate = +e.target.value; $('ratelabel').textContent = voiceRate.toFixed(2) + '×'; try { localStorage.setItem('pz-rate', voiceRate); } catch (err) { /* ignore */ } });
  $('voice').addEventListener('change', (e) => { voiceOn = e.target.checked; if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel(); });
  function say(text) {   // spoken a sentence at a time, so the voice pauses naturally between sentences
    tour.speaking = false; tour.readUntil = performance.now() + 900 + text.length * (voiceOn && window.speechSynthesis ? 0 : 45);
    if (!voiceOn || !window.speechSynthesis) return;
    speechSynthesis.cancel(); const v = bestVoice(), parts = text.match(/[^.!?;:]+[.!?;:]+|[^.!?;:]+$/g) || [text];
    tour.speaking = true;
    parts.forEach((p, k) => { const u = new SpeechSynthesisUtterance(p.trim()); u.rate = voiceRate; u.pitch = 0.98; u.volume = 1; if (v) { u.voice = v; u.lang = v.lang; }
      if (k === parts.length - 1) u.onend = u.onerror = () => { if (tour) { tour.speaking = false; tour.readUntil = performance.now() + 600; } };
      speechSynthesis.speak(u); });
  }
  function stopTour() { if (!tour) return; if (window.speechSynthesis) speechSynthesis.cancel(); tour = null; flight = null; STAGE.locked = false; $('play').textContent = 'Play the journey'; $('caption').textContent = ''; }
  function nextTour() { if (!tour) return; if (tour.i >= TOUR.length) { stopTour(); return; } const s = TOUR[tour.i++];
    flyTo(s.d, s.br, s.m); tour.phase = 'fly'; tour.hold = s.hold; $('caption').textContent = s.say; say(s.say);
    if (s.br) document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === s.br))); }
  $('play').addEventListener('click', () => { if (tour) { stopTour(); return; } tour = { i: 0, view: focus }; $('play').textContent = 'Stop'; if (window.speechSynthesis) speechSynthesis.getVoices(); nextTour(); });
  // The journey keeps going while you turn, zoom or click the model; only the Stop button ends it.

  // ---------- names
  let namesOn = true; $('names').addEventListener('change', (e) => { namesOn = e.target.checked; });
  let labelLayer = VIEWS[0].ui.labels, pool = VIEWS[0].ui.pool;
  function drawLabels(set, w) {
    let used = 0; const W = UI.w, H = UI.h, placed = [];
    if (namesOn && set && w > 0.5) for (const o of LABELS[set] || []) {
      const p = o.getWorldPosition(new THREE.Vector3());
      const sl = set === 'organ' ? SLICE.organ : set === 'tissue' ? SLICE.block : null;
      if (sl && sl.visible) { const { n, axis, th } = sl.userData, c = p.dot(axis), s0 = sl.userData.slabs[0];
        const k = Math.max(0, Math.min(n - 1, Math.floor((c - s0.lo) / th))); p.addScaledVector(axis, sl.userData.slabs[k].slab.position.dot(axis)); }
      const v = p.clone().project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, wd = o.userData.label.length * 7 + 14;
      if (placed.some((r) => Math.abs(r[0] - x) < (r[2] + wd) / 2 && Math.abs(r[1] - y) < 20)) continue;
      placed.push([x, y, wd]);
      const el = pool[used] || (pool[used] = labelLayer.appendChild(Object.assign(document.createElement('span'), { className: 'lbl' })));
      el.textContent = o.userData.label; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.display = ''; used++;
    }
    for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
  }

  // ---------- click to identify, isolate or fade a kind of cell
  const KINDS = {
    acinar: ['Acinar cell', 'Makes digestive enzymes; wedge-shaped, apex at the lumen of its acinus.'], nucleus: ['Acinar cell nucleus', 'Round and basal.'], granule: ['Zymogen granule', 'About 1 µm; holds enzymes until release into the lumen.'],
    cac: ['Centroacinar cell', 'A flattened duct cell lining the start of the duct inside the acinus.'], cacNucleus: ['Centroacinar cell nucleus', 'Elongated.'],
    intercalated: ['Intercalated duct cell', 'Low and flat; carries one acinus’s secretion to a larger duct.'], intralobular: ['Intralobular duct cell', 'Cuboidal; secretes bicarbonate-rich fluid.'], ductNucleus: ['Duct cell nucleus', ''],
    capillary: ['Capillary', 'A looping network between acini; the islet has its own dense bed.'], node: ['Capillary', 'A junction in the capillary network.'], redcell: ['Red blood cell', 'About 7.5 µm across, in single file.'],
    fibre: ['Collagen fibre', 'Aligned along ducts and vessels (CODA); looser between acini.'], stellate: ['Stellate cell', 'Spindle-shaped, lying against acini and ducts.'], stellateNucleus: ['Stellate cell nucleus', ''],
    isletNucleus: ['Islet cell nucleus', 'Round and uniform, as islet nuclei look in section.'],
    beta: ['Beta cell', 'Secretes insulin; about half of human islet cells.'], alpha: ['Alpha cell', 'Secretes glucagon; about a third of islet cells.'], delta: ['Delta cell', 'Secretes somatostatin.'], pp: ['PP cell', 'Secretes pancreatic polypeptide.'],
  };
  let selected = null, isolated = false;
  const activeGroups = () => [groups.block, ...Object.values(BRANCHES).map((b) => b.detail), SLICE.block].filter(Boolean);
  function showSelection() {
    const box = $('selection'); if (!selected) { box.hidden = true; return; } box.hidden = false;
    $('selname').textContent = KINDS[selected][0]; $('seltext').textContent = KINDS[selected][1]; $('isolate').textContent = isolated ? 'Show all' : 'Isolate';
    let op = 1; activeGroups().forEach((g) => g.traverse((o) => { if (o.isInstancedMesh && o.name === selected) op = o.material.userData.base; })); $('selop').value = op; }
  function applyIsolate() { activeGroups().forEach((g) => { g.traverse((o) => { if (!o.isInstancedMesh) return; o.visible = isolated ? o.name === selected : true; }); if (!isolated) applyToggles(g); }); }
  onViews('pointerup', (e) => {
    const d = camera.position.distanceTo(controls.target); if (d > 9000 || !down2 || Math.hypot(e.clientX - down2[0], e.clientY - down2[1]) > 5) return;
    const r = VIEWS[focus].el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const targets = []; activeGroups().forEach((g) => { if (g.visible) g.traverse((o) => { if (o.isInstancedMesh && o.visible && KINDS[o.name]) targets.push(o); }); });
    const hit = ray.intersectObjects(targets, false).find((h) => { const m = h.object.material; return !m.clippingPlanes.length || m.clippingPlanes.every((p) => p.distanceToPoint(h.point) >= 0); });
    if (hit) { selected = hit.object.name; isolated = false; applyIsolate(); showSelection(); } });
  let down2 = null; onViews('pointerdown', (e) => { down2 = [e.clientX, e.clientY]; });
  $('isolate').addEventListener('click', () => { isolated = !isolated; applyIsolate(); showSelection(); });
  $('selop').addEventListener('input', (e) => { const v = +e.target.value; activeGroups().forEach((g) => g.traverse((o) => { if (o.isInstancedMesh && o.name === selected) o.material.userData.base = v; })); });
  $('selclose').addEventListener('click', () => { selected = null; isolated = false; applyIsolate(); showSelection(); });

  // ---------- motion: red cells flow along their capillaries (illustrative speed)
  let motionOn = !reduced; $('motion').checked = motionOn; $('motion').addEventListener('change', (e) => { motionOn = e.target.checked; });
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3();
  function flow(g, t) { const f = g && g.visible && g.userData.flow; if (!f || !f.mesh) return;
    f.info.forEach((c, i) => { const s = (c.s + t * 60) % c.L; tmpP.copy(c.a).addScaledVector(c.u, s); tmpM.compose(tmpP, c.q, c.scale); f.mesh.setMatrixAt(i, tmpM); });
    f.mesh.instanceMatrix.needsUpdate = true; }

  // ---------- each frame
  const INFO = {
    organ: 'The HRA reference pancreas (Visible Human Male), about 15 cm long, with its ducts and vessels. Click it to choose where to zoom in, then scroll or pinch toward it.',
    gross: 'A 4 mm piece of the chosen region, at low magnification. Exocrine lobules (faint outlines) are drained by a tree of ducts: a large interlobular duct running between the lobules in the connective-tissue septa, with an artery and vein beside it (drawn beside the large duct only); interlobular ducts branching from it to each lobule; intralobular ducts inside the lobules; and terminal (intercalated) ducts ending in grape-like clusters of acini. Islets are scattered among the acini at the region’s density in the model (twice as dense in the tail; Wang 2013). Real lobules are packed solid with acini: the clusters are drawn sparser so the ducts can be seen. Tick “Show lobules as solid tissue” for the section-like view. Duct calibres, lobule size and septum thickness are typical values not yet sourced.',
    compare: 'Three 4 mm pieces side by side, from the head, body and tail, cut open. The tail holds twice as many islets per mm³ as the head and body (Wang 2013; Hahn 2021). Lobules, septa and islet sizes are drawn the same way in each.',
    tissue: 'A 300 µm block from inside a lobule: an intralobular duct tree; intercalated ducts each ending in a rounded acinus whose cells reach out until they meet a neighbour or a vessel; capillaries with red cells; collagen and stellate cells; an islet. The same representative block appears wherever you zoom in. Choose below what to zoom into next.',
    acinus: 'One acinus on its own, cut open: wedge-shaped acinar cells converge on the lumen like orange segments, zymogen granules at their apices, centroacinar cells lining the duct where it enters, and its intercalated duct leading back to the larger duct it drains into. Zoom on and its cells separate.',
    acinusOld: 'One acinus cut open among its neighbours: wedge-shaped acinar cells converge on the lumen like orange segments, zymogen granules at their apices, centroacinar cells lining the duct where it enters.',
    islet: 'The islet on its own, cut open: beta (green), alpha (magenta), delta (cyan) and PP (amber) cells intermixed along its own dense capillary bed, with no core or mantle, as in human islets (Cabrera 2006; Brissova 2005). Zoom on and its cells separate.',
    isletOld: 'The islet cut open among its acini: beta (green), alpha (magenta), delta (cyan) and PP (amber) cells intermixed along a dense capillary bed, with no core or mantle, as in human islets (Cabrera 2006; Brissova 2005).',
    duct: 'An intralobular duct on its own, opened lengthwise: a single layer of cuboidal duct cells round the lumen. Duct cells secrete the bicarbonate-rich fluid of pancreatic juice, 2 to 3 litres a day (Ishiguro 2012; Hegyi 2015). Zoom on and its cells separate.',
    ductOld: 'An intralobular duct cut lengthwise: a single layer of cuboidal duct cells round the lumen, collagen aligned along it (CODA), intercalated ducts joining it from acini. Duct cells secrete the bicarbonate-rich fluid of pancreatic juice, 2 to 3 litres a day (Ishiguro 2012; Hegyi 2015).',
    acinusCell: 'One acinar cell, in its place in the acinus: rough ER round the basal nucleus makes digestive enzymes, the Golgi packages them, and zymogen granules wait at the apex for release into the lumen (Palade 1975). Organelle sizes and numbers are illustrative.',
    acinusCells: 'The acinus pulled apart into its cells, like the segments of an orange: each wedge-shaped acinar cell slides out along its own axis, carrying its basal nucleus and its apical granules; the centroacinar cells stay at the centre, and the intercalated duct draws back. Zoom on toward one cell to see it alone; zoom out and they close up again.',
    isletCells: 'The islet’s cells drawn apart from its centre so each stands distinct: beta (green), alpha (magenta), delta (cyan) and PP (amber), intermixed as in human islets (Cabrera 2006). Its capillaries stay in place. Zoom on to one beta cell.',
    ductCells: 'The duct wall’s cells lifted off it and spread along it, so each cuboidal duct cell stands distinct. Zoom on to one cell.',
    isletCell: 'One beta cell, in its place in the islet: a central nucleus, Golgi and rough ER that make and package insulin, mitochondria, a primary cilium (in the pancreas only islet and duct cells have one; diIorio 2014), and insulin granules as dark crystalline cores (insulin with zinc; Berclaz 2015) in pale halos. Sizes and numbers illustrative.',
    ductCell: 'One duct cell, in its place in the duct wall: cuboidal, a central nucleus, many mitochondria, microvilli and a primary cilium on the apical surface facing the lumen, a tight-junction belt round its apex, and the basement membrane beneath. CFTR (blue) and the Cl⁻/HCO₃⁻ exchanger SLC26A6 (orange) in the apical membrane carry bicarbonate into the lumen (Steward and Ishiguro 2009); they are drawn as markers, far larger than the molecules.',
  };
  let lastLevel = '';
  const LEVEL_NAMES = (key) => ({ compare: 'Head, body and tail compared', gross: 'Lobules (' + blockRegion + ')', organ: 'Organ', tissue: 'Tissue', acinus: 'Acinus', islet: 'Islet', duct: 'Duct',
    acinusCells: 'Acinar cells, separated', isletCells: 'Islet cells, separated', ductCells: 'Duct cells, separated', acinusCell: 'Acinar cell', isletCell: 'Beta cell', ductCell: 'Duct cell' }[key] || '');
  function viewFrame(now, v) {
    stepFlight(now);
    stageStep(camera.position.distanceTo(controls.target), now);
    if (tour && !flight && v.i === tour.view) { if (tour.phase === 'fly') { tour.phase = 'hold'; tour.until = now + 450; } else if (now > tour.until && !tour.speaking && now > (tour.readUntil || 0)) nextTour(); }
    const d = camera.position.distanceTo(controls.target);
    // Move the target toward the structure being zoomed into, carrying the camera with it.
    const a = anchorAt(d), delta = a.clone().sub(controls.target); controls.target.add(delta); camera.position.add(delta);
    camera.near = Math.max(0.05, d / 60); camera.far = Math.max(d * 300, 2e3); camera.updateProjectionMatrix();
    const w = weights(d);
    fade(groups.organ, w.organ);
    const firsts = ['head', 'body', 'tail'].map((rk) => SITE_LIST.findIndex((S0) => S0.region === rk && S0.verified));
    Object.keys(GROSS).map(Number).concat(firsts, [site]).filter((k, n, a) => a.indexOf(k) === n).forEach((k) => { const ci = firsts.indexOf(k), show = COMPARE.on ? ci >= 0 : (k === site && w.gross > 0.01); if (show) buildGross(k); const g = GROSS[k]; if (!g) return;
      g.position.set(COMPARE.on ? (ci - 1) * 5600 : 0, 0, 0); g.updateMatrixWorld(true); if (show) stainGroup(g);
      if (g.userData.solid) { g.userData.solid.visible = grossSolid; g.userData.tree.visible = !grossSolid; } fade(g, show ? (COMPARE.on ? 1 : w.gross) : 0); if (show) grossCut(g); });
    if (w.block > 0.01) { ensureBlock(); stainGroup(groups.block); if (SLICE.block) stainGroup(SLICE.block); } fade(groups.block, w.block);
    // Slice apart: the organ while it is in view, otherwise the block.
    const slicing = SLICE.value > 0.001, inner = groups.organ.userData.inner;
    if (inner) { const on = slicing && w.organ > 0.01;
      if (on && !SLICE.organ) { const bb = new THREE.Box3(); pancreasMeshes.forEach((m) => bb.expandByObject(m)); bb.expandByScalar(4000); SLICE.organ = sliceSet(inner, 8, bb.min.x, bb.max.x, X.clone(), []); }
      inner.visible = !on; if (SLICE.organ) { fade(SLICE.organ, on ? w.organ : 0); if (on) layoutSlices(SLICE.organ, SLICE.value * SLICE.organ.userData.th * 1.4); } }
    if (groups.block) { const on = slicing && w.block > 0.01 && w.organ < 0.5;
      if (on && !SLICE.block) { SLICE.block = sliceSet(groups.block, 6, -150, 150, X.clone(), ['nucleus', 'granule', 'node', 'stellateNucleus', 'ductNucleus', 'cacNucleus'], 45); applyToggles(SLICE.block); }
      if (on) groups.block.visible = false; if (SLICE.block) { fade(SLICE.block, on ? w.block : 0); if (on) layoutSlices(SLICE.block, SLICE.value * 50 * 1.6); } }
    for (const [k, b] of Object.entries(BRANCHES)) {
      const on = k === branch; if (on && (w.detail > 0.01 || w.cell > 0.01)) ensureBranch(k);
      if (on) updateCut(b);
      if (on) { stainGroup(b.detail); stainGroup(b.cellGroup); }
      fade(b.detail, on ? w.detail : 0); fade(b.cellGroup, on ? w.cell : 0);
      if (on) { setExplode(b.detail, w.explode); if (b.cellGroup) b.cellGroup.position.copy(OFF[k]).multiplyScalar(w.explode);
        if (w.explode > 0.4 || STAGE.mode === 'tissue') b.plane.constant = 1e6; }   // once the cells part, no cut is needed
    }
    if (motionOn) { const t = now / 1000; flow(groups.block, t); flow(BRANCHES[branch].detail, t); }
    if (marker) marker.visible = false;
    { const dots = groups.organ.userData.dots; if (dots) { dots.visible = showSites && w.organ > 0.3; if (dots.visible) { const s = Math.max(250, d * 0.006), m4 = new THREE.Matrix4();
        SITE_LIST.forEach((S0, k) => { const sc = k === site ? s * 1.8 : s; m4.makeScale(sc, sc, sc).setPosition(S0.local); dots.setMatrixAt(k, m4); }); dots.instanceMatrix.needsUpdate = true; } } }   // no focus marker on the organ; clicking still chooses where to zoom in
    const lv = levelAt(d), key = lv === 'detail' ? branch : lv === 'cells' ? branch + 'Cells' : lv === 'cell' ? branch + 'Cell' : lv;
    if (v.i === focus && (lv === 'gross' || lv === 'compare')) { const st = (k) => GROSS[k] && GROSS[k].userData.stats, firsts = ['head', 'body', 'tail'].map((rk) => SITE_LIST.findIndex((S0) => S0.region === rk && S0.verified));
      const txt = lv === 'compare' ? firsts.filter(st).map((k) => `${st(k).key[0].toUpperCase() + st(k).key.slice(1)}: ${st(k).count.toLocaleString('en')} islets in 64 mm³ (${Math.round(st(k).density)} per mm³)`).join('; ') + '.'
        : st(site) ? `This 4 mm piece from site ${site + 1}, in the ${blockRegion}: ${st(site).lobules} lobules and ${st(site).count.toLocaleString('en')} islets (${Math.round(st(site).density)} per mm³).` : '';
      $('grossstats').textContent = txt; }
    if (key !== lastLevel) { lastLevel = key; UI.levelname.textContent = LEVEL_NAMES(key);
     if (v.i === focus) { $('info').textContent = INFO[key];
      document.querySelectorAll('[data-for]').forEach((el) => { el.style.display = el.dataset.for.split(' ').some((x) => x === key || x === lv) ? '' : 'none'; });
      updatePickers();
      document.querySelectorAll('.ladder button').forEach((b) => { const [l, br] = b.dataset.go.split(':'); b.setAttribute('aria-current', String(l === lv && (!br || br === branch))); }); } }
    explodeTags.forEach((o) => o.position.copy(o.userData.base).addScaledVector(o.userData.off, w.explode));
    if (lv === 'compare') drawLabels('compare', 1); else if (lv === 'gross') drawLabels('gross:' + site, w.gross);
    else drawLabels(lv === 'organ' ? 'organ' : lv === 'tissue' ? 'tissue' : key, lv === 'organ' ? w.organ : lv === 'tissue' ? w.block : lv === 'cell' ? w.cell : w.detail);
    // Scale bar
    const wpp = 2 * d * Math.tan(camera.fov * Math.PI / 360) / UI.h, target = wpp * 110, p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * p10).filter((x) => x <= target).pop() || p10; UI.bar.style.width = (nice / wpp) + 'px';
    UI.barlabel.textContent = nice >= 10000 ? `${+(nice / 10000).toPrecision(3)} cm` : nice >= 1000 ? `${+(nice / 1000).toPrecision(3)} mm` : `${+nice.toPrecision(3)} µm`;
    controls.update(); renderer.setViewport(UI.x, 0, UI.w, UI.h); renderer.setScissor(UI.x, 0, UI.w, UI.h); renderer.render(scene, camera);
  }
  function activate(v) { camera = v.camera; controls = v.controls; STAGE = v.STAGE; branch = v.branch; flight = v.flight; lastLevel = v.lastLevel; UI = v.ui; labelLayer = v.ui.labels; pool = v.ui.pool; }
  function save(v) { v.branch = branch; v.flight = flight; v.lastLevel = lastLevel; }
  function setFocus(i) { if (i === focus || !VIEWS[i]) return; save(VIEWS[focus]); focus = i; activate(VIEWS[i]); lastLevel = ''; VIEWS[i].lastLevel = '';
    VIEWS.forEach((v) => v.el.classList.toggle('focused', splitOn && v.i === focus));
    document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === branch))); }
  function frame(now) {
    save(VIEWS[focus]);   // anything the panel changed since the last frame belongs to the focused view
    { const inner = groups.organ.userData.inner; if (inner) { const goal = organLocal.clone().negate(); if (inner.position.distanceTo(goal) > 1) { inner.position.lerp(goal, reduced ? 1 : 0.08); if (SLICE.organ) { scene.remove(SLICE.organ); SLICE.organ = null; } } } }
    renderer.setScissorTest(true); renderer.setClearColor(0x000000, 0); renderer.setScissor(0, 0, stage.clientWidth, stage.clientHeight); renderer.clear();
    const n = splitOn ? 2 : 1;
    for (let k = 0; k < n; k++) { const v = VIEWS[k]; activate(v); viewFrame(now, v); save(v); }
    activate(VIEWS[focus]);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
  buildOrgan().then(() => { camera.position.set(0, 0.25, 1).normalize().multiplyScalar(STOPS.organ); controls.target.set(0, 0, 0); controls.update(); $('status').style.display = 'none'; renderer.setAnimationLoop(frame); })
    .catch((e) => { $('status').textContent = 'The organ could not be read: ' + e; });
  window.__zoom = { split: setSplit, focus: setFocus, views: () => VIEWS.map((v) => [v.STAGE.mode, v.branch, Math.round(v.camera.position.distanceTo(v.controls.target))]), stage: () => STAGE.mode, flyTo, setBranch: (k) => { branch = k; }, distance: () => camera.position.distanceTo(controls.target) };
})();


