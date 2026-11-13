(() => {
  // One world, in micrometres. The zoom point on the organ is the origin; the tissue block is centred there, and each
  // finer level sits inside the coarser one at true scale. Levels fade in and out with the camera's distance, so zooming
  // is one continuous movement from the organ to a single cell.
  // One tissue block per region of the gland, each built independently (scripts/human/build_tissue_block.py <region>).
  const BLOCKS = { body: JSON.parse(document.getElementById('block').textContent), head: JSON.parse(document.getElementById('block-head').textContent), tail: JSON.parse(document.getElementById('block-tail').textContent) };
  let B = BLOCKS.body, blockRegion = 'body';
  // Thirty tissue sites through the gland, ten per region, each showing its region's tested block (see blockOf).
  const SITE_LIST = []; let site = -1;
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
    if (!PICKS.acinus.length) PICKS.acinus = fps(B.acini.map((a, i) => ({ i, p: new THREE.Vector3(...a.centre) })).sort((a, b) => a.p.length() - b.p.length()), 25);   // a generated block may have none clear of a large islet
    if (!PICKS.duct.length) PICKS.duct = [B.ducts.findIndex((d) => d.kind === 'intralobular')];
  }
  const ORG = JSON.parse(document.getElementById('organ').textContent);
  const V = Object.fromEntries(Object.entries(B.parameters).map(([k, p]) => [k, p.value]));
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const col = (n) => new THREE.Color(css(n));
  const stage = $('stage');
  if (!window.THREE || !THREE.OrbitControls || !THREE.GLTFLoader) { $('status').textContent = 'The 3D library did not load. Check the connection and reload the page.'; return; }
  THREE.ColorManagement.legacyMode = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 1.5, alpha: true });   // a dense screen is smooth enough without multisampling, which costs most in the cell views
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
    el.innerHTML = '<div class="labels" aria-hidden="true"></div><div class="levelname" aria-live="polite"></div><div class="hovername" hidden aria-live="polite"></div><div class="scale"><div class="bar"></div><span class="barlabel"></span></div>';
    stage.appendChild(el);
    const c = cam || new THREE.PerspectiveCamera(32, 1, 1, 1e7), ctr = new THREE.OrbitControls(c, el);
    ctr.enableDamping = !reduced; ctr.minDistance = 4; ctr.maxDistance = 6.5e5; ctr.zoomSpeed = 0.9; ctr.enablePan = false;
    const v = { i, el, camera: c, controls: ctr, STAGE: { mode: 'tissue', detail: 0, explode: 0, cell: 0, last: 0, anchor: new THREE.Vector3(), locked: false }, branch: 'acinus', flight: null, lastLevel: '',
      ui: { labels: el.querySelector('.labels'), pool: [], levelname: el.querySelector('.levelname'), hover: el.querySelector('.hovername'), bar: el.querySelector('.bar'), barlabel: el.querySelector('.barlabel'), x: 0, w: 1, h: 1 } };
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
  const roundedBoxLo = (() => { const g = new THREE.SphereGeometry(1, 10, 8), p = g.getAttribute('position'), f = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.32);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i)), f(p.getY(i)), f(p.getZ(i))); g.computeVertexNormals(); return g; })();
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
    const he = extra.he === undefined ? [0.9, 0.16] : extra.he, layer = extra.layer; delete extra.he; delete extra.layer;
    const m = new Ctor(Object.assign({ color: color.startsWith('--') ? col(color) : new THREE.Color(color), roughness: 0.55, clippingPlanes: planes || [] }, extra));
    m.envMapIntensity = 0.22;   // a matte, evenly lit look, like light through a slide
    m.userData.colorKey = color;
    if (he && !m.transparent) heify(m, he[0], he[1]);
    if (layer) layered(m, layer[0], layer[1]);
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

  // ---------- layers opened in place, after MouseBio_3D's zoom-unfold. At the chosen site a line goes into the gland. As
  // you zoom, the organ's surface opens a round hole on that line; inside it the lobules stand cut across, with their own,
  // smaller opening onto the duct tree of the lobules near the site; that opens in turn onto a core of the tissue. Each
  // outer layer stays as a ring round the next, and closes again as you zoom out. Ducts and vessels of the organ are not cut.
  // Layer coordinates: z along the line, outwards, from the site; r, the distance from the line.
  //   0 organ surface: a hole of radius R.x
  //   1 solid lobules: inside R.x; a hole of radius R.y above the floor F.x, flaring out above the duct tree (top S.x,
  //     slope S.y) like a crater, so its wall does not close the view; nothing above C (comparison only)
  //   2 duct tree: inside R.y; a hole of radius R.z above F.y, flaring out above the core's top (slope S.z)
  //   3 tissue core: inside R.z, within a sphere of radius F.z, below the flat top F.w
  const LAYER = { R: { value: new THREE.Vector4() }, F: { value: new THREE.Vector4(-2000, -145, 145, 40) }, S: { value: new THREE.Vector4(2000, 0, 0, 0) }, C: { value: 1e9 } }, ORG_TOL = { value: new THREE.Matrix4() };
  function layered(m, layer, toL) {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r);
      Object.assign(sh.uniforms, { uToL: toL, uLR: LAYER.R, uLF: LAYER.F, uLS: LAYER.S, uLC: LAYER.C });
      sh.vertexShader = 'varying vec3 vLW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 lwP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lwP = instanceMatrix * lwP;
        #endif
        vLW = (modelMatrix * lwP).xyz;`);
      sh.fragmentShader = `#define LAYER ${layer}\nvarying vec3 vLW; uniform mat4 uToL; uniform vec4 uLR; uniform vec4 uLF; uniform vec4 uLS; uniform float uLC;\n` + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec3 lq = (uToL * vec4(vLW, 1.0)).xyz; float lr = length(lq.xy);
        #if LAYER == 0
          if (lr < uLR.x) discard;
        #elif LAYER == 1
          if (lr > uLR.x || (lr < uLR.y + max(0.0, lq.z - uLS.x) * uLS.y && lq.z > uLF.x) || lq.z > uLC) discard;
        #elif LAYER == 2
          if (lr > uLR.y || (lr < uLR.z + max(0.0, lq.z - uLF.w) * uLS.z && lq.z > uLF.y)) discard;
        #else
          if (lr > uLR.z || length(lq) > uLF.z || lq.z > uLF.w) discard;
        #endif`);
    };
    m.customProgramCacheKey = () => prevKey.call(m) + '|layer' + layer;
    m.side = THREE.DoubleSide;   // cut surfaces show their inside
  }
  /** Whether a point of the tissue lies in the core as now opened (for names and picking). */
  function inCore(p) { const q = p.clone().applyMatrix4(ORG_TOL.value); return Math.hypot(q.x, q.y) < LAYER.R.value.z + 2 && q.length() < LAYER.F.value.z + 2 && q.z < LAYER.F.value.w + 2; }

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
  function buildTissue(planes, keep, focal, skip, layer) {
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
    const g = new THREE.Group(), add = (name, geo, color, extra) => { if (out[name].length) inst(g, geo, M(g, color, planes, layer ? Object.assign({}, extra, { layer }) : extra), out[name], name); };
    add('acinar', wedge, '#ffffff', { vertexColors: true, roughness: 0.75, he: [1.1, 0.2] });
    add('nucleus', lowball, '--nucleus'); add('granule', lowball, '--granule', { roughness: 0.35 });
    add('cac', ball, '--cac'); add('cacNucleus', ball, '--cacnucleus');
    const box = layer ? roundedBoxLo : roundedBox;   // the block's duct cells are a few pixels across
    add('intercalated', box, '--intercalated'); add('intralobular', box, '--intralobular'); add('ductNucleus', lowball, '--ductnucleus');
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
      g.userData.route = [F.clone(), new THREE.Vector3(...ic.b), ...chain.map((seg) => new THREE.Vector3(...seg.a))];   // the way out, for the moving enzymes
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
    g.userData.explode = -1;
    // Secretion in motion at this level: enzymes leave the acinus by its ducts; fluid runs along the duct's lumen.
    if (k === 'acinus' || k === 'duct') {
      const N = 90, m = movers(g, g, lowball, k === 'acinus' ? '--enzyme' : '--bicarbonate', N, k === 'acinus' ? 'enzyme' : 'bicarbonate');
      const route = k === 'acinus' ? g.userData.route : [Da, Db], len = [0]; for (let i = 1; i < route.length; i++) len.push(len[i - 1] + route[i].distanceTo(route[i - 1]));
      const lumenR = k === 'duct' ? Math.max(0.5, Dseg.r - Math.min(V.intralobularCellHeightUm, 0.5 * Dseg.r) - 0.6) : 0.6, ax = route[route.length - 1].clone().sub(route[0]).normalize();
      const u = new THREE.Vector3().crossVectors(ax, Math.abs(ax.y) < 0.9 ? Y : X).normalize(), w = new THREE.Vector3().crossVectors(ax, u), total = len[len.length - 1];
      g.userData.anim = (t) => { m.visible = t !== null && g.userData.explode < 0.05; if (!m.visible) return;
        for (let i = 0; i < N; i++) { const at = frac(t / 7 + i / N) * total; let j = 1; while (j < len.length - 1 && len[j] < at) j++;
          V3.lerpVectors(route[j - 1], route[j], (at - len[j - 1]) / Math.max(1e-6, len[j] - len[j - 1])).addScaledVector(u, Math.cos(i * 2.4) * lumenR * ((i * 7) % 10) / 10).addScaledVector(w, Math.sin(i * 2.4) * lumenR * ((i * 7) % 10) / 10);
          put(m, i, V3, k === 'acinus' ? 0.35 : 0.5); }
        m.instanceMatrix.needsUpdate = true; };
    }
    return g;
  }
  function setExplode(g, e) { if (!g || Math.abs(g.userData.explode - e) < 0.002) return; g.userData.explode = e; const M4 = new THREE.Matrix4();
    g.traverse((o) => { if (!o.isInstancedMesh || !o.userData.base) return; o.userData.base.forEach((b, i) => { M4.copy(b); const f = o.userData.off[i]; M4.elements[12] += f.x * e; M4.elements[13] += f.y * e; M4.elements[14] += f.z * e; o.setMatrixAt(i, M4); }); o.instanceMatrix.needsUpdate = true; }); }

  // ---------- focal points: one acinus, one acinar cell, the islet, one beta cell, one duct, one duct cell
  const cutNormal = X.clone();   // every detail is cut by a plane facing +x; the camera looks from +x
