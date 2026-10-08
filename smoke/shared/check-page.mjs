// Opens a built smoke app in headless Chromium and checks that both codecs
// load: no failed or non-2xx request, no request leaving the page's origin, no
// page error, and a preload that ends without an error code such as
// `codec-init-failed`. Returns the list of problems (empty when it passes).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

// Playwright is a dev dependency of the package, not of the smoke projects.
const packageJson = fileURLToPath(new URL('../../packages/qrcast/package.json', import.meta.url));
const { chromium } = createRequire(packageJson)('playwright');

export async function checkPage(root) {
  const problems = [];
  const server = await serve(root);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const loaded = new Set();
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(server.origin) && !/^(data|blob):/.test(url)) {
        problems.push(`request left the origin: ${url}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`${response.status()} for ${response.url()}`);
      else loaded.add(new URL(response.url()).pathname);
    });
    page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

    await page.goto(server.origin);
    const result = await page
      .waitForFunction(() => window.__smoke, undefined, { timeout: 60_000 })
      .then((handle) => handle.jsonValue());
    if (!result.ok) problems.push(`preload failed: ${result.code ?? 'no code'}: ${result.message}`);
    for (const pattern of [/cimbar_js.*\.wasm$/, /zxing_reader.*\.wasm$/, /cimbar-worker.*\.js$/, /qr-worker.*\.js$/]) {
      if (![...loaded].some((path) => pattern.test(path))) problems.push(`never loaded a file matching ${pattern}`);
    }
  } catch (error) {
    problems.push(`check failed: ${error.message}`);
  } finally {
    await browser.close();
    await server.close();
  }
  return problems;
}
