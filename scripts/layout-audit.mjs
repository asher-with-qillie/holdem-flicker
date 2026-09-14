// 박스모델·여백 감사. 각 화면 상태를 폰 3종 너비(360/390/430)에서 열고 DOM 을 훑어
// 다음을 모읍니다: 가로 넘침, 글자 잘림, 고정 높이 박스 넘침, gap 위에 또 얹힌 margin,
// 부모 패딩을 벗어난 자식, 44px 미만 터치 타깃(::before/::after hit-slop 포함), 좌우 거터,
// 스크롤 끝에서 탭바에 가리는 내용.
//
//   npm run preview  (다른 셸에서)
//   node scripts/layout-audit.mjs http://localhost:4173/holdem-flicker/ work/audit
//
// 남는 항목이 전부 근거가 있는지 한 번씩 확인하세요. 지금 남겨 둔 것들:
//   - .rgrid__cell 22px  : 13×13 레인지 그리드. 폰 너비에서 44px 을 줄 방법이 없습니다.
//   - .ui-seg__opt 34~38px: iOS 세그먼트 컨트롤과 같은 높이. 옵션끼리 붙어 있어 빗맞아도 옆 옵션으로 갑니다.
//   - .ui-sheet--held     : 꾹 누르는 동안 뜨는 시트는 일부러 잘라 내고 아래를 페이드로 흐립니다.
//   - .app__main (시트 열림): 시트가 열리면 뒤 화면 스크롤을 잠급니다.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`);

const [url = 'http://localhost:4450/holdem-flicker/', outDir = 'work/audit', seedPath] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

/** 선택: 코치 탭을 채우기 위한 저장소 씨앗 JSON ({ stats, srs }). work/seed-coach.ts 가 만듭니다. */
let SEED = null;
if (seedPath) {
  const { readFileSync } = await import('node:fs');
  const s = JSON.parse(readFileSync(seedPath, 'utf8'));
  SEED = [JSON.stringify(s.stats), JSON.stringify(s.srs)];
}

const SIZES = [
  { w: 360, h: 780, name: '360' },
  { w: 390, h: 844, name: '390' },
  { w: 430, h: 932, name: '430' },
];

