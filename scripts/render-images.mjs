/**
 * Renders the social preview image and the Apple touch icon into
 * frontend/public/ with headless Chromium, from the HTML below and
 * favicon.svg. Run after changing either:  node scripts/render-images.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => path.join(root, 'frontend', 'public', name);

const OG_HTML = `<!doctype html>
<html><head><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    background: #f6f1e7; color: #12151c;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  }
  .card {
    position: absolute; width: 380px; height: 250px; border-radius: 18px;
    background: #fffdf8; border: 2px solid #e5dccb;
    box-shadow: 0 18px 50px rgb(40 30 10 / 14%);
    background-image: repeating-linear-gradient(#fffdf8 0 46px, #dbe4f5 46px 48px);
    background-position: 0 70px;
  }
  .c1 { right: 120px; top: 70px; rotate: 8deg; }
  .c2 { right: 60px; top: 230px; rotate: -6deg; }
  .c2::after {
    content: 'MASTERED'; position: absolute; right: 24px; top: 22px; rotate: -12deg;
    font: 700 22px/1 system-ui, sans-serif; letter-spacing: 0.12em; color: #12855b;
    border: 3px solid #12855b; border-radius: 8px; padding: 6px 10px;
  }
  .text { position: absolute; left: 80px; top: 120px; width: 640px; }
  .eyebrow { font: 600 22px/1 system-ui, sans-serif; letter-spacing: 0.18em; color: #4f46e5; text-transform: uppercase; }
  h1 { font-size: 104px; line-height: 0.92; letter-spacing: -0.02em; margin-top: 26px; }
  h1 span { color: #4f46e5; }
  p { font: 400 30px/1.35 system-ui, sans-serif; color: #4a5160; margin-top: 30px; }
</style></head>
<body>
  <div class="card c1"></div><div class="card c2"></div>
  <div class="text">
    <div class="eyebrow">Flashcards · Quiz · Spaced repetition</div>
    <h1>Study<br><span>Assistant</span></h1>
    <p>Paste your notes. Get cards and a quiz that are checked against them.</p>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(OG_HTML);
  await og.screenshot({ path: out('og-image.png') });

  const svg = await readFile(out('favicon.svg'), 'utf8');
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await icon.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="180" height="180" ')}</body>`);
  await icon.screenshot({ path: out('apple-touch-icon.png') });
  console.log('wrote og-image.png and apple-touch-icon.png');
} finally {
  await browser.close();
}
