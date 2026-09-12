// v2 end-to-end smoke test on a phone viewport (Playwright, global install).
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
page.on('console', (m) => { if (m.type() === 'error' && !/vibrate/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const noHScroll = async (label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!over, `${label}: horizontal overflow`);
};
const tabBarHidden = () => page.evaluate(() => {
  const el = document.querySelector('.ui-tabbar');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.top >= window.innerHeight - 1 || getComputedStyle(el).visibility === 'hidden';
});
const tapText = async (re) => { await page.getByRole('button', { name: re }).first().tap(); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// --- Home
await shot('01-home');
await noHScroll('home');
check((await page.locator('.ui-tabbar').count()) > 0, 'home: floating tab bar missing');
check(/훈련|세션/.test(await page.locator('body').innerText()), 'home: CTA copy missing');

// --- Trainer setup → session
await tapText(/^훈련$/);
await page.waitForTimeout(400);
await shot('02-train-setup');
check((await page.locator('.trainer-setup').count()) > 0, 'train: setup view missing');
await tapText(/시작/);
await page.waitForTimeout(700);
// coach mark on first run → skip through
for (let i = 0; i < 4; i++) {
  const skip = page.getByRole('button', { name: /건너뛰기|시작할게요/ });
  if ((await skip.count()) === 0) break;
  await shot(`03-coach-${i + 1}`);
  await skip.first().tap();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(400);
await shot('04-train-think');
check((await page.locator('.trainer-stage').count()) > 0, 'train: .trainer-stage missing after start');
check((await page.locator('.trainer-hud').count()) > 0, 'train: HUD missing');
check(await tabBarHidden(), 'train: tab bar not hidden during session');

// hold-to-pause
{
  const box = await page.locator('.trainer-stage').first().boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height * 0.5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(700);
  const w1 = await page.locator('.timerbar__fill, .trainer-hud__bar > *').first().evaluate((el) => el.style.width || el.getAttribute('style')).catch(() => null);
  await page.waitForTimeout(700);
  const w2 = await page.locator('.timerbar__fill, .trainer-hud__bar > *').first().evaluate((el) => el.style.width || el.getAttribute('style')).catch(() => null);
  check(w1 !== null && w1 === w2, `train: timer did not pause while holding (${w1} → ${w2})`);
  const held = await page.locator('.ui-sheet--held, .trainer-hold').count();
  check(held > 0, 'train: hold overlay not shown');
  await shot('05-train-hold');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}
// reveal → rate
let revealed = false;
for (let i = 0; i < 40 && !revealed; i++) { await page.waitForTimeout(250); revealed = (await page.locator('.trainer-answer__cap').count()) > 0; }
check(revealed, 'train: answer cap did not appear within 10s');
await shot('06-train-reveal');
const counterBefore = await page.locator('.trainer-hud__count').first().innerText().catch(() => '');
const know = page.locator('.ui-rating button', { hasText: '알아요' });
check((await know.count()) > 0, 'train: 알아요 rating button missing');
if (await know.count()) { await know.first().tap(); await page.waitForTimeout(900); }
const counterAfter = await page.locator('.trainer-hud__count').first().innerText().catch(() => '');
check(counterBefore !== counterAfter, `train: counter did not advance after rating (${counterBefore} → ${counterAfter})`);
// end early → summary
await page.locator('.trainer-hud__btn').first().tap();
await page.waitForTimeout(400);
await shot('07-train-end-confirm');
const endBtn = page.locator('.ui-sheet button, .trainer-confirm button', { hasText: /끝|종료|그만|요약/ });
check((await endBtn.count()) > 0, 'train: end-session confirm button missing');
if (await endBtn.count()) { await endBtn.first().tap(); await page.waitForTimeout(700); }
await shot('08-train-summary');
check(/세션|알아요/.test(await page.locator('body').innerText()), 'train: summary missing');
check(!(await tabBarHidden()), 'train: tab bar still hidden on summary');

// --- Quiz
await tapText(/^퀴즈$/);
await page.waitForTimeout(400);
await shot('09-quiz-idle');
await tapText(/시작/);
await page.waitForTimeout(700);
await shot('10-quiz-question');
const ans = page.locator('.quiz-answers button');
check((await ans.count()) >= 2, 'quiz: answer buttons missing');
if (await ans.count()) { await ans.first().tap(); await page.waitForTimeout(500); await shot('11-quiz-answered'); }
await noHScroll('quiz');
// leave the round
const qClose = page.locator('.quiz-hud__close');
if (await qClose.count()) { await qClose.first().tap(); await page.waitForTimeout(500); }
const qEnd = page.locator('.ui-sheet button, .quiz-confirm button', { hasText: /끝|종료|그만|요약/ });
if (await qEnd.count()) { await qEnd.first().tap(); await page.waitForTimeout(500); }

// --- Charts
await tapText(/^차트$/);
await page.waitForTimeout(500);
await shot('12-charts');
await noHScroll('charts');
const cell = page.locator('[aria-label="AKs"]').first();
check((await cell.count()) > 0, 'charts: AKs cell missing');
if (await cell.count()) {
  await cell.tap(); await page.waitForTimeout(500); await shot('13-charts-cell');
  const sheetText = await page.locator('.ui-sheet').last().innerText().catch(() => '');
  check(/플랍을 본 뒤|왜 이 액션/.test(sheetText), 'charts: cell sheet lacks explanation');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
}

// --- Settings (pushed from Home)
await tapText(/^홈$/);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /설정/ }).first().tap();
await page.waitForTimeout(500);
await shot('14-settings');
check(/설정/.test(await page.locator('body').innerText()), 'settings: not shown');
await noHScroll('settings');
const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !/rgrid|range-cell|ui-chip|dot/.test(b.className); }).map((b) => `${b.className || b.tagName}:${Math.round(b.getBoundingClientRect().height)}px "${(b.textContent || '').trim().slice(0, 12)}"`));
if (small.length) console.log('small buttons (settings):', small.slice(0, 8).join(' | '));

await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
if (fails.length) { console.log('FAILURES:\n' + fails.join('\n')); process.exit(2); }
if (errors.length) process.exit(2);
console.log(`e2e OK — screenshots in ${outDir}`);
