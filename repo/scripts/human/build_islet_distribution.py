#!/usr/bin/env python3
"""Distribute islets of Langerhans through the HRA pancreas at published densities.

Original integration code: MIT. A model, not a measurement: the Visible Human was not stained for islets.

Reads   public/atlas-human/pancreas-region-<sex>.glb (checked against pancreas-region.manifest.json)
Writes  public/atlas-human/islets-<sex>.glb           (a sample: one point per SAMPLE_EVERY islets, in metres, HRA frame)
        public/atlas-human/islets.manifest.json      (every parameter with its source; results beside their targets)

Deterministic. Needs numpy and scipy.
"""
import hashlib, json, struct
from pathlib import Path
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT / 'public' / 'atlas-human'
HAHN = 'Hahn M, et al. 3D imaging of human organs with micrometer resolution - applied to the endocrine pancreas. Commun Biol 2021;4:1063. doi:10.1038/s42003-021-02589-x'
WANG = 'Wang X, et al. Regional differences in islet distribution in the human pancreas--preferential beta-cell loss in the head region in patients with type 2 diabetes. PLoS One 2013;8(6):e67454. doi:10.1371/journal.pone.0067454'

PARAMETERS = {
    'endocrineFraction': {'value': 0.015, 'source': HAHN, 'verified': True, 'note': 'Islets are about 1-2% of the pancreas; the middle of that range.'},
    'isletDiameterUm': {'value': 110.0, 'source': HAHN, 'verified': True,
                        'note': 'Mean 3D diameter. The count uses the volume of an islet of this diameter, which overestimates the count a little because islet sizes are skewed.'},
    'regionalDensity': {'value': {'pancreas-head': 1.0, 'pancreas-uncinate': 1.0, 'pancreas-neck': 1.0, 'pancreas-body': 1.0, 'pancreas-tail': 2.0},
                        'source': WANG, 'verified': True,
                        'note': 'Similar in head and body, more than 2-fold higher in the tail; 2.0 is the low end. Neck and uncinate are not reported and are taken as head and body.'},
    'clusterShare': {'value': 0.40, 'source': HAHN, 'verified': True, 'note': 'About 40% of islets lay in high islet density regions in non-diabetic tissue.'},
    'clusterDensityFactor': {'value': 3.0, 'source': HAHN, 'verified': True, 'note': 'Islet count in high islet density regions about three times the average.'},
    'clusterIslets': {'value': [100, 400], 'source': None, 'verified': False,
                      'note': 'Hahn et al. define a cluster as more than 100 islets; the upper bound and the even spread between are assumptions.'},
    'peripheryMm': {'value': 3.0, 'source': None, 'verified': False,
                    'note': 'Clusters lie "in the periphery of the gland" (Hahn); their centres are put within this depth of the surface, an assumption.'},
}
SEED = 20210910       # Hahn et al. publication date
VOX = 0.5             # mm
SAMPLE_EVERY = 100    # one stored point per this many islets
REGIONS = {'pancreas-head': ('head_of_pancreas',), 'pancreas-uncinate': ('uncinate_process_of_the_pancreas', 'ucinate_process1'),
           'pancreas-neck': ('neck_of_pancreas',), 'pancreas-body': ('body_of_pancreas',), 'pancreas-tail': ('tail_of_pancreas',)}


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def read_glb(data: bytes) -> dict:
    n = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + n]); binary = data[28 + n:]
    def acc(i):
        a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]
        k = {'SCALAR': 1, 'VEC3': 3}[a['type']]; dt = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
        x = np.frombuffer(binary, dtype=dt, count=a['count'] * k, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
        return x.reshape(-1, k) if k > 1 else x
    out = {}
    for node in doc['nodes']:
        if 'mesh' in node:
            pr = doc['meshes'][node['mesh']]['primitives'][0]
            out[node['name'][5:]] = (acc(pr['attributes']['POSITION']).astype(float) * 1000, acc(pr['indices']).astype(np.int64).reshape(-1, 3))
    return out


def surface_points(P, F, step):
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    n = np.ceil(np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1)) / step).astype(int) + 1
    out = []
    for k in np.unique(n):
        i = np.where(n == k)[0]
        u, v = np.meshgrid(np.linspace(0, 1, k), np.linspace(0, 1, k)); m = (u + v) <= 1; u, v = u[m], v[m]
        out.append((a[i, None] * (1 - u - v)[None, :, None] + b[i, None] * u[None, :, None] + c[i, None] * v[None, :, None]).reshape(-1, 3))
    return np.vstack(out)