const PROBE = () => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const push = (kind, el, detail) => {
    const path = (() => {
      const bits = [];
      for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
        bits.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      }
      return bits.join(' > ');
    })();
    out.push({ kind, path, detail, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  };
  const visible = (el, cs, r) => {
    if (r.width === 0 && r.height === 0) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    if (el.matches('.ui-sr, .sr-only')) return false;  // 스크린리더 전용 — 1px로 숨기는 게 정상
    return true;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    out.push({ kind: 'page-h-overflow', path: 'html', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`, text: '' });
  }

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;

    // 1. 화면 밖으로 삐져나온 요소 (좌우)
    if (r.width > 0 && (r.left < -1 || r.right > vw + 1) && cs.position !== 'fixed' && cs.transform === 'none') {
      const clippedByAncestor = (() => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (/hidden|clip|auto|scroll/.test(pcs.overflowX)) return true;
        }
        return false;
      })();
      if (!clippedByAncestor) push('x-overflow', el, `left ${r.left.toFixed(0)} right ${r.right.toFixed(0)} / vw ${vw}`);
    }

    // 2. 글자가 잘리는 곳 (넘침 숨김인데 내용이 더 큼)
    const hasText = el.childElementCount === 0 && (el.textContent || '').trim().length > 0;
    if (hasText) {
      const clampLines = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (/hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
        push('text-clip-x', el, `scrollW ${el.scrollWidth} > clientW ${el.clientWidth}`);
      }
      if (/hidden|clip/.test(cs.overflowY) && !clampLines && el.scrollHeight > el.clientHeight + 2) {
        push('text-clip-y', el, `scrollH ${el.scrollHeight} > clientH ${el.clientHeight}`);
      }
    }

    // 3. 내용이 자기 박스를 세로로 넘침 (고정 높이 + 넘침 숨김)
    if (el.childElementCount > 0 && /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && cs.overflowX !== 'auto') {
      push('box-clip-y', el, `scrollH ${el.scrollHeight} > clientH ${el.clientHeight}`);
    }

    // 4. 터치 타깃 44px 미만 — ::before/::after 로 넓힌 hit-slop 까지 쳐서 실제 누를 수 있는 크기를 잰다
    const tappable = el.matches('button, a[href], [role="button"], input, select, summary') && !el.disabled;
    if (tappable) {
      let hit = { w: r.width, h: r.height };
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const n = (v) => (v === 'auto' ? 0 : parseFloat(v) || 0);
        hit = {
          w: Math.max(hit.w, r.width - n(ps.left) - n(ps.right)),
          h: Math.max(hit.h, r.height - n(ps.top) - n(ps.bottom)),
        };
      }
      if (hit.w < 44 || hit.h < 44) {
        push('tap-target', el, `${r.width.toFixed(0)}×${r.height.toFixed(0)} (hit ${hit.w.toFixed(0)}×${hit.h.toFixed(0)})`);
      }
    }

    // 4b. gap 을 쓰는 부모 안에서 자식이 또 margin 을 줘서 간격이 두 번 들어감
    {
      const p2 = el.parentElement;
      if (p2) {
        const pcs2 = getComputedStyle(p2);
        const isFlex = /flex|grid/.test(pcs2.display);
        const gapRow = parseFloat(pcs2.rowGap) || 0;
        const gapCol = parseFloat(pcs2.columnGap) || 0;
        const col = pcs2.flexDirection !== 'row' && pcs2.flexDirection !== 'row-reverse';
        const mt = parseFloat(cs.marginTop) || 0, mb = parseFloat(cs.marginBottom) || 0;
        const ml = parseFloat(cs.marginLeft) || 0, mr = parseFloat(cs.marginRight) || 0;
        const axisGap = /grid/.test(pcs2.display) ? Math.max(gapRow, gapCol) : col ? gapRow : gapCol;
        const axisMargin = /grid/.test(pcs2.display) ? Math.max(mt, mb, ml, mr) : col ? Math.max(mt, mb) : Math.max(ml, mr);
        if (isFlex && axisGap > 0 && axisMargin > 0 && p2.children.length > 1 && cs.marginLeft !== 'auto' && cs.marginRight !== 'auto') {
          push('double-gap', el, `parent gap ${axisGap} + child margin ${axisMargin}`);
        }
      }
    }

    // 5. 패딩 있는 부모 밖으로 자식이 삐져나옴 (가로)
    const p = el.parentElement;
    if (p && p !== document.body) {
      const pcs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      const padL = parseFloat(pcs.paddingLeft) || 0;
      const padR = parseFloat(pcs.paddingRight) || 0;
      const inner = { l: pr.left + padL, r: pr.right - padR };
      const negMargin = (parseFloat(cs.marginLeft) || 0) < 0 || (parseFloat(cs.marginRight) || 0) < 0;
      if (!negMargin && (padL > 0 || padR > 0) && cs.position === 'static' && cs.transform === 'none' && pr.width > 0 &&
          (r.left < inner.l - 1.5 || r.right > inner.r + 1.5) && !/hidden|clip|auto|scroll/.test(pcs.overflowX)) {
        push('escapes-padding', el, `child [${r.left.toFixed(0)},${r.right.toFixed(0)}] vs padded [${inner.l.toFixed(0)},${inner.r.toFixed(0)}]`);
      }
    }
  }

  // 6. 좌우 여백(거터) 일관성: 화면 최상위 블록들의 왼쪽 시작점
  const gutters = {};
  const root = document.querySelector('.app__view') ?? document.body;
  for (const el of root.querySelectorAll(':scope > * , :scope > * > *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.position === 'fixed' || cs.position === 'absolute') continue;
    if (r.width < vw * 0.5 || r.height < 8) continue;
    const key = Math.round(r.left);
    gutters[key] = (gutters[key] || 0) + 1;
  }

  // 7. 스크롤 끝에서 마지막 내용이 탭바/하단에 가리는지 (실제 스크롤 컨테이너를 찾아 끝까지 내린다)
  let bottomCut = null;
  {
    const scroller = [...document.querySelectorAll('body *')].find((e) => {
      const cs = getComputedStyle(e);
      return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4;
    }) || document.scrollingElement;
    const before = scroller.scrollTop;
    scroller.scrollTop = scroller.scrollHeight;
    const bar = document.querySelector('.ui-tabbar');
    const barVisible = bar && getComputedStyle(bar).visibility !== 'hidden' && bar.getBoundingClientRect().top < window.innerHeight - 1;
    const floor = barVisible ? bar.getBoundingClientRect().top : window.innerHeight;
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.closest('.ui-tabbar') || el.closest('[aria-hidden="true"]')) continue;
      if (r.height < 6 || r.width < 6) continue;
      if (el.childElementCount > 0 || !(el.textContent || '').trim()) continue;
      if (r.top < floor && r.bottom > floor + 2) {
        const cut = r.bottom - floor;
        if (!worst || cut > worst.cut) worst = { cut, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
      }
    }
    bottomCut = worst;
    // 스크롤 끝에서 남는 여백도 같이 (너무 크면 빈 공간, 음수면 모자람)
    const last = scroller === document.scrollingElement ? document.body : scroller;
    bottomCut = { ...(worst || { cut: 0, text: '' }), scroller: scroller.className || scroller.tagName, atEnd: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) };
    if (!worst) bottomCut.cut = 0;
    scroller.scrollTop = before;
  }

  return { out, gutters, bottomCut };
};

const browser = await chromium.launch();
const report = [];

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const tap = async (re) => { await page.getByRole('button', { name: re }).first().tap(); await page.waitForTimeout(450); };
  const grab = async (name) => {
    await page.waitForTimeout(250);
    const r = await page.evaluate(PROBE);
    report.push({ screen: name, size: size.name, ...r });
    await page.screenshot({ path: `${outDir}/${size.name}-${name}.png`, fullPage: false });
  };

  // 코치 탭은 실수가 쌓여야 화면이 채워집니다. 감사용 씨앗이 있으면 심고, 없으면 빈 화면을 봅니다.
  if (SEED) {
    await ctx.addInitScript(([a, b]) => {
      localStorage.setItem('holdem-flicker.stats.v1', a);
      localStorage.setItem('holdem-flicker.srs.v1', b);
    }, SEED);
  }

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  await grab('home');
  const gear = page.locator('.home__gear, button[aria-label*="설정"]').first();
  if (await gear.count()) {
    await gear.tap();
    await page.waitForTimeout(500);
    await grab('settings');
    await page.locator('.app__push-back').first().tap();
    await page.waitForTimeout(600);
  }

  await tap(/^훈련$/);
  await grab('train-setup');
  await tap(/시작/);
  await page.waitForTimeout(700);
  for (let i = 0; i < 5; i++) {
    const skip = page.getByRole('button', { name: /건너뛰기|시작할게요/ });
    if (!(await skip.count())) break;
    if (i === 0) await grab('train-coach');
    await skip.first().tap();
    await page.waitForTimeout(350);
  }
  await grab('train-think');
  // hold sheet
  {
    const box = await page.locator('.trainer-fan').first().boundingBox();
    if (box) {
      const cdp = await ctx.newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(500);
      await grab('train-hold');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    }
  }
  await page.locator('.trainer-choice').first().tap();
  await page.waitForTimeout(600);
  await grab('train-reveal');
  await page.locator('.trainer-controls__main').first().tap();
  await page.waitForTimeout(600);
  await grab('train-explain-sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('.trainer-chartbtn').first().tap();
  await page.waitForTimeout(700);
  await grab('train-chart-sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('.trainer-hud__btn').first().tap();
  await page.waitForTimeout(450);
  await grab('train-end-confirm');
  const endBtn = page.locator('.ui-sheet button, .trainer-confirm button', { hasText: /끝|종료|그만|요약/ });
  if (await endBtn.count()) { await endBtn.first().tap(); await page.waitForTimeout(800); }
  await grab('train-summary');

  await tap(/^퀴즈$/);
  await grab('quiz');
  const qStart = page.getByRole('button', { name: /시작|출제|풀기/ });
  if (await qStart.count()) { await qStart.first().tap(); await page.waitForTimeout(700); await grab('quiz-run'); }

  // 퀴즈 진행 중이면 탭바가 숨습니다 — 새로 고침해서 홈으로 돌아갑니다.
  if (!(await page.locator('.ui-tabbar').isVisible().catch(() => false))) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
  }

  await tap(/^코치$/);
  await grab('coach');
  {
    const axis = page.locator('.coach-axis__btn');
    if (await axis.count()) { await axis.first().tap(); await page.waitForTimeout(600); await grab('coach-evidence'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    const ask = page.getByRole('button', { name: /질문 복사/ });
    if (await ask.count()) { await ask.first().tap(); await page.waitForTimeout(600); await grab('coach-ask'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    const key = page.getByRole('button', { name: /API 키/ });
    if (await key.count()) { await key.first().tap(); await page.waitForTimeout(600); await grab('coach-key'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  }

  await tap(/^차트$/);
  await grab('charts');
  const cell = page.locator('.rgrid__cell[aria-label]');
  if (await cell.count()) { await cell.nth(40).tap(); await page.waitForTimeout(600); await grab('charts-cell'); }

  await ctx.close();
}

writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));

// ---- 요약 출력
const byKind = new Map();
for (const r of report) for (const p of r.out) {
  const k = `${p.kind}|${p.path}|${p.detail.replace(/\d+/g, '#')}`;
  if (!byKind.has(k)) byKind.set(k, { ...p, where: new Set() });
  byKind.get(k).where.add(`${r.size}/${r.screen}`);
}
const order = ['page-h-overflow', 'x-overflow', 'text-clip-x', 'text-clip-y', 'box-clip-y', 'escapes-padding', 'tap-target'];
const rows = [...byKind.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
console.log(`\n=== ${rows.length} distinct issues across ${report.length} screen×size probes ===\n`);
for (const r of rows) {
  console.log(`[${r.kind}] ${r.path}`);
  console.log(`   ${r.detail}  ·  "${r.text}"`);
  console.log(`   @ ${[...r.where].slice(0, 6).join(', ')}${r.where.size > 6 ? ` +${r.where.size - 6}` : ''}`);
}
console.log('\n=== gutters (left offset → count) ===');
for (const r of report) {
  const g = Object.entries(r.gutters).sort((a, b) => b[1] - a[1]);
  if (g.length > 1) console.log(`${r.size}/${r.screen}: ${g.map(([k, v]) => `${k}px×${v}`).join('  ')}`);
}
console.log('\n=== bottom cut by tab bar ===');
for (const r of report) if (r.bottomCut && r.bottomCut.cut > 0) console.log(`${r.size}/${r.screen}: ${r.bottomCut.cut.toFixed(0)}px cut  "${r.bottomCut.text}"  [${r.bottomCut.scroller}]`);
await browser.close();
