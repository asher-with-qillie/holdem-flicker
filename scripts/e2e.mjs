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
const externalFontReqs = [];
const localFontReqs = [];
page.on('response', (r) => {
  if (!/\.woff2?(\?|$)/.test(r.url())) return;
  (/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(r.url()) && !r.url().includes('/holdem-flicker/') ? externalFontReqs : localFontReqs).push(r.url());
});
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

// --- 탭 바: 활성 알약이 '막대에서 터져 나온' 것처럼 보이지 않아야 합니다.
//     알약 자체는 예전에도 막대 캡슐 안에 들어 있었습니다(여유 7px). 튀어 보인 건 알약의
//     tint 글로우가 가로로 24px 번져서 막대 끝을 넘어간 것이고, 알약이 칸 너비를 꽉 채워
//     막대 끝까지 7px 밖에 안 남았기 때문입니다. 그래서 재는 건 '알약 + 글로우'입니다.
{
  const fit = await page.evaluate(() => {
    const bar = document.querySelector('.ui-tabbar'), pill = document.querySelector('.ui-tabbar__pill');
    if (!bar || !pill) return null;
    const cs = getComputedStyle(pill);
    // 바깥 그림자가 좌우로 번지는 폭 (inset 제외, 색 함수는 먼저 지움)
    let bleed = 0;
    for (const part of (cs.boxShadow || '').split(/,(?![^(]*\))/)) {
      if (/(^|\s)inset(\s|$)/.test(part)) continue;
      const n = part.replace(/[a-z-]+\([^)]*\)/g, '').match(/-?\d*\.?\d+px/g);
      if (!n || n.length < 2) continue;
      const [ox, , blur = 0, spread = 0] = n.map(parseFloat);
      bleed = Math.max(bleed, Math.abs(ox) + blur + spread);
    }
    const b = bar.getBoundingClientRect(), p = pill.getBoundingClientRect();
    const n = Number(cs.getPropertyValue('--n')) || Number(getComputedStyle(bar).getPropertyValue('--n')) || 4;
    const i = Number(getComputedStyle(bar).getPropertyValue('--i')) || 0;
    const gap = parseFloat(getComputedStyle(bar).getPropertyValue('--tab-pill-gap')) || 0;
    const step = p.width + gap;
    const firstL = (p.left - step * i) - b.left;              // --i 위치를 0번 칸으로 되돌림
    const lastR = b.right - ((p.left - step * i) + step * (n - 1) + p.width);
    const col = (b.width - 2 * (parseFloat(getComputedStyle(bar).getPropertyValue('--tab-padx')) || 0)) / n;
    return { n, bleed, worst: +Math.min(firstL, lastR).toFixed(1), colGap: +(col - p.width).toFixed(1) };
  });
  check(fit !== null, 'tabbar: pill or bar missing');
  if (fit) {
    check(fit.worst >= fit.bleed, `tabbar: the active pill's glow (${fit.bleed}px) spills past the bar's rounded end (only ${fit.worst}px of room, ${fit.n} tabs)`);
    check(fit.colGap >= 4, `tabbar: the pill fills its whole column (gap ${fit.colGap}px) — neighbouring pills touch and the end pills crowd the bar's ends`);
  }
}

