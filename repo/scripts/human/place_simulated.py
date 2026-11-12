#!/usr/bin/env python3
"""Place the simulated structures of the human pancreas module on landmarks of the HRA meshes.

Original integration code: MIT. The output is derived from CC BY 4.0 HRA geometry and keeps that licence.

Reads   data/human-pancreas-inventory.json          (from scripts/human/export_inventory.ts)
        public/atlas-human/pancreas-region-<sex>.glb (checked against pancreas-region.manifest.json)
Writes  public/atlas-human/pancreas-simulated-<sex>.glb
        public/atlas-human/pancreas-simulated.manifest.json

Only structures whose inventory status is 'ready' and whose plan is a route are built. Every landmark
they use must be defined in LANDMARKS below, with a rule in words that goes into the manifest beside the
point it resolved to. A landmark the table does not define stops the build; nothing is guessed.

The output is deterministic: the same inputs give the same bytes.

Needs numpy and scipy.
"""
import hashlib, json, struct, sys
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT / 'public' / 'atlas-human'
# Directions in the HRA frame. Read from the meshes (the tail lies at +x; glTF is +y up), not stated by HRA.
AXES = {'left': [1, 0, 0], 'superior': [0, 1, 0], 'anterior': [0, 0, 1], 'status': 'inferred from the meshes, not stated by the source'}
SIDES = 12            # facets round each tube
SAMPLE_MM = 0.5       # spacing of centreline samples
CLEARANCE_MM = 0.6    # gap kept between a tube's wall and the surface it follows
VOXEL_MM = 0.75          # grid spacing for routing
MARGIN_MM = 14.0         # how far the routing grid reaches beyond the two points of a leg
FOLLOW_WEIGHT = 3.0      # how strongly a route prefers lying `radius + clearance` off the surface it follows
FAR_COST = 4.0           # the most that being off that distance can cost per mm, so a route may cross open space
EXEMPT_MM = 5.0          # a branch leaving a parent vessel may pass its neighbours within this distance of its origin
SMOOTH_ROUNDS = 8
GDA_DROP_MM = 25.0
NODE_GAP_MM = 0.5        # gap kept between a lymph node and anything else
ROUTE_RADIUS = 1.0       # radius used for a simulated arcade when placing nodes beside it       # typical length of the gastroduodenal artery, 2 to 3 cm (Gray's Anatomy)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------- reading the region file

