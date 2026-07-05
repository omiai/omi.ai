// End-to-end tests for the site. Run with: node tests/e2e.test.mjs
// Requires playwright with chromium (CHROMIUM_PATH may point to a chromium binary).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
const NAV_SECTIONS = ['what-is-it', 'the-four-stages', 'not-cheating', 'support', 'summary'];
const FORBIDDEN_STRINGS = ['IBJ', 'Coming Soon', '秋葉'];

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

// Wait until smooth scrolling has come to rest (two identical readings 150ms apart).
async function settleScroll(page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => document.scrollingElement.scrollTop);
    if (y === last) return;
    last = y;
  }
  throw new Error('scroll did not settle within 6s');
}

// --- Static content checks -------------------------------------------------
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
for (const s of FORBIDDEN_STRINGS) {
  check(`index.html does not contain "${s}"`, !html.includes(s));
}
check('index.html states the contract-marriage premise', html.includes('contract marriage'));
check('index.html covers all four stages',
  ['Omiai', 'Pre-Kousai', 'Shinken Kousai', 'Engagement'].every((t) => html.includes(t)));

// --- Browser checks ---------------------------------------------------------
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

// Desktop: clicking each nav link must land the section heading below the sticky nav.
const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desktop.goto(`${base}/`, { waitUntil: 'load' });
for (const id of NAV_SECTIONS) {
  await desktop.click(`.nav-links a[href="#${id}"]`);
  await settleScroll(desktop);
  const r = await desktop.evaluate((id) => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    const section = document.getElementById(id).closest('section');
    const label = section.querySelector('.section-no').getBoundingClientRect();
    const h2 = section.querySelector('h2').getBoundingClientRect();
    return { navBottom: nav.bottom, labelTop: label.top, h2Top: h2.top };
  }, id);
  check(`nav link #${id}: section label lands below sticky nav`,
    r.labelTop >= r.navBottom && r.h2Top >= r.navBottom,
    `navBottom=${r.navBottom.toFixed(1)} labelTop=${r.labelTop.toFixed(1)} h2Top=${r.h2Top.toFixed(1)}`);
}

// Same, with smooth scrolling disabled (instant jumps, as in browsers
// without smooth-scroll or with reduced motion).
await desktop.emulateMedia({ reducedMotion: 'reduce' });
await desktop.goto(`${base}/#not-cheating`, { waitUntil: 'load' });
await settleScroll(desktop);
const direct = await desktop.evaluate(() => {
  const nav = document.querySelector('nav').getBoundingClientRect();
  const section = document.getElementById('not-cheating').closest('section');
  return { navBottom: nav.bottom, labelTop: section.querySelector('.section-no').getBoundingClientRect().top };
});
check('direct URL fragment #not-cheating lands below sticky nav',
  direct.labelTop >= direct.navBottom,
  `navBottom=${direct.navBottom.toFixed(1)} labelTop=${direct.labelTop.toFixed(1)}`);
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
