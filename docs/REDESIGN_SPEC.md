# Holdem Flicker v2 — FINAL REDESIGN SPEC (mobile only)

Status: **implementation-ready**. Implementers read only this file plus the code. Reference viewport 390×844
(iPhone 13, safe-top 47, safe-bottom 34). Wireframes are 48 columns wide (1 col ≈ 8 px). Korean UI.
React 18 + TypeScript strict, **no new runtime dependencies** (CSS/SVG only; `backdrop-filter` allowed).
`npx tsc --noEmit -p tsconfig.json` must pass with no unused locals.

Untouchable (read-only for every owner): `src/poker/**`, `src/components/PlayingCard.tsx`,
`src/components/TableDiagram.tsx`, `src/components/ActionBadge.tsx`, `src/components/TimerBar.tsx`,
`src/styles/cards.css`, `src/state/stats.ts`, `scripts/**`. Everything else is re-organized per §10.

---

## 0. Concept review (why this synthesis)

| Concept | iOS 26 fit | KR 10–20s | Loop completeness | Feasibility | Coherence | Total |
|---|---|---|---|---|---|---|
| ios-glass ("Liquid Glass Study Table") | 10 | 7 | 8 | 8 | 9 | **42** |
| kr-product ("오늘 20장, 1분 30초") | 7 | 10 | 8 | 8 | 8 | 41 |
| learning-science ("Decks, not a slot machine") | 6 | 7 | 10 | 7 | 9 | 39 |

Base = **ios-glass** (glass recipe, concentric radii, IA, HUD, gesture fork, motion, blur budget).
Grafted from **kr-product**: ink-navy ground + mint accent, amber (never red) for 헷갈려요, Toss-tone
microcopy and Home headline rules, ✕-to-end with partial summary, peeked-card rule, tap-flag in 노출/순간기억,
first-session speed feedback chips, answer-first explanation order.
Grafted from **learning-science**: learnable-set universe (non-fold + boundary folds), one SRS record fed by
three channels (exposure / rating / quiz), "퀴즈로 확인" bridge from the summary, goal-relative heatmap levels,
first-week new-card cap, chart mastery overlay (P2).

Deliberately cut: streak freezes, tab-bar minimize-on-scroll, think-phase early swipe, ∞ session size,
`linear()` spring easing (use cubic-bezier), 4-grade ratings, push/notification of any kind.

---

## 1. Principles and tone

1. **Content is the felt, controls are glass.** Cards, the answer badge and the range grid are the only
   opaque saturated things. HUD, tab bar, chips, sheets float above as translucent glass. Never more than
   **three blurred surfaces** visible at once; glass never sits on glass more than two deep.
2. **A session has an end.** 20 cards → summary → "한 번 더". No infinite trainer. Home always says what
   is left today.
3. **One gesture per intent.** Tap a choice button = answer + reveal. Hold = pause + explanation.
   Max 4 controls on screen during a session.
4. **Quiet gamification.** One flame, one ring, one heatmap. No confetti, no coins, no "대박!!". Praise
   with numbers ("어제보다 6장 더").
5. **Toss-plain Korean.** "~해요" endings, short nouns, few periods. Poker terms stay (오픈·콜·3벳·4벳·올인,
   UTG/HJ/CO/BTN/SB/BB). Vocabulary is 카드·세션·복습·목표·연속 — never 베팅·칩·판돈.

Microcopy table (use verbatim):

| Where | Copy |
|---|---|
| Think prompt | `뭐 할래요?` + legal actions line `폴드 · 콜 · 3벳` |
| Rating buttons | `헷갈려요` / `알아요` |
| Home headline: remaining | `오늘 {n}장 남았어요` · sub `1분이면 끝나요` |
| Home headline: goal done | `오늘 목표 끝! 🔥 {streak}일째` · sub `더 하면 내일 복습이 가벼워져요` |
| Home headline: streak broken (rest ≥ 2 days, previous streak ≥ 3) | `{rest}일 쉬었어요. 오늘 다시 시작` |
| Home headline: first run | `포커 프리플랍, 카드로 외워요` · CTA `첫 세션 시작 · 20장 · 약 2분` |
| Home CTA | no session today `오늘 세션 시작 · 20장` / in progress `이어서 하기 · {n}장 남음` / goal done `한 세션 더` |
| Empty heatmap | `첫 세션을 하면 여기가 채워져요` |
| Empty weak spots | `10장만 평가하면 약점이 보여요` |
| Deck × position has no charts | `이 조합의 차트가 아직 없어요` |
| 내 약점 chip disabled | `아직 없어요 · 10장만 평가하면 열려요` |
| Peeked (held in think phase) | `답을 먼저 봤어요 · 다음에 확인해요` |
| Think timer expired with no choice | `시간 초과 · 못 골랐어요` |
| Summary headline | `세션 끝!` / partial `여기까지 {n}장` |
| Summary CTAs | `틀린 것만 다시 · {n}장` / `한 번 더` / `퀴즈로 확인` / `홈으로` |
| Hold overlay footer | `손을 떼면 이어서 진행해요` |
| End-session confirm | title `여기까지 기록할까요?` body `본 카드 {n}장은 저장돼요` · `계속하기` / `끝내기` |
| 노출 모드 caption | `훑어보기 중 · 탭하면 헷갈려요로 표시` |
| Quiz round summary | `{correct}/10 · 최고 연속 {best} · 틀린 {n}장은 헷갈려요로 표시했어요` |

---

## 2. Design tokens (`src/styles/global.css` — the only place tokens are defined)

Dark is the only theme (`color-scheme: dark`). Legacy aliases at the bottom keep the untouched components
(`PlayingCard`, `TableDiagram`, `ActionBadge`, `TimerBar`, `RangeGrid`) rendering correctly.

```css
:root {
  /* ---- ground: ink-navy with a felt memory ---- */
  --bg-0: #0A0D13;            /* body */
  --bg-1: #10141C;            /* opaque raised (sheet body fallback) */
  --bg-2: #171C26;            /* opaque fallback for glass without backdrop-filter */
  --glow-felt: #0F7A53;       /* top-center blob (green felt) */
  --glow-cool: #1E4E86;       /* bottom-right blob + upper-right wash (cool) */
  --glow-plum: #4B2A6E;       /* left-middle blob (violet) */

  /* ---- ink ---- */
  --ink: #F2F4F8;
  --ink-2: rgba(242,244,248,0.70);
  --ink-3: rgba(242,244,248,0.44);
  --ink-4: rgba(242,244,248,0.22);
  --ink-on-tint: #06110E;     /* text on mint / gold / amber solid fills */

  /* ---- brand + semantic ---- */
  --mint: #4DE3A6;            /* accent: primary CTA, active tab, timer, 알아요, progress */
  --mint-deep: #2BB884;       /* pressed CTA, ring track fill */
  --gold: #F0C75E;            /* hero seat "나" only */
  --amber: #FFB347;           /* 헷갈려요, 부분 정답, warnings — never red for self-rating */
  --coral: #FF6B6B;           /* quiz wrong, destructive */
  --sky: #6FB7FF;             /* review / due cards */
  --lilac: #B48CFF;           /* new cards */
  --flame: #FF9A3C;           /* streak flame only */

  /* ---- playing cards (unchanged look) ---- */
  --card: #FFFDF7; --card-edge: #D9D3C2; --spade: #14161C; --diamond: #D3262B;

  /* ---- actions (chroma tuned for the dark ground) ---- */
  --act-fold: #7C8594; --act-call: #34C77B; --act-raise: #FF8A3D;
  --act-threebet: #FF5A5A; --act-fourbet: #A46BFF; --act-allin: #FFD23F;

  /* ---- heatmap ramp ---- */
  --heat-0: rgba(255,255,255,0.06); --heat-1: #1E5A46; --heat-2: #2A8A66; --heat-3: #3BBF8C; --heat-4: #4DE3A6;

  /* ---- radii (concentric: child = parent − padding, snapped, never < 8) ---- */
  --r-xs: 8px; --r-sm: 12px; --r-md: 16px; --r-lg: 22px; --r-xl: 28px; --r-capsule: 999px;

  /* ---- type scale (px / weight / line-height) ---- */
  /* 본문 폰트는 셀프 호스팅한 Noto Sans KR 가변(400~800)이 1순위입니다 — src/styles/fonts.css,
     public/fonts/noto-sans-kr/, 갱신은 scripts/fetch-fonts.sh. 뒤는 폰트가 아직 안 붙었을 때의 대체 스택. */
  --font: "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard Variable",
          "Malgun Gothic", system-ui, sans-serif;
  --fs-display: 44px; --lh-display: 48px;   /* 800, -0.03em  summary "20장", ring number */
  --fs-title-l: 34px; --lh-title-l: 41px;   /* 700, -0.02em  screen titles */
  --fs-title-1: 28px; --lh-title-1: 34px;   /* 700, -0.02em  summary headline */
  --fs-title-2: 22px; --lh-title-2: 28px;   /* 700, -0.015em panel titles, answer badge lg */
  --fs-title-3: 20px; --lh-title-3: 25px;   /* 600, -0.01em  hand label */
  --fs-headline: 17px; --lh-headline: 22px; /* 600           buttons, situation line */
  --fs-body: 16px; --lh-body: 24px;         /* 400           explanations */
  --fs-callout: 15px; --lh-callout: 21px;   /* 500           chips, list rows */
  --fs-subhead: 14px; --lh-subhead: 20px;   /* 500           secondary rows, mix chips */
  --fs-footnote: 13px; --lh-footnote: 18px; /* 400           hints, captions */
  --fs-caption: 12px; --lh-caption: 16px;   /* 600, +0.01em  tab labels, tile labels (minimum size) */

  /* ---- spacing (4-pt) ---- */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-11: 44px;
  --gutter: 16px;
  --glow-room: 14px;          /* max sideways bleed of ANY outer shadow — must stay ≤ --gutter */
  --tab-h: 64px; --tab-inset: 16px; --tab-gap: 12px; --tab-padx: 10px; --tab-pady: 6px; --tab-pill-gap: 8px;
  --tab-icon: 24px; --tab-icon-gap: 2px;
  --tab-content-h: calc(var(--tab-icon) + var(--tab-icon-gap) + var(--lh-caption));  /* 42 — the pill sizes off THIS */
  --tab-pill-pad: 4px;
  --content-bottom: calc(var(--tab-h) + var(--tab-gap) + 16px + var(--safe-bottom));
  --tap: 44px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);

  /* ---- motion ---- */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);        /* arrivals */
  --ease-in: cubic-bezier(0.55, 0, 1, 0.45);        /* departures */
  --ease-std: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.3, 0.64, 1);  /* ~8% overshoot */
  --dur-micro: 120ms; --dur-quick: 200ms; --dur-std: 320ms; --dur-slow: 420ms; --dur-ring: 600ms;

  /* ---- z-layers ---- */
  --z-content: 0; --z-sticky: 10; --z-tabbar: 20; --z-toast: 30; --z-hold: 35;
  --z-sheet-backdrop: 40; --z-sheet: 41; --z-coach: 50;

  color-scheme: dark;

  /* ---- legacy aliases (do not remove; untouched components use them) ---- */
  --felt-900: var(--bg-0); --felt-800: var(--bg-1); --felt-700: var(--bg-2); --felt-600: #1D2431;
  --rail: #2A2118;
  --ink-dim: var(--ink-2); --ink-faint: var(--ink-3);
  --accent: var(--mint); --danger: var(--coral); --ok: var(--mint);
  --radius: var(--r-md); --radius-sm: var(--r-sm); --shadow: 0 8px 24px rgba(0,0,0,0.35);
}

body {
  margin: 0; font-family: var(--font); color: var(--ink);
  background:
    radial-gradient(70% 40% at 50% -5%, color-mix(in srgb, var(--glow-felt) 30%, transparent), transparent 70%),
    radial-gradient(60% 40% at 100% 100%, color-mix(in srgb, var(--glow-cool) 20%, transparent), transparent 70%),
    var(--bg-0);
  background-attachment: fixed;
  overscroll-behavior: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none;
  word-break: keep-all;
}
.tnum, .t-display, .t-title-1, .t-title-2, .t-title-3 { font-variant-numeric: tabular-nums; }
```

**Background gradient rules.** The blobs are what make glass read as glass — glass does not glow by
itself, it only shows what is behind it, so a flat near-black ground makes every pane a grey box no
matter how much blur it carries. Four blobs in **three** hues (felt green top, cool blue bottom-right
and upper-right, violet left-middle) plus a very fine grain layer (`body::before`, opacity 0.055,
an inline `feTurbulence` SVG, painted **under** `#root` so it never touches text). They are painted once on
`body` (`background-attachment: fixed`); screens never paint their own opaque background. `.app__push`
repaints the same blobs because it covers the body. Full-screen
states (session, coach mark) may add one extra blob behind the cards:
`radial-gradient(50% 30% at 50% 45%, rgba(77,227,166,0.10), transparent 70%)`. Sheets and the hold overlay
add `rgba(0,0,0,0.35)` backdrop over everything else.

