// 박스모델·여백 감사. 각 화면 상태를 폰 3종 너비(360/390/430)와 iPhone Duo 의 모든 자세·툴바 상태
// (docs/REDESIGN_SPEC.md §11)에서 열고 DOM 을 훑어 다음을 모읍니다: 가로 넘침, 글자 잘림, 고정 높이 박스 넘침,
// gap 위에 또 얹힌 margin, 부모 패딩을 벗어난 자식, 44px 미만 터치 타깃(::before/::after hit-slop 포함), 좌우 거터,
// 스크롤 끝에서 탭바에 가리는 내용.
//
//   npm run build && npx vite preview --port 4450 --strictPort  (다른 셸에서)
//   node scripts/layout-audit.mjs http://localhost:4450/holdem-flicker/ work/audit [seed.json] [--only=…] [--jobs=3] [--skip=…] [--no-gate]
//
//   --only=a,b   크기 이름(360, 382x580, 951x669-l84 …) 또는 묶음(phone, safari, duo, squat, land, tall, wide)만 돕니다.
//                toolbar · fold · reveal 패스도 이름 또는 크기로 거릅니다(예: --only=duo,toolbar).
//   --skip=flow,toolbar,fold,reveal   해당 패스를 건너뜁니다.
//   --jobs=N     동시에 여는 브라우저 컨텍스트 수(기본 3). 타이머를 재는 검사가 있어 4 이상은 권하지 않습니다.
//   --no-gate    실패가 있어도 exit 0.
//
// 남는 항목이 전부 근거가 있는지 한 번씩 확인하세요. 지금 남겨 둔 것들(정보용 kind — exit code 에는 영향 없음):
//   - .rgrid__cell 22px  : 13×13 레인지 그리드. 폰 너비에서 44px 을 줄 방법이 없습니다.
//   - .atlas__cell        : 자리별 보기의 타일. 스트립은 52px 정사각(360px 기준), 삼각형 칸은 52×44 — 한 줄에 라벨 열 +
//                          5칸을 328px 안에 넣어야 해서 삼각형 칸 높이를 44 아래로 내릴 수는 없지만, 폭이 더 좁아지면
//                          (320px) 44 미만이 됩니다. .rgrid__cell 과 같은 사유로 남겨 둡니다.
//   - .ui-seg__opt 34~38px: iOS 세그먼트 컨트롤과 같은 높이. 옵션끼리 붙어 있어 빗맞아도 옆 옵션으로 갑니다.
//   - button.term 25~37px : 본문 한가운데 있는 인라인 용어 버튼. 44px 을 주면 윗줄·아랫줄을 덮습니다.
//                          explain.css 에서 ::after 로 위아래 6px 씩 눌리는 영역만 넓혀 뒀습니다.
//                          (개발 서버로 돌리면 안 보입니다 — 용어가 렌더되는 건 프로덕션 빌드 기준입니다)
//   - .ui-sheet--held     : 꾹 누르는 동안 뜨는 시트는 일부러 잘라 내고 아래를 페이드로 흐립니다.
//   - .app__main (시트 열림): 시트가 열리면 뒤 화면 스크롤을 잠급니다.
//
// Duo 게이트 검사(실패하면 exit 1 — docs/REDESIGN_SPEC.md §11.7):
//   class         html[data-layout|data-bar|data-short] 가 §11.2 표와 같은지 (svh 기준)
//   stage-fit     스크롤 없는 화면(.app__main--fixed · .vb__core · .quiz-round · .charts--stage)이 넘치지 않는지,
//                 문서(scrollingElement)가 절대 스크롤하지 않는지
//   control-hidden 선택 버튼 · 다음 · ✕ · 퀴즈 답이 화면 안에 있고 다른 것에 덮이지 않았는지
//   toolbar-step  Safari 툴바가 접히거나 펴질 때(뷰포트 높이 svh ↔ lvh) 버튼 · 시트 위 가장자리 · 탭 바가 물리적으로
//                 그대로인지(data-bar=bottom: y, data-bar=top: innerHeight − y), slack ≥ 38 이면 지난 카드 줄(R)이 보이는지,
//                 접힌 상태에서도 stage-fit · control-hidden 이 0 인지
//   fan-min       카드 폭 ≥ 30 이거나 fan 이 숨었는지, 카드가 옆 요소와 겹치지 않는지
//   masked        think 동안 세션 · 퀴즈의 차트(G/T)가 가림 상태인지(.rgrid--masked, 칠 층 opacity 0). 폰 think 에는 지도 없음
//   seam          tall 세션의 위 블록과 아래 블록 사이 ≥ 24
//   crease        wide 에서 글자 · 탭 대상이 가운데 접힘선 ±20 에 걸리지 않는지(시트 포함)
//   corner        land 에서 모든 탭 대상이 반경 59 둥근 사각형 안에 있는지
//   band-84       좌/우 inset 84 스트레스에서 inset 띠 안에 대화형 요소가 없는지
//   rail-overlap  land/wide 의 레일 아래에 콘텐츠가 없는지
//   grid-visible  차트 탭에서 land/tall/wide 는 13행, squat(svh ≥ 580)은 11행 이상이 바 위로 보이는지
//   cell-nonmodal 차트 셀 상세가 열린 채 다른 셀을 누르면 내용만 바뀌는지
//   fold          접기/펼치기 연속(382×580 → 466×498 → 669×867 → 951×585 → 951×620 → 382×580 → 385×571) 동안
//                 클래스 전환, 세션 카드 · 열린 시트(같은 DOM 노드) · 본문 scrollTop · 고른 셀 보존, think 중 폭 점프면
//                 일시정지되고 타이머가 만료되지 않는지
//   reveal-slot   리빌 슬롯 높이 · 띠 폭 · 줄 문장 ≤ 2줄 (아래)
//
// Chromium 은 svh 와 dvh 를 구분하지 못합니다. 툴바가 접힌 상태(뷰포트 = lvh)는 `--vh-core` 를 svh 로 덮어쓰고
// viewport.ts 의 svh 측정 probe 높이도 같은 값으로 고정해 흉내 냅니다. safe-area 는 `--safe-*` 토큰을 덮어써서 줍니다.
//
// 리빌 슬롯 검사(docs/EXPLAIN_SPEC.md §7.2-15): 360×640 · 390×844 와 Duo 네 자세에서 §3.6 의 13칸과 emWidth 상위 30개
// 문장을 실제 훈련 세션으로 띄웁니다('지난 세션 → 틀린 것만 다시' 경로에 그 카드 키들을 심어 둡니다). 카드마다 정답을
// 골라 리빌을 열고 줄 문장 ≤ 2줄 · 슬롯 높이(120/114, tall·wide 132) 그대로 · 띠 폭(sm 297, md 323) · 가로 스크롤 없음을
// 확인합니다.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`);

