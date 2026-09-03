#!/usr/bin/env node
/* Captures the README screenshots from the real app, driven by headless Chromium.

   The app itself stays dependency-free — Puppeteer is *not* a project dependency and
   nothing here runs at app runtime. Install it ad-hoc wherever you like and point
   Node at it:

     mkdir -p /tmp/shots && cd /tmp/shots && npm init -y && npm i puppeteer
     cd /path/to/expense-tracker-web
     node tools/demo-data.js
     NODE_PATH=/tmp/shots/node_modules node tools/screenshots.js

   Serves the repo over http (the service worker needs a real origin), seeds IndexedDB
   with tools/demo-backup.json through DB.replaceAll — the same path a restored backup
   takes — then walks the tabs and writes docs/screenshots/*.png at iPhone size. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 8137;
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true,
  hasTouch: true, deviceScaleFactor: 2 };

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.error('Puppeteer not found. See the header of this file — install it outside\n' +
    'the repo and re-run with NODE_PATH pointing at that node_modules.');
  process.exit(1);
}

/* ---------- a static server, because file:// can't register a service worker ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Click the first element matching `sel` whose trimmed text equals `text`. */
async function clickText(page, sel, text) {
  const ok = await page.evaluate((s, t) => {
    const hit = [...document.querySelectorAll(s)]
      .find((e) => e.textContent.trim() === t);
    if (!hit) return false;
    hit.click();
    return true;
  }, sel, text);
  if (!ok) throw new Error(`no "${text}" matching ${sel}`);
  await sleep(700);                       // renders, then lets the chart rAF land
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  console.log('  ✓ ' + path.relative(ROOT, file));
}

(async () => {
  const data = path.join(__dirname, 'demo-backup.json');
  if (!fs.existsSync(data)) {
    console.error('Missing tools/demo-backup.json — run `node tools/demo-data.js` first.');
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(data, 'utf8'));

  const server = await serve();
  const browser = await puppeteer.launch({ headless: true, defaultViewport: VIEWPORT,
    args: ['--force-device-scale-factor=2', '--hide-scrollbars'] });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('typeof DB !== "undefined" && DB.state.categories.length > 0');

    /* Seed through the app's own restore path, then re-boot so every view builds
       from the loaded state exactly as it would after importing a backup. */
    await page.evaluate((d) => DB.replaceAll(d), backup);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction('typeof DB !== "undefined" && DB.state.transactions.length > 0');
    await sleep(900);

    console.log(`Capturing ${backup.transactions.length} transactions at ` +
      `${VIEWPORT.width}×${VIEWPORT.height}@${VIEWPORT.deviceScaleFactor}x`);

    await shot(page, 'home');

    await page.click('.tabbar [data-tab="stats"]');
    await sleep(900);
    /* Step back one month. The month in progress is only a few days old, so its
       Overview honestly reads "Income 0,00 €" — accurate, and a terrible advert for
       a page whose job is comparison. The last complete month is the real view. */
    await page.evaluate(() => document.querySelector('#view-stats .month-nav .mn-btn').click());
    await sleep(900);
    await shot(page, 'stats-overview');

    /* The category donut is the signature chart, and it sits below the fold. */
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#view-stats .card')]
        .find((c) => /SPENDING BY CATEGORY/i.test(c.textContent));
      (card || document.body).scrollIntoView({ block: 'start' });
    });
    await sleep(800);
    await shot(page, 'stats-categories');

    await clickText(page, '#view-stats .seg button', 'Trends');
    await shot(page, 'stats-trends');

    await clickText(page, '#view-stats .seg button', 'Trips');
    await page.evaluate(() => document.querySelector('#view-stats .trip-row').click());
    await sleep(900);
    await shot(page, 'trip-detail');

    /* The activity list, back in the third tab. The sheet has to go first — its
       backdrop swallows the tab tap, and the shot silently duplicates the last one. */
    await clickText(page, '.sheet-head button', 'Close');
    await page.waitForFunction('!document.querySelector(".sheet")');
    await sleep(400);
    await page.click('.tabbar [data-tab="transactions"]');
    await sleep(700);
    await shot(page, 'activity');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
