// End-to-end smoke test on a phone viewport (Playwright, global install).
// Usage: node scripts/e2e.mjs <url> [outDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(`${execSync('npm root -g').toString().trim()}/playwright`);

const [url, outDir = 'work/e2e'] = process.argv.slice(2);
if (!url) { console.error('usage: e2e.mjs <url> [outDir]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const noHScroll = async (label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!over, `${label}: horizontal overflow`);
};

await page.goto(url, { waitUntil: 'networkidle' });

// --- Trainer: think phase, reveal, hold-to-pause
await page.waitForTimeout(600);
await shot('01-train-think');
await noHScroll('train');
const stage = page.locator('.trainer-stage').first();
check((await stage.count()) > 0, 'train: .trainer-stage missing');
if (await stage.count()) {
  const box = await stage.boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height * 0.6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(900);
  const bar1 = await page.locator('.timerbar__fill').first().evaluate((el) => el.style.width).catch(() => null);
  await page.waitForTimeout(900);
  const bar2 = await page.locator('.timerbar__fill').first().evaluate((el) => el.style.width).catch(() => null);
  check(bar1 !== null && bar1 === bar2, `train: timer did not pause while holding (${bar1} → ${bar2})`);
  const overlayText = await page.locator('body').innerText();
  check(/왜 이 액션인가|해설|상황/.test(overlayText), 'train: explanation overlay not visible while holding');
  await shot('02-train-hold');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(1200);
  const bar3 = await page.locator('.timerbar__fill').first().evaluate((el) => el.style.width).catch(() => null);
  check(bar3 !== bar2, 'train: timer did not resume after release');
}
await page.waitForTimeout(5000);
await shot('03-train-reveal');
check((await page.locator('.badge--lg').count()) > 0, 'train: no large action badge after think phase');

// --- Quiz
await page.getByRole('button', { name: '퀴즈' }).tap();
await page.waitForTimeout(500);
await shot('04-quiz');
await noHScroll('quiz');
const answerBtn = page.locator('[class*="quiz-answer"]').first();
check((await answerBtn.count()) > 0, 'quiz: no answer buttons');
if (await answerBtn.count()) { await answerBtn.tap(); await page.waitForTimeout(400); await shot('05-quiz-answered'); }

// --- Charts
await page.getByRole('button', { name: '차트' }).tap();
await page.waitForTimeout(500);
await shot('06-charts');
await noHScroll('charts');
const cell = page.locator('[aria-label="AKs"]').first();
check((await cell.count()) > 0, 'charts: AKs cell missing');
if (await cell.count()) { await cell.tap(); await page.waitForTimeout(400); await shot('07-charts-cell'); check((await page.locator('.sheet').count()) > 0, 'charts: sheet did not open'); }

// --- Settings
await page.getByRole('button', { name: '설정' }).tap();
await page.waitForTimeout(400);
await shot('08-settings');
await noHScroll('settings');

// Touch target audit: visible buttons < 40px tall
const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !b.className.includes('rgrid') && !b.className.includes('range-cell'); }).map((b) => `${b.className || b.tagName}:${Math.round(b.getBoundingClientRect().height)}px "${(b.textContent || '').trim().slice(0, 12)}"`));
if (small.length) console.log('small buttons (settings):', small.join(' | '));

await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
if (fails.length) { console.log('FAILURES:\n' + fails.join('\n')); process.exit(2); }
if (errors.length) process.exit(2);
console.log(`e2e OK — screenshots in ${outDir}`);
