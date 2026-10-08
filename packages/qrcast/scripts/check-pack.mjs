// Checks the packed tarball against what the package promises: every export and
// codec asset is in it, the licenses are in it, nothing stray is, and no code
// loads from a remote URL or registers a service worker. Run after `pnpm build`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codecAssets } from './assets.mjs';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(`${packageDir}dist/index.js`)) {
  console.error('dist/ is missing: run `pnpm build` first');
  process.exit(1);
}
const problems = [];

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: packageDir, encoding: 'utf8' }),
);
const packed = new Set(pack.files.map((file) => file.path));
const manifest = JSON.parse(readFileSync(`${packageDir}package.json`, 'utf8'));

const need = (path, why) => {
  if (!packed.has(path)) problems.push(`missing from the tarball: ${path} (${why})`);
};

for (const [subpath, target] of Object.entries(manifest.exports)) {
  for (const file of Object.values(target)) need(file.replace(/^\.\//, ''), `export ${subpath}`);
}
for (const [codec, files] of Object.entries(codecAssets)) {
  for (const [, name] of files) need(`dist/codecs/${codec}/${name}`, `${codec} asset`);
}
for (const file of ['package.json', 'README.md', 'LICENSE']) need(file, 'required file');

for (const path of packed) {
  if (!path.startsWith('dist/') && !['package.json', 'README.md', 'LICENSE'].includes(path)) {
    problems.push(`stray file in the tarball: ${path}`);
  }
}

// Remote URLs that appear in the emitted JavaScript without loading anything.
// The zxing-wasm default is replaced by `locateFile`; the smoke tests prove it
// by failing on any request that leaves the page's origin.
const allowedUrls = [
  ['dist/codecs/qr/qrcodegen.js', 'https://github.com/nayuki/QR-Code-generator/'],
  ['dist/codecs/qr/zxing_reader.js', 'https://fastly.jsdelivr.net/npm/zxing-wasm@'],
];
const scripts = [...packed].filter((path) => path.startsWith('dist/') && path.endsWith('.js'));
for (const path of scripts) {
  const text = readFileSync(`${packageDir}${path}`, 'utf8');
  for (const [url] of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    if (!allowedUrls.some(([file, prefix]) => file === path && url.startsWith(prefix))) {
      problems.push(`remote URL in ${path}: ${url}`);
    }
  }
  if (/serviceWorker\s*\.\s*register/.test(text)) problems.push(`service worker registration in ${path}`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`pack check passed: ${packed.size} files, ${scripts.length} scripts scanned`);
