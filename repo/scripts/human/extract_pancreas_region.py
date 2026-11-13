#!/usr/bin/env python3
"""Extract the pancreas and its neighbours from the HRA united body models.

Original integration code: MIT. The output GLBs are derived from the HRA 3D Reference
Object Library and keep its licence, CC BY 4.0.

What it does, and what it does not do:
- Reads 3d-vh-m-united.glb and 3d-vh-f-united.glb (HRA ccf-releases v2.0) and refuses any
  file whose SHA-256 differs from the one recorded below.
- Copies the POSITION, NORMAL and index bytes of each named node unchanged. Every node used
  here has an identity world transform in the source (checked again at run time), so the
  coordinates stay in the HRA frame, in metres. No smoothing, welding, decimation or repair.
- Drops tangents, texture coordinates and materials, which the viewer does not use.
- Records for each node the SHA-256 of its POSITION bytes, which is the same in source and
  output, so anyone can confirm that the geometry was not changed.
- Lists any requested node that the source lacks. It never substitutes another node.

Usage:
  python3 scripts/human/extract_pancreas_region.py <dir with the united GLBs> public/atlas-human
Needs numpy. The united models ship zipped (male) and 7z-compressed (female); unpack them first.
"""
import hashlib, json, struct, sys
from pathlib import Path
import numpy as np

SOURCES = {
    'male': {'file': '3d-vh-m-united.glb', 'sha256': '34c45c90aa4acd36be19edf8b878a8e7137db9e8cb90e8e6332c2abd49d7cf9d',
             'archive': '3d-vh-m-united.glb.zip', 'archiveSha256': '8e7e941afaf685b13b614586ae078444fdbbdd1ca4ded8cf62b7d766e3fd41d5', 'prefix': 'VH_M_'},
    'female': {'file': '3d-vh-f-united.glb', 'sha256': '472567a56896b9b7890508da6501fbf858e56aaa30745365f7a71ade782b529c',
               'archive': '3d-vh-f-united.glb.7z', 'archiveSha256': 'b84f820009075c154edcf1491539516ef475e788528cdc0cd670c04ee151b99d', 'prefix': 'VH_F_'},
}
RELEASE = {'repository': 'https://github.com/hubmapconsortium/ccf-releases', 'version': 'v2.0', 'commit': 'b036a91aaf7234f462b1249d4a5f4fb0e982f412', 'license': 'CC-BY-4.0'}

# Node names without the sex prefix. Where the sexes spell a node differently, both spellings are listed;
# exactly one must exist in each source. Keep in step with src/domain/human-pancreas-structures.ts; tests/human-pancreas.test.ts checks it.
NODES = [
    'head_of_pancreas', ('uncinate_process_of_the_pancreas', 'ucinate_process1'), 'neck_of_pancreas', 'body_of_pancreas', 'tail_of_pancreas',
    'ventral_pancreatic_duct', 'dorsal_pancreatic_duct', 'common_bile_duct', 'hepatopancreatic_ampulla',
    ('sphincter_of_hepatopancreatic_ampulla', 'sphincter_of_heptopancreatic_ampulla'),
    'celiac_trunk', 'common_hepatic_artery', 'proper_hepatic_artery', 'splenic_artery', 'superior_mesenteric_artery',
    'splenic_vein', 'superior_mesenteric_vein', 'hepatic_portal_vein', 'inferior_pancreaticoduodenal_vein',
    'duodenum_superior', 'duodenum_descending', ('duodenum_horizonal', 'duodenum_horizontal'), 'duodenum_ascending', 'duodenal_ampulla',
    'hilum_of_spleen', 'gastric_surface_of_spleen', 'renal_surface_of_spleen', 'colic_surface_of_spleen', 'diaphragmatic_surface_of_spleen',
]