const ARGV = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGV.filter((a) => a.startsWith('--')).map((a) => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; }));
const [url = 'http://localhost:4450/holdem-flicker/', outDir = 'work/audit', seedPath] = ARGV.filter((a) => !a.startsWith('--'));
const ONLY = FLAGS.only ? new Set(FLAGS.only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const SKIP = new Set((FLAGS.skip ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const JOBS = Math.max(1, Number(FLAGS.jobs) || 3);
mkdirSync(outDir, { recursive: true });

/** 선택: 코치 탭을 채우기 위한 저장소 씨앗 JSON ({ stats, srs }). work/seed-coach.ts 가 만듭니다. */
let SEED = null;
if (seedPath) {
  const s = JSON.parse(readFileSync(seedPath, 'utf8'));
  SEED = [JSON.stringify(s.stats), JSON.stringify(s.srs)];
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const Z = { t: 0, b: 0, l: 0, r: 0 };

/** src/state/viewport.ts 의 classify 와 같은 식(§11.2). 기대값 표를 손으로 적은 것과 서로 맞는지 시작할 때 확인합니다. */
const classify = (w, h) => (w < 560 ? (h < 640 ? 'squat' : 'phone') : h < 480 || (h < 760 && w < 820) ? 'land' : h < 760 ? 'wide' : 'tall');
const barOf = (l) => (l === 'tall' || l === 'wide' ? 'top' : 'bottom');
const shortOf = (h) => (h <= 700 ? '700' : h <= 740 ? '740' : '');

// 기존 폰 3종: 예전 감사와 결과를 견줄 수 있게 이름 · DPR · safe-area(0)를 그대로 둡니다.
const SIZES = [
  { w: 360, h: 780, name: '360', dpr: 2, safe: Z, state: 'device', group: 'phone', expect: { layout: 'phone', short: '' } },
  { w: 390, h: 844, name: '390', dpr: 2, safe: Z, state: 'device', group: 'phone', expect: { layout: 'phone', short: '' } },
  { w: 430, h: 932, name: '430', dpr: 2, safe: Z, state: 'device', group: 'phone', expect: { layout: 'phone', short: '' } },
];

/**
 * Safari 툴바 상태별 뷰포트(§11.2 표 · Duo spec §1.3 · §2.6 · §8 D1). h = innerHeight(frame), svh = 가장 나쁜 툴바 상태의
 * 높이(접힌 상태에서만 h 보다 작음). state: expanded(툴바 펼침) · collapsed(스크롤로 접힘) · shared(Shared with You 막대) ·
 * standalone(홈 화면 앱, 툴바 없음) · split(Split View 한 칸) · transition(접는 중) · stress(84 inset).
 */
const sz = (w, h, o = {}) => {
  const safe = { ...Z, ...(o.safe ?? {}) };
  const sfx = o.sfx ?? '';
  const H = Math.min(o.svh ?? h, h);
  return {
    w, h, svh: o.svh ?? 0, name: `${w}x${h}${sfx}`, dpr: o.dpr ?? 3, safe, state: o.state ?? 'expanded', group: o.group ?? 'duo', note: o.note ?? '',
    expect: { layout: o.layout, short: shortOf(H) },
  };
};
const SAFARI_SIZES = [
  sz(390, 664, { layout: 'phone', group: 'safari', note: 'iPhone 13 Safari, 툴바 펼침' }),
  sz(390, 750, { svh: 664, state: 'collapsed', layout: 'phone', group: 'safari', note: 'iPhone 13 Safari, 툴바 접힘' }),
  sz(430, 739, { layout: 'phone', group: 'safari', note: 'Pro Max Safari' }),
];
const DUO_SIZES = [
  // 바깥 화면 세로
  sz(382, 580, { layout: 'squat', note: '바깥 세로 Safari (Bottom 설정, 펼침)' }),
  sz(382, 618, { svh: 580, state: 'collapsed', layout: 'squat', note: '바깥 세로 Safari, 툴바 접힘' }),
  sz(382, 618, { svh: 580, state: 'collapsed', safe: { b: 34 }, sfx: '-b34', layout: 'squat', note: '바깥 세로 접힘 + 홈 인디케이터' }),
  sz(382, 540, { state: 'shared', layout: 'squat', note: '바깥 세로, Shared with You 막대' }),
  sz(382, 678, { state: 'standalone', safe: { b: 34 }, sfx: '-b34', layout: 'phone', note: '바깥 세로 standalone' }),
  // 바깥 화면 가로
  sz(594, 368, { layout: 'land', note: '바깥 가로 Safari, 펼침' }),
  sz(594, 406, { svh: 368, state: 'collapsed', layout: 'land', note: '바깥 가로 Safari, 접힘' }),
  sz(594, 406, { svh: 368, state: 'collapsed', safe: { b: 21 }, sfx: '-b21', layout: 'land', note: '바깥 가로 접힘 + 홈 인디케이터' }),
  sz(594, 466, { state: 'standalone', safe: { b: 21 }, sfx: '-b21', layout: 'land', note: '바깥 가로 standalone (B21)' }),
  sz(594, 356, { layout: 'land', note: '바깥 가로, Top 설정 하한' }),
  sz(678, 340, { layout: 'land', note: '시뮬레이터 이상치' }),
  // 안쪽 화면 세로
  sz(669, 825, { layout: 'tall', note: '안쪽 세로, 탭 여러 개' }),
  sz(669, 867, { layout: 'tall', note: '안쪽 세로, 탭 1개 펼침' }),
  sz(669, 902, { svh: 867, state: 'collapsed', layout: 'tall', note: '안쪽 세로, 접힘' }),
  sz(669, 951, { state: 'standalone', safe: { t: 24, b: 34 }, sfx: '-t24b34', layout: 'tall', note: '안쪽 세로 standalone' }),
  // 안쪽 화면 가로
  sz(951, 543, { layout: 'wide', note: '안쪽 가로, 탭 여러 개' }),
  sz(951, 585, { layout: 'wide', note: '안쪽 가로, 펼침' }),
  sz(951, 620, { svh: 585, state: 'collapsed', layout: 'wide', note: '안쪽 가로, 접힘' }),
  sz(951, 669, { state: 'standalone', safe: { b: 34 }, sfx: '-b34', layout: 'wide', note: '안쪽 가로 standalone' }),
  // Split View · 과도 상태 · 갱신 안 된 standalone
  sz(385, 571, { state: 'split', layout: 'squat', note: 'Split View 한 칸' }),
  sz(385, 609, { svh: 571, state: 'split', layout: 'squat', note: 'Split View 한 칸, 접힘' }),
  sz(867, 587, { state: 'standalone', safe: { b: 34 }, sfx: '-b34', layout: 'wide', note: '펼친 뒤 갱신 안 된 standalone' }),
  sz(466, 498, { state: 'transition', layout: 'squat', note: '접는 중 과도 상태' }),
  // 84 inset 스트레스
  sz(466, 678, { state: 'stress', safe: { r: 84 }, sfx: '-r84', layout: 'phone', note: '바깥 standalone 대안, 오른쪽 inset 84' }),
  sz(951, 669, { state: 'stress', safe: { b: 34, r: 84 }, sfx: '-r84', layout: 'wide', note: '안쪽 가로 standalone, 오른쪽 inset 84' }),
  sz(951, 669, { state: 'stress', safe: { b: 34, l: 84 }, sfx: '-l84', layout: 'wide', note: '안쪽 가로 standalone, 왼쪽 inset 84' }),
];
const ALL_SIZES = [...SIZES, ...SAFARI_SIZES, ...DUO_SIZES];
for (const s of ALL_SIZES) {
  const H = Math.min(s.svh || s.h, s.h);
  s.expect.bar = barOf(s.expect.layout);
  if (classify(s.w, H) !== s.expect.layout) throw new Error(`size table: ${s.name} expects ${s.expect.layout} but classify() says ${classify(s.w, H)}`);
}
const wanted = (s) => !ONLY || ONLY.has(s.name) || ONLY.has(s.group) || ONLY.has(s.expect.layout) || ONLY.has(`${s.w}x${s.h}`);

/** 다음 페이지 로드부터 safe-area 와 (접힌 상태면) svh 를 흉내 냅니다. 실행 중에는 window.__auditEmu(cfg) 로 바꿉니다. */
function emuInit(cfg0) {
  let cfg = cfg0;
  const css = (c) => {
    let s = `:root:root{--safe-top:${c.t}px!important;--safe-bottom:${c.b}px!important;--safe-left:${c.l}px!important;--safe-right:${c.r}px!important}`;
    // 툴바가 접힌 상태: frame(dvh) = 뷰포트, core = svh. viewport.ts 의 svh probe(인라인 height:100svh)도 같은 값으로 고정합니다.
    if (c.svh) s += `:root:root{--vh-core:${c.svh}px!important}html>div[aria-hidden="true"][style*="100svh"]{height:${c.svh}px!important}`;
    return s;
  };
  const add = () => {
    if (document.getElementById('audit-emu')) return;
    const st = document.createElement('style');
    st.id = 'audit-emu';
    st.textContent = css(cfg);
    (document.head || document.documentElement).appendChild(st);
  };
  window.__auditEmu = (c) => { cfg = c; add(); document.getElementById('audit-emu').textContent = css(c); };
  if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true });
}
const emuCfg = (size, svh = size.svh) => ({ ...size.safe, svh: svh || 0 });

async function newCtx(browser, size) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: UA,
  });
  await ctx.addInitScript(emuInit, emuCfg(size));
  return ctx;
}
const classOf = (page) => page.evaluate(() => { const d = document.documentElement.dataset; return { layout: d.layout ?? '', bar: d.bar ?? '', short: d.short ?? '' }; });

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
  /** box-shadow 문자열에서 바깥 그림자가 각 변으로 번지는 최대 폭. inset 은 제외. 없으면 null. */
  const shadowExtent = (bs) => {
    if (!bs || bs === 'none') return null;
    const parts = []; let depth = 0, cur = '';
    for (const ch of bs) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    let t = 0, rr = 0, b = 0, l = 0, any = false;
    for (const raw of parts) {
      const p = raw.trim();
      if (/(^|\s)inset(\s|$)/.test(p)) continue;
      // 색 함수(rgba()/color()/color-mix())를 먼저 지워야 그 안의 숫자를 길이로 오해하지 않습니다.
      const nums = p.replace(/[a-z-]+\([^)]*\)/g, '').match(/-?\d*\.?\d+px/g);
      if (!nums || nums.length < 2) continue;
      const [ox, oy, blur = 0, spread = 0] = nums.map(parseFloat);
      any = true;
      t = Math.max(t, -oy + blur + spread); b = Math.max(b, oy + blur + spread);
      l = Math.max(l, -ox + blur + spread); rr = Math.max(rr, ox + blur + spread);
    }
    return any && (t > 0 || rr > 0 || b > 0 || l > 0) ? { t, r: rr, b, l } : null;
  };
  const visible = (el, cs, r) => {
    if (r.width === 0 && r.height === 0) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    // 스크린리더 전용 글자(1px 상자로 clip)는 화면에 그려지지 않으니 잘림 검사 대상이 아닙니다.
    if (el.closest('.trainer-sr, .ui-sr, .sr-only')) return false;
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
      // text-overflow: ellipsis 는 '일부러 줄였고 …로 표가 난다'는 뜻이라 봐주고 넘어갑니다.
      // 그런데 flex·grid 컨테이너에서는 ellipsis 가 **아예 듣지 않습니다** — CSS 에 적혀만
      // 있고 브라우저는 … 없이 그냥 싹둑 자릅니다. 그런 곳까지 봐주면 검사가 진짜 잘림을
      // 놓칩니다(.ui-btn__label 이 inline-flex + ellipsis 라 실제로 놓쳤습니다).
      const ellipsisWorks = cs.textOverflow === 'ellipsis' && !/flex|grid/.test(cs.display);
      if (/hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && !ellipsisWorks) {
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

    // 5. 바깥 그림자가 스크롤 컨테이너에 잘림.
    //    overflow-y:auto 를 주면 overflow-x 도 auto 로 계산되므로, 거터보다 넓게 번지는 그림자는
    //    화면 좌우에서 직선으로 싹둑 잘려 '버튼이 상자에 갇힌' 모양이 됩니다. 눈에는 잘 안 띄지만
    //    화면 전체의 깊이감을 죽이는 종류라 사람이 아니라 도구가 잡아야 합니다.
    //    스크롤로 나중에 보이게 될 영역은 잘림이 아니므로, 보이는 창이 아니라 scrollWidth/Height 와 견줍니다.
    const ext = shadowExtent(cs.boxShadow);
    if (ext) {
      // 예산 위반은 '오늘 잘리는가'와 별개로 잡습니다 — 지금 안 잘려도 다른 화면·다른 폭에서 잘립니다.
      // 붙박이(fixed)는 어떤 스크롤 컨테이너 안에도 들어 있지 않으므로 예산을 적용하지 않습니다
      // (탭 바·시트·슬라이드오버는 화면 밖으로 번지는 게 정상입니다).
      const room = cs.position === 'fixed' ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glow-room')) || 0;
      if (room > 0 && Math.max(ext.l, ext.r) > room + 0.5) {
        push('glow-budget', el, `shadow bleeds ${Math.max(ext.l, ext.r).toFixed(0)}px sideways, budget --glow-room is ${room}`);
      }
      const box = { t: r.top - ext.t, rt: r.right + ext.r, b: r.bottom + ext.b, l: r.left - ext.l };
      for (let p3 = el.parentElement; p3; p3 = p3.parentElement) {
        const pcs3 = getComputedStyle(p3);
        const clipX = pcs3.overflowX !== 'visible', clipY = pcs3.overflowY !== 'visible';
        if (!clipX && !clipY) continue;
        const pr3 = p3.getBoundingClientRect();
        const cl = pr3.left + p3.clientLeft, ct = pr3.top + p3.clientTop;
        const cut = [];
        // 잘리는 가장자리가 화면 가장자리와 같으면(예: 화면을 꽉 채운 .app) 잘린 그림자는 어차피 화면 밖이라 보이지 않습니다.
        const vw0 = document.documentElement.clientWidth, vh0 = innerHeight;
        const edgeT = ct <= 0.5, edgeL = cl <= 0.5, edgeB = ct + p3.clientHeight >= vh0 - 0.5, edgeR = cl + p3.clientWidth >= vw0 - 0.5;
        if (clipY && !edgeT && box.t - ct + p3.scrollTop < -0.5) cut.push(`top ${(ct - p3.scrollTop - box.t).toFixed(0)}`);
        if (clipY && !edgeB && box.b - ct + p3.scrollTop > p3.scrollHeight + 0.5) cut.push(`bottom ${(box.b - ct + p3.scrollTop - p3.scrollHeight).toFixed(0)}`);
        if (clipX && !edgeL && box.l - cl + p3.scrollLeft < -0.5) cut.push(`left ${(cl - p3.scrollLeft - box.l).toFixed(0)}`);
        if (clipX && !edgeR && box.rt - cl + p3.scrollLeft > p3.scrollWidth + 0.5) cut.push(`right ${(box.rt - cl + p3.scrollLeft - p3.scrollWidth).toFixed(0)}`);
        if (cut.length) push('glow-clip', el, `shadow cut ${cut.join(', ')} by ${p3.className || p3.tagName.toLowerCase()}`);
        break;
      }
    }

    // 6. 패딩 있는 부모 밖으로 자식이 삐져나옴 (가로)
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

  // 7. 좌우 여백(거터) 일관성: 화면 최상위 블록들의 왼쪽 시작점
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

/**
 * Duo 게이트 검사(머리 주석 참조). o 에 켜진 검사만 돕니다. 검사할 대상이 화면에 없으면 missing 에 이름을 넣습니다 —
 * 조용히 건너뛰면 검사가 도는 척만 합니다.
 */
const DUO_PROBE = (o) => {
  const out = [];
  const missing = [];
  const metrics = {};
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const pathOf = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      bits.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return bits.join(' > ');
  };
  const push = (kind, el, detail) => out.push({ kind, path: el ? pathOf(el) : 'html', detail, text: el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '' });
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    // 1–2px 상자(스크린리더 전용 글자를 clip 으로 숨기는 패턴)는 보이는 것으로 치지 않습니다.
    if (r.width < 2.5 || r.height < 2.5) return false;
    if (getComputedStyle(el).visibility === 'hidden') return false;
    if (el.matches('.ui-sr, .sr-only, .trainer-sr')) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || Number(c.opacity) < 0.05) return false;
      if (c.clip && c.clip !== 'auto') return false;
    }
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    return true;
  };
  const inView = (r) => r.right > 0.5 && r.left < vw - 0.5 && r.bottom > 0.5 && r.top < vh - 0.5;
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const TAP = 'button, a[href], [role="button"], input, select, summary, [tabindex]:not([tabindex="-1"])';
  /** 보이는 부분만: 스크롤러 · overflow 로 잘린 조상의 상자와 겹친 부분(가로 스크롤 칩 줄 밖으로 밀린 칩은 0). */
  const visCache = new WeakMap();
  const visRect = (el) => {
    if (visCache.has(el)) return visCache.get(el);
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      const cx = c.overflowX !== 'visible', cy = c.overflowY !== 'visible';
      if (cx || cy) {
        const b = n.getBoundingClientRect();
        if (cx) { left = Math.max(left, b.left + (parseFloat(c.borderLeftWidth) || 0)); right = Math.min(right, b.right - (parseFloat(c.borderRightWidth) || 0)); }
        if (cy) { top = Math.max(top, b.top + (parseFloat(c.borderTopWidth) || 0)); bottom = Math.min(bottom, b.bottom - (parseFloat(c.borderBottomWidth) || 0)); }
      }
      if (c.position === 'fixed') break;
    }
    const v = { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom), width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    visCache.set(el, v);
    return v;
  };
  const tappables = () => [...document.querySelectorAll(TAP)].filter((el) => { if (el.disabled || !shown(el)) return false; const v = visRect(el); return v.width > 0.5 && v.height > 0.5 && inView(v); });
  /** 글자 상자: 요소 상자가 아니라 실제 글자 줄의 사각형(블록 p 가 넓어도 글자가 짧으면 짧게). */
  const textRects = () => {
    const res = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !shown(el)) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5 && inView(r)) res.push({ el, r });
    }
    return res;
  };
  const r0 = (n) => Math.round(n);

  // 문서는 절대 스크롤하지 않습니다(.app 은 fixed inset 0, 스크롤은 안쪽 스크롤러에서만).
  if (o.docScroll) {
    const se = document.scrollingElement;
    if (se.scrollHeight > vh + 1) push('stage-fit', null, `document scrolls: scrollHeight ${se.scrollHeight} > innerHeight ${vh}`);
  }

  if (o.stageFit) {
    const boxes = [...document.querySelectorAll('.app__main--fixed, .vb__core, .quiz-round, .charts--stage')].filter(shown);
    if (!boxes.length) missing.push('stage-fit');
    for (const b of boxes) if (b.scrollHeight > b.clientHeight + 1) push('stage-fit', b, `scrollHeight ${b.scrollHeight} > clientHeight ${b.clientHeight} (+${b.scrollHeight - b.clientHeight})`);
  }

  if (o.controls) {
    let found = 0;
    for (const sel of o.controls) {
      for (const el of document.querySelectorAll(sel)) {
        if (!shown(el)) continue;
        found++;
        const r = el.getBoundingClientRect();
        if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5) {
          push('control-hidden', el, `outside the viewport: [${r0(r.left)},${r0(r.top)} – ${r0(r.right)},${r0(r.bottom)}] vs ${vw}×${vh}`);
          continue;
        }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) push('control-hidden', el, `covered at its centre by ${pathOf(hit)}`);
      }
    }
    if (!found) missing.push('controls');
  }

  if (o.fan) {
    const fans = [...document.querySelectorAll('.trainer-fan, .quiz-hand')];
    if (!fans.length) missing.push('fan-min');
    for (const fan of fans) {
      if (!shown(fan)) continue; // 숨겨진 fan(배율 < .5)은 통과
      const cards = [...fan.querySelectorAll('.pc')].filter(shown);
      if (!cards.length) continue;
      const rs = cards.map((c) => c.getBoundingClientRect());
      const w = Math.min(...rs.map((r) => r.width));
      metrics.cardW = Math.round(w * 10) / 10;
      if (w < 30) push('fan-min', fan, `card ${w.toFixed(1)}px wide (< 30) and the fan is still shown`);
      const u = { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
      const scope = fan.closest('.vb__core, .quiz-round, .trainer-session') ?? document.body;
      for (const sib of scope.querySelectorAll('.trainer-handlabel, .quiz-handlabel, .stagechart, .trainer-choices, .quiz-answers, .trainer-answer, .quiz-feedback, .trainer-situation, .quiz-situation, .trainer-strip, .trainer-hud, .quiz-hud, .trainer-controls')) {
        if (sib.contains(fan) || fan.contains(sib) || !shown(sib)) continue;
        const a = overlap(u, sib.getBoundingClientRect());
        if (a > 2) push('fan-min', sib, `cards overlap ${pathOf(sib).split(' > ').pop()} by ${Math.round(a)}px²`);
      }
    }
  }

  if (o.masked) {
    const scope = document.querySelector('.vb__core') ?? document.querySelector('.app__main');
    // 무대가 낮아 T 를 숨긴 경우(스펙: stage ≤ 95 → T 숨김)도 있으니, 보이는지가 아니라 DOM 에 있는지로 대상을 셉니다.
    // 숨겨진 지도도 가림 상태여야 합니다(크기가 바뀌어 다시 보일 때 답이 비치면 안 됨).
    const grids = scope ? [...scope.querySelectorAll('.rgrid')] : [];
    if (o.expectMap && !grids.length) missing.push('masked');
    if (!o.expectMap && scope && [...scope.querySelectorAll('.stagechart')].some(shown)) push('masked', scope.querySelector('.stagechart'), 'phone think must stay as before: no chart map while thinking');
    for (const g of grids) {
      if (!g.classList.contains('rgrid--masked')) { push('masked', g, 'chart shows action colours during think (.rgrid--masked missing)'); continue; }
      const painted = [...g.querySelectorAll('.rgrid__cell')].filter((c) => (shown(g) && Number(getComputedStyle(c, '::before').opacity) > 0.01) || c.style.getPropertyValue('--paint'));
      if (painted.length) push('masked', g, `${painted.length} cell(s) carry paint while masked`);
    }
  }

  if (o.seam) {
    const q = document.querySelector('.trainer-q, .quiz-zq'), ctx = document.querySelector('.trainer-ctx, .quiz-ctx'), a = document.querySelector('.trainer-a, .quiz-za');
    if (!q || !a) missing.push('seam');
    else {
      const upper = Math.max(q.getBoundingClientRect().bottom, ctx && shown(ctx) ? ctx.getBoundingClientRect().bottom : -Infinity);
      const seam = a.getBoundingClientRect().top - upper;
      metrics.seam = Math.round(seam);
      if (seam < 23.5) push('seam', a, `seam ${seam.toFixed(1)}px < 24 between the top block and the answer block`);
    }
  }

  if (o.crease) {
    const x0 = vw / 2 - 20, x1 = vw / 2 + 20;
    const band = { left: x0, right: x1, top: 0, bottom: vh };
    const seen = new Set();
    // 글자도 보이는 부분만 봅니다 — 가로 스크롤러 밖으로 밀려 잘린 글자는 접힘선 위에 그려지지 않습니다.
    const clipTo = (r, el) => { const v = visRect(el); return { left: Math.max(r.left, v.left), right: Math.min(r.right, v.right), top: Math.max(r.top, v.top), bottom: Math.min(r.bottom, v.bottom) }; };
    for (const { el, r: r1 } of textRects()) {
      const r = clipTo(r1, el);
      if (seen.has(el) || r.right - r.left < 0.5 || overlap(r, band) <= 0.5) continue;
      seen.add(el);
      push('crease', el, `text [${r0(r.left)}–${r0(r.right)}] crosses the crease band [${r0(x0)}–${r0(x1)}]`);
    }
    for (const el of tappables()) {
      const r = visRect(el);
      if (seen.has(el) || overlap(r, band) <= 0.5) continue;
      seen.add(el);
      push('crease', el, `tap target [${r0(r.left)}–${r0(r.right)}] crosses the crease band [${r0(x0)}–${r0(x1)}]`);
    }
  }

  if (o.corner) {
    const R = o.corner;
    const inside = (x, y) => {
      const cx = x < R ? R : x > vw - R ? vw - R : null;
      const cy = y < R ? R : y > vh - R ? vh - R : null;
      if (cx === null || cy === null) return true;
      return Math.hypot(x - cx, y - cy) <= R + 0.5;
    };
    // 실제로 스크롤하는 조상(overflow auto/scroll + 넘치는 내용) 안에 있는지
    const inScroller = (el) => {
      for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const c = getComputedStyle(n);
        const sy = /auto|scroll/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 1;
        const sx = /auto|scroll/.test(c.overflowX) && n.scrollWidth > n.clientWidth + 1;
        if (sx || sy) return true;
        if (c.position === 'fixed') break;
      }
      return false;
    };
    // 모달 시트가 열려 있으면 그 밖의 대상은 배경막 아래라 누를 수 없습니다(누르면 시트가 닫힘) — 검사하지 않습니다.
    const modal = [...document.querySelectorAll('.ui-sheet[aria-modal="true"]')].pop() || null;
    for (const el of tappables()) {
      if (modal && !modal.contains(el)) continue;
      const r = visRect(el), b = el.getBoundingClientRect();
      // 스크롤러에 반쯤 잘린 대상(스크롤 도중)만 건너뜁니다 — 스크롤하는 글이 모서리 밑으로 지나가는 건 정상이고, 끝까지 밀면 제자리에
      // 옵니다. 스크롤하지 않는 overflow:hidden 에 잘린 대상은 보이는 부분(visRect)으로 그대로 검사합니다.
      const clipped = Math.abs(r.top - b.top) > 0.5 || Math.abs(r.bottom - b.bottom) > 0.5 || Math.abs(r.left - b.left) > 0.5 || Math.abs(r.right - b.right) > 0.5;
      if (clipped && inScroller(el)) continue;
      const bad = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].filter(([x, y]) => !inside(x, y));
      if (bad.length) push('corner', el, `tap target [${r0(r.left)},${r0(r.top)} – ${r0(r.right)},${r0(r.bottom)}] reaches into a ${R}px screen corner`);
    }
  }

  if (o.band) {
    const b = o.band.side === 'l' ? { left: 0, right: o.band.w, top: 0, bottom: vh } : { left: vw - o.band.w, right: vw, top: 0, bottom: vh };
    for (const el of tappables()) {
      const r = visRect(el);
      if (overlap(r, b) > 0.5) push('band-84', el, `interactive [${r0(r.left)}–${r0(r.right)}] inside the ${o.band.side === 'l' ? 'left' : 'right'} ${o.band.w}px inset band`);
    }
  }

  if (o.rail) {
    const rail = document.querySelector('.ui-tabbar');
    const rr = rail && shown(rail) ? rail.getBoundingClientRect() : null;
    if (rr && inView(rr) && (rail.classList.contains('ui-tabbar--rail') || rail.getAttribute('aria-orientation') === 'vertical')) {
      metrics.rail = [r0(rr.left), r0(rr.top), r0(rr.right), r0(rr.bottom)];
      const skip = (el) => rail.contains(el) || el.closest('.ui-sheet, .ui-sheet__backdrop, .app__push, [class^="cm-"]');
      const seen = new Set();
      for (const { el, r } of textRects()) {
        if (seen.has(el) || skip(el) || overlap(r, rr) <= 0.5) continue;
        seen.add(el);
        push('rail-overlap', el, `text under the rail [${r0(rr.left)}–${r0(rr.right)}]`);
      }
      for (const el of tappables()) {
        if (seen.has(el) || skip(el) || overlap(el.getBoundingClientRect(), rr) <= 0.5) continue;
        seen.add(el);
        push('rail-overlap', el, `tap target under the rail [${r0(rr.left)}–${r0(rr.right)}]`);
      }
    }
  }

  if (o.gridVisible !== undefined) {
    // 상황을 바꾸면 격자가 페이드인하므로 opacity 가 아니라 배치(상자 · display)로 찾습니다.
    const laidOut = (g) => { const r = g.getBoundingClientRect(); if (r.width < 3 || r.height < 3) return false; for (let n = g; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false; return true; };
    const grid = [...document.querySelectorAll('.charts .rgrid')].find((g) => laidOut(g) && !g.closest('.ui-sheet'));
    if (!grid) missing.push('grid-visible');
    else {
      const bar = document.querySelector('.ui-tabbar');
      const br = bar && shown(bar) ? bar.getBoundingClientRect() : null;
      const floor = br && br.top < vh - 1 && br.width > vw * 0.4 ? br.top : vh;
      const rows = [...grid.querySelectorAll('.rgrid__row')];
      const vis = rows.filter((row) => { const r = row.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= floor + 0.5; }).length;
      metrics.gridRows = vis;
      metrics.gridPx = Math.round(grid.getBoundingClientRect().width);
      const cell = grid.querySelector('.rgrid__cell');
      if (cell) metrics.cellFont = parseFloat(getComputedStyle(cell).fontSize);
      if (o.gridVisible && vis < o.gridVisible) push('grid-visible', grid, `${vis} of 13 rows visible above ${floor === vh ? 'the screen bottom' : 'the tab bar'} (want ≥ ${o.gridVisible})`);
    }
  }

  return { out, missing, metrics };
};

