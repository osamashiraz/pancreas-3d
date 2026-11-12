#!/usr/bin/env python3
"""Build a representative human islet of Langerhans from published measurements.

Original integration code: MIT.

This is a model, not a measurement: no islet of the Visible Human was imaged at this scale. Every number
it uses is in PARAMETERS with its source, and every number it produces is in the manifest beside the
target it was meant to meet, so anyone can see how well the model agrees with the literature.

Writes  public/atlas-human/islet-representative.glb   (positions in micrometres; the root node scales them to metres)
        public/atlas-human/islet-representative.manifest.json

Deterministic: the seed is fixed. Needs numpy and scipy.
"""
import hashlib, json, struct
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'atlas-human'

HAHN = 'Hahn M, et al. 3D imaging of human organs with micrometer resolution - applied to the endocrine pancreas. Commun Biol 2021;4:1063. doi:10.1038/s42003-021-02589-x'
CABRERA = 'Cabrera O, et al. The unique cytoarchitecture of human pancreatic islets has implications for islet cell function. Proc Natl Acad Sci U S A 2006;103(7):2334-9. doi:10.1073/pnas.0510790103'
BRISSOVA = 'Brissova M, et al. Assessment of human pancreatic islet architecture and composition by laser scanning confocal microscopy. J Histochem Cytochem 2005;53(9):1087-97. doi:10.1369/jhc.5C6684.2005'
HRA_FTU = 'HRA 2D functional tissue unit, Islets of Langerhans, pancreas, v1.2 (ccf-releases v2.0), CC BY 4.0: a stylized average drawn with 117 beta, 66 alpha, 20 delta and 12 PP cells.'

PARAMETERS = {
    'isletDiameterUm': {'value': 110.0, 'source': HAHN, 'verified': True,
                        'note': 'Mean 3D diameter of 197,097 human islets.'},
    'composition': {'value': {'beta': 117, 'alpha': 66, 'delta': 20, 'pp': 12}, 'source': HRA_FTU, 'verified': True,
                    'note': 'Used as proportions: 54% beta, 31% alpha, 9% delta, 6% PP. Brissova et al. found composition varies considerably between human islets.'},
    'arrangement': {'value': 'interspersed along capillaries, no core or mantle', 'source': CABRERA, 'verified': True,
                    'note': 'Also Brissova et al.: alpha, beta and delta cells dispersed throughout human islets.'},
    'betaHeterotypicFraction': {'value': 0.71, 'source': CABRERA, 'verified': True,
                                'note': 'Share of beta cells in contact with other endocrine cells, measured in confocal sections; the model is tuned to it, '
                                        'pooled over five parallel sections of the model, with profiles counted as touching within 15% of contact.'},
    'cellDiameterUm': {'value': 11.0, 'source': None, 'verified': False,
                       'note': 'Typical endocrine cell diameter; no source checked yet. Sets the number of cells.'},
    'capillaryRadiusUm': {'value': 3.0, 'source': None, 'verified': False,
                          'note': 'Typical capillary radius; no source checked yet.'},
    'capillaryReachCells': {'value': 1.5, 'source': None, 'verified': False,
                            'note': 'Capillaries are added until 95% of cells lie within this many cell diameters of one; a modelling rule that '
                                    'stands for Cabrera et al.\'s finding that most cells align along vessels.'},
}
SEED = 20060206           # Cabrera et al. publication date, so the seed is not chosen to flatter the result
SECTION_HALF_UM = 2.0     # a confocal optical section is a few micrometres thick
TYPES = ['beta', 'alpha', 'delta', 'pp']


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def pack_cells(rng, radius: float, d: float) -> np.ndarray:
    """Cells as solid tissue: a face-centred cubic lattice with neighbours d apart (touching spheres fill 74% of space),
    turned to a random orientation so no axis lines up with the section, each centre jittered by 8% of d."""
    a = d * np.sqrt(2)  # fcc cube edge for nearest-neighbour distance d
    n = int(np.ceil(radius / a)) + 2
    g = np.arange(-n, n + 1) * a
    base = np.array([[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) * a
    pts = (np.stack(np.meshgrid(g, g, g, indexing='ij'), -1).reshape(-1, 1, 3) + base).reshape(-1, 3)
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    pts = pts @ q.T + rng.normal(scale=0.08 * d, size=pts.shape)
    return pts[np.linalg.norm(pts, axis=1) <= radius - d / 2]


def catmull(points: np.ndarray, n_per: int = 12) -> np.ndarray:
    p = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = []
    for i in range(1, len(p) - 2):
        for t in np.linspace(0, 1, n_per, endpoint=False):
            a, b, c, e = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t * t + (-a + 3 * b - 3 * c + e) * t ** 3))
    out.append(points[-1])
    return np.array(out)