def read_glb(data: bytes) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    json_len = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    binary = data[28 + json_len:]
    width = {'SCALAR': 1, 'VEC3': 3}
    kind = {5126: '<f4', 5125: '<u4', 5123: '<u2'}

    def accessor(i: int) -> np.ndarray:
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        n = width[a['type']]
        arr = np.frombuffer(binary, dtype=kind[a['componentType']], count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
        return arr.reshape(-1, n) if n > 1 else arr

    meshes = {}
    for node in doc['nodes']:
        if 'mesh' not in node:
            continue
        prim = doc['meshes'][node['mesh']]['primitives'][0]
        meshes[node['name']] = (accessor(prim['attributes']['POSITION']).astype(np.float64) * 1000.0,
                                accessor(prim['indices']).astype(np.int64).reshape(-1, 3))
    return meshes


class Body:
    """The ready source structures of one reference, in millimetres, by structure id and by node."""

    def __init__(self, sex: str, inventory: list[dict], region: dict):
        self.sex = sex
        self.nodes = region
        self.structures: dict[str, np.ndarray] = {}
        self.structure_nodes: dict[str, list[str]] = {}
        for s in inventory:
            if s['status'] == 'ready' and s['plan']['kind'] == 'reference-node':
                key = s['id'].split(':', 1)[1]
                self.structures[key] = np.vstack([region[n][0] for n in s['plan']['nodes']])
                self.structure_nodes[key] = list(s['plan']['nodes'])
        self.trees = {k: cKDTree(v) for k, v in self.structures.items()}
        self.routes: dict[str, np.ndarray] = {}   # built centrelines, by '<structure>/<branch>' and by '<structure>'
        self._normals: dict[tuple[str, str], np.ndarray] = {}

    def normals(self, key: str, rule: str) -> np.ndarray:
        if (key, rule) not in self._normals:
            v = self.structures[key]
            self._normals[(key, rule)] = outward_normals(v, rule, v.mean(0))
        return self._normals[(key, rule)]

    def node(self, suffix: str) -> np.ndarray:
        """A node by its name without the VH_M_/VH_F_ prefix; both spellings of a misspelt node may be given."""
        for name, (v, _) in self.nodes.items():
            if name[5:] in suffix.split('|'):
                return v
        raise KeyError(f'{self.sex}: no node {suffix}')


# --------------------------------------------------------------------------- landmark rules

def junction(body: Body, a: str, b: str, tol: float = 3.0) -> np.ndarray:
    va = body.structures[a]
    d, _ = body.trees[b].query(va)
    near = va[d < tol]
    if not len(near):
        raise ValueError(f'{a} does not meet {b} within {tol} mm')
    return near.mean(0)


def groove(body: Body, side: str, level: str) -> np.ndarray:
    head = body.structures['pancreas-head']
    loop = np.vstack([body.node('duodenum_descending'), body.node('duodenum_horizonal|duodenum_horizontal')])
    d, _ = cKDTree(loop).query(head)
    band = head[(d > 3) & (d < 12)]
    y = np.quantile(band[:, 1], {'upper': 0.85, 'middle': 0.5, 'lower': 0.15}[level])
    cand = band[np.abs(band[:, 1] - y) < 2.5]
    return cand[cand[:, 2].argmax()] if side == 'anterior' else cand[cand[:, 2].argmin()]


def gda_division(body: Body) -> np.ndarray:
    origin = junction(body, 'common-hepatic-artery', 'proper-hepatic-artery')
    tissue = np.vstack([body.structures['pancreas-head'], body.structures['pancreas-neck']])
    for window in (15.0, 20.0, 30.0):
        band = tissue[(np.abs(tissue[:, 1] - (origin[1] - GDA_DROP_MM)) < 2.0) & (np.abs(tissue[:, 0] - origin[0]) < window)]
        if len(band):
            return band[band[:, 2].argmax()]
    raise ValueError('no head or neck surface 25 mm below the gastroduodenal origin')


def uncinate_inferior(body: Body) -> np.ndarray:
    u = body.structures['pancreas-uncinate']
    return u[u[:, 1].argmin()]


def section(body: Body, structure: str, y: float, half: float = 1.5) -> np.ndarray:
    v = body.structures[structure]
    ring = v[np.abs(v[:, 1] - y) < half]
    if len(ring) < 6:
        raise ValueError(f'{structure} has no cross-section at y = {y:.1f} mm')
    # Keep the largest cluster, so a branch at the same level does not pull the centre aside.
    tree = cKDTree(ring)
    labels = -np.ones(len(ring), int)
    for i in range(len(ring)):
        if labels[i] >= 0:
            continue
        stack, labels[i] = [i], i
        while stack:
            for j in tree.query_ball_point(ring[stack.pop()], 3.0):
                if labels[j] < 0:
                    labels[j] = i
                    stack.append(j)
    big = np.bincount(labels).argmax()
    return ring[labels == big].mean(0)


def axis_near(body: Body, structure: str, target: np.ndarray, reach: float = 6.0) -> np.ndarray:
    """A point near the axis of a drawn vessel, beside `target`: the centre of its vertices within `reach` mm
    of its vertex nearest the target. For a vessel of 2 to 3 mm radius this takes in most of the ring round it."""
    v = body.structures[structure]
    near = v[body.trees[structure].query(target)[1]]
    return v[np.linalg.norm(v - near, axis=1) < reach].mean(0)


def sphere_section(body: Body, structure: str, centre: np.ndarray, radius: float) -> np.ndarray:
    """Centre of the largest cluster of a vessel's vertices lying `radius` mm (within 1.2 mm) from `centre`."""
    v = body.structures[structure]
    ring = v[np.abs(np.linalg.norm(v - centre, axis=1) - radius) < 1.2]
    if len(ring) < 6:
        raise ValueError(f'{structure} does not reach {radius} mm from {centre.round(1)}')
    tree = cKDTree(ring)
    labels = -np.ones(len(ring), int)
    for i in range(len(ring)):
        if labels[i] >= 0:
            continue
        stack, labels[i] = [i], i
        while stack:
            for j in tree.query_ball_point(ring[stack.pop()], 3.0):
                if labels[j] < 0:
                    labels[j] = i
                    stack.append(j)
    return ring[labels == np.bincount(labels).argmax()].mean(0)


def slab(body: Body, structure: str, fraction: float, half: float = 2.0) -> np.ndarray:
    """Vertices of an organ within `half` mm of the given fraction of its extent from right (0) to left (1)."""
    v = body.structures[structure]
    x = v[:, 0].min() + fraction * np.ptp(v[:, 0])
    return v[np.abs(v[:, 0] - x) < half]


def lower_border_back(v: np.ndarray) -> np.ndarray:
    """Of a slab of an organ, the most posterior vertex within its lowest quarter of height: the lower border at the back."""
    low = v[v[:, 1] < v[:, 1].min() + np.ptp(v[:, 1]) / 4]
    return low[low[:, 2].argmin()]


def posterior_mid_height(v: np.ndarray) -> np.ndarray:
    """Of a slab of an organ, the most posterior vertex within 2 mm of the slab's middle height."""
    mid = (v[:, 1].min() + v[:, 1].max()) / 2
    band = v[np.abs(v[:, 1] - mid) < 2.0]
    return band[band[:, 2].argmin()]


def neck_posterior_inferior(body: Body) -> np.ndarray:
    v = body.structures['pancreas-neck']
    low = v[v[:, 1] < v[:, 1].min() + np.ptp(v[:, 1]) / 3]
    return low[low[:, 2].argmin()]


def along(body: Body, route: str, fraction: float) -> np.ndarray:
    c = body.routes[route]
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]
    return c[np.searchsorted(s, fraction * s[-1])]


