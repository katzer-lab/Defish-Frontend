// Uploads a real HEIC file and reads back, from the backend's task metadata in Redis, what was actually sent.
//   FE=... HEIC=<file.heic> REDIS_CONTAINER=<redis container of the backend stack> node heic.mjs
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
const sh = c => execSync(c, { encoding: 'utf8' }).trim();
sh(`docker exec ${process.env.REDIS_CONTAINER} redis-cli flushall`);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page.goto((process.env.FE || 'http://127.0.0.1:5173'));
await page.setInputFiles('input[type=file]', process.env.HEIC);
await page.waitForSelector('button.submit-btn:not([disabled])', { timeout: 30000 });
await page.click('button.submit-btn');
await page.waitForSelector('.image-wrapper img', { timeout: 30000 });
const key = sh(`docker exec ${process.env.REDIS_CONTAINER} redis-cli --scan --pattern task_metadata:*`).split('\n')[0];
const meta = JSON.parse(sh(`docker exec ${process.env.REDIS_CONTAINER} redis-cli get ${key}`));
console.log(JSON.stringify({ chosenFile: 'aquarium.heic', uploadedAs: { filename: meta.filename, content_type: meta.content_type } }));
await browser.close();
