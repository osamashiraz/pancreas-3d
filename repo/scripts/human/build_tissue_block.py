#!/usr/bin/env python3
"""Build a block of human pancreatic tissue: a branching duct tree ending in acini, with centroacinar cells
inside each acinus, and the representative islet among them.

Original integration code: MIT. A model built from published descriptions and measurements, not imaged tissue.
Every parameter is listed with its source, or marked as not yet sourced.

Reads   public/atlas-human/islet-representative.manifest.json (cell positions of the islet)
Writes  public/atlas-human/tissue-block.json  (layout in micrometres: acinus frames, duct segments, islet cells,
        and the parameters a viewer needs to build each cell's shape)

Geometry convention for an acinus: its own frame has the mouth at the origin and the blind end along +z.
Deterministic. Needs numpy and scipy.
"""
import hashlib, json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT / 'public' / 'atlas-human'

MESSENGER = 'Messenger SW, Falkowski MA, Groblewski GE. Ca2+-regulated secretory granule exocytosis in pancreatic and parotid acinar cells. Cell Calcium 2014;55(6):369-75. doi:10.1016/j.ceca.2014.03.003'
NADELHAFT = 'Nadelhaft I. Measurement of the size distribution of zymogen granules from rat pancreas. Biophys J 1973;13(10):1014-29. doi:10.1016/S0006-3495(73)86042-4'
ERMAK = 'Ermak TH, Rothman SS. Zymogen granules of pancreas decrease in size in response to feeding. Cell Tissue Res 1981;214(1):51-66. doi:10.1007/BF00235144'
ENDO = 'Endo H, et al. Fine reconstruction of the pancreatic ductular system at the onset of pancreatitis. Histol Histopathol 2002;17(1):107-12. doi:10.14670/HH-17.107'
BEER = 'Beer RL, Parsons MJ, Rovira M. Centroacinar cells: at the center of pancreas regeneration. Dev Biol 2016;413(1):8-15. doi:10.1016/j.ydbio.2016.02.027'
CODA = 'Kiemen AL, et al. CODA: quantitative 3D reconstruction of large tissues at cellular resolution. Nat Methods 2022;19(11):1490-1499. doi:10.1038/s41592-022-01650-9'
HRA_ACINUS = 'HRA 2D functional tissue units, pancreatic acinus v1.1 and intercalated duct v1.1 (ccf-releases v2.0), CC BY 4.0, after histology atlases (Ross; Mescher; Krstic; Ovalle and Nahirney).'

def P(value, source, verified, note):
    return {'value': value, 'source': source, 'verified': verified, 'note': note}