const browser = await chromium.launch();
const report = [];
/** 검사가 '보러 간 화면에 도착하지 못한' 경우. 조용히 건너뛰면 검사가 도는 척만 합니다. */
const missed = [];
/** 그 크기 클래스에는 원래 없는 화면(예: tall/wide 의 차트 시트 — 차트가 세션 안에 있음). missed 와 따로 셉니다. */
const na = [];
/** 게이트 검사 결과(머리 주석의 kind). 하나라도 있으면 exit 1. */
const gate = [];
const metricsLog = [];
const wait = (page, ms) => page.waitForTimeout(ms);

const isStageLayout = (l) => l === 'land' || l === 'tall' || l === 'wide';
const SESSION_SCREENS = new Set(['train-think', 'train-reveal', 'train-limp']);
const CONTROLS = {
  'train-think': ['.trainer-choice', '.trainer-hud__btn'],
  'train-limp': ['.trainer-choice', '.trainer-hud__btn'],
  'train-reveal': ['.trainer-choice', '.trainer-next', '.trainer-controls button', '.trainer-hud__btn'],
  'quiz-run': ['.quiz-answers button', '.quiz-hud__close'],
  'quiz-answered': ['.quiz-answers button', '.quiz-next', '.quiz-hud__close', '.quiz-feedback button'],
};
/** 화면 이름과 크기로 어떤 Duo 검사를 켤지 정합니다. */
function duoOpts(size, screen, extra = {}) {
  const L = size.expect.layout;
  const base = screen;
  const o = { docScroll: true };
  const stage = SESSION_SCREENS.has(base) || base === 'quiz-run' || base === 'quiz-answered' || (base === 'charts' && isStageLayout(L));
  if (stage) o.stageFit = true;
  if (CONTROLS[base]) o.controls = CONTROLS[base];
  if (SESSION_SCREENS.has(base) || base === 'quiz-run' || base === 'quiz-answered') o.fan = true;
  if (base === 'train-think' || base === 'train-limp' || base === 'quiz-run') { o.masked = true; o.expectMap = L !== 'phone'; }
  if (L === 'tall' && (base === 'train-think' || base === 'train-reveal')) o.seam = true;
  if (L === 'wide') o.crease = true;
  if (L === 'land') o.corner = 59;
  if (size.safe.l >= 84) o.band = { side: 'l', w: size.safe.l };
  if (size.safe.r >= 84) o.band = { side: 'r', w: size.safe.r };
  if (L === 'land' || L === 'wide') o.rail = true;
  if (base === 'charts') o.gridVisible = isStageLayout(L) ? 13 : L === 'squat' && Math.min(size.svh || size.h, size.h) >= 580 ? 11 : 0;
  return { ...o, ...extra };
}
const GATE_KINDS = new Set(['class', 'stage-fit', 'control-hidden', 'toolbar-step', 'fan-min', 'masked', 'seam', 'crease', 'corner', 'band-84', 'rail-overlap', 'grid-visible', 'cell-nonmodal', 'fold', 'reveal-slot']);
const fail = (size, screen, kind, detail, path = '', text = '') => {
  gate.push({ kind, path, detail, text, where: `${size.name}/${screen}` });
};