// --- 유리: blur 만으로는 거의 검은 바닥이 그대로 흐려질 뿐이라 판이 회색 상자로 보입니다.
//     backdrop 을 끌어올려야 판 안쪽이 바깥보다 밝아집니다. 그 차이를 실제로 잽니다.
{
  const lift = await page.evaluate(() => {
    const el = document.querySelector('.home-today') || document.querySelector('.ui-panel.glass');
    if (!el) return null;
    const f = getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || '';
    return { filter: f, flat: el.classList.contains('glass-flat') };
  });
  check(lift !== null, 'glass: no .glass panel on home to check');
  if (lift && !lift.flat) {
    check(/blur/.test(lift.filter), `glass: .glass lost its backdrop blur (${lift.filter})`);
    check(/brightness\(/.test(lift.filter), `glass: .glass has no brightness lift — a blurred near-black ground stays near-black (${lift.filter})`);
  }
}

// --- 본문 폰트: 셀프 호스팅한 Noto Sans KR 이 실제로 붙었는지 (외부 요청 없이)
{
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    const h1 = document.querySelector('h1') ?? document.body;
    return {
      family: getComputedStyle(h1).fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === 'loaded' && f.family === 'Noto Sans KR').length,
    };
  });
  check(/^['"]?Noto Sans KR/.test(font.family), `font: --font should lead with Noto Sans KR (got ${font.family})`);
  check(font.loaded > 0, 'font: no Noto Sans KR face finished loading');
  check(localFontReqs.length > 0, 'font: no woff2 served from the app itself (self-hosting broken?)');
  check(externalFontReqs.length === 0, `font: ${externalFontReqs.length} webfont request(s) left going to a third party (${externalFontReqs[0] ?? ''})`);
}

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
check((await page.locator('.trainer-session--think').count()) > 0, 'train: .trainer-session--think missing (choose state)');
check((await page.locator('.trainer-choice').count()) >= 2, 'train: fewer than 2 .trainer-choice buttons');
const countdown = () => page.locator('.trainer-timer__num').first().innerText().catch(() => '');
check(/\d+\.\d초/.test(await countdown()), `train: countdown number missing ("${await countdown()}")`);
check(/선택하세요/.test(await page.locator('.trainer-hud').innerText()), 'train: HUD tag should read 선택하세요 while choosing');
check((await page.locator('.trainer-next').count()) === 0, 'train: 다음 button must not show during the think phase');
{
  const tooSmall = await page.locator('.trainer-choice').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 56).length);
  check(tooSmall === 0, `train: ${tooSmall} choice button(s) shorter than 56 px`);
}

