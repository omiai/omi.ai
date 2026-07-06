// End-to-end tests for the site. Run with: node tests/e2e.test.mjs
// Requires playwright with chromium (CHROMIUM_PATH may point to a chromium binary).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// --- Static content checks -------------------------------------------------
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
check('index.html is the Coming Soon page', html.includes('Coming Soon'));
check('index.html shows the agency name', html.includes('秋葉結婚相談所'));
check('index.html does not contain "IBJ"', !html.includes('IBJ'));

// --- Browser checks ---------------------------------------------------------
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

// Desktop: the heading and Coming Soon text render visibly.
const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desktop.goto(`${base}/`, { waitUntil: 'load' });
check('desktop: agency heading is visible',
  await desktop.locator('h1').isVisible() &&
  (await desktop.locator('h1').textContent()).includes('秋葉結婚相談所'));
check('desktop: Coming Soon text is visible',
  await desktop.locator('.coming-soon').isVisible());
await desktop.close();

// Mobile: no horizontal overflow.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${base}/`, { waitUntil: 'load' });
const overflow = await mobile.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('mobile (390px): no horizontal page overflow', overflow <= 0, `overflow=${overflow}px`);
await mobile.close();

await browser.close();
server.close();

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