let isletKind = 'beta';   // the islet cell shown at the cell level: beta, alpha or delta
let fa, F, faCells, fc, Pc, I, fb, Pb, fk, Pk, fdu, Dseg, Da, Db, D, Dax, dCells, fdc, Pd, OFF;
  function computeFocal() {
    makePicks(); fa = PICKS.acinus[PICK.acinus % PICKS.acinus.length]; let best;
  F = new THREE.Vector3(...B.acini[fa].centre);
  faCells = acinusCells(B.acini[fa]);
  fc = 0; best = -1e9; faCells.forEach((c, i) => { const s = c.world.y - Math.abs(c.world.x + 0.25) * 3; if (s > best) { best = s; fc = i; } });
  Pc = new THREE.Vector3(0, 0.5, 0).applyMatrix4(faCells[fc].m);
  I = new THREE.Vector3(...B.islet.centreUm);
  fb = 0; best = 1e9; B.islet.cells.forEach(([t, x, y, z], i) => { if (t !== 'beta') return; const p = new THREE.Vector3(x, y, z), s = Math.abs(p.x - (I.x - 3)) + 0.3 * Math.hypot(p.y - I.y, p.z - I.z); if (s < best) { best = s; fb = i; } });
  Pb = new THREE.Vector3(...B.islet.cells[fb].slice(1));
  // The cell of the chosen kind nearest the cut through the islet's middle (a beta cell if the islet has none of that kind).
  fk = fb; best = 1e9; B.islet.cells.forEach(([t, x, y, z], i) => { if (t !== isletKind) return; const p = new THREE.Vector3(x, y, z), s = Math.abs(p.x - (I.x - 3)) + 0.3 * Math.hypot(p.y - I.y, p.z - I.z); if (s < best) { best = s; fk = i; } });
  if (B.islet.cells[fk][0] !== isletKind) isletKind = 'beta';   // this islet has no cell of that kind
  Pk = new THREE.Vector3(...B.islet.cells[fk].slice(1));
  fdu = PICKS.duct[PICK.duct % PICKS.duct.length];
  Dseg = B.ducts[fdu]; Da = new THREE.Vector3(...Dseg.a); Db = new THREE.Vector3(...Dseg.b); D = Da.clone().add(Db).multiplyScalar(0.5); Dax = Db.clone().sub(Da).normalize();
  dCells = ductCells(Dseg);
  fdc = 0; best = 1e9; dCells.forEach((c, i) => { const s = Math.abs(c.c.x - D.x + 2) + 0.5 * c.c.distanceTo(D) - 3 * c.rad.y; if (s < best) { best = s; fdc = i; } });
  Pd = dCells[fdc].c.clone();
  OFF = { acinus: faCells[fc].world.clone().multiplyScalar(0.38 * faCells[fc].reach), islet: Pk.clone().sub(I).multiplyScalar(0.4),
    duct: dCells[fdc].rad.clone().multiplyScalar(dCells[fdc].h * 0.9).addScaledVector(dCells[fdc].ax, dCells[fdc].c.clone().sub(D).dot(dCells[fdc].ax) * 0.25) };
  }
  computeFocal();

  // ---------- names: invisible markers placed in the scene, shown as labels when names are on
  const LABELS = {};
  function tag(set, parent, text, pos) { if (!pos) return null; const o = new THREE.Object3D(); o.position.copy(pos); o.userData.label = text; parent.add(o); if (set === 'tissue') o.userData.check = inCore; (LABELS[set] = LABELS[set] || []).push(o); return o; }

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
    // Secretion in motion: granules leave the Golgi, mature on the way to the apex and fuse with it; their enzymes pass into the
    // lumen at the acinus's centre and on down its intercalated duct (along the acinus's -z axis).
    const NZ = 30, NE = 60, zg = movers(group, g, lowball, '--granule', NZ, 'granule', { roughness: 0.35 }), en = movers(group, g, lowball, '--enzyme', NE, 'enzyme');
    const qi = c.q.clone().invert(), centre = c.local.clone().multiplyScalar(-lumen).applyQuaternion(qi), down = new THREE.Vector3(0, 0, -1).applyQuaternion(qi);
    const gStart = (i) => P(0.46).add(new THREE.Vector3(Math.cos(i * 2.4), 0, Math.sin(i * 2.4)).multiplyScalar(prof(0.46) * 0.45 * (((i * 31) % 7) / 7)));
    const gApex = (i) => P(0.03).add(new THREE.Vector3(Math.cos(i * 1.7), 0, Math.sin(i * 1.7)).multiplyScalar(prof(0.03) * 0.5 * (((i * 13) % 5) / 5)));
    const gs = V.zymogenGranuleDiameterUm / 2;
    group.userData.anim = (t) => {
      zg.visible = en.visible = t !== null; if (t === null) return;
      for (let i = 0; i < NZ; i++) { const f = frac(t / 6 + i / NZ); if (f < 0.82) { const e = ease(f / 0.82); put(zg, i, V3.lerpVectors(gStart(i), gApex(i), e), gs * (0.55 + 0.45 * e)); } else put(zg, i, gApex(i), f < 0.92 ? gs * (1 - (f - 0.82) / 0.1) : 0); }
      for (let i = 0; i < NE; i++) { const f = frac(t / 3.5 + i / NE), a = gApex(i % NZ);
        if (f < 0.35) V3.lerpVectors(a, centre, f / 0.35); else V3.copy(centre).addScaledVector(down, (f - 0.35) / 0.65 * 14);
        put(en, i, V3, 0.12 * (f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2)); }
      zg.instanceMatrix.needsUpdate = en.instanceMatrix.needsUpdate = true;
    };
    // Place it where the cell really is: the acinus frame, then the cell's own direction, apex at the lumen.
    const T = new THREE.Matrix4().compose(new THREE.Vector3(...B.acini[fa].centre), new THREE.Quaternion(...B.acini[fa].q), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().compose(c.local.clone().multiplyScalar(lumen), c.q, new THREE.Vector3(1, 1, 1)));
    tag('acinusCell', g, 'Nucleus', P(0.7).add(new THREE.Vector3(prof(0.7) * 0.42, 0, 0))); tag('acinusCell', g, 'Rough ER', P(0.86).add(new THREE.Vector3(-prof(0.86) * 0.5, 0, 0)));
    tag('acinusCell', g, 'Golgi', P(0.5).add(new THREE.Vector3(1.6, 0, 0))); tag('acinusCell', g, 'Zymogen granules', P(0.2)); tag('acinusCell', g, 'Lumen', P(-0.03)); tag('acinusCell', g, 'Mitochondria', P(0.4).add(new THREE.Vector3(-prof(0.4) * 0.6, 0, 0)));
    g.applyMatrix4(T); group.add(g);
  }
  // ---------- secretion in motion (illustrative): particles moved each frame along simple paths
  const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }, frac = (x) => x - Math.floor(x);
  function movers(group, parent, geo, color, n, name, extra) { const m = inst(parent, geo, MP(group, color, null, extra || { roughness: 0.4, he: false }), Array.from({ length: n }, () => new THREE.Matrix4().makeScale(0, 0, 0)), name); m.frustumCulled = false; m.userData.mover = true; return m; }
  const M4 = new THREE.Matrix4(), V3 = new THREE.Vector3();
  function put(m, i, p, sc) { M4.makeScale(sc, sc, sc).setPosition(p); m.setMatrixAt(i, M4); }
  function nearestIsletCapillary(p) { let best = null;
    B.capillaries.isletSegments.forEach(([a, b]) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), u = Bv.clone().sub(A), t = THREE.MathUtils.clamp(p.clone().sub(A).dot(u) / u.lengthSq(), 0, 1), q = A.addScaledVector(u, t), d = q.distanceTo(p);
      if (!best || d < best.d) best = { d, point: q, dir: u.normalize() }; });
    return best || { d: 8, point: p.clone().add(new THREE.Vector3(8, 0, 0)), dir: Y.clone() }; }
  // ---------- one islet cell of the chosen kind, in its place in the islet beside its capillary. Granules differ by kind:
  // beta, about 350 nm, a dark (in humans sometimes crystalline) core in a clear halo; alpha, about 200 nm, dense, with little
  // or a grey halo; delta, about 250 nm, homogeneous (Brereton et al. 2015). Delta cells reach neighbouring cells with long
  // processes, 1 to 18 um in human sections (Arrojo e Drigo et al. 2019). Cell size and granule numbers are illustrative.
  const GRANULES = {
    beta: { core: '--insulincore', halo: '--insulinhalo', r: 0.1, h: 0.175, n: 240, label: 'Insulin granules', hormone: '--insulin', name: 'insulin' },
    alpha: { core: '--glucagoncore', halo: '--glucagonhalo', r: 0.085, h: 0.1, n: 240, label: 'Glucagon granules', hormone: '--glucagon', name: 'glucagon' },
    delta: { core: '--somatostatincore', halo: null, r: 0.125, h: 0, n: 200, label: 'Somatostatin granules', hormone: '--somatostatin', name: 'somatostatin' } };
  const cellKey = (br, kind) => (br === 'islet' && kind && kind !== 'beta' ? kind + 'Cell' : br + 'Cell');
  function buildIsletCell(group, kind) {
    const G = GRANULES[kind] || GRANULES.beta, set = cellKey('islet', kind), g = new THREE.Group(), R = 5;
    const body = new THREE.Mesh(roundedBoxHi, MP(group, '--' + kind, null, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })); body.material.userData.isletType = kind; body.scale.set(R, R * 0.92, R * 0.88); g.add(body);
    const nuc = new THREE.Mesh(ballHi, MP(group, '--nucleus')); nuc.scale.setScalar(2.1); nuc.position.set(-0.6, 0.2, 0); g.add(nuc);
    const nl = new THREE.Mesh(ballHi, MP(group, '--nucleolus')); nl.scale.setScalar(0.5); nl.position.set(-0.1, 0.7, 0.5); g.add(nl);
    const gol = MP(group, '--golgi');
    for (let k = 0; k < 5; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.8 + k * 0.17, 0.07, 6, 28, Math.PI * 0.9), gol); t.position.set(1.4, 1.6 + k * 0.13, 0.2); t.rotation.set(Math.PI / 2 + 0.3, 0, 0.8); g.add(t); }
    const rer = MP(group, '--rer', null, { side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(2.6 + k * 0.3, 0.06, 6, 40, Math.PI * 0.8), rer); t.position.set(-0.6, 0.2, 0); t.rotation.set(Math.PI / 2, 0, Math.PI * 0.75 + k * 0.05); g.add(t); }
    const core = MP(group, G.core, null, { roughness: 0.3 }), halo = G.halo ? MP(group, G.halo, null, { transparent: true, opacity: 0.35, depthWrite: false }) : null;
    const inside = (p) => (p.x / (R * 0.85)) ** 2 + (p.y / (R * 0.78)) ** 2 + (p.z / (R * 0.75)) ** 2 < 1 && p.distanceTo(nuc.position) > 2.6;
    const spots = [];
    for (let k = 0; spots.length < G.n && k < 6000; k++) { const p = new THREE.Vector3(((k * 7919) % 1000) / 500 - 1, ((k * 104729) % 1000) / 500 - 1, ((k * 1299709) % 1000) / 500 - 1).multiplyScalar(R); if (inside(p)) spots.push(p); }
    inst(g, lowball, core, spots.map((p) => new THREE.Matrix4().makeScale(G.r, G.r, G.r).setPosition(p)), 'secretoryCore');
    if (halo) inst(g, ballHi, halo, spots.map((p) => new THREE.Matrix4().makeScale(G.h, G.h, G.h).setPosition(p)), 'secretoryHalo');
    const mito = MP(group, '--mito'), mg = new THREE.CapsuleGeometry(0.2, 0.9, 4, 8);
    for (let i = 0, n = 0; n < 12 && i < 2000; i++) { const p = new THREE.Vector3(((i * 31) % 97) / 48.5 - 1, ((i * 57) % 89) / 44.5 - 1, ((i * 73) % 83) / 41.5 - 1).multiplyScalar(R * 0.8);
      if (!inside(p)) continue; n++; const m = new THREE.Mesh(mg, mito); m.position.copy(p); m.rotation.set(i, i * 1.7, i * 0.3); g.add(m); }
    const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), MP(group, '--cilium')); cil.position.set(0, R * 0.95 + 1.1, 0.4); cil.rotation.z = 0.3; g.add(cil);
    // Its capillary, a short length of the nearest one in the islet.
    const cap = nearestIsletCapillary(Pk), capAt = cap.point.clone().sub(Pk), rc = V.capillaryRadiusUm;
    inst(g, rod, MP(group, '--capillary', null, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, he: false }), [rodMatrix(capAt.clone().addScaledVector(cap.dir, -16), capAt.clone().addScaledVector(cap.dir, 16), rc)], 'capillary');
    const toCap = capAt.clone().normalize(), u = new THREE.Vector3().crossVectors(toCap, Math.abs(toCap.y) < 0.9 ? Y : X).normalize(), w = new THREE.Vector3().crossVectors(toCap, u);
    // Release sites: beta and alpha cells release toward the capillary; a delta cell at the ends of its processes, next to its neighbours.
    let sites = [];
    if (kind === 'delta') {
      const others = B.islet.cells.map(([t, x, y, z], i) => [i, new THREE.Vector3(x, y, z)]).filter(([i]) => i !== fk).sort((p, q) => p[1].distanceTo(Pk) - q[1].distanceTo(Pk)).slice(0, 4);
      const pm = MP(group, '--delta', null, { transparent: true, opacity: 0.6 });
      others.forEach(([, q], k) => { const local = q.clone().sub(Pk), dn = local.clone().normalize(), base = dn.clone().multiplyScalar(R * 0.8), tip = local.clone().addScaledVector(dn, -R * 0.9);
        const side = new THREE.Vector3().crossVectors(dn, k % 2 ? Y : Z).normalize().multiplyScalar(1.2), mid = base.clone().lerp(tip, 0.5).add(side);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([base, mid, tip]), 24, 0.32, 8, false), pm));
        const bulb = new THREE.Mesh(ballHi, pm); bulb.position.copy(tip); bulb.scale.setScalar(0.6); g.add(bulb);
        sites.push({ at: base, path: (t, out) => (t < 0.5 ? out.copy(base).lerp(tip, t / 0.5) : out.copy(tip).addScaledVector(dn, (t - 0.5) * 6).addScaledVector(side, Math.sin(t * 9 + k) * 0.4)) });
        if (k === 0) tag(set, g, 'Process reaching a neighbouring cell', mid); });
    } else {
      for (let k = 0; k < 6; k++) { const th = k * 1.05, at = toCap.clone().multiplyScalar(R * 0.8).addScaledVector(u, Math.cos(th) * 1.6).addScaledVector(w, Math.sin(th) * 1.6);
        const along = (k % 2 ? 1 : -1) * (4 + k);
        sites.push({ at, path: (t, out) => (t < 0.45 ? out.copy(at).lerp(capAt, t / 0.45) : out.copy(capAt).addScaledVector(cap.dir, along * (t - 0.45) / 0.55 * 2.2)) }); }
    }
    // Granules travel from inside the cell to a release site and fuse there; the hormone leaves; a beta cell takes up glucose.
    const NG = 24, NH = 48, NGl = kind === 'beta' ? 30 : 0;
    const mg2 = movers(group, g, lowball, G.core, NG, 'secretoryCore', { roughness: 0.3 }), mh = movers(group, g, lowball, G.hormone, NH, G.name), ml = NGl ? movers(group, g, lowball, '--glucose', NGl, 'glucose') : null;
    const from = (i) => spots[(i * 37) % spots.length];
    group.userData.anim = (t) => {
      if (t === null) { [mg2, mh, ml].forEach((m) => { if (m) m.visible = false; }); return; }
      [mg2, mh, ml].forEach((m) => { if (m) m.visible = true; });
      for (let i = 0; i < NG; i++) { const f = frac(t / 5 + i / NG), site = sites[i % sites.length];
        if (f < 0.8) put(mg2, i, V3.lerpVectors(from(i), site.at, ease(f / 0.8)), G.r * 1.3); else put(mg2, i, site.at, f < 0.9 ? G.r * 1.3 * (1 - (f - 0.8) / 0.1) : 0); }
      for (let i = 0; i < NH; i++) { const f = frac(t / 4 + i / NH); sites[i % sites.length].path(f, V3); put(mh, i, V3, 0.09 * (f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25)); }
      if (ml) for (let i = 0; i < NGl; i++) { const f = frac(t / 4.5 + i / NGl), start = capAt.clone().addScaledVector(cap.dir, ((i * 7) % 11 - 5) * 1.6); put(ml, i, V3.lerpVectors(start, from(i * 3), ease(f)), 0.08 * (f < 0.85 ? 1 : 1 - (f - 0.85) / 0.15)); }
      [mg2, mh, ml].forEach((m) => { if (m) m.instanceMatrix.needsUpdate = true; });
    };
    tag(set, g, 'Nucleus', new THREE.Vector3(-0.6, -1.5, 0)); tag(set, g, G.label, new THREE.Vector3(3, -2, 1.5)); tag(set, g, 'Golgi', new THREE.Vector3(1.6, 2.4, 0.2));
    tag(set, g, 'Primary cilium', new THREE.Vector3(0.4, R * 0.95 + 2.3, 0.4)); tag(set, g, 'Mitochondria', new THREE.Vector3(-3, 1.8, 1)); tag(set, g, 'Capillary', capAt.clone().addScaledVector(cap.dir, 9));
    g.position.copy(Pk); group.add(g);
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
    const cf = MP(group, '--cftr'), sl = MP(group, '--slc26'), ports = [];   // apical transporters, drawn as markers far larger than the molecules
    for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(lowball, k % 2 ? sl : cf); m.scale.setScalar(0.16); m.position.set((((k * 37) % 13) / 13 - 0.5) * w * 0.8, -h / 2 + 0.02, (((k * 59) % 11) / 11 - 0.5) * l * 0.8); g.add(m); ports.push(m.position.clone()); }
    // Secretion in motion: bicarbonate leaves through the transporters into the lumen, and the fluid carries it along the duct.
    const NB = 70, hb = movers(group, g, lowball, '--bicarbonate', NB, 'bicarbonate');
    group.userData.anim = (t) => { hb.visible = t !== null; if (t === null) return;
      for (let i = 0; i < NB; i++) { const f = frac(t / 3 + i / NB), a = ports[i % ports.length];
        V3.set(a.x + Math.sin(i * 2.1 + t) * 0.15 * f, a.y - 3.2 * ease(f * 1.6), a.z + Math.max(0, f - 0.3) * 6); put(hb, i, V3, 0.1 * (f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2)); }
      hb.instanceMatrix.needsUpdate = true; };
    const bm = new THREE.Mesh(new THREE.BoxGeometry(w * 1.7, 0.08, l * 1.7), MP(group, '--basement', null, { transparent: true, opacity: 0.6 })); bm.position.set(0, h / 2 + 0.08, 0); g.add(bm);
    tag('ductCell', g, 'Nucleus', new THREE.Vector3(0, h * 0.06, 0)); tag('ductCell', g, 'Microvilli', new THREE.Vector3(w * 0.3, -h / 2 - 0.3, 0)); tag('ductCell', g, 'Primary cilium', new THREE.Vector3(0.2, -h / 2 - 2.6, 0.7));
    tag('ductCell', g, 'Tight junction', new THREE.Vector3(w / 2, -h / 2 + 0.35, 0)); tag('ductCell', g, 'CFTR and SLC26A6', new THREE.Vector3(-w * 0.3, -h / 2, l * 0.2)); tag('ductCell', g, 'Basement membrane', new THREE.Vector3(0, h / 2 + 0.1, l * 0.7));
    tag('ductCell', g, 'Mitochondria', new THREE.Vector3(w * 0.3, h * 0.2, -l * 0.25));
    const x = new THREE.Vector3().crossVectors(c.rad, c.ax);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(x, c.rad, c.ax).setPosition(c.c)); group.add(g);
  }

  const explodeTags = [], labelRoots = [];
  function makeBlockLabels() {
  { const near = (pts, p) => (pts.length ? pts.reduce((b, q) => (q.distanceTo(p) < b.distanceTo(p) ? q : b)) : null);   // null: nothing of that kind in this block
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
  { const root = new THREE.Group(); scene.add(root); labelRoots.push(root); const mv = (set, text, base, off) => { if (!base) return; const o = tag(set, root, text, base); o.userData.base = base.clone(); o.userData.off = off.clone(); explodeTags.push(o); };
    const c0 = faCells[fc], c1 = faCells[(fc + 7) % faCells.length], Q = new THREE.Quaternion(...B.acini[fa].q);
    mv('acinusCells', 'Acinar cell', new THREE.Vector3(0, 0.75, 0).applyMatrix4(c0.m), OFF.acinus); mv('acinusCells', 'Zymogen granules', new THREE.Vector3(0, 0.2, 0).applyMatrix4(c1.m), c1.world.clone().multiplyScalar(0.38 * c1.reach));
    mv('acinusCells', 'Centroacinar cells', F.clone().add(new THREE.Vector3(0, 0, -B.acini[fa].r * 0.5).applyQuaternion(Q)), new THREE.Vector3());
    mv('acinusCells', 'Basal nucleus', new THREE.Vector3(0, 0.7, 0).applyMatrix4(c1.m), c1.world.clone().multiplyScalar(0.38 * c1.reach));
    const firstOf = (t) => B.islet.cells.map((c, i) => [c, i]).filter(([c]) => c[0] === t).map(([c]) => new THREE.Vector3(...c.slice(1))).sort((p, q) => Math.abs(p.x - I.x + 4) + 0.2 * p.distanceTo(I) - Math.abs(q.x - I.x + 4) - 0.2 * q.distanceTo(I))[0];
    mv('isletCells', 'Beta cell', Pb, Pb.clone().sub(I).multiplyScalar(0.4)); ['alpha', 'delta', 'pp'].forEach((t) => { const p = firstOf(t); if (p) mv('isletCells', { alpha: 'Alpha cell', delta: 'Delta cell', pp: 'PP cell' }[t], p, p.clone().sub(I).multiplyScalar(0.4)); });
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
    islet: { name: 'Islet', cellName: 'Beta cell', anchor: I, cell: Pk, normal: cutNormal, keep: (p, r) => p.distanceTo(I) < B.islet.radiusUm + 16 + r * 0.3, build: (g) => buildIsletCell(g, isletKind), focal: { skipIsletCell: fk } },
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
    ['tissue', 'acinus', 'islet', 'duct', 'acinusCells', 'isletCells', 'ductCells', 'acinusCell', 'isletCell', 'alphaCell', 'deltaCell', 'ductCell'].forEach((k) => { delete LABELS[k]; });
    computeFocal(); makeBranches(); makeBlockLabels(); scaleIsletStages(); if (typeof selected !== 'undefined') { selected = null; showSelection(); } updatePickers();
  }
  // Each site shows its region's tested block. In the uncinate process (ventral bud) the islet is PP-rich: PP cells 54–94% of
  // islet volume, displacing most alpha and some beta cells (Gorelick and Williams 2021, ch. 1, Longnecker). Drawn as PP 60%,
  // beta 30%, alpha 5%, delta 5% of cells; the split within that range is an assumption.
  const PP_RICH = { pp: 0.6, beta: 0.3, alpha: 0.05, delta: 0.05 }, VARIANT = {};
  function ppRich(B0) {
    if (VARIANT.uncinate) return VARIANT.uncinate; const R = rng(4807), n = B0.islet.cells.length, order = B0.islet.cells.map((c, i) => [R(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]), type = new Array(n);
    let k = 0; for (const [t, f] of Object.entries(PP_RICH)) { const m = t === 'delta' ? n - k : Math.round(f * n); for (let j = 0; j < m && k < n; j++) type[order[k++]] = t; }
    return (VARIANT.uncinate = Object.assign({}, B0, { islet: Object.assign({}, B0.islet, { cells: B0.islet.cells.map((c, i) => [type[i]].concat(c.slice(1))), composition: 'PP-rich (uncinate process)' }) }));
  }
  function blockOf(i) { const S0 = SITE_LIST[i], B0 = BLOCKS[S0.region]; return S0.sub === 'uncinate process' ? ppRich(B0) : B0; }
  function switchSite(i) {
    if (i === site) return; site = i; blockRegion = SITE_LIST[i].region; B = blockOf(i);
    const drop = (g) => { if (g) scene.remove(g); };
    drop(groups.block); groups.block = null; if (SLICE.block) { drop(SLICE.block); SLICE.block = null; }
    refocus(); orientLayers(); hashNow();
  }
  // The line going in at the site sets the frame of the openings; the flat top of the core passes through the islet.
  function orientLayers() { const S0 = siteAxis(SITE_LIST[site]); ORG_TOL.value.makeRotationFromQuaternion(quatFromTo(S0.axis, Z)); LAYER.F.value.w = THREE.MathUtils.clamp(I.dot(S0.axis), -60, 60);
    if (groups.block) { scene.remove(groups.block); groups.block = null; if (SLICE.block) { scene.remove(SLICE.block); SLICE.block = null; } } }   // the block is cut to the core's frame
  // The block is shown as a core cut from it, so its cut faces are always filled.
  function ensureBlock() { if (!groups.block) { const fw = LAYER.F.value.w, rf = LAYER.F.value.z, q = new THREE.Vector3();
    const inCoreSpan = (p, r) => { q.copy(p).applyMatrix4(ORG_TOL.value); return q.length() - r < rf + 2 && q.z - r < fw + 2; };   // the largest the core can open to
    groups.block = buildTissue([planes.block], inCoreSpan, {}, undefined, [3, ORG_TOL]); groups.block.userData.fw = fw; scene.add(groups.block); } return groups.block; }
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
    septa: '#8f84c9', grossIslet: '#3fcf55', enzyme: '#ffb36b', bicarbonate: '#7ff0f5', glucose: '#fff07a', insulin: '#8dff9a', glucagon: '#ff8ac4', somatostatin: '#8fdcff', secretoryCore: '#e8e8f0', interlobularDuct: '#2cc0c9', interlobularVein: '#ff4d5a', interlobularArtery: '#ff4d5a' };
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
    // The organ stays as a ring round its opening until the ring leaves the view; the lobules are there once the organ opens,
    // and the core once its own opening has begun. Below the tissue the chosen structure takes over, as before.
    return { organ: ramp(d, 4500, 6500), gross: ramp(d, 52000, 44000) * (1 - det), block: (LAYER.R.value.z > 1 ? 1 : 0) * Math.max(1 - det, surroundings ? 0.12 * det : 0), detail: det * (1 - (surroundings ? 0.95 : 1) * ce), cell: ce, explode: ex };
  }
  // How far each layer has opened at a distance: from nothing to nearly half the height of the view at the end of its opening
  // (MouseBio_3D's share, 0.46), growing by equal steps of zoom, and no wider than the layer beneath can fill.
  const Hv = (d) => 2 * d * Math.tan(camera.fov * Math.PI / 360);
  const opening = (d, [a, b]) => { const t = THREE.MathUtils.clamp(Math.log(a / d) / Math.log(a / b), 0, 1); return t * t * (3 - 2 * t); };
  const OPEN = { organ: [45000, 14000], lobules: [12000, 3200], core: [2600, 1000] }, SHARE = 0.46, FLARE = 0.36;   // a slope a little steeper than the view's half-angle
  function setLayers(d) {
    const R = LAYER.R.value, face = Math.sqrt(LAYER.F.value.z ** 2 - LAYER.F.value.w ** 2);
    if (COMPARE.on) { R.set(COL - 100, TREE.xy - 100, 0, 0); LAYER.S.value.set(TREE.z, 0, 0, 0); LAYER.C.value = TREE.z; return; }
    LAYER.C.value = 1e9; LAYER.S.value.set(TREE.z, FLARE * opening(d, OPEN.lobules), FLARE * opening(d, OPEN.core), 0);
    R.set(Math.min(COL - 100, SHARE * Hv(OPEN.organ[1])) * opening(d, OPEN.organ), Math.min(TREE.xy - 300, SHARE * Hv(OPEN.lobules[1])) * opening(d, OPEN.lobules),
      Math.min(face, SHARE * Hv(OPEN.core[1])) * opening(d, OPEN.core), 0);
  }
  // The camera's target drifts from the block's centre to the branch's structure and then to its cell as you zoom in.
  function anchorAt() { return STAGE.anchor.clone(); }
  function levelAt(d) { const m = STAGE.mode; if (COMPARE.on) return 'compare'; return m === 'tissue' ? (d > 16000 ? 'organ' : d > 1800 ? 'gross' : 'tissue') : m === 'structure' ? 'detail' : m; }

  // ---------- the organ, in micrometres, moved so the zoom point sits at the origin
  let pancreasMeshes = [], marker, organLocal = new THREE.Vector3(), region = 'body';
  const SITES = {};   // the middle of each region, inside the organ: where each region's tissue is taken from
  const REGION_NAMES = { head_of_pancreas: 'head', uncinate_process_of_the_pancreas: 'uncinate process', neck_of_pancreas: 'neck', body_of_pancreas: 'body', tail_of_pancreas: 'tail' };
  const REGION_KEYS = { head: 'pancreas-head', 'uncinate process': 'pancreas-uncinate', neck: 'pancreas-neck', body: 'pancreas-body', tail: 'pancreas-tail' };
  async function buildOrgan() {
    const g = await parse(bytesOf('glb-region')); g.scene.updateMatrixWorld(true);
    const grp = groups.organ, inner = new THREE.Group(); grp.add(inner); grp.userData.inner = inner;
    g.scene.traverse((o) => { if (!o.isMesh) return; const n = o.name.slice(5);
      const kind = REGION_NAMES[n] ? 'pancreas' : /duodenal_ampulla|duodenum|spleen/.test(n) ? 'other' : /duct|ampulla|sphincter|bile/.test(n) ? 'duct' : /artery|celiac/.test(n) ? 'artery' : /vein/.test(n) ? 'vein' : 'other';
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld).scale(1e6, 1e6, 1e6), op = kind === 'other' ? 0.22 : kind === 'pancreas' ? 0.92 : 1;
      const m = new THREE.Mesh(geo, M(grp, { pancreas: '--organ', duct: '--organduct', artery: '--artery', vein: '--vein', other: '--neighbour' }[kind], null, { transparent: op < 1, opacity: op, depthWrite: op === 1, side: THREE.DoubleSide, roughness: 0.65, he: false, layer: kind === 'pancreas' || kind === 'other' ? [0, ORG_TOL] : undefined }));
      m.userData = { kind, region: REGION_NAMES[n] }; m.name = n; inner.add(m); if (kind === 'pancreas') pancreasMeshes.push(m);
      if (kind === 'pancreas') { const p = geo.getAttribute('position'), c = new THREE.Vector3(); for (let i = 0; i < p.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(p, i)); SITES[REGION_NAMES[n]] = c.divideScalar(p.count); }
      const ORGAN_NAMES = { head_of_pancreas: 'Head', uncinate_process_of_the_pancreas: 'Uncinate process', ucinate_process1: 'Uncinate process', neck_of_pancreas: 'Neck', body_of_pancreas: 'Body', tail_of_pancreas: 'Tail',
        ventral_pancreatic_duct: 'Main pancreatic duct', common_bile_duct: 'Common bile duct', splenic_vein: 'Splenic vein', superior_mesenteric_vein: 'Superior mesenteric vein', superior_mesenteric_artery: 'Superior mesenteric artery',
        hepatic_portal_vein: 'Portal vein', splenic_artery: 'Splenic artery', duodenum_descending: 'Duodenum', hilum_of_spleen: 'Spleen' };
      if (ORGAN_NAMES[n]) { geo.computeBoundingBox(); tag('organ', inner, ORGAN_NAMES[n], geo.boundingBox.getCenter(new THREE.Vector3())); } });
    // The organs round the pancreas, from the same HRA body model (scripts/human/extract_neighbours.py): liver, gallbladder,
    // kidneys and their vessels, aorta, inferior vena cava, transverse colon. The HRA v2.0 model has no stomach or adrenals.
    const NEIGH = { liver_capsule: ['Liver', '#9c4f45'], gallbladder: ['Gallbladder', '#5f8a3a'], kidney_capsule_L: ['Left kidney', '#8e5466'], kidney_capsule_R: ['Right kidney', '#8e5466'],
      renal_vein_L: [null, '--vein'], renal_vein_R: [null, '--vein'], left_renal_artery: [null, '--artery'], right_renal_artery: [null, '--artery'], descending_aorta_a: ['Aorta', '--artery'], descending_aorta_b: [null, '--artery'],
      inferior_vena_cava_a: ['Inferior vena cava', '--vein'], inferior_vena_cava_b: [null, '--vein'], transverse_colon: ['Transverse colon', '#b98e7c'], hepatic_flexure_of_colon: [null, '#b98e7c'], splenic_flexure_of_colon: [null, '#b98e7c'] };
    const ng = await parse(bytesOf('glb-neighbours')); ng.scene.updateMatrixWorld(true); const neigh = new THREE.Group(); neigh.name = 'neighbours'; neigh.visible = $('neighbours').checked; inner.add(neigh); grp.userData.neighbours = neigh;   // hidden until asked for
    ng.scene.traverse((o) => { if (!o.isMesh) return; const n = o.name.slice(5), info = NEIGH[n]; if (!info) return; const solid = /aorta|vena|renal_(vein|artery)|renal_artery/.test(n);
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld).scale(1e6, 1e6, 1e6), m = new THREE.Mesh(geo, M(grp, info[1], null, { transparent: true, opacity: solid ? 0.5 : 0.12, depthWrite: false, side: THREE.DoubleSide, roughness: 0.65, he: false, layer: [0, ORG_TOL] }));
      m.name = n; m.userData = { kind: 'neighbour' }; neigh.add(m); if (info[0]) { geo.computeBoundingBox(); tag('organ', neigh, info[0], geo.boundingBox.getCenter(new THREE.Vector3())); } });
    marker = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2500, 20, 14), new THREE.MeshBasicMaterial({ color: '#2a1060', depthTest: false, transparent: true })); dot.renderOrder = 9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6000, 900, 8, 40), new THREE.MeshBasicMaterial({ color: '#ff3d7f', depthTest: false, transparent: true })); ring.renderOrder = 9;
    marker.add(dot, ring); grp.add(marker);   // the marker stays at the origin: the zoom point
    // Sites: ten per region, scattered at random through it (the first at its middle). Every site shows its region's tested
    // tissue block, so moving between sites is instant; each site's line going in cuts that block differently. A site in the
    // uncinate process (from the ventral bud) has a PP-rich islet.
    const MEMBERS = { head: ['head', 'uncinate process'], body: ['neck', 'body'], tail: ['tail'] };
    ['head', 'body', 'tail'].forEach((rk, ri) => { const pool = []; pancreasMeshes.filter((m) => MEMBERS[rk].includes(m.userData.region)).forEach((m) => { const p = m.geometry.getAttribute('position'); for (let v = 0; v < p.count; v += 7) pool.push({ v: new THREE.Vector3().fromBufferAttribute(p, v), sub: m.userData.region }); });
      const centre = SITES[rk], R2 = rng(9001 + ri);
      for (let k = 0; k < 10; k++) { const pick = pool[Math.floor(R2() * pool.length)], local = k === 0 ? centre.clone() : centre.clone().lerp(pick.v, 0.3 + 0.45 * R2());
        SITE_LIST.push({ i: SITE_LIST.length, region: rk, sub: k === 0 ? rk : pick.sub, local, seed: 2000 + SITE_LIST.length, verified: k === 0 }); } });   // seed: for the site's lobules
    setSite(SITE_LIST.findIndex((S0) => S0.region === 'body' && S0.verified), true); groups.organ.userData.inner.position.copy(organLocal).negate();
    scene.add(grp);
  }
  function setSite(i, now) {
    const S0 = SITE_LIST[i]; VIEWS[focus].turned = false; if (SLICE.organ) { scene.remove(SLICE.organ); SLICE.organ = null; } organLocal.copy(S0.local); region = S0.region;
    document.querySelectorAll('[data-region]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.region === S0.region)));
    switchSite(i); $('status').style.display = 'none'; updatePickers();
    $('target').innerHTML = `Tissue site <strong>${i + 1} of ${SITE_LIST.length}</strong>, in the <strong>${S0.sub}</strong>, where the model places about ${Math.round(ORG.densities[KEY_OF[S0.region]])} islets per mm³ (twice as dense in the tail; Wang 2013). It shows the tissue block built and tested for the ${S0.region}${S0.sub === 'uncinate process' ? ', with a PP-rich islet: in the uncinate process PP cells make up most of the islet (54–94% of its volume), displacing most alpha cells and some beta cells (Gorelick and Williams 2021, ch. 1)' : ''}. Zoom in on any part of the organ to open it at a site nearby, chosen at random, or use the arrows.`;
  }
  // The line going in at a site: of 160 directions, the shortest way out of the gland, leaning towards the front of the
  // body; and how deep the site lies along it.
  function siteAxis(S0) {
    if (S0.axis) return S0;
    const inner = groups.organ.userData.inner; inner.updateMatrixWorld(true);
    const from = S0.local.clone().applyMatrix4(inner.matrixWorld), rc = new THREE.Raycaster(), front = new THREE.Vector3(0, 0.25, 1).normalize(); let best = null;
    fib(160).forEach((dir) => { rc.set(from, dir); const hit = rc.intersectObjects(pancreasMeshes, false)[0]; if (!hit) return;
      const score = hit.distance * (1.35 - 0.35 * dir.dot(front)); if (!best || score < best.score) best = { score, dir, depth: hit.distance }; });
    S0.axis = best ? best.dir : front; S0.depth = best ? best.depth : 3000; return S0;
  }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  onViews('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  onViews('pointermove', (e) => { if (e.buttons && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) VIEWS[focus].turned = true; });   // turned by hand
  // In the precursor view, the lesion under the pointer: the organ moves so it comes to the middle, and zooming on opens it.
  function aimLesion(e) {
    if (!lesionGroup) return null; const r = VIEWS[focus].el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObject(lesionGroup, true).find((h) => h.object.visible && h.object.parent.visible); if (!hit) return null;
    let q = hit.object; while (q.parent && q.parent !== lesionGroup) q = q.parent; const key = Object.keys(LESION_VIEWS).find((k) => LESION_VIEWS[k].mode === MODE && LESION_VIEWS[k].parts.includes(q.name)); if (!key) return null;
    LES.pending = key; organLocal.copy(lesionGroup.getObjectByName(LESION_VIEWS[key].at).userData.at); return key;
  }
  // Sites are not shown. Clicking the organ, or starting to zoom in on it from afar, picks one of the sites nearest the
  // point under the pointer at random, and the organ moves so that site comes to the middle of the view.
  function pickNear(e) {
    const r = VIEWS[focus].el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(pancreasMeshes, false)[0]; if (!hit) return false;
    const local = hit.point.clone().sub(groups.organ.userData.inner.position);
    const near = SITE_LIST.map((S0) => [S0.local.distanceTo(local), S0.i]).sort((a, b) => a[0] - b[0]).slice(0, 4);
    setSite(near[Math.floor(Math.random() * near.length)][1]); return true;
  }
  onViews('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || camera.position.distanceTo(controls.target) < 15000) { down = null; return; } down = null;
    if (MODE !== 'pancreas') { const k = aimLesion(e); if (k) enterLesion(k); return; } if (LES.view) return; pickNear(e);
  });
  onViews('wheel', (e) => { const v = VIEWS[focus];
    if (MODE !== 'pancreas' && !LES.view) { if (e.deltaY < 0 && !LES.pending) aimLesion(e); return; }
    if (e.deltaY >= 0 || v.picked || COMPARE.on || STAGE.mode !== 'tissue' || flight || camera.position.distanceTo(controls.target) < 50000) return;
    v.picked = pickNear(e); }, { passive: true });

  // ---------- lobules in place: a column of tissue along the line going in at the site, from below the site up to the
  // surface of the gland. Solid lobules fill it. Round the line, inside their opening, the lobules near the site are drawn
  // as their duct tree, and at the bottom of that opening lies the tissue core.
  const GROSS = {}, LOBULE = 1250, SEPTUM = 50, COL = 2500, BELOW = 2500, TREE = { xy: 1400, z: 2000 };
  const KEY_OF = { head: 'pancreas-head', body: 'pancreas-body', tail: 'pancreas-tail' };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function buildGross(key) {   // key: a site index
    if (GROSS[key]) return GROSS[key];
    const SITE = siteAxis(SITE_LIST[key]), g = new THREE.Group(), R = rng(SITE.seed * 3 + 1), top = Math.max(SITE.depth, TREE.z + 300), set = 'gross:' + key;
    g.userData.q = quatFromTo(Z, SITE.axis); g.quaternion.copy(g.userData.q); g.userData.key = key; g.userData.top = top;
    const toL = g.userData.toL = { value: new THREE.Matrix4() };   // the group's own frame is the layer frame: z along the line
    const LIM = [[X, COL], [X.clone().negate(), COL], [Y, COL], [Y.clone().negate(), COL], [Z, top], [Z.clone().negate(), BELOW]];
    const inZone = (p, m = 0) => Math.abs(p.x) < TREE.xy - m && Math.abs(p.y) < TREE.xy - m && Math.abs(p.z) < TREE.z - m;
    // Lobules: the Voronoi cells of jittered seeds, each shrunk by half a septum, clipped to the column.
    const seeds = [], J = () => (R() - 0.5) * 0.7 * LOBULE;
    for (let x = -COL - LOBULE / 2; x < COL + LOBULE; x += LOBULE) for (let y = -COL - LOBULE / 2; y < COL + LOBULE; y += LOBULE)
      for (let z = -BELOW - LOBULE / 2; z < top + LOBULE; z += LOBULE) seeds.push(new THREE.Vector3(x + J(), y + J(), z + J()));
    const inside = seeds.filter((p) => LIM.every(([f, l]) => p.dot(f) < l)), lobules = [];
    const solid = new THREE.Group(), tree = new THREE.Group(); g.add(solid, tree); g.userData.solid = solid; g.userData.tree = tree;
    const coarse = new THREE.IcosahedronGeometry(1, 2), fine = new THREE.IcosahedronGeometry(1, 3);
    const parMat = M(g, '--parenchyma', [], { roughness: 0.85, he: [1 / 26, 0.32], layer: [1, toL] });
    const hullMat = M(g, '--parenchyma', [], { transparent: true, opacity: 0.13, depthWrite: false, he: false, layer: [2, toL] });
    inside.forEach((s0) => {
      const near = seeds.filter((q) => q !== s0 && q.distanceTo(s0) < LOBULE * 2.2), base = inZone(s0, -LOBULE) ? fine : coarse, bp = base.getAttribute('position'), geo = base.clone(), p = geo.getAttribute('position');
      for (let v = 0; v < p.count; v++) { const dir = new THREE.Vector3().fromBufferAttribute(bp, v).normalize(); let t = LOBULE * 1.6;
        near.forEach((q) => { const dq = q.clone().sub(s0), c = dq.dot(dir); if (c > 1e-6) t = Math.min(t, (dq.lengthSq() / 2 - SEPTUM / 2 * dq.length()) / c); });
        LIM.forEach(([f, l]) => { const c = dir.dot(f); if (c > 1e-6) t = Math.min(t, (l - s0.dot(f)) / c); });
        p.setXYZ(v, s0.x + dir.x * t, s0.y + dir.y * t, s0.z + dir.z * t); }
      geo.computeVertexNormals(); const m = new THREE.Mesh(geo, parMat); m.name = 'lobule'; solid.add(m);
      if (inZone(s0)) { const hull = new THREE.Mesh(geo, hullMat); hull.name = 'lobuleHull'; tree.add(hull); lobules.push(s0); } });
    // Connective tissue fills the septa: seen on the floor of the column and on the wall of the opening, which is sized each frame.
    const septMat = M(g, '--collagen', [], { roughness: 0.9, he: [1 / 18, 0.22], layer: [1, toL] }); septMat.side = THREE.BackSide;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2 * COL, 2 * COL, top + BELOW), septMat); floor.position.z = (top - BELOW) / 2; floor.name = 'septa'; solid.add(floor);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).rotateX(Math.PI / 2), septMat); wall.position.z = (top - BELOW) / 2; wall.name = 'septa'; solid.add(wall); g.userData.wall = wall;
    // Interlobular ducts and vessels run in the septa: joined septal points (between neighbouring lobules near the site) by a minimum spanning tree.
    const sept = []; lobules.forEach((a, i) => lobules.forEach((b, j) => { if (j > i && a.distanceTo(b) < LOBULE * 1.45) sept.push(a.clone().add(b).multiplyScalar(0.5)); }));
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
    const inLobule = (p, s0) => { const d0 = p.distanceTo(s0); return inZone(p, 30) && seeds.every((q) => q === s0 || p.distanceTo(q) > d0 + SEPTUM); };
    const toward = (from, to, s0) => { let t = 1; while (t > 0.15 && !inLobule(from.clone().lerp(to, t), s0)) t *= 0.8; return from.clone().lerp(to, t); };
    lobules.forEach((s0) => {
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
    const T = (k, geo, color, extra) => inst(tree, geo, M(g, color, [], Object.assign({ layer: [2, toL] }, extra || {})), L[k], k);
    T('mainDuct', rod, '--grossduct', { he: [1 / 20, 0.15] }); T('interlobularDuct', rod, '--grossduct', { he: [1 / 20, 0.15] }); T('joint', ball, '--grossduct', { he: false });
    T('intralobularDuct', rod, '--grossduct', { he: false }); T('terminalDuct', rod, '--grossduct', { he: false });
    T('vein', rod, '--grossvein'); T('artery', rod, '--grossartery');
    T('grossAcinus', ball, '--parenchyma', { he: [1 / 12, 0.25] });
    g.userData.ductCounts = { main: L.mainDuct.length, interlobular: L.interlobularDuct.length, intralobular: L.intralobularDuct.length, terminal: L.terminalDuct.length, acini: L.grossAcinus.length };
    // Islets at the region's density in this model, inside lobules, sizes lognormal about the mean of 110 um (Hahn 2021).
    const dens = ORG.densities[KEY_OF[SITE.region]], vol = (2 * TREE.xy / 1000) ** 2 * (2 * TREE.z / 1000), count = Math.round(dens * vol), isl = [];
    const inSeptum = (p) => { const ds = seeds.map((q) => q.distanceTo(p)).sort((a, b) => a - b); return ds[1] - ds[0] < SEPTUM * 1.5; };
    for (let tries = 0; isl.length < count && tries < count * 20; tries++) {
      const p = new THREE.Vector3((R() - 0.5) * 2 * TREE.xy, (R() - 0.5) * 2 * TREE.xy, (R() - 0.5) * 2 * TREE.z); if (inSeptum(p)) continue;
      const u1 = Math.max(R(), 1e-9), z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * R()), r = 52.5 * Math.exp(0.3 * z);
      isl.push(new THREE.Matrix4().makeScale(r, r, r).setPosition(p)); }
    inst(tree, ball, M(g, '--isletgross', [], { roughness: 0.85, he: [1 / 9, 0.18], layer: [2, toL] }), isl, 'grossIslet');
    g.userData.stats = { key: SITE.region, density: dens, count: isl.length, lobules: lobules.length, volume: vol };
    // Names, on what lies nearest the line going in, where the opening shows it.
    const byLine = (pts) => pts.reduce((b, q) => (Math.hypot(q.x, q.y) + 0.3 * Math.abs(q.z - 1000) < Math.hypot(b.x, b.y) + 0.3 * Math.abs(b.z - 1000) ? q : b));
    const at = (list) => list.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    if (main.size) tag(set, tree, 'Large (interlobular) duct', byLine([...main].map((k) => sept[k])));
    [['interlobularDuct', 'Interlobular duct'], ['intralobularDuct', 'Intralobular duct'], ['terminalDuct', 'Terminal (intercalated) duct'], ['grossAcinus', 'Acini']].forEach(([k, text]) => { if (L[k].length) tag(set, tree, text, byLine(at(L[k]))); });
    if (isl.length) tag(set, tree, 'Islet', byLine(at(isl))); if (sept.length) tag(set, tree, 'Septum', byLine(sept));
    LABELS[set].forEach((o) => { o.userData.check = (q) => { const l = q.clone().applyMatrix4(toL.value); return Math.hypot(l.x, l.y) < LAYER.R.value.y; }; });
    g.userData.ring = tag(set, solid, 'Lobules, cut across', new THREE.Vector3(1000, 0, top));
    scene.add(g); GROSS[key] = g; return g;
  }
  const COMPARE = { on: false, q: new THREE.Quaternion(), right: X.clone(), up: Y.clone(), names: [] };
  $('compare').addEventListener('click', () => { COMPARE.on = !COMPARE.on; $('compare').textContent = COMPARE.on ? 'Leave the comparison' : 'Compare head, body and tail';
    if (COMPARE.on) {   // the three columns face the viewer, side by side across the view
      COMPARE.q = quatFromTo(Z, camera.position.clone().sub(controls.target)); COMPARE.right = X.clone().applyQuaternion(camera.quaternion); COMPARE.up = Y.clone().applyQuaternion(camera.quaternion);
      COMPARE.names.forEach((o, i) => o.position.copy(COMPARE.right).multiplyScalar((i - 1) * 5600).addScaledVector(COMPARE.up, 2700)); STAGE.mode = 'tissue'; controls.target.set(0, 0, 0); flyTo(28000 / Math.min(1, camera.aspect * 1.2), undefined, 'tissue'); } else flyTo(STOPS.gross, undefined, 'tissue'); });
  document.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    const r = b.dataset.region, d = camera.position.distanceTo(controls.target), back = d < 2500 ? STOPS.tissue : d < 40000 ? STOPS.gross : null;
    if (COMPARE.on) { COMPARE.on = false; $('compare').textContent = 'Compare head, body and tail'; }
    const to = SITE_LIST.findIndex((S0) => S0.region === r && S0.verified); goSite(to, back); }));
  function goSite(to, back) { if (back === null || back === undefined) { setSite(to); return; }
    flight = { legs: [{ d: 90000, mode: 'tissue', then: () => setSite(to) }, { d: 90000 }, { d: back, mode: 'tissue' }], start: null }; }

  { const root = new THREE.Group(); scene.add(root); ['Head', 'Body', 'Tail'].forEach((t, i) => COMPARE.names.push(tag('compare', root, t, new THREE.Vector3((i - 1) * 5600, 2700, 0)))); }

  // ---------- pickers: step through sites, and through the acini, ducts and islets
  function updatePickers() {
    if (!SITE_LIST.length || site < 0) return; const S0 = SITE_LIST[site];
    $('sitelabel').textContent = `Site ${site + 1} of ${SITE_LIST.length} · ${S0.sub}`;
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

  // ---------- split screen: two views side by side, each showing its own part
  const PRESETS = {
    'islet-acinus': [['detail', 'islet'], ['detail', 'acinus']], 'islet-duct': [['detail', 'islet'], ['detail', 'duct']], 'acinus-duct': [['detail', 'acinus'], ['detail', 'duct']],
    'beta-acinar': [['cell', 'islet'], ['cell', 'acinus']], 'tissue-cell': [['tissue', null], ['cell', 'acinus']], 'organ-tissue': [['organ', null], ['tissue', null]],
  };
  function setSplit(on) { if (on && MODE !== 'pancreas') setMode('pancreas');
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
  const STOPS = { organ: 2.6e5, gross: 4200, tissue: 800, detail: 200, cells: 100, cell: 24 };
  const MODE_OF = { organ: 'tissue', gross: 'tissue', tissue: 'tissue', detail: 'structure', cells: 'cells', cell: 'cell' };
  const stopFor = (lvl, br) => (lvl === 'detail' || lvl === 'cells') ? SIZE[br || branch][lvl === 'detail' ? 'whole' : 'cells'] : STOPS[lvl];
  let flight = null;
  function flyTo(dGoal, newBranch, mode) {
    VIEWS[focus].turned = false; const legs = [];
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
  function setIsletKind(k) { if (k && k !== isletKind) { isletKind = k; refocus(); } }
  document.querySelectorAll('.ladder button[data-go]').forEach((b) => b.addEventListener('click', () => {
    const [lvl, br] = b.dataset.go.split(':'); setIsletKind(b.dataset.kind); if (br) document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === br)));
    flyTo(stopFor(lvl, br), br, MODE_OF[lvl]); }));
  document.querySelectorAll('[data-branch]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const lv = levelAt(camera.position.distanceTo(controls.target));
    if (STAGE.mode === 'tissue') branch = b.dataset.branch; else flyTo(stopFor(lv, b.dataset.branch), b.dataset.branch, STAGE.mode); }));
  $('reset').addEventListener('click', () => { if (LES.view) { $('histopanel').scrollTop = 0; return; } const lv = levelAt(camera.position.distanceTo(controls.target)); flyTo(stopFor(lv) || STOPS.organ, undefined, MODE_OF[lv]); });
  // Escape steps back one stage.
  window.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!$('lightbox').hidden) { $('lightbox').hidden = true; return; } if (MODE === 'atlas') { if (AT.pair) atlasOpen(AT.entry); else if (AT.entry || AT.view !== 'grid') { AT.entry = null; AT.view = 'grid'; renderAtlas(); hashNow(); } return; } if (LES.view) { exitLesion(); return; } const lv = levelAt(camera.position.distanceTo(controls.target));
    const up = { cell: 'cells', cells: 'detail', detail: 'tissue', tissue: 'gross', gross: 'organ' }[lv]; if (up) flyTo(stopFor(up), undefined, MODE_OF[up]); });
  $('surround').addEventListener('change', (e) => { surroundings = e.target.checked; });
  document.querySelectorAll('[data-stain]').forEach((b) => b.addEventListener('click', () => { stain = b.dataset.stain; setTimeout(hashNow);
    document.querySelectorAll('[data-stain]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); document.body.dataset.stain = stain; }));

  // ---------- toggles
  const TOGGLES = { acinar: ['acinar', 'nucleus', 'granule'], duct: ['intercalated', 'intralobular', 'ductNucleus', 'cac', 'cacNucleus'], capillary: ['capillary', 'node'], redcell: ['redcell'], stroma: ['fibre', 'stellate', 'stellateNucleus'], islet: ISLET_TYPES.concat(['isletNucleus']) };
  const shown = Object.fromEntries(Object.keys(TOGGLES).map((k) => [k, true]));
  function applyToggles(g) { if (!g) return; g.traverse((o) => { if (!o.isInstancedMesh) return; for (const [k, list] of Object.entries(TOGGLES)) if (list.includes(o.name)) o.visible = shown[k]; }); }
  document.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => { shown[el.dataset.toggle] = el.checked; applyToggles(groups.block); Object.values(BRANCHES).forEach((b) => applyToggles(b.detail)); }));
  $('neighbours').addEventListener('change', (e) => { const nb = groups.organ.userData.neighbours; if (nb) nb.visible = e.target.checked; });
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
  const SLICE = { value: 0, organ: null, block: null, part: null };
  // The surfaces are hollow, so a cut would show an empty shell: each slab's material keeps the original's shading and draws
  // the inside of a cut surface as flat, solid tissue (back faces in a darker shade), and organ slabs are made opaque.
  const CAP = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', 'if (!gl_FrontFacing) { gl_FragColor.rgb = diffuseColor.rgb * 0.82; gl_FragColor.a = 1.0; }\n#include <tonemapping_fragment>'); };
  function slabMaterial(orig, planes, solid, toL) {   // toL: this slab's own layer frame, which moves with it
    const m = orig.clone(), prev = orig.onBeforeCompile, key = orig.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { prev.call(orig, sh, r); if (toL && sh.uniforms.uToL) sh.uniforms.uToL = toL; CAP(sh); }; m.customProgramCacheKey = () => key.call(orig) + '|slab'; m.clippingPlanes = planes; m.side = THREE.DoubleSide;
    m.userData = Object.assign({}, orig.userData); if (solid) { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.userData.base = 1; }
    return m;
  }
  // The extent of a group along an axis, counting each instance of instanced meshes (whose bounding box covers one only).
  function rangeAlong(src, axis) { let lo = Infinity, hi = -Infinity; const tmp = new THREE.Matrix4(), v = new THREE.Vector3(); src.updateMatrixWorld(true);
    src.traverse((o) => { if (!o.isMesh || o.visible === false) return;
      if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, tmp); tmp.premultiply(o.matrixWorld); const c = v.setFromMatrixPosition(tmp).dot(axis); lo = Math.min(lo, c); hi = Math.max(hi, c); } return; }
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
      for (let k = 0; k < 8; k++) { const c = v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld).dot(axis); lo = Math.min(lo, c); hi = Math.max(hi, c); } });
    return [lo, hi]; }
  function sliceSet(src, n, lo, hi, axis, skip, margin = 0, solid = false, layerFrame = null) {
    const set = new THREE.Group(); set.userData.mats = []; set.userData.slabs = []; src.updateMatrixWorld(true);
    const th = (hi - lo) / n;
    for (let k = 0; k < n; k++) {
      const slab = new THREE.Group(), pA = new THREE.Plane(axis.clone(), 0), pB = new THREE.Plane(axis.clone().negate(), 0), toL = layerFrame ? { value: layerFrame.value.clone() } : null;
      src.traverse((o) => { if (!o.isMesh || skip.includes(o.name) || o.visible === false || o.userData.mover) return;   // moving particles are left out
        const mat = slabMaterial(o.material, [pA, pB], solid, toL); set.userData.mats.push(mat);
        let m;
        if (o.isInstancedMesh) {   // each slab draws only the instances near it, so slicing costs about one block, not six
          const keep = [], tmp = new THREE.Matrix4(), ax = axis, lo_ = lo + k * th - margin, hi_ = lo + (k + 1) * th + margin;
          for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, tmp); tmp.premultiply(o.matrixWorld); const c = ax.x * tmp.elements[12] + ax.y * tmp.elements[13] + ax.z * tmp.elements[14]; if (c >= lo_ && c <= hi_) keep.push(tmp.clone()); }
          if (!keep.length) return;
          m = new THREE.InstancedMesh(o.geometry, mat, keep.length); keep.forEach((x, i) => m.setMatrixAt(i, x)); m.instanceMatrix.needsUpdate = true; m.frustumCulled = false;
          if (o.instanceColor) { m.instanceColor = o.instanceColor; }
        } else m = new THREE.Mesh(o.geometry, mat);
        m.matrixAutoUpdate = false; if (!o.isInstancedMesh) m.matrix.copy(o.matrixWorld); m.name = o.name; slab.add(m); });
      set.userData.slabs.push({ slab, pA, pB, toL, lo: lo + k * th, hi: lo + (k + 1) * th, k }); set.add(slab);
    }
    Object.assign(set.userData, { n, axis, th, layerFrame }); scene.add(set); return set;
  }
  function layoutSlices(set, spacing) { const { n, axis } = set.userData;
    for (const s of set.userData.slabs) { const off = (s.k - (n - 1) / 2) * spacing; s.slab.position.copy(axis).multiplyScalar(off); s.pA.constant = -(s.lo + off); s.pB.constant = s.hi + off;
      if (s.toL) s.toL.value.copy(set.userData.layerFrame.value).multiply(new THREE.Matrix4().makeTranslation(-axis.x * off, -axis.y * off, -axis.z * off)); } }
  // Back at zero, the slices are dropped, so the next slicing follows the view of that moment.
  function dropSlices(keys) { keys.forEach((k) => { const st = SLICE[k] && (SLICE[k].set || SLICE[k]); if (st) scene.remove(st); SLICE[k] = null; }); }
  $('slice').addEventListener('input', (e) => { SLICE.value = +e.target.value; if (SLICE.value <= 0.001) dropSlices(['block', 'part']); $('slicelabel').textContent = SLICE.value > 0 ? `Slice apart: ${Math.round(SLICE.value * 100)}%` : 'Slice apart'; });

  // ---------- play the journey
  const TOUR = [
    { d: 2.6e5, br: 'acinus', m: 'tissue', say: 'The pancreas lies across the back of the abdomen, behind the stomach. Its head sits in the C-shaped curve of the duodenum, and its neck, body and tail run to the left, the tail reaching towards the spleen. It is two glands in one: an exocrine gland that makes digestive juice, and scattered endocrine islets that release hormones into the blood.' },
    { d: 15000, m: 'tissue', say: 'Zooming in, the surface of the gland opens around the chosen spot. Inside, the tissue is divided into lobules, a millimetre or two across, by thin septa of connective tissue. The septa carry the larger ducts, vessels and nerves.' },
    { d: 4200, m: 'tissue', say: 'The lobules near the spot open in turn to show their skeleton: a branching tree of ducts. A large interlobular duct runs between the lobules beside an artery and a vein. Smaller ducts enter each lobule, and the finest end in grape-like clusters of acini. Paler, rounded islets of Langerhans are scattered among them.' },
    { d: 800, m: 'tissue', say: 'At the bottom of the opening lies a small core of tissue, cut through an islet. Densely stained acini surround it, budding from small ducts, with capillaries and a little connective tissue between them. The islet has no duct of its own. Its hormones leave through its capillaries.' },
    { d: 210, m: 'structure', say: 'Each acinus is a cluster of pyramidal cells around a tiny central lumen. In an H and E stain, the base of each cell is purple, because it is packed with rough endoplasmic reticulum, and its apex is pink with zymogen granules: the stored digestive enzymes.' },
    { d: 100, m: 'cells', say: 'Pulled apart, the cells show their shape: broad at the base, narrow at the lumen, with a round nucleus near the base. The pale cells left at the centre are centroacinar cells. They are the first cells of the duct, and are found only in the pancreas.' },
    { d: 26, m: 'cell', say: 'Inside one acinar cell, enzymes are made on the rough endoplasmic reticulum, packaged in the Golgi apparatus, and stored as zymogen granules at the apex. After a meal, the gut hormone cholecystokinin and nerve signals raise calcium inside the cell. Watch the granules travel to the apex and fuse with the membrane, emptying their enzymes into the lumen, from where they drain away down the intercalated duct.' },
    { d: 200, br: 'duct', m: 'structure', say: 'Secretions drain from intercalated ducts, which begin inside the acini, into intralobular ducts lined by pale cuboidal cells, and then into interlobular ducts in the septa. Unlike the salivary glands, the pancreas has no striated ducts, and no myoepithelial cells.' },
    { d: 90, m: 'cells', say: 'The duct wall is a single layer of these cells. Together they add the watery, bicarbonate-rich part of pancreatic juice, which neutralises the acid arriving from the stomach.' },
    { d: 22, m: 'cell', say: 'A duct cell has microvilli and a single primary cilium on the surface facing the lumen, and tight junctions that seal it to its neighbours. When acid from the stomach reaches the duodenum, the hormone secretin tells duct cells to secrete. Bicarbonate leaves through CFTR and the exchanger SLC26A6, water follows, and the stream washes the enzymes along the ducts.' },
    { d: 360, br: 'islet', m: 'structure', say: 'An islet is a compact cluster of endocrine cells in cords, threaded by a rich network of capillaries, with no capsule of its own. In H and E it looks pale, and its cell types cannot be told apart. Special stains, like the cell-type view here, reveal them.' },
    { d: 215, m: 'cells', say: 'In human islets the cell types are intermixed. Beta cells make insulin, alpha cells glucagon, delta cells somatostatin, and PP cells pancreatic polypeptide. Together they keep the level of glucose in the blood in balance.' },
    { d: 24, k: 'beta', m: 'cell', say: 'A beta cell senses glucose. Glucose enters from the blood and is burned for energy. As ATP rises, potassium channels in the membrane close, calcium flows in, and the insulin granules fuse with the membrane, releasing insulin into the nearby capillary. Each granule stores insulin with zinc in a dense core.' },
    { d: 24, k: 'alpha', m: 'cell', say: 'Its neighbour, an alpha cell, makes glucagon, packed in smaller, dense granules. When blood glucose falls, alpha cells release glucagon, which tells the liver to release glucose. Insulin and glucagon pull in opposite directions.' },
    { d: 24, k: 'delta', m: 'cell', say: 'A delta cell makes somatostatin. It reaches out with long, thin processes that touch beta and alpha cells, and releases somatostatin right beside them, damping the release of both insulin and glucagon.' },
    { d: 2.6e5, m: 'tissue', say: 'From the whole organ to a single cell, the pancreas joins digestion and metabolism in one gland.' },
  ];


  let tour = null;
  let voiceOn = true, voiceRate = 0.88, voiceName = '';
  try { voiceRate = +(localStorage.getItem('pz-rate') || 0.88); voiceName = localStorage.getItem('pz-voice-pro') || ''; } catch (e) { /* storage may be unavailable */ }
  // Narration uses Google's UK English voices only, the female voice by default. They come with Chrome; other browsers
  // fall back to their standard UK narrators (Microsoft's natural UK voices, Apple's Daniel, Serena and Kate).
  const GOOGLE_UK = /^google uk english (female|male)$/i, UK_NARRATORS = /^microsoft (sonia|libby|ryan|maisie|thomas)\b|^(daniel|serena|kate|oliver|arthur|martha)\b/i;
  const RANK = [/^google uk english female$/i, /^google uk english male$/i, /microsoft (sonia|libby).*natural/i, /^serena\b|^kate\b/i];
  function englishVoices() { if (!window.speechSynthesis) return []; const en = speechSynthesis.getVoices().filter((x) => /^en([-_]|$)/i.test(x.lang)), google = en.filter((x) => GOOGLE_UK.test(x.name));
    return google.length ? google : en.filter((x) => UK_NARRATORS.test(x.name) && !/novelty/i.test(x.voiceURI || '')); }
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
    setIsletKind(s.k); flyTo(s.d, s.br, s.m); tour.phase = 'fly'; tour.hold = s.hold; $('caption').textContent = s.say; say(s.say);
    if (s.br) document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === s.br))); }
  $('play').addEventListener('click', () => { if (tour) { stopTour(); return; } if (MODE !== 'pancreas') setMode('pancreas'); tour = { i: 0, view: focus }; $('play').textContent = 'Stop'; if (!motionOn) { motionOn = true; $('motion').checked = true; }   // the journey shows secretion in motion
    if (window.speechSynthesis) speechSynthesis.getVoices(); nextTour(); });
  // The journey keeps going while you turn, zoom or click the model; only the Stop button ends it.

  // ---------- names
  let namesOn = true; $('names').addEventListener('change', (e) => { namesOn = e.target.checked; });
  let labelLayer = VIEWS[0].ui.labels, pool = VIEWS[0].ui.pool;
  // A name is hidden when the solid lobules stand between it and the camera, as when the view is turned inside the opening.
  // The test follows the shader: points along the line of sight are tested against the column and its crater-shaped hole.
  function hiddenByLobules(p) {
    const g = GROSS[site]; if (!g || COMPARE.on || !(g.userData.w > 0.5)) return false;
    const m = g.userData.toL.value, a = camera.position.clone().applyMatrix4(m), b = p.clone().applyMatrix4(m), len = a.distanceTo(b), q = new THREE.Vector3();
    const R = LAYER.R.value, S = LAYER.S.value, F = LAYER.F.value;
    for (let k = 1; k < 32; k++) { const t = k / 32 * 0.97; if (t * len < camera.near) continue; q.lerpVectors(a, b, t); const r = Math.hypot(q.x, q.y);
      if (q.z < -BELOW || q.z > g.userData.top || r > R.x) continue;
      if (!(r < R.y + Math.max(0, q.z - S.x) * S.y && q.z > F.x)) return true; }
    return false;
  }
  function drawDiseaseLabels(w) { const keys = disease === 'all' ? Object.keys(LESIONS) : MODE_PARTS[disease] || [disease]; LABELS.__disease = keys.flatMap((k) => LABELS['disease:' + k] || []); drawLabels('__disease', w); }
  function drawLabels(set, w) {
    let used = 0; const W = UI.w, H = UI.h, placed = [];
    if (namesOn && set && w > 0.5) for (const o of LABELS[set] || []) {
      if (o.parent && o.parent.visible === false) continue; const p = o.getWorldPosition(new THREE.Vector3()); if (o.userData.check && !o.userData.check(p)) continue; if (set !== 'organ' && hiddenByLobules(p)) continue;
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

  // ---------- marker genes: from the HRA ASCT+B table (pancreas v1.3) and the Human Protein Atlas (v26.0), copied in
  // repo/data/human-pancreas-markers.json with their sources. Shown for the cell or structure in view, or the one clicked.
  const MARKERS = JSON.parse($('markers').textContent);
  const MARKER_OF = { acinar: 'acinar', nucleus: 'acinar', granule: 'acinar', cac: 'centroacinar', cacNucleus: 'centroacinar', intercalated: 'duct', intralobular: 'duct', ductNucleus: 'duct',
    capillary: 'endothelial', node: 'endothelial', redcell: 'rbc', stellate: 'stellate', stellateNucleus: 'stellate', beta: 'beta', alpha: 'alpha', delta: 'delta', pp: 'pp', isletNucleus: 'beta' };
  const MARKER_VIEW = { acinus: 'acinar', acinusCells: 'acinar', acinusCell: 'acinar', islet: 'beta', isletCells: 'beta', isletCell: 'beta', alphaCell: 'alpha', deltaCell: 'delta', duct: 'duct', ductCells: 'duct', ductCell: 'duct' };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const geneLinks = (list) => '<div class="genes">' + list.map((g) => `<a href="https://www.proteinatlas.org/search/${encodeURIComponent(g.symbol || g)}" target="_blank" rel="noopener" title="${esc(g.description || g.symbol || g)}">${esc(g.symbol || g)}</a>`).join('') + '</div>';
  let markerShown = '';
  function showMarkers(key) {
    const box = $('markerbox'), c = key && MARKERS.cellTypes[key]; if (key === markerShown) return; markerShown = key; if (!c) { box.hidden = true; return; } box.hidden = false;
    const a = c.asctb, label = c.clId ? `${esc(c.label)} <small>${esc(c.clId)}</small>` : esc(c.label);
    box.innerHTML = `<h3>Markers: ${label}</h3>`
      + (a.genes.length ? `<p>HRA ASCT+B table${a.proteins.length ? ` (protein: ${a.proteins.map(esc).join(', ')})` : ''}</p>${geneLinks(a.genes)}` : '<p>HRA ASCT+B table: no biomarkers listed for this cell type.</p>')
      + (a.related.length ? `<p>On related rows of the table</p>${geneLinks(a.related)}` : '')
      + (c.hpa.length ? `<p>Human Protein Atlas (RNA)</p>${geneLinks(c.hpa)}` : '')
      + (c.note ? `<p class="src">${esc(c.note)}</p>` : '')
      + srcFold('HRA ASCT+B Pancreas v1.3 (CC BY 4.0); Human Protein Atlas v26.0 (CC BY-SA 4.0). Genes link to their HPA pages.');
  }
  // ---------- click to identify, isolate or fade a kind of cell
  const KINDS = {
    acinar: ['Acinar cell', 'Makes digestive enzymes; wedge-shaped, apex at the lumen of its acinus.'], nucleus: ['Acinar cell nucleus', 'Round and basal.'], granule: ['Zymogen granule', 'About 1 µm; holds enzymes until release into the lumen.'],
    cac: ['Centroacinar cell', 'A flattened duct cell lining the start of the duct inside the acinus.'], cacNucleus: ['Centroacinar cell nucleus', 'Elongated.'],
    intercalated: ['Intercalated duct cell', 'Low and flat; carries one acinus’s secretion to a larger duct.'], intralobular: ['Intralobular duct cell', 'Cuboidal; secretes bicarbonate-rich fluid.'], ductNucleus: ['Duct cell nucleus', ''],
    capillary: ['Capillary', 'A looping network between acini; the islet has its own dense bed.'], node: ['Capillary', 'A junction in the capillary network.'], redcell: ['Red blood cell', 'About 7.5 µm across, in single file.'],
    fibre: ['Collagen fibre', 'Aligned along ducts and vessels (CODA); looser between acini.'], stellate: ['Stellate cell', 'Spindle-shaped, lying against acini and ducts.'], stellateNucleus: ['Stellate cell nucleus', ''],
    isletNucleus: ['Islet cell nucleus', 'Round and uniform, as islet nuclei look in section.'],
    beta: ['Beta cell', 'Secretes insulin; about half of human islet cells.'], alpha: ['Alpha cell', 'Secretes glucagon; 33–46% of human islet cells (Cabrera 2006).'], delta: ['Delta cell', 'Secretes somatostatin, damping insulin and glucagon release; 8–12% of human islet cells (Cabrera 2006).'], pp: ['PP cell', 'Secretes pancreatic polypeptide.'],
  };
  let selected = null, isolated = false;
  const activeGroups = () => [groups.block, ...Object.values(BRANCHES).map((b) => b.detail), SLICE.block].filter(Boolean);
  function showSelection() {
    const box = $('selection'); if (!selected) { box.hidden = true; showMarkers(MARKER_VIEW[lastLevel]); return; } box.hidden = false; showMarkers(MARKER_OF[selected]);
    $('selname').textContent = KINDS[selected][0]; $('seltext').textContent = KINDS[selected][1]; $('isolate').textContent = isolated ? 'Show all' : 'Isolate';
    let op = 1; activeGroups().forEach((g) => g.traverse((o) => { if (o.isInstancedMesh && o.name === selected) op = o.material.userData.base; })); $('selop').value = op; }
  function applyIsolate() { activeGroups().forEach((g) => { g.traverse((o) => { if (!o.isInstancedMesh) return; o.visible = isolated ? o.name === selected : true; }); if (!isolated) applyToggles(g); }); }
  onViews('pointerup', (e) => {
    const d = camera.position.distanceTo(controls.target); if (d > 9000 || !down2 || Math.hypot(e.clientX - down2[0], e.clientY - down2[1]) > 5) return;
    const r = VIEWS[focus].el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const targets = []; activeGroups().forEach((g) => { if (g.visible) g.traverse((o) => { if (o.isInstancedMesh && o.visible && KINDS[o.name]) targets.push(o); }); });
    const hit = ray.intersectObjects(targets, false).find((h) => { const m = h.object.material; return (!m.clippingPlanes.length || m.clippingPlanes.every((p) => p.distanceToPoint(h.point) >= 0)) && (h.object.parent !== groups.block || inCore(h.point)); });
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
    gross: 'The gland opened in place at the chosen site, along a line going in from its surface (the shortest, leaning towards the front). As you zoom, the surface of the organ opens and stays as a ring round the opening. Inside lie the lobules, cut across, with pale septa of connective tissue between them. Round the line, the lobules near the site open in turn to show what fills them: a tree of ducts (a large interlobular duct in the septa with an artery and vein beside it, interlobular ducts to each lobule, intralobular ducts inside, and terminal ducts ending in grape-like clusters of acini, drawn sparser than real so the ducts show) and islets at the region’s density in the model (twice as dense in the tail; Wang 2013). Zoom on to the tissue at the bottom of the opening. The openings are a way of showing the model, not a dissection. Duct calibres, lobule size and septum thickness are typical values not yet sourced.',
    compare: 'Three columns of lobules side by side, from the head, body and tail, each opened round its centre to show its duct tree and islets. The tail holds twice as many islets per mm³ as the head and body (Wang 2013; Hahn 2021). Lobules, septa and islet sizes are drawn the same way in each.',
    tissue: 'At the bottom of the opening, a core of tissue from inside a lobule, about 290 µm across, cut flat through its islet, with the duct tree of the lobule left as a ring round it. In it: an intralobular duct tree; intercalated ducts each ending in a rounded acinus whose cells reach out until they meet a neighbour or a vessel; capillaries with red cells; collagen and stellate cells; the islet. The core is cut from the 300 µm block built and tested for this region. Choose below what to zoom into next.',
    acinus: 'One acinus on its own, cut open: wedge-shaped acinar cells converge on the lumen like orange segments, zymogen granules at their apices, centroacinar cells lining the duct where it enters, and its intercalated duct leading back to the larger duct it drains into. Zoom on and its cells separate.',
    islet: 'The islet on its own, cut open: beta (green), alpha (magenta), delta (cyan) and PP (amber) cells intermixed along its own dense capillary bed, with no core or mantle, as in human islets (Cabrera 2006; Brissova 2005). Zoom on and its cells separate.',
    duct: 'An intralobular duct on its own, opened lengthwise: a single layer of cuboidal duct cells round the lumen. Duct cells secrete the bicarbonate-rich fluid of pancreatic juice, 2 to 3 litres a day (Ishiguro 2012; Hegyi 2015). Zoom on and its cells separate.',
    atlas: 'A gallery of the pancreas under the microscope: normal tissue, injury and repair, pancreatitis, cysts, precursor lesions, ductal adenocarcinoma by grade and variant, how it spreads, and the tumours it is mistaken for. Choose an entry for what to look for; open the folds for detail, compare look-alikes side by side, or take the quiz. Images are openly licensed and credited; text is in our own words from the sources listed in each entry.',
    pancreatitis: 'Pancreatitis: inflammation of the pancreas. Acute pancreatitis (drawn on the body and tail): the gland swells, enzymes digest it and the fat round it, leaving chalky fat necroses, and in the severe, necrotizing form it bleeds. Chronic pancreatitis (drawn in the head): repeated injury replaces the gland with scar; the duct dilates between strictures into a chain of lakes and fills with calcified stones. In a patient they are separate conditions; both are drawn on one organ to compare. Click an inset or a change on the organ to see its histology.',
    pda: 'Pancreatic ductal adenocarcinoma: about 60% arise in the head, 15% in the body, 5% in the tail, and 20% involve the gland diffusely (Robbins). A head tumour blocks the bile duct and the main duct, which dilate behind it (the double duct sign); it spreads early to regional lymph nodes and the liver. Click the tumour or the inset to see its histology. Sizes and placement are illustrative.',
    lesionAcutepancreatitis: 'Acute pancreatitis: a drawing and real H&E of fat necrosis, with its features numbered alike. Below: what sets it apart, and normal pancreas, acute and chronic pancreatitis compared. Press Esc to return to the organ.',
    lesionChronicpancreatitis: 'Chronic pancreatitis: a drawing of the fibrotic gland with a dilated duct and a stone, and a resected specimen with stones, numbered alike. Below: what sets it apart, and the three states compared. Press Esc to return to the organ.',
    lesionPDA: 'Pancreatic ductal adenocarcinoma: a drawing and real H&E of malignant glands in desmoplastic stroma invading a nerve, numbered alike. Below: what sets it apart, and PDA by location compared. Press Esc to return to the organ.',
    precursors: 'Precursor lesions: where the routes to pancreatic ductal adenocarcinoma begin. PanIN arises in the small ducts at the periphery, most readily in the head; mucinous cystic neoplasms in the periphery of the body and tail; IPMN in the main duct or its major branches, usually in the head (Hingorani 2007). Each inset shows one lesion in H&E; click it, or a lesion on the organ, or zoom into one, to open its histology. Placement on the organ is simulated, by rule; sizes are illustrative.',
    lesionPanIN: 'PanIN in real H&E sections, from a normal duct to high grade, with its key features numbered. Below: what sets it apart, and PanIN, IPMN and MCN compared. Press Esc or All precursors to return to the organ.',
    lesionIPMN: 'IPMN in a resected pancreas and in H&E sections, main-duct and branch-duct, gastric and pancreatobiliary types, with its key features numbered. Below: what sets it apart, and the three precursors compared. Press Esc or All precursors to return.',
    lesionMCN: 'MCN in H&E sections, at very low power and at the wall, with its key features numbered: the fibrous capsule, mucinous lining and dense ovarian-type stroma. Below: what sets it apart, and the three precursors compared. Press Esc or All precursors to return.',
    acinusCell: 'One acinar cell, in its place in the acinus: rough ER round the basal nucleus makes digestive enzymes, the Golgi packages them, and zymogen granules wait at the apex (Palade 1975). With Motion on, granules leave the Golgi, travel to the apex and fuse with the membrane, releasing their enzymes into the lumen and on down the intercalated duct. Cholecystokinin and acetylcholine trigger this release by raising calcium inside the cell (Messenger et al. 2014). Organelle sizes and numbers, and the speed of the motion, are illustrative.',
    acinusCells: 'The acinus pulled apart into its cells, like the segments of an orange: each wedge-shaped acinar cell slides out along its own axis, carrying its basal nucleus and its apical granules; the centroacinar cells stay at the centre, and the intercalated duct draws back. Zoom on toward one cell to see it alone; zoom out and they close up again.',
    isletCells: 'The islet’s cells drawn apart from its centre so each stands distinct: beta (green), alpha (magenta), delta (cyan) and PP (amber), intermixed as in human islets (Cabrera 2006). Its capillaries stay in place. Zoom on to one beta cell.',
    ductCells: 'The duct wall’s cells lifted off it and spread along it, so each cuboidal duct cell stands distinct. Zoom on to one cell.',
    isletCell: 'One beta cell, in its place in the islet beside its capillary: a central nucleus, Golgi and rough ER that make and package insulin, mitochondria, a primary cilium (in the pancreas only islet and duct cells have one; diIorio 2014), and insulin granules of about 350 nm, dark cores (insulin with zinc; Berclaz 2015) in clear halos. With Motion on, glucose (yellow) enters from the blood; as it is burned, ATP rises, ATP-sensitive potassium channels close, calcium flows in and granules fuse with the membrane, releasing insulin (green) into the capillary (Rorsman and Ashcroft 2018). Sizes, numbers and speed illustrative.',
    alphaCell: 'One alpha cell, in its place in the islet beside its capillary. It makes glucagon, stored in dense granules of about 200 nm with little or a grey halo, smaller than beta-cell granules (Brereton et al. 2015). When blood glucose falls, alpha cells release glucagon (pink) into the blood, and glucagon tells the liver to release glucose. Alpha cells are about a third to nearly half of human islet cells (33–46%; Cabrera et al. 2006). Sizes, numbers and speed illustrative.',
    deltaCell: 'One delta cell, in its place in the islet. It makes somatostatin, in homogeneous granules of about 250 nm (Brereton et al. 2015), and reaches its neighbours with long thin processes, 1 to 18 µm long in human islets (Arrojo e Drigo et al. 2019) and up to 22 µm, running from the islet capillaries towards its core; some human delta cells are rounded instead, 10 to 16 µm across (Grube and Bohn 1983, as reviewed in Brereton et al. 2015). With Motion on, somatostatin (blue) is released at the ends of the processes, next to beta and alpha cells, where it damps the release of insulin and glucagon. Delta cells are about a tenth of human islet cells (8–12%; Cabrera et al. 2006). Sizes, numbers and speed illustrative.',
    ductCell: 'One duct cell, in its place in the duct wall: cuboidal, a central nucleus, many mitochondria, microvilli and a primary cilium on the apical surface facing the lumen, a tight-junction belt round its apex, and the basement membrane beneath. CFTR (blue) and the Cl⁻/HCO₃⁻ exchanger SLC26A6 (orange) in the apical membrane, drawn far larger than the molecules, carry bicarbonate into the lumen. With Motion on, bicarbonate (teal) leaves through them and the fluid carries it along the duct. Secretin, acting through cAMP, is the main stimulus; the bicarbonate-rich fluid carries the enzymes away from the acini (Lee et al. 2012; Steward and Ishiguro 2009).',
  };
  let lastLevel = '';
  const LEVEL_NAMES = (key) => ({ compare: 'Head, body and tail compared', gross: 'Lobules (' + blockRegion + ')', organ: 'Organ', tissue: 'Tissue', acinus: 'Acinus', islet: 'Islet', duct: 'Duct',
    acinusCells: 'Acinar cells, separated', isletCells: 'Islet cells, separated', ductCells: 'Duct cells, separated', precursors: 'Precursor lesions', pancreatitis: 'Pancreatitis', pda: 'Pancreatic ductal adenocarcinoma', acinusCell: 'Acinar cell', isletCell: 'Beta cell', alphaCell: 'Alpha cell', deltaCell: 'Delta cell', ductCell: 'Duct cell' }[key] || '');
  function viewFrame(now, v) {
    if (MODE === 'atlas') { atlasFrame(now); return; }
    if (LES.view) { lesionFrame(now, v); return; }
    stepFlight(now);
    stageStep(camera.position.distanceTo(controls.target), now);
    if (camera.position.distanceTo(controls.target) > 90000) v.picked = false;   // back out at the organ: the next zoom in picks again
    if (tour && !flight && v.i === tour.view) { if (tour.phase === 'fly') { tour.phase = 'hold'; tour.until = now + 450; } else if (now > tour.until && !tour.speaking && now > (tour.readUntil || 0)) nextTour(); }
    const d = camera.position.distanceTo(controls.target);
    // Move the target toward the structure being zoomed into, carrying the camera with it.
    const a = anchorAt(d), delta = a.clone().sub(controls.target); controls.target.add(delta); camera.position.add(delta);
    // Until the view is turned by hand, it turns to look straight down the line going in as the layers open.
    if (!COMPARE.on && STAGE.mode === 'tissue' && !v.turned && site >= 0 && SITE_LIST[site].axis) { const k = 0.06 * ramp(d, 60000, 14000);
      if (k > 1e-3) { const dir = camera.position.clone().sub(controls.target).normalize().lerp(SITE_LIST[site].axis, k).normalize(); camera.position.copy(controls.target).addScaledVector(dir, d); } }
    // Anything much nearer than the point zoomed into is not drawn while the layers are open, so the view looks down the opening.
    camera.near = !COMPARE.on && STAGE.mode === 'tissue' && d < 30000 ? d * 0.5 : Math.max(0.05, d / 60); camera.far = Math.max(d * 300, 2e3); camera.updateProjectionMatrix();
    setLayers(d); const w = weights(d);
    fade(groups.organ, w.organ); if (lesionGroup) fade(lesionGroup, disease ? w.organ : 0);   // lesions are part of the organ view
    const firsts = ['head', 'body', 'tail'].map((rk) => SITE_LIST.findIndex((S0) => S0.region === rk && S0.verified));
    Object.keys(GROSS).map(Number).concat(firsts, [site]).filter((k, n, a) => a.indexOf(k) === n).forEach((k) => { const ci = firsts.indexOf(k), show = COMPARE.on ? ci >= 0 : (k === site && w.gross > 0.01); if (show) buildGross(k); const g = GROSS[k]; if (!g) return;
      if (COMPARE.on) g.position.copy(COMPARE.right).multiplyScalar((ci - 1) * 5600); else g.position.set(0, 0, 0); g.quaternion.copy(COMPARE.on ? COMPARE.q : g.userData.q); g.updateMatrixWorld(true); g.userData.toL.value.copy(g.matrixWorld).invert();
      if (show) { stainGroup(g); const R0 = LAYER.R.value.x, rr = (LAYER.R.value.y + Math.min(R0, Hv(d) / 2)) / 2; g.userData.wall.scale.set(R0 * 0.995 + 1, R0 * 0.995 + 1, g.userData.top + BELOW);
        g.userData.ring.position.set(rr * 0.83, rr * 0.56, Math.min(g.userData.top, 0.7 * d)); }
      g.userData.w = show ? w.gross : 0; fade(g, g.userData.w); });
    if (w.block > 0.01) { ensureBlock(); stainGroup(groups.block); if (SLICE.block) stainGroup(SLICE.block); } fade(groups.block, w.block);
    // Slice apart: the organ while it is in view, otherwise the block.
    const slicing = SLICE.value > 0.001, inner = groups.organ.userData.inner;
    if (inner) { const on = slicing && w.organ > 0.01;
      if (on && !SLICE.organ) { const bb = new THREE.Box3(); pancreasMeshes.forEach((m) => bb.expandByObject(m)); bb.expandByScalar(4000); SLICE.organ = sliceSet(inner, 8, bb.min.x, bb.max.x, X.clone(), [], 0, true); }
      inner.visible = !on; if (SLICE.organ) { fade(SLICE.organ, on ? w.organ : 0); if (on) layoutSlices(SLICE.organ, SLICE.value * SLICE.organ.userData.th * 1.4); } }
    // Slicing the core: the slabs run across the view, and the lobules round the core fade so the slices stand clear.
    if (groups.block) { const on = slicing && w.block > 0.01 && w.organ < 0.5;
      if (on && !SLICE.block) { const ax = X.clone().applyQuaternion(camera.quaternion); SLICE.block = sliceSet(groups.block, 6, -150, 150, ax, [], 45, false, ORG_TOL); applyToggles(SLICE.block); }
      if (on) { groups.block.visible = false; if (GROSS[site]) fade(GROSS[site], 0.15); } if (SLICE.block) { fade(SLICE.block, on ? w.block : 0); if (on) layoutSlices(SLICE.block, SLICE.value * 50 * 1.6); } }
    for (const [k, b] of Object.entries(BRANCHES)) {
      const on = k === branch; if (on && (w.detail > 0.01 || w.cell > 0.01)) ensureBranch(k);
      if (on) updateCut(b);
      if (on) { stainGroup(b.detail); stainGroup(b.cellGroup); }
      fade(b.detail, on ? w.detail : 0); fade(b.cellGroup, on ? w.cell : 0);
      if (on) { setExplode(b.detail, w.explode); if (b.cellGroup) b.cellGroup.position.copy(OFF[k]).multiplyScalar(w.explode);
        if (w.explode > 0.4 || STAGE.mode === 'tissue') b.plane.constant = 1e6; }   // once the cells part, no cut is needed
    }
    // Slice apart a structure or a cell: five slabs across the view.
    { const b = BRANCHES[branch], tgt = STAGE.mode === 'cell' ? b.cellGroup : STAGE.mode === 'structure' ? b.detail : null, on = slicing && tgt && tgt.visible;
      if (on && (!SLICE.part || SLICE.part.src !== tgt)) { dropSlices(['part']); const ax = X.clone().applyQuaternion(camera.quaternion), [lo, hi] = rangeAlong(tgt, ax);
        SLICE.part = { src: tgt, set: sliceSet(tgt, 5, lo - 0.5, hi + 0.5, ax, [], (hi - lo) / 10) }; stainGroup(SLICE.part.set); }
      if (SLICE.part) { const w0 = on ? (STAGE.mode === 'cell' ? w.cell : w.detail) : 0; fade(SLICE.part.set, w0); if (on) { tgt.visible = false; layoutSlices(SLICE.part.set, SLICE.value * SLICE.part.set.userData.th * 1.4); } } }
    if (motionOn) { const t = now / 1000; flow(groups.block, t); flow(BRANCHES[branch].detail, t); }
    { const b = BRANCHES[branch], t = motionOn ? now / 1000 : null; [b.detail, b.cellGroup].forEach((gg) => { if (gg && gg.visible && gg.userData.anim) gg.userData.anim(t); }); }   // secretion in motion
    if (marker) marker.visible = false;
    const lv = levelAt(d), key = MODE !== 'pancreas' && lv === 'organ' ? MODE : lv === 'detail' ? branch : lv === 'cells' ? branch + 'Cells' : lv === 'cell' ? cellKey(branch, isletKind) : lv;
    if (v.i === focus && (lv === 'gross' || lv === 'compare')) { const st = (k) => GROSS[k] && GROSS[k].userData.stats, firsts = ['head', 'body', 'tail'].map((rk) => SITE_LIST.findIndex((S0) => S0.region === rk && S0.verified));
      const txt = lv === 'compare' ? firsts.filter(st).map((k) => `${st(k).key[0].toUpperCase() + st(k).key.slice(1)}: ${st(k).count.toLocaleString('en')} islets in ${Math.round(st(k).volume)} mm³ (${Math.round(st(k).density)} per mm³)`).join('; ') + '.'
        : st(site) ? `Site ${site + 1}, in the ${blockRegion}: round the line going in, ${st(site).lobules} lobules are opened to their ducts, with ${st(site).count.toLocaleString('en')} islets in ${Math.round(st(site).volume)} mm³ (${Math.round(st(site).density)} per mm³).` : '';
      $('grossstats').textContent = txt; }
    if (key !== lastLevel) { lastLevel = key; UI.levelname.textContent = LEVEL_NAMES(key);
     if (v.i === focus) { writeHash(lv); showMarkers(selected ? MARKER_OF[selected] : MARKER_VIEW[key]); setInfo(INFO[key] + (/^islet/.test(key) && SITE_LIST[site] && SITE_LIST[site].sub === 'uncinate process' ? ' This site lies in the uncinate process, where PP cells (amber in Cell types) make up most of the islet (Gorelick and Williams 2021).' : ''));
      applyDataFor(key, MODE !== 'pancreas' ? key : lv);
      updatePickers();
      document.querySelectorAll('.ladder button[data-go]').forEach((b) => { const [l, br] = b.dataset.go.split(':'); b.setAttribute('aria-current', String(l === lv && (!br || br === branch) && (!b.dataset.kind || b.dataset.kind === isletKind))); }); } }
    explodeTags.forEach((o) => o.position.copy(o.userData.base).addScaledVector(o.userData.off, w.explode));
    if (lv === 'compare') drawLabels('compare', 1); else if (lv === 'gross') drawLabels('gross:' + site, w.gross);
    else if (lv === 'organ' && disease) drawDiseaseLabels(w.organ);
    else drawLabels(lv === 'organ' ? 'organ' : lv === 'tissue' ? 'tissue' : key, lv === 'organ' ? w.organ : lv === 'tissue' ? w.block : lv === 'cell' ? w.cell : w.detail);
    // Scale bar
    drawScale(d);
    controls.update(); renderer.setViewport(UI.x, 0, UI.w, UI.h); renderer.setScissor(UI.x, 0, UI.w, UI.h); renderer.render(scene, camera);
    if (v.i === focus) drawInsets(now, MODE !== 'pancreas' && lv === 'organ' && UI.w > 640);
    // Zooming into a lesion opens its view.
    if (MODE !== 'pancreas' && LES.pending && d < 70000 && !flight) enterLesion(LES.pending);
  }
  function drawScale(d) {
    const wpp = 2 * d * Math.tan(camera.fov * Math.PI / 360) / UI.h, target = wpp * 110, p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * p10).filter((x) => x <= target).pop() || p10; UI.bar.style.width = (nice / wpp) + 'px';
    UI.barlabel.textContent = nice >= 10000 ? `${+(nice / 10000).toPrecision(3)} cm` : nice >= 1000 ? `${+(nice / 1000).toPrecision(3)} mm` : `${+nice.toPrecision(3)} µm`;
  }
  function applyDataFor(key, lv) { document.querySelectorAll('[data-for]').forEach((el) => { el.style.display = el.dataset.for.split(' ').some((x) => x === key || x === lv) ? '' : 'none'; }); }
  function activate(v) { camera = v.camera; controls = v.controls; STAGE = v.STAGE; branch = v.branch; flight = v.flight; lastLevel = v.lastLevel; UI = v.ui; labelLayer = v.ui.labels; pool = v.ui.pool; }
  function save(v) { v.branch = branch; v.flight = flight; v.lastLevel = lastLevel; }
  function setFocus(i) { if (i === focus || !VIEWS[i]) return; save(VIEWS[focus]); focus = i; activate(VIEWS[i]); lastLevel = ''; VIEWS[i].lastLevel = '';
    VIEWS.forEach((v) => v.el.classList.toggle('focused', splitOn && v.i === focus));
    document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === branch))); }
  // Dynamic resolution: when frames run slow (the cut-open tissue is heavy on dense screens), draw fewer pixels, never below 1x;
  // when there is room again, go back up.
  const DPR = { max: Math.min(devicePixelRatio, 2), cur: Math.min(devicePixelRatio, 2), ema: 16.7, prev: 0, changed: 0 };
  function adaptResolution(now) {
    const dt = now - DPR.prev; DPR.prev = now; if (dt <= 0 || dt > 250) return; DPR.ema += (dt - DPR.ema) * 0.06;
    if (now - DPR.changed < 1500) return;
    const next = DPR.ema > 24 ? Math.max(1, DPR.cur - 0.25) : DPR.ema < 17.5 ? Math.min(DPR.max, DPR.cur + 0.25) : DPR.cur;
    if (next !== DPR.cur) { DPR.cur = next; DPR.changed = now; renderer.setPixelRatio(next); }
  }
  ['wheel', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => $('hint').classList.add('gone'), { once: true, passive: true }));
  function frame(now) {
    adaptResolution(now); updateHover(now);
    save(VIEWS[focus]);   // anything the panel changed since the last frame belongs to the focused view
    { const inner = groups.organ.userData.inner; if (inner) { const goal = organLocal.clone().negate(); if (inner.position.distanceTo(goal) > 1) { inner.position.lerp(goal, reduced ? 1 : 0.08); if (SLICE.organ) { scene.remove(SLICE.organ); SLICE.organ = null; } } } }
    renderer.setScissorTest(true); renderer.setClearColor(0x000000, 0); renderer.setScissor(0, 0, stage.clientWidth, stage.clientHeight); renderer.clear();
    const n = splitOn ? 2 : 1;
    for (let k = 0; k < n; k++) { const v = VIEWS[k]; activate(v); viewFrame(now, v); save(v); }
    activate(VIEWS[focus]);
  }
  // ---------- precursors and cancer, on the organ. Where each kind arises follows Hingorani 2007 (Gastroenterology
  // 133:345-50, Table 1 and Figure 1) and, for branch-duct IPMN, Rodriguez et al. 2007 (133:72-9). The placement is a
  // written rule on the HRA organ; sizes are illustrative (PanIN markers far larger than the microscopic lesions).
  const LESIONS = {
    panin: { name: 'PanIN', full: 'Pancreatic intraepithelial neoplasia (PanIN)', color: '--panin',
      where: 'Small ducts at the periphery (terminal ductules); progresses to cancer most readily in the head and uncinate process (Hingorani 2007). Found more often in the head than the tail (Beger 4th ed., ch. 126).', size: 'Microscopic, usually under 0.5 cm; invisible to the eye and on imaging (the organ markers are drawn far larger).',
      text: 'The commonest precursor of ductal adenocarcinoma. Its cells are cuboidal to columnar with apical mucin, flat or micropapillary. Graded today in two tiers: low grade (formerly PanIN-1A, 1B and 2) and high grade (formerly PanIN-3: marked atypia, loss of polarity, budding), the latter found almost only beside invasive cancer. PanIN is present in 82% of pancreata with cancer, 60% with chronic pancreatitis and 16% of normal pancreata, more with age. KRAS is mutated in over 90% even at low grade and telomeres shorten first; CDKN2A follows, TP53 and SMAD4 come late (Beger 4th ed., ch. 126; Robbins 9th ed., ch. 19).',
      survival: 'Invasive cancer from PanIN, after resection: 15–20% alive at 5 years, under 2% at 10 years (Hingorani 2007).' },
    mcn: { name: 'MCN', full: 'Mucinous cystic neoplasm (MCN)', color: '--mcn',
      where: 'Over 90% in the body or tail, at the periphery; no connection with the ducts (Hingorani 2007; Beger 4th ed., ch. 81 and 126).', size: 'Median 3.5–5 cm on imaging (range 0.5–20 cm); drawn 5 cm (Beger 4th ed., ch. 126).',
      text: 'A solitary cyst, often with cysts within it, behind a thick fibrous capsule. It is lined by columnar mucin-making cells (flat or cuboidal in places) over dense “ovarian-type” stroma of spindle cells with oestrogen and progesterone receptors, which the diagnosis requires. Almost only in women (10–20 : 1), mostly perimenopausal, around 45–48 years. KRAS and RNF43 are mutated; GNAS is not, which separates it from IPMN. Invasive carcinoma in 6–25% of resected MCNs (Beger 4th ed., ch. 126; Hingorani 2007).',
      survival: 'With invasive cancer, after resection: 40–60% alive at 5 years (Hingorani 2007); disease-specific 5-year survival of resected MCN 57–80% (Beger 4th ed., ch. 126).' },
    mipmn: { name: 'Main-duct IPMN', full: 'Intraductal papillary mucinous neoplasm of the main duct', color: '--ipmn',
      where: 'Usually the head and uncinate process; the main duct, dilated (Hingorani 2007; Beger 4th ed., ch. 126).', size: 'Main duct dilated beyond 5 mm; 5–9 mm is a worrisome feature, 10 mm or more a high-risk sign (Beger 4th ed., ch. 84 and 86). Drawn at 10 mm.',
      text: 'Long finger-like papillae of mucin-making cells grow along the inside of the main duct, which fills with thick mucin; the papilla of the duodenum may gape and extrude mucus. Papillae can block the duct and cause pancreatitis. Seventh and eighth decades, slightly more in men. Invasive carcinoma in 43.6% of main-duct IPMNs in pooled series. Often intestinal type (MUC2, CDX2), which gives colloid carcinoma. KRAS and GNAS are each mutated in 50–80% (Beger 4th ed., ch. 125 and 126; Hingorani 2007).',
      survival: 'With invasive cancer, after resection: about 60% at 5 years and at least 40% at 10 years (Hingorani 2007).' },
    bipmn: { name: 'Branch-duct IPMN', full: 'Intraductal papillary mucinous neoplasm of a branch duct', color: '--ipmn',
      where: 'Head or neck and uncinate process; a major side branch, next to a main duct that is not dilated (Beger 4th ed., ch. 81 and 86; Rodriguez et al. 2007).', size: 'Grape-like cysts over 10 mm that open into the duct; a cyst over 3 cm is a worrisome feature (Beger 4th ed., ch. 86).',
      text: 'A cluster of dilated side branches, like grapes, that still communicate with the main duct, which separates it from MCN. Mostly gastric type: one layer of columnar cells with basal nuclei and abundant mucin, usually low grade. Less aggressive than main-duct IPMN: invasive carcinoma in 16.6% in pooled series, 11% in Rodriguez et al. 2007. Small cysts without mural nodules or a dilated main duct may be watched (Beger 4th ed., ch. 126; Rodriguez et al. 2007).',
      survival: 'With invasive cancer, after resection: about 63% at 5 years (Hingorani 2007).' },
    pda: { name: 'Ductal adenocarcinoma', full: 'Pancreatic ductal adenocarcinoma (PDA)', color: '--pda',
      where: 'Head about 60%, body 15%, tail 5%, diffuse 20% (Robbins 9th ed.). Head tumours block the bile duct; body and tail tumours are silent, larger and more often spread when found (Beger 4th ed., ch. 137).', size: 'A hard, grey-white, ill-defined mass (drawn about 3 cm; size not sourced).',
      text: 'Malignant glands, poorly formed and lined by pleomorphic cuboidal to columnar cells, infiltrate an intense desmoplastic stroma laid down by activated stellate cells. Invasion along nerves is found in practically every case and tracks with pain; vessels are often invaded. Upstream of the tumour the ducts dilate and the gland atrophies. Genes: KRAS over 90%, CDKN2A about 90–95%, TP53 about 75%, SMAD4 about 55%. At diagnosis 15–20% are resectable, 30–40% locally advanced and 40–50% have spread, chiefly to the liver and lungs (Robbins 9th ed., ch. 19; Beger 4th ed., ch. 119, 125, 130, 134).',
      survival: 'Five-year survival about 10% overall (39% localized, 13% regional, 3% distant); 15–25% after resection (Beger 4th ed.); older data under 5% (Robbins 9th ed.).',
      source: 'Robbins 9th ed. ch. 19 (pp. 892-894); Beger 4th ed. ch. 119, 125, 128, 130, 134, 137; Hingorani 2007. Text in our own words. Placement and sizes on the organ are simulated, by rule.' },
    pdaSpread: { name: 'Spread', full: 'Where PDA spreads', color: '--pda', where: 'Upstream ducts, bile duct, regional lymph nodes, liver', size: 'Illustrative', text: '', survival: '' },
    acute: { name: 'Acute pancreatitis', full: 'Acute pancreatitis', color: '--acute',
      where: 'Can involve the whole gland and the fat around it; drawn on the body and tail.', size: 'Interstitial oedematous form in 90–95%: swelling and fat necroses under 10 mm. Necrotizing form in 5–10%: confluent necrosis of gland and fat, which over 5 cm walls off in 20–30 days (Beger 4th ed., ch. 17).',
      text: 'Enzymes activated too early digest the gland and the fat around it. Trypsin activates other proenzymes; lipase splits fat, and the freed fatty acids bind calcium into chalky soaps (fat necrosis). In the interstitial form there is oedema, mild inflammation and small fat necroses; in the necrotizing form acini, ducts and islets die and veins bleed. Gallstones and alcohol cause about 80%; genes such as PRSS1, SPINK1, CFTR and CTRC raise risk (Robbins 9th ed., ch. 19).',
      survival: 'About 5% of severe cases die in the first week; 40–60% of necrotizing cases become infected; pseudocysts can follow (Robbins 9th ed., ch. 19).',
      source: 'Robbins 9th ed. ch. 19 (pp. 884-887); Beger 4th ed. ch. 17 (pp. 164-168). Text in our own words. Placement on the organ is simulated, by rule.' },
    chronic: { name: 'Chronic pancreatitis', full: 'Chronic pancreatitis', color: '--chronic',
      where: 'The whole gland, often worst in the head; drawn in the head.', size: 'Gland firm and shrunken, with a dilated, strictured duct and stones in about half (Beger 4th ed., ch. 41).',
      text: 'Repeated injury leads to fibrosis and loss of acini. Activated stellate cells (4–7% of the gland’s cells) lay down collagen. Ducts dilate behind strictures and fill with protein plugs that calcify into stones; islets are spared at first and gather together, then are lost, so 70% develop diabetes. Long-term alcohol is the commonest cause; up to a quarter are genetic (PRSS1, SPINK1, CFTR, CTRC) (Robbins 9th ed., ch. 19; Beger 4th ed., ch. 7, 41).',
      survival: 'Mortality about 50% at 20–25 years; pancreatic cancer risk about 12-fold, and 69-fold in hereditary pancreatitis (Robbins 9th ed.; Beger 4th ed., ch. 47).',
      source: 'Robbins 9th ed. ch. 19 (pp. 886-889); Beger 4th ed. ch. 7, 41, 47. Text in our own words. Placement on the organ is simulated, by rule.' },
  };
  const LESION_SOURCE = 'Hingorani SR. Gastroenterology 2007;133:345-50, doi:10.1053/j.gastro.2007.05.059. Rodriguez JR et al. Gastroenterology 2007;133:72-9, doi:10.1053/j.gastro.2007.05.010. Beger HG et al., eds. The Pancreas: An Integrated Textbook, 4th ed. Wiley 2023 (ch. 81, 84, 86, 125, 126). Kumar V, Abbas AK, Aster JC. Robbins and Cotran Pathologic Basis of Disease, 9th ed. 2015 (ch. 19). Text in our own words. Placement on the HRA organ is simulated, by rule; drawn sizes follow the sizes stated.';
  let disease = null, lesionGroup = null;
  function buildLesions() {
    if (lesionGroup) return lesionGroup;
    const inner = groups.organ.userData.inner, g = new THREE.Group(), R = rng(17631154); g.userData.mats = []; lesionGroup = g; inner.add(g);
    const vertsOf = (names) => { const out = []; names.forEach((n) => { const m = inner.getObjectByName(n); if (!m) return; const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 3) out.push(new THREE.Vector3().fromBufferAttribute(p, i)); }); return out; };
    const C = (r) => SITES[r], whole = ['head', 'uncinate process', 'neck', 'body', 'tail'].map(C).filter(Boolean).reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(5);
    const nearest = (p, names) => names.reduce((b, n) => (C(n) && C(n).distanceTo(p) < C(b).distanceTo(p) ? n : b), names[0]);
    const mat = (color, extra) => M(g, color, null, Object.assign({ roughness: 0.6, he: false }, extra || {}));
    const ball = (parent, p, r, m) => { const o = new THREE.Mesh(ballHi, m); o.position.copy(p); o.scale.setScalar(r); parent.add(o); return o; };
    const part = (key) => { const q = new THREE.Group(); q.name = key; g.add(q); return q; };
    // PanIN: points of the head and uncinate surface moved a little inward (the periphery), as enlarged markers.
    { const q = part('panin'), headV = vertsOf(['head_of_pancreas', 'uncinate_process_of_the_pancreas', 'ucinate_process1']), m = mat('--panin', { emissive: new THREE.Color('#5a3200') });
      for (let k = 0; k < 22; k++) { const v = headV[Math.floor(R() * headV.length)], c = C(nearest(v, ['head', 'uncinate process'])); ball(q, v.clone().lerp(c, 0.12), 1400, m); }
      q.userData.at = C('head'); tag('disease:panin', q, 'PanIN (microscopic; markers enlarged)', headV[0].clone().lerp(C('head'), 0.12)); }
    // MCN: a multilocular cyst at the periphery of the tail.
    { const q = part('mcn'), tailV = vertsOf(['tail_of_pancreas']), far = tailV.reduce((b, v) => (v.distanceTo(C('neck')) > b.distanceTo(C('neck')) ? v : b)), at = far.clone().lerp(C('tail'), 0.35);
      const shell = mat('--mcn', { transparent: true, opacity: 0.55, depthWrite: false }), loc = mat('--mcn', { transparent: true, opacity: 0.35, depthWrite: false });
      ball(q, at, 25000, shell); for (let k = 0; k < 6; k++) ball(q, at.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(14000)), 4000 + 3000 * R(), loc);
      q.userData.at = at; tag('disease:mcn', q, 'Mucinous cystic neoplasm', at); }
    // The main duct through the head: duct vertices nearer the head than the neck, binned along their main direction.
    const ductV = vertsOf(['ventral_pancreatic_duct', 'dorsal_pancreatic_duct']), inHead = ductV.filter((v) => C('head').distanceTo(v) < C('neck').distanceTo(v));
    const axis = C('neck').clone().sub(C('head')).normalize(), along = (v) => v.clone().sub(C('head')).dot(axis), bins = new Map();
    inHead.forEach((v) => { const k = Math.round(along(v) / 2500); const b = bins.get(k) || []; b.push(v); bins.set(k, b); });
    const path = [...bins.keys()].sort((a, b) => a - b).map((k) => bins.get(k).reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(bins.get(k).length));
    // Main-duct IPMN: the duct through the head dilated, with papillae inside.
    { const q = part('mipmn'), m = mat('--ipmn', { transparent: true, opacity: 0.5, depthWrite: false }), pap = mat('--ipmn');
      if (path.length > 1) { const curve = new THREE.CatmullRomCurve3(path); q.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 3500, 16, false), m));
        for (let k = 0; k < 40; k++) { const t = R(), p = curve.getPoint(t), d = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(); ball(q, p.addScaledVector(d, 2400), 700 + 500 * R(), pap); }
        q.userData.at = curve.getPoint(0.5); tag('disease:mipmn', q, 'Main-duct IPMN', curve.getPoint(0.5)); } }
    // Branch-duct IPMN: grape-like cysts on a side branch from the main duct, toward the neck.
    { const q = part('bipmn'), m = mat('--ipmn', { transparent: true, opacity: 0.55, depthWrite: false }), root = path.length ? path[path.length - 1].clone() : C('neck').clone();
      const out = root.clone().sub(whole).normalize().cross(axis).normalize(), tip = root.clone().addScaledVector(out, 9000);
      q.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(root, tip), 4, 1200, 10, false), m));
      for (let k = 0; k < 8; k++) ball(q, tip.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(11000)), 3500 + 2500 * R(), m);
      q.userData.at = tip; tag('disease:bipmn', q, 'Branch-duct IPMN', tip); }
    // Ductal adenocarcinoma: an irregular solid mass in the head, toward the common bile duct.
    { const q = part('pda'), cbd = vertsOf(['common_bile_duct']), nearCbd = cbd.reduce((b, v) => (v.distanceTo(C('head')) < b.distanceTo(C('head')) ? v : b), cbd[0] || C('head')), at = C('head').clone().lerp(nearCbd, 0.55);
      const geo = new THREE.IcosahedronGeometry(1, 4), p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i), n = 1 + 0.22 * Math.sin(v.x * 5.1 + 1.3) * Math.cos(v.y * 4.3) + 0.12 * Math.sin(v.z * 9.7 + v.x * 3); p.setXYZ(i, v.x * n, v.y * n, v.z * n); }
      geo.computeVertexNormals(); const o = new THREE.Mesh(geo, mat('--pda', { roughness: 0.85 })); o.position.copy(at); o.scale.setScalar(14000); q.add(o);
      q.userData.at = at; tag('disease:pda', q, 'Ductal adenocarcinoma', at); }
    const pathOf = (verts, a, b, step) => { const ax = b.clone().sub(a).normalize(), bins = new Map(); verts.forEach((v) => { const k = Math.round(v.clone().sub(a).dot(ax) / step); const l = bins.get(k) || []; l.push(v); bins.set(k, l); });
      return [...bins.keys()].sort((x, y) => x - y).filter((k) => bins.get(k).length > 2).map((k) => bins.get(k).reduce((s0, v) => s0.add(v), new THREE.Vector3()).divideScalar(bins.get(k).length)); };
    // Spread of PDA: the bile duct and the main duct dilated behind the tumour (the double duct sign), enlarged nodes, liver metastases.
    { const q = part('pdaSpread'), m = mat('--organduct', { transparent: true, opacity: 0.55, depthWrite: false }), cbd = vertsOf(['common_bile_duct']);
      if (cbd.length) { const lo = cbd.reduce((b, v) => (v.y < b.y ? v : b)), hi = cbd.reduce((b, v) => (v.y > b.y ? v : b)), pth = pathOf(cbd, lo, hi, 3000); if (pth.length > 2) { q.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pth), 40, 4200, 12, false), m)); tag('disease:pdaSpread', q, 'Bile duct, dilated', pth[Math.floor(pth.length * 0.7)]); } }
      const up = vertsOf(['dorsal_pancreatic_duct', 'ventral_pancreatic_duct']).filter((v) => C('neck').distanceTo(v) < C('head').distanceTo(v)), dp = pathOf(up, C('neck'), C('tail'), 4000);
      if (dp.length > 2) { q.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dp), 60, 3000, 12, false), m)); tag('disease:pdaSpread', q, 'Main duct, dilated upstream', dp[Math.floor(dp.length / 2)]); }
      const nm = mat('#5b5466', { roughness: 0.7 }); for (let k = 0; k < 4; k++) ball(q, C('head').clone().add(new THREE.Vector3((R() - 0.5) * 30000, (R() - 0.5) * 20000, -12000 - R() * 8000)), 3500 + 1500 * R(), nm);
      const liver = vertsOf(['liver_capsule']);
      if (liver.length) { const lc = liver.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(liver.length), mm = mat('#f4efe6', { roughness: 0.8 }); let first = null;
        for (let k = 0; k < 7; k++) { const v = liver[Math.floor(R() * liver.length)].clone().lerp(lc, 0.08 + 0.1 * R()); ball(q, v, 5000 + 4000 * R(), mm); first = first || v; } tag('disease:pdaSpread', q, 'Liver metastases', first); } }
    // Acute pancreatitis, on the body and tail: swollen, inflamed fat round the gland, chalky fat necroses, and haemorrhage.
    { const q = part('acute'), halo = mat('--acute', { transparent: true, opacity: 0.28, depthWrite: false }), chalk = mat('#fbf6e9', { roughness: 0.9 }), blood = mat('#7a1424', { roughness: 0.6 });
      ['body_of_pancreas', 'tail_of_pancreas'].forEach((n) => { const src = inner.getObjectByName(n); if (!src) return; const c = C(REGION_NAMES[n]), gm = src.geometry.clone().translate(-c.x, -c.y, -c.z).scale(1.12, 1.12, 1.12).translate(c.x, c.y, c.z); q.add(new THREE.Mesh(gm, halo)); });
      const surf = vertsOf(['body_of_pancreas', 'tail_of_pancreas']), mid = C('body').clone().lerp(C('tail'), 0.5);
      for (let k = 0; k < 26; k++) { const v = surf[Math.floor(R() * surf.length)], out = v.clone().sub(mid).normalize(); ball(q, v.clone().addScaledVector(out, 2500 + 3000 * R()), 900 + 1500 * R(), chalk); }
      for (let k = 0; k < 5; k++) { const v = surf[Math.floor(R() * surf.length)], o = ball(q, v, 3500 + 2000 * R(), blood); o.scale.y *= 0.4; }
      q.userData.at = mid; tag('disease:acute', q, 'Acute pancreatitis: oedema, fat necrosis, haemorrhage', C('tail').clone().lerp(mid, 0.3)); }
    // Chronic pancreatitis, in the head: a beaded, dilated duct ("chain of lakes") with calcified stones, in a firm, shrunken gland.
    { const q = part('chronic'), lake = mat('#cfe0ef', { transparent: true, opacity: 0.6, depthWrite: false }), stone = mat('#f3e7b8', { roughness: 0.9, emissive: new THREE.Color('#3a2f00') });
      if (path.length > 1) { const curve = new THREE.CatmullRomCurve3(path), N = 30;
        for (let k = 0; k <= N; k++) { const t = k / N; ball(q, curve.getPoint(t), 2200 + 1800 * Math.max(0, Math.sin(t * Math.PI * 5)), lake); }   // dilations between strictures
        for (let k = 0; k < 16; k++) ball(q, curve.getPoint(R()).add(new THREE.Vector3((R() - 0.5) * 2500, (R() - 0.5) * 2500, (R() - 0.5) * 2500)), 700 + 900 * R(), stone);
        const headV = vertsOf(['head_of_pancreas']); for (let k = 0; k < 10; k++) ball(q, headV[Math.floor(R() * headV.length)].clone().lerp(C('head'), 0.2 + 0.3 * R()), 600 + 700 * R(), stone);
        q.userData.at = curve.getPoint(0.5); tag('disease:chronic', q, 'Chronic pancreatitis: stones, beaded duct, fibrosis', curve.getPoint(0.4)); } }
    return g;
  }
  function setDisease(key) {
    disease = key && (key === 'all' || MODE_PARTS[key] || LESIONS[key]) ? key : null;
    document.querySelectorAll('[data-disease]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.disease || null) === (disease || null) || (!disease && b.dataset.disease === 'none'))));
    if (disease) buildLesions();
    if (lesionGroup) { lesionGroup.visible = !!disease; lesionGroup.children.forEach((q) => { q.visible = disease === 'all' || (MODE_PARTS[disease] || []).includes(q.name) || q.name === disease; }); }
    pancreasMeshes.forEach((m) => { m.material.userData.base = disease ? 0.28 : 0.92; });
    renderLesionCard();
    if (disease && disease !== 'all' && !MODE_PARTS[disease]) { const at = lesionGroup.getObjectByName(disease).userData.at; if (at) { let bi = 0, bd = Infinity; SITE_LIST.forEach((S0, k) => { const dd = S0.local.distanceTo(at); if (dd < bd) { bd = dd; bi = k; } }); if (bi !== site) setSite(bi); } }
    if (disease && STAGE.mode === 'tissue' && camera.position.distanceTo(controls.target) < 60000) flyTo(STOPS.organ, undefined, 'tissue');
    hashNow();
  }
  // ---------- what is shown: the pancreas (organ to cell), or the precursor lesions (pancreatitis and PDA to come).
  // Precursor lesions: the whole organ with PanIN, IPMN and MCN marked where they arise, each joined to an inset of its
  // histology as in Hingorani 2007 (Figure 1); clicking or zooming into one opens real H&E micrographs with its features marked.
  let MODE = 'pancreas';
  const LES = { view: null, pending: null };
  const LESION_VIEWS = { panin: { mode: 'precursors', title: 'PanIN', parts: ['panin'], at: 'panin' }, ipmn: { mode: 'precursors', title: 'IPMN', parts: ['mipmn', 'bipmn'], at: 'mipmn' }, mcn: { mode: 'precursors', title: 'MCN', parts: ['mcn'], at: 'mcn' },
    acute: { mode: 'pancreatitis', title: 'Acute pancreatitis', parts: ['acute'], at: 'acute' }, chronic: { mode: 'pancreatitis', title: 'Chronic pancreatitis', parts: ['chronic'], at: 'chronic' },
    pda: { mode: 'pda', title: 'PDA', parts: ['pda', 'pdaSpread'], at: 'pda' } };
  // What each disease mode shows on the organ.
  const MODE_PARTS = { precursors: ['panin', 'mcn', 'mipmn', 'bipmn'], pancreatitis: ['acute', 'chronic'], pda: ['pda', 'pdaSpread'] };

  // Each precursor is shown in real H&E micrographs (open-licensed, credited), with its key features marked and numbered,
  // what sets it apart, and a comparison of the three. Marks are placed by hand on each image (x, y as fractions of it).
  const HISTO_IMG = JSON.parse($('histo').textContent);
  const COMPARE_ROWS = [
    ['Size', 'Microscopic, usually < 0.5 cm; not seen on imaging', 'Macroscopic, usually ≥ 1 cm; main duct > 5 mm, branch cysts > 10 mm', 'Cyst, median 3.5–5 cm (0.5–20)'],
    ['Where', 'Small peripheral ducts; head more than tail', 'Main duct or its major branches; usually head and uncinate', 'Body or tail (> 90%), periphery'],
    ['Connects with the ducts?', 'Arises within a small duct', 'Yes: grows inside the ducts', 'No'],
    ['Lining', 'Cuboidal → columnar with apical mucin; flat → papillary as grade rises', 'Tall columnar mucinous cells on papillae; gastric, intestinal or pancreatobiliary type', 'Columnar mucinous cells, in places flat or cuboidal'],
    ['Stroma', 'Ordinary periductal stroma', 'Ordinary fibrous stroma', 'Ovarian-type: dense spindle cells with wavy nuclei, oestrogen and progesterone receptors'],
    ['Mucin', 'Within the cells', 'Abundant; fills the dilated ducts, may extrude from the papilla', 'Thick mucin in the locules'],
    ['Who', '16% of normal pancreata, more with age; 82% of pancreata with cancer', '7th–8th decade, slightly more men', 'Almost only women (10–20 : 1), around 45–48 years'],
    ['Genes', 'KRAS > 90% and telomere shortening early; CDKN2A, then TP53 and SMAD4', 'KRAS and GNAS, each 50–80%; RNF43', 'KRAS, RNF43; no GNAS'],
  ];
  const PANC_ROWS = [
    ['Lobules', 'Packed acini, thin septa', 'Pushed apart by oedema; in the necrotizing form, parts die', 'Lost; replaced by dense fibrosis'],
    ['Inflammation', 'None', 'Neutrophils', 'Lymphocytes and plasma cells'],
    ['Fat', 'Viable', 'Fat necrosis with calcium soaps', 'May be replaced by fibrosis'],
    ['Ducts', 'Normal calibre', 'May be blocked (gallstone)', 'Dilated, strictured, with stones'],
    ['Islets', 'Scattered among acini', 'Spared unless the lobule dies', 'Spared at first, then lost: diabetes in 70%'],
    ['Reversible?', '—', 'Usually, if the cause is removed', 'No'],
    ['Main causes', '—', 'Gallstones and alcohol (about 80%)', 'Long-term alcohol; genetic in up to 25%'],
  ];
  const CHEN = 'Chen W, Ahmed N, Krishna SG. Diagnostics 2023;13:65, doi:10.3390/diagnostics13010065 (CC BY 4.0), fig. 4', CHEK = 'Chekmareva I, Kostin A, Paklina O, et al. Int J Mol Sci 2025;26:10169, doi:10.3390/ijms262010169 (CC BY 4.0), fig. 1';
  const DISTLER = 'Distler et al. 2014 (CC BY)', DISTLER_REF = 'Distler M, Aust D, Weitz J, Pilarsky C, Grützmann R. Precursor lesions for sporadic pancreatic cancer: PanIN, IPMN, and MCN. Biomed Res Int 2014;2014:474905, doi:10.1155/2014/474905 (CC BY; high-power photographs)';
  const HISTO = {
    panin: { hp: [{ img: 'panin1a-hp', w: 560, h: 349, credit: `PanIN-1A: flat epithelium, basal nuclei, abundant supranuclear mucin (H&E, ×20). ${DISTLER}, fig. 3a.`,
          marks: [[0.2, 0.42, 'Pale apical mucin', 0, 3], [0.37, 0.64, 'Tall columnar cells, basal nuclei', 0, 2]] },
        { img: 'panin2-hp', w: 470, h: 404, credit: `PanIN-2: moderate atypia, polarity kept, partly papillary (H&E, ×20). ${DISTLER}, fig. 4a.`,
          marks: [[0.13, 0.5, 'Crowded, stratified nuclei', 0, 5], [0.6, 0.72, 'Papillary folds', 0, 4]] },
        { img: 'panin3-hp', w: 560, h: 319, credit: `PanIN-3: severe atypia, polarity lost, papillary (H&E, ×40). ${DISTLER}, fig. 4b.`,
          marks: [[0.08, 0.12, 'Cells budding into the lumen', 0, 6], [0.62, 0.55, 'Nuclei crowded, polarity lost', 0, 6]] }], title: 'Pancreatic intraepithelial neoplasia (PanIN)', lead: 'A microscopic change in the lining of small ducts. As the grade rises, the cells go from low cuboidal to tall columnar with mucin, the lining folds into papillae, and the nuclei crowd, enlarge and lose their place at the base.',
      more: [['Johns Hopkins: mimickers of PanIN', 'https://pathology.jhu.edu/pancreas/medical-professionals/duct-lesions/mimickers-of-panin'], ['Johns Hopkins: pancreas cysts and precursors', 'https://pathology.jhu.edu/pancreas/ipmn/pancreas-cysts']],
      drawing: { w: 1000, h: 400, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Koorstra et al. 2008 and Beger et al. 4th ed., ch. 126, and the progression figure of Hackeng et al. 2016.',
        marks: [[0.052, 0.4375, 'Normal duct: low cuboidal cells'], [0.295, 0.63, 'Tall columnar cells, basal nuclei'], [0.295, 0.265, 'Pale apical mucin'], [0.565, 0.4375, 'Micropapillary folds'], [0.7, 0.62, 'Papillae; crowded, stratified nuclei'], [0.9, 0.4375, 'Budding, loss of polarity, marked atypia'], [0.165, 0.81, 'KRAS and telomere shortening first'], [0.373, 0.63, 'Lobular atrophy: small acini, fat, fibrosis, islet cells']] },
      figures: [{ img: 'panin', w: 974, h: 344, credit: 'Hackeng WM, Hruban RH, Offerhaus GJ, Brosens LA. Diagn Pathol 2016;11:47, doi:10.1186/s13000-016-0497-z (CC BY 4.0); arranged by M. Häggström, via Wikimedia Commons.',
        marks: [[0.105, 0.50, 'Normal duct: low cuboidal cells', 1], [0.215, 0.62, 'Tall columnar cells', -1], [0.395, 0.34, 'Pale apical mucin', 1], [0.46, 0.63, 'Micropapillary folds', 1], [0.6, 0.47, 'Papillae; crowded, stratified nuclei', 1], [0.88, 0.16, 'Budding, loss of polarity, marked atypia', -1], [0.33, 0.88, 'KRAS and telomere shortening first', 1]] }],
      key: ['Normal duct: a single layer of low cuboidal cells with little mucin.', 'PanIN-1A (low grade): flat, tall columnar cells with small, round nuclei at the base.', 'Abundant pale mucin fills the top of each cell (gastric-foveolar type).', 'PanIN-1B (low grade): the lining folds into micropapillae; nuclei still basal.', 'PanIN-2 (now low grade): more complex papillae; nuclei crowded, enlarged, darker and stratified, beginning to lose polarity; mitoses rare.', 'PanIN-3 (high grade, carcinoma in situ): widespread loss of polarity, marked atypia, frequent mitoses, cells budding into the lumen, yet still within the basement membrane; found almost only beside invasive cancer.', 'Genetic progression: telomere shortening and KRAS in over 90% from the start; CDKN2A (p16) loss, then TP53 and SMAD4 late.', 'Drawing only: lobular atrophy round each PanIN, even low grade. Acini shrink and drop out, islets gather, and fibrosis and fat take their place, while neighbouring lobules stay normal (Brune et al. 2006).'],
      unique: ['Microscopic: under 0.5 cm, invisible to the eye and to imaging, unlike IPMN and MCN.', 'In small peripheral ducts, not the main duct; no cyst.', 'No ovarian-type stroma; ordinary periductal stroma.', 'The commonest route to ductal adenocarcinoma (PanIN → PDA).'],
      chart: { title: 'Progression in numbers', cols: ['Normal duct', 'PanIN-1A', 'PanIN-1B', 'PanIN-2', 'PanIN-3', 'Invasive cancer'],
        rows: [{ label: 'Dividing cells (Ki-67 index)', unit: '%', vals: [0.41, 0.69, 2.33, 14.08, 22.01, 36.99], src: 'Klein et al. 2002 (76 PanINs, 41 patients)' },
          { label: 'KRAS mutation (PanIN beside cancer)', unit: '%', vals: [null, 36, 44, 87, 87, null], src: 'as reviewed in Koorstra et al. 2008 (PanIN-2 and -3 together)' },
          { label: 'MUC1 expression', unit: '%', vals: [null, 6, 5, 43, 85, null], src: 'as reviewed in Koorstra et al. 2008' },
          { label: 'Cyclin D1, nuclear', unit: '%', vals: [0, 0, 0, 29, 57, null], src: 'as reviewed in Koorstra et al. 2008' }],
        note: 'Proliferation rises steeply from PanIN-2 on. Older assays found KRAS in 36–87% of PanINs by grade; newer sequencing finds it in over 90%, even at low grade (Beger 4th ed., ch. 126). PanINs in chronic pancreatitis carry KRAS less often (about 10%).' },
      sources: 'Beger HG et al., The Pancreas, 4th ed., 2023, ch. 126; Robbins and Cotran, 9th ed., ch. 19; Hingorani 2007; Klein WM, Hruban RH, Klein-Szanto AJP, Wilentz RE. Mod Pathol 2002;15:441-7, doi:10.1038/modpathol.3880544; Koorstra JBM, Feldmann G, Habbe N, Maitra A. Langenbecks Arch Surg 2008;393:561-70, doi:10.1007/s00423-008-0282-x; Basturk O et al. Am J Surg Pathol 2015;39:1730-41 (two-tier grading); Guo J et al. Int J Biol Sci 2016;12:292-301; Brune K et al. Am J Surg Pathol 2006;30:1067-76 (lobular atrophy); ' + DISTLER_REF + '.' },
    ipmn: { hp: [{ img: 'ipmn-lowgrade', w: 350, h: 205, credit: `Low grade: tall, thick papillae of mucinous columnar cells, bland nuclei (H&E, ×20). ${CHEN}A.`,
          marks: [[0.5, 0.38, 'Tall papillae of mucinous cells', 0, 4]] },
        { img: 'ipmn-highgrade', w: 355, h: 212, credit: `High grade: branching papillae, stratified nuclei, polarity lost, less mucin (H&E). ${CHEN}B.`,
          marks: [[0.45, 0.5, 'Complex papillae, atypical nuclei', 0, 5]] },
        { img: 'ipmn-gastric-hp', w: 560, h: 292, credit: `Gastric type, low grade: short papillae of foveolar cells with basal nuclei (H&E, ×20). ${DISTLER}, fig. 5a.`,
          marks: [[0.3, 0.22, 'Papillae of tall mucinous cells', 0, 4], [0.45, 0.66, 'Ordinary stroma', 0, 7]] },
        { img: 'ipmn-intestinal', w: 560, h: 343, credit: `Intestinal type: long finger-like papillae, elongated nuclei (H&E, ×4). ${DISTLER}, fig. 5c.`,
          marks: [[0.5, 0.38, 'Long finger-like papillae', 0, 4], [0.08, 0.76, 'Ordinary stroma', 0, 7]] },
        { img: 'ipmn-pb-hp', w: 560, h: 317, credit: `Pancreatobiliary type, high grade: complex papillae, nuclear orientation lost (H&E, ×20). ${DISTLER}, fig. 5e.`,
          marks: [[0.45, 0.35, 'Complex papillae, atypical nuclei', 0, 5], [0.62, 0.86, 'Ordinary stroma', 0, 7]] }],
      drawing: { w: 1000, h: 420, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Beger et al. 4th ed., ch. 125 and 126, and Hingorani 2007.',
        marks: [[0.045, 0.57, 'Main duct, dilated'], [0.667, 0.455, 'Branch opening into the duct'], [0.6, 0.56, 'Mucin'], [0.33, 0.55, 'Intestinal-type papillae, goblet cells'], [0.115, 0.6, 'Pancreatobiliary-type papillae'], [0.79, 0.085, 'Gastric-type lining of a cyst'], [0.96, 0.5, 'Ordinary stroma, no ovarian stroma']] },
      more: [['Johns Hopkins: IPMN', 'https://pathology.jhu.edu/pancreas/ipmn'], ['Johns Hopkins: pancreas cysts', 'https://pathology.jhu.edu/pancreas/ipmn/pancreas-cysts'], ['Johns Hopkins: cyst classification tool', 'https://pathology.jhu.edu/pancreas/medical-professionals/cyst-classification-tool']],
      title: 'Intraductal papillary mucinous neoplasm (IPMN)', lead: 'A mucin-making tumour that grows inside the duct system, either the main duct (which dilates) or its branches (which swell into grape-like cysts). Unlike PanIN it is visible to the eye; unlike MCN it connects with the ducts and has no ovarian-type stroma.',
      figures: [{ img: 'ipmn', w: 1400, h: 1268, credit: 'Shibata H, Ohike N, Norose T, et al. Clin J Gastroenterol 2017;10:274-8, doi:10.1007/s12328-017-0728-1 (CC BY 4.0), via Wikimedia Commons. a, b, d, e: H&E; c: resected pancreas.',
        marks: [[0.2, 0.395, 'Main duct, dilated, with tumour (arrowheads)', 1], [0.525, 0.505, 'Branch-duct cyst opening off the duct', 1], [0.115, 0.49, 'Mucin in the cyst', 1], [0.62, 0.15, 'Tall papillae of mucinous cells', 1], [0.13, 0.17, 'Pancreatobiliary type: complex papillae, atypical nuclei', 1], [0.66, 0.655, 'Flat mucinous lining', 1], [0.7, 0.705, 'No ovarian stroma', 1]] }],
      key: ['Main-duct IPMN: the main duct is dilated (over 5 mm; 10 mm or more is a high-risk sign) and lined by tumour.', 'Branch-duct IPMN: side branches swell into cysts (over 10 mm) that open into the duct.', 'Thick mucin fills the ducts and cysts; it may extrude from the duodenal papilla.', 'Papillae lined by tall mucinous columnar cells. Gastric type (photo b; drawn in the cysts): foveolar cells with a tall pale mucin cap and an oval basal nucleus, short thick papillae, pyloric-type glands at their base; mostly low grade. Intestinal type (drawn in the main duct): long finger-like villous papillae, darker pseudostratified cells with elongated nuclei, and goblet cells.', 'Pancreatobiliary type: thin, branching, interconnected papillae of cuboidal cells with enlarged nuclei and little mucin; usually high grade. (A fourth, oncocytic type, with thick papillae of intensely pink cells and lumina within the epithelium, is now a separate entity and is not drawn.)', 'Branch-duct cysts are lined by a flat or gently papillary layer of gastric-type cells.', 'Beneath it: ordinary fibrous stroma and pancreatic acini, with no ovarian-type stroma (which defines MCN).'],
      unique: ['Grows inside the duct system and stays connected with it: the key difference from MCN.', 'Macroscopic (usually 1 cm or more), with papillae and abundant mucin: the difference from PanIN.', 'Epithelial types (gastric, intestinal, pancreatobiliary; MUC2, MUC5AC, MUC1) that predict behaviour: intestinal type gives colloid carcinoma.', 'GNAS mutations in 50–80%, absent from MCN.', 'Main-duct IPMN is the more dangerous: invasive carcinoma in 43.6% against 16.6% for branch-duct IPMN.'],
      sources: 'Beger HG et al., The Pancreas, 4th ed., 2023, ch. 84, 86, 125, 126; Hingorani 2007; Rodriguez et al. 2007; Basturk O et al. Am J Surg Pathol 2015;39:1730-41 (Baltimore consensus); ' + DISTLER_REF + '; Assarzadegan N et al. Langenbecks Arch Surg 2021;406:2643-55; Adsay V et al. Ann Surg 2016;263:162-77 (Verona consensus); Furukawa T et al. Virchows Arch 2005;447:794-9 (consensus on the IPMN types); Xiao SY. Scientifica 2012:893632 (IPMN update).' },
    mcn: { hp: [{ img: 'mcn-hp', w: 560, h: 363, credit: `Columnar mucinous lining over ovarian-type stroma (H&E, ×40). ${DISTLER}, fig. 6b.`,
          marks: [[0.5, 0.09, 'Tall columnar cells, basal nuclei', 0, 6], [0.5, 0.62, 'Ovarian-type stroma: packed spindle cells, wavy nuclei', 0, 7]] }],
      drawing: { w: 1000, h: 420, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Beger et al. 4th ed., ch. 81 and 126, and Hingorani 2007.',
        marks: [[0.08, 0.1, 'Normal pancreas'], [0.264, 0.5, 'Fibrous capsule'], [0.35, 0.72, 'Ovarian-type stroma'], [0.7, 0.24, 'Cyst with mucin'], [0.78, 0.47, 'Septum: cyst within the cyst'], [0.43, 0.36, 'Tall columnar cells, apical mucin'], [0.34, 0.2, 'Dense spindle cells, wavy nuclei']] },
      more: [['Johns Hopkins: pancreas cysts', 'https://pathology.jhu.edu/pancreas/ipmn/pancreas-cysts'], ['Johns Hopkins: cyst classification tool', 'https://pathology.jhu.edu/pancreas/medical-professionals/cyst-classification-tool']],
      title: 'Mucinous cystic neoplasm (MCN)', lead: 'A cyst behind a thick fibrous capsule, lined by mucinous cells over a dense, cellular “ovarian-type” stroma, which the diagnosis requires. It does not connect with the ducts, and occurs almost only in women, in the body or tail.',
      figures: [{ img: 'mcn-low', w: 1400, h: 933, credit: 'Nephron, via Wikimedia Commons (CC BY-SA 3.0): benign pancreatic mucinous cystic neoplasm, very low magnification.',
        marks: [[0.14, 0.45, 'Normal pancreas (acini)', 1], [0.31, 0.55, 'Fibrous capsule', 1], [0.5, 0.26, 'Dense, cellular ovarian-type stroma', 1], [0.8, 0.62, 'Cyst (locule) with mucin', -1], [0.43, 0.78, 'Mucinous lining, folded', 1]] },
        { img: 'mcn-wall', w: 672, h: 428, credit: 'Humpath, via Wikimedia Commons (CC BY-SA 3.0): mucinous cystadenoma of the pancreas.',
        marks: [[0.43, 0.3, 'Tall columnar cells, apical mucin', 1], [0.33, 0.64, 'Ovarian-type stroma: packed spindle cells, wavy nuclei', 1]] }],
      key: ['Normal pancreas beside the cyst.', 'A thick fibrous (pseudo)capsule separates the cyst from the gland; it is often calcified (drawn).', 'Ovarian-type stroma: densely packed spindle cells with wavy nuclei; they carry oestrogen and progesterone receptors and are required for the diagnosis.', 'The cyst (or cysts within it) holds thick mucin; it does not open into the ducts.', 'The lining varies: mostly columnar mucinous cells, with flat or cuboidal stretches without mucin and denuded areas (both drawn on the cyst wall).', 'At higher power: tall columnar cells with pale apical mucin and basal nuclei.', 'Beneath them, the hypercellular ovarian-type stroma: the hallmark of MCN. It may hold clusters of luteinized cells (plump, pink; found in 66% of 56 cases) and pale hyalinized areas (both drawn).'],
      unique: ['Ovarian-type stroma, which neither PanIN nor IPMN has.', 'No connection with the duct system (IPMN connects).', 'Almost only in women (10–20 : 1), around 45–48 years; over 90% in the body or tail.', 'No GNAS mutation (unlike IPMN).'],
      sources: 'Beger HG et al., The Pancreas, 4th ed., 2023, ch. 81, 86, 126; Robbins and Cotran, 9th ed., ch. 19; Hingorani 2007 (wavy stromal nuclei); ' + DISTLER_REF + '; Matthaei H et al. Nat Rev Gastroenterol Hepatol 2011;8:141-50; Malaspina L et al. Curr Oncol 2025;32:352 (flat and denuded lining); Zamboni G et al. Am J Surg Pathol 1999;23:410-22, abstract (luteinized cells in 66%).' },
    acute: { hp: [{ img: 'acute-necrosis', w: 746, h: 526, credit: 'Coagulative necrosis of pancreatic tissue, vascular hyperaemia and an inflammatory infiltrate (H&E, ×200). Mihoc T, Latcu SC, Secasan CC, et al. Biomedicines 2024;12:2627, doi:10.3390/biomedicines12112627 (CC BY 4.0), fig. 12.',
          marks: [[0.45, 0.35, 'Dead acini, no nuclei', 0, 7], [0.1, 0.88, 'Inflammatory cells', 0, 3]] }],
      title: 'Acute pancreatitis', lead: 'Enzymes activated inside the gland digest it and the fat around it. Most cases are interstitial: the gland swells with oedema, with mild inflammation and small fat necroses. In the necrotizing form, parts of the gland and the surrounding fat die and bleed.',
      drawing: { w: 1000, h: 420, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Robbins and Cotran, 9th ed., ch. 19, and Beger et al. 4th ed., ch. 17.',
        marks: [[0.1, 0.24, 'Acini in lobules'], [0.232, 0.62, 'Oedematous septum'], [0.24, 0.3, 'Neutrophils'], [0.68, 0.7, 'Fat necrosis, calcium soaps'], [0.846, 0.5, 'Rim of neutrophils'], [0.64, 0.29, 'Haemorrhage'], [0.49, 0.8, 'Dead acini, no nuclei'], [0.94, 0.2, 'Viable fat']] },
      figures: [{ img: 'acute', w: 1200, h: 800, credit: 'Patho, via Wikimedia Commons (CC BY-SA 3.0): tryptic fat necrosis in severe pancreatitis, H&E.',
        marks: [[0.12, 0.12, 'Viable fat', 0, 8], [0.45, 0.75, 'Fat necrosis', 0, 4], [0.36, 0.33, 'Inflammatory rim', 0, 5], [0.95, 0.29, 'Haemorrhage', 0, 6]] }],
      key: ['Lobules of acini, still recognisable.', 'Interstitial oedema: the septa between lobules widen and pale, with fibrin strands.', 'Neutrophils in the septa: acute inflammation.', 'Fat necrosis: lipase splits fat, and the freed fatty acids bind calcium into chalky soaps (granular blue-purple); the fat cells become ghosts.', 'A rim of neutrophils at the edge of the necrosis.', 'Haemorrhage where vessels are digested (necrotizing form).', 'Acini that have died: pale ghosts without nuclei (necrotizing form).', 'Viable fat beyond the necrosis.'],
      unique: ['Trypsin activated inside the gland starts a cascade of other enzymes (Robbins).', 'Fat necrosis with calcium soaps is the commonest pattern (Beger ch. 17).', 'Interstitial (90–95%) and necrotizing (5–10%) forms differ in extent and outcome.', 'Causes: gallstones (35–60%) and alcohol together about 80%.'],
      compare: { title: 'Normal pancreas, acute and chronic pancreatitis compared', cols: ['Normal', 'Acute', 'Chronic'], on: 2, src: 'Robbins 9th ed. ch. 19; Beger 4th ed. ch. 7, 17, 41.', rows: PANC_ROWS },
      sources: 'Robbins and Cotran, 9th ed., ch. 19 (pp. 884-887); Beger HG et al., The Pancreas, 4th ed., 2023, ch. 17 (pp. 164-168).' },
    chronic: { hp: [{ img: 'chronic-fibrosis', w: 256, h: 155, credit: `Moderate fibrosis: an atrophic lobule in fibrous stroma (H&E). ${CHEK}A.`,
          marks: [[0.62, 0.35, 'Dense fibrosis', 0, 1], [0.18, 0.78, 'Small, atrophic acini', 0, 4]] },
        { img: 'chronic-atrophy', w: 245, h: 155, credit: `Complete atrophy of the acini: fibrosis with vessels and a last group of cells (H&E). ${CHEK}B.`,
          marks: [[0.55, 0.6, 'Fibrosis replacing the acini', 0, 1], [0.1, 0.3, 'Last acinar cells', 0, 4]] },
        { img: 'chronic-islet', w: 181, h: 155, credit: `An islet embedded in fibrosis (H&E, high power). ${CHEK}C.`,
          marks: [[0.6, 0.18, 'Islet cells, spared', 0, 5], [0.45, 0.7, 'Loose fibrosis', 0, 1]] }],
      title: 'Chronic pancreatitis', lead: 'Repeated injury replaces the gland with scar. Acini are lost, ducts dilate behind strictures and fill with calcified stones, and the islets, spared at first, are lost later, so diabetes follows.',
      drawing: { w: 1000, h: 420, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Robbins and Cotran, 9th ed., ch. 19, and Beger et al. 4th ed., ch. 7 and 41.',
        marks: [[0.06, 0.6, 'Dense fibrosis'], [0.36, 0.42, 'Dilated duct, flattened lining'], [0.5, 0.52, 'Calcified protein plug (stone)'], [0.11, 0.22, 'Small, atrophic acini'], [0.84, 0.44, 'Islets spared, gathered'], [0.3, 0.86, 'Lymphocytes'], [0.62, 0.86, 'Activated stellate cells']] },
      figures: [{ img: 'chronic-gross', w: 900, h: 924, credit: 'Denis Desaulniers and Bernard Têtu, Bibliothèque de l’Université Laval, via Wikimedia Commons (CC BY-SA 4.0): chronic calcifying pancreatitis, resected head (gross specimen).',
        marks: [[0.22, 0.45, 'Stones', 0, 3], [0.5, 0.39, 'Dilated duct', 0, 2], [0.24, 0.74, 'Firm, fibrotic gland', 0, 1], [0.78, 0.58, 'Duodenum', 0, 8]] }],
      key: ['Dense fibrosis replaces the lobules; the gland becomes firm and shrunken.', 'The duct is dilated behind strictures, with a flattened, atrophic lining.', 'Protein plugs in the duct calcify into stones (in about half of patients).', 'Only small islands of atrophic acini remain.', 'Islets are spared at first and gather together, then are lost: diabetes follows in 70%.', 'Chronic inflammation: lymphocytes, scattered and in clusters.', 'Activated stellate cells (myofibroblasts) lay down the collagen.', 'In the resected specimen (photo): the duodenum, round the head.'],
      unique: ['Irreversible: fibrosis and loss of exocrine and then endocrine tissue.', 'Calcified stones and a beaded, dilated duct (“chain of lakes” on imaging).', 'Activated stellate cells drive the fibrosis.', 'Raises the risk of pancreatic cancer about 12-fold.'],
      compare: { title: 'Normal pancreas, acute and chronic pancreatitis compared', cols: ['Normal', 'Acute', 'Chronic'], on: 3, src: 'Robbins 9th ed. ch. 19; Beger 4th ed. ch. 7, 17, 41.', rows: PANC_ROWS },
      sources: 'Robbins and Cotran, 9th ed., ch. 19 (pp. 886-889); Beger HG et al., The Pancreas, 4th ed., 2023, ch. 7, 41, 47.' },
    pda: { hp: [{ img: 'pda-hp', w: 750, h: 565, credit: 'Malignant glands of large, pleomorphic cells with prominent nucleoli in desmoplastic stroma (H&E, ×400). Aloraini A, Almutawa RA, Almutawa NA, et al. Cureus 2023;15:e48642, doi:10.7759/cureus.48642 (CC BY 4.0), fig. 3.',
          marks: [[0.47, 0.62, 'Malignant gland', 0, 1], [0.3, 0.58, 'Pleomorphic nuclei', 0, 2], [0.12, 0.3, 'Desmoplastic stroma', 0, 3]] }],
      title: 'Pancreatic ductal adenocarcinoma (PDA)', lead: 'The common pancreatic cancer. Malignant glands infiltrate a dense, scar-like (desmoplastic) stroma, follow nerves and invade vessels. Most arise in the head, where they block the bile duct.',
      drawing: { w: 1000, h: 420, credit: 'Drawing for this site (schematic, not to scale), after the descriptions in Robbins and Cotran, 9th ed., ch. 19, and Beger et al. 4th ed., ch. 125.',
        marks: [[0.15, 0.13, 'Irregular malignant glands'], [0.32, 0.7, 'Atypical, pleomorphic nuclei'], [0.52, 0.94, 'Desmoplastic stroma'], [0.83, 0.52, 'Perineural invasion'], [0.975, 0.52, 'Tumour in a vein'], [0.44, 0.73, 'Necrotic debris'], [0.06, 0.6, 'Spared islet']] },
      figures: [{ img: 'pda-perineural', w: 700, h: 527, credit: 'KGH, via Wikimedia Commons (CC BY-SA 3.0): pancreatic adenocarcinoma of the head, H&E.',
        marks: [[0.3, 0.47, 'Nerve with tumour round it', 0, 4], [0.7, 0.29, 'Malignant glands', 0, 1], [0.82, 0.56, 'Atypical cells', 0, 2], [0.06, 0.9, 'Stroma', 0, 3]] },
        { img: 'pda-glands', w: 891, h: 749, credit: 'Singh PK, Tayao M, Andrici J, et al. PLoS One 2016;11:e0150338 (CC BY 4.0), via Wikimedia Commons: pancreatic ductal adenocarcinoma, H&E.',
        marks: [[0.3, 0.25, 'Pleomorphic nuclei', 0, 2], [0.62, 0.55, 'Gland lumen with debris', 0, 6]] },
        { img: 'pda-stroma', w: 1200, h: 214, credit: 'Wang LM, Silva MA, D’Costa Z, et al. Oncotarget 2016;7:4183-94 (CC BY 3.0), via Wikimedia Commons; H&E row cropped: loose, moderate and dense desmoplastic stroma.',
        marks: [[0.52, 0.55, 'Desmoplastic stroma', 0, 3]] }],
      key: ['Malignant glands: poorly formed, irregular and angulated, some incomplete, haphazardly placed.', 'Lined by pleomorphic cuboidal to columnar cells with large, dark nuclei.', 'Dense desmoplastic stroma, made by activated stellate cells (cancer-associated fibroblasts); it can make up most of the tumour.', 'Perineural invasion: glands inside or round nerves, in practically every case; it tracks with pain.', 'Vascular invasion: tumour in a vein.', 'Necrotic debris in a gland’s lumen.', 'Islets can survive among the tumour.'],
      unique: ['Desmoplasia: more scar than tumour cells, which makes biopsy hard.', 'Spreads early along nerves and into vessels; most in the head, blocking the bile duct (jaundice) and the main duct (the double duct sign).', 'Genes: KRAS (over 90%), CDKN2A, TP53, SMAD4.', 'Most often from PanIN; sometimes from IPMN or MCN (with a better outcome).'],
      compare: { title: 'PDA by location', cols: ['Head', 'Body', 'Tail'], on: 1, src: 'Robbins 9th ed. ch. 19 (p. 893); Beger 4th ed. ch. 137 (p. 1063).',
        rows: [['Share of cases', 'About 60%', 'About 15%', 'About 5% (diffuse 20%)'], ['First sign', 'Painless jaundice: the bile duct is blocked', 'Pain from the coeliac plexus', 'Late; silent'], ['Over 4 cm when found', '21%', '40%', '51%'], ['Spread when found', '42%', '69%', '84%']] },
      sources: 'Robbins and Cotran, 9th ed., ch. 19 (pp. 892-894); Beger HG et al., The Pancreas, 4th ed., 2023, ch. 119, 125, 128, 130, 134, 137.' },
  };
  // The panel's text: the first sentence at a glance, the rest folded under "More".
  function setInfo(text) { const m = /^(.{40,}?[.!?])\s+(.+)$/s.exec(text || ''), el = $('info');
    el.innerHTML = m ? `${esc(m[1])} <details class="src more"><summary>More</summary><p>${esc(m[2])}</p></details>` : esc(text || ''); }
  function srcFold(s) { return `<details class="src"><summary>Sources</summary><p>${s}</p></details>`; }   // citations folded, closed by default
  function markSvg(F, n0, s = 1) {   // numbered pins only; each feature is described in the list below (and on hover)
    const W = 1000, H = Math.round(1000 * F.h / F.w);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` + F.marks.map(([x, y, label, , num], k) => { const n = num || n0 + k;
      return `<g class="mk"><title>${n}. ${esc(label)}</title><circle cx="${x * W}" cy="${y * H}" r="${15 * s}"/><text class="n" x="${x * W}" y="${y * H + 6 * s}"${s !== 1 ? ` style="font-size:${16 * s}px"` : ''}>${n}</text></g>`; }).join('') + '</svg>';
  }
  // ---------- drawings: schematic sections in H&E colours, drawn here, showing only the features that matter (not to scale).
  const HE = { stroma: '#f5d9e5', collagen: '#e7b6ca', fibro: '#7a5aa6', acinus: '#6e4199', apex: '#e47f9c', nucleus: '#3a2470', dark: '#22114b', cyto: '#f2d1e2', columnar: '#efd7e8', mucin: '#f1f3fa', mucinEdge: '#c3c9e3', lumen: '#fcf8fc', edge: '#c39cc1' };
  const pol = (pts, fill, stroke, sw) => `<polygon points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw || 0.8}"` : ''}/>`;
  const ell = (x, y, rx, ry, deg, fill, op) => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${deg.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}"${op ? ` opacity="${op}"` : ''}/>`;
  function drawStroma(R, W, H, out, n) {
    out.push(`<rect width="${W}" height="${H}" fill="${HE.stroma}"/>`);
    for (let k = 0; k < n; k++) { const x = R() * W, y = R() * H, dx = 20 + 30 * R(), dy = (R() - 0.5) * 10; out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(dx / 2).toFixed(0)} ${dy.toFixed(0)} ${dx.toFixed(0)} 0" stroke="${HE.collagen}" stroke-width="1.3" fill="none" opacity="0.8"/>`); }
    for (let k = 0; k < n * 0.8; k++) out.push(ell(R() * W, R() * H, 4.2, 1.3, R() * 180, HE.fibro, 0.75));   // spindle nuclei of fibroblasts
  }
  function drawAcinus(x, y, r, R, out) {   // a rosette of wedge-shaped cells: purple bases, pink apical granules, nuclei toward the base
    const n = 7 + Math.floor(R() * 3), a0 = R() * 6.28;
    for (let j = 0; j < n; j++) { const a = a0 + j / n * 6.283, b = a + 6.283 / n * 0.92, P = (ang, rr) => [x + Math.cos(ang) * rr, y + Math.sin(ang) * rr];
      out.push(pol([P(a, r * 0.12), P(a, r), P((a + b) / 2, r * 1.04), P(b, r), P(b, r * 0.12)], HE.acinus, '#5a3384', 0.6));
      out.push(pol([P(a, r * 0.12), P(a, r * 0.48), P(b, r * 0.48), P(b, r * 0.12)], HE.apex));
      const m = P((a + b) / 2, r * 0.74); out.push(ell(m[0], m[1], r * 0.14, r * 0.12, 0, HE.dark)); }
  }
  function drawPanIN() {
    const R = rng(4242), W = 1000, H = 400, cy = 175, out = [];
    drawStroma(R, W, H, out, 160);
    const ducts = [{ x: 100, r: 36, g: 0, name: 'Normal duct' }, { x: 295, r: 50, g: 1, name: 'PanIN-1A' }, { x: 495, r: 54, g: 2, name: 'PanIN-1B' }, { x: 700, r: 58, g: 3, name: 'PanIN-2' }, { x: 900, r: 62, g: 4, name: 'PanIN-3' }];
    const acini = []; for (let t = 0; t < 900 && acini.length < 70; t++) { const x = 15 + R() * (W - 30), y = 15 + R() * 285, r = 17 + 6 * R();
      if (ducts.some((d) => Math.hypot(x - d.x, y - cy) < d.r + 44 + r) || acini.some((a) => Math.hypot(a.x - x, a.y - y) < a.r + r + 6)) continue; acini.push({ x, y, r }); }
    acini.forEach((a) => drawAcinus(a.x, a.y, a.r, R, out));
    // Lobular atrophy round each PanIN, even low grade: acini shrink and drop out, islets gather, fibrosis and fat (Brune et al. 2006).
    ducts.filter((d) => d.g > 0).forEach((d) => { const zr = d.r + 31 + 44, inZ = (x, y) => Math.hypot(x - d.x, y - cy) < zr && Math.hypot(x - d.x, y - cy) > d.r + 36;
      out.push(`<circle cx="${d.x}" cy="${cy}" r="${zr}" fill="#efc4d6"/>`);
      for (let k = 0; k < 40; k++) { const t = R() * 6.283, rr = d.r + 36 + R() * 38, x = d.x + Math.cos(t) * rr, y = cy + Math.sin(t) * rr; out.push(`<path d="M${(x - 9).toFixed(0)} ${y.toFixed(0)} q9 ${((R() - 0.5) * 6).toFixed(0)} 18 0" stroke="#dc9fb9" stroke-width="1.4" fill="none"/>`); }
      for (let k = 0; k < 7; k++) { const t = R() * 6.283, rr = d.r + 44 + R() * 26, x = d.x + Math.cos(t) * rr, y = cy + Math.sin(t) * rr, fr = 8 + 5 * R(); if (inZ(x, y)) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${fr.toFixed(1)}" fill="#fffafc" stroke="#d9b4c6" stroke-width="0.9"/>`); }   // fat cells
      for (let k = 0; k < 5; k++) { const t = R() * 6.283, rr = d.r + 46 + R() * 22; drawAcinus(d.x + Math.cos(t) * rr, cy + Math.sin(t) * rr, 8 + 3 * R(), R, out); }   // small, atrophic acini
      const it = R() * 6.283, ix = d.x + Math.cos(it) * (d.r + 58), iy = cy + Math.sin(it) * (d.r + 58);   // a cluster of islet cells
      for (let j = 0; j < 7; j++) { const xx = ix + (R() - 0.5) * 16, yy = iy + (R() - 0.5) * 16; out.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4.5" fill="#f3dcea" stroke="#d6b3c8" stroke-width="0.5"/>`, ell(xx, yy, 2, 2, 0, '#6b56a3')); } });
    ducts.forEach((d) => {
      const g = d.g, hb = g === 0 ? 11 : 31, N = Math.round(2 * Math.PI * d.r / (g === 0 ? 12 : 9)), ph = R() * 6.28;
      const bump = (t) => (g === 2 ? 6 * Math.max(0, Math.sin(9 * t + ph)) : g === 3 ? 19 * Math.pow(Math.max(0, Math.sin(6 * t + ph)), 2) : g === 4 ? 30 * Math.pow(Math.max(0, Math.sin(7 * t + ph)), 1.4) + 7 * Math.max(0, Math.sin(19 * t)) : 0);
      const hgt = (k) => (g === 0 ? 10 : g === 4 ? 24 + 7 * R() : g === 3 ? 27 + 4 * R() : 30);
      const P = (t, rr) => [d.x + Math.cos(t) * rr, cy + Math.sin(t) * rr], rb = (t) => d.r - bump(t);
      out.push(pol(Array.from({ length: 120 }, (_, i) => P(i / 120 * 6.283, rb(i / 120 * 6.283) + 0.5)), HE.lumen));   // the lumen
      out.push(`<circle cx="${d.x}" cy="${cy}" r="${d.r + hb + 1.5}" fill="none" stroke="${HE.edge}" stroke-width="1.2"/>`);   // basement membrane
      for (let k = 0; k < N; k++) { const t0 = k / N * 6.283, t1 = (k + 1) / N * 6.283, tm = (t0 + t1) / 2, h = hgt(k), a = rb(t0), b = rb(t1), m = rb(tm);
        out.push(pol([P(t0, a), P(t1, b), P(t1, b + h), P(t0, a + h)], g === 0 ? HE.cyto : HE.columnar, HE.edge, 0.7));
        const mf = g === 1 || g === 2 ? 0.55 : g === 3 ? 0.3 : R() < 0.4 ? 0.15 : 0;
        if (mf) out.push(pol([P(t0, a), P(t1, b), P(t1, b + h * mf), P(t0, a + h * mf)], HE.mucin, HE.mucinEdge, 0.5));   // apical mucin
        const f = g === 0 ? 0.5 : g < 3 ? 0.82 : g === 3 ? 0.45 + 0.4 * R() : 0.25 + 0.6 * R(), c = P(tm, m + h * f), deg = tm * 57.3;
        if (g === 0) out.push(ell(c[0], c[1], 3.3, 3.0, 0, HE.nucleus));
        else if (g < 3) out.push(ell(c[0], c[1], 3.6, 2.1, deg, HE.nucleus));
        else if (g === 3) out.push(ell(c[0], c[1], 4.2, 2.8, deg + (R() - 0.5) * 40, HE.nucleus));
        else { out.push(ell(c[0], c[1], 4.4 + 1.6 * R(), 3.2 + 1.2 * R(), deg + (R() - 0.5) * 120, HE.dark)); if (R() < 0.06) out.push(`<path d="M${c[0] - 3} ${c[1]}h6M${c[0]} ${c[1] - 3}v6" stroke="${HE.dark}" stroke-width="2"/>`); } }
      if (g === 4) for (let k = 0; k < 4; k++) { const t = R() * 6.28, rr = 8 + R() * 16, x = d.x + Math.cos(t) * rr, y = cy + Math.sin(t) * rr;   // cells budding into the lumen
        for (let j = 0; j < 3; j++) { const xx = x + (R() - 0.5) * 10, yy = y + (R() - 0.5) * 10; out.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="5" fill="${HE.columnar}" stroke="${HE.edge}" stroke-width="0.6"/>`, ell(xx, yy, 3, 2.4, R() * 180, HE.dark)); } }
      out.push(`<text x="${d.x}" y="${cy - d.r - hb - 24}" class="dl">${d.name}</text>`, g ? `<text x="${d.x}" y="${cy - d.r - hb - 8}" class="gl" text-anchor="middle">${g < 4 ? 'low grade' : 'high grade'}</text>` : ''); });
    // Genetic progression along the bottom (Koorstra 2008; Hackeng 2016; Beger 4th ed. ch. 126).
    const band = (x0, y, label, fill) => { out.push(pol([[x0, y + 14], [990, y], [990, y + 28], [x0, y + 14]], fill), `<text x="${x0 + 14}" y="${y + 19}" class="gl">${label}</text>`); };
    band(190, 312, 'Telomere shortening, KRAS mutation', '#d9cde6'); band(560, 340, 'CDKN2A (p16) loss', '#cdbfe0'); band(760, 366, 'TP53, SMAD4 loss', '#c1b2da');
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: a normal pancreatic duct and PanIN-1A, 1B, 2 and 3 among acini and stroma, with the genetic changes along the bottom">${out.join('')}</svg>`, w: W, h: H };
  }
  // A lining of cells along a polyline: bases on the line, apices toward `dir(x, y)` (the lumen side). o: w (cell width),
  // h (height), hj (height jitter), mucin (share of the cell, from the apex), nuc ('basal', 'central' or 'random'), dark, fill.
  function lining(pts, dir, o, out, R) {
    let carry = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; let d = carry;
      for (; d < L; d += o.w) { const x = a[0] + tx * d, y = a[1] + ty * d, pref = dir(x, y); let nx = -ty, ny = tx; if (nx * pref[0] + ny * pref[1] < 0) { nx = -nx; ny = -ny; }
        const h = o.h + (o.hj || 0) * (R() - 0.5) * 2, hw = o.w / 2 * 0.97, b1 = [x - tx * hw, y - ty * hw], b2 = [x + tx * hw, y + ty * hw], ap = (p, f) => [p[0] + nx * h * f, p[1] + ny * h * f];
        out.push(pol([b1, b2, ap(b2, 1), ap(b1, 1)], o.fill || HE.columnar, HE.edge, 0.6));
        if (o.goblet && R() < o.goblet) { const g = ap([x, y], 0.72); out.push(`<circle cx="${g[0].toFixed(1)}" cy="${g[1].toFixed(1)}" r="${(o.w * 0.42).toFixed(1)}" fill="${HE.mucin}" stroke="${HE.mucinEdge}" stroke-width="0.6"/>`); }   // a goblet cell's mucin vacuole
        else if (o.mucin) out.push(pol([ap(b1, 1 - o.mucin), ap(b2, 1 - o.mucin), ap(b2, 1), ap(b1, 1)], HE.mucin, HE.mucinEdge, 0.4));
        const f = o.nuc === 'central' ? 0.5 : o.nuc === 'random' ? 0.2 + 0.55 * R() : 0.2, c = [x + nx * h * f, y + ny * h * f], deg = Math.atan2(ny, nx) * 57.3;
        if (o.nuc === 'elongated') { const fe = 0.12 + 0.4 * R(), ce = [x + nx * h * fe, y + ny * h * fe]; out.push(ell(ce[0], ce[1], 5, 1.7, deg + (R() - 0.5) * 16, HE.dark)); }   // pseudostratified, elongated nuclei
        else if (o.dark) out.push(ell(c[0], c[1], 3.8 + 1.4 * R(), 2.8 + R(), deg + (R() - 0.5) * 90, HE.dark)); else out.push(ell(c[0], c[1], o.nuc === 'central' ? 3 : 3.4, o.nuc === 'central' ? 2.8 : 2, deg, HE.nucleus)); }
      carry = d - L; }
  }
  // A papilla: a finger of stroma with a capillary in its core, lined by cells whose apices face outward.
  function papilla(base, tip, wb, R, out, o) {
    const n = 14, C = [], bend = (R() - 0.5) * 0.5, dx = tip[0] - base[0], dy = tip[1] - base[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, px = -uy, py = ux;
    for (let i = 0; i <= n; i++) { const t = i / n, off = Math.sin(t * Math.PI) * bend * L * 0.3; C.push([base[0] + dx * t + px * off, base[1] + dy * t + py * off, wb * (1 - 0.55 * t)]); }
    const left = C.map(([x, y, w]) => [x + px * w / 2, y + py * w / 2]), right = C.map(([x, y, w]) => [x - px * w / 2, y - py * w / 2]).reverse(), outline = left.concat(right);
    out.push(pol(outline, '#f0c4d6', null), `<polyline points="${C.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ')}" fill="none" stroke="#d5465c" stroke-width="2.2" opacity="0.85"/>`);
    const near = (x, y) => C.reduce((b, c) => (Math.hypot(c[0] - x, c[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? c : b));
    lining(outline, (x, y) => { const c = near(x, y); return [x - c[0], y - c[1]]; }, o, out, R);
  }
  function drawIPMN() {
    const R = rng(1789), W = 1000, H = 420, out = [], top = 168, bot = 318, x0 = 20, x1 = 640;
    drawStroma(R, W, H, out, 150);
    const acini = []; for (let t = 0; t < 900 && acini.length < 40; t++) { const x = 15 + R() * (W - 30), y = 15 + R() * (H - 30), r = 17 + 6 * R();
      if ((y > top - 46 - r && y < bot + 46 + r && x < x1 + 40) || Math.hypot(x - 830, y - 150) < 190 + r || acini.some((a) => Math.hypot(a.x - x, a.y - y) < a.r + r + 6)) continue; acini.push({ x, y, r }); }
    acini.forEach((a) => drawAcinus(a.x, a.y, a.r, R, out));
    // Lumens: the dilated main duct, a branch leaving it, and grape-like cysts at the branch's end, all one continuous space.
    const cysts = [[790, 95, 62], [905, 120, 52], [850, 225, 58], [745, 205, 44], [935, 270, 38]];
    out.push(`<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}" fill="${HE.mucin}"/>`);
    const br = [[612, top + 6], [722, 214]], bw = 30, bdx = br[1][0] - br[0][0], bdy = br[1][1] - br[0][1], bl = Math.hypot(bdx, bdy), bnx = -bdy / bl * bw / 2, bny = bdx / bl * bw / 2;
    const bA = [[br[0][0] + bnx, br[0][1] + bny], [br[1][0] + bnx, br[1][1] + bny]], bB = [[br[0][0] - bnx, br[0][1] - bny], [br[1][0] - bnx, br[1][1] - bny]];
    out.push(pol([bA[0], bA[1], bB[1], bB[0]], HE.mucin));
    cysts.forEach(([x, y, r]) => out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${HE.mucin}"/>`));
    for (let k = 0; k < 26; k++) { const x = x0 + R() * (x1 - x0 - 30), y = top + 20 + R() * (bot - top - 40); out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q12 ${((R() - 0.5) * 10).toFixed(0)} 26 0" stroke="#c9d1ea" stroke-width="1.4" fill="none"/>`); }   // strands of mucin
    // Walls of the main duct, lined by tall columnar mucinous cells (gastric type).
    const intestinal = { w: 7, h: 28, hj: 3, mucin: 0.3, nuc: 'elongated', goblet: 0.18, fill: '#e9bfd8' };   // pseudostratified, darker cells, goblet cells
    lining([[x0, top], [590, top]], (x, y) => [0, 1], intestinal, out, R); lining([[x0, bot], [x1, bot]], (x, y) => [0, -1], intestinal, out, R);
    lining([[640, top], [x1, bot]], (x, y) => [-1, 0], intestinal, out, R);
    // Finger-like papillae from both walls; one, at the left, of pancreatobiliary type: branching, with atypical nuclei.
    for (let k = 0; k < 9; k++) { const x = 90 + k * 60 + (R() - 0.5) * 16, fromTop = k % 2 === 0, len = 70 + 30 * R();
      if (k === 0) { const pb = { w: 6.5, h: 11, hj: 2, mucin: 0, nuc: 'central', dark: true };   // pancreatobiliary: thin branching papillae of cuboidal cells
        papilla([x, bot], [x + 6, bot - 100], 16, R, out, pb); papilla([x + 3, bot - 42], [x + 38, bot - 84], 11, R, out, pb); papilla([x + 4, bot - 66], [x - 26, bot - 104], 10, R, out, pb); continue; }
      papilla(fromTop ? [x, top + 26] : [x, bot - 26], fromTop ? [x + (R() - 0.5) * 20, top + 26 + len] : [x + (R() - 0.5) * 20, bot - 26 - len], 30, R, out, { w: 7, h: 24, hj: 3, mucin: 0.3, nuc: 'elongated', goblet: 0.18, fill: '#e9bfd8' }); }
    // The branch and its cysts: a flatter mucinous lining; ordinary stroma round them.
    const flat = { w: 9, h: 18, hj: 2, mucin: 0.62, nuc: 'basal' };   // gastric-foveolar: a tall pale mucin cap over a basal nucleus
    const toAxis = (x, y) => { const t = Math.max(0, Math.min(1, ((x - br[0][0]) * bdx + (y - br[0][1]) * bdy) / (bl * bl))); return [br[0][0] + bdx * t - x, br[0][1] + bdy * t - y]; };
    lining(bA, toAxis, flat, out, R); lining(bB, toAxis, flat, out, R);
    cysts.forEach(([cx, cy, r]) => { const ring = Array.from({ length: 49 }, (_, i) => [cx + Math.cos(i / 48 * 6.283) * r, cy + Math.sin(i / 48 * 6.283) * r]); lining(ring, (x, y) => [cx - x, cy - y], flat, out, R);
      const t = R() * 6.283; papilla([cx + Math.cos(t) * r, cy + Math.sin(t) * r], [cx + Math.cos(t) * (r - 24), cy + Math.sin(t) * (r - 24)], 24, R, out, flat);   // a short, thick gastric papilla
      for (let j = 0; j < 2; j++) { const a = R() * 6.283, gx = cx + Math.cos(a) * (r + 30), gy = cy + Math.sin(a) * (r + 30);   // pyloric-type glands in the wall
        if (cysts.some(([qx, qy, qr]) => Math.hypot(gx - qx, gy - qy) < qr + 14)) continue;
        out.push(`<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="6" fill="${HE.lumen}"/>`); lining(Array.from({ length: 17 }, (_, i) => [gx + Math.cos(i / 16 * 6.283) * 6, gy + Math.sin(i / 16 * 6.283) * 6]), (x, y) => [gx - x, gy - y], { w: 6, h: 7, nuc: 'basal', fill: '#f4e3ee' }, out, R); } });
    out.push(`<text x="330" y="${top - 62}" class="dl">Main duct, dilated (main-duct IPMN)</text>`, `<text x="330" y="${top - 46}" class="gl" text-anchor="middle">intestinal-type papillae; one pancreatobiliary at the left</text>`, `<text x="850" y="345" class="dl">Branch-duct cysts</text>`, `<text x="850" y="365" class="gl" text-anchor="middle">gastric type; open into the duct</text>`);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: a dilated main pancreatic duct filled with mucin, with finger-like mucinous papillae on its walls, and a side branch swollen into grape-like cysts that open into it">${out.join('')}</svg>`, w: W, h: H };
  }
  function drawMCN() {
    const R = rng(4500), W = 1000, H = 420, out = [];
    drawStroma(R, W, H, out, 90);
    // Normal pancreas at the left, with a small duct that has no connection with the cyst.
    const acini = []; for (let t = 0; t < 700 && acini.length < 26; t++) { const x = 15 + R() * 190, y = 15 + R() * (H - 30), r = 17 + 5 * R();
      if (Math.hypot(x - 105, y - 300) < 50 + r || acini.some((a) => Math.hypot(a.x - x, a.y - y) < a.r + r + 6)) continue; acini.push({ x, y, r }); }
    acini.forEach((a) => drawAcinus(a.x, a.y, a.r, R, out));
    out.push(`<circle cx="105" cy="300" r="20" fill="${HE.lumen}"/>`); lining(Array.from({ length: 33 }, (_, i) => [105 + Math.cos(i / 32 * 6.283) * 20, 300 + Math.sin(i / 32 * 6.283) * 20]), (x, y) => [105 - x, 300 - y], { w: 10, h: 9, nuc: 'central', fill: HE.cyto }, out, R);
    // The capsule: a thick band of dense collagen with few cells.
    const wave = (x, amp, ph) => Array.from({ length: 43 }, (_, i) => [x + amp * Math.sin(i / 42 * 6.283 * 1.5 + ph), i / 42 * H]);
    out.push(pol(wave(228, 8, 0).concat(wave(300, 8, 0.4).reverse()), '#f2b9cc'));
    for (let k = 0; k < 70; k++) { const y = R() * H, x = 232 + R() * 62; out.push(`<path d="M${(x - 12).toFixed(0)} ${y.toFixed(0)} q12 ${((R() - 0.5) * 6).toFixed(0)} 24 0" stroke="#e19ab4" stroke-width="1.4" fill="none"/>`); if (k % 4 === 0) out.push(ell(x, y, 5, 1.2, (R() - 0.5) * 20, HE.fibro, 0.8)); }
    // Ovarian-type stroma: densely packed spindle cells with wavy nuclei, beneath the lining and in the septum.
    const ovarian = (pts) => { out.push(pol(pts, '#e6b3d0')); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), inside = (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      for (let k = 0; k < 900; k++) { const x = Math.min(...xs) + R() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + R() * (Math.max(...ys) - Math.min(...ys)); if (!inside(x, y)) continue;
        const a = Math.sin(y / 18 + x / 40) * 35; out.push(`<path d="M${(x - 5).toFixed(1)} ${y.toFixed(1)} q2.5 -2.2 5 0 t5 0" transform="rotate(${a.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" stroke="#4b2d82" stroke-width="2" fill="none" stroke-linecap="round"/>`); } };
    const wall = wave(300, 8, 0.4), inner = Array.from({ length: 43 }, (_, i) => [395 + 22 * Math.sin(i / 42 * 6.283 * 2.2 + 1) + 10 * Math.sin(i / 42 * 30), i / 42 * H]);
    ovarian(wall.concat(inner.slice().reverse()));
    // Hyalinized areas (pale, few cells) and clusters of luteinized cells (plump, pink, round nuclei) in the stroma.
    [[352, 120, 22, 12], [340, 395, 18, 10]].forEach(([x, y, rx, ry]) => out.push(ell(x, y, rx, ry, 70, '#f1d3e2')));
    [[345, 250], [330, 60], [362, 330]].forEach(([x, y]) => { for (let j = 0; j < 6; j++) { const xx = x + (R() - 0.5) * 18, yy = y + (R() - 0.5) * 18; out.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="6.5" fill="#ef9db3" stroke="#c9758f" stroke-width="0.7"/>`, ell(xx, yy, 2.2, 2.2, 0, '#3a2470')); } });
    // A calcification in the capsule.
    out.push(`<path d="M252 296 l10 -8 l12 4 l4 12 l-8 10 l-14 -2 z" fill="#6f62b0" stroke="#4b3f8f" stroke-width="1.2"/>`, `<path d="M258 300 l8 -4 l7 5 l-3 7 l-9 -1 z" fill="#8f84c9"/>`);
    // The cyst: mucin, lined by tall columnar mucinous cells; a septum makes a second locule (cyst within the cyst).
    out.push(pol(inner.concat([[W, H], [W, 0]]), HE.mucin));
    for (let k = 0; k < 30; k++) { const x = 440 + R() * 540, y = 15 + R() * (H - 30); out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q14 ${((R() - 0.5) * 12).toFixed(0)} 30 0" stroke="#c9d1ea" stroke-width="1.4" fill="none"/>`); }
    const sept = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [520 + t * 380 + 18 * Math.sin(t * 9), 330 - 260 * t * t + 12 * Math.sin(t * 13)]; }), sw = 34;
    const sL = sept.map(([x, y], i) => { const j = Math.min(i + 1, 29), k = Math.max(i - 1, 0), tx = sept[j][0] - sept[k][0], ty = sept[j][1] - sept[k][1], L = Math.hypot(tx, ty); return [x - ty / L * sw / 2, y + tx / L * sw / 2]; });
    const sR = sept.map(([x, y], i) => { const j = Math.min(i + 1, 29), k = Math.max(i - 1, 0), tx = sept[j][0] - sept[k][0], ty = sept[j][1] - sept[k][1], L = Math.hypot(tx, ty); return [x + ty / L * sw / 2, y - tx / L * sw / 2]; });
    ovarian(sL.concat(sR.slice().reverse()));
    const mcnCells = { w: 8, h: 26, hj: 3, mucin: 0.55, nuc: 'basal' };
    // The lining varies: mostly tall mucinous cells, with flat or cuboidal stretches and denuded areas.
    lining(inner.slice(0, 11), (x, y) => [1, 0], mcnCells, out, R); lining(inner.slice(10, 16), (x, y) => [1, 0], { w: 9, h: 8, nuc: 'central', fill: HE.cyto }, out, R);
    lining(inner.slice(19), (x, y) => [1, 0], mcnCells, out, R);   // inner[16..19]: denuded
    const mid = (x, y) => { const c = sept.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? p : b)); return [x - c[0], y - c[1]]; };
    lining(sL, mid, mcnCells, out, R); lining(sR, mid, mcnCells, out, R);
    out.push(`<text x="105" y="345" class="dl">Duct: no connection</text>`, `<text x="264" y="24" class="dl">Capsule</text>`, `<text x="720" y="60" class="dl">Locule with mucin</text>`, `<text x="880" y="380" class="dl">Second locule</text>`);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: normal pancreas, a thick fibrous capsule, dense wavy ovarian-type stroma, and a cyst lined by tall columnar mucinous cells and filled with mucin, with a septum forming a second locule; a nearby duct is not connected">${out.join('')}</svg>`, w: W, h: H };
  }
  // Fat cells: polygons of white fat with a thin pink rim (viable), or ghost outlines with chalky blue soaps (necrotic).
  function drawFat(x0, y0, x1, y1, R, out, necrotic) {
    for (let y = y0; y < y1; y += 26) for (let x = x0 + ((y / 26) % 2) * 13; x < x1; x += 26) { const cx = x + (R() - 0.5) * 6, cy = y + (R() - 0.5) * 6, r = 12 + 3 * R(), pts = Array.from({ length: 7 }, (_, i) => { const a = i / 7 * 6.283 + R() * 0.3; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
      if (!necrotic) { out.push(pol(pts, '#fffafd', '#e6aec4', 1.2)); if (R() < 0.08) out.push(ell(cx + r * 0.7, cy, 3, 1.2, 90, HE.fibro)); }
      else { out.push(pol(pts, '#f3dbe8', '#d7b0c6', 1)); for (let k = 0; k < 9; k++) out.push(`<circle cx="${(cx + (R() - 0.5) * r * 1.4).toFixed(1)}" cy="${(cy + (R() - 0.5) * r * 1.4).toFixed(1)}" r="${(0.9 + R()).toFixed(1)}" fill="#6f6fbf"/>`); } }
  }
  const neutrophil = (x, y, out) => { for (let j = 0; j < 3; j++) out.push(`<circle cx="${(x + (j - 1) * 2.2).toFixed(1)}" cy="${(y + (j % 2) * 1.6).toFixed(1)}" r="1.5" fill="#2a1550"/>`); };
  function drawAcute() {
    const R = rng(5150), W = 1000, H = 420, out = [];
    drawStroma(R, W, H, out, 40);
    // Lobules of acini, pushed apart by oedematous septa (pale, loose, with fibrin strands and neutrophils).
    out.push(`<rect x="0" y="0" width="520" height="${H}" fill="#f7e9f0"/>`);
    const lob = [[20, 20, 225, 190], [265, 20, 480, 190], [20, 235, 225, 400], [265, 235, 440, 400]];
    lob.forEach(([a, b, c, d]) => { out.push(`<rect x="${a}" y="${b}" width="${c - a}" height="${d - b}" rx="18" fill="#f2cde0"/>`); for (let y = b + 16; y < d - 10; y += 30) for (let x = a + 16 + ((y / 30) % 2) * 14; x < c - 10; x += 30) drawAcinus(x + (R() - 0.5) * 4, y + (R() - 0.5) * 4, 12 + 2 * R(), R, out); });
    for (let k = 0; k < 40; k++) { const vert = R() < 0.5, x = vert ? 232 + (R() - 0.5) * 22 : 20 + R() * 460, y = vert ? 20 + R() * 380 : 205 + (R() - 0.5) * 24; out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q6 ${((R() - 0.5) * 8).toFixed(0)} 14 0" stroke="#e7a9c2" stroke-width="1" fill="none"/>`); if (R() < 0.6) neutrophil(x + 4, y + 6, out); }
    // Necrotizing edge: acini that have died (pale pink ghosts with no nuclei), then fat necrosis with chalky soaps, a rim of neutrophils, haemorrhage, and viable fat.
    for (let k = 0; k < 7; k++) { const x = 455 + R() * 70, y = 250 + R() * 150; out.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(11 + 3 * R()).toFixed(1)}" fill="#f4d3e1" stroke="#e5b7cb" stroke-width="1"/>`); }
    drawFat(540, 10, 840, 410, R, out, true); drawFat(870, 10, 1000, 410, R, out, false);
    for (let k = 0; k < 220; k++) { const y = R() * H, x = 846 + Math.sin(y / 30) * 10 + (R() - 0.5) * 26; neutrophil(x, y, out); }
    for (let k = 0; k < 80; k++) { const x = 640 + (R() - 0.5) * 90, y = 120 + (R() - 0.5) * 90; out.push(ell(x, y, 3.2, 1.6, R() * 180, '#d23a49')); }
    out.push(`<text x="250" y="${H - 6}" class="gl" text-anchor="middle">pancreas (oedematous)</text>`, `<text x="690" y="${H - 6}" class="gl" text-anchor="middle">fat necrosis</text>`, `<text x="935" y="${H - 6}" class="gl" text-anchor="middle">viable fat</text>`);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: acute pancreatitis, with oedematous septa and neutrophils between lobules, dead acini at the edge, fat necrosis with calcium soaps, a rim of neutrophils, haemorrhage and viable fat">${out.join('')}</svg>`, w: W, h: H };
  }
  function drawChronic() {
    const R = rng(6260), W = 1000, H = 420, out = [];
    out.push(`<rect width="${W}" height="${H}" fill="#eebcd0"/>`);
    for (let k = 0; k < 380; k++) { const x = R() * W, y = R() * H, dx = 26 + 30 * R(); out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(dx / 2).toFixed(0)} ${((R() - 0.5) * 12).toFixed(0)} ${dx.toFixed(0)} 0" stroke="#dd97b4" stroke-width="1.6" fill="none"/>`); }   // dense collagen
    for (let k = 0; k < 160; k++) out.push(ell(R() * W, R() * H, 5, 1.4, (R() - 0.5) * 40, '#6a4a9a', 0.85));   // activated stellate cells (myofibroblasts)
    // A few small, atrophic acini left in islands; islets spared and gathered together.
    [[110, 95], [170, 330], [880, 360]].forEach(([x, y]) => { for (let k = 0; k < 6; k++) drawAcinus(x + (R() - 0.5) * 60, y + (R() - 0.5) * 50, 9 + 2 * R(), R, out); });
    [[820, 120], [870, 160], [790, 175]].forEach(([x, y]) => { out.push(`<circle cx="${x}" cy="${y}" r="30" fill="#f6e2ec" stroke="#e2c1d2" stroke-width="1"/>`); for (let k = 0; k < 18; k++) { const a = R() * 6.28, rr = R() * 26; out.push(`<circle cx="${(x + Math.cos(a) * rr).toFixed(1)}" cy="${(y + Math.sin(a) * rr).toFixed(1)}" r="2" fill="#6b56a3"/>`); } });
    // A dilated, irregular duct lined by flattened cells, holding a laminated, calcified protein plug.
    const dc = [500, 215], ring = Array.from({ length: 61 }, (_, i) => { const a = i / 60 * 6.283; return [dc[0] + Math.cos(a) * (150 + 14 * Math.sin(a * 5)), dc[1] + Math.sin(a) * (120 + 10 * Math.cos(a * 4))]; });
    out.push(pol(ring, HE.lumen)); lining(ring, (x, y) => [dc[0] - x, dc[1] - y], { w: 13, h: 11, nuc: 'central', fill: '#f4d4e3' }, out, R);
    for (let r = 60; r > 4; r -= 7) out.push(`<ellipse cx="${dc[0] + 10}" cy="${dc[1] + 5}" rx="${r * 1.2}" ry="${r}" fill="${r % 14 < 7 ? '#8579c4' : '#a69bd6'}"/>`);
    // Chronic inflammation: lymphocytes, scattered and in a small cluster.
    for (let k = 0; k < 140; k++) { const cl = k < 60, x = cl ? 300 + (R() - 0.5) * 70 : R() * W, y = cl ? 360 + (R() - 0.5) * 50 : R() * H; out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#2d1b5e"/>`); }
    out.push(`<text x="500" y="30" class="dl">Dilated duct with a stone</text>`, `<text x="830" y="70" class="dl">Islets, spared</text>`);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: chronic pancreatitis, with dense fibrosis and activated stellate cells, a few atrophic acini, spared islets gathered together, a dilated duct with a flattened lining and a calcified stone, and lymphocytes">${out.join('')}</svg>`, w: W, h: H };
  }
  function drawPDA() {
    const R = rng(7370), W = 1000, H = 420, out = [];
    out.push(`<rect width="${W}" height="${H}" fill="#ecc9d8"/>`);
    for (let k = 0; k < 300; k++) { const x = R() * W, y = R() * H, dx = 18 + 26 * R(), a = Math.sin(x / 90 + y / 70) * 40; out.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(dx / 2).toFixed(0)} ${((R() - 0.5) * 10).toFixed(0)} ${dx.toFixed(0)} 0" transform="rotate(${a.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" stroke="#d8a3bd" stroke-width="1.3" fill="none"/>`); }
    for (let k = 0; k < 220; k++) out.push(ell(R() * W, R() * H, 5, 1.3, Math.sin(k) * 50, '#6a4a9a', 0.8));   // desmoplastic stroma: fibroblasts in collagen
    // A nerve, invaded: fascicles with wavy fibres and Schwann-cell nuclei, malignant glands inside its sheath.
    const nv = [760, 265, 62]; out.push(`<circle cx="${nv[0]}" cy="${nv[1]}" r="${nv[2] + 6}" fill="#f1dce6" stroke="#cf9fb8" stroke-width="2"/>`);
    for (let k = 0; k < 60; k++) { const a = R() * 6.28, rr = R() * nv[2] * 0.9, x = nv[0] + Math.cos(a) * rr, y = nv[1] + Math.sin(a) * rr; out.push(`<path d="M${(x - 8).toFixed(0)} ${y.toFixed(0)} q4 -3 8 0 t8 0" stroke="#d7b7c8" stroke-width="1.3" fill="none"/>`); if (k % 3 === 0) out.push(ell(x, y, 4, 1.3, 0, '#5a4592')); }
    // Malignant glands: irregular, angulated, sometimes incomplete; atypical cells with large, pleomorphic, dark nuclei.
    const gland = (cx, cy, r, open) => { const n = 9, pts = Array.from({ length: n + 1 }, (_, i) => { const a = i / n * 6.283; return [cx + Math.cos(a) * r * (0.7 + 0.5 * R()), cy + Math.sin(a) * r * (0.7 + 0.5 * R())]; }); pts[n] = pts[0];
      out.push(pol(pts, HE.lumen)); lining(open ? pts.slice(0, 6) : pts, (x, y) => [cx - x, cy - y], { w: 11, h: 20, hj: 5, mucin: 0.15, nuc: 'random', dark: true, fill: '#f0c9dc' }, out, R); };
    [[150, 115, 50], [275, 245, 58, true], [115, 330, 44], [395, 110, 44], [440, 305, 60], [580, 160, 46, true], [620, 345, 44], [880, 85, 40], [925, 345, 42, true]].forEach(([x, y, r, o]) => gland(x, y, r, o));
    [[730, 235, 18], [790, 300, 16], [742, 300, 14]].forEach(([x, y, r]) => gland(x, y, r, false));   // in the nerve
    // Necrotic debris in a gland's lumen; tumour cells in a vein; a spared islet.
    for (let k = 0; k < 50; k++) out.push(`<circle cx="${(440 + (R() - 0.5) * 44).toFixed(1)}" cy="${(305 + (R() - 0.5) * 40).toFixed(1)}" r="${(1 + R() * 1.5).toFixed(1)}" fill="${R() < 0.5 ? '#3a2470' : '#e7a0b8'}"/>`);
    out.push(`<circle cx="930" cy="200" r="36" fill="#f7eef3" stroke="#d7414f" stroke-width="3"/>`); for (let k = 0; k < 14; k++) out.push(ell(915 + R() * 30, 185 + R() * 30, 3, 1.5, R() * 180, '#d23a49'));
    gland(940, 206, 12, false);
    out.push(`<circle cx="60" cy="210" r="28" fill="#f6e2ec" stroke="#e2c1d2"/>`); for (let k = 0; k < 16; k++) { const a = R() * 6.28, rr = R() * 24; out.push(`<circle cx="${(60 + Math.cos(a) * rr).toFixed(1)}" cy="${(210 + Math.sin(a) * rr).toFixed(1)}" r="2" fill="#6b56a3"/>`); }
    out.push(`<text x="760" y="${265 - 62 - 14}" class="dl">Nerve</text>`, `<text x="930" y="150" class="dl">Vein</text>`);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" class="drawing" role="img" aria-label="Drawing: pancreatic ductal adenocarcinoma, with irregular malignant glands of atypical cells in dense desmoplastic stroma, glands inside a nerve (perineural invasion), tumour in a vein, necrotic debris in a lumen, and a spared islet">${out.join('')}</svg>`, w: W, h: H };
  }
  const DRAWINGS = { panin: drawPanIN, ipmn: drawIPMN, mcn: drawMCN, acute: drawAcute, chronic: drawChronic, pda: drawPDA };
  function renderHisto(key) {
    const box = $('histopanel'), Hd = HISTO[key]; if (!Hd) { box.hidden = true; return; } box.hidden = false;
    const drawn = Hd.drawing && DRAWINGS[key] ? DRAWINGS[key]() : null;
    const drawFig = drawn ? `<figure><div class="frame" style="aspect-ratio:${drawn.w}/${drawn.h}">${drawn.svg}${markSvg(Hd.drawing, 1)}</div><figcaption>${esc(Hd.drawing.credit)}</figcaption></figure>` : '';
    let n = 1; const figs = Hd.figures.map((F) => { const html = `<figure><div class="frame" style="aspect-ratio:${F.w}/${F.h}"><img src="${HISTO_IMG[F.img]}" alt="${esc(Hd.title)}: H&amp;E micrograph"/>${markSvg(F, n)}</div><figcaption>${esc(F.credit)}</figcaption></figure>`; n += F.marks.length; return html; }).join('');
    const hp = (Hd.hp || []).map((F) => `<figure><div class="frame" style="aspect-ratio:${F.w}/${F.h}"><img src="${HISTO_IMG[F.img]}" alt="${esc(Hd.title)}: high-power H&amp;E"/>${markSvg(F, 1, 2.6)}</div><figcaption>${esc(F.credit)}</figcaption></figure>`).join('');
    const cmp = Hd.compare || { title: 'PanIN, IPMN and MCN compared', cols: ['PanIN', 'IPMN', 'MCN'], rows: COMPARE_ROWS, on: { panin: 1, ipmn: 2, mcn: 3 }[key], src: 'Beger 4th ed. ch. 81, 86, 126; Hingorani 2007.' }, col = cmp.on;
    const more = Hd.more ? `<p class="more">More real examples: ${Hd.more.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join(' · ')} <span>(external; images © Johns Hopkins, not reproduced here)</span></p>` : '';
    box.innerHTML = `<div class="hhead"><h2>${esc(Hd.title)}</h2><button type="button" class="hclose" data-lesion="overview">‹ All precursors</button></div><p class="lead">${esc(Hd.lead)}</p>`
      + (drawn ? `${drawFig}<h3>Real H&amp;E: the same features, numbered alike</h3>` : '') + figs
      + (hp ? `<h3>High power: the cells themselves</h3><p class="hpnote">Openly licensed micrographs at the highest power available (up to ×400, that is a ×40 objective); pins use the same numbers.</p><div class="hpgrid">${hp}</div>` : '') + more
      + `<div class="hcols"><div><h3>Marked features</h3><ol>${Hd.key.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div><div class="apart"><h3>What sets it apart</h3><ul>${Hd.unique.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></div>`
      + (Hd.chart ? `<h3>${esc(Hd.chart.title)}</h3><div class="tablewrap"><table class="prog"><thead><tr><th></th>${Hd.chart.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
        + Hd.chart.rows.map((r) => { const mx = Math.max(...r.vals.filter((v) => v !== null)); return `<tr><th>${esc(r.label)}<small>${esc(r.src)}</small></th>${r.vals.map((v) => v === null ? '<td class="na">–</td>' : `<td><span class="bar" style="width:${Math.max(3, 100 * v / mx)}%"></span><span class="v">${v}${r.unit}</span></td>`).join('')}</tr>`; }).join('')
        + `</tbody></table></div><p class="src">${esc(Hd.chart.note)}</p>` : '')
      + `<h3>${esc(cmp.title)}</h3><div class="tablewrap"><table><thead><tr><th></th>${cmp.cols.map((c, i) => `<th${i + 1 === col ? ' class="on"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
      + cmp.rows.map((r) => `<tr><th>${esc(r[0])}</th>${r.slice(1).map((c, i) => `<td${i + 1 === col ? ' class="on"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>'
      + srcFold(`${esc(Hd.sources)} Comparison: ${esc(cmp.src)} Text in our own words. Images keep their own licences.`);
    box.querySelector('.hclose').addEventListener('click', () => exitLesion()); box.scrollTop = 0;
  }
  function setMode(m) {
    if (m === MODE || !['pancreas', 'precursors', 'pancreatitis', 'pda', 'atlas'].includes(m)) return;
    if (LES.view) exitLesion(true);
    MODE = m; document.body.dataset.mode = m; if (splitOn) setSplit(false);
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    if (COMPARE.on) $('compare').click();
    setDisease(MODE_PARTS[m] ? m : null); pancreasMeshes.forEach((pm) => { pm.material.color.copy(col('--organ')); });
    if (m === 'pancreas') setSite(site);
    renderAtlas(); resize(); if (m !== 'atlas') flyTo(STOPS.organ, undefined, 'tissue'); lastLevel = ''; hashNow();
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function enterLesion(key) {
    if (!LESION_VIEWS[key]) return; if (MODE !== LESION_VIEWS[key].mode) setMode(LESION_VIEWS[key].mode);
    LES.view = key; LES.pending = null; flight = null; flash(); renderHisto(key); lastLevel = ''; renderLesionCard(); hashNow();
  }
  function exitLesion(quiet) {
    if (!LES.view) return; LES.view = null; LES.pending = null; if (!quiet) flash(); renderHisto(null);
    const dir = camera.position.clone().sub(controls.target); if (dir.lengthSq() < 1e-6) dir.set(0, 0.25, 1); camera.position.copy(controls.target).addScaledVector(dir.normalize(), Math.max(130000, camera.position.distanceTo(controls.target))); controls.update(); lastLevel = ''; renderLesionCard(); hashNow();
  }
  function flash() { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '1'; requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = '0'; }); }
  document.querySelectorAll('[data-lesion]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.lesion; if (k === 'overview') { if (LES.view) exitLesion(); else flyTo(STOPS.organ, undefined, 'tissue'); } else enterLesion(k); }));
  function renderLesionCard() {
    const keys = (MODE === 'pancreas' ? (disease && !MODE_PARTS[disease] ? [disease] : []) : LES.view ? LESION_VIEWS[LES.view].parts : MODE_PARTS[MODE] || []).filter((k) => LESIONS[k]), card = $('lesioncard');
    card.hidden = !keys.length; if (!keys.length) return; const detailed = keys.length <= 2;
    card.innerHTML = keys.map((k) => { const L = LESIONS[k]; return `<h3><span class="sw" style="background:var(${L.color})"></span>${esc(L.full)}</h3>`
      + (detailed ? `<p><strong>Where:</strong> ${esc(L.where)}</p><p><strong>Size:</strong> ${esc(L.size)}</p><details class="src more"><summary>More: what it is, and prognosis</summary><p>${esc(L.text)}</p><p><strong>Prognosis:</strong> ${esc(L.survival)}</p></details>` : `<p>${esc(L.where.replace(/\.$/, ''))}.</p>`); }).join('') + srcFold(esc(LESIONS[keys[0]].source || LESION_SOURCE));
  }
  // Insets beside the organ, each a live view of one lesion's architecture, joined by a line to where it arises.
  const INSETS_BY_MODE = { precursors: [{ key: 'mcn', pos: { right: 16, top: 70 } }, { key: 'panin', pos: { right: 16, bottom: 70 } }, { key: 'ipmn', pos: { left: 16, bottom: 70 } }],
    pancreatitis: [{ key: 'acute', pos: { right: 16, top: 70 } }, { key: 'chronic', pos: { left: 16, bottom: 70 } }], pda: [{ key: 'pda', pos: { right: 16, bottom: 70 } }] };
  let INSETS = INSETS_BY_MODE.precursors;
  const INSET_CROP = { panin: '50% 50%', ipmn: '50% 40%', mcn: '50% 30%', acute: '45% 35%', chronic: '30% 70%', pda: '50% 60%' }, INSET_IMG = { panin: 'panin2-hp', ipmn: 'ipmn-lowgrade', mcn: 'mcn-hp', acute: 'acute', chronic: 'chronic-fibrosis', pda: 'pda-hp' };
  function insetDom() {
    const box = $('insets'); if (box.dataset.built === MODE) return; box.dataset.built = MODE; INSETS = INSETS_BY_MODE[MODE] || [];
    box.innerHTML = '<svg aria-hidden="true"></svg>' + INSETS.map((t) => `<div class="inset" data-inset="${t.key}" style="${Object.entries(t.pos).map(([k, v]) => `${k}:${v}px`).join(';')};background-image:url(${HISTO_IMG[INSET_IMG[t.key]]});background-position:${INSET_CROP[t.key]}" role="button" tabindex="0" aria-label="Open ${LESION_VIEWS[t.key].title}: histology"><b>${LESION_VIEWS[t.key].title} ›</b></div>`).join('');
    box.querySelectorAll('[data-inset]').forEach((el) => { el.addEventListener('click', () => enterLesion(el.dataset.inset)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterLesion(el.dataset.inset); }); });
  }
  function drawInsets(now, show) {
    const box = $('insets'); show = show && $('showinsets').checked; box.style.display = show ? '' : 'none'; if (!show) return; insetDom();
    const st = stage.getBoundingClientRect(), svg = box.querySelector('svg'), lines = [];
    INSETS.forEach((t) => { const el = box.querySelector(`[data-inset="${t.key}"]`), r = el.getBoundingClientRect(), x = r.left - st.left, y = r.top - st.top, w = r.width, h = r.height;
      const at = lesionGroup && lesionGroup.getObjectByName(LESION_VIEWS[t.key].at); if (!at) return; const p = groups.organ.userData.inner.localToWorld(at.userData.at.clone()).project(camera);
      const px = (p.x + 1) / 2 * UI.w, py = (1 - p.y) / 2 * UI.h, ex = Math.max(x, Math.min(x + w, px)), ey = Math.max(y, Math.min(y + h, py)); lines.push(`<line x1="${ex}" y1="${ey}" x2="${px}" y2="${py}"/><circle cx="${px}" cy="${py}" r="5"/>`); });
    svg.innerHTML = `<g stroke="var(--accent)" stroke-width="2" fill="var(--accent)">${lines.join('')}</g>`;
  }
  // ---------- atlas: a gallery of the normal pancreas, pancreatitis, precursors, cancers and their look-alikes. Each entry
  // shows one openly licensed micrograph, what to look for, and folded detail; entries can be compared and quizzed.
  // Data: viewer/src/atlas.json (text in our own words, every entry with its sources; images in viewer/assets/atlas).
  const ATLAS_DATA = JSON.parse($('atlas').textContent), AT = { group: 'all', entry: null, pair: null, view: 'grid', q: '', quiz: null, score: [0, 0] };
  const AT_BY = Object.fromEntries(ATLAS_DATA.entries.map((e) => [e.id, e]));
  const AT_FEATURES = [['architecture', 'Architecture'], ['cells', 'Cells'], ['nuclei', 'Nuclei'], ['mitoses', 'Mitoses'], ['mucin', 'Mucin'], ['stroma', 'Stroma']];
  const AT_FACTS = [['where', 'Where'], ['size', 'Size'], ['who', 'Who'], ['gross', 'To the eye'], ['molecular', 'Markers and genes'], ['outlook', 'Outlook']];
  const atSrc = (im) => (im.src.startsWith('histo:') ? HISTO_IMG[im.src.slice(6)] : im.src);
  const atCredit = (im) => `${im.credit} (${im.licence})`;
  const atImg = (e) => (e.images && e.images[0]) || null;
  function atFold(title, body, open) { return body ? `<details class="fold"${open ? ' open' : ''}><summary>${title}</summary>${body}</details>` : ''; }
  function atCard(e) { const im = atImg(e);
    return `<button type="button" class="acard" data-entry="${e.id}"><div class="thumb"${im ? ` style="background-image:url(${e.thumb || atSrc(im)})"` : ''}>${im ? '' : 'No open image yet'}</div>${e.species === 'mouse' ? '<i class="tag">Mouse</i>' : ''}<b>${esc(e.name)}</b><span>${esc(e.line)}</span></button>`; }
  function atMatches(e) { const q = AT.q.trim().toLowerCase(); return (AT.group === 'all' || e.group === AT.group) && (!q || [e.name, e.aka || '', e.line].join(' ').toLowerCase().includes(q)); }
  function atGrid() {
    const groups = ATLAS_DATA.groups.filter((g) => AT.group === 'all' || g.key === AT.group).map((g) => { const es = ATLAS_DATA.entries.filter((e) => e.group === g.key && atMatches(e)); if (!es.length) return '';
      return `<div class="agroup"><h3>${esc(g.title)}</h3><p>${esc(g.blurb)}</p><div class="agrid">${es.map(atCard).join('')}</div></div>`; }).join('');
    return groups || '<p class="empty">Nothing matches. Clear the search or choose All.</p>';
  }
  function atFigure(im, name) { return `<figure><img src="${atSrc(im)}" alt="${esc(name)}: ${esc(im.caption || 'micrograph')}" loading="lazy" data-zoom="${esc(atCredit(im))}"><figcaption>${im.caption ? esc(im.caption) + ' ' : ''}${im.mag ? esc(im.mag) + '. ' : ''}${esc(atCredit(im))}</figcaption></figure>`; }
  function atRows(e, rows, key) { const src = e[key] || {}; const out = rows.filter(([k]) => src[k]).map(([k, label]) => `<dt>${label}</dt><dd>${esc(src[k])}</dd>`).join(''); return out ? `<dl>${out}</dl>` : ''; }
  function atEntry(e) {
    const figs = (e.images || []).map((im) => atFigure(im, e.name)).join('') || '<p class="empty">No openly licensed micrograph was found for this entry. The description stands on its sources.</p>';
    const mim = (e.mimics || []).map((m) => `<li>${AT_BY[m.id] ? `<button type="button" class="abtn" data-pair="${m.id}">${esc(AT_BY[m.id].name)}</button>` : `<b>${esc(m.name)}</b>`} ${esc(m.tell)}</li>`).join('');
    const see = e.see ? `<button type="button" class="abtn" data-see='${JSON.stringify(e.see)}'>${esc(e.see.label)} ›</button>` : '';
    return `<div class="aentry"><div>${figs}</div><div><p class="aline">${esc(e.line)}</p>`
      + `<ul class="glance">${e.glance.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      + (e.remember ? `<p class="remember"><b>Remember:</b> ${esc(e.remember)}</p>` : '')
      + atFold('Under the microscope', atRows(e, AT_FEATURES, 'features'), true)
      + atFold('Look-alikes, and how to tell them apart', mim ? `<ul class="mim">${mim}</ul>` : '')
      + atFold('Where, size, who and outlook', atRows(e, AT_FACTS, 'facts'))
      + atFold('Sources', `<p class="src">${e.sources.map(esc).join('; ')}. Text in our own words.</p>`)
      + (see ? `<p class="chips">${see}</p>` : '') + '</div></div>';
  }
  function atPair(a, b) {
    const col = (e) => { const im = atImg(e); return `<div><h3>${esc(e.name)}</h3>${im ? `<img src="${atSrc(im)}" alt="${esc(e.name)}" data-zoom="${esc(atCredit(im))}">` : ''}<p class="src">${im ? esc(atCredit(im)) : ''}</p></div>`; };
    const tell = (a.mimics || []).find((m) => m.id === b.id) || (b.mimics || []).find((m) => m.id === a.id);
    return `<div class="pair">${col(a)}${col(b)}</div>` + (tell ? `<p class="remember"><b>Telling them apart:</b> ${esc(tell.tell)}</p>` : '')
      + `<div class="tablewrap"><table><thead><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead><tbody>`
      + AT_FEATURES.concat(AT_FACTS).filter(([k]) => (a.features || {})[k] || (b.features || {})[k] || (a.facts || {})[k] || (b.facts || {})[k]).map(([k, label]) => `<tr><th>${label}</th><td>${esc((a.features || {})[k] || (a.facts || {})[k] || '–')}</td><td>${esc((b.features || {})[k] || (b.facts || {})[k] || '–')}</td></tr>`).join('') + '</tbody></table></div>';
  }
  function atMatrix() {
    const body = ATLAS_DATA.groups.map((g) => { const es = ATLAS_DATA.entries.filter((e) => e.group === g.key && e.features); if (!es.length) return '';
      return `<tr class="grp"><th colspan="${AT_FEATURES.length + 1}">${esc(g.title)}</th></tr>` + es.map((e) => `<tr><th><a href="#atlas=${e.id}" data-entry="${e.id}">${esc(e.name)}</a></th>${AT_FEATURES.map(([k]) => `<td>${esc(e.features[k] || '–')}</td>`).join('')}</tr>`).join(''); }).join('');
    return `<p class="aline">Every entry by the same six features. Read down a column to see how one feature changes from normal to cancer.</p><div class="tablewrap"><table class="matrix"><thead><tr><th></th>${AT_FEATURES.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function atQuizNew() {
    const pool = ATLAS_DATA.entries.filter((e) => atImg(e) && (AT.group === 'all' || e.group === AT.group)), e = pool[Math.floor(Math.random() * pool.length)];
    const near = (e.mimics || []).map((m) => AT_BY[m.id]).filter(Boolean), same = pool.filter((x) => x.group === e.group && x !== e), rest = ATLAS_DATA.entries.filter((x) => x !== e && x.species === e.species);
    const opts = [e]; [near, same, rest].forEach((list) => { list.slice().sort(() => Math.random() - 0.5).forEach((x) => { if (opts.length < 4 && !opts.includes(x)) opts.push(x); }); });
    AT.quiz = { e, opts: opts.sort(() => Math.random() - 0.5), picked: null };
  }
  function atQuiz() {
    const Q = AT.quiz, im = atImg(Q.e), done = Q.picked !== null;
    return `<div class="quiz"><p class="aline">What is this? ${AT.score[1] ? `<span class="src">Score ${AT.score[0]} of ${AT.score[1]}</span>` : ''}</p><img src="${atSrc(im)}" alt="A micrograph to identify" data-zoom="">`
      + `<div class="opts">${Q.opts.map((o) => `<button type="button" data-answer="${o.id}"${done ? ' disabled' : ''} class="${done && o === Q.e ? 'right' : done && o.id === Q.picked ? 'wrong' : ''}">${esc(o.name)}</button>`).join('')}</div>`
      + (done ? `<p class="remember"><b>${Q.picked === Q.e.id ? 'Yes.' : 'It is ' + esc(Q.e.name) + '.'}</b> ${esc(Q.e.remember || Q.e.line)}</p><p class="chips"><button type="button" class="abtn primary" data-atlas-view="quiz">Next</button><button type="button" class="abtn" data-entry="${Q.e.id}">Open this entry</button></p><p class="src">${esc(atCredit(im))}</p>` : '') + '</div>';
  }
  function renderAtlas() {
    const box = $('atlaspanel'); box.hidden = MODE !== 'atlas'; if (box.hidden) return;
    const e = AT.entry && AT_BY[AT.entry], pair = e && AT.pair && AT_BY[AT.pair];
    const title = pair ? 'Side by side' : e ? e.name + (e.aka ? ` <small style="font:400 13px 'Public Sans',sans-serif;color:var(--muted)">${esc(e.aka)}</small>` : '') : AT.view === 'matrix' ? 'Features side by side' : AT.view === 'quiz' ? 'Quiz' : 'Atlas of the pancreas';
    const back = e || AT.view !== 'grid' ? `<button type="button" class="abtn" data-atlas-back>‹ ${pair ? esc(e.name) : 'All entries'}</button>` : '';
    const tools = e || AT.view !== 'grid' ? '' : `<input type="search" id="atlasq" placeholder="Search the atlas" aria-label="Search the atlas" value="${esc(AT.q)}"><button type="button" class="abtn" data-atlas-view="matrix">Features table</button><button type="button" class="abtn primary" data-atlas-view="quiz">Quiz me</button>`;
    const order = ATLAS_DATA.entries.filter((x) => AT.group === 'all' || x.group === AT.group), k = e ? order.indexOf(e) : -1;
    const nav = e && !pair && order.length > 1 && k >= 0 ? `<button type="button" class="abtn" data-entry="${order[(k + order.length - 1) % order.length].id}" aria-label="Previous entry">◀</button><button type="button" class="abtn" data-entry="${order[(k + 1) % order.length].id}" aria-label="Next entry">▶</button>` : '';
    box.innerHTML = `<div class="abar">${back}<h2>${pair || !e ? esc(title) : title}</h2>${tools}${nav}</div>` + (pair ? atPair(e, pair) : e ? atEntry(e) : AT.view === 'matrix' ? atMatrix() : AT.view === 'quiz' ? atQuiz() : `<p class="intro">${esc(INFO.atlas)}</p><div id="atlasgrid">${atGrid()}</div>`);
    document.querySelectorAll('#atlasnav [data-atlas-group]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.atlasGroup === AT.group)));
    box.scrollTop = 0;
  }
  function atlasOpen(id, pair) { AT.entry = AT_BY[id] ? id : null; AT.pair = AT.entry && AT_BY[pair] ? pair : null; if (AT.entry) AT.view = 'grid'; renderAtlas(); hashNow(); }
  $('atlasnav').innerHTML = [{ key: 'all', title: 'All entries', blurb: `${ATLAS_DATA.entries.length} entries` }].concat(ATLAS_DATA.groups).map((g) => `<button type="button" data-atlas-group="${g.key}">${esc(g.title)}<span>${g.key === 'all' ? esc(g.blurb) : ATLAS_DATA.entries.filter((e) => e.group === g.key).length + ' entries'}</span></button>`).join('');
  $('atlasnav').addEventListener('click', (ev) => { const b = ev.target.closest('[data-atlas-group]'); if (!b) return; AT.group = b.dataset.atlasGroup; AT.entry = AT.pair = null; AT.view = 'grid'; renderAtlas(); hashNow(); });
  $('atlaspanel').addEventListener('click', (ev) => {
    const t = ev.target, zoom = t.closest('img[data-zoom]'), ent = t.closest('[data-entry]'), pair = t.closest('[data-pair]'), view = t.closest('[data-atlas-view]'), ans = t.closest('[data-answer]'), see = t.closest('[data-see]');
    if (zoom) { const lb = $('lightbox'); lb.querySelector('img').src = zoom.src; lb.querySelector('p').textContent = zoom.dataset.zoom; lb.hidden = false; return; }
    if (ans) { AT.quiz.picked = ans.dataset.answer; AT.score[1]++; if (AT.quiz.picked === AT.quiz.e.id) AT.score[0]++; renderAtlas(); return; }
    if (view) { AT.view = view.dataset.atlasView; AT.entry = AT.pair = null; if (AT.view === 'quiz') atQuizNew(); renderAtlas(); return; }
    if (pair) { atlasOpen(AT.entry, pair.dataset.pair); return; }
    if (ent) { ev.preventDefault(); atlasOpen(ent.dataset.entry); return; }
    if (t.closest('[data-atlas-back]')) { if (AT.pair) atlasOpen(AT.entry); else { AT.entry = null; AT.view = 'grid'; renderAtlas(); hashNow(); } return; }
    if (see) { const s = JSON.parse(see.dataset.see); if (s.lesion) enterLesion(s.lesion); else if (s.mode) setMode(s.mode); else if (s.view) { setMode('pancreas'); readHash(`#site=${site + 1}&view=${s.view}`); } }
  });
  $('atlaspanel').addEventListener('input', (ev) => { if (ev.target.id !== 'atlasq') return; AT.q = ev.target.value; $('atlasgrid').innerHTML = atGrid(); });
  $('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; });
  function atlasFrame(now) {
    if (lastLevel !== 'atlas') { lastLevel = 'atlas'; UI.levelname.textContent = 'Atlas'; setInfo(INFO.atlas); applyDataFor('atlas', 'atlas'); showMarkers(null); }
    drawLabels(null, 0); drawInsets(now, false); renderer.setViewport(UI.x, 0, UI.w, UI.h); renderer.setScissor(UI.x, 0, UI.w, UI.h); renderer.clear();
  }
  function lesionFrame(now, v) {   // the histology panel covers the view; nothing 3D is drawn behind it
    const V0 = LESION_VIEWS[LES.view], key = 'lesion' + V0.title.replace(/\W/g, '');
    if (key !== lastLevel) { lastLevel = key; UI.levelname.textContent = V0.title + ': histology'; setInfo(INFO[key] || ''); applyDataFor(key, key); showMarkers(null); }
    drawLabels(null, 0); drawInsets(now, false); renderer.setViewport(UI.x, 0, UI.w, UI.h); renderer.setScissor(UI.x, 0, UI.w, UI.h); renderer.clear();
  }

  // ---------- links to a view: #site=12&view=islet&stain=if opens the page there; the address follows the view
  const VIEW_KEYS = { organ: ['organ'], lobules: ['gross'], tissue: ['tissue'], acinus: ['detail', 'acinus'], 'acinus-cells': ['cells', 'acinus'], 'acinar-cell': ['cell', 'acinus'],
    islet: ['detail', 'islet'], 'islet-cells': ['cells', 'islet'], 'beta-cell': ['cell', 'islet', 'beta'], 'alpha-cell': ['cell', 'islet', 'alpha'], 'delta-cell': ['cell', 'islet', 'delta'], duct: ['detail', 'duct'], 'duct-cells': ['cells', 'duct'], 'duct-cell': ['cell', 'duct'] };
  const viewName = (lv) => Object.keys(VIEW_KEYS).find((k) => { const [l, br, kind] = VIEW_KEYS[k]; return l === lv && (!br || br === branch) && (!kind || kind === isletKind); }) || 'organ';
  const hashNow = () => writeHash(LES.view ? 'lesion' : levelAt(camera.position.distanceTo(controls.target)));
  let hashReady = false; const START_HASH = location.hash;   // the link the page was opened with is read once the organ is built
  function writeHash(lv) { if (!hashReady || splitOn || tour || site < 0) return; const h = MODE === 'atlas' ? `#atlas${AT.entry ? '=' + AT.entry : AT.group !== 'all' ? '&group=' + AT.group : ''}` : MODE !== 'pancreas' ? `#mode=${MODE}${LES.view ? '&lesion=' + LES.view : ''}` : `#site=${site + 1}&view=${viewName(lv)}${stain === 'if' ? '&stain=if' : ''}${disease ? '&disease=' + disease : ''}`;
    if (location.hash !== h) try { history.replaceState(null, '', h); } catch (e) { /* a sandboxed page may refuse */ } }
  function readHash(h) { const q = new URLSearchParams((typeof h === 'string' ? h : location.hash).slice(1)), n = +q.get('site'), v = VIEW_KEYS[q.get('view')];
    if (n >= 1 && n <= SITE_LIST.length && n - 1 !== site) setSite(n - 1);
    if (q.get('stain') === 'if') document.querySelector('[data-stain=if]').click();
    if (q.has('atlas')) { setMode('atlas'); if (ATLAS_DATA.groups.some((g) => g.key === q.get('group'))) AT.group = q.get('group'); atlasOpen(q.get('atlas')); return; }
    if (MODE_PARTS[q.get('mode')]) { setMode(q.get('mode')); if (LESION_VIEWS[q.get('lesion')]) enterLesion(q.get('lesion')); return; } else if (MODE !== 'pancreas') setMode('pancreas');
    if (q.get('disease')) setDisease(q.get('disease'));
    if (v && v[0] !== 'organ') { const [lvl, br, kind] = v; setIsletKind(kind); if (br) document.querySelectorAll('[data-branch]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === br))); flyTo(stopFor(lvl, br), br, MODE_OF[lvl]); } }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
  buildOrgan().then(() => { camera.position.set(0, 0.25, 1).normalize().multiplyScalar(STOPS.organ); controls.target.set(0, 0, 0); controls.update(); $('status').style.display = 'none'; renderer.setAnimationLoop(frame); readHash(START_HASH); hashReady = true; window.addEventListener('hashchange', () => readHash()); })
    .catch((e) => { $('status').textContent = 'The organ could not be read: ' + e; });
  // ---------- the name of what is under the pointer, in a box below the level's name (top right of the view)
  const PART_NAMES = { lobule: 'Lobule (cut)', lobuleHull: 'Lobule', septa: 'Septum (connective tissue)', mainDuct: 'Large interlobular duct', interlobularDuct: 'Interlobular duct', intralobularDuct: 'Intralobular duct',
    terminalDuct: 'Terminal (intercalated) duct', joint: 'Duct', grossAcinus: 'Acini (cluster)', grossIslet: 'Islet of Langerhans', vein: 'Vein', artery: 'Artery', papillaCore: 'Papilla core', secretoryCore: 'Secretory granule', secretoryHalo: 'Granule halo',
    insulin: 'Insulin (released)', glucagon: 'Glucagon (released)', somatostatin: 'Somatostatin (released)', glucose: 'Glucose (entering)', enzyme: 'Digestive enzymes (released)', bicarbonate: 'Bicarbonate (secreted)' };
  const COLOR_NAMES = { '--nucleus': 'Nucleus', '--nucleolus': 'Nucleolus', '--rer': 'Rough endoplasmic reticulum', '--golgi': 'Golgi apparatus', '--mito': 'Mitochondrion', '--granule': 'Zymogen granule',
    '--insulincore': 'Insulin granule', '--insulinhalo': 'Insulin granule (halo)', '--glucagoncore': 'Glucagon granule', '--somatostatincore': 'Somatostatin granule', '--cilium': 'Primary cilium', '--microvilli': 'Microvilli',
    '--tightjunction': 'Tight junction', '--cftr': 'CFTR (chloride channel)', '--slc26': 'SLC26A6 (chloride–bicarbonate exchanger)', '--basement': 'Basement membrane', '--capillary': 'Capillary', '--beta': 'Beta cell', '--alpha': 'Alpha cell',
    '--delta': 'Delta cell', '--pp': 'PP cell', '--intralobular': 'Duct cell', '--intercalated': 'Intercalated duct cell', '--cac': 'Centroacinar cell', '--ductnucleus': 'Duct cell nucleus', '--collagen': 'Collagen', '--organ': 'Pancreas',
    '--organduct': 'Duct', '--artery': 'Artery', '--vein': 'Vein', '--neighbour': 'Neighbouring organ', '--parenchyma': 'Pancreatic tissue', '--isletgross': 'Islet of Langerhans', '--grossduct': 'Duct', '--grossartery': 'Artery', '--grossvein': 'Vein' };
  const humanize = (n) => n.replace(/^VH_[MF]_/, '').replace(/_[LR]$/, (m) => (m === '_L' ? ' (left)' : ' (right)')).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  function hoverName(o) {
    for (let q = o; q; q = q.parent) { if (lesionGroup && q.parent === lesionGroup && LESIONS[q.name]) return LESIONS[q.name].full; }
    if (KINDS[o.name]) return KINDS[o.name][0];
    if (PART_NAMES[o.name]) return PART_NAMES[o.name];
    if (o.userData && o.userData.kind === 'neighbour') return humanize(o.name.replace(/_capsule/, ''));
    if (o.userData && o.userData.kind && o.name) { const map = { head_of_pancreas: 'Head of the pancreas', uncinate_process_of_the_pancreas: 'Uncinate process', ucinate_process1: 'Uncinate process', neck_of_pancreas: 'Neck of the pancreas', body_of_pancreas: 'Body of the pancreas', tail_of_pancreas: 'Tail of the pancreas', ventral_pancreatic_duct: 'Main pancreatic duct', dorsal_pancreatic_duct: 'Accessory (dorsal) pancreatic duct',
      duodenal_ampulla: 'Duodenal bulb (first part of the duodenum)', duodenum_superior: 'Duodenum, first part', duodenum_descending: 'Duodenum, second (descending) part', duodenum_horizonal: 'Duodenum, third (horizontal) part', duodenum_horizontal: 'Duodenum, third (horizontal) part', duodenum_ascending: 'Duodenum, fourth (ascending) part',
      hepatopancreatic_ampulla: 'Ampulla of Vater (hepatopancreatic ampulla)', sphincter_of_hepatopancreatic_ampulla: 'Sphincter of Oddi', sphincter_of_heptopancreatic_ampulla: 'Sphincter of Oddi', celiac_trunk: 'Coeliac trunk', hepatic_portal_vein: 'Portal vein' };
      return map[o.name] || (/surface_of_spleen|hilum_of_spleen/.test(o.name) ? 'Spleen' : humanize(o.name)); }
    const ck = o.material && o.material.userData && o.material.userData.colorKey; return (ck && COLOR_NAMES[ck]) || null;
  }
  const HOVER = { x: 0, y: 0, at: 0, done: true, view: 0 };
  onViews('pointermove', (e) => { const r = VIEWS[focus].el.getBoundingClientRect(); HOVER.x = (e.clientX - r.left) / r.width * 2 - 1; HOVER.y = -(e.clientY - r.top) / r.height * 2 + 1; HOVER.at = performance.now(); HOVER.done = false; HOVER.view = focus; });
  onViews('pointerleave', () => { VIEWS.forEach((v) => { v.ui.hover.hidden = true; }); });
  // Raycast once the pointer has rested a moment, against what the current level shows.
  function hoverCandidates() {
    if (LES.view) return []; const d = camera.position.distanceTo(controls.target), lv = levelAt(d), b = BRANCHES[branch];
    if (lv === 'organ' || lv === 'compare' || MODE !== 'pancreas') return [groups.organ.userData.inner].filter(Boolean);
    if (lv === 'gross') return [GROSS[site]].filter(Boolean);
    if (lv === 'tissue') return [groups.block].filter(Boolean);
    if (lv === 'cell') return [b.cellGroup].filter(Boolean);
    return [b.detail].filter(Boolean);
  }
  function updateHover(now) {
    if (HOVER.done || now - HOVER.at < 140 || HOVER.view !== focus) return; HOVER.done = true; const box = VIEWS[focus].ui.hover;
    ray.setFromCamera(ptr.set(HOVER.x, HOVER.y), camera);
    const hits = ray.intersectObjects(hoverCandidates(), true).filter((h) => { const o = h.object; if (!o.visible || (o.parent && !o.parent.visible) || o.isPoints) return false;
      if (o.material && o.material.transparent && o.material.opacity < 0.08) return false;
      if (o.material && o.material.clippingPlanes && !o.material.clippingPlanes.every((pl) => pl.distanceToPoint(h.point) >= 0)) return false;
      if (o.parent === groups.block && !inCore(h.point)) return false;   // the core's shape is cut in the shader
      return !!hoverName(o); });
    const name = hits.length ? hoverName(hits[0].object) : null; box.hidden = !name; if (name) box.textContent = name;
  }
  window.__zoom = { split: setSplit, focus: setFocus, views: () => VIEWS.map((v) => [v.STAGE.mode, v.branch, Math.round(v.camera.position.distanceTo(v.controls.target))]), stage: () => STAGE.mode, flyTo, setBranch: (k) => { branch = k; }, distance: () => camera.position.distanceTo(controls.target),
    stats: () => { let objects = 0, visible = 0; scene.traverse((o) => { objects++; if (o.visible) visible++; }); const top = []; scene.traverseVisible((o) => { if (!o.isMesh || !o.material || o.material.opacity < 0.01) return; const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3, n = o.isInstancedMesh ? o.count : 1; let p = o, path = []; while (p && p !== scene) { if (p.name) path.unshift(p.name); p = p.parent; } top.push([path.slice(-3).join('/') || o.type, Math.round(tri), n, Math.round(tri * n), o.material.type.replace('Mesh', '').replace('Material', ''), !!o.material.transparent]); });
      top.sort((a, b) => b[3] - a[3]); return { top: top.slice(0, 18), pixelRatio: DPR.cur, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, objects, visible }; } };
})();


