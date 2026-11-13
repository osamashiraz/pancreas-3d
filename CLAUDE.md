# CLAUDE.md — Human pancreas 3D (organ to cell)

You are continuing a project that builds a source-grounded 3D model of the human pancreas, from the whole organ down to single cells, as a module for MouseBio_3D (https://github.com/Qasim-Hussain-Code/MouseBio_3D) plus a standalone zoom viewer. Read `README.md`, then `docs/SPEC.md` and `docs/BACKLOG.md` before changing anything.

## Layout

- `repo/` — files to copy into a MouseBio_3D checkout, at the same paths. They are the tested module: inventory, generators, loader, tests, Python builders, model data.
- `viewer/` — the standalone zoom viewer: `template.html`, `src/app.js`, `src/generator.js` (compiled from the TypeScript generator), `build_viewer.py`, `compile_generator.mjs`, `test/smoke.py`, `test/profile.py` (draw calls, triangles and frame times per stage; `--dpr2` for Retina), and earlier pages in `legacy/`.
- `viewer/src/atlas.json` — the atlas (gallery) entries: text in our own words with sources and pages, and each image's credit and licence. `viewer/assets/atlas/` holds its images (copied to `dist/atlas/` by the build, loaded lazily); `viewer/test/atlas_check.py` enforces sources, credits and open licences. Facts come from `docs/book-notes/atlas-facts.json`.
- `dist/pancreas-organ-to-cell.html` — the current built viewer (identical to the published version), with `dist/atlas/` beside it.
- `docs/` — specification, backlog, change history, sources; `docs/images/` holds the README screenshots.
- `.github/workflows/pages.yml` — publishes `dist/pancreas-organ-to-cell.html` as the GitHub Pages site (`index.html`) on every push to `main` that changes `dist/`.
- `scripts/install_into_mousebio.sh` — copies `repo/` into a checkout and runs the checks.

## Commands

The GitHub repository is `osamashiraz/pancreas-atlas` (renamed from `pancreas-3d`; site: https://osamashiraz.github.io/pancreas-atlas/). The paths below use the local folder's name, which may still be `pancreas-3d`.

```bash
git clone https://github.com/Qasim-Hussain-Code/MouseBio_3D && cd MouseBio_3D && npm ci
bash ../pancreas-3d/scripts/install_into_mousebio.sh .        # copy the module in, type-check, run its tests
npx tsc --noEmit -p .                                          # type-check
npx tsx --test tests/human-pancreas.test.ts                    # module tests (23)
npm test                                                       # full suite (699 with the module)
npx tsx scripts/human/export_inventory.ts                      # after editing the inventory
python3 scripts/human/place_simulated.py                       # rebuild simulated vessels and lymph nodes (minutes; numpy, scipy)
python3 scripts/human/build_tissue_block.py [body|head|tail]   # rebuild a tested tissue block (minutes)
python3 scripts/human/build_islet.py                           # rebuild the representative islet
python3 scripts/human/build_islet_distribution.py              # rebuild islet distribution
node ../pancreas-3d/viewer/compile_generator.mjs ../pancreas-3d/viewer/src/generator.js   # after editing the TS generator
python3 ../pancreas-3d/viewer/build_viewer.py . ../pancreas-3d/dist/pancreas-organ-to-cell.html
```

After any builder run, copy the new byte counts and SHA-256 values into the registries (`src/viewer/human-pancreas-loader.ts`, `src/domain/human-pancreas-tissue.ts`); the tests fail until data, manifests and registries agree. Long builds can exceed a shell time limit: run them in the background and poll.

## Rules that the project depends on

1. Every structure, parameter and number has evidence: `source` (drawn by HRA from the Visible Human), `traced`, or `simulated` (placed by a written rule). Never present simulated geometry as measured.
2. Every parameter either names its source or is marked not yet sourced (`verified: false` / `sourced: false` / `source: null`). Tests enforce this. Do not invent citations; check them (PubMed, DOI) before marking verified. One reference is still unverified: Gray's Anatomy 42nd ed. The Japan Pancreas Society classification was checked against its eighth edition (Ishida et al. 2024), whose station names match the model's except the a/b split of 13 and 17 (from earlier editions) and the t/op split of 14.
3. Ontology terms are copied from HRA files (crosswalk, ASCT+B), never typed from memory. Known errors in HRA files are listed in `data/human-pancreas-ontology-candidates.json` and not silently fixed.
4. Model files are checksum-registered and loaded through MouseBio_3D's bounded fetch (`fetchBoundGlb`). Builders are deterministic: same seed, same bytes.
5. Rules for tissue are checked by tests: one intercalated duct per acinus ending at it; no acini overlapping or inside the islet; every acinar cell's reach between its acinus radius and twice it; packing above 45%; capillary within reach of every acinus; islet composition and size statistics.
6. Images shown on the site must be openly licensed (CC BY, CC BY-SA, CC0, public domain) with the licence read on the source page; never textbook, journal-copyright or Johns Hopkins figures, including those in the user's reference spreadsheet. Narration and on-page text are written in our own words, paraphrased from open sources (StatPearls CC BY 4.0, university histology notes, HPA), with credit. Do not reproduce copyrighted textbook text.
7. Report honestly: when a number looked good because of a bug (the 66% packing that came from overlapping acini), say so and fix the test.

## Gotchas

- The repo uses TypeScript 7 (the native compiler); its JS API differs, so compile the generator with esbuild (`compile_generator.mjs`), not `typescript.transpileModule`.
- three.js strips `/ : . [ ]` from glTF node names: simulated nodes are named `sim--human-<sex>--<structure>--<branch>`.
- The standalone viewer uses three.js r147 UMD builds from jsDelivr (r148 removed `examples/js`). The repo itself uses ES modules (three 0.184).
- `Box3.setFromObject` on an InstancedMesh only covers the prototype in r147: frame instanced content by known size.
- HRA region meshes are open surfaces: no volumes from them. The whole organ (union of regions) closes and is voxelized for volumes.
- The layered openings are discards in the fragment shader (`layered()` in `viewer/src/app.js`). Raycasts and labels do not see them, so picking and names test `inCore()` or the group's layer frame; keep them in step with the shader.
- Performance: the layered openings discard in the fragment shader, so anything outside a layer still costs vertices and overdraw. Build only what can be seen (the block keeps only what can lie in the core); check `profile.py --dpr2` after adding geometry.
- `pkill -f <name>` kills your own shell if the name appears in the command line.
- Headless Chromium renders WebGL in software: viewer tests take minutes; drive UI through `window.__zoom` and `element.click()` from `evaluate`, not Playwright clicks.
