// Checks that a built smoke app works offline: a service worker of the test
// (not of the package) caches every output file, the server is stopped, and
// the reloaded page must still preload both codecs. In WebKit this catches
// workers that escape the service worker when several start at once.
// Returns the list of problems (empty when it passes).
import { createRequire } from 'node:module';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

// Playwright is a dev dependency of the package, not of the smoke projects.
const packageJson = fileURLToPath(new URL('../../packages/qrcast/package.json', import.meta.url));
const playwright = createRequire(packageJson)('playwright');

const SERVICE_WORKER = 'smoke-sw.js';

function serviceWorkerSource(paths) {
  return `const FILES = ${JSON.stringify(paths)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('smoke').then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => cached ?? fetch(event.request)));
});
`;
}

/** Runs the offline check on the build in `root` with a Playwright browser name. */
export async function checkOffline(root, browserName) {
  const problems = [];
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== SERVICE_WORKER)
    .map((entry) => '/' + relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
  writeFileSync(join(root, SERVICE_WORKER), serviceWorkerSource(['/', ...paths]));

  const server = await serve(root);
  let serverOpen = true;
  const browser = await playwright[browserName].launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    const smokeResult = () =>
      page.waitForFunction(() => window.__smoke, undefined, { timeout: 120_000 }).then((handle) => handle.jsonValue());

    await page.goto(server.origin);
    const online = await smokeResult();
    if (!online.ok) problems.push(`online preload failed: ${online.code ?? 'no code'}: ${online.message}`);
    await page.evaluate(async (url) => {
      await navigator.serviceWorker.register(url);
      await navigator.serviceWorker.ready;
    }, `/${SERVICE_WORKER}`);

    await server.close();
    serverOpen = false;
    await page.reload();
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      problems.push('the reloaded page is not controlled by the service worker');
    }
    const offline = await smokeResult();
    if (!offline.ok) problems.push(`offline preload failed: ${offline.code ?? 'no code'}: ${offline.message}`);
  } catch (error) {
    problems.push(`check failed: ${error.message}`);
  } finally {
    await browser.close();
    if (serverOpen) await server.close();
  }
  return problems;
}