PARAMETERS = {
    # Organization
    'ductTreeEndsInAcini': P(True, ENDO, True, 'Intercalated ducts branch and end in acini; no anastomoses among acini or their central lumina. Described in rat.'),
    'intraAcinarDuct': P(True, ENDO, True, 'An intra-acinar duct formed only by centroacinar cells continues the intercalated duct into the acinus. Described in rat.'),
    'centroacinarIsDuctal': P(True, BEER, True, 'Centroacinar cells are a specialised ductal cell type at the start of the intercalated duct.'),
    'aciniAsGrapeLikeLobules': P(True, CODA, True, 'Acinar lobules appear as bunches of grape-like structures at the ends of the ducts in 3D reconstructions of human pancreas.'),
    # Zymogen granules
    'zymogenGranuleDiameterUm': P(1.0, MESSENGER, True, 'About 1 um; measured at 0.98 +/- 0.19 um in rat (Nadelhaft 1973).'),
    'granulesApical': P(True, ERMAK, True, 'Granules fill the apical portion of the acinar cell; about 45 per cell section in fasted rat, fewer after feeding.'),
    'granulesDrawnPerCell': P(24, None, False, 'A display choice: a cell holds many more than are drawn.'),
    # Nuclei
    'meanNuclearRadiusUm': P(2.0, CODA, True, 'Average radius of nuclei in human pancreas H&E sections, across cell types. Acinar nuclei are drawn larger.'),
    # Not yet sourced: typical histology values
    'acinarCellHeightUm': P(12.0, None, False, 'Base to apex of a pyramidal acinar cell.'),
    'acinarCellBaseUm': P(10.0, None, False, 'Width of the base along the basement membrane.'),
    'acinarNucleusDiameterUm': P(5.5, None, False, 'Round, basal nucleus.'),
    'acinusRadiusUm': P([13.0, 19.0], None, False, 'Acini drawn as rounded berries of varying size: acinar cells converge on a central lumen like the segments of an orange.'),
    'acinarLumenRadiusUm': P(1.0, None, False, 'Narrow central lumen.'),
    'centroacinarCellsPerAcinus': P(3, None, False, 'Lining the intra-acinar duct in the neck of the acinus.'),
    'centroacinarSizeUm': P([12.0, 6.0, 2.0], None, False, 'Flattened, pale cells: length along the duct, width, thickness. Nucleus elongated.'),
    'intraAcinarDuctLengthUm': P(14.0, None, False, 'How far the centroacinar cells reach into the acinus.'),
    'intercalatedDuctOuterRadiusUm': P(5.0, None, False, 'Low, flattened epithelium continuous with the centroacinar cells.'),
    'intercalatedCellHeightUm': P(3.0, None, False, ''),
    'intralobularDuctOuterRadiusUm': P(12.0, None, False, 'Cuboidal epithelium.'),
    'intralobularCellHeightUm': P(6.0, None, False, ''),
    'ductCellLengthUm': P(9.0, None, False, 'Length of a duct cell along the duct.'),
    'blockSizeUm': P(300.0, None, False, 'A display choice: a cube taken from inside a lobule, containing one islet.'),
    'collagenAlignedAlongDucts': P(True, CODA, True, 'Collagen fibres are highly aligned along the long axis of the ducts, vessels and nerves they surround.'),
    'collagenFraction': P(0.06, CODA, True, 'About 6% of normal pancreas: inferred from a cancer sample at 87% collagen, described as a 14-fold increase over normal.'),
    'capillaryRadiusUm': P(3.0, None, False, 'Lumen of about 6 um, just wide enough for red cells in single file.'),
    'capillaryReachUm': P(6.0, None, False, 'Capillaries are added until most acini have one within this distance of their surface; a modelling rule.'),
    'redCellSizeUm': P([7.5, 2.0], None, False, 'Diameter and thickness of a red blood cell; a textbook value.'),
    'stellateCellSizeUm': P([24.0, 4.0, 2.5], None, False, 'Spindle-shaped periacinar stellate cells and fibroblasts: length, width, thickness.'),
}
SEED = 20221024  # CODA publication date
# One block per region of the gland. The body is the original block. Each region has its own seed, so its acini, ducts and
# vessels are laid out independently, and its islet sits elsewhere in the block. Every block holds one islet: at the
# measured densities a 300 um block holds about half an islet in the head and about one in the tail, so a single block
# cannot show the difference; the regional density is shown at the gross (millimetre) level instead.
REGIONS = {'body': (0, (0.35, 0.15, -0.1)), 'head': (101, (-0.3, -0.2, 0.25)), 'tail': (202, (0.1, 0.35, 0.3))}


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def quat_from_z(direction: np.ndarray, roll: float) -> list:
    """Quaternion turning +z onto `direction`, then rolling by `roll` about it."""
    d = direction / np.linalg.norm(direction)
    z = np.array([0, 0, 1.0])
    axis = np.cross(z, d); s = np.linalg.norm(axis); c = float(np.dot(z, d))
    if s < 1e-9:
        q = np.array([0, 0, 0, 1.0]) if c > 0 else np.array([1.0, 0, 0, 0])
    else:
        axis /= s; ang = np.arctan2(s, c)
        q = np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
    r = np.r_[d * np.sin(roll / 2), np.cos(roll / 2)]  # roll about d, applied after
    x1, y1, z1, w1 = r; x2, y2, z2, w2 = q
    return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2]