# name -> (where it lies, rule in words, function). 'vessel' and 'route' points are kept exact so a tube
# starts inside its parent; 'surface' points are lifted off the surface they lie on by the radius of the first
# route that uses them, and pushed clear of other structures. The manifest records both the rule's point and the placed point.
LANDMARKS = {
    'common-hepatic-artery:gastroduodenal-origin': ('vessel',
        'Centre of the vertices of the common hepatic artery that lie within 3 mm of the proper hepatic artery: where the gastroduodenal artery leaves.',
        lambda b: junction(b, 'common-hepatic-artery', 'proper-hepatic-artery')),
    'pancreas-head:gastroduodenal-division': ('surface',
        'The most anterior vertex of the head or neck 25 mm (within 2 mm) below the gastroduodenal origin and within 15 mm of it from side to side, '
        'widening to 30 mm if none. The artery is typically 2 to 3 cm long and divides on the front of the head.',
        gda_division),
    **{f'pancreas-head:{side}-groove-{level}': ('surface',
        f'Head vertices 3 to 12 mm from the descending and horizontal duodenum, within 2.5 mm of the {dict(upper="85th", middle="50th", lower="15th")[level]} '
        f'percentile of their height; the most {side} of them. The arcades run about 1 cm inside the curve of the duodenum.',
        (lambda side, level: lambda b: groove(b, side, level))(side, level))
       for side in ('anterior', 'posterior') for level in ('upper', 'middle', 'lower')},
    'pancreas-uncinate:inferior': ('surface', 'The lowest vertex of the uncinate process.', uncinate_inferior),
    'superior-mesenteric-artery:inferior-pancreaticoduodenal-origin': ('vessel',
        'Centre of the largest cluster of superior mesenteric artery vertices within 1.5 mm of the height 5 mm above the lowest point of the uncinate process.',
        lambda b: section(b, 'superior-mesenteric-artery', uncinate_inferior(b)[1] + 5.0)),
    # The branches of the splenic artery.
    'splenic-artery:dorsal-pancreatic-origin': ('vessel',
        'Centre of the splenic artery where it crosses a sphere of 12 mm radius round its junction with the coeliac trunk '
        '(splenic artery vertices within 3 mm of the trunk). The dorsal pancreatic artery usually leaves the first part of the splenic artery.',
        lambda b: sphere_section(b, 'splenic-artery', junction(b, 'splenic-artery', 'coeliac-trunk'), 12.0)),
    'pancreas-neck:posterior-inferior': ('surface',
        'Of the lowest third of the neck, the most posterior vertex. The dorsal pancreatic artery descends behind the neck.',
        neck_posterior_inferior),
    'pancreas-body:inferior-border-middle': ('surface',
        'At the middle of the body from right to left (within 2 mm), the most posterior vertex in the lowest quarter of its height: '
        'the lower border at the back, where the transverse pancreatic artery runs.',
        lambda b: lower_border_back(slab(b, 'pancreas-body', 0.5))),
    'pancreas-tail:inferior-border-start': ('surface',
        'At a quarter of the tail from right to left (within 2 mm), the most posterior vertex in the lowest quarter of its height.',
        lambda b: lower_border_back(slab(b, 'pancreas-tail', 0.25))),
    'pancreas-body:posterior-middle': ('surface',
        'At the middle of the body from right to left, the most posterior vertex within 2 mm of the middle of its height. '
        'The great pancreatic artery enters the back of the body.',
        lambda b: posterior_mid_height(slab(b, 'pancreas-body', 0.5))),
    'splenic-artery:great-pancreatic-origin': ('vessel',
        'Near the axis of the splenic artery beside its point nearest the landmark "pancreas-body:posterior-middle": '
        'the centre of its vertices within 6 mm of that point.',
        lambda b: axis_near(b, 'splenic-artery', posterior_mid_height(slab(b, 'pancreas-body', 0.5)))),
    **{f'pancreas-tail:posterior-{k}': ('surface',
        f'At {pct} of the tail from right to left, the most posterior vertex within 2 mm of the middle of its height.',
        (lambda f: lambda b: posterior_mid_height(slab(b, 'pancreas-tail', f)))(f))
       for k, f, pct in ((1, 0.35, '35%'), (2, 0.7, '70%'))},
    **{f'splenic-artery:caudal-origin-{k}': ('vessel',
        f'Near the axis of the splenic artery beside its point nearest the landmark "pancreas-tail:posterior-{k}": the centre of its vertices within 6 mm of that point.',
        (lambda f: lambda b: axis_near(b, 'splenic-artery', posterior_mid_height(slab(b, 'pancreas-tail', f))))(f))
       for k, f in ((1, 0.35), (2, 0.7))},
    'gastroduodenal-artery:upper-third': ('route', 'One third of the way along the built gastroduodenal artery, from its origin.',
        lambda b: along(b, 'gastroduodenal-artery', 1 / 3)),
}


# --------------------------------------------------------------------------- routing

def outward_normals(v: np.ndarray, centre_rule: str, centre: np.ndarray | None = None) -> np.ndarray:
    """Unit normals of a vertex cloud from its 24 nearest neighbours, turned outward:
    away from `centre` for an organ, or away from the local middle (40 neighbours) for a tube such as a vessel."""
    tree = cKDTree(v)
    _, nbr = tree.query(v, 24)
    local = v[nbr] - v[nbr].mean(1, keepdims=True)
    _, vecs = np.linalg.eigh(np.einsum('nki,nkj->nij', local, local))
    n = vecs[:, :, 0]
    if centre_rule == 'organ':
        ref = v - centre
    else:
        _, wide = tree.query(v, 40)
        ref = v - v[wide].mean(1)
    n *= np.where(np.sum(n * ref, axis=1) < 0, -1.0, 1.0)[:, None]
    return n


class Field:
    """Distances and inside/outside for the surfaces a route follows and the structures it must not enter."""

    def __init__(self, body: Body, hug: list[str], avoid: list[str]):
        self.hug_v = np.vstack([body.structures[k] for k in hug])
        self.hug_n = np.vstack([body.normals(k, 'organ') for k in hug])
        self.hug_tree = cKDTree(self.hug_v)
        self.avoid = {}
        for k in avoid:
            v = body.structures[k]
            self.avoid[k] = (v, body.normals(k, 'organ' if k.startswith('pancreas') or k == 'spleen' else 'tube'), body.trees[k])

    @staticmethod
    def _signed(p, v, n, tree):
        d, i = tree.query(p)
        side = np.sum((p - v[i]) * n[i], axis=1)
        return d, side

    def hug_distance(self, p):
        d, side = self._signed(p, self.hug_v, self.hug_n, self.hug_tree)
        return d, side < -0.2  # inside the followed organ

    def blocked(self, p, gap, exempt: list[str]):
        out = np.zeros(len(p), bool)
        for k, (v, n, tree) in self.avoid.items():
            if k in exempt:
                continue
            d, side = self._signed(p, v, n, tree)
            out |= (d < gap) | ((side < -0.2) & (d < 15))
        return out