/** 지금 화면을 훑어 report 에 넣고 스크린샷을 남깁니다. duo: 켤 Duo 검사(없으면 화면 이름으로 정함). */
async function grabOn(page, size, name, duo) {
  await wait(page, 250);
  const r = await page.evaluate(PROBE);
  const opts = duo === false ? null : duo ?? duoOpts(size, name);
  let d = { out: [], missing: [], metrics: {} };
  if (opts) d = await page.evaluate(DUO_PROBE, opts);
  for (const m of d.missing) missed.push(`${size.name}/${name}: ${m} 검사 대상이 화면에 없습니다`);
  for (const f of d.out) gate.push({ ...f, where: `${size.name}/${name}` });
  if (Object.keys(d.metrics).length) metricsLog.push(`${size.name}/${name}: ${JSON.stringify(d.metrics)}`);
  report.push({ screen: name, size: size.name, ...r, out: [...r.out, ...d.out] });
  await page.screenshot({ path: `${outDir}/${size.name}-${name}.png`, fullPage: false });
}
async function checkClass(page, size, where, expect = size.expect) {
  const c = await classOf(page);
  if (c.layout !== expect.layout || c.bar !== expect.bar || c.short !== expect.short) {
    fail(size, where, 'class', `html data-layout/bar/short = ${c.layout}/${c.bar}/${c.short || '—'}, want ${expect.layout}/${expect.bar}/${expect.short || '—'}`);
  }
  return c;
}
async function skipCoach(page, onFirst) {
  for (let i = 0; i < 5; i++) {
    const skip = page.getByRole('button', { name: /건너뛰기|시작할게요/ });
    if (!(await skip.count())) break;
    if (i === 0 && onFirst) await onFirst();
    await skip.first().tap();
    await wait(page, 350);
  }
}
async function endSession(page) {
  await page.locator('.trainer-hud__btn').first().tap();
  await wait(page, 450);
  const endBtn = page.locator('.ui-sheet button, .trainer-confirm button', { hasText: /끝|종료|그만|요약/ });
  if (await endBtn.count()) { await endBtn.first().tap(); await wait(page, 800); }
}

