// Compile src/domain/human-pancreas-generator.ts to viewer/src/generator.js (window.HPGen), using the esbuild that tsx ships with.
// Run from the MouseBio_3D checkout:  node <package>/viewer/compile_generator.mjs <package>/viewer/src/generator.js
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let es; try { es = require('esbuild'); } catch { es = require(require.resolve('esbuild', { paths: [require.resolve('tsx', { paths: [process.cwd()] })] })); }
const src = readFileSync('src/domain/human-pancreas-generator.ts', 'utf8');
const out = es.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2020' }).code;
const js = 'window.HPGen = (() => {\n' + out.replace(/^export /gm, '').replace(/^export \{[^}]*\};?$/gm, '') + '\nreturn { generateBlock, generateIslet, fibDirs, PARAMS };\n})();\n';
writeFileSync(process.argv[2] || 'generator.js', js); console.log('wrote', process.argv[2], js.length, 'bytes');