def write_points_glb(groups: list, derived: dict) -> bytes:
    body, views, accs, meshes, nodes = bytearray(), [], [], [], []
    for name, extras, pts in groups:
        raw = (pts / 1000.0).astype('<f4').tobytes()
        views.append({'buffer': 0, 'byteOffset': len(body), 'byteLength': len(raw), 'target': 34962})
        body.extend(raw)
        accs.append({'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(pts), 'type': 'VEC3',
                     'min': [float(x) for x in (pts / 1000).min(0)], 'max': [float(x) for x in (pts / 1000).max(0)]})
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': len(accs) - 1}, 'mode': 0}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'extras': extras})
    doc = {'asset': {'version': '2.0', 'generator': 'build_islet_distribution.py'}, 'extras': {'derivedFrom': derived},
           'scene': 0, 'scenes': [{'nodes': [len(nodes)]}], 'nodes': nodes + [{'name': 'islets', 'children': list(range(len(nodes)))}],
           'meshes': meshes, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(body)}]}
    js = json.dumps(doc, separators=(',', ':'), sort_keys=True).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    return struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(body)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
        + struct.pack('<II', len(body), 0x004E4942) + bytes(body)


def build(sex: str, region_meta: dict) -> dict:
    data = (ATLAS / region_meta['output']['file']).read_bytes()
    if sha256(data) != region_meta['output']['sha256']:
        raise SystemExit(f'{region_meta["output"]["file"]}: SHA-256 differs from its manifest.')
    meshes = read_glb(data)
    P = {k: v['value'] for k, v in PARAMETERS.items()}
    rng = np.random.default_rng(SEED + (0 if sex == 'male' else 1))
    # The organ as voxels: rasterize the union of the five region surfaces, fill the inside.
    pts = {}
    for key, names in REGIONS.items():
        name = next(n for n in names if n in meshes)
        pts[key] = surface_points(*meshes[name], VOX / 2)
    allp = np.vstack(list(pts.values()))
    lo = allp.min(0) - 2
    shape = tuple(np.ceil((allp.max(0) + 2 - lo) / VOX).astype(int) + 1)
    surf = np.zeros(shape, bool); surf[tuple(np.floor((allp - lo) / VOX).astype(int).T)] = True
    filled = ndimage.binary_fill_holes(surf)
    inside = filled & ~surf
    if inside.sum() * VOX ** 3 < 10_000:
        raise SystemExit(f'{sex}: the surface did not close; the fill found only {inside.sum() * VOX ** 3:.0f} mm3')
    volume = (inside.sum() + 0.5 * surf.sum()) * VOX ** 3  # surface voxels counted half
    depth = ndimage.distance_transform_edt(filled) * VOX
    # Each inside voxel belongs to the region whose surface is nearest.
    from scipy.spatial import cKDTree
    labels = np.concatenate([np.full(len(v), i) for i, v in enumerate(pts.values())])
    vox = np.argwhere(inside)
    centres = lo + (vox + 0.5) * VOX
    owner = labels[cKDTree(allp).query(centres)[1]]
    keys = list(pts.keys())
    region_volume = {k: float((owner == i).sum() * VOX ** 3) for i, k in enumerate(keys)}

    islet_volume = 4 / 3 * np.pi * (P['isletDiameterUm'] / 2000) ** 3  # mm3
    total = int(round(P['endocrineFraction'] * volume / islet_volume))
    weight = {k: P['regionalDensity'][k] * region_volume[k] for k in keys}
    wsum = sum(weight.values())
    mean_density = total / volume
    background, clustered = [], []
    counts = {}
    for i, k in enumerate(keys):
        n_r = total * weight[k] / wsum
        n_bg, n_cl = int(round(n_r * (1 - P['clusterShare']))), int(round(n_r * P['clusterShare']))
        idx = np.where(owner == i)[0]
        # Background islets: uniform through the region's voxels.
        pick = rng.choice(idx, n_bg)
        background.append(centres[pick] + rng.uniform(-VOX / 2, VOX / 2, (n_bg, 3)))
        # Clusters: centres near the surface, islets at three times the region's mean density round them.
        shell = idx[depth[tuple(vox[idx].T)] <= P['peripheryMm']]
        rho = P['clusterDensityFactor'] * mean_density * P['regionalDensity'][k]
        placed, n_clusters = 0, 0
        while placed < n_cl:
            size = min(int(rng.integers(P['clusterIslets'][0], P['clusterIslets'][1] + 1)), n_cl - placed)
            c = centres[rng.choice(shell)]
            radius = (3 * size / (4 * np.pi * rho)) ** (1 / 3)
            got = []
            while len(got) < size:  # rejection: keep islets inside the organ
                q = c + rng.uniform(-radius, radius, (size * 3, 3))
                q = q[np.linalg.norm(q - c, axis=1) <= radius]
                ijk = np.floor((q - lo) / VOX).astype(int)
                ok = np.all((ijk >= 0) & (ijk < shape), axis=1)
                q, ijk = q[ok], ijk[ok]
                q = q[filled[tuple(ijk.T)]]
                got.extend(q[: size - len(got)])
            clustered.append(np.array(got)); placed += size; n_clusters += 1
        counts[k] = {'islets': n_bg + n_cl, 'clusters': n_clusters, 'volumeMm3': round(region_volume[k], 0),
                     'densityPerMm3': round((n_bg + n_cl) / region_volume[k], 2)}
    bg, cl = np.vstack(background), np.vstack(clustered)
    # Store a fixed sample: one point per SAMPLE_EVERY islets of each kind.
    bg_s = bg[rng.permutation(len(bg))[: len(bg) // SAMPLE_EVERY]]
    cl_s = cl[rng.permutation(len(cl))[: len(cl) // SAMPLE_EVERY]]
    glb = write_points_glb([('islets--background', {'kind': 'background', 'represents': SAMPLE_EVERY}, bg_s),
                            ('islets--clustered', {'kind': 'clustered', 'represents': SAMPLE_EVERY}, cl_s)],
                           {'file': region_meta['output']['file'], 'sha256': region_meta['output']['sha256']})
    out = f'islets-{sex}.glb'
    (ATLAS / out).write_bytes(glb)
    head_body = (counts['pancreas-head']['islets'] + counts['pancreas-body']['islets']) / (region_volume['pancreas-head'] + region_volume['pancreas-body'])
    return {'sex': sex, 'organVolumeCm3': round(volume / 1000, 1), 'organVolumeNote': 'Voxels of 0.5 mm, surface voxels counted half. Hahn et al. give an average human pancreas of about 73 cm3.',
            'islets': int(len(bg) + len(cl)), 'meanDensityPerMm3': round(mean_density, 2), 'regions': counts,
            'tailToHeadBodyDensity': round(counts['pancreas-tail']['densityPerMm3'] / head_body, 3),
            'clusteredShare': round(len(cl) / (len(bg) + len(cl)), 4),
            'output': {'file': out, 'bytes': len(glb), 'sha256': sha256(glb), 'sampleEvery': SAMPLE_EVERY,
                       'points': {'background': int(len(bg_s)), 'clustered': int(len(cl_s))}}}


def main() -> None:
    region = {r['sex']: r for r in json.loads((ATLAS / 'pancreas-region.manifest.json').read_text())['references']}
    refs = [build(sex, region[sex]) for sex in ('male', 'female')]
    manifest = {'schemaVersion': 'humanbio.islet-distribution.v1', 'evidence': 'simulated: islets placed at published densities, not imaged',
                'seed': SEED, 'voxelMm': VOX, 'parameters': PARAMETERS, 'references': refs}
    (ATLAS / 'islets.manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    for r in refs:
        print(f'{r["sex"]}: organ {r["organVolumeCm3"]} cm3, {r["islets"]:,} islets ({r["meanDensityPerMm3"]}/mm3), tail : head+body density '
              f'{r["tailToHeadBodyDensity"]}, clustered {r["clusteredShare"]:.1%}')
        for k, c in r['regions'].items():
            print(f'   {k:18s} {c["volumeMm3"]/1000:5.1f} cm3  {c["islets"]:8,} islets  {c["densityPerMm3"]:5.1f}/mm3  {c["clusters"]} clusters')
        print(f'   {r["output"]["file"]}: {r["output"]["bytes"]:,} bytes, sha256 {r["output"]["sha256"]}')


if __name__ == '__main__':
    main()