/** 작은 동시 실행 풀. 컨텍스트마다 브라우저 탭 하나라 서로 독립입니다. */
async function pool(tasks, n) {
  const queue = [...tasks];
  const run = async () => { for (let t = queue.shift(); t; t = queue.shift()) await t(); };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, run));
}
const safely = (label, fn) => async () => {
  const t0 = Date.now();
  try { await fn(); } catch (e) { missed.push(`${label}: 예외로 중단 — ${String(e.message || e).split('\n')[0]}`); }
  console.log(`  · ${label} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
};

// ---- 화면 흐름: 모든 크기에서 같은 화면을 엽니다 ----------------------------------------------------------------
async function flowAt(size) {
  const L = size.expect.layout;
  const ctx = await newCtx(browser, size);
  const page = await ctx.newPage();
  const tap = async (re) => { await page.getByRole('button', { name: re }).first().tap(); await wait(page, 450); };
  const grab = (name, duo) => grabOn(page, size, name, duo);

  // 코치 탭은 실수가 쌓여야 화면이 채워집니다. 감사용 씨앗이 있으면 심고, 없으면 빈 화면을 봅니다.
  if (SEED) {
    await ctx.addInitScript(([a, b]) => {
      localStorage.setItem('holdem-flicker.stats.v1', a);
      localStorage.setItem('holdem-flicker.srs.v1', b);
    }, SEED);
  }

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await wait(page, 600);
  await checkClass(page, size, 'home');

  await grab('home');
  const gear = page.locator('.home__gear, button[aria-label*="설정"]').first();
  if (await gear.count()) {
    await gear.tap();
    await wait(page, 500);
    await grab('settings');
    await page.locator('.app__push-back').first().tap();
    await wait(page, 600);
  }

  await tap(/^훈련$/);
  await grab('train-setup');
  await tap(/시작/);
  await wait(page, 700);
  await skipCoach(page, () => grab('train-coach', false));
  await grab('train-think');
  // hold sheet
  {
    const box = await page.locator('.trainer-fan').first().boundingBox();
    if (box) {
      const cdp = await ctx.newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await wait(page, 500);
      await grab('train-hold');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(page, 400);
    } else {
      missed.push(`${size.name}/train-hold: 카드(.trainer-fan)가 안 보여 누르고 있기를 못 했습니다`);
    }
  }
  await page.locator('.trainer-choice').first().tap();
  await wait(page, 600);
  await grab('train-reveal');
  await page.locator('.trainer-controls__main').first().tap();
  await wait(page, 600);
  await grab('train-explain-sheet');
  await page.keyboard.press('Escape');
  await wait(page, 500);
  // 차트 시트: phone 은 컨트롤 줄의 차트 버튼, squat/land 는 무대의 지도(T), tall/wide 는 차트가 세션 안(G)이라 시트가 없습니다.
  if (L === 'tall' || L === 'wide') {
    na.push(`${size.name}/train-chart-sheet: ${L} 은 차트(G)가 세션 안에 있어 차트 시트가 없습니다`);
  } else {
    let opener = page.locator(L === 'phone' ? '.trainer-chartbtn' : '.stagechart--button').first();
    // 무대가 낮아 T 가 숨으면 차트 입구는 패 라벨 줄의 작은 차트 버튼으로 옮겨 갑니다 — 그것도 안 보이면 길이 없는 것(실패).
    if (L !== 'phone' && (await opener.count()) && !(await opener.isVisible())) opener = page.locator('.trainer-handlabel__chart').first();
    if (L !== 'phone' && (await opener.count()) && !(await opener.isVisible())) {
      missed.push(`${size.name}/train-chart-sheet: 지도(T)도 패 라벨의 차트 버튼도 보이지 않아 차트 시트를 열 곳이 없습니다`);
    } else if (!(await opener.count())) {
      missed.push(`${size.name}/train-chart-sheet: ${L === 'phone' ? '차트 버튼' : '무대의 지도 버튼(.stagechart--button)'}이 없습니다`);
    } else {
      await opener.tap();
      await wait(page, 700);
      await grab('train-chart-sheet');
      await page.keyboard.press('Escape');
      await wait(page, 500);
    }
  }
  await page.locator('.trainer-hud__btn').first().tap();
  await wait(page, 450);
  await grab('train-end-confirm');
  const endBtn = page.locator('.ui-sheet button, .trainer-confirm button', { hasText: /끝|종료|그만|요약/ });
  if (await endBtn.count()) { await endBtn.first().tap(); await wait(page, 800); }
  await grab('train-summary');

  // 림프 대응 덱을 한 번 더 돌립니다. 이 덱의 선택 버튼 이름이 앱에서 제일 길어서
  // (2단 그리드 한 칸에 들어가야 합니다), text-clip-x 가 여기를 꼭 봐야 합니다.
  // 기본 덱만 돌리면 이 화면은 운에 맡겨집니다 — 상황이 일곱 가지 중 하나로 뽑히니까요.
  {
    // 지금은 훈련 탭에 요약이 떠 있습니다. 탭을 다시 눌러도, 홈을 들렀다 와도 요약이 그대로
    // 살아 있어서 설정 화면으로 안 돌아옵니다(세션 상태가 화면 안에 남아 있습니다).
    // 새로고침이 확실합니다. 이걸 안 하면 아래 조건이 조용히 건너뛰어져서 검사가 도는 척만
    // 합니다 — 실제로 한 번 그랬고, 그래서 missed 로 소리내게 해 뒀습니다.
    await page.reload({ waitUntil: 'networkidle' });
    await wait(page, 500);
    await tap(/^훈련$/);
    await wait(page, 500);
    const deck = page.locator('.trainer-setup').getByText(/림프/);
    if (!(await deck.count())) {
      missed.push(`${size.name}/train-limp: 훈련 설정에서 림프 덱을 못 찾았습니다`);
    } else {
      await deck.first().tap();
      await wait(page, 300);
      await tap(/시작/);
      await wait(page, 700);
      await skipCoach(page);
      if (!(await page.locator('.trainer-choice').count())) {
        missed.push(`${size.name}/train-limp: 세션이 시작되지 않아 선택 버튼이 없습니다`);
      }
      await grab('train-limp');
      await endSession(page);
    }
  }

  await tap(/^퀴즈$/);
  await grab('quiz');
  const qStart = page.getByRole('button', { name: /시작|출제|풀기/ });
  if (await qStart.count()) {
    await qStart.first().tap();
    await wait(page, 700);
    await grab('quiz-run');
    // 오답을 골라 피드백(다음 · 해설 포함)을 엽니다 — 정답이면 1.5초 뒤 넘어가 버립니다.
    const group = page.locator('.quiz-answers').first();
    if (await group.count()) {
      const answer = (await group.getAttribute('data-answer')) ?? '';
      const partial = ((await group.getAttribute('data-partial')) ?? '').split(',').filter(Boolean);
      const btns = page.locator('.quiz-answers button');
      const acts = await btns.evaluateAll((els) => els.map((el) => el.getAttribute('data-action') ?? el.textContent));
      let idx = acts.findIndex((a) => a && a !== answer && !partial.includes(a));
      if (idx < 0) idx = 0;
      await btns.nth(idx).tap();
      await wait(page, 400);
      await grab('quiz-answered');
    } else {
      missed.push(`${size.name}/quiz-answered: 퀴즈 답 버튼이 없습니다`);
    }
  } else {
    missed.push(`${size.name}/quiz-run: 퀴즈 시작 버튼이 없습니다`);
  }

  // 퀴즈 진행 중이면 탭바가 숨습니다 — 새로 고침해서 홈으로 돌아갑니다.
  await page.goto(url, { waitUntil: 'networkidle' });
  await wait(page, 600);

  await tap(/^코치$/);
  await grab('coach');
  {
    const axis = page.locator('.coach-axis__btn');
    if (await axis.count()) { await axis.first().tap(); await wait(page, 600); await grab('coach-evidence'); await page.keyboard.press('Escape'); await wait(page, 400); }
    const ask = page.getByRole('button', { name: /질문 복사/ });
    if (await ask.count()) { await ask.first().tap(); await wait(page, 600); await grab('coach-ask'); await page.keyboard.press('Escape'); await wait(page, 400); }
    const key = page.getByRole('button', { name: /API 키/ });
    if (await key.count()) { await key.first().tap(); await wait(page, 600); await grab('coach-key'); await page.keyboard.press('Escape'); await wait(page, 400); }
  }

  await tap(/^차트$/);
  await grab('charts');
  const cell = page.locator('.charts .rgrid__cell[aria-label]');
  if (await cell.count()) { await cell.nth(40).tap(); await wait(page, 600); await grab('charts-cell'); }
  else missed.push(`${size.name}/charts-cell: 차트 격자 셀이 없습니다`);

  // 자리별 보기(HandAtlas): 셀 시트·셀 카드의 「이 패, 다른 자리에서는 ›」 → 아틀라스 한 장 → UTG 타일 → 비교 블록.
  // 셀 시트가 닫히지 않았거나 아틀라스가 안 열리면 조용히 넘어가지 않고 missed 로 소리냅니다.
  {
    const across = page.getByRole('button', { name: /다른 자리에서는/ });
    if (!(await across.count())) {
      missed.push(`${size.name}/atlas: 셀 시트(카드)에 「이 패, 다른 자리에서는?」 링크가 없습니다`);
    } else {
      await across.first().tap();
      await wait(page, 800);
      const sheets = await page.locator('.ui-sheet').count();
      if (!(await page.locator('.atlas').count())) missed.push(`${size.name}/atlas: 아틀라스가 열리지 않았습니다`);
      else if (sheets !== 1) missed.push(`${size.name}/atlas: 시트가 ${sheets}장 떠 있습니다 (한 장이어야 합니다)`);
      await grab('atlas');
      // 들어온 칸이 UTG 면 이미 선택돼 있습니다(다시 누르면 해제) — 그때는 그대로 비교 블록을 봅니다.
      const utg = page.locator('.atlas__cell[aria-label^="UTG ·"]').first();
      if (await utg.count()) {
        if (!(await page.locator('.atlas__cell--sel[aria-label^="UTG ·"]').count())) { await utg.tap(); await wait(page, 500); }
        if (!(await page.locator('.atlas__detail').count())) missed.push(`${size.name}/atlas-detail: UTG 타일을 눌렀는데 비교 블록이 없습니다`);
        await page.locator('.atlas__detail').first().scrollIntoViewIfNeeded().catch(() => {});
        await grab('atlas-detail');
      } else {
        missed.push(`${size.name}/atlas-detail: UTG 타일이 없습니다`);
      }
      await page.keyboard.press('Escape');
      await wait(page, 400);
    }
  }

  // 셀 상세는 non-modal: 열린 채 다른 셀을 누르면 내용만 바뀌고 닫히지 않습니다. 그다음 「자세히」 상태를 봅니다.
  {
    const titleOf = () => page.evaluate(() => {
      const t = [...document.querySelectorAll('.ui-sheet--in .ui-sheet__title, .cellcard__title')].find((e) => e.getBoundingClientRect().height > 0);
      return t ? t.textContent.trim() : null;
    });
    const cellA = page.locator('.charts .rgrid__cell[aria-label]').nth(15);
    const cellB = page.locator('.charts .rgrid__cell[aria-label]').nth(29);
    if (await cellA.count()) {
      await cellA.tap();
      await wait(page, 600);
      const t1 = await titleOf();
      const hB = await cellB.getAttribute('aria-label');
      await cellB.tap();
      await wait(page, 600);
      const t2 = await titleOf();
      if (t1 === null) missed.push(`${size.name}/charts-cell-2: 셀을 눌렀는데 셀 상세(시트 또는 카드)가 없습니다`);
      else if (t2 === null) fail(size, 'charts-cell-2', 'cell-nonmodal', `the cell detail closed when another cell (${hB}) was tapped`);
      else if (t2 === t1 || !t2.includes(hB)) fail(size, 'charts-cell-2', 'cell-nonmodal', `tapping ${hB} with the detail open did not swap its content ("${t1}" → "${t2}")`);
      await grab('charts-cell-2');
      const more = page.getByRole('button', { name: /^(자세히|더 보기)/ });
      if (await more.count()) {
        await more.first().tap();
        await wait(page, 700);
        await grab('charts-cell-more');
        // non-modal 자세히 상태에서도 격자는 살아 있어야 합니다.
        const cellC = page.locator('.charts .rgrid__cell[aria-label]').nth(17);
        const hC = await cellC.getAttribute('aria-label');
        // what is under the cell's centre, and why a tap did not go through — a failure must say which
        const under = () => cellC.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return h === el || el.contains(h) ? 'self' : `${h?.tagName.toLowerCase()}.${String(h?.className).split(' ').slice(0, 2).join('.')} @${Math.round(r.top)}`;
        }).catch((e) => `? ${String(e).split('\n')[0]}`);
        const before = await under();
        let tapErr = '';
        await cellC.tap({ timeout: 3000 }).catch((e) => { tapErr = String(e.message || e).split('\n').filter((l) => /Timeout|intercepts|not stable|not visible|outside/.test(l)).slice(0, 3).join(' / '); });
        await wait(page, 600);
        const t3 = await titleOf();
        if (t3 === null || !t3.includes(hC)) fail(size, 'charts-cell-more', 'cell-nonmodal', `with 자세히 open, tapping ${hC} did not swap the detail (title "${t3}"; under the cell: ${before}${tapErr ? `; tap: ${tapErr}` : ''})`);
      } else {
        missed.push(`${size.name}/charts-cell-more: 셀 상세에 「자세히」 버튼이 없습니다`);
      }
    }
  }

  await ctx.close();
}

// ---- 툴바 접힘/펼침: 같은 세션 안에서 뷰포트 높이를 svh ↔ lvh 로 바꿉니다 ---------------------------------------
const TOOLBAR_PAIRS = [
  { w: 390, svh: 664, lvh: 750, layout: 'phone', name: 'tb390' },
  { w: 382, svh: 580, lvh: 618, layout: 'squat', name: 'tb382' },
  { w: 594, svh: 368, lvh: 406, layout: 'land', name: 'tb594' },
  { w: 385, svh: 571, lvh: 609, layout: 'squat', name: 'tb385' },
  { w: 669, svh: 867, lvh: 902, layout: 'tall', name: 'tb669' },
  { w: 951, svh: 585, lvh: 620, layout: 'wide', name: 'tb951' },
].map((p) => ({ ...p, bar: barOf(p.layout) }));

const MEASURE = (sels) => {
  const vh = window.innerHeight;
  const res = { vh };
  for (const [key, sel] of Object.entries(sels)) {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; }
      return true;
    });
    if (el) { const r = el.getBoundingClientRect(); res[key] = { top: r.top, bottom: r.bottom, h: r.height, rail: el.classList.contains('ui-tabbar--rail') || el.getAttribute('aria-orientation') === 'vertical' }; }
  }
  return res;
};

async function toolbarAt(p) {
  const size = { ...sz(p.w, p.svh, { layout: p.layout, group: 'toolbar' }), name: `${p.name}-${p.w}x${p.svh}-${p.lvh}` };
  size.expect.bar = p.bar;
  const ctx = await newCtx(browser, size);
  const page = await ctx.newPage();
  const tap = async (re) => { await page.getByRole('button', { name: re }).first().tap(); await wait(page, 450); };
  const expanded = async () => { await page.evaluate((c) => window.__auditEmu(c), { ...Z, svh: 0 }); await page.setViewportSize({ width: p.w, height: p.svh }); await wait(page, 500); };
  const collapsed = async () => { await page.evaluate((c) => window.__auditEmu(c), { ...Z, svh: p.svh }); await page.setViewportSize({ width: p.w, height: p.lvh }); await wait(page, 500); };
  const collapsedSize = { ...size, h: p.lvh, svh: p.svh };
  /** a → b 사이에 물리적으로 움직였는지. bottom bar: 화면 위 가장자리가 고정 → y. top bar: 아래 가장자리가 고정 → innerHeight − y. */
  const compare = (where, a, b, keys, mode = p.bar) => {
    for (const k of keys) {
      if (!a[k]) continue;
      if (!b[k]) { fail(size, where, 'toolbar-step', `${k} disappeared when the toolbar ${where.endsWith('collapse') ? 'collapsed' : 'expanded'}`); continue; }
      const da = mode === 'bottom-edge' ? a.vh - a[k].bottom : mode === 'top' ? a.vh - a[k].top : a[k].top;
      const db = mode === 'bottom-edge' ? b.vh - b[k].bottom : mode === 'top' ? b.vh - b[k].top : b[k].top;
      if (Math.abs(da - db) > 1) fail(size, where, 'toolbar-step', `${k} moved ${(db - da).toFixed(1)}px on screen (${mode === 'top' ? 'distance from the bottom' : mode === 'bottom-edge' ? 'gap to the viewport bottom' : 'y'}: ${da.toFixed(1)} → ${db.toFixed(1)})`);
    }
  };
  /** 시트가 transform 으로 들어오는 중이면 잰 값이 흔들립니다 — 두 번 연달아 같게 나올 때까지(최대 ~1.5초) 기다렸다가 씁니다. */
  const measureStable = async (sels) => {
    let prev = await page.evaluate(MEASURE, sels);
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(120);
      const cur = await page.evaluate(MEASURE, sels);
      if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
      prev = cur;
    }
    return prev;
  };
  /** 한 화면에서 펼침 → 접힘 → 펼침. 접힌 상태에서 stage-fit · control-hidden 도 봅니다. */
  const step = async (screen, sels, keys, opts = {}) => {
    const a = await measureStable(sels);
    await collapsed();
    const b = await measureStable(sels);
    compare(`${screen}-collapse`, a, b, keys, opts.mode);
    if (opts.size) for (const k of opts.size) if (a[k] && b[k] && Math.abs(a[k].h - b[k].h) > 1) fail(size, `${screen}-collapse`, 'toolbar-step', `${k} changed height ${a[k].h.toFixed(1)} → ${b[k].h.toFixed(1)} (should keep its size; the slack goes elsewhere)`);
    if (opts.slack) {
      const s = await page.evaluate(() => {
        const sl = document.querySelector('.vb__slack');
        const rib = document.querySelector('.vb__slack .vb__ribbon, .vb__slack .ribbon');
        const ok = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 4 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; };
        return { slack: sl ? sl.getBoundingClientRect().height : null, rib: ok(rib) };
      });
      if (s.slack === null) missed.push(`${size.name}/${screen}-collapse: .vb__slack 가 없습니다`);
      else if (s.slack >= 37.5 && !s.rib) fail(size, `${screen}-collapse`, 'toolbar-step', `slack band is ${s.slack.toFixed(0)}px but the last-cards ribbon (R) is not shown`);
    }
    await grabOn(page, collapsedSize, `tb-${screen}-collapsed`, opts.duo ?? duoOpts(collapsedSize, screen));
    await expanded();
    const c = await measureStable(sels);
    compare(`${screen}-expand`, b, c, keys, opts.mode);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await wait(page, 500);
  await checkClass(page, size, 'home');
  // 탭 페이지: 캡슐은 뷰포트 바닥을 따라가고(Safari 막대처럼), 레일은 core 기준이라 물리적으로 그대로입니다.
  {
    const m = await page.evaluate(MEASURE, { tabbar: '.ui-tabbar' });
    if (!m.tabbar) missed.push(`${size.name}/home: 탭 바가 없습니다`);
    else await step('home', { tabbar: '.ui-tabbar' }, ['tabbar'], { mode: m.tabbar.rail ? p.bar : 'bottom-edge' });
  }
  // 훈련 세션 think → 카드 2장째 reveal(지난 카드 줄에 1장) → 해설 시트
  await tap(/^훈련$/);
  await tap(/시작/);
  await wait(page, 600);
  await skipCoach(page);
  const sessSels = { choice0: '.trainer-choice', close: '.trainer-hud__btn', fan: '.trainer-fan', controls: '.trainer-controls' };
  if (!(await page.locator('.trainer-choice').count())) missed.push(`${size.name}/think: 세션이 시작되지 않았습니다`);
  else {
    // 일시정지하지 않고 잽니다 — 일시정지 화면은 배치가 달라서(탭 바가 나옴) 실제 think 화면을 재지 못합니다.
    // 한 단계가 ~1.5 s 라 think 8 s 안에 끝납니다.
    await step('train-think', sessSels, ['choice0', 'close', 'controls']);
    await page.locator('.trainer-choice').first().tap();
    await wait(page, 500);
    await page.locator('.trainer-next').first().tap().catch(() => {});
    await wait(page, 600);
    await page.locator('.trainer-choice').first().tap();
    await wait(page, 600);
    const revSels = { ...sessSels, next: '.trainer-next', answer: '.trainer-answer' };
    if (!(await page.locator('.trainer-next').count())) missed.push(`${size.name}/reveal: 다음 버튼이 없습니다`);
    // 해설을 열었다 닫아 자동 넘김을 끕니다(재는 동안 카드가 넘어가지 않게).
    await page.locator('.trainer-controls__main').first().tap();
    await wait(page, 600);
    const sheetSels = { sheet: '.ui-sheet--in' };
    if (!(await page.locator('.ui-sheet--in').count())) missed.push(`${size.name}/explain-sheet: 해설 시트가 열리지 않았습니다`);
    else await step('train-explain-sheet', sheetSels, ['sheet'], { duo: { docScroll: true } });
    await page.keyboard.press('Escape');
    await wait(page, 500);
    await step('train-reveal', revSels, ['choice0', 'close', 'controls', 'next', 'answer'], { slack: p.bar === 'bottom' && p.lvh - p.svh >= 38 });
    await endSession(page);
  }
  // 퀴즈 라운드
  await tap(/^퀴즈$/);
  const qStart = page.getByRole('button', { name: /시작|출제|풀기/ });
  if (await qStart.count()) {
    await qStart.first().tap();
    await wait(page, 700);
    await step('quiz-run', { ans0: '.quiz-answers button', close: '.quiz-hud__close' }, ['ans0', 'close']);
  } else missed.push(`${size.name}/quiz-run: 퀴즈 시작 버튼이 없습니다`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await wait(page, 500);
  // 차트: 격자 크기는 그대로(늘어난 높이는 dock · 페이지가 가져감)
  await tap(/^차트$/);
  await step('charts', { grid: '.charts .rgrid' }, [], { size: ['grid'] });
  await ctx.close();
}

// ---- 접기/펼치기 연속 ---------------------------------------------------------------------------------------
const FOLD_STEPS = [
  { w: 382, h: 580, layout: 'squat' },
  { w: 466, h: 498, layout: 'squat' },
  { w: 669, h: 867, layout: 'tall' },
  { w: 951, h: 585, layout: 'wide' },
  { w: 951, h: 620, svh: 585, layout: 'wide' },
  { w: 382, h: 580, layout: 'squat' },
  { w: 385, h: 571, layout: 'squat' },
].map((s) => sz(s.w, s.h, { svh: s.svh, layout: s.layout, group: 'fold' }));
for (const s of FOLD_STEPS) s.expect.bar = barOf(s.expect.layout);

async function foldRun() {
  const first = { ...FOLD_STEPS[0], name: 'fold' };
  const ctx = await newCtx(browser, first);
  const page = await ctx.newPage();
  const tap = async (re) => { await page.getByRole('button', { name: re }).first().tap(); await wait(page, 450); };
  const goTo = async (s) => {
    await page.evaluate((c) => window.__auditEmu(c), emuCfg(s));
    await page.setViewportSize({ width: s.w, height: s.h });
    await wait(page, 550);
  };
  const state = () => page.evaluate(() => ({
    count: document.querySelector('.trainer-hud__count')?.textContent?.trim() ?? null,
    hand: document.querySelector('.trainer-handlabel__name')?.textContent?.trim() ?? null,
    think: !!document.querySelector('.trainer-session--think'),
    paused: !!document.querySelector('.trainer-session--paused'),
    neutral: !!document.querySelector('.trainer-session--neutral'),
    sheet: !!document.querySelector('.ui-sheet[data-audit-node="1"]'),
    sheetIn: !!document.querySelector('.ui-sheet--in[data-audit-node="1"]'),
    sheetScroll: (() => { const b = document.querySelector('.ui-sheet[data-audit-node="1"] .ui-sheet__body'); return b ? { top: b.scrollTop, max: b.scrollHeight - b.clientHeight } : null; })(),
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  const label = (i, s) => `${i}-${s.w}x${s.h}`;

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await wait(page, 500);
  await checkClass(page, first, 'fold-home');

  // 1) think 중에 접고 펼치기: 첫 폭 점프에서 일시정지, 카드 그대로, 타이머 만료 없음
  await tap(/^훈련$/);
  await tap(/시작/);
  await wait(page, 600);
  await skipCoach(page);
  const s0 = await state();
  if (!s0.think) missed.push('fold/think: think 상태로 시작하지 못했습니다');
  for (let i = 1; i < FOLD_STEPS.length; i++) {
    const s = { ...FOLD_STEPS[i], name: 'fold' };
    await goTo(s);
    await checkClass(page, s, `think ${label(i, s)}`);
    const st = await state();
    if (st.count !== s0.count || st.hand !== s0.hand) fail(s, `think ${label(i, s)}`, 'fold', `session card changed: ${s0.count} ${s0.hand} → ${st.count} ${st.hand}`);
    if (!st.paused) fail(s, `think ${label(i, s)}`, 'fold', 'not paused after a width jump during think (should pause until tapped)');
    if (st.hScroll) fail(s, `think ${label(i, s)}`, 'fold', 'horizontal scroll after the resize');
    await grabOn(page, s, `fold-think-${label(i, s)}`, duoOpts(s, 'train-think', { controls: undefined }));
  }
  await wait(page, 9000); // think 8 s 보다 길게: 일시정지라면 만료되지 않아야 합니다
  {
    const st = await state();
    const s = { ...FOLD_STEPS.at(-1), name: 'fold' };
    if (!st.think || st.neutral) fail(s, 'think after 9 s', 'fold', `think timer expired while paused (think=${st.think}, neutral=${st.neutral})`);
    if (st.count !== s0.count) fail(s, 'think after 9 s', 'fold', `card moved on while paused: ${s0.count} → ${st.count}`);
  }

  // 2) reveal + 해설 시트를 연 채로: 같은 시트 노드 유지, 본문 scrollTop 유지, 카드 그대로
  await goTo({ ...FOLD_STEPS[0], name: 'fold' });
  await page.getByRole('button', { name: /^계속$/ }).first().tap().catch(() => {});
  await wait(page, 300);
  await page.locator('.trainer-choice').first().tap();
  await wait(page, 600);
  await page.locator('.trainer-controls__main').first().tap();
  await wait(page, 700);
  const tagged = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.ui-sheet--in')].pop();
    if (!el) return false;
    el.setAttribute('data-audit-node', '1');
    const b = el.querySelector('.ui-sheet__body');
    if (b) b.scrollTop = 120;
    return true;
  });
  if (!tagged) missed.push('fold/sheet: 해설 시트가 열리지 않았습니다');
  else {
    const r0 = await state();
    for (let i = 1; i < FOLD_STEPS.length; i++) {
      const s = { ...FOLD_STEPS[i], name: 'fold' };
      const prev = await state();
      await goTo(s);
      await checkClass(page, s, `sheet ${label(i, s)}`);
      const st = await state();
      if (!st.sheet) fail(s, `sheet ${label(i, s)}`, 'fold', 'the open 해설 sheet was remounted or closed by the resize');
      else if (!st.sheetIn) fail(s, `sheet ${label(i, s)}`, 'fold', 'the 해설 sheet is no longer open after the resize');
      if (st.count !== r0.count) fail(s, `sheet ${label(i, s)}`, 'fold', `session card changed: ${r0.count} → ${st.count}`);
      // 본문이 한 칸 ↔ 두 칸으로 바뀌면 같은 픽셀 scrollTop 은 의미가 없습니다(브라우저 scroll anchoring 이 읽던 곳을 맞춤).
      // 잡는 것은 '맨 위로 되돌아감'(다시 마운트 · 리셋)뿐입니다.
      if (prev.sheetScroll && st.sheetScroll) {
        if (prev.sheetScroll.top > 2 && st.sheetScroll.top < 1 && st.sheetScroll.max > 2) fail(s, `sheet ${label(i, s)}`, 'fold', `sheet body scrollTop ${prev.sheetScroll.top.toFixed(0)} → ${st.sheetScroll.top.toFixed(0)} (max ${st.sheetScroll.max.toFixed(0)})`);
      }
      if (st.hScroll) fail(s, `sheet ${label(i, s)}`, 'fold', 'horizontal scroll after the resize');
      await grabOn(page, s, `fold-sheet-${label(i, s)}`, { docScroll: true });
    }
    await page.keyboard.press('Escape');
    await wait(page, 400);
  }
  await endSession(page).catch(() => {});

  // 3) 차트에서 셀을 고른 채로: 고른 셀과 상세 유지, 스크롤 위치 범위 안
  await goTo({ ...FOLD_STEPS[0], name: 'fold' });
  await tap(/^차트$/);
  const ak = page.locator('.charts .rgrid__cell[aria-label="AKs"]').first();
  if (!(await ak.count())) missed.push('fold/charts: AKs 셀이 없습니다');
  else {
    await ak.tap();
    await wait(page, 600);
    for (let i = 1; i < FOLD_STEPS.length; i++) {
      const s = { ...FOLD_STEPS[i], name: 'fold' };
      await goTo(s);
      await checkClass(page, s, `charts ${label(i, s)}`);
      const st = await page.evaluate(() => ({
        picked: !!document.querySelector('.charts .rgrid__cell[aria-label="AKs"][aria-current="true"]'),
        detail: [...document.querySelectorAll('.ui-sheet--in, .cellcard, .charts__dock')].some((e) => e.getBoundingClientRect().height > 0 && /AKs/.test(e.textContent)),
        main: (() => { const m = document.querySelector('.app__main'); return m ? { top: m.scrollTop, max: m.scrollHeight - m.clientHeight } : null; })(),
      }));
      if (!st.picked) fail(s, `charts ${label(i, s)}`, 'fold', 'the picked cell (AKs) lost its selection');
      if (!st.detail) fail(s, `charts ${label(i, s)}`, 'fold', 'the AKs cell detail (sheet / card / dock) is gone after the resize');
      if (st.main && st.main.top > st.main.max + 1) fail(s, `charts ${label(i, s)}`, 'fold', `.app__main scrollTop ${st.main.top} beyond its range ${st.main.max}`);
      await grabOn(page, s, `fold-charts-${label(i, s)}`, duoOpts(s, 'charts', { gridVisible: undefined }));
    }
  }
  await ctx.close();
}

// ---- 리빌 슬롯 검사 (§7.2-15) -------------------------------------------------------------------
// §3.6 의 13칸(리빌 예시) + 골든 코퍼스에서 emWidth 가 큰 문장 30개(줄의 첫 칸 패로). 같은 키는 한 번만.
const WORKED = [
  'rfi:SB|85o', 'rfi:UTG|KJo', 'vs_3bet:CO:BTN|A5s', 'vs_open:BB:CO|22', 'vs_open:BTN:HJ|76s', 'vs_open:SB:UTG|KTs', 'vs_4bet:HJ:UTG|QQ',
  'vs_5bet:CO:BTN|QQ', 'cold_4bet:CO|QQ', 'vs_limp:BB|55', 'vs_limp:BTN|ATo', 'vs_open:BB:BTN|54s', 'vs_open:SB:UTG|QJs',
];
/** 줄의 첫 줄 칸(§3.2): 페어 AA · 커넥터 T9s · 수티드 R(커넥터 RXs 는 커넥터 줄이라 T~4 는 두 칸 아래부터) · 오프수트 R. */
function firstHandOf(lineId) {
  const R = 'AKQJT98765432';
  if (lineId === 'pair') return 'AA';
  if (lineId === 'conn') return 'T9s';
  const [suf, hi] = [lineId[0], lineId[1]];
  const i = R.indexOf(hi);
  if (suf === 's') return `${hi}${R[i + ('AKQJ'.includes(hi) ? 1 : 2)]}s`;
  return `${hi}${R[i + 1]}o`;
}
const LONGEST = readFileSync(new URL('../tests/__golden__/line-sentences.tsv', import.meta.url), 'utf8')
  .trim().split('\n').map((row) => row.split('\t'))
  .sort((a, b) => Number(b[3]) - Number(a[3]))
  .slice(0, 30)
  .map(([key, lineId]) => `${key}|${firstHandOf(lineId)}`);
const REVEAL_KEYS = [...new Set([...WORKED, ...LONGEST])];
const REVEAL_SIZES = [
  { ...sz(360, 640, { layout: 'phone', group: 'reveal', dpr: 2 }), slot: 114, strip: 297 },
  { ...sz(390, 844, { layout: 'phone', group: 'reveal', dpr: 2 }), slot: 120, strip: 297 },
  { ...sz(382, 580, { layout: 'squat', group: 'reveal' }), slot: 114, strip: 297 },
  { ...sz(594, 368, { layout: 'land', group: 'reveal' }), slot: 114, strip: 297 },
  { ...sz(669, 867, { layout: 'tall', group: 'reveal' }), slot: 132, strip: 323 },
  { ...sz(951, 585, { layout: 'wide', group: 'reveal' }), slot: 132, strip: 323 },
];
for (const s of REVEAL_SIZES) { s.expect.bar = barOf(s.expect.layout); s.name = `reveal-${s.w}x${s.h}`; }
let revealChecked = 0;
async function revealAt(size) {
  const ctx = await newCtx(browser, size);
  // 어제 세션 하나와, 그 세션의 '헷갈린 카드' = 검사할 키들. 홈의 '지난 세션 → 틀린 것만 다시'가 이 순서 그대로 세션을 엽니다.
  await ctx.addInitScript((keys) => {
    if (sessionStorage.getItem('audit-seeded')) return;
    sessionStorage.setItem('audit-seeded', '1');
    const d = new Date(Date.now() - 86400000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = Date.now();
    localStorage.setItem('holdem-flicker.progress.v1', JSON.stringify({
      version: 1,
      days: { [day]: { cards: keys.length, rated: keys.length, known: 0, quiz: 0, quizCorrect: 0, seconds: 300, sessions: 1 } },
      lastResult: {
        id: 'audit', mode: 'train', startedAt: now - 400000, endedAt: now - 100000, activeMs: 300000,
        config: { deck: 'all', positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], size: keys.length, speed: 'normal', exposure: false, manual: true },
        seen: keys.length, rated: keys.length, known: 0, unsure: keys.length, exposureOnly: false, byOrigin: { new: keys.length, review: 0, unsure: 0 },
        unsureKeys: keys, allKeys: keys, goalReachedNow: false, streakBefore: 1, streakAfter: 1,
      },
    }));
  }, REVEAL_KEYS);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await wait(page, 400);
  await checkClass(page, size, 'home');
  const last = page.locator('.home-last');
  if (!(await last.count())) {
    missed.push(`${size.name}: 홈에 '지난 세션' 줄이 없습니다(심은 기록을 못 읽었습니다)`);
    await ctx.close();
    return;
  }
  await last.first().tap();
  await wait(page, 600);
  const retry = page.getByRole('button', { name: /틀린 것만 다시/ });
  if (!(await retry.count())) {
    missed.push(`${size.name}: 지난 세션 시트에 '틀린 것만 다시'가 없습니다`);
    await ctx.close();
    return;
  }
  await retry.first().tap();
  await wait(page, 800);
  await skipCoach(page);
  for (let k = 0; k < REVEAL_KEYS.length; k++) {
    const key = REVEAL_KEYS[k];
    const want = key.split('|')[1];
    const choices = page.locator('.trainer-choices');
    if (!(await choices.count())) {
      missed.push(`${size.name} ${key}: 선택 버튼이 없습니다(세션이 ${k}장에서 끝났습니다)`);
      break;
    }
    const hand = (await page.locator('.trainer-handlabel__name').first().innerText().catch(() => '')).trim();
    if (hand !== want) missed.push(`${size.name} ${key}: 화면의 패가 ${hand || '없음'}입니다`);
    const answer = await choices.first().getAttribute('data-answer');
    await page.locator(`.trainer-choice[data-action="${answer}"]`).first().tap();
    await wait(page, 650);
    const m = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const reason = document.querySelector('.trainer-answer__reason');
      const lh = reason ? parseFloat(getComputedStyle(reason).lineHeight) || 18 : 18;
      return {
        slot: r('.trainer-answer')?.height ?? null,
        strip: r('.trainer-answer__strip')?.width ?? null,
        reasonH: reason ? reason.scrollHeight : null,
        lh,
        text: reason ? reason.textContent : '',
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    revealChecked++;
    const where = `${key}`;
    if (m.slot === null) missed.push(`${size.name} ${where}: 리빌 슬롯이 없습니다`);
    else {
      if (Math.abs(m.slot - size.slot) > 0.5) fail(size, where, 'reveal-slot', `슬롯 높이 ${m.slot.toFixed(1)} ≠ ${size.slot}`);
      if (m.reasonH === null || m.reasonH > 2 * m.lh + 1) fail(size, where, 'reveal-slot', `줄 문장이 2줄을 넘습니다(scrollHeight ${m.reasonH}, line ${m.lh}) "${m.text}"`);
      if (m.strip === null || Math.abs(m.strip - size.strip) > 0.5) fail(size, where, 'reveal-slot', `스트립 폭 ${m.strip?.toFixed(1)} ≠ ${size.strip}`);
      if (m.hScroll) fail(size, where, 'reveal-slot', '가로 스크롤이 생겼습니다');
    }
    if (k < WORKED.length) await grabOn(page, size, `reveal-${String(k + 1).padStart(2, '0')}`, duoOpts(size, 'train-reveal'));
    const next = page.locator('.trainer-next');
    if (!(await next.count())) {
      missed.push(`${size.name} ${where}: 리빌에 다음 버튼이 없습니다`);
      break;
    }
    await next.first().tap();
    await wait(page, 450);
  }
  await ctx.close();
}

// ---- 실행 ---------------------------------------------------------------------------------------------------
const tasks = [];
if (!SKIP.has('flow')) for (const s of ALL_SIZES.filter(wanted)) tasks.push(safely(`flow ${s.name} (${s.expect.layout}${s.note ? ` · ${s.note}` : ''})`, () => flowAt(s)));
const passWanted = (name, layout, extra) => !ONLY || ONLY.has(name) || ONLY.has(layout) || ONLY.has('duo') && layout !== 'phone' || (extra && ONLY.has(extra));
if (!SKIP.has('toolbar')) for (const p of TOOLBAR_PAIRS.filter((p) => passWanted('toolbar', p.layout, `${p.w}x${p.svh}`))) tasks.push(safely(`toolbar ${p.w}×${p.svh}↔${p.lvh} (${p.layout}, bar ${p.bar})`, () => toolbarAt(p)));
if (!SKIP.has('fold') && (!ONLY || ONLY.has('fold') || ONLY.has('duo'))) tasks.push(safely('fold sequence', foldRun));
if (!SKIP.has('reveal')) for (const s of REVEAL_SIZES.filter((s) => passWanted('reveal', s.expect.layout, `${s.w}x${s.h}`))) tasks.push(safely(`${s.name} (${s.expect.layout})`, () => revealAt(s)));
console.log(`layout-audit: ${tasks.length} passes, ${JOBS} at a time → ${outDir}`);
await pool(tasks, JOBS);

writeFileSync(`${outDir}/report.json`, JSON.stringify({ report, gate, missed, na, metrics: metricsLog }, null, 2));

// ---- 요약 출력
const byKind = new Map();
for (const r of report) for (const p of r.out) {
  if (GATE_KINDS.has(p.kind)) continue; // 게이트 검사는 아래에서 따로
  const k = `${p.kind}|${p.path}|${p.detail.replace(/\d+/g, '#')}`;
  if (!byKind.has(k)) byKind.set(k, { ...p, where: new Set() });
  byKind.get(k).where.add(`${r.size}/${r.screen}`);
}
const order = ['page-h-overflow', 'x-overflow', 'glow-budget', 'glow-clip', 'text-clip-x', 'text-clip-y', 'box-clip-y', 'escapes-padding', 'tap-target'];
const rows = [...byKind.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
if (missed.length) {
  console.log('\n=== 못 본 화면 (검사가 헛돌았습니다) ===\n');
  for (const m of missed) console.log(`  ! ${m}`);
}
if (na.length) {
  console.log(`\n=== 클래스상 없는 화면 (${na.length}) ===`);
  for (const m of na) console.log(`  - ${m}`);
}
console.log(`\n=== ${rows.length} distinct issues across ${report.length} screen×size probes ===\n`);
for (const r of rows) {
  console.log(`[${r.kind}] ${r.path}`);
  console.log(`   ${r.detail}  ·  "${r.text}"`);
  console.log(`   @ ${[...r.where].slice(0, 6).join(', ')}${r.where.size > 6 ? ` +${r.where.size - 6}` : ''}`);
}
// 게이트: kind 별로 묶어서
const gateBy = new Map();
for (const g of gate) {
  const k = `${g.kind}|${g.path}|${g.detail.replace(/-?\d+(\.\d+)?/g, '#')}`;
  if (!gateBy.has(k)) gateBy.set(k, { ...g, where: new Set() });
  gateBy.get(k).where.add(g.where);
}
const gateKinds = [...GATE_KINDS];
const gateRows = [...gateBy.values()].sort((a, b) => gateKinds.indexOf(a.kind) - gateKinds.indexOf(b.kind));
console.log(`\n=== Duo 게이트: ${gate.length}건 (${gateRows.length} distinct) ===`);
for (const k of gateKinds) {
  const n = gate.filter((g) => g.kind === k).length;
  console.log(`  ${n ? '✕' : '✓'} ${k.padEnd(15)} ${n}`);
}
for (const r of gateRows) {
  console.log(`[${r.kind}] ${r.path}`);
  console.log(`   ${r.detail}${r.text ? `  ·  "${r.text}"` : ''}`);
  console.log(`   @ ${[...r.where].slice(0, 6).join(', ')}${r.where.size > 6 ? ` +${r.where.size - 6}` : ''}`);
}
console.log(`\n=== 리빌 슬롯 (§7.2-15): ${revealChecked}장 확인, ${gate.filter((g) => g.kind === 'reveal-slot').length}건 ===`);
console.log('\n=== metrics (card width · seam · grid rows/px/font · rail) ===');
for (const m of metricsLog) console.log(`  ${m}`);
console.log('\n=== gutters (left offset → count) ===');
for (const r of report) {
  const g = Object.entries(r.gutters).sort((a, b) => b[1] - a[1]);
  if (g.length > 1) console.log(`${r.size}/${r.screen}: ${g.map(([k, v]) => `${k}px×${v}`).join('  ')}`);
}
console.log('\n=== bottom cut by tab bar ===');
for (const r of report) if (r.bottomCut && r.bottomCut.cut > 0) console.log(`${r.size}/${r.screen}: ${r.bottomCut.cut.toFixed(0)}px cut  "${r.bottomCut.text}"  [${r.bottomCut.scroller}]`);
await browser.close();
const failed = gate.length > 0 || missed.length > 0;
console.log(`\n${failed ? 'FAIL' : 'OK'} — gate ${gate.length}, missed ${missed.length}, n/a ${na.length}, probes ${report.length}`);
if (failed && !FLAGS['no-gate']) process.exit(1);