// hold-to-pause (on the fan, away from the buttons): countdown freezes, held sheet shows, resumes on release
{
  const box = await page.locator('.trainer-fan').first().boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(400);
  // inline progress width (the stage's scale(.98) hold transition would jitter a bounding rect)
  const barWidth = () => page.evaluate(() => document.querySelector('.timerbar__fill')?.style.width ?? '');
  const t1 = await countdown();
  const w1 = await barWidth();
  await page.waitForTimeout(700);
  const t2 = await countdown();
  const w2 = await barWidth();
  check(t1 === '일시정지', `train: countdown label while holding should be 일시정지 (got "${t1}")`);
  check(w1 !== '' && w1 === w2, `train: timer bar did not freeze while holding (${w1} → ${w2})`);
  const held = await page.locator('.ui-sheet--held, .trainer-hold').count();
  check(held > 0, 'train: hold overlay not shown');
  await shot('05-train-hold');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  const t3 = await countdown();
  check(t3 !== t2, `train: countdown did not resume after release (${t2} → ${t3})`);
  check((await page.locator('.ui-sheet--held').count()) === 0, 'train: hold overlay still shown after release');
}
// choose → reveal state
await page.locator('.trainer-choice').first().tap();
await page.waitForTimeout(500);
await shot('06-train-reveal');
check((await page.locator('.trainer-session--reveal').count()) > 0, 'train: .trainer-session--reveal missing after choosing');
check((await page.locator('.trainer-answer__cap').count()) > 0, 'train: answer cap missing after choosing');
// 리빌 슬롯(EXPLAIN_SPEC §3.1): 캡슐 · 줄 스트립(13칸, 297px) · 줄 문장 하나. 믹스 칩 줄은 없습니다.
{
  const slot = await page.evaluate(() => {
    const strip = document.querySelector('.trainer-answer__strip');
    const reason = document.querySelector('.trainer-answer__reason');
    return {
      cells: strip ? strip.children.length : 0,
      role: strip?.getAttribute('role') ?? null,
      label: strip?.getAttribute('aria-label') ?? '',
      width: strip ? strip.getBoundingClientRect().width : 0,
      ring: document.querySelectorAll('.trainer-answer__strip .lstrip__cell--ring').length,
      text: (reason?.textContent ?? '').trim(),
      mix: document.querySelectorAll('.trainer-answer__mix, .trainer-mix').length,
      slotH: document.querySelector('.trainer-answer')?.getBoundingClientRect().height ?? 0,
      // 짧은 화면(@max-height 740)에서는 114, 그 밖에는 120
      slotWant: window.innerHeight <= 740 ? 114 : 120,
    };
  });
  check(slot.cells === 13, `train: reveal strip should have 13 cells (got ${slot.cells})`);
  check(slot.role === 'img' && slot.label === slot.text && slot.text.length > 0, `train: reveal strip must be role=img named by the line sentence ("${slot.label}" vs "${slot.text}")`);
  check(Math.abs(slot.width - 297) <= 0.5, `train: reveal strip should be 297px wide (got ${slot.width.toFixed(1)})`);
  check(slot.ring === 1, `train: reveal strip should ring exactly one cell (got ${slot.ring})`);
  check(/요\.$/.test(slot.text), `train: reveal line sentence should end in 해요체 ("${slot.text}")`);
  check(slot.mix === 0, 'train: the mix-chip row must be gone from the reveal (EXPLAIN_SPEC §3.1)');
  check(Math.abs(slot.slotH - slot.slotWant) <= 0.5, `train: reveal slot height should stay ${slot.slotWant} (got ${slot.slotH.toFixed(1)})`);
}
check(/해설/.test(await page.locator('.trainer-hud').innerText()), 'train: HUD tag should read 해설 in the reveal state');
// choose mode: the timer row keeps a static hint; the 5 s countdown lives inside the 다음 button
{
  const timerText = await page.locator('.trainer-timer').first().innerText().catch(() => '');
  check(!/\d+\.\d초/.test(timerText), `train: reveal must not bring back the countdown row ("${timerText}")`);
  check(/자동으로 넘어가/.test(timerText), `train: timer row should read 자동으로 넘어가 넘어가요 ("${timerText}")`);
  const think = await page.evaluate(() => getComputedStyle(document.querySelector('.trainer-session__wash')).opacity);
  check(Number(think) > 0.5, `train: reveal wash not visible (opacity ${think})`);
  const counter = () => page.locator('.trainer-hud__count').first().innerText().catch(() => '');
  const nextBtn = page.locator('.trainer-next');
  check((await nextBtn.count()) === 1, 'train: .trainer-next missing in the reveal state');
  if (await nextBtn.count()) {
    const h = (await nextBtn.first().boundingBox())?.height ?? 0;
    check(h >= 56, `train: 다음 button shorter than 56 px (${Math.round(h)})`);
    const label = (await nextBtn.first().innerText()).replace(/\s+/g, ' ').trim();
    check(/다음\s*·?\s*[1-5]/.test(label), `train: 다음 button should carry the countdown (got "${label}")`);
    check((await nextBtn.first().getAttribute('data-auto')) === 'on', 'train: 다음 countdown not armed after choosing');
    const fill = await nextBtn.first().evaluate((el) => ({ w: parseFloat(getComputedStyle(el, '::before').width) || 0, btn: el.getBoundingClientRect().width }));
    check(fill.w > 8 && fill.w <= fill.btn + 1, `train: countdown fill not drawn inside the button (${Math.round(fill.w)} of ${Math.round(fill.btn)})`);
    await shot('06a-train-next-countdown');
    // no input at all: the countdown drains and taps 다음 for the user
    await page.waitForTimeout(6000);
    check(/^2\//.test(await counter()), `train: the 5 s countdown did not advance the card by itself (counter "${await counter()}")`);
    check((await page.locator('.trainer-session--think').count()) > 0, 'train: next card should start in the think state');
    check((await page.locator('.trainer-next').count()) === 0, 'train: 다음 button still shown on the next card');
    await shot('06b-train-next-card');
  }
}
// card 2: 해설 cancels the auto-advance for good, 차트 shows the GTO chart, 다음 moves on by hand
{
  const counter = () => page.locator('.trainer-hud__count').first().innerText().catch(() => '');
  await page.locator('.trainer-choice').first().tap();
  await page.waitForTimeout(400);
  const nextBtn = page.locator('.trainer-next');
  check((await nextBtn.first().getAttribute('data-auto')) === 'on', 'train: card 2 should start its own countdown');
  // 해설 → close: the countdown must not come back
  await page.locator('.trainer-controls__main').first().tap();
  await page.waitForTimeout(500);
  check((await page.locator('.ui-sheet').count()) > 0, 'train: 해설 sheet did not open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const label = (await nextBtn.first().innerText()).replace(/\s+/g, ' ').trim();
  check(!/[0-9]/.test(label), `train: 다음 must lose its number after 해설 (got "${label}")`);
  check((await nextBtn.first().getAttribute('data-auto')) === 'off', 'train: auto-advance restarted after closing 해설');
  const fillOff = await nextBtn.first().evaluate((el) => parseFloat(getComputedStyle(el, '::before').width) || 0);
  check(fillOff < 1, `train: countdown fill still drawn after cancelling (${Math.round(fillOff)}px)`);
  await shot('06c-train-next-cancelled');
  // 차트 sheet: shares + 13×13 grid with the current hand ringed
  const hand = (await page.locator('.trainer-handlabel__name').first().innerText()).trim();
  await page.locator('.trainer-chartbtn').first().tap();
  await page.waitForTimeout(600);
  const sheet = page.locator('.ui-sheet').last();
  check((await sheet.count()) > 0, 'train: 차트 sheet did not open');
  const cells = sheet.locator('.rgrid__cell[aria-label]');
  check((await cells.count()) === 169, `train: chart sheet grid should have 169 labelled cells (got ${await cells.count()})`);
  const hl = sheet.locator(`.rgrid__cell[aria-label="${hand}"][aria-current="true"]`);
  check((await hl.count()) === 1, `train: chart sheet should ring the current hand ${hand}`);
  const cellBox = await cells.first().boundingBox();
  check((cellBox?.width ?? 0) >= 22, `train: chart cells too small (${Math.round(cellBox?.width ?? 0)}px)`);
  // the spec's ≥ 22 px is stated at 360 px, but the device viewport is 390 — check the narrow case too
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(300);
  const cell360 = await cells.first().boundingBox();
  check((cell360?.width ?? 0) >= 22, `train: chart cells too small at 360px (${(cell360?.width ?? 0).toFixed(1)}px)`);
  await shot('06d1-train-chart-sheet-360');
  await noHScroll('train chart sheet 360');
  if (vp) await page.setViewportSize(vp);
  await page.waitForTimeout(300);
  const sheetText = await sheet.innerText();
  check(new RegExp(`내 패 ${hand}는 여기`).test(sheetText.replace(/\s+/g, ' ')), `train: chart sheet caption missing ("${sheetText.slice(0, 60)}")`);
  check(/전체 차트 보기/.test(sheetText), 'train: chart sheet footer button missing');
  await shot('06d-train-chart-sheet');
  await noHScroll('train chart sheet');
  const sessionScrolls = await page.evaluate(() => { const el = document.querySelector('.trainer-session'); return el ? el.scrollHeight > el.clientHeight + 1 : false; });
  check(!sessionScrolls, 'train: the session screen scrolls behind the chart sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check((await page.locator('.trainer-chart').count()) === 0, 'train: chart sheet still open after Escape');
  // still no auto-advance, then tap 다음 by hand
  check(/^2\//.test(await counter()), `train: card advanced while the chart sheet was open (counter "${await counter()}")`);
  await page.waitForTimeout(7000);
  check(/^2\//.test(await counter()), `train: cancelled card advanced by itself (counter "${await counter()}")`);
  check((await nextBtn.first().getAttribute('data-auto')) === 'off', 'train: auto-advance restarted after the 차트 sheet');
  await nextBtn.first().tap();
  await page.waitForTimeout(500);
  check(/^3\//.test(await counter()), `train: 다음 did not advance the counter (got "${await counter()}")`);
}
// end early → summary
await page.locator('.trainer-hud__btn').first().tap();
await page.waitForTimeout(400);
await shot('07-train-end-confirm');
const endBtn = page.locator('.ui-sheet button, .trainer-confirm button', { hasText: /끝|종료|그만|요약/ });
check((await endBtn.count()) > 0, 'train: end-session confirm button missing');
if (await endBtn.count()) { await endBtn.first().tap(); await page.waitForTimeout(700); }
await shot('08-train-summary');
check(/세션|정답/.test(await page.locator('body').innerText()), 'train: summary missing');
check(!(await tabBarHidden()), 'train: tab bar still hidden on summary');

// --- Quiz
await tapText(/^퀴즈$/);
await page.waitForTimeout(400);
await shot('09-quiz-idle');
await tapText(/시작/);
await page.waitForTimeout(700);
await shot('10-quiz-question');
check(/어떻게 할까요\?/.test(await page.locator('.quiz-prompt').first().innerText().catch(() => '')), 'quiz: waiting prompt should read 어떻게 할까요?');
const ans = page.locator('.quiz-answers button');
check((await ans.count()) >= 2, 'quiz: answer buttons missing');
if (await ans.count()) {
  await ans.first().tap(); await page.waitForTimeout(400);
  // 퀴즈 피드백(EXPLAIN_SPEC §5.1): 판정 줄 + 캡슐 + 줄 스트립 + 줄 문장. 믹스 칩 줄은 없습니다.
  const fb = await page.evaluate(() => ({
    verdict: (document.querySelector('.quiz-feedback__verdict')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cap: document.querySelectorAll('.quiz-feedback .lcap').length,
    cells: document.querySelector('.quiz-feedback__strip')?.children.length ?? 0,
    reason: (document.querySelector('.quiz-feedback__reason')?.textContent ?? '').trim(),
    mix: document.querySelectorAll('.quiz-feedback__mix, .quiz-mix').length,
  }));
  check(/^[✓△✕] (정답이에요|부분 정답이에요|아쉬워요 · 정답은 \S.*)$/.test(fb.verdict), `quiz: verdict line should read 정답이에요 / 부분 정답이에요 / 아쉬워요 · 정답은 … (got "${fb.verdict}")`);
  check(fb.cap === 1, 'quiz: feedback answer capsule missing');
  check(fb.cells === 13, `quiz: feedback strip should have 13 cells (got ${fb.cells})`);
  check(/요\.$/.test(fb.reason), `quiz: feedback line sentence missing ("${fb.reason}")`);
  check(fb.mix === 0, 'quiz: .quiz-feedback__mix must be gone (EXPLAIN_SPEC §5.1)');
  // 정답이면 1.5초 뒤 자동으로 넘어가므로, 재기 전에 찍지 않고 잰 다음에 찍습니다.
  await shot('11-quiz-answered');
}
await noHScroll('quiz');
// leave the round
const qClose = page.locator('.quiz-hud__close');
if (await qClose.count()) { await qClose.first().tap(); await page.waitForTimeout(500); }
const qEnd = page.locator('.ui-sheet button, .quiz-confirm button', { hasText: /끝|종료|그만|요약/ });
if (await qEnd.count()) { await qEnd.first().tap(); await page.waitForTimeout(500); }

// --- Coach (실수가 없는 첫 방문 — 콜드 스타트가 비어 보이면 안 된다)
await tapText(/^코치$/);
await page.waitForTimeout(500);
await shot('11b-coach');
await noHScroll('coach');
{
  const body = await page.locator('.screen.coach').innerText().catch(() => '');
  check(body.length > 0, 'coach: screen missing');
  check(/아직 볼 게 없어요|내 성향/.test(body), `coach: neither the empty state nor the axes rendered ("${body.slice(0, 40)}")`);
  // 실수가 없어도 읽을 것이 있어야 한다 (초보가 제일 많이 틀리는 곳 3장).
  check(/초보가 제일 많이 틀리는 곳/.test(body), 'coach: cold-start cards missing');
  check(/내 기록이 아니라 일반적인 이야기예요/.test(body), 'coach: cold-start cards must say they are not the user\'s own record');
  // 실수가 0인데 성향을 단정하면 안 된다.
  check(!/기웁니다|헐겁습니다|샙니다/.test(body), `coach: claimed a tendency with no mistakes ("${body.slice(0, 60)}")`);
}

// --- Charts
await tapText(/^차트$/);
await page.waitForTimeout(500);
await shot('12-charts');
await noHScroll('charts');
const cell = page.locator('[aria-label="AKs"]').first();
check((await cell.count()) > 0, 'charts: AKs cell missing');
if (await cell.count()) {
  await cell.tap(); await page.waitForTimeout(500); await shot('13-charts-cell');
  const sheet = page.locator('.ui-sheet').last();
  const sheetText = await sheet.innerText().catch(() => '');
  check(/이 줄 · /.test(sheetText), 'charts: cell sheet lacks the line block (EXPLAIN_SPEC §4.1)');
  check(/^\S+ \S+.* · AKs$/.test((await sheet.locator('.ui-sheet__title, h2').first().innerText().catch(() => '')).trim()), 'charts: sheet title should be 〈자리〉 〈상황〉 · 〈패〉 (no → 답)');
  check(((await sheet.locator('.ui-explain__sentence').innerText().catch(() => '')).trim().length) > 0, 'charts: cell sheet lacks the line sentence under the strip');
  {
    const strip = await sheet.locator('.ui-explain__line .lstrip--md').first().evaluate((el) => ({ n: el.children.length, w: el.getBoundingClientRect().width })).catch(() => null);
    check(strip !== null && strip.n === 13, 'charts: cell sheet lacks the md line strip (13 cells)');
    if (strip) check(Math.abs(strip.w - 323) <= 0.5, `charts: md strip should be 323px wide (got ${strip.w.toFixed(1)})`);
  }
  // ⑥ 이 패, 다른 자리에서는 › — 블록 전체가 버튼이고, 자리 타일 한 줄에 지금 칸 하나만 링.
  {
    const across = sheet.locator('button.ui-explain__across');
    check((await across.count()) === 1, 'charts: ⑥ 「이 패, 다른 자리에서는 ›」 block should be one button');
    const tiles = await across.locator('.atlas__cell--compact').count();
    const ringed = await across.locator('.atlas__cell--compact.atlas__cell--sel').count();
    check(tiles === 5, `charts: ⑥ should show 5 seat tiles for an rfi cell (got ${tiles})`);
    check(ringed === 1, `charts: ⑥ should ring exactly the current seat (got ${ringed})`);
    check((await across.locator('button').count()) === 0, 'charts: ⑥ tiles must not be nested buttons');
  }
  // 지운 섹션(왜? · 예시 본문 · 플랍에서는 · 결론 머리글)이 돌아오지 않았는지.
  check(!/왜\?|플랍에서는|플랍 이후|결론/.test(sheetText), 'charts: a removed section (왜?/플랍에서는/플랍 이후/결론) is back in the sheet');
  // ⑦ 자세히는 내용이 있을 때만, 그리고 접힌 채로 시작합니다.
  check((await sheet.locator('.ui-explain__more-btn[aria-expanded="true"]').count()) === 0 && (await sheet.locator('.ui-explain__more-body').count()) === 0, 'charts: 자세히 disclosure must start collapsed');
  // 섹션 간격은 .ui-explain 의 flex gap 하나로만 잡힙니다 — 자식에 margin 이 또 붙으면 간격이 두 번 들어갑니다.
  const sectionGaps = await sheet.evaluate((root) => {
    const body = root.querySelector('.ui-explain');
    if (!body || body.children.length < 2) return null;
    const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
    const kids = [...body.children];
    const out = [];
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      out.push({ gap, visual: +(b.top - a.bottom).toFixed(1), margin: getComputedStyle(kids[i]).marginTop, cls: kids[i].className });
    }
    return out;
  });
  check(sectionGaps !== null, 'charts: no explanation sections to measure spacing on');
  for (const g of sectionGaps ?? []) {
    check(Math.abs(g.visual - g.gap) <= 0.5, `charts: ${g.cls} sits ${g.visual}px below the previous section but the gap is ${g.gap}px (margin ${g.margin} stacking on top)`);
  }

  const term = sheet.locator('.term').first();
  check((await term.count()) > 0, 'charts: no glossary .term in the sheet body');
  if (await term.count()) {
    await term.tap(); await page.waitForTimeout(300);
    check((await page.locator('.term-pop').count()) === 1, `charts: tapping a .term should open exactly one .term-pop (got ${await page.locator('.term-pop').count()})`);
    await shot('13b-charts-term');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
}

// --- Settings (pushed from Home)
await tapText(/^홈$/);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /설정/ }).first().tap();
await page.waitForTimeout(500);
await shot('14-settings');
check(/설정/.test(await page.locator('body').innerText()), 'settings: not shown');
check(/섞는 비율 보기/.test(await page.locator('body').innerText()), 'settings: mix toggle should be labelled 섞는 비율 보기');
await noHScroll('settings');
const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !/rgrid|range-cell|ui-chip|dot/.test(b.className); }).map((b) => `${b.className || b.tagName}:${Math.round(b.getBoundingClientRect().height)}px "${(b.textContent || '').trim().slice(0, 12)}"`));
if (small.length) console.log('small buttons (settings):', small.slice(0, 8).join(' | '));

await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
if (fails.length) { console.log('FAILURES:\n' + fails.join('\n')); process.exit(2); }
if (errors.length) process.exit(2);
console.log(`e2e OK — screenshots in ${outDir}`);
