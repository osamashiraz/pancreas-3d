window.HPGen = (() => {
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const PARAMS = {
  blockSizeUm: { value: 300, sourced: false },
  acinusRadiusUm: { value: [13, 19], sourced: false },
  acinarCellBaseUm: { value: 10, sourced: false },
  acinarLumenRadiusUm: { value: 1, sourced: false },
  intercalatedDuctOuterRadiusUm: { value: 5, sourced: false },
  intralobularDuctOuterRadiusUm: { value: 12, sourced: false },
  capillaryRadiusUm: { value: 3, sourced: false },
  capillaryReachUm: { value: 6, sourced: false },
  isletMeanDiameterUm: { value: 110, sourced: true, source: "Hahn et al. 2021, doi:10.1038/s42003-021-02589-x" },
  isletDiameterSpread: { value: 0.3, sourced: false, note: "lognormal sigma; islet sizes vary widely (Hahn 2021) but this spread is assumed" },
  isletComposition: { value: { beta: 117, alpha: 66, delta: 20, pp: 12 }, sourced: true, source: "HRA islet functional tissue unit (an average)" },
  isletCompositionConcentration: { value: 30, sourced: false, note: "how far an islet strays from the average; composition varies considerably between islets (Brissova 2005)" },
  isletShapeJitter: { value: 0.15, sourced: false, note: "islets drawn as ellipsoids, axes up to 15% from round" },
  isletCellDiameterUm: { value: 11, sourced: false }
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r2 = (x) => Math.round(x * 100) / 100;
const v2 = (a) => [r2(a[0]), r2(a[1]), r2(a[2])];
function random(seed) {
  let s = seed >>> 0;
  const u = () => {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
  const gamma = (k) => {
    if (k < 1) return gamma(k + 1) * Math.pow(u(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (; ; ) {
      let x, v;
      do {
        x = n();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const w = u();
      if (w < 1 - 0.0331 * x ** 4 || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  return { u, n, gamma, range: (a, b) => a + (b - a) * u(), int: (k) => Math.floor(u() * k), dir: () => norm([n(), n(), n()]) };
}
function quatFromZ(d, roll) {
  d = norm(d);
  let q;
  const ax = cross([0, 0, 1], d), s = len(ax), c = d[2];
  if (s < 1e-9) q = c > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
  else {
    const a = Math.atan2(s, c), k = Math.sin(a / 2) / s;
    q = [ax[0] * k, ax[1] * k, ax[2] * k, Math.cos(a / 2)];
  }
  const r = [d[0] * Math.sin(roll / 2), d[1] * Math.sin(roll / 2), d[2] * Math.sin(roll / 2), Math.cos(roll / 2)];
  const [x1, y1, z1, w1] = r, [x2, y2, z2, w2] = q;
  return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
}
function rotate(q, v) {
  const u = [q[0], q[1], q[2]], w = q[3];
  return add(v, mul(cross(u, add(cross(u, v), mul(v, w))), 2));
}
class Grid {
  constructor(size) {
    __publicField(this, "size", size);
    __publicField(this, "cells", /* @__PURE__ */ new Map());
    __publicField(this, "pts", []);
    __publicField(this, "rad", []);
  }
  key(i, j, k) {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }
  add(p, r = 0) {
    const id = this.pts.length;
    this.pts.push(p);
    this.rad.push(r);
    const k = this.key(Math.floor(p[0] / this.size), Math.floor(p[1] / this.size), Math.floor(p[2] / this.size));
    const l = this.cells.get(k);
    if (l) l.push(id);
    else this.cells.set(k, [id]);
    return id;
  }
  /** Calls f for every point within `reach` of p (roughly: whole grid cells). */
  near(p, reach, f) {
    const s = this.size, i0 = Math.floor((p[0] - reach) / s), i1 = Math.floor((p[0] + reach) / s), j0 = Math.floor((p[1] - reach) / s), j1 = Math.floor((p[1] + reach) / s), k0 = Math.floor((p[2] - reach) / s), k1 = Math.floor((p[2] + reach) / s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const l = this.cells.get(this.key(i, j, k));
      if (l) for (const id of l) f(id);
    }
  }
  /** The smallest distance from p to a point's surface (distance minus its radius) among points within `reach`. */
  clearance(p, reach) {
    let best = Infinity;
    this.near(p, reach, (id) => {
      const d = dist(p, this.pts[id]) - this.rad[id];
      if (d < best) best = d;
    });
    return best;
  }
  nearest(p, reach) {
    let best = Infinity, who = -1;
    this.near(p, reach, (id) => {
      const d = dist(p, this.pts[id]);
      if (d < best) {
        best = d;
        who = id;
      }
    });
    return { d: best, id: who };
  }
}
function catmull(points, per = 12) {
  const p = [sub(mul(points[0], 2), points[1]), ...points, sub(mul(points[points.length - 1], 2), points[points.length - 2])], out = [];
  for (let i = 1; i < p.length - 2; i++) for (let s = 0; s < per; s++) {
    const t = s / per, a = p[i - 1], b = p[i], c = p[i + 1], e = p[i + 2];
    out.push([0, 1, 2].map((k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - e[k]) * t * t + (-a[k] + 3 * b[k] - 3 * c[k] + e[k]) * t ** 3)));
  }
  out.push(points[points.length - 1]);
  return out;
}
const TYPES = ["beta", "alpha", "delta", "pp"];
function generateIslet(seed, diameterUm) {
  const R = random(seed), d = PARAMS.isletCellDiameterUm.value, base = PARAMS.isletComposition.value, conc = PARAMS.isletCompositionConcentration.value;
  const sigma = PARAMS.isletDiameterSpread.value, median = PARAMS.isletMeanDiameterUm.value / Math.exp(sigma * sigma / 2);
  const D = diameterUm ?? Math.min(220, Math.max(60, median * Math.exp(sigma * R.n())));
  const jit = PARAMS.isletShapeJitter.value, ax = [D / 2 * (1 + jit * (R.u() * 2 - 1)), D / 2 * (1 + jit * (R.u() * 2 - 1)), D / 2 * (1 + jit * (R.u() * 2 - 1))];
  const total = base.beta + base.alpha + base.delta + base.pp, g = TYPES.map((t) => R.gamma(conc * base[t] / total)), gs = g.reduce((a2, b) => a2 + b, 0);
  const comp = Object.fromEntries(TYPES.map((t, i) => [t, g[i] / gs]));
  const a = d * Math.SQRT2, n = Math.ceil(Math.max(...ax) / a) + 2, q = quatFromZ(R.dir(), R.u() * Math.PI * 2), cells = [];
  const basis = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of basis) {
    const p = add(rotate(q, [(i + b[0]) * a, (j + b[1]) * a, (k + b[2]) * a]), [R.n() * 0.08 * d, R.n() * 0.08 * d, R.n() * 0.08 * d]);
    if ((p[0] / (ax[0] - d / 2)) ** 2 + (p[1] / (ax[1] - d / 2)) ** 2 + (p[2] / (ax[2] - d / 2)) ** 2 <= 1) cells.push(p);
  }
  const rCap = PARAMS.capillaryRadiusUm.value, clear = rCap + 0.35 * d, reach = 1.5 * d, vessels = [], vg = new Grid(12);
  const distTo = (p) => {
    const r = vg.nearest(p, 2 * d);
    return r.d;
  };
  let left = cells;
  for (let it = 0; it < 80; it++) {
    const ds = left.map(distTo);
    if (vessels.length && ds.filter((x) => x <= reach).length / Math.max(left.length, 1) >= 0.95) break;
    const capped = ds.map((x) => isFinite(x) ? x : 1e9);
    const target = vessels.length ? left[capped.indexOf(Math.max(...capped))] : [0, 0, 0];
    const s0 = R.dir(), e0 = norm(add(mul(s0, -1), mul(R.dir(), 0.5))), m = Math.max(...ax) * 1.15, start = mul(s0, m), end = mul(e0, m);
    const mid1 = add(mul(add(start, target), 0.5), mul(R.dir(), m * 0.12 * Math.abs(R.n()))), mid2 = add(mul(add(target, end), 0.5), mul(R.dir(), m * 0.12 * Math.abs(R.n())));
    const v = catmull([start, mid1, target, mid2, end]);
    vessels.push(v);
    v.forEach((p) => vg.add(p));
    left = cells.filter((p) => distTo(p) > clear);
  }
  const counts = TYPES.map((t) => Math.round(left.length * comp[t]));
  counts[0] += left.length - counts.reduce((x, y) => x + y, 0);
  const types = [];
  TYPES.forEach((t, i) => {
    for (let k = 0; k < counts[i]; k++) types.push(t);
  });
  for (let i = types.length - 1; i > 0; i--) {
    const j = R.int(i + 1);
    [types[i], types[j]] = [types[j], types[i]];
  }
  return {
    seed,
    diameterUm: r2(D),
    semiAxesUm: v2(ax),
    composition: Object.fromEntries(TYPES.map((t) => [t, r2(counts[TYPES.indexOf(t)] / Math.max(left.length, 1))])),
    cells: left.map((p, i) => [types[i], r2(p[0]), r2(p[1]), r2(p[2])]),
    vessels
  };
}
function generateBlock(seed, region = "body") {
  const R = random(seed), half = PARAMS.blockSizeUm.value / 2, [Rmin, Rmax] = PARAMS.acinusRadiusUm.value;
  const rIc = PARAMS.intercalatedDuctOuterRadiusUm.value, rIl = PARAMS.intralobularDuctOuterRadiusUm.value, rCap = PARAMS.capillaryRadiusUm.value;
  const isl = generateIslet(seed * 7 + 3), isR = Math.max(...isl.semiAxesUm), isC = [R.range(-0.45, 0.45) * (half - isR), R.range(-0.45, 0.45) * (half - isR), R.range(-0.45, 0.45) * (half - isR)];
  const inIslet = (p, m) => dist(p, isC) < isR + m;
  const face = R.int(6), axis = face % 3, sign = face < 3 ? -1 : 1, root = [0, 0, 0];
  root[axis] = sign * half;
  root[(axis + 1) % 3] = R.range(-0.4, 0.4) * half;
  root[(axis + 2) % 3] = R.range(-0.4, 0.4) * half;
  const inward = [0, 0, 0];
  inward[axis] = -sign;
  let attract = [];
  for (let i = 0; i < 500; i++) {
    const p = [R.range(-0.92, 0.92) * half, R.range(-0.92, 0.92) * half, R.range(-0.92, 0.92) * half];
    if (!inIslet(p, 15)) attract.push(p);
  }
  const nodes = [root, add(root, mul(inward, 14))], parent = [-1, 0];
  for (let it = 0; it < 120 && attract.length; it++) {
    const ng = new Grid(40);
    nodes.forEach((p) => ng.add(p));
    const grow = /* @__PURE__ */ new Map();
    attract.forEach((p) => {
      const r = ng.nearest(p, 130);
      if (r.id >= 0 && r.d < 130) {
        const l = grow.get(r.id);
        if (l) l.push(p);
        else grow.set(r.id, [p]);
      }
    });
    if (!grow.size) break;
    grow.forEach((pts, id) => {
      const dir = norm(pts.reduce((s, q) => add(s, norm(sub(q, nodes[id]))), [0, 0, 0])), np = add(nodes[id], mul(dir, 16));
      if (inIslet(np, 14) || Math.max(...np.map(Math.abs)) > half - 6) return;
      nodes.push(np);
      parent.push(id);
    });
    const ng2 = new Grid(40);
    nodes.forEach((p) => ng2.add(p));
    attract = attract.filter((p) => ng2.nearest(p, 62).d > 62);
  }
  const load = nodes.map(() => 1);
  for (let i = nodes.length - 1; i > 0; i--) load[parent[i]] += load[i];
  const maxLoad = Math.max(...load), rMinIl = rIc + 1.5;
  const ducts = [];
  for (let i = 1; i < nodes.length; i++) ducts.push({ a: nodes[parent[i]], b: nodes[i], kind: "intralobular", r: rMinIl + (rIl - rMinIl) * Math.cbrt(load[i] / maxLoad) });
  const obs = new Grid(15), maxR = Math.max(Rmax, rIl), addCapsule = (a, b, r) => {
    const n = Math.max(2, Math.ceil(dist(a, b) / 3) + 1);
    for (let k = 0; k < n; k++) obs.add(add(a, mul(sub(b, a), k / (n - 1))), r);
  };
  ducts.forEach((d) => addCapsule(d.a, d.b, d.r));
  const clear = (a, b, r, margin, ignoreNear) => {
    const n = Math.max(2, Math.ceil(dist(a, b) / 3) + 1);
    for (let k = 0; k < n; k++) {
      const p = add(a, mul(sub(b, a), k / (n - 1)));
      if (Math.max(...p.map(Math.abs)) > half - r * 0.9 || inIslet(p, r + margin)) return false;
      let ok = true;
      obs.near(p, r + maxR + margin + 1, (id) => {
        if (!ok) return;
        const q = obs.pts[id], rr = obs.rad[id];
        if (ignoreNear && rr < Rmin - 0.01 && dist(q, ignoreNear) < r + rIl + 2) return;
        if (dist(p, q) - rr - r - margin < 0) ok = false;
      });
      if (!ok) return false;
    }
    return true;
  };
  let treePts = [];
  ducts.forEach((d) => [0.1, 0.3, 0.5, 0.7, 0.9].forEach((t) => treePts.push(add(d.a, mul(sub(d.b, d.a), t)))));
  const acini = [];
  const place = (start, dir, mouth, r, centre) => {
    addCapsule(start, mouth, rIc);
    obs.add(centre, r);
    ducts.push({ a: start, b: mouth, kind: "intercalated", r: rIc });
    acini.push({ centre, r: r2(r), q: quatFromZ(dir, R.u() * Math.PI * 2), cells: 0, ext: [] });
    [0.35, 0.7, 1].forEach((t) => treePts.push(add(start, mul(sub(mouth, start), t))));
  };
  for (let miss = 0; miss < 1500; ) {
    const start = treePts[R.int(treePts.length)], dir = norm([R.n(), R.n(), R.n()]), mouth = add(start, mul(dir, R.range(4, 28))), r = R.range(Rmin, Rmax), centre = add(mouth, mul(dir, r));
    if (!clear(add(start, mul(dir, rIc + 1)), mouth, rIc, 0.5, start) || !clear(centre, centre, r, 1.5, start)) {
      miss++;
      continue;
    }
    miss = 0;
    place(start, dir, mouth, r, centre);
  }
  for (let pass = 0; pass < 2; pass++) {
    const cand2 = [];
    for (let x = -half + Rmin; x <= half - Rmin; x += 7) for (let y = -half + Rmin; y <= half - Rmin; y += 7) for (let z = -half + Rmin; z <= half - Rmin; z += 7) {
      const p = [x, y, z];
      if (inIslet(p, Rmin + 1.5)) continue;
      const room = Math.min(Math.min(obs.clearance(p, 2 * maxR + 2), Rmax + 1.5) - 1.5, half - Math.max(...p.map(Math.abs)));
      if (room >= Rmin) cand2.push({ p, room });
    }
    cand2.sort((a, b) => b.room - a.room);
    let placed = 0;
    for (const c of cand2) {
      const r = Math.min(c.room, Rmax);
      if (!clear(c.p, c.p, r, 1.5)) continue;
      const near = treePts.map((t) => [dist(t, c.p), t]).filter(([d]) => d - r >= 4 && d - r <= 30).sort((a, b) => a[0] - b[0]).slice(0, 10);
      for (const [, start] of near) {
        const dir = norm(sub(c.p, start)), mouth = sub(c.p, mul(dir, r));
        if (!clear(add(start, mul(dir, rIc + 1)), mouth, rIc, 0.5, start)) continue;
        place(start, dir, mouth, r, c.p);
        placed++;
        break;
      }
    }
    if (!placed) break;
  }
  const cand = [];
  for (let i = 0; i < 4e4; i++) {
    const p = [R.range(-half + 3, half - 3), R.range(-half + 3, half - 3), R.range(-half + 3, half - 3)];
    const g = obs.clearance(p, maxR + rCap + 8);
    if (g > rCap + 0.8 && g < rCap + 7 && !inIslet(p, rCap + 2)) cand.push(p);
  }
  const nodesC = [], cg = new Grid(10);
  cand.forEach((p) => {
    if (cg.nearest(p, 9).d > 9) {
      cg.add(p);
      nodesC.push(p);
    }
  });
  const segClear = (a, b) => {
    const n = Math.max(2, Math.ceil(dist(a, b) / 2) + 1);
    for (let k = 0; k < n; k++) {
      const p = add(a, mul(sub(b, a), k / (n - 1)));
      if (obs.clearance(p, maxR + rCap + 2) < rCap + 0.5 || inIslet(p, rCap + 1)) return false;
    }
    return true;
  };
  const pairs = [];
  nodesC.forEach((p, i) => {
    const nb = [];
    cg.near(p, 24, (j) => {
      if (j !== i) nb.push([dist(p, nodesC[j]), j]);
    });
    nb.sort((a, b) => a[0] - b[0]).slice(0, 5).forEach(([d, j]) => {
      if (i < j && d < 24) pairs.push([i, j, d]);
    });
  });
  pairs.sort((a, b) => a[2] - b[2]);
  const comp = nodesC.map((_, i) => i), find = (x) => {
    while (comp[x] !== x) {
      comp[x] = comp[comp[x]];
      x = comp[x];
    }
    return x;
  };
  const tree = [], extra = [];
  for (const [i, j] of pairs) {
    if (!segClear(nodesC[i], nodesC[j])) continue;
    const a = find(i), b = find(j);
    if (a !== b) {
      comp[a] = b;
      tree.push([i, j]);
    } else extra.push([i, j]);
  }
  const edges = tree.concat(extra.slice(0, Math.floor(tree.length / 6)));
  const capG = new Grid(10);
  edges.forEach(([i, j]) => {
    for (let t = 0; t <= 1.0001; t += 0.25) capG.add(add(nodesC[i], mul(sub(nodesC[j], nodesC[i]), t)));
  });
  const served = acini.filter((a) => capG.nearest(a.centre, a.r + rCap + PARAMS.capillaryReachUm.value + 10).d - a.r - rCap <= PARAMS.capillaryReachUm.value).length / Math.max(acini.length, 1);
  const fibres = [];
  ducts.filter((d) => d.kind === "intralobular").forEach((d) => {
    const ax = norm(sub(d.b, d.a));
    if (dist(d.a, d.b) < 2) return;
    const u = norm(cross(ax, Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), w = cross(ax, u);
    for (let k = 0; k < 10; k++) {
      const th = 2 * Math.PI * k / 10 + R.u() * 0.3, off = mul(add(mul(u, Math.cos(th)), mul(w, Math.sin(th))), d.r + 1.2 + R.u() * 1.5);
      fibres.push({ a: v2(add(d.a, off)), b: v2(add(d.b, off)), r: 0.45, kind: "periductal" });
    }
  });
  const stellate = [];
  for (let i = 0, n = 0; i < cand.length && n < 900; i++) {
    const p = cand[i], dir = R.dir(), L = R.range(12, 26), a = sub(p, mul(dir, L / 2)), b = add(p, mul(dir, L / 2));
    if ([a, p, b].every((q) => obs.clearance(q, maxR + 2) > 0.6 && Math.max(...q.map(Math.abs)) < half)) {
      fibres.push({ a: v2(a), b: v2(b), r: 0.3, kind: "interstitial" });
      n++;
    }
  }
  for (let i = 0; i < cand.length && stellate.length < 140; i += 7) {
    const p = cand[i];
    if (inIslet(p, 4) || obs.clearance(p, maxR + 4) < 2.5 || stellate.some((s) => dist(s.c, p) < 20)) continue;
    stellate.push({ c: v2(p), q: quatFromZ(R.dir(), R.u() * Math.PI * 2) });
  }
  const acG = new Grid(40);
  acini.forEach((a) => acG.add(a.centre, a.r));
  const ductG = new Grid(15);
  ducts.forEach((d) => {
    const n = Math.max(2, Math.ceil(dist(d.a, d.b)) + 1);
    for (let k = 0; k < n; k++) ductG.add(add(d.a, mul(sub(d.b, d.a), k / (n - 1))), d.r);
  });
  const capS = new Grid(10);
  edges.forEach(([i, j]) => {
    const n = Math.max(2, Math.ceil(dist(nodesC[i], nodesC[j])) + 1);
    for (let k = 0; k < n; k++) capS.add(add(nodesC[i], mul(sub(nodesC[j], nodesC[i]), k / (n - 1))));
  });
  acini.forEach((a, idx) => {
    a.cells = Math.round(4 * Math.PI * a.r ** 2 / (Math.PI * (PARAMS.acinarCellBaseUm.value / 2) ** 2) * 0.82);
    a.ext = fibDirs(a.cells).map((d) => {
      const w = rotate(a.q, d);
      let last = a.r;
      for (let t = a.r; t <= 2 * a.r + 0.01; t += 0.6) {
        const p = add(a.centre, mul(w, t));
        let blocked = capS.nearest(p, rCap + 1).d < rCap + 0.6 || inIslet(p, 1) || Math.max(...p.map(Math.abs)) > half;
        if (!blocked) ductG.near(p, rIl + 1, (id) => {
          if (dist(p, ductG.pts[id]) < ductG.rad[id] + 0.5) blocked = true;
        });
        if (!blocked) {
          const own = dot(sub(p, a.centre), sub(p, a.centre)) - a.r * a.r;
          acG.near(p, 2 * Rmax + 4, (id) => {
            if (id !== idx && dist(p, acG.pts[id]) ** 2 - acG.rad[id] ** 2 < own) blocked = true;
          });
        }
        if (blocked) break;
        last = t;
      }
      return r2(Math.max(a.r, last - 0.5) >= a.r ? Math.max(a.r, last - 0.5) : a.r);
    });
  });
  let inside = 0;
  const probes = 2e4;
  for (let i = 0; i < probes; i++) {
    const p = [R.range(-half, half), R.range(-half, half), R.range(-half, half)];
    let who = -1, best = Infinity;
    acG.near(p, 2 * Rmax + 4, (id) => {
      const pw = dist(p, acG.pts[id]) ** 2 - acG.rad[id] ** 2;
      if (pw < best) {
        best = pw;
        who = id;
      }
    });
    if (who < 0) continue;
    const a = acini[who], v = sub(p, a.centre), dd = len(v);
    if (dd > 2 * a.r || dd < PARAMS.acinarLumenRadiusUm.value) continue;
    const q = a.q, local = rotate([-q[0], -q[1], -q[2], q[3]], mul(v, 1 / dd)), dirs = fibDirs(a.cells), n = Math.ceil(a.cells / 0.92);
    let k = 0, bd = -2;
    dirs.forEach((d, j) => {
      const c = dot(d, local);
      if (c > bd) {
        bd = c;
        k = j;
      }
    });
    if (bd > Math.cos(Math.acos(1 - 2 / n) * 1.15) && dd <= a.ext[k]) inside++;
  }
  const isletCells = isl.cells.map(([t, x, y, z]) => [t, r2(x + isC[0]), r2(y + isC[1]), r2(z + isC[2])]);
  const isletSegments = [];
  isl.vessels.forEach((v) => {
    for (let k = 0; k + 1 < v.length; k++) isletSegments.push([v2(add(v[k], isC)), v2(add(v[k + 1], isC))]);
  });
  return {
    schemaVersion: "humanbio.tissue-block.generated.v1",
    seed,
    region,
    generated: true,
    units: "micrometres",
    acini: acini.map((a) => ({ ...a, centre: v2(a.centre) })),
    ducts: ducts.map((d) => ({ ...d, a: v2(d.a), b: v2(d.b), r: r2(d.r) })),
    capillaries: { nodes: nodesC.map(v2), edges, isletSegments },
    stroma: { fibres, stellateCells: stellate },
    islet: { centreUm: v2(isC), radiusUm: r2(isR), cells: isletCells, model: { seed: isl.seed, diameterUm: isl.diameterUm, semiAxesUm: isl.semiAxesUm, composition: isl.composition } },
    result: { acini: acini.length, acinarCells: acini.reduce((s, a) => s + a.cells, 0), acinarVolumeFraction: r2(inside / probes), aciniWithinReachOfCapillary: r2(served), isletCells: isletCells.length }
  };
}
function fibDirs(nCells) {
  const n = Math.ceil(nCells / 0.92), ga = Math.PI * (3 - Math.sqrt(5)), out = [];
  for (let i = 0; i < n; i++) {
    const z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - z * z);
    out.push([Math.cos(i * ga) * r, Math.sin(i * ga) * r, z]);
  }
  return out.filter((d) => d[2] > -0.86).slice(0, nCells);
}
{
  PARAMS,
  fibDirs,
  generateBlock,
  generateIslet,
  random
};

return { generateBlock, generateIslet, fibDirs, PARAMS };
})();

