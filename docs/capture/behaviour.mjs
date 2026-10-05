// Runs the same scenarios against a running dev server and prints what the page did, as JSON.
// Used on the client as it was (git commit 91b9954) and on the current one; see docs/capture/README.md.
//
//   FE=http://127.0.0.1:5173 FE_NOURL=http://127.0.0.1:5174 PHOTO=aquarium-synthetic.jpg BIG=eleven-megabytes.bin \
//   API_CONTAINER=<name of the API container> node docs/capture/behaviour.mjs
// FE: dev server started with VITE_API_URL=http://127.0.0.1:8001; FE_NOURL (optional): one started without VITE_API_URL.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
const sh = promisify(exec);
const { FE, FE_NOURL, PHOTO, BIG, API_CONTAINER } = process.env;
const photo = fs.readFileSync(PHOTO);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const out = {};

async function scenario(name, base, fn) {
  execSync('curl -s http://127.0.0.1:8001/clear-cache');
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const log = { polls: 0, console: 0, postUrl: null };
  page.on('request', r => {
    if (r.url().includes('/analyze-result/')) log.polls++;
    if (r.method() === 'POST' && /\/analyze$/.test(r.url())) log.postUrl = r.url();
  });
  page.on('console', m => { log.console += m.text().length; });
  await page.goto(base); await page.waitForTimeout(1000);
  const t0 = Date.now();
  let result;
  try { result = await fn(page, log); } catch (e) { result = { error: String(e).slice(0, 120) }; }
  out[name] = { ...result, requestsForResults: log.polls, consoleCharacters: log.console, ...(log.postUrl ? { uploadWentTo: log.postUrl.replace(/^https?:\/\/[^/]+/, '<origin>') } : {}), seconds: Math.round((Date.now() - t0) / 100) / 10 };
  await page.context().close();
}
const choose = (page, name, buffer = photo) => page.setInputFiles('input[type=file]', { name, mimeType: 'image/jpeg', buffer });
const submit = async page => { await page.waitForSelector('button.submit-btn:not([disabled])'); await page.click('button.submit-btn'); };
const errorText = page => page.locator('.error').allTextContents().then(a => a.join(' | '));
const spinner = page => page.locator('.loader-ring').count().then(n => n > 0);
const since = (t0) => Math.round((Date.now() - t0) / 100) / 10;

await scenario('normal', FE, async page => {
  await choose(page, 'aquarium-synthetic.jpg'); await submit(page);
  await page.waitForSelector('svg.overlay rect'); return { boxesDrawn: await page.locator('svg.overlay rect').count() };
});
await scenario('analysis_failed_on_the_server', FE, async page => {
  await choose(page, 'broken.jpg', Buffer.concat([photo, Buffer.from('broken')])); await submit(page);
  const t0 = Date.now();
  const shown = await page.waitForSelector('.error', { timeout: 25000 }).then(() => true).catch(() => false);
  return { errorShown: shown, secondsUntilError: shown ? since(t0) : null, errorText: await errorText(page), spinnerAtEnd: await spinner(page) };
});
await scenario('file_over_the_limit_413', FE, async page => {
  await page.setInputFiles('input[type=file]', BIG); await submit(page);
  await page.waitForSelector('.error', { timeout: 15000 }); return { errorText: await errorText(page), spinnerAtEnd: await spinner(page) };
});
await scenario('api_dies_while_polling', FE, async (page, log) => {
  await choose(page, 'slow-aquarium.jpg'); await submit(page);
  await page.waitForSelector('.cancelBtn'); await page.waitForTimeout(800);
  await sh(`docker kill ${API_CONTAINER}`);
  const before = log.polls, t0 = Date.now();
  const shown = await page.waitForSelector('.error', { timeout: 40000 }).then(() => true).catch(() => false);
  const r = { errorShown: shown, secondsUntilError: shown ? since(t0) : null, requestsWhileApiWasDown: log.polls - before, errorText: await errorText(page), spinnerAtEnd: await spinner(page) };
  await sh(`docker start ${API_CONTAINER}`);
  for (let i = 0; i < 30; i++) { if (await sh('curl -sf http://127.0.0.1:8001/').then(() => true).catch(() => false)) break; await new Promise(r => setTimeout(r, 2000)); }
  return r;
});
await scenario('cancel_during_analysis', FE, async (page, log) => {
  await choose(page, 'slow-aquarium.jpg'); await submit(page);
  await page.waitForSelector('.cancelBtn'); await page.waitForTimeout(1500);
  const before = log.polls; await page.click('.cancelBtn'); await page.waitForTimeout(3500);
  return { noteShown: await page.locator('.status-note').count() > 0, requestsForResultsAfterCancel: log.polls - before, resultShown: await page.locator('.result').count() > 0 };
});
if (FE_NOURL) await scenario('api_address_not_configured', FE_NOURL, async page => {
  await choose(page, 'aquarium-synthetic.jpg'); await submit(page);
  await page.waitForSelector('.error', { timeout: 15000 }); return { errorText: await errorText(page) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
