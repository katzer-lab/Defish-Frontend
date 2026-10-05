// Screenshots of every state of the page, against a dev server (FE) and the backend stack with the mock inference service
// started with MOCK_USE_LAYOUT=1 (boxes on the fish of the sample picture). See docs/capture/README.md.
//   FE=http://127.0.0.1:5173 PHOTO=docs/examples/aquarium-synthetic.jpg BIG=<a file over 10 MB> OUT_DIR=./out node screens.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const OUT = process.env.OUT_DIR || './out';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.FE || 'http://127.0.0.1:5173';
const photo = fs.readFileSync(process.env.PHOTO);
const sh = c => execSync(c, { encoding: 'utf8' });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const clear = () => sh('curl -s http://127.0.0.1:8001/clear-cache');
const file = (name = 'aquarium-synthetic.jpg') => ({ name, mimeType: 'image/jpeg', buffer: photo });

// a ring that follows the mouse: the headless video has no cursor, and the recordings are easier to follow with one
const CURSOR = () => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #ffd400;border-radius:50%;pointer-events:none;left:-50px;top:-50px;box-shadow:0 0 6px #000';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(dot));
  document.addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', () => { dot.style.background = 'rgba(255,212,0,.5)'; }, true);
  document.addEventListener('mouseup', () => { dot.style.background = 'transparent'; }, true);
};

async function open({ w = 1200, h = 800, scheme = 'dark', video = false } = {}) {
  await clear();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(1200);   // let the background settle
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const submit = async page => { await page.waitForSelector('button.submit-btn:not([disabled])'); await page.click('button.submit-btn'); };
const rects = page => page.locator('svg.overlay rect');
const waitResult = page => page.waitForSelector('.image-wrapper img');
const settle = async page => { await page.waitForFunction(() => { const i = document.querySelector('.image-wrapper img'); return i && i.complete && document.querySelectorAll('svg.overlay rect').length > 0; }); await page.waitForTimeout(400); };

// 1. empty, 2. photo chosen
{ const { ctx, page } = await open();
  await shot(page, '01-empty');
  await page.setInputFiles('input[type=file]', file());
  await page.waitForSelector('.file-thumb'); await page.waitForTimeout(300);
  await shot(page, '02-photo-chosen');
  // 3. analysing (the file name containing "slow" makes the mock take 3 s)
  await page.setInputFiles('input[type=file]', file('slow-aquarium.jpg'));
  await page.waitForTimeout(300); await submit(page);
  await page.waitForSelector('.cancelBtn'); await page.waitForTimeout(900);
  await shot(page, '03-analysing');
  // 4. result with boxes
  await waitResult(page); await settle(page);
  await shot(page, '04-result-boxes');
  // 5. panel of a sick fish, 6. panel of the uncertain one, 7. panel of a healthy one
  await rects(page).nth(1).click(); await page.waitForSelector('.side-panel'); await page.waitForTimeout(400);
  await shot(page, '05-panel-sick');
  await rects(page).nth(2).click(); await page.waitForTimeout(400);
  await shot(page, '06-panel-uncertain');
  await rects(page).nth(0).click(); await page.waitForTimeout(400);
  await shot(page, '07-panel-healthy');
  await ctx.close(); }

// 8. canceled
{ const { ctx, page } = await open();
  await page.setInputFiles('input[type=file]', file('slow-aquarium.jpg')); await submit(page);
  await page.waitForSelector('.cancelBtn'); await page.waitForTimeout(700); await page.click('.cancelBtn');
  await page.waitForSelector('.status-note'); await page.waitForTimeout(300);
  await shot(page, '08-canceled'); await ctx.close(); }

// 9. failed analysis (the mock's "broken" switch: the inference service answers 500)
{ const { ctx, page } = await open();
  await page.setInputFiles('input[type=file]', { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([photo, Buffer.from('broken')]) });
  await submit(page); await page.waitForSelector('.error'); await page.waitForTimeout(300);
  await shot(page, '09-error-failed'); await ctx.close(); }

// 10. upload over the limit
{ const { ctx, page } = await open();
  await page.setInputFiles('input[type=file]', process.env.BIG); await submit(page);
  await page.waitForSelector('.error'); await page.waitForTimeout(300);
  await shot(page, '10-error-too-large'); await ctx.close(); }

// 11. photo no longer available: the API answer with original_image set to null (what it returns when the photo expired)
{ const { ctx, page } = await open();
  await page.route('**/analyze-result/**', async route => {
    const res = await route.fetch(); const json = await res.json();
    if (json.original_image) json.original_image = null;
    await route.fulfill({ response: res, json });
  });
  await page.setInputFiles('input[type=file]', file()); await submit(page);
  await page.waitForSelector('.no-photo'); await page.waitForTimeout(300);
  await shot(page, '11-photo-unavailable'); await ctx.close(); }

// 12. phone width with the panel open, 13. light colour scheme
{ const { ctx, page } = await open({ w: 390, h: 844 });
  await page.setInputFiles('input[type=file]', file()); await submit(page); await waitResult(page); await settle(page);
  await shot(page, '12-mobile-result');
  await rects(page).nth(1).click(); await page.waitForSelector('.side-panel'); await page.waitForTimeout(400);
  await shot(page, '12b-mobile-panel'); await ctx.close(); }
{ const { ctx, page } = await open({ scheme: 'light' });
  await page.setInputFiles('input[type=file]', file()); await submit(page); await waitResult(page); await settle(page);
  await rects(page).nth(2).click(); await page.waitForSelector('.side-panel'); await page.waitForTimeout(400);
  await shot(page, '13-light-scheme-panel'); await ctx.close(); }

await browser.close();
console.log('done');