COMPONENT = {5126: ('<f4', 4), 5125: ('<u4', 4), 5123: ('<u2', 2), 5121: ('u1', 1)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Glb:
    def __init__(self, data: bytes):
        magic, version, _ = struct.unpack('<III', data[:12])
        if magic != 0x46546C67 or version != 2:
            raise SystemExit('Not a glTF 2.0 binary.')
        json_len = struct.unpack('<I', data[12:16])[0]
        self.doc = json.loads(data[20:20 + json_len])
        bin_len = struct.unpack('<I', data[20 + json_len:24 + json_len])[0]
        self.bin = data[28 + json_len:28 + json_len + bin_len]
        self.parent = {c: i for i, n in enumerate(self.doc['nodes']) for c in n.get('children', [])}
        self.by_name = {n.get('name'): i for i, n in enumerate(self.doc['nodes'])}

    def raw(self, index: int) -> tuple[bytes, dict]:
        """The exact bytes of one accessor, tightly packed."""
        acc = self.doc['accessors'][index]
        view = self.doc['bufferViews'][acc['bufferView']]
        dtype, size = COMPONENT[acc['componentType']]
        width = WIDTH[acc['type']]
        stride = view.get('byteStride') or size * width
        if stride != size * width:
            raise SystemExit(f'Accessor {index} is interleaved; this script copies only packed accessors.')
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        return self.bin[start:start + acc['count'] * size * width], acc

    def local(self, node: dict) -> np.ndarray:
        if 'matrix' in node:
            return np.array(node['matrix'], dtype=float).reshape(4, 4).T
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        m = np.eye(4)
        m[:3, :3] = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                              [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                              [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]) * np.array(node.get('scale', [1, 1, 1]))
        m[:3, 3] = node.get('translation', [0, 0, 0])
        return m

    def world(self, index: int) -> np.ndarray:
        m = np.eye(4)
        while index is not None:
            m = self.local(self.doc['nodes'][index]) @ m
            index = self.parent.get(index)
        return m


def pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def extract(sex: str, src_dir: Path, out_dir: Path, node_list=None, out_name: str = '', root: str = 'pancreas_region') -> dict:
    meta = SOURCES[sex]
    data = (src_dir / meta['file']).read_bytes()
    if sha256(data) != meta['sha256']:
        raise SystemExit(f'{meta["file"]}: SHA-256 differs from the recorded value. Refusing to extract.')
    glb = Glb(data)
    body = bytearray()
    views, accessors, meshes, nodes, records, missing = [], [], [], [], [], []

    def add_accessor(raw: bytes, acc: dict, target: int) -> int:
        offset = len(body)
        body.extend(pad(raw, b'\x00'))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw), 'target': target})
        out = {k: acc[k] for k in ('componentType', 'count', 'type', 'min', 'max', 'normalized') if k in acc}
        out['bufferView'] = len(views) - 1
        accessors.append(out)
        return len(accessors) - 1

    for entry in (node_list or NODES):
        names = [meta['prefix'] + n for n in (entry if isinstance(entry, tuple) else (entry,))]
        found = [n for n in names if n in glb.by_name and 'mesh' in glb.doc['nodes'][glb.by_name[n]]]
        if len(found) != 1:
            missing.append(names[0] if not found else f'ambiguous: {found}')
            continue
        name = found[0]
        index = glb.by_name[name]
        if not np.allclose(glb.world(index), np.eye(4)):
            raise SystemExit(f'{name} has a non-identity world transform; baking it would change the bytes.')
        primitives, triangles, position_hashes, lo, hi = [], 0, [], None, None
        for prim in glb.doc['meshes'][glb.doc['nodes'][index]['mesh']]['primitives']:
            if prim.get('mode', 4) != 4 or 'indices' not in prim:
                raise SystemExit(f'{name}: only indexed triangle lists are supported.')
            pos_raw, pos_acc = glb.raw(prim['attributes']['POSITION'])
            attributes = {'POSITION': add_accessor(pos_raw, pos_acc, 34962)}
            if 'NORMAL' in prim['attributes']:
                attributes['NORMAL'] = add_accessor(*glb.raw(prim['attributes']['NORMAL']), 34962)
            idx_raw, idx_acc = glb.raw(prim['indices'])
            primitives.append({'attributes': attributes, 'indices': add_accessor(idx_raw, idx_acc, 34963), 'mode': 4})
            triangles += idx_acc['count'] // 3
            position_hashes.append(sha256(pos_raw))
            pts = np.frombuffer(pos_raw, dtype='<f4').reshape(-1, 3)
            lo = pts.min(0) if lo is None else np.minimum(lo, pts.min(0))
            hi = pts.max(0) if hi is None else np.maximum(hi, pts.max(0))
        meshes.append({'name': name, 'primitives': primitives})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
        records.append({'node': name, 'triangles': triangles, 'positionSha256': position_hashes,
                        'extentMm': [round(float(v) * 1000, 1) for v in (hi - lo)]})

    doc = {
        'asset': {'version': '2.0', 'generator': 'extract_pancreas_region.py',
                  'copyright': 'Derived from the HRA 3D Reference Object Library (HuBMAP), CC BY 4.0'},
        'extras': {'derivedFrom': {**RELEASE, 'file': meta['file'], 'sha256': meta['sha256']}},
        'scene': 0, 'scenes': [{'nodes': [len(nodes)]}],
        'nodes': nodes + [{'name': f'{meta["prefix"]}{root}', 'children': list(range(len(nodes)))}],
        'meshes': meshes, 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(body)}],
    }
    json_bytes = pad(json.dumps(doc, separators=(',', ':')).encode(), b' ')
    bin_bytes = bytes(body)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes \
        + struct.pack('<II', len(bin_bytes), 0x004E4942) + bin_bytes
    out_name = out_name or f'pancreas-region-{sex}.glb'
    (out_dir / out_name).write_bytes(out)
    return {'sex': sex, 'source': {**RELEASE, 'archive': meta['archive'], 'archiveSha256': meta['archiveSha256'],
                                   'file': meta['file'], 'sha256': meta['sha256']},
            'output': {'file': out_name, 'bytes': len(out), 'sha256': sha256(out), 'units': 'metres', 'frame': 'HRA, unchanged'},
            'nodes': records, 'missing': missing}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 'humanbio.region-extract.v1', 'license': 'CC-BY-4.0',
                'attribution': 'Human Reference Atlas 3D Reference Object Library (HuBMAP), from the Visible Human Project of the U.S. National Library of Medicine.',
                'method': 'Accessor bytes copied unchanged from named nodes with identity world transforms; tangents, texture coordinates and materials dropped.',
                'references': [extract(sex, src_dir, out_dir) for sex in ('male', 'female')]}
    (out_dir / 'pancreas-region.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for ref in manifest['references']:
        print(f'{ref["output"]["file"]}: {len(ref["nodes"])} nodes, {ref["output"]["bytes"]:,} bytes, missing {ref["missing"] or "none"}')


if __name__ == '__main__':
    main()
