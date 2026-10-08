// Consumer smoke tests: installs the packed `qrcast` tarball into minimal apps
// (no bundler, Vite, webpack), builds them, checks the output holds the wasm
// and worker files, and loads each in headless Chromium.
//
//   node smoke/run.mjs [plain|vite|webpack ...]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPage } from './shared/check-page.mjs';

const smokeDir = fileURLToPath(new URL('.', import.meta.url));
const repoDir = join(smokeDir, '..');
const workDir = join(smokeDir, '.work');

// Pinned, so a new major version of a tool changes the tests only when we say so.
const projects = {
  plain: { dependencies: {}, build: null, output: '.', assets: 'node_modules/@thethingteam/qrcast/dist' },
  vite: { dependencies: { vite: '8.3.3' }, build: ['npx', 'vite', 'build'], output: 'dist', assets: 'dist' },
  webpack: {
    dependencies: { webpack: '5.111.1', 'webpack-cli': '7.2.3' },
    build: ['npx', 'webpack'],
    output: 'dist',
    assets: 'dist',
    copyHtml: true,
  },
};

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : Object.keys(projects);
for (const name of names) {
  if (!(name in projects)) throw new Error(`Unknown smoke project: ${name}`);
}

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

// Pack once, with the same command a publish uses.
const [{ filename }] = JSON.parse(
  execFileSync('npm', ['pack', '--json', '--pack-destination', workDir], {
    cwd: join(repoDir, 'packages/qrcast'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
);
const tarball = join(workDir, filename);

let failed = false;
for (const name of names) {
  const { dependencies, build, output, assets, copyHtml } = projects[name];
  const dir = join(workDir, name);
  console.log(`\n== smoke: ${name}`);
  cpSync(join(smokeDir, name), dir, { recursive: true });
  cpSync(join(smokeDir, 'shared/main.js'), join(dir, 'main.js'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `smoke-${name}`, private: true, type: 'module', dependencies: { '@thethingteam/qrcast': `file:${tarball}`, ...dependencies } }, null, 2),
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], dir);
  const problems = [];
  try {
    if (build) run(build[0], build.slice(1), dir);
    if (copyHtml) cpSync(join(dir, 'index.html'), join(dir, output, 'index.html'));
  } catch (error) {
    problems.push(`the build failed: ${error.message}`);
  }
  const emitted = existsSync(join(dir, assets)) ? files(join(dir, assets)).map((file) => file.slice(dir.length + 1)) : [];
  for (const pattern of [/cimbar_js.*\.wasm$/, /zxing_reader.*\.wasm$/, /cimbar-worker.*\.js$/, /qr-worker.*\.js$/]) {
    if (!emitted.some((file) => pattern.test(file))) problems.push(`the build output has no file matching ${pattern}`);
  }
  if (existsSync(join(dir, output))) problems.push(...(await checkPage(join(dir, output))));
  else problems.push(`no output directory: ${output}`);

  if (problems.length > 0) {
    failed = true;
    console.error(`FAIL ${name}:\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`PASS ${name}`);
  }
}
process.exit(failed ? 1 : 0);