def capillaries(rng, radius: float, cells: np.ndarray, reach: float, clear: float):
    """Add smooth capillaries until 95% of the cells that remain (those not cut by a capillary) lie within `reach` of one."""
    vessels = []
    def survivors():
        if not vessels:
            return cells, np.full(len(cells), np.inf)
        d = cKDTree(np.vstack(vessels)).query(cells)[0]
        return cells[d > clear], d[d > clear]
    for _ in range(80):
        left, d = survivors()
        if vessels and np.mean(d <= reach) >= 0.95:
            break
        target = left[np.argmax(d)] if vessels else np.zeros(3)  # aim through the cell farthest from any vessel
        a = rng.normal(size=3); a /= np.linalg.norm(a)
        b = -a + rng.normal(scale=0.5, size=3); b /= np.linalg.norm(b)
        start, end = a * radius * 1.15, b * radius * 1.15
        mid1 = 0.5 * (start + target) + rng.normal(scale=radius * 0.12, size=3)
        mid2 = 0.5 * (target + end) + rng.normal(scale=radius * 0.12, size=3)
        vessels.append(catmull(np.array([start, mid1, target, mid2, end])))
    left, d = survivors()
    return vessels, left, float(np.mean(d <= reach))


SECTIONS_UM = (-30.0, -15.0, 0.0, 15.0, 30.0)  # five parallel sections, more than a cell diameter apart


def sections_metric(cells, types, d):
    """The share pooled over the parallel sections, so the estimate rests on more beta cells."""
    hetero = total = 0
    for z0 in SECTIONS_UM:
        m, nb = section_metric(cells, types, d, z0)
        if nb:
            hetero += m * nb; total += nb
    return hetero / max(total, 1), total


def section_metric(cells, types, d, z0=0.0):
    """Share of beta cells, among those cut by a thin central section, touching a non-beta endocrine cell in that section."""
    in_sec = np.where(np.abs(cells[:, 2] - z0) < d / 2)[0]
    if len(in_sec) == 0:
        return np.nan, 0
    # Radius of each cell's profile in the plane; neighbours touch when profiles come within 15% of contact.
    r2 = np.sqrt(np.maximum((d / 2) ** 2 - (cells[in_sec, 2] - z0) ** 2, 0))
    xy = cells[in_sec, :2]
    tree = cKDTree(xy)
    beta_sec = [k for k, i in enumerate(in_sec) if types[i] == 'beta']
    hetero = 0
    for k in beta_sec:
        for j in tree.query_ball_point(xy[k], d * 1.2):
            if j != k and np.linalg.norm(xy[k] - xy[j]) <= (r2[k] + r2[j]) * 1.15 and types[in_sec[j]] != 'beta':
                hetero += 1
                break
    return hetero / max(len(beta_sec), 1), len(beta_sec)


def assign(rng, cells, d, proportions, coupling, sweeps=40):
    """Types in fixed proportions; then swaps that favour beta-beta contact by `coupling` (0 = random)."""
    n = len(cells)
    total = sum(proportions.values())
    counts = {t: int(round(n * proportions[t] / total)) for t in TYPES}
    counts['beta'] += n - sum(counts.values())
    types = np.array(sum([[t] * counts[t] for t in TYPES], []))
    rng.shuffle(types)
    nbrs = cKDTree(cells).query_ball_point(cells, d * 1.15)
    nbrs = [[j for j in row if j != i] for i, row in enumerate(nbrs)]
    beta = types == 'beta'
    for _ in range(sweeps * n):
        i, j = rng.integers(n, size=2)
        if beta[i] == beta[j]:
            continue
        # Energy: -coupling per beta-beta contact. Swapping i (beta) and j (non-beta) moves one beta.
        b, o = (i, j) if beta[i] else (j, i)
        before = sum(beta[k] for k in nbrs[b] if k != o) - sum(beta[k] for k in nbrs[o] if k != b)
        delta = coupling * before  # energy rise if the beta at b moves to o
        if delta <= 0 or rng.random() < np.exp(-delta):
            types[b], types[o] = types[o], types[b]
            beta[b], beta[o] = beta[o], beta[b]
    return types


