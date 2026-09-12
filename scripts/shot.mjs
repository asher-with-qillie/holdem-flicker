// Mobile screenshot helper (Playwright, global install).
// Usage: node scripts/shot.mjs <url> <out.png> [step ...]
//   steps: tap=<selector|text=...>   wait=<ms>   hold=<selector>:<ms> (pointer down, wait, shoot while held)
//          scroll=<px>   full=1 (full page)
// Example: node scripts/shot.mjs http://localhost:4173/holdem-flicker/ work/shot.png "tap=text=퀴즈" wait=500
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium, devices } = require(`${globalRoot}/playwright`);

const [url, out, ...steps] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: shot.mjs <url> <out.png> [steps]');
  process.exit(1);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
let full = false;
let held = null;
for (const s of steps) {
  const [k, v] = s.split(/=(.*)/s);
  if (k === 'tap') await page.locator(v).first().tap();
  else if (k === 'wait') await page.waitForTimeout(Number(v));
  else if (k === 'scroll') await page.mouse.wheel(0, Number(v));
  else if (k === 'full') full = true;
  else if (k === 'hold') {
    const [sel, ms] = v.split(/:(\d+)$/);
    const box = await page.locator(sel).first().boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    held = { cdp };
    await page.waitForTimeout(Number(ms || 1000));
  }
}
await page.screenshot({ path: out, fullPage: full });
if (held) await held.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exit(2); }
console.log(`saved ${out}`);