def grid_path(a: np.ndarray, b: np.ndarray, field: Field, gap: float, exempt_near_a: list[str], exempt_radius: float) -> np.ndarray:
    """Cheapest path from a to b through free grid cells, preferring cells `gap` mm off the followed surface."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    lo = np.minimum(a, b) - MARGIN_MM
    hi = np.maximum(a, b) + MARGIN_MM
    shape = np.ceil((hi - lo) / VOXEL_MM).astype(int) + 1
    idx = np.indices(shape).reshape(3, -1).T
    pts = lo + idx * VOXEL_MM
    dh, inside = field.hug_distance(pts)
    blocked = field.blocked(pts, gap, [])
    near_a = np.linalg.norm(pts - a, axis=1) < exempt_radius
    if exempt_near_a:  # leaving a parent vessel: it and its neighbours at the junction do not block the first mm
        blocked[near_a] = False
    blocked |= inside & ~near_a
    blocked[np.linalg.norm(pts - b, axis=1) < VOXEL_MM * 1.5] = False
    cost = 1 + np.minimum(FOLLOW_WEIGHT * ((dh - gap) / gap) ** 2, FAR_COST)
    free = ~blocked
    number = -np.ones(len(pts), int); number[free] = np.arange(free.sum())
    grid = number.reshape(shape)
    rows, cols, wts = [], [], []
    for off in [o for o in np.ndindex(3, 3, 3) if o != (1, 1, 1)]:
        o = np.array(off) - 1
        sl_a = tuple(slice(max(0, -k), s - max(0, k)) for k, s in zip(o, shape))
        sl_b = tuple(slice(max(0, k), s - max(0, -k)) for k, s in zip(o, shape))
        u, w = grid[sl_a].ravel(), grid[sl_b].ravel()
        ok = (u >= 0) & (w >= 0)
        u, w = u[ok], w[ok]
        length = VOXEL_MM * np.linalg.norm(o)
        cu, cw = cost[free][u], cost[free][w]
        rows.append(u); cols.append(w); wts.append(length * (cu + cw) / 2)
    g = coo_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))), shape=(free.sum(),) * 2).tocsr()
    free_pts = pts[free]
    tree = cKDTree(free_pts)
    src, dst = tree.query(a)[1], tree.query(b)[1]
    dist, pred = dijkstra(g, indices=src, return_predecessors=True)
    if not np.isfinite(dist[dst]):
        raise SystemExit(f'No free path from {a.round(1)} to {b.round(1)}')
    path, k = [], dst
    while k != src:
        path.append(free_pts[k]); k = pred[k]
    path.append(free_pts[src])
    return np.vstack([a, np.array(path[::-1])[1:-1], b])


def catmull_rom(points: np.ndarray, step: float) -> np.ndarray:
    """Centripetal Catmull-Rom through the points, sampled about every `step` mm."""
    p = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = [points[0]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** 0.5
        n = max(2, int(np.ceil(np.linalg.norm(p2 - p1) / step)))
        for t in np.linspace(t1, t2, n + 1)[1:]:
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    return np.array(out)


def route(points: list[np.ndarray], kinds: list[str], field: Field, radius: tuple[float, float], parent: str | None) -> np.ndarray:
    gap = max(radius) + CLEARANCE_MM
    legs = []
    for i, (a, b) in enumerate(zip(points[:-1], points[1:])):
        leaving_parent = i == 0 and kinds[0] in ('vessel', 'route')
        legs.append(grid_path(a, b, field, gap, list(field.avoid) if leaving_parent else [], EXEMPT_MM if leaving_parent else 0.0))
    path = np.vstack([legs[0]] + [leg[1:] for leg in legs[1:]])
    # Smooth the grid steps away (ends fixed), then a smooth curve sampled every SAMPLE_MM.
    for _ in range(SMOOTH_ROUNDS):
        path[1:-1] = 0.5 * path[1:-1] + 0.25 * (path[:-2] + path[2:])
    keep = np.r_[0, np.arange(2, len(path) - 2, 3), len(path) - 1]
    return catmull_rom(path[keep], SAMPLE_MM)


def place_free(p: np.ndarray, field: Field, gap: float) -> np.ndarray:
    offsets = np.indices((25, 25, 25)).reshape(3, -1).T - 12
    pts = p + offsets * 0.5
    dh, inside = field.hug_distance(pts)
    ok = ~inside & ~field.blocked(pts, gap + 0.3, [])
    if not ok.any():
        raise SystemExit(f'No free place within 6 mm of {p.round(1)}')
    score = np.abs(dh - gap) + 0.2 * np.linalg.norm(pts - p, axis=1)
    score[~ok] = np.inf
    return pts[score.argmin()]


def shape_checks(c: np.ndarray) -> dict:
    step = np.linalg.norm(np.diff(c, axis=0), axis=1)
    t = np.diff(c, axis=0) / np.maximum(step, 1e-9)[:, None]
    turn = np.degrees(np.arccos(np.clip(np.sum(t[1:] * t[:-1], axis=1), -1, 1)))
    return {'maxStepMm': round(float(step.max()), 2), 'maxTurnDeg': round(float(turn.max()), 1)}


def tube(centre: np.ndarray, radius: tuple[float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = len(centre)
    tangent = np.gradient(centre, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    ref = np.array([0.0, 0.0, 1.0]) if abs(tangent[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(tangent[0], ref); u /= np.linalg.norm(u)
    frames = []
    for i in range(n):  # parallel transport, so the tube does not twist
        if i:
            u = u - np.dot(u, tangent[i]) * tangent[i]
            u /= np.linalg.norm(u)
        frames.append((u, np.cross(tangent[i], u)))
    t = np.linspace(0, 1, n)
    r = radius[0] + (radius[1] - radius[0]) * t
    ang = np.linspace(0, 2 * np.pi, SIDES, endpoint=False)
    pos, nor = [], []
    for i in range(n):
        uu, vv = frames[i]
        dirs = np.cos(ang)[:, None] * uu + np.sin(ang)[:, None] * vv
        pos.append(centre[i] + dirs * r[i]); nor.append(dirs)
    pos, nor = np.vstack(pos), np.vstack(nor)
    faces = []
    for i in range(n - 1):
        for k in range(SIDES):
            a, b = i * SIDES + k, i * SIDES + (k + 1) % SIDES
            c, d = a + SIDES, b + SIDES
            faces += [[a, c, b], [b, c, d]]
    # Caps, so the ends are closed.
    for end, sign in ((0, -1), (n - 1, 1)):
        centre_index = len(pos)
        pos = np.vstack([pos, centre[end]]); nor = np.vstack([nor, sign * tangent[end]])
        base = end * SIDES
        for k in range(SIDES):
            a, b = base + k, base + (k + 1) % SIDES
            faces.append([centre_index, b, a] if sign < 0 else [centre_index, a, b])
    return pos, nor, np.array(faces, dtype=np.uint32)



# --------------------------------------------------------------------------- lymph nodes

class Clearance:
    """Everything a lymph node must not touch: drawn structures (outside and gap), built vessels, and nodes already placed."""

    def __init__(self, body: Body):
        self.body = body
        self.drawn = [(k, body.structures[k], body.normals(k, 'organ' if k.startswith('pancreas') or k == 'spleen' else 'tube'), body.trees[k])
                      for k in body.structures]
        self.tubes: list[tuple[cKDTree, float]] = []
        self.spheres: list[tuple[np.ndarray, float]] = []

    def add_tube(self, centre: np.ndarray, radius: float) -> None:
        self.tubes.append((cKDTree(centre), radius))

    def worst(self, pts: np.ndarray) -> float:
        """The smallest clearance of any of the points: negative when inside or overlapping something."""
        worst = np.inf
        for _, v, n, tree in self.drawn:
            d, i = tree.query(pts)
            side = np.sum((pts - v[i]) * n[i], axis=1)
            worst = min(worst, float(np.min(np.where((side < -0.2) & (d < 15), -d, d))))
        for tree, r in self.tubes:
            worst = min(worst, float(np.min(tree.query(pts)[0] - r)))
        for c, r in self.spheres:
            worst = min(worst, float(np.min(np.linalg.norm(pts - c, axis=1) - r)))
        return worst


def ellipsoid(centre: np.ndarray, axis: np.ndarray, short: float, long: float, rings: int = 10, sectors: int = 16):
    axis = axis / np.linalg.norm(axis)
    ref = np.array([1.0, 0, 0]) if abs(axis[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(axis, ref); u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    pos, nor = [], []
    for i in range(rings + 1):
        th = np.pi * i / rings
        for j in range(sectors):
            ph = 2 * np.pi * j / sectors
            d = np.cos(th) * axis + np.sin(th) * (np.cos(ph) * u + np.sin(ph) * w)
            local = np.array([np.cos(th) * long, np.sin(th) * np.cos(ph) * short, np.sin(th) * np.sin(ph) * short])
            pos.append(centre + local[0] * axis + local[1] * u + local[2] * w)
            g = np.array([np.cos(th) / long, np.sin(th) * np.cos(ph) / short, np.sin(th) * np.sin(ph) / short])
            nn = g[0] * axis + g[1] * u + g[2] * w
            nor.append(nn / np.linalg.norm(nn))
    faces = []
    for i in range(rings):
        for j in range(sectors):
            a, b = i * sectors + j, i * sectors + (j + 1) % sectors
            faces += [[a, a + sectors, b], [b, a + sectors, b + sectors]]
    return np.array(pos), np.array(nor), np.array(faces, dtype=np.uint32)


def sphere_samples(n: int = 60) -> np.ndarray:
    k = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * k / n)
    th = np.pi * (1 + 5 ** 0.5) * k
    return np.c_[np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)]


SPHERE = sphere_samples()


def place_node(anchor: np.ndarray, tangent: np.ndarray, prefer: np.ndarray, base: float, clearance: Clearance,
               short: float, long: float) -> tuple[np.ndarray, float, float]:
    """The first free spot beside `anchor`, trying the preferred side first, then turning round the vessel and moving out."""
    t = tangent / np.linalg.norm(tangent)
    d0 = prefer - np.dot(prefer, t) * t
    d0 = d0 / np.linalg.norm(d0) if np.linalg.norm(d0) > 1e-6 else np.cross(t, [0, 0, 1.0]) / np.linalg.norm(np.cross(t, [0, 0, 1.0]))
    tried = []
    for extra in (0.0, 1.0, 2.0, 3.5, 5.0, 7.0, 9.0):
        for angle in (0, 25, -25, 50, -50, 75, -75, 105, -105, 140, -140, 180):
            a = np.radians(angle)
            d = d0 * np.cos(a) + np.cross(t, d0) * np.sin(a)
            for shift in (0.0, 3.0, -3.0):
                c = anchor + d * (base + short + NODE_GAP_MM + extra) + t * shift
                pts = c + SPHERE * long  # the long semi-axis all round: a conservative test
                tried.append(1)
                gap = clearance.worst(np.vstack([c, pts]))
                if gap >= NODE_GAP_MM:
                    return c, float(np.degrees(a)), extra
    return None


def vessel_radius(body: Body, structure: str, at: np.ndarray) -> float:
    v = body.structures[structure]
    d = np.linalg.norm(v - at, axis=1)
    return float(np.percentile(d[d < 8.0], 20)) if (d < 8.0).sum() >= 10 else 2.0


def unit(v) -> np.ndarray:
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def route_candidates(body: Body, key: str, nominal: float) -> list:
    """Points along a built route, from the nominal fraction of its length outward in steps of 5%, between 10% and 95%."""
    out = []
    for step in range(0, 18):
        for sign in ((1,) if step == 0 else (-1, 1)):
            f = nominal + sign * 0.05 * step
            if 0.1 <= f <= 0.95:
                out.append((*route_anchor(body, key, f), ROUTE_RADIUS, round(f, 2)))
    return out


def route_anchor(body: Body, key: str, fraction: float) -> tuple[np.ndarray, np.ndarray]:
    c = body.routes[key]
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]
    i = int(np.clip(np.searchsorted(s, fraction * s[-1]), 1, len(c) - 2))
    return c[i], c[i + 1] - c[i - 1]


def away_from_head(body: Body, p: np.ndarray) -> np.ndarray:
    head = body.structures['pancreas-head']
    return unit(p - head[body.trees['pancreas-head'].query(p)[1]])


def outward(nominal: float, step: float, lo: float, hi: float, count: int = 12) -> list[float]:
    """The nominal value, then values stepping outward on both sides, kept within [lo, hi]."""
    vals = [nominal]
    for k in range(1, count):
        vals += [v for v in (nominal - k * step, nominal + k * step) if lo <= v <= hi]
    return vals


def cha_anchors(body: Body, fractions) -> list:
    start = junction(body, 'common-hepatic-artery', 'coeliac-trunk')
    end = junction(body, 'common-hepatic-artery', 'proper-hepatic-artery')
    out = []
    for nominal in fractions:
        cands = []
        for f in outward(nominal, 0.05, 0.1, 0.9):
            a = axis_near(body, 'common-hepatic-artery', start + f * (end - start))
            cands.append((a, end - start, vessel_radius(body, 'common-hepatic-artery', a), round(f, 2)))
        out.append(cands)
    return out


def sma_anchors(body: Body, count: int) -> list:
    top = body.structures['superior-mesenteric-artery'][:, 1].max() - 4.0
    bottom = LANDMARKS['superior-mesenteric-artery:inferior-pancreaticoduodenal-origin'][2](body)[1]
    out = []
    for nominal in np.linspace(0.15, 0.85, count):
        cands = []
        for f in outward(nominal, 0.07, 0.0, 1.0):
            y = top + f * (bottom - top)
            a = section(body, 'superior-mesenteric-artery', y)
            nxt = section(body, 'superior-mesenteric-artery', y - 3.0)
            cands.append((a, a - nxt, vessel_radius(body, 'superior-mesenteric-artery', a), round(f, 2)))
        out.append(cands)
    return out


def splenic_anchors(body: Body, which: str, count: int) -> list:
    origin = junction(body, 'splenic-artery', 'coeliac-trunk')
    out = []
    if which == 'proximal':
        for nominal in np.linspace(20.0, 32.0, count):
            cands = []
            for r in outward(nominal, 3.0, 15.0, 50.0):
                a = sphere_section(body, 'splenic-artery', origin, r)
                b = sphere_section(body, 'splenic-artery', origin, r + 3.0)
                cands.append((a, b - a, vessel_radius(body, 'splenic-artery', a), round(r, 1)))
            out.append(cands)
    else:
        for nominal in np.linspace(0.3, 0.6, count):
            cands = []
            for f in outward(nominal, 0.05, 0.15, 0.85):
                band = slab(body, 'pancreas-tail', f)
                top = band[band[:, 1].argmax()]
                a = axis_near(body, 'splenic-artery', top)
                b = axis_near(body, 'splenic-artery', top + np.array([4.0, 0, 0]))
                cands.append((a, b - a + np.array([1e-3, 0, 0]), vessel_radius(body, 'splenic-artery', a), round(f, 2)))
            out.append(cands)
    return out


def hilum_anchors(body: Body, count: int) -> list:
    hilum = body.node('hilum_of_spleen')
    centre = hilum.mean(0)
    out = []
    for k, vessel in enumerate(('splenic-artery', 'splenic-vein')[:count]):
        a = axis_near(body, vessel, centre)
        out.append((a, unit(centre - a) + np.array([0, 1e-3, 0]), vessel_radius(body, vessel, a)))
    return out


# station -> (rule in words, anchors(body, count), preferred side(body, point) -> direction). anchors gives, for each node,
# either one (point, tangent, radius of what it lies beside) or a list of such candidates (with a fraction) tried in order.
STATIONS = {
    '8a': ('Beside the common hepatic artery on its anterosuperior side, at the points nearest a quarter, a half and three quarters of the way '
           'from the coeliac trunk to the gastroduodenal origin where a node fits.',
           lambda b, n: cha_anchors(b, np.linspace(0.25, 0.75, n)), lambda b, p: unit([0, 1, 1])),
    '8p': ('Behind the common hepatic artery, at the point nearest halfway from the coeliac trunk to the gastroduodenal origin where a node fits.',
           lambda b, n: cha_anchors(b, [0.5] if n == 1 else np.linspace(0.3, 0.7, n)), lambda b, p: unit([0, 0, -1])),
    '14': ('Beside the superior mesenteric artery, on its right side first, at the heights nearest 15%, 50% and 85% of the way from 4 mm below '
           'its highest point to the inferior pancreaticoduodenal origin where a node fits.',
           sma_anchors, lambda b, p: unit([-1, 0, 0.3])),
    '11p': ('Above the splenic artery, where it crosses the spheres nearest 20 and 32 mm radius round its junction with the coeliac trunk at which a node fits.',
            lambda b, n: splenic_anchors(b, 'proximal', n), lambda b, p: unit([0, 1, 0])),
    '11d': ('Above the splenic artery, beside the top of the tail at the points nearest 30% and 60% of its length from right to left where a node fits.',
            lambda b, n: splenic_anchors(b, 'distal', n), lambda b, p: unit([0, 1, 0])),
    '10': ('Beside the splenic artery and the splenic vein, at their points nearest the middle of the hilum of the spleen, on the side away from the spleen.',
           hilum_anchors, lambda b, p: unit(p - b.node('hilum_of_spleen').mean(0))),
    '13a': ('On the posterior superior pancreaticoduodenal artery, on the side away from the head, at the points nearest half and four fifths of its length where a node fits.',
            lambda b, n: [route_candidates(b, 'superior-pancreaticoduodenal-arteries/posterior', f) for f in np.linspace(0.5, 0.8, n)],
            away_from_head),
    '13b': ('On the posterior inferior pancreaticoduodenal artery, on the side away from the head, at the points nearest 60% and 85% of its length where a node fits.',
            lambda b, n: [route_candidates(b, 'inferior-pancreaticoduodenal-arteries/posterior', f) for f in np.linspace(0.6, 0.85, n)],
            away_from_head),
    '17a': ('On the anterior superior pancreaticoduodenal artery, on the side away from the head, at the points nearest half and four fifths of its length where a node fits.',
            lambda b, n: [route_candidates(b, 'superior-pancreaticoduodenal-arteries/anterior', f) for f in np.linspace(0.5, 0.8, n)],
            away_from_head),
    '17b': ('On the anterior inferior pancreaticoduodenal artery, on the side away from the head, at the points nearest 60% and 85% of its length where a node fits.',
            lambda b, n: [route_candidates(b, 'inferior-pancreaticoduodenal-arteries/anterior', f) for f in np.linspace(0.6, 0.85, n)],
            away_from_head),
}


# --------------------------------------------------------------------------- writing

def write_glb(parts: list[tuple[str, dict, np.ndarray, np.ndarray, np.ndarray]], derived: dict) -> bytes:
    body, views, accessors, meshes, nodes = bytearray(), [], [], [], []

    def add(arr: np.ndarray, ctype: int, kind: str, target: int, minmax: bool = False) -> int:
        raw = arr.tobytes()
        views.append({'buffer': 0, 'byteOffset': len(body), 'byteLength': len(raw), 'target': target})
        body.extend(raw + b'\x00' * ((4 - len(raw) % 4) % 4))
        acc = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': kind}
        if minmax:
            acc['min'] = [float(x) for x in arr.min(0)]; acc['max'] = [float(x) for x in arr.max(0)]
        accessors.append(acc)
        return len(accessors) - 1

    for name, extras, pos, nor, faces in parts:
        p = add((pos / 1000.0).astype('<f4'), 5126, 'VEC3', 34962, True)
        n = add(nor.astype('<f4'), 5126, 'VEC3', 34962)
        i = add(faces.reshape(-1).astype('<u4'), 5125, 'SCALAR', 34963)
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': p, 'NORMAL': n}, 'indices': i, 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'extras': extras})
    doc = {'asset': {'version': '2.0', 'generator': 'place_simulated.py', 'copyright': 'Simulated geometry placed on HRA meshes (CC BY 4.0)'},
           'extras': {'derivedFrom': derived},
           'scene': 0, 'scenes': [{'nodes': [len(nodes)]}],
           'nodes': nodes + [{'name': 'simulated', 'children': list(range(len(nodes)))}],
           'meshes': meshes, 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(body)}]}
    js = json.dumps(doc, separators=(',', ':'), sort_keys=True).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(body)
    return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(body), 0x004E4942) + bytes(body)


def build(sex: str, inventory: list[dict], region_meta: dict) -> dict:
    data = (ATLAS / region_meta['output']['file']).read_bytes()
    if sha256(data) != region_meta['output']['sha256']:
        raise SystemExit(f'{region_meta["output"]["file"]}: SHA-256 differs from its manifest. Refusing to build.')
    body = Body(sex, inventory, read_glb(data))
    plans = [s for s in inventory if s['status'] == 'ready' and s['plan']['kind'] == 'route']
    landmarks: dict[str, np.ndarray] = {}
    resolved, routes, parts = [], [], []
    pending = list(plans)
    while pending:  # a route may use a landmark on another route, so build in dependency order
        progressed = False
        for s in list(pending):
            key = s['id'].split(':', 1)[1]
            names = [n for b in s['plan']['branches'] for n in b['via']]
            unknown = [n for n in names if n not in LANDMARKS]
            if unknown:
                raise SystemExit(f'{s["id"]}: landmarks not defined in LANDMARKS: {unknown}')
            if any(LANDMARKS[n][0] == 'route' and n.split(':')[0] not in body.routes for n in names):
                continue
            gap = max(s['plan']['radiusMm']) + CLEARANCE_MM
            for n in names:
                if n not in landmarks:
                    where, rule, fn = LANDMARKS[n]
                    raw = fn(body)
                    placed = raw
                    if where == 'surface':
                        # Placed once, so every branch that uses it meets at the same point: the nearest free grid
                        # cell lying `radius + clearance` off its own surface and clear of every other drawn structure.
                        owner = n.split(':')[0]
                        placed = place_free(raw, Field(body, [owner], [k for k in body.structures if k != owner]), gap)
                    landmarks[n] = placed
                    resolved.append({'name': n, 'lies': where, 'rule': rule, 'pointMm': [round(float(x), 2) for x in raw],
                                     'placedMm': [round(float(x), 2) for x in placed]})
            avoid = [k for k in body.structures if k not in s['plan']['hug']]
            radius = tuple(s['plan']['radiusMm'])
            centrelines = []
            for branch in s['plan']['branches']:
                kinds = [LANDMARKS[n][0] for n in branch['via']]
                parent = branch['via'][0].split(':')[0]
                field = Field(body, s['plan']['hug'], [k for k in avoid if not (k == parent and kinds[0] == 'vessel')])
                c = route([landmarks[n] for n in branch['via']], kinds, field, radius, parent)
                centrelines.append(c)
                body.routes[f'{key}/{branch["name"]}'] = c
                pos, nor, faces = tube(c, radius)
                node = f'sim--{s["id"].replace(":", "--")}--{branch["name"]}'  # three.js strips / : . [ ] from node names
                parts.append((node, {'structureId': s['id'], 'branch': branch['name'], 'evidence': 'simulated'}, pos, nor, faces))
                length = float(np.sum(np.linalg.norm(np.diff(c, axis=0), axis=1)))
                # How closely it follows its surface (beyond the first 5 mm, which may leave a parent vessel).
                s_along = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]
                follow = field.hug_distance(c[s_along > min(5.0, s_along[-1] / 2)])[0]
                # Where it comes closer to another drawn structure than its own radius: it touches or crosses that mesh.
                origin_parent = branch['via'][0].split(':')[0]
                contacts = []
                for other, tree in body.trees.items():
                    if other in s['plan']['hug'] or other == origin_parent:
                        continue
                    d = tree.query(c)[0]
                    if kinds[0] in ('vessel', 'route'):
                        d = np.where(s_along < EXEMPT_MM, np.inf, d)  # the first mm leave the parent vessel and its neighbours at the junction
                    clearance = float((d - max(radius)).min())
                    if clearance < 0:
                        contacts.append({'structure': other, 'clearanceMm': round(clearance, 2), 'alongMm': round(float(s_along[d.argmin()]), 1)})
                routes.append({'structure': s['id'], 'branch': branch['name'], 'node': node, 'via': branch['via'], 'lengthMm': round(length, 1),
                               'radiusMm': list(radius), 'medianDistanceToFollowedSurfaceMm': round(float(np.median(follow)), 2),
                               'targetDistanceMm': round(max(radius) + CLEARANCE_MM, 2), 'contacts': contacts,
                               **shape_checks(c), 'vertices': int(len(pos)), 'triangles': int(len(faces))})
            body.routes[key] = centrelines[0]
            pending.remove(s); progressed = True
        if not progressed:
            raise SystemExit(f'Circular landmark dependency among {[s["id"] for s in pending]}')
    # Lymph nodes, after every route, so they keep clear of the simulated vessels too.
    clearance = Clearance(body)
    for r in routes:
        clearance.add_tube(body.routes[f'{r["structure"].split(":", 1)[1]}/{r["branch"]}'], max(r['radiusMm']))
    nodes_out = []
    for s in [s for s in inventory if s['status'] == 'ready' and s['plan']['kind'] == 'nodes']:
        short, long = s['plan']['radiusMm']
        for st in s['plan']['stations']:
            if st['name'] not in STATIONS:
                raise SystemExit(f'{s["id"]}: station {st["name"]} not defined in STATIONS')
            rule, anchors_fn, side_fn = STATIONS[st['name']]
            anchors = anchors_fn(body, st['count'])
            if len(anchors) != st['count']:
                raise SystemExit(f'{s["id"]}: station {st["name"]} gave {len(anchors)} anchors for {st["count"]} nodes')
            for k, choice in enumerate(anchors, start=1):
                candidates = choice if isinstance(choice, list) else [choice + (None,)]
                placed = None
                for anchor, tangent, beside, fraction in candidates:
                    placed = place_node(anchor, tangent, side_fn(body, anchor), beside, clearance, short, long)
                    if placed:
                        break
                if not placed:
                    raise SystemExit(f'{s["id"]}: no free place for node {st["name"]}-{k} at any of {len(candidates)} anchors')
                centre, turned, extra = placed
                clearance.spheres.append((centre, long))
                name = f'node--{s["id"].replace(":", "--")}--{st["name"]}-{k}'
                pos, nor, faces = ellipsoid(centre, tangent, short, long)
                parts.append((name, {'structureId': s['id'], 'station': st['name'], 'evidence': 'simulated'}, pos, nor, faces))
                nodes_out.append({'structure': s['id'], 'station': st['name'], 'node': name, 'rule': rule,
                                  'anchorMm': [round(float(x), 2) for x in anchor], 'centreMm': [round(float(x), 2) for x in centre],
                                  'turnedDeg': round(turned, 0), 'movedOutMm': extra, 'semiAxesMm': [short, short, long],
                                  **({'anchorAt': fraction} if fraction is not None else {})})
    derived = {'file': region_meta['output']['file'], 'sha256': region_meta['output']['sha256']}
    glb = write_glb(parts, derived)
    out_name = f'pancreas-simulated-{sex}.glb'
    (ATLAS / out_name).write_bytes(glb)
    return {'sex': sex, 'derivedFrom': derived, 'output': {'file': out_name, 'bytes': len(glb), 'sha256': sha256(glb), 'units': 'metres', 'frame': 'HRA'},
            'landmarks': resolved, 'routes': routes, 'nodes': nodes_out}


def main() -> None:
    inventory = json.loads((ROOT / 'data' / 'human-pancreas-inventory.json').read_text())['references']
    region = {r['sex']: r for r in json.loads((ATLAS / 'pancreas-region.manifest.json').read_text())['references']}
    manifest = {'schemaVersion': 'humanbio.simulated.v1', 'license': 'CC-BY-4.0',
                'evidence': 'simulated: placed by the rules below on HRA meshes; not measured from any person',
                'axes': AXES,
                'method': {'gdaDropMm': GDA_DROP_MM, 'voxelMm': VOXEL_MM, 'marginMm': MARGIN_MM, 'followWeight': FOLLOW_WEIGHT, 'farCost': FAR_COST,
                           'exemptMm': EXEMPT_MM, 'smoothRounds': SMOOTH_ROUNDS, 'sides': SIDES, 'sampleMm': SAMPLE_MM, 'clearanceMm': CLEARANCE_MM,
                           'routing': 'Each leg between two landmarks is the cheapest path through a grid of 0.75 mm cells. A cell is forbidden if it lies inside '
                                      'the followed organ, inside another drawn structure, or nearer to one than radius plus clearance; near a parent vessel the '
                                      'first 5 mm are exempt. A cell costs more the farther it lies from radius plus clearance off the followed surface. '
                                      'Inside and outside are judged from vertex normals turned away from the organ centre, or from the local middle of a tube. '
                                      'The grid path is smoothed, then drawn as a centripetal Catmull-Rom curve and a tube with parallel-transport frames and linear taper. '
                                      'Contacts are measured to mesh vertices and ignore the first 5 mm after a parent vessel.'},
                'references': [build(sex, inventory[sex], region[sex]) for sex in ('male', 'female')]}
    (ATLAS / 'pancreas-simulated.manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    for ref in manifest['references']:
        print(f'{ref["output"]["file"]}: {len(ref["routes"])} branches, {len(ref["nodes"])} lymph nodes, {ref["output"]["bytes"]:,} bytes')
        for n_ in ref['nodes']:
            if n_['turnedDeg'] or n_['movedOutMm'] or 'anchorAt' in n_:
                print(f'  node {n_["node"].split("--")[-1]}: turned {n_["turnedDeg"]:.0f} deg, moved out {n_["movedOutMm"]} mm'
                      + (f', anchored at {n_["anchorAt"]}' if 'anchorAt' in n_ else ''))
        print(f'  registry: {ref["sex"]}: {{ url: \'/atlas-human/{ref["output"]["file"]}\', bytes: {ref["output"]["bytes"]}, sha256: \'{ref["output"]["sha256"]}\' }},')
        for r in ref['routes']:
            print(f'  {r["structure"].split(":")[1]}/{r["branch"]}: {r["lengthMm"]} mm, follows at {r["medianDistanceToFollowedSurfaceMm"]} mm '
                  f'(target {r["targetDistanceMm"]}), step {r["maxStepMm"]}, turn {r["maxTurnDeg"]}°, contacts: {[(c["structure"], c["clearanceMm"]) for c in r["contacts"]] or "none"}')


if __name__ == '__main__':
    main()