def calibrate(seed, cells, d, proportions, target):
    """Random types first; if they already meet the measured share within one standard error, keep them.
    Otherwise bisect on the beta-beta coupling until the pooled sections reach it."""
    history = []
    def trial(coupling):
        types = assign(np.random.default_rng(seed + 1), cells, d, proportions, coupling)
        m, nb = sections_metric(cells, types, d)
        history.append({'coupling': round(coupling, 4), 'betaHeterotypicFraction': round(float(m), 3), 'betaCellsInSection': nb})
        return types, m, nb
    types, m, nb = trial(0.0)
    if abs(m - target) <= np.sqrt(target * (1 - target) / max(nb, 1)):
        return types, history[0], history
    lo, hi = 0.0, 3.0
    for _ in range(12):
        mid = (lo + hi) / 2
        _, m, _ = trial(mid)
        lo, hi = (mid, hi) if m > target else (lo, mid)
    best = min(history, key=lambda h: abs(h['betaHeterotypicFraction'] - target))
    return assign(np.random.default_rng(seed + 1), cells, d, proportions, best['coupling']), best, history


def icosphere(subdiv: int = 1):
    t = (1 + 5 ** 0.5) / 2
    v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
         [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    v = [np.array(x, float) / np.linalg.norm(x) for x in v]
    for _ in range(subdiv):
        cache, nf = {}, []
        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                m = v[a] + v[b]; v.append(m / np.linalg.norm(m)); cache[k] = len(v) - 1
            return cache[k]
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        f = nf
    return np.array(v), np.array(f)


def tube(c, r, sides=8):
    t = np.gradient(c, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
    u = np.cross(t[0], [0, 0, 1.0] if abs(t[0, 2]) < 0.9 else [1.0, 0, 0]); u /= np.linalg.norm(u)
    pos, nor, faces = [], [], []
    for i in range(len(c)):
        if i:
            u = u - np.dot(u, t[i]) * t[i]; u /= np.linalg.norm(u)
        w = np.cross(t[i], u)
        for k in range(sides):
            a = 2 * np.pi * k / sides
            dvec = np.cos(a) * u + np.sin(a) * w
            pos.append(c[i] + r * dvec); nor.append(dvec)
    for i in range(len(c) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces += [[a, a + sides, b], [b, a + sides, b + sides]]
    return np.array(pos), np.array(nor), np.array(faces)


def write_glb(meshes: list) -> bytes:
    body, views, accs, mesh_list, nodes = bytearray(), [], [], [], []
    def add(arr, ctype, kind, target, mm=False):
        raw = arr.tobytes()
        views.append({'buffer': 0, 'byteOffset': len(body), 'byteLength': len(raw), 'target': target})
        body.extend(raw + b'\x00' * ((4 - len(raw) % 4) % 4))
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': kind}
        if mm:
            a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a); return len(accs) - 1
    for name, extras, pos, nor, faces in meshes:
        p = add(pos.astype('<f4'), 5126, 'VEC3', 34962, True)
        n = add(nor.astype('<f4'), 5126, 'VEC3', 34962)
        i = add(faces.reshape(-1).astype('<u4'), 5125, 'SCALAR', 34963)
        mesh_list.append({'name': name, 'primitives': [{'attributes': {'POSITION': p, 'NORMAL': n}, 'indices': i, 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(mesh_list) - 1, 'extras': extras})
    doc = {'asset': {'version': '2.0', 'generator': 'build_islet.py', 'copyright': 'Model built from published measurements; see manifest'},
           'scene': 0, 'scenes': [{'nodes': [len(nodes)]}],
           'nodes': nodes + [{'name': 'islet-representative', 'children': list(range(len(nodes))), 'scale': [1e-6, 1e-6, 1e-6],
                              'extras': {'units': 'positions are micrometres; this node scales them to metres'}}],
           'meshes': mesh_list, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(body)}]}
    js = json.dumps(doc, separators=(',', ':'), sort_keys=True).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    return struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(body)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
        + struct.pack('<II', len(body), 0x004E4942) + bytes(body)


def main() -> None:
    P = {k: v['value'] for k, v in PARAMETERS.items()}
    radius, d = P['isletDiameterUm'] / 2, P['cellDiameterUm']
    rng = np.random.default_rng(SEED)
    cells = pack_cells(rng, radius, d)
    # Cells cut by a capillary are removed: a cell centre must lie farther than the capillary radius plus 35% of d from its axis.
    vessels, cells, covered = capillaries(rng, radius, cells, P['capillaryReachCells'] * d, P['capillaryRadiusUm'] + 0.35 * d)
    types, best, history = calibrate(SEED, cells, d, P['composition'], P['betaHeterotypicFraction'])
    random_types = assign(np.random.default_rng(SEED + 1), cells, d, P['composition'], 0.0)
    random_metric, _ = sections_metric(cells, random_types, d)
    # How uncertain is a share estimated from this many beta cells? (binomial standard error)
    n_beta_sections = best['betaCellsInSection']
    se = float(np.sqrt(best['betaHeterotypicFraction'] * (1 - best['betaHeterotypicFraction']) / max(n_beta_sections, 1)))

    # Geometry: one mesh per cell type, cells drawn at 0.46 d so neighbours show a hairline gap; one mesh for capillaries.
    # Cells are drawn as spheres for clarity; in tissue they are polyhedral and fill the space between them.
    sv, sf = icosphere(1)
    meshes = []
    for t in TYPES:
        idx = np.where(types == t)[0]
        pos = np.vstack([cells[i] + sv * 0.46 * d for i in idx])
        nor = np.vstack([sv for _ in idx])
        faces = np.vstack([sf + k * len(sv) for k in range(len(idx))])
        meshes.append((f'cells--{t}', {'cellType': t, 'count': int(len(idx))}, pos, nor, faces))
    parts = [tube(v, P['capillaryRadiusUm']) for v in vessels]
    off, pos, nor, faces = 0, [], [], []
    for p_, n_, f_ in parts:
        pos.append(p_); nor.append(n_); faces.append(f_ + off); off += len(p_)
    meshes.append(('capillaries', {'count': len(vessels)}, np.vstack(pos), np.vstack(nor), np.vstack(faces)))
    glb = write_glb(meshes)
    (OUT / 'islet-representative.glb').write_bytes(glb)

    n = len(cells)
    composition = {t: round(float(np.mean(types == t)), 3) for t in TYPES}
    target = {t: round(P['composition'][t] / sum(P['composition'].values()), 3) for t in TYPES}
    manifest = {
        'schemaVersion': 'humanbio.islet.v1', 'evidence': 'simulated: a model built from published measurements, not an imaged islet',
        'license': 'MIT for the code; the numbers belong to their sources', 'seed': SEED,
        'parameters': PARAMETERS,
        'result': {
            'cells': n, 'capillaries': len(vessels), 'cellsWithinReachOfCapillary': round(covered, 3),
            'composition': composition, 'compositionTarget': target,
            'sectionsUm': list(SECTIONS_UM),
            'betaHeterotypicFractionInSections': best['betaHeterotypicFraction'],
            'betaHeterotypicFractionStandardError': round(se, 3),
            'betaHeterotypicFractionTarget': P['betaHeterotypicFraction'],
            'betaHeterotypicFractionIfTypesWereRandom': round(float(random_metric), 3),
            'betaCellsInSections': best['betaCellsInSection'],
            'betaBetaCoupling': best['coupling'],
        },
        'calibration': history,
        'cells': [{'type': str(types[i]), 'centreUm': [round(float(x), 2) for x in cells[i]]} for i in range(n)],
        'output': {'file': 'islet-representative.glb', 'bytes': len(glb), 'sha256': sha256(glb), 'units': 'micrometres, scaled to metres by the root node'},
    }
    (OUT / 'islet-representative.manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    r = manifest['result']
    print(f'{n} cells, {len(vessels)} capillaries, {covered:.0%} of cells within {P["capillaryReachCells"]} cell diameters of a capillary')
    print('composition', composition, 'target', target)
    print(f'beta cells touching another type, pooled over {len(SECTIONS_UM)} sections: {r["betaHeterotypicFractionInSections"]:.0%} '
          f'± {r["betaHeterotypicFractionStandardError"]:.0%} (target {P["betaHeterotypicFraction"]:.0%}; if types were random: '
          f'{r["betaHeterotypicFractionIfTypesWereRandom"]:.0%}), {r["betaCellsInSections"]} beta cells, coupling {r["betaBetaCoupling"]}')
    print(f'islet-representative.glb: {len(glb):,} bytes, sha256 {sha256(glb)}')


if __name__ == '__main__':
    main()