**Stroke rule (one line, and it governs every edge in the app).**

> **One edge per element. Never wider than 1px. The line draws the silhouette; the glow and the fill carry
> the emphasis.**

1. **One edge, never two.** An element that has the `::before` gradient rim has `border: 0`. An element with
   no rim gets exactly one `inset 0 0 0 Npx` hairline. Never a `border` *and* an inset hairline.
2. **Width.** Resting edges are `0.5px`. State edges (selected / correct / wrong / mastered / today) and
   identity rings on elements ≤ 32px are `1px`. Nothing else is wider.
3. **Alpha.** `width × alpha ≤ 0.30` for white, `≤ 0.55` for a saturated accent.
4. **Carve-outs, all non-perimeter:** `:focus-visible` keeps `2px` for accessibility; `.ui-explain__ex > li`'s
   left accent bar keeps 2px because it is a bar, not an outline; the range slider thumb keeps its 3px mint
   ring because that ring *is* the control's identity and has no glow to compete with.
5. **Glow values never change to fix an edge.** The fix is always to stop the *line* from out-valuing the glow.

Why: the app used to draw `border: 1px solid rgba(255,255,255,0.12)` on every glass pane *and* a `::before`
gradient rim landing just inside it — 2 CSS px, 6 device px at 3×, with a third bright line stacked on top
from the inset highlight. That bright ring out-valued the glow it enclosed, which is what "테두리가 두꺼워서
글로우가 못생겼다" was describing. Apple does not do this: grepping the full *Adopting Liquid Glass*
overview for "border", "stroke" and "outline" returns **zero** hits — the edge is a moving specular
highlight, not a constant ring (WWDC25 219: light "travel[s] around the material, defining its silhouette").
Apple publishes no alpha values, so **the numbers here are ours**, derived from the doubling arithmetic.

`0.5px` only renders as a half pixel at ≥ 2×; at 1× it rounds to 0 or 1. A
`@media (max-resolution: 1.5dppx)` block restates the rim at 1px with half the alpha so the weight matches.

**Shadow rule (`--glow-room`).** Every scroll container clips at its padding box, and setting
`overflow-y: auto` makes `overflow-x` compute to `auto` too — so a shadow that bleeds wider than the
gutter is sliced into a hard rectangle at both screen edges on every screen at once. Therefore **every
outer shadow carries a negative spread**, sized so that `blur + spread − |offset-x| ≤ --glow-room` (14)
and `blur + spread − offset-y ≤ 0` upward (a drop shadow must not bleed above its element). Downward
bleed is the one that needs room reserved: panels 24 px, controls 12–14 px. Containers that clip
(`.trainer-session`, `.trainer-summary`, `.ui-chiprow`, `.trainer-crumbs`) reserve it as padding, with a
matching negative margin where the layout must not shift. `scripts/layout-audit.mjs` enforces this as
the `glow-clip` check — it walks to the first clipping ancestor and compares against `scrollWidth/Height`,
so "below the fold" is not reported and a real slice is.

### 2.1 Glass recipes (reusable classes, defined once in `global.css`)

```css
.glass, .glass-strong, .glass-tint, .glass-clear {
  position: relative; isolation: isolate; border: 1px solid rgba(255,255,255,0.12); border-radius: var(--r-lg);
}
/* Regular — HUD, panels, tiles, chips-container, rating buttons.
   `brightness()` is load-bearing: blurring a near-black ground returns a near-black pane, so the
   backdrop has to be lifted for the inside of the pane to read lighter than the ground around it.
   Target: ≥ 15 L (sRGB luma) between the pane's middle and the ground just outside it. */
.glass {
  background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.055) 54%, rgba(255,255,255,0.09) 100%);
  -webkit-backdrop-filter: blur(24px) saturate(185%) brightness(1.45); backdrop-filter: blur(24px) saturate(185%) brightness(1.45);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.10),
              0 12px 24px -12px rgba(0,0,0,0.66), 0 2px 6px -5px rgba(0,0,0,0.5);
}
/* Strong — tab bar, sheets, hold overlay, coach card (long text must stay readable) */
.glass-strong {
  background: linear-gradient(180deg, rgba(38,46,62,0.60) 0%, rgba(20,25,35,0.74) 100%);
  -webkit-backdrop-filter: blur(34px) saturate(195%) brightness(1.38); backdrop-filter: blur(34px) saturate(195%) brightness(1.38);
  border-color: rgba(255,255,255,0.18);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.26), inset 0 -1px 0 rgba(0,0,0,0.30),
              0 16px 32px -18px rgba(0,0,0,0.72), 0 -8px 24px -12px rgba(0,0,0,0.55);
}
/* Tint — primary CTA (with .glass-solid), active tab pill, active segment, answer capsule, know/unsure buttons */
.glass-tint {
  --tint: var(--mint);
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 42%, transparent) 0%, color-mix(in srgb, var(--tint) 26%, transparent) 100%);
  -webkit-backdrop-filter: blur(20px) saturate(180%) brightness(1.35); backdrop-filter: blur(20px) saturate(180%) brightness(1.35);
  border-color: color-mix(in srgb, var(--tint) 55%, rgba(255,255,255,0.12));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.34), 0 8px 20px -9px color-mix(in srgb, var(--tint) 58%, transparent);
}
.glass-solid { background: var(--tint); color: var(--ink-on-tint); border-color: transparent; }  /* one per screen */
/* Clear — sits over the card stage: answer slot, stat pills. Lower blur keeps the cards visible. */
.glass-clear {
  background: linear-gradient(180deg, rgba(255,255,255,0.125), rgba(255,255,255,0.045));
  -webkit-backdrop-filter: blur(14px) saturate(170%) brightness(1.34); backdrop-filter: blur(14px) saturate(170%) brightness(1.34);
  border-color: rgba(255,255,255,0.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.26), inset 0 -1px 0 rgba(255,255,255,0.08);
}
/* Turning the blur off also turns the brightness lift off, so .glass-flat has to pay for it itself —
   otherwise small glass (chips, tiles, buttons) reads as a different, darker material on the same screen. */
.glass-flat { -webkit-backdrop-filter: none; backdrop-filter: none; }
.glass.glass-flat { background: linear-gradient(180deg, rgba(255,255,255,0.175) 0%, rgba(255,255,255,0.085) 54%, rgba(255,255,255,0.115) 100%); }
.glass-tint.glass-flat { background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 52%, transparent) 0%, color-mix(in srgb, var(--tint) 34%, transparent) 100%); }
.glass-clear.glass-flat { background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06)); }
/* Refractive rim (regular + strong + clear) */
.glass::before, .glass-strong::before, .glass-clear::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.12) 32%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.30) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
}
/* Specular pool at the top (regular + clear) */
.glass::after, .glass-clear::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(125% 58% at 50% -12%, rgba(255,255,255,0.18), transparent 62%);
}
/* Controls sit shallower than panels — a button on the last row of a screen would otherwise demand
   24 px of reserved space below it. Defined in ui.css next to .ui-btn / .ui-ibtn / .ui-chip. */
.ui-btn.glass, .ui-ibtn.glass          { box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.09), 0 6px 14px -8px rgba(0,0,0,0.7); }
.ui-btn.glass-tint, .ui-ibtn.glass-tint { box-shadow: inset 0 1px 0 rgba(255,255,255,0.34), 0 6px 16px -8px color-mix(in srgb, var(--tint) 58%, transparent); }
.ui-chip.glass-tint                     { box-shadow: inset 0 1px 0 rgba(255,255,255,0.34), 0 5px 13px -6px color-mix(in srgb, var(--tint) 62%, transparent); }
/* Press */
.glass-press { transition: transform var(--dur-std) var(--ease-spring), background-color var(--dur-micro); }
.glass-press:active { transform: scale(0.97); background-color: rgba(255,255,255,0.16); transition-duration: var(--dur-micro); }
.glass-tint.glass-press:active { filter: brightness(1.12); }
/* Flat fills for things inside a glass panel (no second blur) */
.fill {
  background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06));
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(255,255,255,0.06);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass, .glass-clear { background: rgba(30,37,50,0.94); }
  .glass-strong { background: rgba(22,27,38,0.96); }
  .glass-tint { background: color-mix(in srgb, var(--tint) 38%, var(--bg-2)); }
}
```

Rules: (1) blur budget ≤ 3 visible; in a running session exactly HUD + answer slot (+ hold overlay when
shown); the position strip is a flat `.fill`, not glass. (2) Chips inside a glass panel are `.fill`.
(3) Text on `.glass-tint` uses `--ink` except `--act-allin` (yellow) which uses `--ink-on-tint`.
(4) Radius concentric rule: `--r-lg` (22) card + 12 px padding → rows `--r-sm`; `--r-xl` sheet + 16 padding →
panels `--r-sm`; `--r-md` panel + 8 padding → cells `--r-xs`.

---

## 3. Information architecture

**Four floating tabs; 설정 is pushed.**

| Tab (`TabId`) | Screen file | Purpose |
|---|---|---|
| `home` 홈 | `src/screens/HomeScreen.tsx` | today's ring, streak, CTA, stat tiles, 약점, heatmap, level line. ⚙ → 설정. **Default tab** (unless a session is `running`/`paused` → `train`). |
| `train` 훈련 | `src/screens/TrainerScreen.tsx` | setup → session → summary (one screen, three states; not a nav stack). Tab bar hidden while `running`. |
| `quiz` 퀴즈 | `src/screens/QuizScreen.tsx` | rounds of 10 from the same SRS queue; answer buttons. Tab bar hidden during a round. |
| `charts` 차트 | `src/screens/ChartsScreen.tsx` | reference grid + cell explanation + "이 상황으로 훈련하기" + P2 mastery overlay. |
| (pushed) 설정 | `src/screens/SettingsScreen.tsx` | opened from Home ⚙ and trainer setup ⋯; slides in from the right; ‹ back. |

Navigation store — `src/state/nav.ts` (owner A):

```ts
import type { Pos } from '../poker/types';
export type TabId = 'home' | 'train' | 'quiz' | 'charts';
export type DeckId = 'all' | 'rfi' | 'vs_open' | 'vs_3bet' | 'vs_4bet_allin' | 'weak' | 'scenario';
export interface LaunchIntent {
  target: 'train' | 'quiz';
  deck?: DeckId;
  positions?: Pos[];            // omit = keep current
  scenarioId?: string;          // with deck 'scenario' (e.g. "vs_open:BB:BTN")
  onlyKeys?: string[];          // exact card keys (틀린 것만 다시 / 퀴즈로 확인)
  autostart?: boolean;          // skip the setup screen
}
export interface NavState { tab: TabId; settingsOpen: boolean; launch: LaunchIntent | null; }
export function useNav(): NavState;
export function setTab(tab: TabId): void;
export function openSettings(open: boolean): void;
export function launch(intent: LaunchIntent): void;   // sets tab = intent.target and stores the intent
export function consumeLaunch(): LaunchIntent | null; // trainer/quiz call once on mount/focus, clears it
```

`App.tsx` renders `<main>` + `<FloatingTabBar hidden={sessionActive}>` + `<ToastHost/>` + the pushed
`SettingsScreen` (`position: fixed; inset: 0; z-index: var(--z-sheet)`, slide-in 320 ms). `sessionActive`
is read from `src/screens/trainer/sessionStore.ts` (`useSessionStatus()` returns `'idle'|'running'|'paused'|'summary'`)
and from the quiz round store (`useQuizActive()`); either hides the bar.

### 3.1 Floating glass tab bar spec

- Class `.glass-strong`, radius capsule, **height 64**, `position: fixed; left/right: var(--tab-inset)` (16),
  `bottom: calc(var(--tab-gap) + var(--safe-bottom))` (12 + safe), `max-width: 488px; margin: 0 auto`,
  `z-index: var(--z-tabbar)`. Padding `var(--tab-pady) var(--tab-padx)` (6 / 10); `--n` equal columns
  (4 or 5 — `--n` is set inline from `items.length`).
- Item: `min-height: var(--tab-content-h)` stretched by the grid row (52) × full column, icon `--tab-icon`
  (24), label `--fs-caption` 600 below (gap `--tab-icon-gap`). Inactive `--ink-3`, active `--ink`.
