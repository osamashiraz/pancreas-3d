#!/usr/bin/env python3
"""Checks the atlas data (viewer/src/atlas.json) against the project's rules, without a browser.
  python3 viewer/test/atlas_check.py
Every entry has its sources, a one-line description and at least two things to look for; every image exists (a file in
viewer/assets/atlas, or an embedded histology image), is credited, and carries an open licence; every look-alike and group
it names exists; every image file is used. Exits non-zero on any failure."""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPEN = ('CC BY', 'CC BY-SA', 'CC0', 'Public domain')   # with or without a version; never NC or ND

def main():
    D = json.loads((ROOT / 'src' / 'atlas.json').read_text()); bad = []; groups = {g['key'] for g in D['groups']}; ids = [e['id'] for e in D['entries']]
    files = {p.name for p in (ROOT / 'assets' / 'atlas').glob('*.jpg')}; histo = {p.stem for p in (ROOT / 'assets' / 'histology').glob('*.jpg')}; used = set()
    if len(ids) != len(set(ids)): bad.append('duplicate entry ids')
    for e in D['entries']:
        tag = e.get('id', '?')
        for k in ('id', 'group', 'name', 'line', 'glance', 'sources', 'species'):
            if not e.get(k): bad.append(f'{tag}: no {k}')
        if e.get('group') not in groups: bad.append(f'{tag}: unknown group {e.get("group")}')
        if len(e.get('glance', [])) < 2: bad.append(f'{tag}: fewer than two things to look for')
        for m in e.get('mimics', []):
            if 'id' in m and m['id'] not in ids: bad.append(f'{tag}: look-alike {m["id"]} is not an entry')
            if not m.get('tell') or not (m.get('id') or m.get('name')): bad.append(f'{tag}: a look-alike without a name or a way to tell it apart')
        for im in e.get('images', []):
            src = im.get('src', '')
            if src.startswith('histo:'):
                if src[6:] not in histo: bad.append(f'{tag}: no histology image {src[6:]}')
            elif src.startswith('atlas/'):
                used.add(src[6:])
                if src[6:] not in files: bad.append(f'{tag}: missing file {src}')
            else: bad.append(f'{tag}: image source {src!r}')
            lic = im.get('licence', '')
            if not im.get('credit'): bad.append(f'{tag}: image without credit')
            if not lic.startswith(OPEN) or 'NC' in lic or 'ND' in lic: bad.append(f'{tag}: licence {lic!r} is not open')
    for e in D['entries']:
        if e.get('thumb'):
            used.add(e['thumb'][6:])
            if e['thumb'][6:] not in files: bad.append(f"{e['id']}: missing thumbnail {e['thumb']}")
    for f in sorted(files - used): bad.append(f'unused image file {f}')
    n_img = sum(1 for e in D['entries'] if e.get('images'))
    print(f'{len(ids)} entries in {len(groups)} groups; {n_img} with an image, {len(ids) - n_img} without; {len(files)} image files')
    for b in bad: print('FAIL', b)
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
