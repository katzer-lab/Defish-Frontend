// Frames of the two scenarios (recorded through the Chrome DevTools screencast; the yellow ring is a cursor drawn by this script,
// headless Chrome has none). The GIFs are built from the frames with ffmpeg, see docs/capture/README.md.
//   FE=http://127.0.0.1:5173 PHOTO=docs/examples/aquarium-synthetic.jpg OUT_DIR=./out node gifs.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const OUT = process.env.OUT_DIR || './out';
const BASE = process.env.FE || 'http://127.0.0.1:5173';
const photo = fs.readFileSync(process.env.PHOTO);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const file = (name) => ({ name, mimeType: 'image/jpeg', buffer: photo });
const CURSOR = () => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #ffd400;border-radius:50%;pointer-events:none;left:-50px;top:-50px;box-shadow:0 0 6px #000';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(dot));
  document.addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', () => { dot.style.background = 'rgba(255,212,0,.5)'; }, true);
  document.addEventListener('mouseup', () => { dot.style.background = 'transparent'; }, true);
};
async function recorded(name, scenario) {
  execSync('curl -s http://127.0.0.1:8001/clear-cache');
  const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, colorScheme: 'dark' });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  await page.goto(BASE); await page.waitForTimeout(1000);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 900, maxHeight: 620, everyNthFrame: 1 });
  await scenario(page);
  await cdp.send('Page.stopScreencast'); await ctx.close();
  const dir = `${OUT}/frames/${name}`; fs.mkdirSync(dir, { recursive: true });
  let list = '';
  frames.forEach((f, i) => { fs.writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64')); const d = i + 1 < frames.length ? frames[i + 1].t - f.t : 0.5; list += `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(d, 0.02).toFixed(3)}\n`; });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(`${dir}/list.txt`, list);
  console.log(name, frames.length, 'frames,', (frames.at(-1).t - frames[0].t).toFixed(1), 's');
}
const rects = page => page.locator('svg.overlay rect');
const center = async loc => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const click = async (page, loc, steps = 12) => { const [x, y] = await center(loc); await page.mouse.move(x, y, { steps }); await page.waitForTimeout(250); await page.mouse.down(); await page.mouse.up(); };

await recorded('flow', async page => {
  await page.mouse.move(450, 140, { steps: 4 });
  await page.setInputFiles('input[type=file]', file('slow-aquarium.jpg')); await page.waitForTimeout(1200);
  await click(page, page.locator('button.submit-btn'));
  await page.waitForSelector('.image-wrapper img'); await page.waitForFunction(() => document.querySelectorAll('svg.overlay rect').length > 0); await page.waitForTimeout(800);
  await click(page, rects(page).nth(1)); await page.waitForSelector('.side-panel'); await page.waitForTimeout(1200);
  const h = await page.locator('.resize-handle').boundingBox();
  await page.mouse.move(h.x + 1, h.y + 300, { steps: 6 }); await page.mouse.down(); await page.mouse.move(h.x - 150, h.y + 300, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(700);
  await click(page, rects(page).nth(2)); await page.waitForTimeout(1800);
});
await recorded('cancel', async page => {
  await page.setInputFiles('input[type=file]', file('slow-aquarium.jpg')); await page.waitForTimeout(800);
  await click(page, page.locator('button.submit-btn'), 8);
  await page.waitForSelector('.cancelBtn'); await page.waitForTimeout(1000);
  await click(page, page.locator('.cancelBtn'), 8); await page.waitForSelector('.status-note'); await page.waitForTimeout(1600);
});
await browser.close();