- Active indicator: one `.glass-tint` capsule (`--tint: var(--mint)`) whose height is
  **derived from the content, not from the bar**: `top`/`bottom` = `(100% − --tab-content-h − 2×--tab-pill-pad) / 2`,
  giving pill 50 = content 42 + 4 + 4, and whatever is left over (7) becomes the ring to the bar.
  Left/right it is inset `--tab-pill-gap / 2` inside its column, width `column − --tab-pill-gap`;
  `transform: translateX(col × (100% + --tab-pill-gap))`, transition `var(--dur-std) var(--ease-spring)`.
  **Why derived and not literal:** the pill used to be `top/bottom: 10px` (against the bar's *padding* box)
  while the item was `height: calc(--tab-h − 2×--tab-pady)` (a *content* box figure). `box-sizing: border-box`
  plus `.glass-strong`'s then-1px border made those two boxes disagree by 2px, so the pill came out exactly
  42 — the same height as its own content, giving it **zero** padding, and the label's bottom edge landed
  1px *outside* the pill. Sizing both from `--tab-content-h` makes the padding 4/4 whatever the border is.
  Do not restyle this as `top: 50%; transform: translateY(-50%) …` — that runs `--ease-spring`'s overshoot
  through the Y axis.
  **Why the pill is inset, not full-column:** the pill body was never actually outside the bar — measured,
  a full-column pill still had ~7 px of clearance against the bar's rounded end. What burst out was its
  **glow**: `.glass-tint` bled 24 px sideways into a 7 px gap, so the mint spilled past the capsule and the
  end pill read as crushed against it. A fifth tab made both numbers worse (narrower columns, same glow).
  Two changes fix it and the guard measures both: the glow is now 11 px sideways (negative spread), and the
  pill is inset so the end gap is ~15 px and neighbouring pills no longer touch (column − 8). Rule: the
  end gap must be ≥ the pill's sideways glow, and the column must be ≥ 4 px wider than the pill.
- Hidden: `transform: translateY(140%)`, `transition: transform 260ms var(--ease-in)`; shown with `--ease-out`.
- Screens add `padding-bottom: var(--content-bottom)` so the last row clears the bar. Never margin.
- Tap: no haptic. `aria-current="page"` on the active item.

---

## 4. Component inventory (`src/components/ui/`, owner A unless noted)

All components are store-agnostic (props only), typed with `React.ReactNode`, forward `className`, and
use `.glass*` classes from `global.css`. Styles live in `src/styles/ui.css` (owner A) except CoachMark.

```ts
// src/components/ui/GlassPanel.tsx
export interface GlassPanelProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'regular' | 'strong' | 'tint' | 'clear';      // default 'regular'
  tint?: string;                                            // CSS color for variant 'tint' (default var(--mint))
  radius?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'capsule';   // default 'lg'
  padding?: 0 | 12 | 16 | 20;                               // default 16
  interactive?: boolean;                                    // adds .glass-press
  as?: 'div' | 'section' | 'nav' | 'header' | 'button';     // default 'div'
}
export function GlassPanel(props: GlassPanelProps): JSX.Element;

// src/components/ui/CapsuleButton.tsx  (min-height per size: md 44, lg 52, xl 56; radius capsule; font headline 600)
export interface CapsuleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'neutral' | 'ghost' | 'know' | 'unsure' | 'danger' | 'tint';
  //      primary = .glass-tint.glass-solid mint (one per screen); neutral = .glass; ghost = transparent + 1px border;
  //      know = .glass-tint mint; unsure = .glass-tint amber; danger = .glass-tint coral; tint = .glass-tint with `tint`
  tint?: string;
  size?: 'md' | 'lg' | 'xl';         // default 'lg'
  block?: boolean;                   // width 100%
  icon?: React.ReactNode;            // leading, 20px
  trailing?: React.ReactNode;        // e.g. "· 약 2분" in --ink-2
}

// src/components/ui/IconButton.tsx  (circular .glass, 44×44 or 40×40, icon 22px)
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode; label: string /* aria-label, required */;
  size?: 44 | 40; tone?: 'glass' | 'ghost' | 'accent'; active?: boolean;
}

// src/components/ui/Chip.tsx  (capsule .fill, height 36 default; selected = .glass-tint; count badge; dot 6px)
export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean; count?: number; dot?: string /* CSS color */; tint?: string; size?: 32 | 36 | 40;
}
// src/components/ui/ChipRow.tsx — horizontal scroller (`overflow-x: auto; scrollbar-width: none; gap 8; padding-inline: var(--gutter)`), no wrap
export function ChipRow(props: { children: React.ReactNode; wrap?: boolean; ariaLabel?: string }): JSX.Element;

// src/components/ui/SegmentedControl.tsx  (.glass capsule track 44/48 high, padding 4; active segment = .glass-tint capsule that glides 320ms spring)
export interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T; onChange(v: T): void; size?: 44 | 48; ariaLabel: string;
}

// src/components/ui/Switch.tsx  (52×30 capsule, knob 24, on = --mint, 150ms)
export interface SwitchProps { checked: boolean; onChange(v: boolean): void; label: string /* aria */; disabled?: boolean; }

// src/components/ui/FloatingTabBar.tsx  (§3.1)
export type TabId = 'home' | 'train' | 'quiz' | 'charts';
export interface FloatingTabBarProps {
  items: Array<{ id: TabId; label: string; icon: React.ReactNode }>;
  active: TabId; onChange(id: TabId): void; hidden?: boolean;
}

// src/components/ui/ProgressRing.tsx  (SVG; stroke-linecap round; track --ink-4; fill = tint; stroke-dashoffset transition --dur-ring --ease-out when animate)
export interface ProgressRingProps {
  value: number; max: number;
  size?: 64 | 88 | 120;   stroke?: 6 | 8 | 10;
  tint?: string;          // default var(--mint); pass var(--gold) when goal reached
  innerValue?: number;    // optional thin inner ring (rated cards) — stroke 3, --sky
  label?: React.ReactNode;// centered content
  animate?: boolean;      // default true
  celebrate?: boolean;    // one pulse scale 1→1.06→1, 420ms, when it becomes true
}

// src/components/ui/Heatmap.tsx  (CSS grid; weekday labels 월/수/금/일 on the left in --fs-caption; month labels on top)
export interface HeatmapProps {
  days: Record<string, number>;   // dayKey 'YYYY-MM-DD' → cards
  weeks?: number;                 // default 12 (columns, oldest left; rows 월…일)
  goal: number;                   // for level thresholds (§7.2)
  todayKey: string;               // gets a 1px --mint ring
  onSelect?(dayKey: string, value: number): void;   // caller shows the footnote "9월 3일 · 32장"
}
// cell size = (panel inner width − 24 label − 11×4 gap) / 12 ≈ 22px at 390; min 16; radius 4; gap 4.

// src/components/ui/StatTile.tsx  (.glass radius md, padding 12; value --fs-title-2 700 tnum; label --fs-caption --ink-2; dot 6px before label)
export interface StatTileProps { label: string; value: string | number; dot?: string; delta?: string; onClick?(): void; }

// src/components/ui/Sheet.tsx  (replaces .sheet: .glass-strong, top radius --r-xl, grabber 40×4, backdrop rgba(0,0,0,.35) tap closes,
//   Esc closes, focus trapped, body scroll locked; slides up 420ms spring, dismiss 220ms ease-in; max-width 520 centered)
export interface SheetProps {
  open: boolean; onClose(): void; title?: string;
  detent?: 'auto' | 'half' | 'full';   // auto = content height ≤ 62vh; half = 62vh; full = 92vh (scrollable)
  held?: boolean;                      // hold overlay variant: pointer-events none, height 72%, no backdrop tap, bottom fade mask 48px
  footer?: React.ReactNode;            // sticky bottom row
  children: React.ReactNode;
}

// src/components/ui/SpeedPicker.tsx  (SegmentedControl of presets + caption "생각 8초 · 답 5초" (live) + 노출 모드 switch row)
export type SpeedPreset = 'slow' | 'normal' | 'fast' | 'flash' | 'custom';   // re-exported from src/state/settings.ts
export interface SpeedPickerProps {
  value: SpeedPreset; onChange(v: SpeedPreset): void;
  exposure: boolean; onExposureChange(v: boolean): void;
  showCustom?: boolean;   // adds "사용자" segment only when settings.speedPreset === 'custom'
}

// src/components/ui/RatingBar.tsx  (two capsules 56 high, gap 12, widths 42:58 (헷갈려요 : 알아요); tones unsure/know; compact = 44 high)
export interface RatingBarProps {
  onRate(r: 'know' | 'unsure'): void;
  disabled?: boolean;
  knowDisabled?: boolean; knowDisabledHint?: string;   // peeked rule: 알아요 dimmed + footnote below
  compact?: boolean; pulseOnce?: boolean;              // first reveal of a fresh install: one spring pulse
}

// src/components/ui/SessionSummaryCard.tsx  (store-agnostic; trainer/quiz map their result into SummaryData)
export interface SummaryRow { key: string; hand: string; cards: [Card, Card]; title: string; action: Action; kind: ScenarioKind; }
export interface SummaryData {
  mode: 'train' | 'quiz';
  headline: string;              // "세션 끝!" | "여기까지 8장" | "퀴즈 끝!"
  seen: number; size: number; durationMs: number; speedLabel: string;   // "보통" | "순간기억" | "노출 · 보통" | "퀴즈"
  rated: number; known: number; unsure: number;     // quiz: rated = answered, known = correct(+partial), unsure = wrong
  byOrigin: { new: number; review: number; unsure: number };
  goalToday: number; goal: number; goalReachedNow: boolean;
  streak: number; streakIncremented: boolean;
  weekDots: boolean[];           // 7 entries, 월…일, goal reached
  weakest?: { label: string /* "SB · 오픈 대응" */; unsure: number; shown: number; quizAcc?: number };
  unsureRows: SummaryRow[];
  exposureOnly: boolean;         // 순간기억/노출: hide ring %, show "노출 {seen}장 · 평가 없음"
  firstSession?: boolean;        // shows the speed feedback chips
  levelUp?: string;              // "레귤러 됐어요" one line in the streak card
}
export interface SessionSummaryCardProps {
  data: SummaryData;
  onRetryUnsure(): void; onAgain(): void; onHome(): void;
  onQuiz?(): void;                     // "퀴즈로 확인" (trainer only); quiz summary passes onTrain instead
  onTrain?(): void;                    // "훈련으로 복습" (quiz only)
  onOpenRow?(row: SummaryRow): void;   // opens ExplanationSheet
  onSpeedFeedback?(v: 'slower' | 'ok' | 'faster'): void;
}

// src/components/ui/CoachMark.tsx  — OWNER F (styles in src/styles/coachmark.css)
export interface CoachMarkProps {
  steps: Array<{ title: string; body: string; art: 'hold' | 'choose' | 'session' }>;
  onDone(): void; onSkip(): void;
}

// src/components/ui/Toast.tsx  (capsule .glass-strong above the tab bar, 2200ms, z --z-toast; one at a time)
export function toast(message: string, tone?: 'neutral' | 'mint' | 'amber'): void;
export function ToastHost(): JSX.Element;

// src/components/ui/icons.tsx  — 24px stroke icons: home, cards, quiz, grid, gear, pause, play, close, back, prev, next, more, flame, check, question
```

`src/components/ExplanationSheet.tsx` (owner A) keeps its exported names and props
(`ExplanationBody({step, explanation})`, `ExplanationSheet({step, explanation, onClose})`) but renders
through `<Sheet open detent="half" title={e.headline}>` and reorders `ExplanationBody` to
**answer badge → 왜 이 액션인가 → 핸드 → 상황 → 레인지 → 혼합 빈도 → 메모 → 플랍**.

Kept unchanged (contracts in `docs/UI_SPEC.md`): `PlayingCard`/`HandView`, `TableDiagram`, `RangeGrid`
(gains optional `overlay?` prop, owner E), `ActionBadge`/`actionLabel`, `TimerBar`, `StepCrumbs`, `FitBox`.

---

## 5. Per-screen specs (390 px, 48 cols). Legend: `╭╮╰╯` glass, `[ ]` capsule button, `( )` chip / 44 px
circle, `▓` solid primary, `◉` ring, `━` progress, `▪` heat cell.

### 5.1 홈 (Home / 진행)

```
┌────────────────────────────────────────────────┐
│ 🔥 7일째 · 루키                           (⚙)  │  footnote --ink-2 (flame --flame) · gear IconButton 44
│ 오늘 8장 남았어요                              │  Large title 34/700
│ 1분이면 끝나요                                 │  callout --ink-2
│                                                │
│ ╭────────────────────────────────────────────╮ │  GlassPanel regular r-lg, padding 16
│ │  ◉ 12/20     복습 6 · 헷갈려요 3 · 새 카드 11│ │  ProgressRing 88/8 mint (gold when done); footnote, dots sky/amber/lilac
│ │  ╰─────╯     퀴즈 5문제                     │ │  second line only if quiz today > 0
│ │ ▓▓▓▓▓▓▓ ▶ 이어서 하기 · 8장 남음 ▓▓▓▓▓▓▓▓ │ │  CapsuleButton primary xl block
│ ╰────────────────────────────────────────────╯ │
│                                                │
│ ╭───────────╮ ╭───────────╮ ╭────────────╮     │  3 StatTiles, gap 8
│ │ ● 외웠어요 │ │ ● 배우는 중│ │ ● 새 카드   │ │  dots mint / amber / lilac
│ │ 142       │ │ 38        │ │ 1,246      │     │  Title 2 tnum
│ ╰───────────╯ ╰───────────╯ ╰────────────╯     │
│                                                │
│ 약한 곳                        내 약점 덱 훈련 ▸│  Title 3 + mint link (launch train, deck 'weak')
│ ╭────────────────────────────────────────────╮ │  rows 52, divider 1px rgba(255,255,255,.08)
│ │ ● SB · 오픈 대응        헷갈려요 46%    ▸   │ │  tap → launch({target:'train', deck:'vs_open', positions:['SB']})
│ │ ● BTN · 3벳 대응        헷갈려요 38%    ▸   │ │
│ │ ● CO · 오픈             퀴즈 55%       ▸   │ │  second metric when quiz attempts ≥ 5
│ ╰────────────────────────────────────────────╯ │
│                                                │
│ 최근 12주                       총 3,412회 노출│  Title 3 + footnote
│ ╭────────────────────────────────────────────╮ │
│ │    7월        8월          9월              │ │  month labels caption
│ │ 월 ▪▪▪▪▪▪▪▪▪▪▪▪                             │ │  Heatmap 12×7, cell ≈22, gap 4, today ring
│ │ 수 ▪▪▪▪▪▪▪▪▪▪▪▪                             │ │
│ │ 금 ▪▪▪▪▪▪▪▪▪▪▪▪                             │ │
│ │ 일 ▪▪▪▪▪▪▪▪▪▪▪▪    적게 ▪▪▪▪▪ 많이          │ │  legend
│ │ 9월 3일 · 32장 · 알아요 81%                  │ │  footnote row after a cell tap (empty otherwise, 18px reserved)
│ ╰────────────────────────────────────────────╯ │
│                                                │
│ 지난 세션  20장 · 정답 80% · 2분 08초       ▸ │  row (progress.lastResult) → reopens summary sheet
│  ╭──────────────────────────────────────────╮  │  FloatingTabBar
│  │  ⌂ 홈    ▯▯ 훈련    ? 퀴즈    ▦ 차트     │  │
│  ╰──────────────────────────────────────────╯  │
└────────────────────────────────────────────────┘
```

Behaviours: headline per §1 table; CTA → `launch({target:'train', deck: settings.lastDeck, autostart: true})`
(recommended queue = due + 헷갈려요 + new); ⚙ → `openSettings(true)`. Level line `루키` appears only when
학습 완료 ≥ 1. Empty state: ring 0/20, heatmap all `--heat-0` with the empty copy, 약점 block replaced by
the empty copy, no 지난 세션 row. Scrolls vertically; large title does not collapse (keep it simple).

### 5.2 훈련 — setup (tab idle state)

```
┌────────────────────────────────────────────────┐
│ 훈련                                     (⋯)   │  Large title; ⋯ → openSettings(true)
│ 덱을 고르고 시작해요                            │  callout --ink-2
│ 덱                                             │  caption --ink-3
│ (전체)(오픈)(오픈 대응)(3벳 대응)(4벳/올인)(⚡내 약점 12)│  ChipRow h-scroll, 36; 약점 = amber tint + count; disabled with hint when < 10
│ 포지션                                          │
│ (전체)(UTG)(HJ)(CO)(BTN)(SB)(BB)                │  multi-select; "전체" = all of settings.positions; ≥ 1 required
│ 속도                                           │
│ ╭────────────────────────────────────────────╮ │  SpeedPicker (SegmentedControl 48)
│ │ 천천히 │ ▓보통▓ │ 빠르게 │ 순간기억          │ │
│ ╰────────────────────────────────────────────╯ │
│ 생각 8초 · 답 5초                               │  caption (live; 순간기억 → 답을 바로 보여줘요 · 선택 없음)
│ 노출 모드 · 답을 처음부터 같이 봐요        [◯ ] │  row 44 + Switch
│ 세션 크기         (10)(▓20▓)(40)               │  chips 36
│ ╭────────────────────────────────────────────╮ │  preview GlassPanel clear
│ │ 이번 세션 20장 · 약 2분                    │ │  headline
│ │ ● 복습 6   ● 헷갈려요 3   ● 새 카드 11     │ │  sky / amber / lilac
│ ╰────────────────────────────────────────────╯ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓  ▶ 시작  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  primary xl block; disabled + reason when no charts
│ 지난 세션  20장 · 정답 80% · 2분 08초       ▸ │
│  ╭──────────────────────────────────────────╮  │
│  │  ⌂ 홈    ▯▯ 훈련    ? 퀴즈    ▦ 차트     │  │
│  ╰──────────────────────────────────────────╯  │
└────────────────────────────────────────────────┘
```

Behaviours: deck/position/size/speed/exposure changes update the preview via `previewQueue()` (§7.1,
counts only, no engine dealing beyond 60 attempts). Deck and positions persist to `settings.lastDeck` /
`settings.lastPositions`; speed and exposure persist to `settings.speedPreset` / `exposureMode` (writing
`thinkSeconds`/`revealSeconds` through `applySpeedPreset`). A `LaunchIntent` from `consumeLaunch()`
pre-selects chips and, with `autostart`, starts immediately. Estimated time = size × cadence (§6.2) + 0.3 s.

### 5.3 훈련 — session, choose phase (tab bar hidden, nothing scrolls) — v2.1: buttons instead of swipe

```
┌────────────────────────────────────────────────┐
│ ╭────────────────────────────────────────────╮ │  SessionHud: ✕ · dots · counter · origin dot · phase tag ▓선택하세요▓ (mint) · ‖
│ │ (✕)  ●●●●●●●○○○○○○○○○○○○○  8/20 ▪ 선택하세요 (‖)│ │
│ ╰────────────────────────────────────────────╯ │
│ ╭────────────────────────────────────────────╮ │  position strip: TableDiagram compact inside .fill r-md (no blur)
│ │ UTG   HJ   CO  ▓BTN▓ᴰ  SB   BB             │ │
│ ╰────────────────────────────────────────────╯ │
│ BTN가 오픈 레이즈. BB인 당신 차례입니다.        │  headline, centered, 2-line clamp (scenarioSituation)
│ 오픈 대응 → 4벳 대응                            │  StepCrumbs (kept), only when steps > 1
│            ╭────╮╭────╮                        │  HandView lg via FitBox (SwipeStage owns this block — hold only)
│            │ K  ││ 10 │                        │
│            ╰────╯╰────╯                        │
│              K♦ T♠ · KTo                       │  Title 3
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░   6.4초   │  TimerBar 4px mint + countdown 22px bold mint tnum (100 ms steps)
│                어떻게 할까요?                   │  headline prompt
│ [   폴드   ] [    콜    ] [   3벳   ]           │  ChoiceButtons: SCENARIO_ACTIONS[kind], fold → aggressive, 56 high,
│ ╭ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╮ │  action-coloured (--act-*), .trainer-choice--<action>
│ │        길게 누르면 멈추고 해설               │ │  AnswerSlot placeholder (dashed glass-clear, 120 fixed) — keeps the layout stable
│ ╰ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╯ │
│  (◀)        [         해설         ]       (▶) │  IconButton 44 · CapsuleButton neutral lg · IconButton 44
└────────────────────────────────────────────────┘
```

- Ground: the near-black ink body background (`.trainer-session--think`). The HUD phase tag reads `선택하세요`.
- Tapping a choice → `choose(action)`: graded like the quiz (`gradeAnswer`: exact / weight ≥ 0.4 partial / wrong),
  rated automatically (correct · partial → `know` [partial → srs `{ partial: true }`], wrong → `unsure`,
  `ratingSource: 'button'`) and the reveal state follows at once. Keyboard 1–3 = the buttons.
- Think timer expiring with no choice → reveal in the `시간 초과` state, rated `unsure` automatically.
- Hold ≥ 180 ms on the stage (not on a button) → pause + held 해설 sheet; the phase stays `think`, the card is
  marked `peeked`, and a later choice commits as `unsure`. No tap-to-reveal, no horizontal drag.
- ◀ goes to the previous card in the reveal state (rating can be changed with 헷갈려요로 표시). ▶ skips.
- 순간기억 / 노출: no buttons (prompt + choices hidden, the fan takes the space); the answer appears by itself.

### 5.4 훈련 — reveal / explanation state (v2.1: background wash by outcome, no RatingBar)

```
┌────────────────────────────────────────────────┐
│ ╭────────────────────────────────────────────╮ │  phase tag ▪해설 (ink-2 pill); background wash fades in 200 ms
│ │ (✕)  ●●●●●●●○○○○○○○○○○○○○  8/20 ▪ 해설  (‖) │ │
│ ╰────────────────────────────────────────────╯ │
│ …strip · situation · crumbs · fan as in 5.3…    │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░  다음까지 3.2초  │  reveal timer + footnote countdown (ink-2)
│                  정답 ✓                         │  outcome line: 정답 ✓ mint · 부분 정답 △ amber · 오답 ✕ coral ·
│ [ ✓ 폴드 ] [    콜    ] [   3벳   ]             │  시간 초과 · 못 골랐어요 (ink-2). Chosen = solid + mark, correct = mint outline,
│ ╭────────────────────────────────────────────╮ │  the rest dimmed 32 %, all disabled
│ │        ╭──────────────────╮                │ │  AnswerSlot flips in: answer capsule (--act-* tint), mix chips, reasoning[0]
│ │        │       폴드       │                │ │
│ │        ╰──────────────────╯                │ │
│ │ 이 자리에서는 약한 킥커 때문에 밸류가 부족…  │ │
│ ╰────────────────────────────────────────────╯ │
│              ( 헷갈려요로 표시 )                │  ghost md toggle, only on a know-rated card (→ commits as unsure, 🤔 badge);
│  (◀)        [         해설         ]       (▶) │  wrong / 시간 초과 show the caption `헷갈려요로 기록 · 곧 다시 나와요`
└────────────────────────────────────────────────┘
```

- Session root classes: `.trainer-session--reveal` + `--correct` / `--wrong` / `--neutral` (시간 초과, no choice,
  노출 / 순간기억). Wash = `.trainer-session__wash` (z −1, opacity 0 → 1, 200 ms, instant under reduced motion):
  correct `radial-gradient(120% 80% at 50% 0%, #0f3b34, #071a17 70%)`, wrong `#3a2a0e → #1a1207`, neutral
  `#1e2a44 → #0b1020`. Text contrast stays ≥ 4.5:1 on every wash (ink / ink-2 on ≤ #3a2a0e).
- Choose mode (v2.3): the timer row keeps only the static hint `다음을 눌러 넘어가요` (bar gone, no countdown row) and
  the card leaves with the primary `다음` capsule (`.trainer-next`, block ≥ 56, mint, in place of ▶ next to ◀, 해설 and
  차트; Space / Enter / →). Same after 시간 초과. No swipe, no stamps, no fly-out.
- **5 s auto-advance inside the 다음 button** (v2.3, `NEXT_AUTO_MS = 5000` in `sessionStore.ts`, independent of the
  speed presets): entering the reveal arms `autoNextAt`; the button reads `다음 · 5` → `다음 · 1` (tabular figures)
  over a lighter-mint `::before` layer (`--next-fill`) that drains left → right under the label within the capsule
  radius — per frame from `useRafTimer`, in 1 s steps under `prefers-reduced-motion` (the fill reaches empty; only the
  visible number is clamped at 1). The armed button announces itself as `다음 · 5초 뒤 자동으로 넘어가요` (static, so the
  per-second counter stays `aria-hidden`). At 0 the store taps 다음 itself
  (same `advance()` path). Any other interaction on the revealed card — 해설 or the 차트 sheet, ◀, 헷갈려요로 표시,
  일시정지, 길게 누르기, a tap on the card area — calls `cancelAutoNext()`, which is **sticky**: the button falls back
  to a plain `다음` (no number, no fill, `data-auto="off"`) and closing the sheet does not restart it; the next card
  counts down again. 직접 넘기기 (`manual`, also forced for onlyKeys) opts out entirely, and the same gestures during
  the think phase do not pre-cancel the coming reveal. 노출 / 순간기억 are untouched (their own reveal timer below).
- 차트 (v2.3): next to 해설 in the reveal row (both ≥ 44, the row fits at 360 with the chevron dropped ≤ 380 px).
  Shown in choose mode and in 노출 (a stable reveal) but **not in 순간기억**, whose 1.5 s think ⇄ reveal flip would
  mount and unmount it — and so re-lay-out the whole row — twice per card for a button too short-lived to use.
  It opens `RevealChart` — a full-detent Sheet titled with the scenario: `ActionShares`, the 13×13 `RangeGrid` with
  the played hand ringed (`.trainer-chart__grid` padding 6 px ⇒ cells ≈ 22.1 px at 360, 24+ at 390), the caption
  `내 패 A5s는 여기`, `ChartLegend`, `chart.summary`, and a `전체 차트 보기` footer that stores the chart selection,
  **pauses the session** (the clock must not run while the user browses charts) and switches to the 차트 tab.
  Opening it goes through `setSheetOpen(true)` (session paused, auto-advance cancelled); the sheet scrolls on its
  own, the session never does.
- 노출 / 순간기억 keep the automatic reveal / expose timer (`expire` → next, `다음까지 3.2초`). With 직접 넘기기
  (`manual`, also forced for onlyKeys) they hide the timer and wait for ▶.
- 순간기억 (`flash`) and 노출 모드: exposure-only write; the rating slot shows the same 헷갈려요로 표시 toggle
  (flagged → `rate('unsure','button')` on leave, unflagged → `recordExposure`). Reveal haptic off in these modes.

### 5.5 훈련 — hold-to-pause overlay

```
┌────────────────────────────────────────────────┐
│ ╭────────────────────────────────────────────╮ │
│ │ (✕)  8/20   일시정지 · 손을 떼면 계속       (‖)│ │  HUD text swaps; timer track frozen (--ink-3)
│ ╰────────────────────────────────────────────╯ │
│ ╭────────────────────────────────────────────╮ │  strip still visible, dimmed 60%
│ │ UTG   HJ   CO  ▓BTN▓ᴰ  SB   BB             │ │
│ ╰────────────────────────────────────────────╯ │
│ ╭────────────────────────────────────────────╮ │  Sheet held: .glass-strong, r-xl top, 72% height, pointer-events none
│ │                 ────                       │ │
│ │ BB · KTo → 콜                  ╭ 콜 ╮       │ │  Title 2 + ActionBadge md
│ │ 왜 이 액션인가                              │ │  h3 mint
│ │ • 탑페어를 자주 만들어 콜하지만 …           │ │  body 16/24 (ExplanationBody, answer-first order)
│ │ • BTN 오픈 레인지는 약 44% …                │ │
│ │ 핸드                                       │ │
│ │ 오프수트 브로드웨이 …                       │ │
│ │ 상황                                       │ │
│ │ BTN가 2.5bb로 오픈했고 …                    │ │  fades at the bottom (mask 48px)
│ │        손을 떼면 이어서 진행해요            │ │  footnote --ink-3 sticky
│ ╰────────────────────────────────────────────╯ │
└────────────────────────────────────────────────┘
```

Rises 260 ms ease-out, backdrop 0→0.35; release drops 180 ms ease-in; timer resumes where it froze (the
countdown reads `일시정지` meanwhile). Sheet title is `해설`. Holding in the choose phase shows the answer in the
sheet (intended), keeps the phase and sets `peeked=true` — the later choice commits as `unsure`. Haptic 8 on
engage. The 해설 button opens the full `ExplanationSheet` (detent half, scrollable) and pauses until closed.

### 5.6 훈련 — session summary

```
┌────────────────────────────────────────────────┐
│ ╭────────────────────────────────────────────╮ │  SessionSummaryCard: GlassPanel regular r-xl, springs in 0.92→1
│ │              세션 끝!                       │ │  Title 1
│ │         20장 · 2분 08초 · 보통               │ │  footnote --ink-2
│ │            ◉ 정답 80%                       │ │  ProgressRing 120/10 mint, center "16/20" (exposureOnly → "노출 20장")
│ │ (● 새 카드 11)(● 복습 6)(● 헷갈려요 3)       │ │  .fill chips lilac / sky / amber
│ │ ╭────────────────────────────────────────╮ │ │  streak card: GlassPanel tint --gold, padding 12
│ │ │ 🔥 8일째 (+1)      오늘 목표 20/20 ✓    │ │ │  flame scales 1→1.25→1 on +1; ✓ + gold when goalReachedNow
│ │ │ ▪▪▪▪▪▪○  이번 주 6/7                    │ │ │  weekDots
│ │ ╰────────────────────────────────────────╯ │ │
│ │ 이번 세션 약점                              │ │  Title 3 (hidden when weakest undefined)
│ │ SB · 오픈 대응 — 오답 3/4 · 퀴즈 55%        │ │  row → onRetryUnsure filtered to that bucket
│ │ 틀린 카드 4                                 │ │  Title 3 (hidden when 0)
│ │ K♦T♠ KTo   BB · BTN 오픈 대응        ╭콜╮  │ │  rows 48: mini cards sm + hand + title + badge sm; tap → sheet
│ │ A♠4♠ A4s   CO · BTN 3벳 대응         ╭4벳╮ │ │
│ │ … 2개 더                                    │ │  expands (max 6 visible)
│ │ 속도 어땠어요? (천천히)(딱 좋아요)(더 빠르게)│ │  firstSession only
│ │ ▓▓▓▓▓▓▓▓ 틀린 것만 다시 · 4장 ▓▓▓▓▓▓▓▓▓▓▓ │ │  primary xl (hidden when 0; then 한 번 더 is primary)
│ │ [   한 번 더   ]   [   퀴즈로 확인   ]       │ │  neutral lg ×2
│ │                홈으로                       │ │  ghost md
│ ╰────────────────────────────────────────────╯ │
│  ╭──────────────────────────────────────────╮  │  tab bar returns
│  │  ⌂ 홈    ▯▯ 훈련    ? 퀴즈    ▦ 차트     │  │
│  ╰──────────────────────────────────────────╯  │
└────────────────────────────────────────────────┘
```

Ring animates 0→value over 600 ms, then the goal line fills; `goalReachedNow` → ring `celebrate` + haptic
[30,60,30]; `streakIncremented` → flame pulse + [12,60,12]. `한 번 더` rebuilds with the same config;
`틀린 것만 다시` → `launch({target:'train', onlyKeys: unsureKeys, autostart:true})` with `autoAdvance=false`
for that session; `퀴즈로 확인` → `launch({target:'quiz', onlyKeys: sessionKeys (unsure first), autostart:true})`.
Speed feedback chips call `applySpeedPreset(prev/next preset)` and toast `속도를 바꿨어요`. When unsure = 0 the
caption reads `다 맞혔어요. 다음엔 새 카드를 더 섞을게요` (SRS semantics know/unsure unchanged; only the labels read 정답/오답). The summary scrolls if taller than the viewport.

### 5.7 퀴즈 (rounds of 10)

```
┌────────────────────────────────────────────────┐
│ 퀴즈                  (78%)(🔥 5)(최고 12)      │  idle: Large title + 3 .glass-clear stat pills 36 (useStats)
│ 덱 (전체)(오픈)(오픈 대응)(3벳 대응)(4벳/올인)(내 약점)│  same chips as trainer (shared DeckChips logic lives in quiz/)
│ 포지션 (전체)(UTG)(HJ)(CO)(BTN)(SB)(BB)          │
│ ▓▓▓▓▓▓▓▓▓▓▓▓ ▶ 10문제 시작 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  primary
│ ▸ 최근 실수 6                                   │  collapsed disclosure (stats.mistakes, last 20)
├──────────────── round (tab bar hidden) ─────────┤
│ ╭────────────────────────────────────────────╮ │
│ │ (✕)  ●●●●○○○○○○  4/10        정답 3 · 연속 3│ │  HUD capsule 44
│ ╰────────────────────────────────────────────╯ │
│ ╭────────────────────────────────────────────╮ │  position strip (.fill)
│ │ UTG  ▓HJ▓  CO   BTN ᴰ ▓SB▓  BB              │ │
│ ╰────────────────────────────────────────────╯ │
│ HJ가 오픈 레이즈. SB인 당신 차례입니다.          │  headline
│               ╭────╮╭────╮                     │  HandView (FitBox)
│               │ Q  ││ 10 │                     │
│               ╰────╯╰────╯                     │
│              Q♠ T♠ · QTs                       │
│                 어떻게 할래요?                   │  callout --ink-2 (before answer)
│ ╭── 폴드 ──╮  ╭── 콜 ──╮  ╭── 3벳 ──╮           │  CapsuleButton tone 'tint' --tint = --act-*, 60 high, equal widths
│ ╰──────────╯  ╰────────╯  ╰─────────╯           │  after answer: chosen = .glass-solid, correct = 2px mint ring
│ ╭────────────────────────────────────────────╮ │  feedback GlassPanel clear, fixed 132
│ │ ✓ 정답이에요 · 3벳 75% · 콜 25%              │ │  or "△ 부분 정답" amber / "✕ 아쉬워요 · 정답은 폴드" coral
│ │ SB는 콜 레인지가 좁아 3벳 위주로 플레이해요   │ │  reasoning[0]
│ │ [ 해설 ]                    [ ▓ 다음 ▓ ]    │ │  neutral md · primary md (auto after 1.5 s when correct && autoAdvance)
│ ╰────────────────────────────────────────────╯ │
└────────────────────────────────────────────────┘
```

Round source: `buildQueue({ size: 10, deck, positions, mode: 'quiz', onlyKeys? })` — due/weak first, then new
via `randomQuizStep`-equivalent chains (single steps). Grading unchanged (`grade.ts`): correct = `step.answer`,
partial = weight ≥ 0.4. Writes: `recordAnswer(kind, correct, mistake?)` (stats, unchanged) **and**
`rate(step, correct||partial ? 'know' : 'unsure', 'quiz', { partial })` **and** `logQuiz(correct)`. Haptics
12 / [30,40,30]. Round end → `SessionSummaryCard` with `mode:'quiz'` (`headline '퀴즈 끝!'`, known = correct+partial,
`onTrain` → `launch({target:'train', onlyKeys: wrongKeys, autostart:true})`). ✕ ends early with the partial summary.

### 5.8 차트

```
┌────────────────────────────────────────────────┐
│ 차트                              [내 기록 ◯ ]  │  Large title + Switch (P2 mastery overlay)
│ (오픈)(오픈 대응)(3벳 대응)(4벳 대응)(올인 대응)(콜드 4벳)│  ChipRow, sticky under title (.glass-strong bar when scrolled)
│ 나  (UTG)(HJ)(CO)(BTN)(SB)(BB)                   │  heroesFor(kind)
│ 상대 (HJ)(CO)(BTN)(SB)(BB)                       │  villainsFor — only when kindHasVillain
│ UTG · 앞에 아무도 없음 (오픈?)                    │  Title 2 (scenarioTitle)
│ ▬▬▬▬▬▬▬░░░░░░░░░░░░░░  오픈 18% · 폴드 82%       │  share bar 8px (act colors) + footnote (rangeShare)
│ ╭────────────────────────────────────────────╮ │  GlassPanel regular r-md padding 8
│ │ AA AKs AQs AJs ATs A9s A8s A7s A6s A5s …   │ │  RangeGrid (kept): cells r-xs, gap 2, labels ≥ 10px, highlight = 2px mint ring
│ │ AKo KK KQs …                               │ │  overlay (P2): mastered = 2px inner mint border; learning = amber dot; weak = coral dot; unseen = dim 60%
│ │ …                                          │ │
│ ╰────────────────────────────────────────────╯ │
│ ● 오픈 ● 콜 ● 3벳 ● 4벳 ● 올인 ● 폴드            │  legend
│ 요약: UTG는 가장 타이트하게…                     │  body --ink-2 (chart.summary)
│ [    이 상황으로 훈련하기 · 20장               ] │  neutral lg → launch({target:'train', deck:'scenario', scenarioId, autostart:true})
│  ╭──────────────────────────────────────────╮  │
│  │  ⌂ 홈    ▯▯ 훈련    ? 퀴즈    ▦ 차트     │  │
│  ╰──────────────────────────────────────────╯  │
└────────────────────────────────────────────────┘
```

Cell tap → `ExplanationSheet` with `stepFor(scenario, hand)`; sheet footer adds a text button
`이 핸드 헷갈려요로 표시` → `rate(step, 'unsure', 'chart')` + toast. Selection persisted in `sessionStorage`
(existing `selection.ts`). Missing chart → friendly empty panel (`hasChart` guard stays).

### 5.9 설정 (pushed)

```
┌────────────────────────────────────────────────┐
│ ‹ 뒤로                                          │  IconButton back 44 + label
│ 설정                                           │  Large title
│ 훈련                                           │  caption group
│ ╭────────────────────────────────────────────╮ │  inset grouped list, GlassPanel regular r-md, rows 52
│ │ 하루 목표              (10)(▓20▓)(40)(80)   │ │  chips 32
│ │ 세션 크기 기본          (10)(▓20▓)(40)       │ │
│ │ 기본 속도   천천히 │ ▓보통▓ │ 빠르게 │ 순간기억│ │  SegmentedControl 44
│ │ 노출 모드                               [◯ ] │ │
│ │ 직접 넘기기 (자동 진행 끄기)             [◯ ] │ │  = !autoAdvance
│ │ 혼합 빈도 표시                          [●] │ │
│ │ 플레이 가능 핸드 비율   ─────●────    60%   │ │  range 0–100 (interestingBias)
│ ╰────────────────────────────────────────────╯ │
│ 범위                                           │
│ ╭────────────────────────────────────────────╮ │
│ │ 포지션  (UTG)(HJ)(CO)(BTN)(SB)(BB)           │ │  multi ≥ 1 (settings.positions)
│ │ 상황    ☑ 오픈 ☑ 오픈 대응 ☑ 3벳 대응        │ │  check rows (settings.kinds, ≥ 1)
│ │         ☑ 4벳 대응 ☑ 올인 대응 ☐ 콜드 4벳    │ │
│ ╰────────────────────────────────────────────╯ │
│ 고급                                       ▸   │  disclosure: think 1–20 s / reveal 1–10 s (0.5 s steps) sliders → speedPreset 'custom'
│ 기기                                           │
│ ╭────────────────────────────────────────────╮ │
│ │ 진동 (Android)                           [●] │ │  hint "iOS에서는 지원되지 않아요"
│ │ 움직임 줄이기            시스템 설정 따름     │ │  read-only
│ ╰────────────────────────────────────────────╯ │
│ 데이터                                         │
│ ╭────────────────────────────────────────────╮ │
│ │ 차트 69개 · 준비 중 0개                      │ │  ALL_CHART_DEFS.length / missingScenarios().length
│ │ 100bb 6-max 캐시 기준 근사치예요             │ │
│ │ 사용법 다시 보기                          ▸ │ │  → coachSeen = 0 + toast "다음 세션에서 보여드려요"
│ │ 학습 기록 초기화                     (coral) │ │  → confirm Sheet → resetSrs(); resetProgress(); resetStats()
│ │ 설정 초기화                                 │ │  → confirm Sheet → resetSettings()
│ ╰────────────────────────────────────────────╯ │
└────────────────────────────────────────────────┘
```

Confirmations use `Sheet` (not `window.confirm`). The screen scrolls; bottom padding `24px + safe-bottom`.

### 5.10 First-run coach mark (3 steps, before the first card's timer starts)

```
┌────────────────────────────────────────────────┐
│ ▒▒▒▒▒▒▒▒▒ session behind: dim 55% + blur 8 ▒▒▒ │  backdrop; cards keep a radial spotlight cut-out (mask)
│ ▒▒▒▒▒╭────────────────────────────────╮▒▒▒▒▒▒▒ │  GlassPanel strong r-lg, width min(300, 100% − 40), centered
│ ▒▒▒▒▒│        ● ○ ○                   │▒▒▒▒▒▒▒ │  step dots
│ ▒▒▒▒▒│      ╭────╮  ☝ ◯               │▒▒▒▒▒▒▒ │  art 'hold': SVG card + finger + 32px pulsing ring (1.2 s ∞)
│ ▒▒▒▒▒│      │ A♠ │                    │▒▒▒▒▒▒▒ │
│ ▒▒▒▒▒│      ╰────╯                    │▒▒▒▒▒▒▒ │
│ ▒▒▒▒▒│  꾹 누르면 멈춰요               │▒▒▒▒▒▒▒ │  Title 3
│ ▒▒▒▒▒│  누르는 동안 해설이 올라오고,    │▒▒▒▒▒▒▒ │  body --ink-2
│ ▒▒▒▒▒│  손을 떼면 바로 이어져요.        │▒▒▒▒▒▒▒ │
│ ▒▒▒▒▒│  [ 건너뛰기 ]      [ ▓ 다음 ▓ ] │▒▒▒▒▒▒▒ │  ghost md · primary md
│ ▒▒▒▒▒╰────────────────────────────────╯▒▒▒▒▒▒▒ │
└────────────────────────────────────────────────┘
 step 2 · art 'choose': three action pills, the finger taps 콜 and a ✓ pops (1.8 s ∞)
         "버튼으로 골라요" / "버튼으로 액션을 고르면 바로 정답과 해설이 나와요. 틀린 카드는 곧 다시 보여드릴게요"
         shown when settings.coachSeen < COACH_VERSION (2); done / skip writes coachSeen = COACH_VERSION
 step 3 · art 'session': mini ProgressRing 0→20 (600 ms) — "20장이 한 세션이에요" / "끝나면 요약이 나와요. ✕는 언제든 저장하고 끝내요"
         [ 시작할게요 ] (no skip on the last step)
```

Trigger: TrainerScreen, when a session starts and `settings.coachSeen < 1` → render `<CoachMark>` over the
paused session; `onDone`/`onSkip` → `update({coachSeen: 1})` and resume. Replay from 설정. Additionally on the
first reveal of a fresh install (`progress.sessions === 0`) the chosen choice button flashes (`trainer-choice-flash`).

---

## 6. Training loop

### 6.1 Session model (`src/screens/trainer/sessionStore.ts`, owner B — module-level store, survives unmount)

```ts
export type SessionStatus = 'idle' | 'running' | 'paused' | 'summary';
export type Phase = 'think' | 'reveal';
export interface SessionConfig {
  deck: DeckId; positions: Pos[]; scenarioId?: string; onlyKeys?: string[];
  size: 10 | 20 | 40; speed: SpeedPreset; exposure: boolean; manual: boolean;   // manual = !settings.autoAdvance
}
export interface SessionCard {
  key: string; step: Step; cards: [Card, Card];
  origin: 'new' | 'due' | 'unsure' | 'requeue' | 'quizWrong';
  chainId?: number;                 // steps of one dealt hand share it (StepCrumbs)
  rating?: 'know' | 'unsure'; peeked?: boolean; flagged?: boolean; exposed?: boolean;
}
export interface SessionState {
  id: string; status: SessionStatus; config: SessionConfig;
  queue: SessionCard[]; index: number; phase: Phase;
  startedAt: number; activeMs: number;          // accumulated while running
  requeues: Record<string, number>;             // key → times requeued (max 2)
  holding: boolean; sheetOpen: boolean; settling: boolean;
}
export function useSessionStatus(): SessionStatus;           // for App (tab bar hide)
export function getSession(): SessionState | null;
export function startSession(config: SessionConfig): void;   // buildQueue → status 'running', coach mark may pause it
export function endSession(): SessionResult;                 // status 'summary'; writes progress.lastResult
export function discardSession(): void;                      // status 'idle'
```

State machine (replaces `useTrainerSession` internals; the hook keeps returning the same shape plus new fields):

```
idle ──start(config)──▶ running: card[i].think ──expire | tap──▶ card[i].reveal ──rate | expire | tap | ▶──▶ i+1
  ▲                        │ hold ⇄ overlay (timer frozen, peeked if think)      │ unsure → requeue at min(i+6, end) (≤2×)
  │                        │ ‖ → paused (tab bar back) ⇄ 계속                     │
  │                        ◀────────────────────── i+1 < queue.length ───────────┘  else ──▶ summary
  └──────── 홈으로 / 한 번 더 / 틀린 것만 / 퀴즈로 확인 (launch) ◀────────────────────────────┘
running = status==='running' && !holding && !sheetOpen && !coachOpen && !settling && !awaitsNext
awaitsNext = phase==='reveal' && (!quiet || manual)   // v2.2: choose mode never runs a reveal timer — `next()` (다음) only; `expire()` is a no-op there
```

`useTrainerSession(settings)` return shape: everything it returns today (`seq`-equivalent becomes `card`,
`step`, `stepIndex`→`index`, `phase`, `paused`, `holding`, `sheetOpen`, `waiting`, `running`, `durationMs`,
`timerKey`, `onExpire`, `next`, `prev`, `togglePause`, `setHolding`, `setSheetOpen`) **plus** `status`,
`queue`, `config`, `rate(r)`, `flagToggle()`, `revealNow()`, `endEarly()`, `result` (when summary).
`durationMs` = think/reveal from `SPEED_PRESETS[config.speed]` (custom → settings seconds × 1000), minimum 200.
Per card on leave: rated → `rate()`; flagged → `rate('unsure','button')`; else `recordExposure()`; always
`logCards(1, {rated, known})`. Session `activeMs` → `logSeconds` at summary. Restart when
`settings.positions`/`kinds` change only in `idle` (a running session keeps its queue).

### 6.2 Speed presets (exact ms, v2.1) and 노출 모드 — `SPEED_PRESETS` in `src/state/settings.ts`

| preset | label | think (choose) | reveal | expose dwell | card transition | cadence | ratings |
|---|---|---|---|---|---|---|---|
| `slow` | 천천히 | 12000 | 6000 | 6000 | slide 300 | 18.3 s | choice buttons |
| `normal` (default) | 보통 | 8000 | 5000 | 4000 | slide 300 | 13.3 s | choice buttons |
| `fast` | 빠르게 | 5000 | 3000 | 2500 | slide 220 | 8.2 s | choice buttons |
| `flash` | 순간기억 | 1500 | 1500 | 1200 | crossfade 120 | 3.1 s | 🤔 flag only (no choosing) |
| `custom` | 사용자 | `thinkSeconds×1000` (1–20 s) | `revealSeconds×1000` (1–10 s) | `revealSeconds×1000` | slide 300 | — | as normal |

`applySpeedPreset(p)` writes `{ speedPreset: p, thinkSeconds: think/1000, revealSeconds: reveal/1000 }`;
`load()` re-derives the seconds from the preset table whenever `speedPreset !== 'custom'`, so timings stored by an
older build never survive an update. Editing the 고급 sliders writes `speedPreset: 'custom'`. The countdown is
always visible next to the bar (`useRafTimer` exposes `remainingMs`, quantised to 100 ms): `6.4초` while choosing,
`다음까지 3.2초` in the reveal state, `일시정지` while held / paused. **노출 모드** (`exposureMode`, orthogonal):
no choose phase; hand + answer appear together for `expose` ms, then next; hold works. `manual` + 노출 = wait
for ▶. The setup caption for 순간기억 reads `답을 바로 보여줘요 · 선택 없음`.

### 6.3 Stage gesture — `src/screens/trainer/SwipeStage.tsx` (owner B; owns the fan + hand label, wraps timer / choices / answer slot)

v2.1 keeps exactly one stage gesture: **hold-to-pause**. Horizontal swipes, stamps, rotation, fly-out and
tap-to-reveal are gone; choosing is done with the `ChoiceButtons` capsules.

```
pointerdown (primary; ignored if target.closest('button, a')) → setPointerCapture; holdTimer = 180 ms
pointermove ≥ 8 px before the timer fires                     → not a hold (gesture dropped)
holdTimer fires                                                → onHoldStart(): store.setHolding(true) — overlay, timer frozen, peeked if choose phase, vibrate(8)
pointerup / pointercancel                                      → onHoldEnd() when holding; otherwise nothing
```

Element: `touch-action: manipulation; user-select: none`, contextmenu prevented. Keyboard (desktop testing):
1 / 2 / 3 = the choice buttons in order, Space / Enter = ▶ in the reveal state, Esc = sheets.

### 6.4 Focus decks and queue (implemented in `srs.ts`, consumed by trainer and quiz)

| Chip (`DeckId`) | kinds | SRS pool filter |
|---|---|---|
| 전체 `all` | `settings.kinds` | all |
| 오픈 `rfi` | `['rfi']` | kind = rfi |
| 오픈 대응 `vs_open` | `['vs_open']` | kind = vs_open |
| 3벳 대응 `vs_3bet` | `['vs_3bet']` | kind = vs_3bet |
| 4벳/올인 `vs_4bet_allin` | `['vs_4bet','vs_5bet','cold_4bet']` | those kinds |
| 내 약점 `weak` | kinds of the weak set | `lapses ≥ 1 || ease < 1.8 || quizWrongAt ≥ now − 30 d`; sorted lapses desc, due asc; chip count = size; **disabled when < 10** |
| (transient) `scenario` | that scenario only | scenarioKey = `scenarioId`; new cards dealt with `interestingBias` weighting via `dealForHero`-style sampling of the chart's learnable set |

Positions chips filter `hero`. A deck × positions with no charts → 시작 disabled with the §1 copy.

---

## 7. Data model additions (`src/state/`)

### 7.0 `settings.ts` additions (owner A; exact code, keep everything that exists)

```ts
export type SpeedPreset = 'slow' | 'normal' | 'fast' | 'flash' | 'custom';
export type DeckId = 'all' | 'rfi' | 'vs_open' | 'vs_3bet' | 'vs_4bet_allin' | 'weak' | 'scenario';
export interface Settings {
  /* existing fields unchanged */
  speedPreset: SpeedPreset;        // 'normal'
  exposureMode: boolean;           // false
  sessionSize: 10 | 20 | 40;       // 20
  dailyGoal: 10 | 20 | 40 | 80;    // 20
  coachSeen: number;               // 0 (bump the required value to re-show after a gesture change)
  lastDeck: DeckId;                // 'all' (never 'scenario')
  lastPositions: Pos[] | null;     // null = all of settings.positions
}
// DEFAULT_SETTINGS: thinkSeconds 8, revealSeconds 5 (= 보통 v2.1), plus the defaults above. `load()` merges partial storage and re-derives the seconds from the preset table (see §6.2).
export const SPEED_PRESETS: Record<Exclude<SpeedPreset, 'custom'>, { label: string; think: number; reveal: number; expose: number; transition: number }> = {
  slow:   { label: '천천히',  think: 6000, reveal: 4000, expose: 4000, transition: 300 },
  normal: { label: '보통',    think: 8000, reveal: 5000, expose: 4000, transition: 300 },
  fast:   { label: '빠르게',  think: 5000, reveal: 3000, expose: 2500, transition: 220 },
  flash:  { label: '순간기억', think: 1500, reveal: 1500, expose: 1200, transition: 120 },
};
export function applySpeedPreset(p: SpeedPreset): void;   // custom → no timing change
export function presetTiming(s: Settings): { think: number; reveal: number; expose: number; transition: number };
export const DECK_KINDS: Record<Exclude<DeckId, 'weak' | 'scenario' | 'all'>, ScenarioKind[]>;
```

### 7.1 `src/state/srs.ts` (owner C) — one record, three channels

```ts
import type { Step } from '../poker/trainer';
import type { Action, HandName, Pos, Scenario, ScenarioKind } from '../poker/types';

export type CardKey = string;                          // `${scenarioKey(scenario)}|${hand}` e.g. "vs_open:BB:BTN|KTo", "cold_4bet:CO|AQs"
export type Rating = 'know' | 'unsure';
export type RatingSource = 'swipe' | 'button' | 'quiz' | 'chart';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface SrsCard {
  key: CardKey; kind: ScenarioKind; hero: Pos; villain?: Pos; hand: HandName; answer: Action;
  state: CardState;                // 'new' = record exists (exposed) but never rated
  ease: number;                    // 1.3 .. 2.8, starts 2.3
  intervalDays: number;            // 0 until first 'know'; kept through a lapse (used for relearn halving)
  due: number;                     // epoch ms
  reps: number;                    // 'know' count
  lapses: number;                  // 'unsure' count (any source)
  exposures: number;               // every full showing, rated or not
  quizWrong: number; quizWrongAt?: number; lastWrongAction?: Action;
  lastRating?: Rating; lastSeen: number;
}
export interface SrsStore { version: 1; cards: Record<CardKey, SrsCard>; }
const KEY = 'holdem-flicker.srs.v1';   // write-through debounced 300 ms; flushed on pagehide

export function cardKey(step: Step): CardKey;
export function cardKeyOf(scenario: Scenario, hand: HandName): CardKey;
export function parseCardKey(key: CardKey): { scenario: Scenario; hand: HandName };   // cold_4bet: extras = { opener: positionsBefore(hero)[0], threeBettor: last before hero }
export function stepForKey(key: CardKey): Step | null;     // stepFor(parse) guarded by hasChart
export function getCard(key: CardKey): SrsCard | undefined;
export function recordExposure(step: Step): SrsCard;       // creates the record if missing (state 'new')
export function rate(step: Step, rating: Rating, source: RatingSource, opts?: { peeked?: boolean; partial?: boolean; now?: number }): SrsCard;
export function isDue(card: SrsCard, now?: number): boolean;      // card.due <= now
export function learnableHands(scenario: Scenario): HandName[];   // memoised per scenarioKey (see below)
export function universeSize(kinds: ScenarioKind[], positions: Pos[]): number;
export function counts(kinds?: ScenarioKind[], positions?: Pos[]): { learned: number; learning: number; fresh: number };
export interface WeakSpot { kind: ScenarioKind; hero: Pos; unsureRate: number; rated: number; quizAcc?: number; }
export function weakSpots(limit?: number, now?: number): WeakSpot[];   // buckets kind×hero, rated ≥ 8, sorted unsureRate desc; quizAcc from stats.byKind (kind level) when attempts ≥ 5
export function weakKeys(now?: number): CardKey[];                     // 내 약점 deck (§6.4)
export interface QueueRequest {
  size: number; deck: DeckId; positions: Pos[]; kinds: ScenarioKind[] /* settings.kinds, used by 'all' */;
  scenarioId?: string; onlyKeys?: CardKey[]; mode: 'train' | 'quiz'; interestingBias: number;
  activeDays: number /* progress: days with cards ≥ 1 */; now?: number;
}
export interface QueueItem { key: CardKey; step: Step; origin: 'new' | 'due' | 'unsure' | 'quizWrong'; chainId?: number; }
export interface QueueResult { items: QueueItem[]; counts: { new: number; due: number; unsure: number }; reason?: 'no_charts' | 'empty'; }
export function buildQueue(req: QueueRequest): QueueResult;
export function previewQueue(req: QueueRequest): QueueResult['counts'];   // same algorithm, no card dealing beyond counting (60-attempt cap)
export function useSrs(): number;      // version counter; components re-render on change
export function resetSrs(): void;
```

**Learnable set** (`learnableHands`): every hand with any non-fold weight > 0 in the chart, plus pure-fold hands
that are 4-neighbours (up/down/left/right in the 13×13 grid via `gridHand`) of a non-fold hand. Universe =
Σ learnable over `allScenarios()` filtered by kinds/positions and `hasChart`. Interior folds (72o UTG) still
appear from `nextHandSequence` and can be rated (user intent wins), but are not in the denominator.

**Scheduling rules** (`rate`, SM-2 trimmed; `d = 86_400_000`, `fuzz(key) = 1 + ((hash(key) % 21) − 10) / 100` applied to intervals ≥ 3 d):

| state | `know` | `unsure` |
|---|---|---|
| `new` | → `learning`, intervalDays 1, due now + 1 d, reps 1 | → `relearning`, intervalDays 0, due now + 10 min, lapses +1 |
| `learning` | → `review`, intervalDays 3, due now + 3 d × fuzz | → `relearning`, intervalDays 0, due now + 10 min, lapses +1 |
| `review` | intervalDays = min(60, max(intervalDays + 1, round(intervalDays × ease))) × fuzz; ease = min(2.8, ease + 0.05); due now + interval | → `relearning`; lapses +1; ease = max(1.3, ease − 0.2); intervalDays unchanged; due now + 10 min |
| `relearning` | → `review`, intervalDays = max(1, round(intervalDays × 0.5)), due now + interval; reps +1 | stays; lapses +1; ease = max(1.3, ease − 0.2); due now + 10 min |

Modifiers: `peeked` + `know` → treated as **exposure only** (no state change); `partial` (quiz weight ≥ 0.4) →
`know` without the ease bonus and interval × 0.8; quiz `unsure` → additionally `ease −0.1`, `quizWrong +1`,
`quizWrongAt = now`, `lastWrongAction`; `source 'chart'` (헷갈려요 from the chart sheet) = plain `unsure`.
`recordExposure`: `exposures +1`, `lastSeen = now`, state untouched. Every path sets `lastSeen`.

**Derived counts**: 학습 완료 (외웠어요) = `review && intervalDays ≥ 7`; 학습 중 (배우는 중) = `learning || relearning || (review && intervalDays < 7)`;
새 카드 = `max(0, universe − learned − learning)`.

**Queue building** (`buildQueue`, size N):

```
pool   = records matching deck/positions (or onlyKeys) with due ≤ now, excluding state 'new'
         order: relearning first (due asc) → quizWrongAt within 7 d → review/learning by overdue ratio (now−due)/interval desc
unsure = pool.filter(relearning) capped at ceil(N × 0.3)
due    = the rest of pool; reviews = unsure + due capped at ceil(N × 0.6)
newN   = N − reviews.length;  if activeDays < 7 → newN = min(newN, 10)
new    = onlyKeys ? [] : chains from nextHandSequence({positions, kinds: deckKinds, interestingBias}) (or scenario sampling for 'scenario')
         keep a chain's steps together (chainId); skip steps whose record exists and state ≠ 'new'; skip keys already queued;
         a chain may overflow N by ≤ 2; stop after 60 engine calls
fill   = if new < newN and the engine is exhausted → not-yet-due records sorted by due asc (앞당겨 복습, origin 'due')
order  = (1) first item is a review when any exist; (2) chains stay consecutive; (3) ≤ 3 new in a row; (4) ≤ 2 reviews in a row where possible;
         (5) no two consecutive items share scenarioKey unless in a chain; otherwise shuffled (seeded by now)
onlyKeys: items = keys in the given order (stepForKey, drop nulls), origin from record state, N = keys.length
quiz mode: no chains — each new item is a single random step of a dealt hand
reason: 'no_charts' when deck × positions has no chart; 'empty' when items.length === 0
```

Engine facts the builder relies on (current `src/poker/trainer.ts`): `nextHandSequence(opts, rng?)` returns
`steps: []` only when `feasiblePositions(opts)` is empty (e.g. positions `[BB]` + kinds `[rfi]`) — use
`feasiblePositions({positions, kinds: deckKinds, interestingBias})` as the `'no_charts'` check and to disable
시작; `randomQuizStep` throws in that case, so the quiz builder must check first. Pass a seeded `rng`
(`seedRandom` from `hands.ts` is test-only; in production use the default) so `previewQueue` and `buildQueue`
never diverge in tests. A chain = one `nextHandSequence` result; `chainId` = a per-queue counter.

### 7.2 `src/state/progress.ts` (owner C)

```ts
export interface DayLog { cards: number; rated: number; known: number; quiz: number; quizCorrect: number; seconds: number; sessions: number; }
export interface SessionResult {                       // written by trainer/quiz at summary time
  id: string; mode: 'train' | 'quiz'; startedAt: number; endedAt: number; activeMs: number;
  config: { deck: DeckId; positions: Pos[]; size: number; speed: SpeedPreset; exposure: boolean; manual: boolean };
  seen: number; rated: number; known: number; unsure: number; exposureOnly: boolean;
  byOrigin: { new: number; review: number; unsure: number };
  weakest?: { kind: ScenarioKind; hero: Pos; unsure: number; shown: number };
  unsureKeys: CardKey[]; allKeys: CardKey[];
  goalReachedNow: boolean; streakBefore: number; streakAfter: number;
}
export interface ProgressStore {
  version: 1; days: Record<string, DayLog>;   // dayKey → log, pruned to 400 days
  lastResult?: SessionResult;
}
const KEY = 'holdem-flicker.progress.v1';

export const DAY_BOUNDARY_HOURS = 4;                                   // 04:00 local: 1 a.m. still counts as "today"
export function dayKey(ts?: number): string;                           // local 'YYYY-MM-DD' of (ts − 4 h)
export function shiftDay(key: string, delta: number): string;
export function logCards(n: number, opts?: { rated?: number; known?: number; ts?: number }): void;
export function logQuiz(correct: boolean, ts?: number): void;          // quiz +1, quizCorrect +correct, cards +1 (a question is a card)
export function logSeconds(s: number, ts?: number): void;
export function logSession(): void;                                    // sessions +1 on today's log
export function setLastResult(r: SessionResult): void;
export interface ProgressView {
  today: DayLog; todayKey: string; days: Record<string, number>;       // dayKey → cards (for Heatmap)
  streak: number; bestStreak: number; lastGoalDay?: string; restDays: number; prevStreak: number;
  goalReachedToday: boolean; totalCards: number; activeDays: number; weekDots: boolean[]; lastResult?: SessionResult;
}
export function getProgress(goal: number, now?: number): ProgressView;
export function useProgress(goal: number): ProgressView;
export function heatLevel(cards: number, goal: number): 0 | 1 | 2 | 3 | 4;   // 0; 1–9 → 1; 10–(goal−1) → 2; goal–(2·goal−1) → 3; ≥ 2·goal → 4
export function levelName(learned: number): string;                          // 0–49 새싹 · 50–199 루키 · 200–499 레귤러 · 500–999 샤크 · 1000+ 크러셔
export function resetProgress(): void;
```

**Streak rules** (pure, recomputed on every read from `days` — no stored counter to drift):
goal day = `days[key].cards ≥ dailyGoal`. `streak` = count consecutive goal days ending today if today is a
goal day, else ending yesterday (today still in progress does not break it). `bestStreak` = longest run in
`days`. `lastGoalDay` = most recent goal day; `restDays` = today − lastGoalDay − 1 (0 when yesterday/today);
`prevStreak` = run ending at `lastGoalDay` (for the "3일 쉬었어요" headline when `restDays ≥ 2 && prevStreak ≥ 3`).
`goalReachedNow` in a result = today's cards crossed `dailyGoal` during that session. `weekDots` = 월…일 of the
current week (Monday start) goal-day flags. No freezes. `activeDays` = days with cards ≥ 1 (used by the
first-week new-card cap).

**What counts toward the goal**: every trainer card that leaves the screen (any mode, requeues included) and
every quiz answer. `rated`/`known` feed the ring's optional inner track and the heatmap tooltip's 알아요 %.

### 7.3 Stats (`src/state/stats.ts`) — unchanged

Quiz keeps calling `recordAnswer` (accuracy pills, 최근 실수). Home never reads it except `byKind` accuracy for
`weakSpots.quizAcc`. `Mistake[]` stays as the 퀴즈 disclosure list.

---

## 8. Motion, reduced motion, haptics

| Transition | What moves | Duration / easing |
|---|---|---|
| Think → reveal | AnswerSlot inner flips `rotateX(-90deg)→0` (perspective 800) + answer capsule `scale(.9)→1`; fan lifts 4 px and settles | 240 ms `--ease-spring` |
| Card → next card | old fan `translateX(-40%) rotate(-6deg) opacity→0` (180 ms `--ease-in`); new fan from `translateX(60%) scale(.92)` (300 ms `--ease-spring`, 60 ms overlap); `fast` 220 ms; `flash`/노출 crossfade 120 ms | per §6.2 |
| Hold overlay | `translateY(100%)→0` 260 ms `--ease-out`; backdrop 0→.35; release 180 ms `--ease-in`; stage behind `scale(.98)` | — |
| Sheet | `translateY(100%)→0` 420 ms `--ease-spring`; dismiss 220 ms `--ease-in` | — |
| Tab switch | content crossfade 200 ms; active pill `translateX` 320 ms `--ease-spring` | — |
| Tab bar hide/show | `translateY(140%)` 260 ms `--ease-in` / `--ease-out` | — |
| Settings push | `translateX(100%)→0` 320 ms `--ease-out`; back 240 ms `--ease-in` | — |
| Session start | setup fades + `scale(.96)`; HUD drops from `translateY(-12px)` | 320 ms `--ease-spring` |
| Summary card | `scale(.92)→1` + fade 320 ms spring; ring 600 ms; goal bar after ring; flame `scale 1→1.25→1` 400 ms on +1 | — |
| Ring / goal | `stroke-dashoffset` 600 ms `--ease-out`; `celebrate` pulse `scale 1→1.06→1` 420 ms | — |
| Chip select / segment | pill glide 320 ms `--ease-spring`; press `scale(.97)` 120 ms | — |
| Timer bar | width per rAF frame, no CSS transition (existing) | — |
| Coach mark | card crossfade 200 ms; art loops (ring pulse 1.2 s, choice tap 1.8 s) | — |

`@media (prefers-reduced-motion: reduce)`: every transform above becomes an opacity crossfade ≤ 150 ms;
the choice-button flash / shake are dropped and the reveal wash swaps instantly; rings
fill instantly; hold overlay has no blur on the stage behind; coach-mark loops are static frames. Keep the
existing global rule (`* { transition: none; animation: none }`) but scope it to `:not(.motion-safe)`? **No** —
replace it with the per-component rules above so the timer keeps working.

Haptics (`vibrate()` from settings; iOS Safari ignores `navigator.vibrate`, so every haptic has a visual twin):

| Event | Pattern (ms) | Visual twin |
|---|---|---|
| Reveal (not flash/노출) | 12 | answer flip |
| Hold engaged | 8 | HUD "일시정지" |
| 정답 choice | 10 | ✓ mark on the capsule |
| 헷갈려요 commit / flag | [18, 30, 18] | amber stamp / 🤔 badge |
| Quiz correct / partial / wrong | 12 / 12 / [30, 40, 30] | button tint flash |
| Session complete | [10, 40, 10, 40] | summary spring |
| Daily goal reached | [30, 60, 30] | ring celebrate + gold |
| Streak +1 | [12, 60, 12] | flame pulse |
| Tab switch, chips, coach mark | none | pill glide |

---

## 9. Accessibility

- Touch targets ≥ 44 × 44 (chips 36 high get 8 px vertical hit-slop via padding on the row); rating
  buttons 56; quiz answers 60; heatmap cells are not required targets (tap = tooltip only).
- Contrast on glass: `--ink` on the darkest realistic `.glass` composite ≥ 12:1; `--ink-2` ≥ 7:1; `--ink-3`
  ≥ 4.5:1 and only at ≥ 13 px; never `--ink-3` on `.glass-tint`. Text on tinted capsules ≥ 4.5:1 (allin uses
  `--ink-on-tint`). Verify each owner's screenshots with a contrast picker on three spots.
- Minimum text 12 px (range-grid cells 10 px, existing). Dynamic type: everything is px, but layouts must
  survive 120 % browser text zoom: fixed slots use `min-height` (AnswerSlot 148, feedback 132), lines are
  clamped (`-webkit-line-clamp`), chips scroll horizontally, FitBox scales the fan. No horizontal page scroll.
- `aria-live="polite"` on AnswerSlot and quiz feedback; `role="progressbar"` on TimerBar/ProgressRing;
  Sheet traps focus and restores it; CoachMark is `role="dialog" aria-modal`; every IconButton has a label;
  stamps are `aria-hidden`; rating result announced via a visually hidden live region ("알아요로 표시").
- Safe areas: `--safe-top` padding on every screen header; tab bar and sheets pad `--safe-bottom`.
- Keyboard equivalents for all gestures (§6.3) so the Playwright shot script and desktop QA can drive them.

---

## 10. Implementation plan — 6 owners, disjoint files

| Owner | Scope | Files (create/edit ONLY these) |
|---|---|---|
| **A · design system + shell** | tokens, glass, ui components, tab bar, nav, settings fields, sheet, app shell | `src/styles/global.css`, `src/styles/ui.css`, `src/styles/table.css` (color-token edits only), `src/components/ui/*` **except** `CoachMark.tsx`, `src/components/ExplanationSheet.tsx`, `src/App.tsx`, `src/main.tsx`, `src/state/nav.ts`, `src/state/settings.ts` |
| **B · trainer** | setup → session → summary, SwipeStage, HUD, hold overlay, session store, coach-mark trigger | `src/screens/TrainerScreen.tsx`, `src/screens/trainer/**`, `src/styles/trainer.css` |
| **C · home/progress + stores** | `srs.ts`, `progress.ts` (+ unit tests), HomeScreen | `src/state/srs.ts`, `src/state/progress.ts`, `src/state/__tests__/srs.test.ts`, `src/state/__tests__/progress.test.ts`, `src/screens/HomeScreen.tsx`, `src/screens/home/**`, `src/styles/home.css` |
| **D · quiz** | rounds of 10, SRS writes, quiz summary | `src/screens/QuizScreen.tsx`, `src/screens/quiz/**`, `src/styles/quiz.css` |
| **E · charts** | chips, grid panel, 훈련하기 launch, chart-sheet 헷갈려요, P2 overlay | `src/screens/ChartsScreen.tsx`, `src/screens/charts/**`, `src/components/RangeGrid.tsx`, `src/styles/charts.css` |
| **F · settings + coach mark** | pushed settings, confirm sheets, CoachMark component | `src/screens/SettingsScreen.tsx`, `src/styles/settings.css`, `src/components/ui/CoachMark.tsx`, `src/styles/coachmark.css` |

Cross-owner imports are allowed only through the APIs written in this spec (§3 nav, §4 components, §7 stores).
Do not commit stubs of another owner's file; until it lands, develop against the signature and rebase.

**Integration order**
0. **A** lands the foundation first (tokens + legacy aliases, `ui.css`, all ui components with visual
   fixtures, `nav.ts`, `settings.ts` additions, App shell with 4 tabs + placeholder Home/Settings). Everyone
   branches from this commit.
1. **C** lands `srs.ts` + `progress.ts` with tests (pure, no UI) — same day as 0; may land before 0.
2. **B**, **D**, **E**, **F** land independently after 0 + 1 (each rebased, `tsc` clean).
3. **C** lands HomeScreen (needs `lastResult` shape and the trainer's launch behaviour) after B.
4. **A** does the final integration pass: default tab logic, tab-bar hide sources, toast host, whole-app
   screenshot sweep, blur-budget audit.

**Verification (every owner, before finishing)**
1. `npx tsc --noEmit -p tsconfig.json` and `npm test` pass.
2. `npx vite build --outDir work/build-<owner> --emptyOutDir`, then
   `npx vite preview --outDir work/build-<owner> --port <port> --strictPort &` and
   `node scripts/shot.mjs http://localhost:<port>/holdem-flicker/ work/shot-v2-<owner>-<state>.png "tap=text=<탭>" wait=800`
   (steps: `tap=`, `wait=`, `hold=<selector>:<ms>`, `scroll=<px>`, `full=1`). Read every PNG and fix layout
   problems. Kill the preview server.

**Acceptance checklists (screenshots named `work/shot-v2-<owner>-<state>.png`)**

- **A**: `home-placeholder`, `tabbar-active-each` (4 shots, pill on the right item), `tabbar-hidden`,
  `sheet-half`, `sheet-full`, `ui-fixtures` (a `/#ui` dev route rendering every component in every tone/size —
  remove before final). Checks: legacy components render on the new ground; ≤ 3 blurred surfaces; 44 px
  targets; `@supports` fallback verified by toggling `backdrop-filter` off in devtools; settings storage from
  v1 loads with the new defaults merged.
- **B**: `setup`, `setup-launch-intent`, `think`, `reveal-correct`, `reveal-wrong`, `reveal-mixed`, `timeout`,
  `hold` (`hold=.trainer-stage:900`), `paused`, `flash`, `expose`, `manual-waiting`, `summary`,
  `summary-partial` (✕ path), `coach-1..3`, `empty-no-charts`. Checks: cadence 순간기억 ≈ 1.5 s measured with
  timestamps; choice buttons ≥ 56 px and grade correctly (✓ / △ / ✕, correct outlined); think timeout →
  시간 초과 + auto 'unsure'; peeked rule; requeue max 2; tab bar hidden while
  running and back on pause/summary; nothing scrolls during a session at 360 px and 430 px widths;
  `prefers-reduced-motion` path.
- **C**: unit tests for every row of the scheduling table, fuzz determinism, queue composition (30 % / 60 %
  caps, chains consecutive, ≤ 3 new in a row, first item review, onlyKeys order), day boundary at 03:59 vs
  04:01, streak with today-in-progress, prevStreak/restDays, heat levels. Shots: `home-empty`, `home-active`,
  `home-goal-done`, `home-streak-broken`, `heatmap-tap`. Checks: the three tiles + universe never negative;
  weak spots need rated ≥ 8; storage ≤ 1 MB after 5 000 rated cards (synthetic test).
- **D**: `quiz-idle`, `quiz-question-2opt`, `quiz-question-3opt`, `quiz-correct`, `quiz-partial`, `quiz-wrong`,
  `quiz-summary`, `quiz-mistakes-open`. Checks: each answer writes stats + srs + progress once; ✕ partial summary;
  onlyKeys launch from the trainer summary; 60 px buttons; tab bar hidden during a round.
- **E**: `charts-default`, `charts-villain`, `charts-cell-sheet`, `charts-empty`, `charts-overlay` (P2).
  Checks: chips sticky under the title, grid labels ≥ 10 px at 360 px, 훈련하기 launches a scenario deck,
  선택 persisted in sessionStorage.
- **F**: `settings`, `settings-advanced-open`, `settings-confirm-sheet`, `coach-fixture` (CoachMark rendered
  over a static stage via a dev fixture). Checks: speed segment writes think/reveal seconds; 고급 sliders flip
  to 사용자; kinds/positions cannot go below 1; 사용법 다시 보기 resets `coachSeen`; back gesture returns to the
  previous tab; no `window.confirm` anywhere.

**Cut order if time runs out** (first cut first): level names → chart mastery overlay → speed feedback
chips → heatmap tooltip row → 노출 모드 tap-flag (노출 becomes pure exposure) → in-session requeue → coach
steps 2–3 (keep hold; rely on the choice-button flash). **Never cut**: 4-tab floating glass bar, session size +
summary, speed presets with 순간기억, choice-button rating, shared SRS store, daily goal ring + streak,
hold-to-pause, coach step 1.
