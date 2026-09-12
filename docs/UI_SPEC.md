# UI spec — Holdem Flicker (mobile-only)

Preflop GTO memorization trainer. Korean UI. **Mobile only**: design for portrait phones 360–430px wide
(iPhone 13 = 390×844 is the reference). Desktop is irrelevant; the app is capped at 520px wide and centered.

## Non-negotiables
- Touch first: every control ≥ 44px tall, no hover-only behaviour, no tiny text (≥ 12px, body 14–15px).
- Respect safe areas (`var(--safe-top)`, `var(--safe-bottom)` in `src/styles/global.css`). No horizontal scroll ever.
- Cards use **only ♠ (black) and ♦ (red)**: suited hand = both cards same suit, offsuit/pair = one ♠ one ♦. Never use hearts/clubs.
- Korean labels only (poker terms: 오픈, 콜, 폴드, 3벳, 4벳, 올인, 포지션 names UTG/HJ/CO/BTN/SB/BB stay Latin).
- Dark felt theme via the CSS tokens in `src/styles/global.css` (read-only for you: add your own stylesheet instead, e.g. `src/styles/trainer.css`, imported by your component).
- Do not add dependencies. React 18 + TypeScript strict; `npx tsc --noEmit -p tsconfig.json` must pass with no unused locals.

## Engine API you build on (read the files, they are short)
- `src/poker/types.ts` — `Pos`, `Action`, `ScenarioKind`, `Scenario`, `Card`, labels (`ACTION_LABEL_KO`, `SCENARIO_LABEL_KO`, `SCENARIO_ACTIONS`, `POS_LABEL_KO`).
- `src/poker/hands.ts` — `dealCardsFor(hand)` → two `Card`s (♠/♦ only), `cardLabel`, `parseHandName`, `ALL_HANDS`, `gridHand`.
- `src/poker/range.ts` — `fullMix`, `primaryAction`, `rangeShare`.
- `src/poker/scenarios.ts` — `allScenarios`, `scenarioTitle`, `scenarioSituation`, `positionsBefore/After`, `heroInPosition`.
- `src/poker/data/index.ts` — `getChartDef`, `getChartCells`, `hasChart`, `missingScenarios`, `ALL_CHART_DEFS`. (Some charts are still being authored in parallel — always guard with `hasChart`; the trainer/quiz builders already skip missing ones.)
- `src/poker/trainer.ts` — `Step`, `SessionOptions`, `nextHandSequence(opts)` → `{hero, hand, steps}`, `randomQuizStep(opts)`, `stepFor(scenario, hand)`.
- `src/poker/explain.ts` — `explainStep(step)` → `Explanation` (Korean sections incl. `postflop` plan when the action is not fold).
- `src/state/settings.ts` — `useSettings()` → `[settings, update]`, `vibrate(ms)`. `src/state/stats.ts` — `useStats()`, `recordAnswer(kind, correct, mistake?)`, `resetStats()`.
- Shared components (already implemented, use them): `ActionBadge` (+ `actionLabel(action, kind, short)`), `TimerBar`, `ExplanationSheet` / `ExplanationBody`, `RangeGrid`, `PlayingCard`/`HandView`, `TableDiagram`.
- Map settings → session options: `{ positions: s.positions, kinds: s.kinds, interestingBias: s.interestingBias }`.

## File ownership (edit ONLY your files; create new files only inside your area)
| Owner | Files |
|---|---|
| cards | `src/components/PlayingCard.tsx` (+ `src/styles/cards.css`) |
| table | `src/components/TableDiagram.tsx` (+ `src/styles/table.css`) |
| trainer | `src/screens/TrainerScreen.tsx`, anything under `src/screens/trainer/`, `src/styles/trainer.css` |
| quiz | `src/screens/QuizScreen.tsx`, `src/screens/quiz/`, `src/styles/quiz.css` |
| charts | `src/screens/ChartsScreen.tsx`, `src/screens/charts/`, `src/components/RangeGrid.tsx`, `src/styles/charts.css` |
| settings | `src/screens/SettingsScreen.tsx`, `src/styles/settings.css` |

Keep the existing exported names and props of the stubs you replace — other owners import them.

## Component contracts
- `PlayingCard({ card: Card; size?: 'sm'|'md'|'lg' })` and `HandView({ cards: [Card, Card]; size?: 'sm'|'md'|'lg' })`. Realistic SVG playing card: viewBox 200×280, off-white face with faint gradient, rounded corners, thin edge, drop shadow; corner indices (rank above suit) top-left and bottom-right (rotated 180°); centre: A/K/Q/J = large ornate letter + suit; 2–T = proper pip layout. ♠ `var(--spade)`, ♦ `var(--diamond)`. Sizes: sm ≈ 44px wide, md ≈ 84px, lg ≈ min(40vw, 160px). `HandView` fans two cards (≈ −7° / +7°, second card overlapping ~30%) like a real hold'em hand.
- `TableDiagram({ scenario: Scenario; compact?: boolean })`. **Linear position strip** (no oval table — the user prefers a simple row): the six seats UTG → BB in preflop order, dealer marker on BTN, action tags under each seat, and a caption line like "앞 3명 폴드 · 뒤 1명 남음" plus a postflop position hint. Hero seat: gold ring + "나" label. Villain seats get action chips per scenario kind: `vs_open` villain "오픈"; `vs_3bet` hero "오픈", villain "3벳"; `vs_4bet` villain "오픈 → 4벳", hero "3벳"; `vs_5bet` hero "오픈 → 4벳", villain "3벳 → 올인"; `cold_4bet` `scenario.extras.opener` "오픈", `scenario.extras.threeBettor` "3벳"; `rfi` no villain. Seats that already folded (before hero, not villain) are dimmed with "폴드"; seats after hero are neutral. Height ≈ 150px compact / 190px normal, full width.
- `RangeGrid({ cells: ChartCells; highlight?: HandName; onSelect?(hand) })` — 13×13, mixed cells painted as proportional slices, pair diagonal outlined, legible 9–10px labels at 390px width.
- `ExplanationSheet({ step, explanation, onClose })` — bottom sheet (already implemented).