def seg_dist(p1, q1, p2, q2):
    """Smallest distance between two segments."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1 @ d1, d2 @ d2, d2 @ r
    c, b = d1 @ r, d1 @ d2
    den = a * e - b * b
    s = np.clip((b * f - c * e) / den, 0, 1) if den > 1e-9 else 0.0
    t = np.clip((b * s + f) / e, 0, 1) if e > 1e-9 else 0.0
    s = np.clip((b * t - c) / a, 0, 1) if a > 1e-9 else 0.0
    return float(np.linalg.norm(p1 + d1 * s - (p2 + d2 * t)))


def main() -> None:
    import sys
    region = sys.argv[1] if len(sys.argv) > 1 else 'body'
    seed_offset, islet_at = REGIONS[region]
    V = {k: p['value'] for k, p in PARAMETERS.items()}
    rng = np.random.default_rng(SEED + seed_offset)
    half = V['blockSizeUm'] / 2
    R_ac = V['acinusRadiusUm']

    # The islet: the representative islet's cells, centred off-centre in the block.
    islet = json.loads((ATLAS / 'islet-representative.manifest.json').read_text())
    islet_centre = np.array(islet_at) * half
    islet_radius = islet['parameters']['isletDiameterUm']['value'] / 2
    islet_cells = [[c['type']] + [round(float(x), 2) for x in np.array(c['centreUm']) + islet_centre] for c in islet['cells']]

    # The intralobular duct enters on one face and ramifies through the block by space colonization: branches grow
    # toward tissue no duct yet reaches, until every point is within reach of one. Its calibre tapers with the number of
    # branches it serves (Murray's law, exponent 3), between the intralobular and intercalated radii.
    root_a = np.array([-half, -half * 0.25, 0.0])
    attract = rng.uniform(-half * 0.92, half * 0.92, (500, 3))
    attract = attract[np.linalg.norm(attract - islet_centre, axis=1) > islet_radius + 15]
    nodes, parent = [root_a, root_a + np.array([14.0, 0, 0])], [-1, 0]
    STEP, INFLUENCE, KILL = 16.0, 130.0, 62.0  # a sparse tree: room for acini between the branches
    for _ in range(120):
        if not len(attract):
            break
        tree = cKDTree(np.array(nodes))
        d_, nearest = tree.query(attract)
        grow = {}
        for k_, (dd, nn) in enumerate(zip(d_, nearest)):
            if dd < INFLUENCE:
                grow.setdefault(int(nn), []).append(attract[k_])
        if not grow:
            break
        for nn, pts_ in grow.items():
            dirn = np.sum([(q - nodes[nn]) / np.linalg.norm(q - nodes[nn]) for q in pts_], axis=0)
            dirn /= np.linalg.norm(dirn)
            new = nodes[nn] + dirn * STEP
            if np.linalg.norm(new - islet_centre) < islet_radius + 14 or np.any(np.abs(new) > half - 6):
                continue
            nodes.append(new); parent.append(nn)
        tree = cKDTree(np.array(nodes))
        attract = attract[tree.query(attract)[0] > KILL]
    nodes = np.array(nodes)
    leaves = np.ones(len(nodes)); children = [[] for _ in nodes]
    for i_, p_ in enumerate(parent):
        if p_ >= 0:
            children[p_].append(i_)
    for i_ in range(len(nodes) - 1, 0, -1):  # children always come after parents
        leaves[parent[i_]] += leaves[i_] if not children[i_] else 0
    load = np.zeros(len(nodes))
    for i_ in range(len(nodes) - 1, -1, -1):
        load[i_] = 1.0 + sum(load[c_] for c_ in children[i_])
    r_max, r_min = V['intralobularDuctOuterRadiusUm'], V['intercalatedDuctOuterRadiusUm'] + 1.5
    radius = r_min + (r_max - r_min) * (load / load.max()) ** (1 / 3)
    segments = [{'a': nodes[p_], 'b': nodes[i_], 'kind': 'intralobular', 'r': float(radius[i_])}
                for i_, p_ in enumerate(parent) if p_ >= 0]

    # Acini bud from the duct tree in grape-like clusters (CODA): pick a point on the tree, send out a short
    # intercalated duct, put a rounded acinus at its end, keep it only if it touches nothing placed. Each acinus joins
    # the tree at one point, so acini never join one another (Endo 2002).
    r_ic = V['intercalatedDuctOuterRadiusUm']
    R_min, R_max = V['acinusRadiusUm']
    obstacles_p, obstacles_r = [], []
    index = {'tree': None, 'n': 0}
    def add_capsule(a_, b_, r_):
        n_ = max(2, int(np.ceil(np.linalg.norm(b_ - a_) / 3.0)) + 1)
        for t_ in np.linspace(0, 1, n_):
            obstacles_p.append(a_ + t_ * (b_ - a_)); obstacles_r.append(r_)
    def clear(a_, b_, r_, margin, ignore_near=None):
        """True when a capsule from a_ to b_ of radius r_ keeps `margin` from everything placed (a spatial index of
        everything up to the last rebuild, plus a direct check of what was added since)."""
        n_ = max(2, int(np.ceil(np.linalg.norm(b_ - a_) / 3.0)) + 1)
        pts_ = np.array([a_ + t_ * (b_ - a_) for t_ in np.linspace(0, 1, n_)])
        if np.any(np.abs(pts_) > half - r_ * 0.9):
            return False
        if np.min(np.linalg.norm(pts_ - islet_centre, axis=1)) < islet_radius + r_ + margin:
            return False
        if index['tree'] is None or len(obstacles_p) - index['n'] > 400:
            index['tree'], index['n'] = cKDTree(np.array(obstacles_p)), len(obstacles_p)
        orr_ = np.array(obstacles_r)
        reach_ = r_ + orr_.max() + margin
        cand_ = set()
        for lst in index['tree'].query_ball_point(pts_, reach_):
            cand_.update(lst)
        cand_.update(range(index['n'], len(obstacles_p)))
        if not cand_:
            return True
        idx_ = np.fromiter(cand_, int)
        op_ = np.array(obstacles_p)[idx_]
        d_ = np.linalg.norm(pts_[:, None, :] - op_[None, :, :], axis=2) - orr_[idx_][None, :] - r_ - margin
        if ignore_near is not None:  # only the parent duct near the branch point is ignored, never another acinus
            near_ = (np.linalg.norm(op_ - ignore_near, axis=1) < r_ + orr_.max() + 2) & (orr_[idx_] < R_min - 0.01)
            d_[:, near_] = 1.0
        return bool(d_.min() >= 0)
    for seg in segments:
        add_capsule(seg['a'], seg['b'], seg['r'])
    tree_pts = [seg['a'] + t * (seg['b'] - seg['a']) for seg in segments for t in np.linspace(0.1, 0.9, 5)]
    acini, misses = [], 0
    # Stop after 1,500 proposals in a row fail to fit.
    while misses < 1500:
        start = tree_pts[int(rng.integers(len(tree_pts)))]
        # Aim at a random point of the block near the branch point, so buds head into open tissue.
        aim = start + rng.normal(scale=40.0, size=3)
        direction = aim - start; direction /= np.linalg.norm(direction)
        mouth = start + direction * float(rng.uniform(4.0, 28.0))
        R_ac = float(rng.uniform(R_min, R_max))
        centre = mouth + direction * R_ac
        if not clear(start + direction * (r_ic + 1), mouth, r_ic, 0.5, ignore_near=start) or not clear(centre, centre, R_ac, 1.5, ignore_near=start):
            misses += 1
            continue
        misses = 0
        add_capsule(start, mouth, r_ic); add_capsule(centre, centre, R_ac)
        segments.append({'a': start, 'b': mouth, 'kind': 'intercalated', 'r': r_ic})
        # The acinus frame: lumen at the origin, the intra-acinar duct entering from -z.
        acini.append({'centre': [round(float(x), 2) for x in centre], 'r': round(R_ac, 2), 'q': [round(float(x), 6) for x in quat_from_z(direction, float(rng.uniform(0, 2 * np.pi)))]})
        tree_pts += [start + t * (mouth - start) for t in (0.35, 0.7, 1.0)]

    # Second pass: fill the pockets random budding missed. Scan a 6 um grid for free space, largest pockets first; in
    # each, place the largest acinus that fits (up to the maximum radius), joined by a clear intercalated duct to one of
    # the nearest points already on the tree. The same rules hold: one duct per acinus, no overlaps, no joined acini.
    g_ = np.arange(-half + R_min, half - R_min + 1e-6, 6.0)
    grid_ = np.stack(np.meshgrid(g_, g_, g_, indexing='ij'), -1).reshape(-1, 3)
    grid_ = grid_[np.linalg.norm(grid_ - islet_centre, axis=1) > islet_radius + R_min + 1.5]
    for _pass in range(3):
        otree_ = cKDTree(np.array(obstacles_p)); orr_all = np.array(obstacles_r)
        d_, i_ = otree_.query(grid_)
        room = d_ - orr_all[i_] - 1.5
        room = np.minimum(room, half - np.max(np.abs(grid_), axis=1))
        order_ = np.argsort(-room)
        placed_now = 0
        for k_ in order_:
            if room[k_] < R_min:
                break
            c_ = grid_[k_]
            R_ac = float(min(room[k_], R_max))
            if not clear(c_, c_, R_ac, 1.5):
                continue
            tp_ = np.array(tree_pts)
            near_ = np.argsort(np.linalg.norm(tp_ - c_, axis=1))[:10]
            for j_ in near_:
                start = tp_[j_]
                gap_ = np.linalg.norm(c_ - start) - R_ac
                if gap_ < 4.0 or gap_ > 30.0:
                    continue
                direction = (c_ - start) / np.linalg.norm(c_ - start)
                mouth = c_ - direction * R_ac
                if not clear(start + direction * (r_ic + 1), mouth, r_ic, 0.5, ignore_near=start):
                    continue
                add_capsule(start, mouth, r_ic); add_capsule(c_, c_, R_ac)
                segments.append({'a': start, 'b': mouth, 'kind': 'intercalated', 'r': r_ic})
                acini.append({'centre': [round(float(x), 2) for x in c_], 'r': round(R_ac, 2),
                              'q': [round(float(x), 6) for x in quat_from_z(direction, float(rng.uniform(0, 2 * np.pi)))]})
                tree_pts += [start + t * (mouth - start) for t in (0.35, 0.7, 1.0)]
                placed_now += 1
                break
        print(f'fill pass {_pass + 1}: {placed_now} acini added', flush=True)
        if placed_now == 0:
            break

    # Capillaries: a network threading the gaps between acini. Candidate points lie in free space close to acinar
    # surfaces; neighbours are joined when the joining segment stays clear of every acinus, duct and the islet; a
    # minimum spanning tree plus the shortest extra links (so there are loops, as in a capillary bed) is kept.
    r_cap = V['capillaryRadiusUm']
    op, orr = np.array(obstacles_p), np.array(obstacles_r)
    otree = cKDTree(op)
    cand = rng.uniform(-half + 3, half - 3, (60000, 3))
    dd, ii = otree.query(cand)
    gap = dd - orr[ii]
    keep = (gap > r_cap + 0.8) & (gap < r_cap + 7) & (np.linalg.norm(cand - islet_centre, axis=1) > islet_radius + r_cap + 2)
    cand = cand[keep]
    sel = []
    for p_ in cand:  # thin the candidates to about one per 9 um
        if not sel or np.min(np.linalg.norm(np.array(sel[-400:]) - p_, axis=1)) > 9:
            sel.append(p_)
    nodes_c = np.array(sel)
    def seg_clear(a_, b_):
        n_ = max(2, int(np.ceil(np.linalg.norm(b_ - a_) / 2.0)) + 1)
        pts_ = np.array([a_ + t_ * (b_ - a_) for t_ in np.linspace(0, 1, n_)])
        d_, i_ = otree.query(pts_)
        if np.any(d_ - orr[i_] < r_cap + 0.5):
            return False
        return bool(np.min(np.linalg.norm(pts_ - islet_centre, axis=1)) > islet_radius + r_cap + 1)
    ctree = cKDTree(nodes_c)
    pairs = sorted({(min(i, j), max(i, j)) for i, row in enumerate(ctree.query(nodes_c, 6)[1]) for j in row[1:]})
    edges = [(i, j, float(np.linalg.norm(nodes_c[i] - nodes_c[j]))) for i, j in pairs
             if np.linalg.norm(nodes_c[i] - nodes_c[j]) < 24 and seg_clear(nodes_c[i], nodes_c[j])]
    edges.sort(key=lambda e: e[2])
    comp = list(range(len(nodes_c)))
    def find(x):
        while comp[x] != x:
            comp[x] = comp[comp[x]]; x = comp[x]
        return x
    tree_e, extra = [], []
    for i, j, w in edges:
        a_, b_ = find(i), find(j)
        if a_ != b_:
            comp[a_] = b_; tree_e.append((i, j))
        else:
            extra.append((i, j))
    cap_edges = tree_e + extra[: len(tree_e) // 6]
    # Islet capillaries: centrelines recovered from the islet model's tube mesh (8 vertices per ring).
    import struct as _st
    glb = (ATLAS / 'islet-representative.glb').read_bytes()
    jl = _st.unpack('<I', glb[12:16])[0]; jd = json.loads(glb[20:20 + jl]); binary = glb[28 + jl:]
    mesh = next(m for m in jd['meshes'] if m['name'] == 'capillaries')
    acc = jd['accessors'][mesh['primitives'][0]['attributes']['POSITION']]; bv = jd['bufferViews'][acc['bufferView']]
    pos = np.frombuffer(binary, '<f4', acc['count'] * 3, bv.get('byteOffset', 0) + acc.get('byteOffset', 0)).reshape(-1, 3).astype(float)
    rings_c = pos.reshape(-1, 8, 3).mean(1) + islet_centre
    islet_caps = [[rings_c[k], rings_c[k + 1]] for k in range(len(rings_c) - 1) if np.linalg.norm(rings_c[k + 1] - rings_c[k]) < 6]
    # How close each acinus is to a capillary.
    cap_pts = np.vstack([nodes_c[i] + t * (nodes_c[j] - nodes_c[i]) for i, j in cap_edges for t in np.linspace(0, 1, 5)])
    ac_c = np.array([a_['centre'] for a_ in acini])
    radii = np.array([a_['r'] for a_ in acini])
    reach = cKDTree(cap_pts).query(ac_c)[0] - radii - r_cap
    served = float(np.mean(reach <= V['capillaryReachUm']))

    # Stroma. Collagen along the intralobular ducts, aligned with them (CODA); short fibres and spindle-shaped stellate
    # cells in the remaining gaps between acini.
    fibres = []
    for seg in [s_ for s_ in segments if s_['kind'] == 'intralobular']:
        axis = seg['b'] - seg['a']; L_ = np.linalg.norm(axis)
        if L_ < 2:
            continue
        axis /= L_
        u = np.cross(axis, [0, 0, 1.0] if abs(axis[2]) < 0.9 else [1.0, 0, 0]); u /= np.linalg.norm(u); w = np.cross(axis, u)
        for k in range(10):
            th = 2 * np.pi * k / 10 + rng.uniform(0, 0.3)
            off = (u * np.cos(th) + w * np.sin(th)) * (seg['r'] + 1.2 + rng.uniform(0, 1.5))
            fibres.append({'a': seg['a'] + off, 'b': seg['b'] + off, 'r': 0.45, 'kind': 'periductal'})
    free = cand[rng.permutation(len(cand))]
    placed_cells, n_fib = [], 0
    for p_ in free:
        if n_fib >= 900:
            break
        d_ = rng.normal(size=3); d_ /= np.linalg.norm(d_)
        L_ = rng.uniform(12, 26)
        a_, b_ = p_ - d_ * L_ / 2, p_ + d_ * L_ / 2
        dd_, ii_ = otree.query(np.array([a_, p_, b_]))
        if np.all(dd_ - orr[ii_] > 0.6) and np.all(np.abs(np.array([a_, b_])) < half):
            fibres.append({'a': a_, 'b': b_, 'r': 0.3, 'kind': 'interstitial'}); n_fib += 1
    stellate = []
    size = V['stellateCellSizeUm']
    for p_ in free[::7]:
        if len(stellate) >= 140:
            break
        dd_, ii_ = otree.query(p_)
        if dd_ - orr[ii_] < size[1] / 2 + 0.5 or np.linalg.norm(p_ - islet_centre) < islet_radius + 4:
            continue
        if stellate and np.min(np.linalg.norm(np.array([q_['c'] for q_ in stellate]) - p_, axis=1)) < 20:
            continue
        # Lie flat against the nearest acinus or duct: long axis tangent to it.
        normal = (p_ - op[ii_]) / max(dd_, 1e-6)
        t_ = np.cross(normal, rng.normal(size=3)); t_ /= np.linalg.norm(t_)
        stellate.append({'c': p_, 'q': quat_from_z(t_, float(np.arctan2(normal[1], normal[0])))})

    # Deformation. Real acini press against one another and round the vessels between them. Each acinar cell grows
    # outward from its acinus's sphere along its own direction until it reaches the territory of a neighbouring acinus
    # (a power diagram, which splits space between spheres of different sizes), a capillary, a duct, the islet or the
    # edge of the block, stopping 0.5 um short; never beyond twice the acinus radius. The sphere itself is already
    # clear of everything, so no cell is shorter than the radius and nothing overlaps.
    def fib_dirs(n_cells):
        n_ = int(np.ceil(n_cells / 0.92)); ga = np.pi * (3 - np.sqrt(5)); out_ = []
        for i_ in range(n_):
            z_ = 1 - 2 * (i_ + 0.5) / n_; r_ = np.sqrt(1 - z_ * z_)
            out_.append([np.cos(i_ * ga) * r_, np.sin(i_ * ga) * r_, z_])
        out_ = np.array(out_)
        return out_[out_[:, 2] > -0.86][:n_cells], n_  # the same directions the viewer uses; none where the duct enters
    def rotate(q_, v_):
        x_, y_, z_, w_ = q_; u_ = np.array([x_, y_, z_])
        return v_ + 2 * np.cross(u_, np.cross(u_, v_) + w_ * v_)
    cap_samples, duct_p, duct_r = [], [], []
    for i_, j_ in cap_edges:
        a_, b_ = nodes_c[i_], nodes_c[j_]
        for t_ in np.linspace(0, 1, max(2, int(np.linalg.norm(b_ - a_)) + 1)):
            cap_samples.append(a_ + t_ * (b_ - a_))
    for seg in segments:
        a_, b_ = seg['a'], seg['b']
        for t_ in np.linspace(0, 1, max(2, int(np.linalg.norm(b_ - a_)) + 1)):
            duct_p.append(a_ + t_ * (b_ - a_)); duct_r.append(seg['r'])
    cap_tree, duct_tree = cKDTree(np.array(cap_samples)), cKDTree(np.array(duct_p))
    duct_r = np.array(duct_r)
    centres_ = np.array([a_['centre'] for a_ in acini]); radii_ = np.array([a_['r'] for a_ in acini])
    ac_tree = cKDTree(centres_)
    for idx_, a_ in enumerate(acini):
        r_ = a_['r']; c_ = centres_[idx_]
        a_['cells'] = int(round(4 * np.pi * r_ ** 2 / (np.pi * (V['acinarCellBaseUm'] / 2) ** 2) * 0.82))
        dirs_, _ = fib_dirs(a_['cells'])
        world = np.array([rotate(a_['q'], d_) for d_ in dirs_])
        ts = np.arange(r_, 2 * r_ + 0.01, 0.6)
        pts_ = c_[None, None, :] + world[:, None, :] * ts[None, :, None]          # cells x steps x 3
        flat = pts_.reshape(-1, 3)
        blocked = np.zeros(len(flat), bool)
        blocked |= cap_tree.query(flat)[0] < r_cap + 0.6
        dd_, ii_ = duct_tree.query(flat); blocked |= dd_ < duct_r[ii_] + 0.5
        blocked |= np.linalg.norm(flat - islet_centre, axis=1) < islet_radius + 1.0
        blocked |= np.any(np.abs(flat) > half, axis=1)
        own = np.sum((flat - c_) ** 2, axis=1) - r_ ** 2
        nd_, ni_ = ac_tree.query(flat, 8)
        other = np.sum((flat[:, None, :] - centres_[ni_]) ** 2, axis=2) - radii_[ni_] ** 2
        other[ni_ == idx_] = np.inf
        blocked |= np.any(other < own[:, None], axis=1)
        blocked = blocked.reshape(len(world), len(ts))
        first = np.where(blocked.any(axis=1), blocked.argmax(axis=1), len(ts))
        ext = np.maximum(r_, ts[np.maximum(first - 1, 0)] - 0.5)
        ext[first == 0] = r_
        a_['ext'] = [round(float(e_), 1) for e_ in ext]
    # Packing, measured: the share of random points of the block that fall inside some acinar cell.
    probe = rng.uniform(-half, half, (120000, 3))
    _, owner_ = ac_tree.query(probe, 8)
    pw = np.sum((probe[:, None, :] - centres_[owner_]) ** 2, axis=2) - radii_[owner_] ** 2
    owner_ = owner_[np.arange(len(probe)), pw.argmin(axis=1)]
    inside_ = 0
    for k_, p_ in enumerate(probe):
        a_ = acini[owner_[k_]]; v_ = p_ - centres_[owner_[k_]]; dist_ = np.linalg.norm(v_)
        if dist_ > 2 * a_['r'] or dist_ < V['acinarLumenRadiusUm']:
            continue
        q_ = a_['q']; inv = [-q_[0], -q_[1], -q_[2], q_[3]]
        local = rotate(inv, v_ / dist_)
        dirs_, _ = fib_dirs(a_['cells'])
        k2 = int(np.argmax(dirs_ @ local))
        if dirs_[k2] @ local > np.cos(np.arccos(1 - 2 / np.ceil(a_['cells'] / 0.92)) * 1.15) and dist_ <= a_['ext'][k2]:
            inside_ += 1
    packed = inside_ / len(probe)

    # Counts and fractions, for the manifest.
    n_ac = len(acini)
    # Orange segments: cells converge on the lumen; their number follows from the acinus surface and the cell base.
    acinar_cells = sum(a_['cells'] for a_ in acini)
    ic_len = sum(np.linalg.norm(s['b'] - s['a']) for s in segments if s['kind'] == 'intercalated')
    acinus_volume = float(np.sum(4 / 3 * np.pi * radii ** 3)) / max(n_ac, 1)
    block_volume = V['blockSizeUm'] ** 3
    islet_volume = 4 / 3 * np.pi * islet_radius ** 3

    out = {
        'schemaVersion': 'humanbio.tissue-block.v3',
        'evidence': 'simulated: built from published descriptions and measurements, not imaged tissue',
        'units': 'micrometres', 'seed': SEED + seed_offset, 'region': region, 'parameters': PARAMETERS,
        'acinusGeometry': {'radiusRangeUm': [R_min, R_max], 'deformation': 'each acinus lists ext: how far each of its cells reaches from the centre, in the order of its cell directions', 'cellsPerAcinusNote': 'each acinus lists its radius r and its number of cells',
                           'note': 'A rounded acinus: rounded wedge-shaped cells converge on a small central lumen like orange segments, '
                                   'their directions spread evenly over the sphere except where the intra-acinar duct enters from -z; '
                                   'centroacinar cells line that duct from the mouth to the lumen.'},
        'acini': acini,
        'ducts': [{'a': [round(float(x), 2) for x in s['a']], 'b': [round(float(x), 2) for x in s['b']], 'kind': s['kind'],
                   'r': round(float(s['r']), 2)} for s in segments],
        'capillaries': {'nodes': [[round(float(x), 2) for x in n_] for n_ in nodes_c], 'edges': [[int(i), int(j)] for i, j in cap_edges],
                        'isletSegments': [[[round(float(x), 2) for x in a_], [round(float(x), 2) for x in b_]] for a_, b_ in islet_caps]},
        'stroma': {'fibres': [{'a': [round(float(x), 2) for x in f_['a']], 'b': [round(float(x), 2) for x in f_['b']], 'r': f_['r'], 'kind': f_['kind']} for f_ in fibres],
                   'stellateCells': [{'c': [round(float(x), 2) for x in q_['c']], 'q': [round(float(x), 6) for x in q_['q']]} for q_ in stellate]},
        'islet': {'centreUm': [round(float(x), 2) for x in islet_centre], 'radiusUm': islet_radius, 'cells': islet_cells,
                  'source': 'islet-representative.manifest.json'},
        'result': {
            'intralobularSegments': sum(1 for s_ in segments if s_['kind'] == 'intralobular'),
            'capillarySegments': len(cap_edges), 'isletCapillarySegments': len(islet_caps),
            'aciniWithinReachOfCapillary': round(served, 3), 'collagenFibres': len(fibres), 'stellateCells': len(stellate),
            'acini': n_ac, 'acinarCells': acinar_cells,
            'centroacinarCells': n_ac * V['centroacinarCellsPerAcinus'], 'isletCells': len(islet_cells),
            'intercalatedDuctLengthUm': round(float(ic_len), 0),
            'acinarVolumeFraction': round(float(packed), 3),
            'acinarVolumeFractionAsSpheres': round(float(n_ac * acinus_volume / block_volume), 3),
            'isletVolumeFraction': round(float(islet_volume / block_volume), 3),
            'note': 'The block was chosen to hold an islet, so its islet fraction is far above the 1-2% of the whole gland; '
                    'stroma, vessels and nerves between the acini are not drawn.',
        },
    }
    data = (json.dumps(out, separators=(',', ':')) + '\n').encode()
    out_name = 'tissue-block.json' if region == 'body' else f'tissue-block-{region}.json'
    (ATLAS / out_name).write_bytes(data)
    r = out['result']
    print(f'{r["acini"]} acini, {r["acinarCells"]:,} acinar cells; {r["centroacinarCells"]} centroacinar cells; '
          f'{r["isletCells"]} islet cells; intercalated ducts {r["intercalatedDuctLengthUm"]:.0f} um in all')
    print(f'capillary segments {r["capillarySegments"]} (+{r["isletCapillarySegments"]} in the islet), acini within reach {r["aciniWithinReachOfCapillary"]:.0%}; '
          f'{r["collagenFibres"]} collagen fibres, {r["stellateCells"]} stellate cells')
    print(f'acini as spheres {r["acinarVolumeFractionAsSpheres"]:.0%}; acinar volume fraction {r["acinarVolumeFraction"]:.0%}, islet {r["isletVolumeFraction"]:.0%}; {out_name} {len(data):,} bytes, sha256 {sha256(data)}')


if __name__ == '__main__':
    main()
