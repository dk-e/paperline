import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(`node_modules/pdfjs-dist/${directory}`, `dist/pdfjs/${directory}`, { recursive: true });
}
await writeFile('dist/THIRD-PARTY-LICENSES.txt', [
  'Paperline bundles PDF.js (Apache-2.0), pdf-lib and @pdf-lib/fontkit (MIT), React (MIT), lucide (ISC), idb-keyval (Apache-2.0), and Noto Sans (SIL Open Font License 1.1).',
  ...await Promise.all(['pdfjs-dist/LICENSE', 'pdf-lib/LICENSE.md', '@pdf-lib/fontkit/LICENSE.md', 'react/LICENSE', 'react-dom/LICENSE', 'idb-keyval/LICENCE', 'lucide-react/LICENSE'].map(async p => {
    try { return `\n\n--- ${p} ---\n${await readFile(`node_modules/${p}`, 'utf8')}`; } catch { return ''; }
  })),
  `\n\n--- Noto Sans ---\n${await readFile('public/fonts/OFL.txt', 'utf8')}`,
  `\n\n--- Fontkit ---\n${await readFile('public/fonts/FONTKIT-LICENSE.txt', 'utf8')}`,
].join('\n'));
await mkdir('release', { recursive: true });
const { version } = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const archive = `release/paperline-${version}.zip`;
execFileSync('python3', ['scripts/zip_extension.py', 'dist', archive, '--include-parent']);
const storeArchive = `release/paperline-${version}-chrome-web-store.zip`;
execFileSync('python3', ['scripts/zip_extension.py', 'dist', storeArchive]);
console.log(`Ready: dist/ (Load unpacked), ${archive}, and ${storeArchive} (manifest at ZIP root)`);