## Screens
### TrainerScreen (auto flashcards) — the core feature
Layout (top → bottom, fills the viewport, no scrolling): header row [hero position pill, step counter "1/3", pause/play button, "새 핸드" skip]; `TableDiagram compact`; situation line (`scenarioSituation`); big `HandView` centred with hand label (e.g. `A♠ 5♠ · A5s`); `TimerBar`; answer area (fixed height so layout doesn't jump): during **think** phase shows "생각해 보세요…"; during **reveal** phase shows `ActionBadge size=lg` + the first reasoning sentence + mix chips (e.g. `3벳 75% · 콜 25%` when `settings.showMixFrequencies`); footer hint "화면을 길게 누르면 타이머가 멈추고 해설이 보입니다".
Flow: `nextHandSequence` → iterate `steps`; each step: think phase `thinkSeconds` → reveal phase `revealSeconds` → next step (or new hand). Timer with `requestAnimationFrame`, accumulating only while running. `autoAdvance=false` → after reveal, wait for "다음" tap. Vibrate 12ms on reveal.
**Hold-to-pause**: `onPointerDown` on the stage (touch-action: none, contextmenu prevented) → `holding=true`: timer pauses, a semi-transparent explanation overlay slides up from the bottom showing `ExplanationBody` (answer + reasoning first; if in think phase this also reveals the answer — intended). `onPointerUp/Cancel/Leave` → resume, hide. Ignore pointerdown on buttons. Also: an explicit "해설" button opens the full scrollable `ExplanationSheet` and pauses until closed. Prev/next step buttons (◀ ▶). Restart when settings positions/kinds change. Empty state if no steps (charts missing).
### QuizScreen (active recall)
`randomQuizStep(opts)`: same visual stack (table, situation, cards), then answer buttons for `SCENARIO_ACTIONS[kind]` (order fold → aggressive), coloured with `--act-*`, ≥ 56px tall, labelled via `actionLabel`. On tap: correct if equals `step.answer` (also accept any action with weight ≥ 0.4 as "부분 정답" shown in amber); reveal badge + mix + one-line reason; "해설" opens `ExplanationSheet`; "다음" (or auto after 1.5s if correct and `settings.autoAdvance`). Header: accuracy %, streak, best streak (`useStats`). Record with `recordAnswer`. Collapsible "최근 실수" list (last 20 mistakes with scenario title, hand, chosen vs answer). Vibrate 12ms / [30,40,30] wrong.
### ChartsScreen (reference)
Chip selectors: kind (all 6), hero, villain (only valid combos; see `allScenarios`). `RangeGrid` for `getChartCells`; below: shares per action ("오픈 45%" etc. from `rangeShare`), the chart `summary`, legend. Tap a cell → `ExplanationSheet` with `stepFor(scenario, hand)` + `explainStep`. Missing chart → friendly empty state. Remember last selection in `sessionStorage`.
### SettingsScreen
Panels: 포지션 (multi-select chips, ≥1), 상황 종류 (multi-select chips with `SCENARIO_LABEL_KO`), 타이머 (think 1–10s, reveal 1–8s range inputs with value labels), 자동 진행 switch, 플레이 가능 핸드 비율 (interestingBias 0–100%), 혼합 빈도 표시 switch, 진동 switch, 데이터 (chart count, `missingScenarios().length`, disclaimer: 100bb 6-max cash 기준 근사치), 기록 초기화 / 설정 초기화 buttons (confirm via `window.confirm`).

## Verification (do this before you finish)
1. `npx tsc --noEmit -p tsconfig.json` — must pass.
2. Visual check on a phone viewport: `npx vite build --outDir work/build-<owner> --emptyOutDir` then `npx vite preview --outDir work/build-<owner> --port <your port> --strictPort &` and `node scripts/shot.mjs http://localhost:<port>/holdem-flicker/ work/shot-<owner>.png "tap=text=<탭 이름>" wait=800` (steps: `tap=<selector>`, `wait=<ms>`, `hold=<selector>:<ms>`, `scroll=<px>`, `full=1`). Look at the PNG (Read tool) and fix layout problems. The script exits 2 and prints page errors if the page throws. Kill your preview server when done.
