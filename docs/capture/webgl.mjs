// Counts the WebGL contexts the page creates while the side panel is dragged, and checks that the page renders without WebGL.
//   FE=http://127.0.0.1:5173 PHOTO=docs/examples/aquarium-synthetic.jpg node webgl.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const photo = fs.readFileSync(process.env.PHOTO);
async function run(label, args, fn) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...args, '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 90)));
  await page.addInitScript(() => { window.__ctx = 0; const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (String(t).startsWith('webgl')) window.__ctx++; return g.call(this, t, ...a); }; });
  await page.goto((process.env.FE || 'http://127.0.0.1:5173')); await page.waitForTimeout(1200);
  console.log(label, JSON.stringify(await fn(page, errors)));
  await browser.close();
}
execSync('curl -s http://127.0.0.1:8001/clear-cache');
await run('webgl on ', ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], async (page) => {
  await page.setInputFiles('input[type=file]', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForSelector('button.submit-btn:not([disabled])'); await page.click('button.submit-btn');
  await page.waitForSelector('svg.overlay rect'); await page.waitForTimeout(500);
  await page.locator('svg.overlay rect').nth(1).click(); await page.waitForSelector('.side-panel'); await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__ctx);
  const h = await page.locator('.resize-handle').boundingBox();
  await page.mouse.move(h.x + 1, h.y + 300); await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(h.x - 5 * (i + 1), h.y + 300);
  await page.mouse.up();
  return { webglContextsCreatedByThePanelDrag: (await page.evaluate(() => window.__ctx)) - before, totalContexts: await page.evaluate(() => window.__ctx) };
});
await run('webgl off', ['--disable-3d-apis', '--disable-gpu', '--disable-software-rasterizer'], async (page, errors) => ({
  h1: await page.locator('h1').count(), uploadForm: await page.locator('form.upload-form').count(), pageErrors: errors,
}));
