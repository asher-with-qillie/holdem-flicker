# 자리별 보기 (HandAtlas) — 구현 스펙 v1

> 기능: **같은 카드인데 포지션에 따라 선택이 달라지는 것과 그 이유를 한 화면에서 보는 기능**
> 바탕: 심사 1위 안 「자리별 보기 (HandAtlas) — 한 손패, 74개 자리를 한 화면에」 + 심사단이 접목하라고 한 아이디어 + 심사단이 찾은 결함 수정.
> 이 문서의 숫자는 전부 현재 차트(`src/poker/data/*`)에서 다시 계산해 확인한 값입니다(2026-10-02, 169패 × 74차트).

---

## 1. 한 줄 요약과 학습 목표

**한 줄 요약.** 패 하나(예: KJo)를 고르면 그 패가 앉을 수 있는 74칸이 한 장의 시트에 자리 순서대로 칠해지고, 칸을 누르면 "이 자리에서는 왜 답이 달라지는가"를 **차트에서 계산한 숫자 + 이미 검수된 자리 문장 + 그 칸의 기존 해설**로만 보여 줍니다.

**학습 목표 — 다 쓰고 나면 이걸 말할 수 있어야 합니다.**
1. 패에는 고정된 값이 없고 **자리에서의 값**만 있다. (KJo는 UTG에서 절반, HJ부터 항상 오픈)
2. 그 값을 정하는 셀 수 있는 지표가 있다 — **뒤에 남은 사람 수**(5·4·3·2·1명)와 **오픈 레인지 폭**(18·21·29·46·46%). 사람이 줄수록 넓어진다.
3. 오픈을 맞았을 때는 **누가 오픈했는가**가 같은 지표다 — UTG는 18%만 오픈해 세고, BTN은 46%를 오픈해 약한 패가 많다.
4. **SB는 따로다** — 뒤에 BB 한 명뿐이고 플랍 이후 항상 먼저 액션하며, 오픈 대응에서는 3벳 아니면 폴드 위주다.
5. **BB는 림프를 맞으면 폴드가 없다** (체크 아니면 레이즈).
6. 생기지 않는 상황이 있다 — 오픈하지 않는 자리에서는 3벳 대응이 생기지 않는다.

학습 장치는 세 가지입니다: **계산된 한 줄 결론(thesis)** → **자리 스트립/삼각형 + 숫자 두 줄** → **마지막 자기 질문 + 다른 칸만 골라 내는 퀴즈 버튼**.

---

## 2. 진입점

공통 상태: 새 모듈 `src/state/atlas.ts`(모듈 스토어, `useSyncExternalStore`, nav.ts와 같은 모양).

```ts
// src/state/atlas.ts
export interface AtlasIntent {
  hand: HandName;
  origin?: Scenario;        // 들어온 칸 — 민트 링 + 미리 선택
  compare?: Scenario;       // 오답에서 들어온 경우 — 하늘색 링 + 비교 자동 실행
  mode?: 'atlas' | 'pick';  // 'pick' = 손패 고르기 화면부터 (기본 'atlas')
}
export function openAtlas(intent: AtlasIntent): void;   // 훈련 세션이 running이면 togglePause() 하고 pausedByAtlas=true
export function closeAtlas(): void;                     // pausedByAtlas && status==='paused' 이면 togglePause() 로 재개
export function useAtlas(): AtlasIntent | null;
```

`App.tsx`가 루트에서 `<HandAtlasSheet />`를 한 번만 렌더합니다(Sheet는 portal이라 위치 무관). **규칙: 아틀라스는 원래 열려 있던 시트를 대체합니다.** 모든 진입점은 `onClose()`로 자기 시트를 먼저 닫고 `openAtlas()`를 부릅니다. 그래서 화면 위에 시트는 항상 **한 장**입니다(REDESIGN_SPEC §1 "glass never more than two deep" 준수, 심사 결함 "3겹 시트" 해결).

| # | 진입점 | 훅 지점 (정확한 파일/컴포넌트) | 동작 |
|---|---|---|---|
| 1 | 해설 본문의 링크 줄 **「이 패, 다른 자리에서는? ›」** (44px) | `src/components/ExplanationSheet.tsx` `ExplanationBody`에 선택 prop `onAcross?: () => void` 추가. 결론 블록 바로 아래, `왜?` 위에 `<button className="ui-explain__across">` 렌더. **prop이 없으면 아무것도 렌더하지 않음.** | 호출자가 `onAcross={() => { onClose(); openAtlas({hand: step.hand, origin: step.scenario}); }}` |
| 1a | 차트 탭 셀 시트 | `src/screens/charts/CellSheet.tsx` → `ExplanationBody onAcross` 전달 | 위와 같음 |
| 1b | 훈련 reveal 해설 시트 | `src/screens/trainer/SessionView.tsx` 256행 `ExplanationSheet` → `onAcross` 전달. `ExplanationSheet`도 `onAcross?` prop을 받아 `ExplanationBody`에 넘김. **252행 held 시트(길게 누르기, pointer-events none)에는 prop을 넘기지 않음** → 링크 줄 없음. | 오답(`card.grade === 'wrong'` 이고 `card.chosenAction`)이면 `compare: nearestCellWithAction(step.scenario, step.hand, card.chosenAction)` 도 넘김 |
| 1c | 퀴즈 해설 시트 | `src/screens/quiz/QuizRound.tsx` 199행 `ExplanationSheet` → `onAcross`. `grade === 'wrong' && chosen` 이면 `compare: nearestCellWithAction(scenario, step.hand, chosen)` | 코치 규칙 "이 패를 UTG라고 생각하고 접은 건 아닌가요?"를 그림으로 보여 주는 입구 |
| 1d | 퀴즈 요약 틀린 문제 시트 | `src/screens/quiz/QuizSummary.tsx` 44행 `ExplanationBody` → `onAcross` (+ `q.chosen` 으로 compare) | |
| 1e | 세션 요약 행 / 홈 지난 세션 행 | `src/screens/trainer/SummaryView.tsx` 101행, `src/screens/home/LastSession.tsx` 107행 `ExplanationSheet` → `onAcross` | |
| 2 | 훈련 reveal 차트 시트 푸터 두 번째 버튼 **「이 패 자리별」** | `src/screens/trainer/RevealChart.tsx` footer: `display:flex; gap:8` 로 `전체 차트 보기` 와 나란히 (라벨 각 ≤ 7자, 360px 통과). | `onClose(); openAtlas({hand: step.hand, origin: step.scenario})` — 일시정지는 `openAtlas`가 처리 |
| 3 | 차트 탭 헤더 IconButton **「핸드로 보기」** | `src/screens/ChartsScreen.tsx` `charts__head` 의 `내 기록` 스위치 왼쪽에 `IconButton icon={<IconGrid/>} label="핸드로 보기"` | `openAtlas({hand: lastHand ?? 'KJo', mode: 'pick'})` → 손패 고르기 화면부터 |
| 4 | 아틀라스 안 **「다른 패」** 푸터 버튼 | `HandAtlasSheet` 내부 | 시트 본문을 손패 고르기(RangeGrid)로 바꿈 — **새 시트를 띄우지 않음** |
| 5 | 아틀라스 안 "HJ부터 새로 들어오는 패" 이름 | `HandAtlasSheet` 내부 | 그 패로 아틀라스 전환(`origin` 유지: 같은 좌표) |

**코치 탭 진입점은 만들지 않습니다** (COACH_SPEC: 코치는 차트를 읽어 주지 않는다 — 심사단 3명 모두 삭제 권고).

---

## 3. 화면 설계 (360px)

컨테이너: `Sheet detent="full"` (92vh, 본문 스크롤, sticky footer). 내용 폭 328px(거터 16). 새 스타일시트 `src/styles/atlas.css`. 모든 글은 `PlainText`를 거쳐 용어집 밑줄이 붙습니다(`TermScope resetKey={hand}`).

```
┌──────────────────────────────────────────┐ 360
│ ━━━━                                     │ Sheet grabber
│ KJo · 자리별                              │ .ui-sheet__title (Sheet title prop)
│ [K♠][J♦]  오프수트 브로드웨이              │ PlayingCard sm ×2 (dealCardsFor) + HAND_CLASS_KO · .t-footnote.ink-2
│ ╭──────────────────────────────────────╮ │
│ │ KJo는 UTG에서 절반만, HJ부터 항상      │ │ GlassPanel variant="tint" tint=var(--mint) radius="md" padding=12
│ │ 오픈합니다.                            │ │ .t-headline — rfiThesis(atlas).text
│ ╰──────────────────────────────────────╯ │
│ 오픈 · 앞에 아무도 없음                     │ .t-headline (섹션 제목)
│  UTG     HJ     CO    BTN  ┆  SB         │ .atlas__seats .t-caption.ink-2 — SB 앞 점선 구분(.atlas__sb-divider)
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐┆┌────┐       │ SeatStrip: 5 타일 56×56, gap 8 → 56×5+32 = 312 ≤ 328
│ │▓▓░░│ │오픈│ │오픈│ │오픈│┆│오픈│       │ 배경 = cellBackground(mixList) (RangeGrid와 동일한 좌→우 분할)
│ │오픈50│ │    │ │ D  │ │    │┆│    │       │ 라벨 = actionLabel(primary, kind, true) + 비중<100이면 " 50"
│ └────┘ └────┘ └────┘ └────┘┆└────┘       │ 폴드 타일 --rg-fold + ink-2 글자. BTN에 .pstrip__dealer 'D' 재사용
│ 뒤에  5명    4명    3명    2명  ┆ 1명      │ caption row (seatsBehind) .t-caption tnum
│ 오픈  18%   21%   29%   46%  ┆ 46%      │ caption row (rangeShare rfi, 'raise')
│ 뒤에 남은 사람이 줄수록 넓게 오픈합니다.      │ 고정 레버 (UTG→BTN) .t-footnote.ink-2
│ SB는 BB 한 명만 남아 따로 봅니다.           │ 고정 SB 문장 (항상 표시)
│ HJ부터 새로 들어오는 패: K8s K7s QJo KTo    │ newcomersAt(firstAlways ?? firstAny) ≤ 9, 이름은 버튼(.atlas__hand)
│   T8s 97s 54s                             │
│ ┆ UTG에서는 절반만 오픈합니다. HJ에서는   ┆ │ ← AtlasDetail (선택 타일 아래, GlassPanel variant="clear" radius="md")
│ ┆ 오픈합니다.                            ┆ │   ① compare 결론
│ ┆ UTG는 뒤에 5명, HJ는 4명이 남습니다.    ┆ │   ② 레버 (숫자 계산)
│ ┆ UTG는 오프수트 K를 KQo까지 항상, KJo는  ┆ │   ③ rowBoundary (rfi만)
│ ┆ 절반만 오픈합니다.                      ┆ │
│ ┆ [오픈 50%] [폴드 50%]                   ┆ │   ④ 혼합 칩 (ActionBadge sm + %)
│ ┆ 오픈하세요. 큰 카드 두 장이라 탑페어를… ┆ │   ⑤ 그 칸의 easy.oneLiner (그대로)
│ ┆ 해설 전체 보기 ▾                        ┆ │   ⑥ 인라인 펼침 → ExplanationBody + 헷갈려요 버튼 (시트 추가 없음)
│                                           │
│ 오픈 대응 · 누가 오픈했나   [오픈에|4벳까지] │ .t-headline + SegmentedControl size=44 (vs_open ⇄ vs_4bet)
│       상대→ UTG   HJ    CO   BTN   SB      │ 열 머리 2줄: 자리 + 오픈 % (.t-caption)  ← 접목: 상대 폭을 축에 찍음
│             18%  21%   29%   46%   46%    │
│ 나 HJ  [폴드]                              │ SeatTriangle: 라벨 36 + 52×5 + 6×4 = 320 ≤ 328, 칸 52×44
│    CO  [폴드][폴드]                         │ 왼쪽 아래 삼각형 = 15칸 (상대가 나보다 앞일 때만 존재)
│    BTN [폴드][콜50][콜75]                   │ 라벨 11px bold, 라벨은 short form만 (actionLabel(.., true))
│    SB  [폴드][폴드][3벳50][3벳 ]             │ 미도달 칸 = "—" .atlas__cell--gated (opacity .35)
│    BB  [ 콜 ][ 콜 ][콜75][3벳50][3벳75]      │
│ BB는 이미 1bb를 냈고 마지막 차례라 가장      │ 선택된 행(기본: origin 행, 없으면 BB)의 seatLevers 상수 ≤ 2줄
│ 넓게 콜합니다.                             │
│ 4벳까지 가면: 4곳 전부 폴드                 │ 세그먼트 반대쪽의 sectionDigest 한 줄 (.t-footnote.ink-2)
│                                           │
│ 3벳 대응 · 내 오픈에 3벳   [3벳에|올인까지]  │ SegmentedControl (vs_3bet ⇄ vs_5bet)
│   3벳한 상대→ HJ    CO   BTN   SB    BB     │
│ 나 UTG [폴드][폴드][폴드][폴드][폴드]        │ 오른쪽 위 삼각형 15칸. 미도달 칸은 "—"
│    HJ        [폴드][폴드][폴드][폴드]        │
│    CO             [폴드][폴드][폴드]         │
│    BTN                  [콜75][콜75]        │
│    SB                        [콜50]         │
│ 콜 3곳 · 폴드 12곳                         │ sectionDigest
│ 올인까지 가면: 생기지 않는 상황              │
│ — 는 오픈하지 않는 자리라 생기지 않는 상황   │ 미도달 칸이 하나라도 있으면 범례 한 줄
│                                           │
│ 림프 대응 · 앞에서 한 명이 림프  [사람 작성]  │ .t-headline + <span class="atlas__tag">사람 작성</span>  ← 접목
│  HJ     CO    BTN    SB    BB             │
│ [폴드] [폴드] [레이즈50] [폴드] [체크]       │ 5 타일. BB 타일은 --act-check 바탕 + "체크" 글자 (회색 금지)
│ BTN만 절반 레이즈 · BB는 폴드 없이 체크     │ sectionDigest
│ 림프는 솔버가 하지 않는 플레이라 … 맞아요.   │ DISCLAIMER.vs_limp (공용 모듈) .t-footnote.ink-3
│                                           │
│ ▸ 콜드 4벳 · 4곳 전부 폴드                  │ 전부 폴드면 접힌 한 줄(탭하면 4타일 펼침), 아니면 펼친 스트립
│                                           │
│ 다음에 KJo를 받으면:                        │ selfQuestion(atlas) .t-callout
│ 내 자리가 HJ보다 앞인가요? UTG라면 절반만    │
│ 오픈합니다.                                │
├──────────────────────────────────────────┤
│ [ 이 패로 퀴즈 · 12문제 ]  [ 다른 패 ▦ ]    │ .ui-sheet__footer: CapsuleButton primary(flex 1) + neutral
└──────────────────────────────────────────┘
```

**첫 화면(탭 전)에 보이는 칸: 5 + 15 = 20칸 + thesis.** 나머지는 스크롤.

### 재사용 컴포넌트/클래스
- `Sheet`(detent full, footer), `GlassPanel`, `SegmentedControl`(44), `CapsuleButton`, `Chip`, `ActionBadge sm short`, `PlayingCard sm`, `RangeGrid`(손패 고르기), `PlainText/TermScope`, `IconButton/IconGrid`, `.pstrip__dealer`, `.rgrid__cell--hl` 링 모양(복제해 `.atlas__cell--sel`), `--rg-fold`, `--act-*`, `--heat-1..4`, `.t-*`, `.ink-2/3`, `.tnum`.
- `RangeGrid.tsx`: `cellBackground` **export**(지금 private), `paint?: (hand) => string | undefined` prop 추가(손패 고르기 색칠. 주면 `cells` 대신 이 색을 씀).

### 새 컴포넌트 (`src/screens/atlas/`)
- `HandAtlasSheet.tsx` — 루트. `useAtlas()` 로 intent 읽음. 상태: `hand`, `selected?: AtlasCell`, `compare?: AtlasCell`, `seg: {open: 'vs_open'|'vs_4bet', three: 'vs_3bet'|'vs_5bet'}`, `view: 'atlas'|'pick'`, `expanded: boolean`(해설 전체).
- `SeatStrip.tsx` — `{ cells: AtlasCell[]; selected?; compare?; captions?: Array<{label; values: string[]}>; sbDivider?: boolean; onSelect(c) }`.
- `SeatTriangle.tsx` — `{ section: AtlasSection; colHeader?: string[]; selected?; compare?; onSelect(c) }`. 왼쪽 아래/오른쪽 위 모양은 `section.layout === 'tri-lower' | 'tri-upper'` 로.
- `AtlasDetail.tsx` — 선택 칸 아래 블록(§3 ①~⑥).
- `HandPicker.tsx` — `RangeGrid paint={entrySeatPaint}` + 범례 "UTG부터 · HJ부터 · CO부터 · BTN부터 · SB에서만 · 오픈 안 함" + `onSelect(hand)`.

### 새 CSS (`src/styles/atlas.css`)
```css
.atlas { display:flex; flex-direction:column; gap:14px; }
.atlas__hand { display:flex; align-items:center; gap:10px; }
.atlas__section { display:flex; flex-direction:column; gap:8px; }
.atlas__section-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.atlas__tag { font-size:var(--fs-caption); line-height:1; padding:3px 7px; border-radius:var(--r-capsule); background:rgba(255,255,255,.10); color:var(--ink-2); }
.atlas__strip { display:grid; grid-template-columns:repeat(5, 56px); gap:8px; justify-content:start; }
.atlas__strip--4 { grid-template-columns:repeat(4, 56px); }
.atlas__sb-divider { border-left:1px dashed rgba(255,255,255,.22); margin-left:-4px; padding-left:4px; }
.atlas__cell { --rg-fold:rgba(255,255,255,.09); position:relative; aspect-ratio:1; border:0; border-radius:var(--r-xs); background:var(--rg-fold);
  display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#fff; text-shadow:0 1px 1px rgba(0,0,0,.45); overflow:hidden; }
.atlas__cell--fold { color:var(--ink-2); text-shadow:none; }
.atlas__cell--check { background:var(--act-check); }
.atlas__cell--gated { opacity:.35; color:var(--ink-3); }
.atlas__cell--sel { z-index:2; outline:1px solid var(--mint); outline-offset:1px; box-shadow:0 0 0 5px color-mix(in srgb, var(--mint) 22%, transparent); }
.atlas__cell--cmp { z-index:2; outline:1px solid var(--sky); outline-offset:1px; box-shadow:0 0 0 5px color-mix(in srgb, var(--sky) 22%, transparent); }
.atlas__cell--origin::after { content:''; position:absolute; top:2px; right:2px; width:5px; height:5px; border-radius:50%; background:var(--mint); }
.atlas__caption { display:grid; grid-template-columns:28px repeat(5, 56px); gap:8px; font-variant-numeric:tabular-nums; color:var(--ink-2); }
.atlas__tri { display:grid; grid-template-columns:36px repeat(5, 52px); gap:6px; }
.atlas__tri .atlas__cell { aspect-ratio:auto; height:44px; }
.atlas__tri-h { font-size:var(--fs-caption); color:var(--ink-2); text-align:center; line-height:1.15; }
.atlas__detail { display:flex; flex-direction:column; gap:6px; }
.atlas__mix { display:flex; gap:6px; flex-wrap:wrap; }
.atlas__hands { display:flex; flex-wrap:wrap; gap:4px 8px; }
.atlas__hand-btn { min-height:28px; padding:0 6px; border:0; background:transparent; color:var(--mint); font-weight:600; }
.atlas__question { color:var(--ink); }
.ui-explain__across { display:flex; align-items:center; justify-content:space-between; min-height:44px; width:100%; border:0; background:transparent; color:var(--mint); font-weight:600; padding:0; }
```
`scripts/layout-audit.mjs` 를 360/390/430에서 돌려 `.atlas__cell`(44px 미만 터치 타깃)을 근거 목록에 추가합니다(`.rgrid__cell`과 같은 사유).

### 상호작용 규칙
- **탭 1회** = 선택(민트 링). 선택되면 그 섹션 바로 아래 `AtlasDetail` 이 열리고, 비교 상대는 **자동으로** 정해집니다(§5.4 anchor 규칙).
- **선택된 상태에서 같은 행 또는 같은 열의 다른 칸 탭** = 비교 상대 교체(하늘색 링). 그 밖의 칸 탭 = 새 선택. 같은 칸 재탭 = 해제. 두 축이 다른 칸은 비교 후보가 아니므로 "서로 다른 상황입니다" 같은 막다른 결과가 생기지 않습니다.
- **미도달 칸("—") 탭** = 한 줄만: `"{hero}에서 오픈하지 않으니 이 상황은 생기지 않습니다."` (gate kind별 문장, §5.2 G).
- **세그먼트 전환**(오픈에 ⇄ 4벳까지, 3벳에 ⇄ 올인까지)은 같은 (나, 상대) 기하를 유지. 선택 칸이 있으면 같은 좌표의 칸이 선택됨.
- **해설 전체 보기** = 블록 안에서 `ExplanationBody`(onAcross 없이) 인라인 펼침 + `이 핸드 헷갈려요로 표시`(`rate(step,'unsure','chart')`, CellSheet와 같은 토스트). 새 시트 없음.
- **origin**(들어온 칸)은 민트 점(`--origin`)으로 항상 표시. `compare` intent가 있으면 열리자마자 origin 선택 + compare 링 + AtlasDetail.
- **퀴즈 버튼**: `launch({ target:'quiz', onlyKeys: atlasQuizKeys(atlas, {max:12}), autostart:true })` 후 `closeAtlas()`. 키가 0개면 버튼 비활성 + 라벨 "다를 게 없는 패".
- 닫기(backdrop/Esc/grabber) → `closeAtlas()` → 훈련이 아틀라스가 멈춘 것이면 재개.

---

## 4. 데이터 API (`src/poker/atlas.ts`, 순수 — React·storage·clock 없음)

```ts
import type { Action, ActionMix, HandName, Pos, Scenario, ScenarioKind } from './types';
import type { HandClass } from './explain';
import type { CardKey } from '../state/srs';           // 타입만 (srs.ts 는 react 를 import 하므로 값은 가져오지 않음)

export const CORE_SEATS: readonly Pos[] = ['UTG','HJ','CO','BTN'];   // '…부터' 문법이 성립하는 축. SB 는 항상 따로.

export interface AtlasCell {
  scenario: Scenario;                 // cold_4bet 은 extras 없이 (차트는 hero 만 봄)
  key: CardKey;                       // `${scenarioKey(scenario)}|${hand}` — srs.cardKeyOf 와 같은 식 (문자열 조립을 여기서 복제, 테스트로 동일성 보장)
  mix: ActionMix | undefined;
  mixList: Array<{ action: Action; weight: number }>;   // fullMix
  primary: Action;                    // primaryAction — trainer.ts 와 같은 동점 규칙
  weightClass: 'always' | 'most' | 'half' | 'some';     // §5.1 W
  reachable: boolean;                 // §4 isReachable
  gate?: { kind: ScenarioKind; needed: Action };
  note?: string;                      // getChartDef(scenario).notes?.[hand]
  evidence: 'solver' | 'human';       // vs_limp = 'human'
}
export interface AtlasSection {
  kind: ScenarioKind;
  layout: 'strip' | 'tri-lower' | 'tri-upper';
  rows: Pos[];                        // hero 축
  cols?: Pos[];                       // villain 축 (삼각형)
  cells: AtlasCell[];                 // 5 / 15 / 5 / 4
}
export interface RfiProfile {
  pattern: 'always' | 'never' | 'sbOnly' | 'entry' | 'half' | 'partial' | 'irregular';
  firstAny: Pos | null;               // CORE_SEATS 중 raise 비중 > 0 인 첫 자리
  firstAlways: Pos | null;            // CORE_SEATS 중 raise 비중 ≥ 1 인 첫 자리
  monotone: boolean;                  // CORE_SEATS 순서로 raise 비중 비감소
  sbDiffers: boolean;                 // primary(SB) !== primary(BTN)
  seats: Array<{ pos: Pos; behind: number; share: number; raise: number; primary: Action }>;  // 5개. share = rangeShare(rfi:pos,'raise'), raise = 이 패의 raise 비중
}
export interface HandAtlas {
  hand: HandName; cls: HandClass;
  rfi: RfiProfile;
  sections: Record<ScenarioKind, AtlasSection>;
}

export function handAtlas(hand: HandName): HandAtlas;                  // 74번의 getChartCells 조회(캐시됨). 패별 memo.
export function isReachable(s: Scenario, hand: HandName): { ok: boolean; gate?: AtlasCell['gate'] };
export function rfiProfile(hand: HandName): RfiProfile;
export function newcomersAt(seat: Pos, prefer?: HandName): HandName[]; // firstAny === seat 인 패. 정렬: prefer 와 같은 줄 → 같은 클래스 → ALL_HANDS 순. prefer 자신은 제외.
export function entrySeat(hand: HandName): Pos | 'SB' | null;          // 손패 고르기 색칠용: firstAny, 없으면 SB 에서 raise>0 이면 'SB', 아니면 null
export function nearestCellWithAction(from: Scenario, hand: HandName, action: Action): Scenario | null;
//   같은 kind 안에서 primary === action 인 가장 가까운 칸. 우선순위: hero 축(같은 villain, |POS_INDEX 차| 최소, 동률이면 앞자리) → villain 축(같은 hero). reachable 한 칸만. 없으면 null.
export function rowBoundary(s: Scenario, hand: HandName): RowBoundary; // §5.1 R
export function atlasQuizKeys(atlas: HandAtlas, opts?: { max?: number }): CardKey[];
//   후보 = reachable 칸 ∩ (그 섹션에 primary 가 2종 이상) . 우선순위: weightClass !== 'always' → 섹션 안 소수 primary → 나머지. 기본 max 12. vs_limp BB(check) 칸 제외.

/* ---------- 레버(자리 사실) ---------- */
export type LeverId = 'behind' | 'openWidth' | 'threebetWidth' | 'position' | 'bbPrice' | 'sbRaiseOrFold' | 'bbFree' | 'blind3bet' | 'lateOpener' | 'earlyOpener';
export interface Lever { id: LeverId; text: string; nums: number[]; constant: boolean }  // constant = 숫자 없는 고정 문장
export function seatLevers(s: Scenario): Lever[];                      // 한 칸의 레버 (predicate 통과한 것만, 순서 §5.3)
export function differingLevers(a: AtlasCell, b: AtlasCell): Lever[];  // 두 칸에서 값이 다른 레버만, 숫자 두 개를 한 문장에 (≤ 2개)

/* ---------- 문장: 구조 먼저, 텍스트는 마지막 ---------- */
export interface Claim { scenario: Scenario; action: Action; weight: AtlasCell['weightClass'] }
export interface Line { text: string; claims: Claim[]; nums: number[]; source: 'computed' | 'constant' | 'verbatim' }
export function rfiThesis(atlas: HandAtlas): Line[];                   // 1~2 문장 (§5.2 T)
export function selfQuestion(atlas: HandAtlas): Line;                  // §5.2 Q
export function sectionDigest(sec: AtlasSection): Line;                // §5.2 D
export function seatSummary(atlas: HandAtlas, hero: Pos): Line;        // 전치 읽기, 절 ≤ 3 (§5.2 S)
export function compareCells(a: AtlasCell, b: AtlasCell): Line[];      // [결론(1~2문장)] + differingLevers 텍스트 + (rfi 면 rowBoundary 두 줄). 같은 primary 면 결론 = "둘 다 {act}입니다." + 혼합 차이 1줄
export function compareAxis(a: Scenario, b: Scenario): 'hero' | 'villain' | 'none';   // 같은 kind 이고 hero 또는 villain 중 하나만 다를 때

/* ---------- src/poker/explain.ts — export 추가 (동작 변경 없음) ---------- */
export const seatsBehind: (hero: Pos) => number;          // 5 - POS_INDEX
export function heroIsIP(s: Scenario): boolean;
export function villainChart(s: Scenario): { cells: ChartCells; action: Action } | null;
export const pctInt: (x: number) => string;
export const OPEN: Record<HandClass, string[]>;            // 카피 감사 테스트용 (§7)

/* ---------- src/poker/priceFacts.ts (신규, scenarioLines 의 가격 숫자를 한 곳으로) ---------- */
export interface PriceFacts { toCall: string; pot: string; needPct?: number }
export function priceFacts(s: Scenario): PriceFacts | null;
//   vs_open BB vs SB {2bb, 6bb, 33} · BB 그 외 {1.5bb, 5.5bb, 27} · SB {2bb, 6bb} · 그 외 {2.5bb, 6.5bb}
//   vs_3bet 블라인드 {8bb, 22bb, 36} · 그 외 {5bb, 16.5bb, 30} · vs_4bet {-, -, 30} · vs_5bet {-, -, 38~40 → needPct 39}
//   scenarioLines 는 이 값을 읽어 **지금과 글자가 같은** 문장을 만든다(골든 테스트로 고정).

/* ---------- src/poker/range.ts ---------- */
export const AGGRESSION_ORDER;   // export (불변식 테스트용)

/* ---------- src/screens/charts/disclaimer.ts (신규) ---------- */
export const SOLVER_NOTE: string; export const DISCLAIMER: Record<ScenarioKind, string>;   // ChartsScreen 에서 옮김, ChartsScreen 은 import

/* ---------- src/components/RangeGrid.tsx ---------- */
export function cellBackground(mix: Array<{ action: Action; weight: number }>): string | undefined;
export interface RangeGridProps { /* 기존 */ paint?: (hand: HandName) => string | undefined }
```

### 각 함수가 차트에서 계산하는 것
- `isReachable` — `buildSteps`의 게이트를 그대로 복제(답 = **primary**): `vs_3bet`·`vs_5bet` ⇒ `primary(rfi:hero) === 'raise'`; `vs_5bet` 추가로 `primary(vs_3bet:hero:villain) === 'fourbet'`; `vs_4bet` ⇒ `primary(vs_open:hero:villain) === 'threebet'`. 나머지 kind 는 항상 ok. (`buildSteps`가 rfi 를 세션에서 뺐을 때 쓰는 "비중>0" 게이트는 쓰지 않는다 — 앱이 가르치는 답은 primary 다.)
- `rfiProfile` — core 4자리의 raise 비중 벡터로 pattern 결정: 전부 ≥1 → `always`; 전부 0 → SB 비중>0 이면 `sbOnly` 아니면 `never`; 비감소가 아니면 `irregular`(현재 0패, 테스트가 막음); `firstAlways` 없음 → `partial`; `firstAny === firstAlways` → `entry`; 그 외 `half`. 실측: always 45 · entry 41 · half 12(KJo ATo 등) · partial 5(Q8o J8o T8o 98o K6o) · never 71 · sbOnly 1(K6o → partial 보다 sbOnly 가 우선: core 전부 0이면 sbOnly) · irregular 0. SB≠BTN primary: J4s(BTN 오픈→SB 폴드), K6o(BTN 폴드→SB 절반).
- `rowBoundary` — 같은 줄(페어 줄 / 같은 높은 카드·같은 수티드 여부)을 킥커 내림차순으로 훑어 `contWeight = 1 − rest 비중`의 `{monotone, lastFull, lastAny}`. 실측 1850줄 중 비단조 33줄, **전부 수티드 A 줄**(A5s·A4s > A8s~A6s). 비단조 줄은 문장 생략.
- `seatLevers` 숫자: `behind = 5 − POS_INDEX[hero]`, `openWidth = rangeShare(rfi:villain,'raise')`, `threebetWidth = rangeShare(vs_open:villain:hero,'threebet')`, `position = heroInPosition(hero, villain)`. 실측 오픈 폭 18/21/29/46/46, 3벳 폭(상대→오프너): SB vs BTN 17 · BB vs BTN 13 · SB vs CO 13 · BB vs SB 14 · BB vs UTG 6 · HJ vs UTG 5.

---

## 5. 이유 생성 규칙

### 5.0 원칙 (출처 4종, 자유 작문 경로 없음)
| source | 무엇 | 어디서 |
|---|---|---|
| `computed` | 숫자 프레임에 차트에서 계산한 값을 끼운 문장 | `atlas.ts` 템플릿 (아래 §5.2) |
| `constant` | 손패와 무관한 자리 문장. **explain.ts에 이미 있고 tests/explain.test.ts를 통과한 문장과 글자가 같아야 함**(테스트가 `explainStep` 출력과 대조) | `seatLevers` |
| `verbatim` | 그 칸의 `explainStep(step).easy.oneLiner`, `chart.notes[hand]` | AtlasDetail |
| — | **손패×자리 인과 템플릿("KJo는 AK·KQ에 도미네이트되니까…")은 만들지 않는다.** 엔진에 그런 모델이 없다. 그 질문은 데이터(새로 들어오는 패, 줄의 경계, 혼합 타일, 메모)와 기존 해설로 답한다. | |

### 5.1 계산 사실 (공식)
| 기호 | 공식 |
|---|---|
| `P(c)` | `primaryAction(cells[hand])` |
| `W(c)` weightClass | p = mixList[0].weight. `always` ⇔ p ≥ 0.999 · `half` ⇔ mixList[1] 존재하고 \|p − mixList[1].weight\| < 0.01 (동점) 또는 p ≤ 0.5 · `most` ⇔ 0.5 < p < 0.999 · `some` ⇔ 그 외(쓰이지 않음, 안전망) |
| `behind(h)` | 5 − POS_INDEX[h] (rfi·vs_open·vs_limp·cold_4bet 에서만 의미; vs_3bet/4bet/5bet 는 헤즈업 → 레버 후보 아님) |
| `share(seat)` | `rangeShare(rfi:seat, 'raise')` → pctInt |
| `tb(v,h)` | `rangeShare(vs_open:v:h, 'threebet')` → pctInt |
| `ip(c)` | `heroInPosition(hero, villain)` |
| `R(s, hand)` | rowBoundary (§4) |
| `N(seat)` | newcomersAt |
| `D(sec)` | reachable 칸의 primary 별 개수, 혼합(weightClass≠always) 개수 |

### 5.2 템플릿 (한국어 원문, 키)
조사 표: 액션 뒤 `과/와`·`을/를` — 콜·3벳·4벳·오픈·올인(받침) → 과/을, 레이즈·체크·폴드(모음) → 와/를. 자리 뒤 주격 조사는 `seatSubject`(BTN이 / 그 외 가), 보조사는 explain.ts `seat(p,'는')` 규칙(BTN은 / 그 외 는).

**W. 비중 수식어** (`weightWord[W][context]`)
| W | 결론 프레임 안 | 다이제스트 안 |
|---|---|---|
| always | `{act}합니다` | `{act}` |
| most | `주로 {act}합니다` | `주로 {act}` |
| half, 2순위 = fold/check | `절반만 {act}합니다` | `절반만 {act}` |
| half, 2순위 ≠ fold | `{act}{과/와} {act2}{을/를} 반반 섞습니다` | `{act}·{act2} 반반` |

**T. rfi thesis** (`rfiThesis`, 1문장 + 선택 1문장)
| pattern | 문장 |
|---|---|
| always | `{hand}는 어느 자리에서든 오픈합니다.` |
| never | `{hand}는 어느 자리에서도 오픈하지 않습니다.` |
| sbOnly | `{hand}는 SB에서만 {W(SB) 수식}오픈합니다.` (K6o → "K6o는 SB에서만 절반만 오픈합니다.") |
| entry | `{hand}는 {firstAny}부터 오픈합니다.` + (firstAny ≠ UTG) `앞에서는 폴드입니다.` |
| half | `{hand}는 {s₁}에서 {w₁}, …, {firstAlways}부터 항상 오픈합니다.` — s₁…= firstAny 부터 firstAlways 앞까지의 자리, wᵢ = `절반만` / `{pct}만` |
| partial | `{hand}는 {s₁}에서 {w₁}, {s₂}에서 {w₂} 오픈합니다.` (전부 열거, '부터' 금지) |
| irregular | 자리 열거 `{hand}는 {s₁}·{s₂}에서만 오픈합니다.` ('부터'·'어디서든' 금지) |
| + SB 절 | `sbDiffers` 이면 뒤에 `SB에서는 {W(SB) 수식}{P(SB)}합니다.` (J4s → "SB에서는 폴드합니다.") |
| + 두 번째 문장 | pattern ∈ {always, never} 이면 vs_open 섹션의 D 를 붙임: 모든 reachable primary 가 같으면 `오픈을 맞으면 어디서든 {act}합니다.`, 아니면 `오픈을 맞으면 {D 문장}입니다.` |

조사: `{hand}는` — 손패 이름은 모두 영문/숫자로 끝나 "는"으로 고정(앱의 explain.ts `hp()`도 같은 처리).

**D. sectionDigest** (≤ 30자)
- reachable 칸 0 → `생기지 않는 상황`
- 전부 같은 primary → `{n}곳 전부 {act}` (+ 혼합 k>0 → ` · 절반만 {k}곳`)
- 그 외 → primary 개수 내림차순 `{act} {n}곳 · {act2} {m}곳 · 폴드 {f}곳` (3개까지, 폴드는 항상 맨 뒤)
- vs_limp 전용: BB primary 가 check 면 `체크 1곳` 대신 ` · BB는 폴드 없이 체크`; 레이즈가 BTN 한 곳뿐이고 half 면 `BTN만 절반 레이즈`.
- non-fold 칸 ≤ 3 → 뒤에 칸 이름을 붙인 두 번째 Line: `{act} {n}곳: BTN vs SB · BTN vs BB · SB vs BB` (strip 이면 자리 이름만).

**S. seatSummary** (전치 읽기, 절 ≤ 3, ' · ' 로 연결, 전체 ≤ 45자)
`{hero}에서 {hand}: {rfi절} · {vs_open절} · {vs_3bet절}` — 절이 없으면 생략.
- rfi절: `{W 수식}오픈` / `폴드`
- vs_open절 (villain 축 단조 — CI 불변식): 첫 non-fold villain v₁ → `{v₁} 오픈부터 {act}`; primary 가 또 바뀌는 v₂ → `, {v₂} 오픈부터 {act2}`; 전부 같으면 `오픈에는 {act}`; v₁ 칸이 half 면 ` (절반만)` 대신 `{v₁} 오픈에는 절반만 {act}` 로 바꿈.
- vs_3bet절: 같은 규칙, `3벳에는`/`{v} 3벳부터`.
- hero 가 BB 이고 vs_limp primary check → 세 번째 절을 `림프엔 체크` 로.

**C. compareCells 결론** (compareAxis ≠ 'none' 일 때만 호출됨)
- hero 축: `{B}에서는 {wB}{actB}합니다. {A}에서는 {wA}{actA}합니다.` (B = 더 뒷자리 / 더 공격적인 쪽을 먼저)
- villain 축: `{vB} 오픈에는 …` / `{vB} 3벳에는 …` / `{vB} 4벳에는 …` / `{vB} 올인에는 …`
- 같은 primary → `둘 다 {act}입니다.` + (혼합이 다르면) `{X}에서는 {2순위 act}{을/를} {pct} 섞습니다.`
- 이 결론 뒤에 `differingLevers` 텍스트(≤ 2), rfi 면 `R` 두 줄.

**R. rowBoundary 문장** (rfi 섹션, 선택 칸과 비교 칸 각 1줄, monotone 일 때만)
`{seat}는 {줄이름}{을/를} {lastFull}까지 {lastAny≠lastFull ? '항상, ' + lastAny + '는 ' + w + ' ' : ''}오픈합니다.`
줄이름: `포켓페어` / `수티드 {K}` / `오프수트 {K}`. 수티드 A 줄은 비단조라 생략(테스트가 보장).

**L. 레버 문장** (`seatLevers`, predicate, 출처)
| id | predicate | 단일 칸 문장(상수/계산) | 두 칸 차이 문장 |
|---|---|---|---|
| behind | kind ∈ {rfi, vs_open, vs_limp, cold_4bet}, hero ≠ BB | `뒤에 {n}명이 남아 있습니다.` (계산) | `{A}는 뒤에 {nA}명, {B}는 {nB}명이 남습니다.` |
| openWidth | villain 있고 rfi:villain 차트 있음 (vs_open·vs_4bet) | `{V}는 전체의 약 {p}%로 오픈합니다.` (= explain.ts 문장) | `{VA}는 {pA}%, {VB}는 {pB}%를 오픈합니다.` (\|Δ\| ≥ 2pt 일 때만) |
| threebetWidth | vs_3bet·vs_5bet | `{V}는 전체의 약 {p}%로 3벳합니다.` | `{VA}는 {pA}%, {VB}는 {pB}%를 3벳합니다.` (\|Δ\| ≥ 2pt) |
| position | villain 있음, kind ≠ vs_5bet | `플랍 이후 내가 나중에 액션합니다.` / `…먼저 액션합니다.` (상수, explain.ts positionReason) | `{VB} 상대로는 플랍 이후 내가 나중에, {VA} 상대로는 먼저 액션합니다.` |
| earlyOpener | vs_open, villain ∈ {UTG,HJ} | `앞자리라 레인지가 강합니다.` (상수) | (openWidth 와 함께) |
| lateOpener | vs_open, villain ∈ {CO,BTN,SB} | `뒷자리라 약한 패가 많이 섞여 있습니다.` (상수) | 한쪽만 late 면 두 상수를 나란히 |
| bbPrice | vs_open, hero = BB | `BB는 이미 1bb를 냈으니 1.5bb만 더 내고 약 5.5bb 팟을 봅니다.` (villain=SB 면 2bb/6bb; `priceFacts` 로 생성) + `마지막 차례라 스퀴즈 걱정 없이 가장 넓게 콜합니다.` | hero 축에서 한쪽만 BB |
| sbRaiseOrFold | vs_open, hero = SB | `SB는 콜하면 BB의 스퀴즈와 포지션 불리가 겹칩니다.` + `그래서 3벳 아니면 폴드 위주로 대응합니다.` | hero 축에서 한쪽만 SB |
| bbFree | vs_limp, hero = BB | `나는 이미 1bb를 냈으니 공짜로 플랍을 봅니다.` | 한쪽만 BB |
| blind3bet | vs_3bet·vs_5bet | villain 블라인드: `{V}의 3벳은 밸류와 블러프가 섞입니다.` / 아니면 `{V}의 3벳은 밸류 위주입니다.` | 한쪽만 블라인드일 때 두 문장 |
| sbOpen | rfi, hero = SB | `SB는 BB 한 명만 남아 따로 봅니다.` (신규 상수 1개 — 스트립 아래 고정) | — |

**레버 우선순위**(두 칸에서 값이 다른 것만, 최대 2): position > behind > bbPrice/sbRaiseOrFold/bbFree > blind3bet > openWidth/threebetWidth > early/lateOpener. 같은 값인 레버는 절대 비교 문장에 나오지 않는다(심사 결함: "둘 다 인포지션"인데 포지션 이유를 붙이는 일 금지). **차이 나는 레버가 0개면 결론 + 메모 + 해설 전체 보기만** 보여 주고 이유를 지어내지 않는다.

**Q. selfQuestion**
| pattern | 문장 |
|---|---|
| entry | `다음에 {hand}를 받으면: 내 자리가 {firstAny}{이나 SB}인가요? 아니면 폴드입니다.` (SB 가 오픈이면 "이나 SB" 포함) |
| half | `다음에 {hand}를 받으면: 내 자리가 {firstAlways}보다 앞인가요? {firstAny}라면 {w} 오픈합니다.` |
| always, vs_open 전부 같은 act | `다음에 {hand}를 받으면: 앞에 오픈한 사람이 있나요? 있으면 {act}, 없으면 오픈입니다.` |
| always, 그 외 | `다음에 {hand}를 받으면: 앞에 오픈한 사람이 있나요? 누가 했나요?` |
| never/sbOnly/partial | `다음에 {hand}를 받으면: 내가 BB인가요? 아니면 폴드입니다.` (partial 은 `{seat}라면 {w} 오픈합니다.` 로 끝) |

**G. 미도달 칸 문장** (`gate.kind`)
`rfi:raise` → `{hero}에서 오픈하지 않으니 이 상황은 생기지 않습니다.` · `vs_3bet:fourbet` → `{hero}에서 4벳하지 않으니 올인을 맞을 일이 없습니다.` · `vs_open:threebet` → `{villain} 오픈에 3벳하지 않으니 4벳을 맞을 일이 없습니다.`

### 5.3 조립 순서 (AtlasDetail)
1. (rfi strip 타일이면) `seatSummary(atlas, hero)` 한 줄 — "내가 BTN이면" 시점.
2. `compareCells(selected, anchor)` 결론 1~2문장.
3. 차이 레버 ≤ 2줄 (+ rfi 면 rowBoundary 2줄).
4. 혼합 칩: mixList 전부 `ActionBadge sm short` + `{pct}` (3분할 혼합도 전부 보임 — 심사 결함 해결).
5. 선택 칸의 `easy.oneLiner` (verbatim).
6. `note` (verbatim, 라벨 "차트 메모", 해요체 그대로 — 스타일 린트 제외).
7. `evidence === 'human'` 이 둘 중 하나라도 있으면 `DISCLAIMER.vs_limp` 한 줄(무조건).
8. `해설 전체 보기 ▾` → ExplanationBody 인라인.

**anchor 자동 규칙**(심사 결함 "애매한 anchor" 해결 — 고정 우선순위): rfi strip → `firstAlways ?? firstAny` 의 타일, 선택이 그 타일이면 바로 앞 자리(UTG 면 HJ). 삼각형 → ① 같은 열(hero 축)에서 primary 가 다른 가장 가까운 reachable 칸(동률이면 앞자리) ② 없으면 같은 행(villain 축) 같은 규칙 ③ 없으면 결론 `어느 자리에서든 {act}입니다.` 만. 림프/콜드 strip → ① 과 같음.

### 5.4 길이·말투 (PLAIN_KO_STYLE)
- 결론 문장 ≤ 30자 × 최대 2문장, 레버 문장 ≤ 30자, thesis 문장 ≤ 30자, 다이제스트 ≤ 30자, seatSummary ≤ 45자(절 3개), selfQuestion 두 문장 각 ≤ 30자.
- 어미 `~합니다 / ~입니다` 만. `~해요/~거든요` 금지(메모 인용 제외). 느낌표·이모지 금지. C단계 금지어(솔버·GTO·에퀴티·EV·콤보·폴라·리니어·양극화) 금지 — 단 DISCLAIMER 원문의 "솔버"는 공용 모듈 원문이라 예외.
- 숫자는 `18%`, `5명`, `3곳`, `12문제` 네 종류만. 한 문장에 괄호 0개.

### 5.5 차트와 모순되지 않음을 보장하는 규칙
모든 문장은 `Line { text, claims, nums }` 로 **구조를 먼저** 만들고 텍스트는 마지막에 렌더합니다. 테스트(§7)가 (a) 모든 `claim` 을 `primaryAction`/`weightClass` 로 재유도, (b) 텍스트에서 정규식으로 뽑은 `자리 + 액션` 쌍이 `claims` 와 1:1 대응, (c) 텍스트의 모든 숫자가 `nums` 에 있고 `nums` 가 공식 값과 일치, (d) `부터`·`어디서든`·`까지` 는 각각 단조/균일/단조줄 조건에서만, (e) `constant` 문장은 `explainStep` 출력 집합의 원소임을 확인합니다. 통과하지 못하는 문장은 생성 경로가 없습니다.

### 5.6 완성 예시 (현재 차트에서 재계산한 값, 전부 검증됨)

**① KJo (오프수트 브로드웨이)** — rfi UTG 오픈50/폴드50 · HJ CO BTN SB 오픈
- thesis: `KJo는 UTG에서 절반만, HJ부터 항상 오픈합니다.`
- 캡션: 뒤에 5·4·3·2명 ┆ 1명 / 오픈 18·21·29·46% ┆ 46% / `HJ부터 새로 들어오는 패: K8s K7s QJo KTo T8s 97s 54s`
- UTG 타일 선택(anchor HJ): `UTG에서 KJo: 절반만 오픈 · —` → `HJ에서는 오픈합니다. UTG에서는 절반만 오픈합니다.` / `UTG는 뒤에 5명, HJ는 4명이 남습니다.` / `오픈 레인지는 UTG 18%, HJ 21%입니다.` / `UTG는 오프수트 K를 KQo까지 항상, KJo는 절반만 오픈합니다.` / `HJ는 오프수트 K를 KJo까지 항상, KTo는 절반만 오픈합니다.` / [오픈 50%][폴드 50%] / `오픈하세요. 큰 카드 두 장이라 탑페어를 자주 만듭니다.`
- 오픈 대응 BB 행: UTG 콜 · HJ 콜 · CO 콜75 · BTN 3벳50 · SB 3벳75. BB×BTN 선택(anchor: 같은 행 가장 가까운 다른 primary = CO): `BTN 오픈에는 3벳과 콜을 반반 섞습니다. CO 오픈에는 주로 콜합니다.` / `CO는 29%, BTN은 46%를 오픈합니다.` / 메모 `KJo는 3벳과 콜을 반반 섞어요. …`. 사용자가 UTG 칸을 비교로 지정하면: `BTN 오픈에는 3벳과 콜을 반반 섞습니다. UTG 오픈에는 콜합니다.` / `UTG는 18%, BTN은 46%를 오픈합니다.` / `앞자리라 레인지가 강합니다. 뒷자리라 약한 패가 많이 섞여 있습니다.`
- 다이제스트: 3벳 대응 `콜 3곳 · 폴드 12곳` + `콜 3곳: BTN vs SB · BTN vs BB · SB vs BB` · 4벳까지 `4곳 전부 폴드` · 올인까지 `생기지 않는 상황` · 림프 `BTN만 절반 레이즈 · BB는 폴드 없이 체크` · 콜드 4벳 `4곳 전부 폴드`
- selfQuestion: `다음에 KJo를 받으면: 내 자리가 HJ보다 앞인가요? UTG라면 절반만 오픈합니다.`
- 퀴즈 12문제: rfi:UTG, vs_open BB:BTN, BB:CO, BTN:HJ, BTN:CO, SB:CO, BB:SB, vs_3bet BTN:SB, BTN:BB, SB:BB, vs_limp:BTN, vs_open:SB:BTN (혼합·소수 먼저)

**② 76s (수티드 커넥터)** — rfi 전 자리 오픈
- thesis: `76s는 어느 자리에서든 오픈합니다. 오픈을 맞으면 콜 9곳 · 3벳 1곳 · 폴드 5곳입니다.`
- CO×HJ(콜75) 선택, anchor = 같은 행 UTG(폴드75): `HJ 오픈에는 주로 콜합니다. UTG 오픈에는 주로 폴드합니다.` / `UTG는 18%, HJ는 21%를 오픈합니다.` / [콜 75%][폴드 25%] / 메모(UTG 칸을 비교로 두면) `76s는 25%만 콜해요. 뒤에 3명이 남아 임플라이드 오즈…`
- SB×BTN(콜50/폴드50 → 콜) 선택, anchor = 같은 열 BTN×BTN 없음 → 같은 행 CO(폴드): `BTN 오픈에는 절반만 콜합니다. CO 오픈에는 폴드합니다.` / `CO는 29%, BTN은 46%를 오픈합니다.` / 행 상수: `SB는 콜하면 BB의 스퀴즈와 포지션 불리가 겹칩니다.` / 메모 `76s는 50%만 콜해요. 65s 이하 커넥터는 포지션 없이 폴드하세요.`
- 3벳 대응: `콜 5곳 · 폴드 10곳`. CO×SB(콜50) vs CO×BTN(폴드): `SB 3벳에는 절반만 콜합니다. BTN 3벳에는 폴드합니다.` / `SB 상대로는 플랍 이후 내가 나중에, BTN 상대로는 먼저 액션합니다.` / `SB의 3벳은 밸류와 블러프가 섞입니다. BTN의 3벳은 밸류 위주입니다.`
- selfQuestion: `다음에 76s를 받으면: 앞에 오픈한 사람이 있나요? 누가 했나요?`

**③ Q9o (약한 패)** — rfi UTG HJ CO 폴드 · BTN SB 오픈
- thesis: `Q9o는 BTN부터 오픈합니다. 앞에서는 폴드입니다.`
- `BTN부터 새로 들어오는 패: Q8o K9o J9o T9o K8o J8o T8o 98o A7o 등 32종`
- CO 타일 선택(anchor BTN): `BTN에서는 오픈합니다. CO에서는 폴드합니다.` / `CO는 뒤에 3명, BTN은 2명이 남습니다.` / `오픈 레인지는 CO 29%, BTN 46%입니다.` / `CO는 오프수트 Q를 QTo까지 오픈합니다.` / `BTN은 오프수트 Q를 Q9o까지 항상, Q8o는 절반만 오픈합니다.` / `폴드하세요. Q 하나뿐이고 오프수트라 만들 수 있는 패가 없습니다.`
- 오픈 대응: BB 행만 non-fold: UTG 폴드 · HJ 콜50 · CO 콜 · BTN 콜 · SB 콜. 다이제스트 `콜 4곳 · 폴드 11곳` + `콜 4곳: BB vs HJ · BB vs CO · BB vs BTN · BB vs SB`(4곳이라 생략 → 이름 줄은 ≤3곳 규칙상 없음). BB×HJ vs BB×UTG: `HJ 오픈에는 절반만 콜합니다. UTG 오픈에는 폴드합니다.` / `UTG는 18%, HJ는 21%를 오픈합니다.` / 행 상수 `BB는 이미 1bb를 냈으니 1.5bb만 더 내고 약 5.5bb 팟을 봅니다. 마지막 차례라 스퀴즈 걱정 없이 가장 넓게 콜합니다.`
- 3벳 대응: reachable 3곳(BTN×SB, BTN×BB, SB×BB) `3곳 전부 폴드`, 나머지 12칸 `—` + 범례. 4벳까지/올인까지 `생기지 않는 상황`. 림프 `폴드 4곳 · BB는 폴드 없이 체크`.
- selfQuestion: `다음에 Q9o를 받으면: 내 자리가 BTN이나 SB인가요? 아니면 폴드입니다.`

**④ A5s (수티드 휠 에이스)**
- thesis: `A5s는 어느 자리에서든 오픈합니다. 오픈을 맞으면 어디서든 3벳합니다.`
- 3벳 대응(15곳 reachable): `15곳 전부 4벳 · 절반만 3곳`. UTG×HJ(4벳50/콜25/폴드25) vs UTG×BB(4벳): `BB 3벳에는 4벳합니다. HJ 3벳에는 절반만 4벳합니다.` / `BB 상대로는 플랍 이후 내가 나중에, HJ 상대로는 먼저 액션합니다.` / `BB의 3벳은 밸류와 블러프가 섞입니다. HJ의 3벳은 밸류 위주입니다.` / [4벳 50%][콜 25%][폴드 25%] / 메모 `절반은 4벳 블러프, 4번 중 1번은 콜하세요…`
- 4벳까지: `15곳 전부 폴드 · 절반만 0곳` → 혼합은 'some'(올인 25%)이라 `절반만` 대신 `· 올인 섞는 곳 6`(weightClass≠always 인 칸 수, 2순위 액션 이름). BTN×CO(폴드75/올인25) vs BTN×HJ(폴드): `둘 다 폴드입니다. CO 상대로는 올인을 25% 섞습니다.` / 메모 `25%만 올인 블러프로 씁니다…`
- 올인까지: `15곳 전부 폴드`. 림프 `레이즈 4곳 · 폴드 1곳` + `폴드 1곳: HJ`. 콜드 4벳 `4곳 전부 폴드 · 4벳 섞는 곳 2`.
- selfQuestion: `다음에 A5s를 받으면: 앞에 오픈한 사람이 있나요? 있으면 3벳, 없으면 오픈입니다.`

**⑤ 22 (작은 포켓페어)**
- thesis: `22는 어느 자리에서든 오픈합니다. 오픈을 맞으면 콜 10곳 · 폴드 5곳입니다.`
- 오픈 대응 HJ×UTG(폴드) 선택, anchor = 같은 열 CO×UTG(콜50): `CO에서는 절반만 콜합니다. HJ에서는 폴드합니다.` / `HJ는 뒤에 4명, CO는 3명이 남습니다.` / 비교를 BTN×UTG 로 바꾸면: `BTN에서는 콜합니다. HJ에서는 폴드합니다.` / `HJ는 뒤에 4명, BTN은 2명이 남습니다.` / 메모 `22까지 모든 포켓페어를 콜하세요. 뒤에 블라인드만 남아 스퀴즈 위험이 작아요…`
- 3벳 대응: `콜 3곳 · 폴드 12곳` + `콜 3곳: BTN vs SB · BTN vs BB · SB vs BB`. BTN×SB(콜75) vs CO×SB(폴드): `BTN에서는 주로 콜합니다. CO에서는 폴드합니다.` / `SB는 BTN 오픈에 17%, CO 오픈에 13%를 3벳합니다.` (position 은 둘 다 IP → 생략) / 행 상수 `SB의 3벳은 밸류와 블러프가 섞입니다.`
- selfQuestion: `다음에 22를 받으면: 앞에 오픈한 사람이 있나요? 누가 했나요?`

**⑥ KTs (수티드 브로드웨이)**
- thesis: `KTs는 어느 자리에서든 오픈합니다. 오픈을 맞으면 콜 9곳 · 3벳 5곳 · 폴드 1곳입니다.`
- 3벳 대응: `15곳 전부 콜 · 절반만 2곳`. UTG×HJ(콜50) vs UTG×BB(콜): `BB 3벳에는 콜합니다. HJ 3벳에는 절반만 콜합니다.` / `BB 상대로는 플랍 이후 내가 나중에, HJ 상대로는 먼저 액션합니다.` / `BB의 3벳은 밸류와 블러프가 섞입니다. HJ의 3벳은 밸류 위주입니다.` (3벳 폭 6% vs 5% → Δ<2pt 생략) / 메모 `절반만 콜하세요. 수티드 브로드웨이 중 가장 약한 패예요…`
- SB 행 seatSummary: `SB에서 KTs: 오픈 · UTG 오픈에는 폴드, HJ 오픈부터 3벳 · 3벳에는 콜` (HJ 칸 half → `HJ 오픈에는 절반만 3벳`). SB×UTG(폴드) vs SB×HJ(3벳50): `HJ 오픈에는 절반만 3벳합니다. UTG 오픈에는 폴드합니다.` / `UTG는 18%, HJ는 21%를 오픈합니다.` / 행 상수 `SB는 콜하면 BB의 스퀴즈와 포지션 불리가 겹칩니다. 그래서 3벳 아니면 폴드 위주로 대응합니다.`
- SB×UTG(폴드) 를 BB×UTG(콜) 와 비교(hero 축): `BB에서는 콜합니다. SB에서는 폴드합니다.` / `BB는 이미 1bb를 냈으니 1.5bb만 더 내고 약 5.5bb 팟을 봅니다. SB는 콜하면 BB의 스퀴즈와 포지션 불리가 겹칩니다.`

**⑦ ATo (큰 킥커 A)** — rfi UTG 오픈50 · HJ부터 오픈
- thesis: `ATo는 UTG에서 절반만, HJ부터 항상 오픈합니다.`
- `UTG는 오프수트 A를 AJo까지 항상, ATo는 절반만 오픈합니다.` / `HJ는 오프수트 A를 ATo까지 오픈합니다.`
- **퀴즈 오답 진입 예**: 퀴즈 `vs_open:CO:HJ` (정답 폴드75) 에서 콜을 고름 → `compare = nearestCellWithAction(CO:HJ, 'call')` = hero 축 `BTN:HJ`(콜50). 열리자마자: CO×HJ 민트, BTN×HJ 하늘 → `BTN에서는 절반만 콜합니다. CO에서는 주로 폴드합니다.` / `CO는 뒤에 3명, BTN은 2명이 남습니다.` / [폴드 75%][콜 25%] / 메모 `ATo는 75%를 폴드하세요. HJ의 ATo 이상에 자주 도미네이트돼요…`
- 3벳 대응 `콜 3곳 · 폴드 12곳` (BTN×SB 콜50/4벳25/폴드25, BTN×BB 콜75, SB×BB 콜50). 림프 `BTN만 절반 레이즈 · BB는 폴드 없이 체크`.
- selfQuestion: `다음에 ATo를 받으면: 내 자리가 HJ보다 앞인가요? UTG라면 절반만 오픈합니다.`

**⑧ 55 (작은 포켓페어)**
- thesis: `55는 어느 자리에서든 오픈합니다. 오픈을 맞으면 콜 13곳 · 폴드 2곳입니다.`
- 3벳 대응: `콜 9곳 · 폴드 6곳`. HJ×CO(폴드75) 선택, anchor = 같은 행 HJ×BTN(콜50): `BTN 3벳에는 절반만 콜합니다. CO 3벳에는 주로 폴드합니다.` — position 동일(둘 다 OOP), 3벳 폭 6% vs 6% 동일, 블라인드 아님 → **차이 레버 0개 → 결론 + 메모만**: 메모 `절반만 콜하세요. BTN의 3벳이 넓어서 셋마이닝…` (HJ×BTN 메모) / `4번 중 1번만 콜하세요…` (HJ×CO 메모). 이유를 지어내지 않음.
- 림프: HJ 폴드 · CO 레이즈 · BTN 레이즈50 · SB 레이즈 · BB 체크 → `레이즈 3곳 · 폴드 1곳 · BB는 폴드 없이 체크`; BB 메모 `55는 체크예요. 다른 자리에서는 올리는 패인데…` + DISCLAIMER.
- SB×CO(콜50) vs SB×BTN(콜75): `둘 다 콜입니다. CO 오픈에는 폴드를 50% 섞습니다.` / `CO는 29%, BTN은 46%를 오픈합니다.`

---

## 6. 혼합 전략 · BB 체크 · 림프 대응의 처리

| 상황 | 처리 |
|---|---|
| 50/50 (동점) | 타일은 항상 분할로 칠하고 라벨에 `오픈 50`. 결론은 `절반만`/`반반`. 혼합 칩에 두 비중 모두. 아틀라스 어디에도 "KJo는 UTG에서 오픈"이라는 단정이 없다. 동점 패가 하나라도 있으면 스트립 아래 각주 1줄: `반반이면 앱은 더 공격적인 쪽을 정답으로 봅니다.` (mixNote 와 같은 규칙, 트레이너 채점과 일치) |
| 3분할 (A5s 4벳50/콜25/폴드25 등 16칸) | 라벨은 1순위 + 비중, 배경은 3색 분할, 상세의 혼합 칩이 셋 다 표시 |
| '…부터' 문법 | CORE_SEATS(UTG→BTN) 안에서만. SB 는 thesis 에 별도 절, 스트립에 점선 구분 + 고정 문장 `SB는 BB 한 명만 남아 따로 봅니다.` '뒷자리일수록' 류 문장은 SB 열을 가로질러 읽히지 않도록 UTG~BTN 4칸 아래에만 둔다 |
| BB 림프 대응 | BB 타일 `--act-check` 바탕 + `체크` 글자(회색 금지). 다이제스트 `BB는 폴드 없이 체크`. 퀴즈 키에서 제외(check 답은 12문제 묶음에서 혼란) |
| vs_limp 전체 | 섹션 제목에 `사람 작성` 태그(접혀도 보임) + DISCLAIMER.vs_limp 원문. `openWidth` 레버 금지(`villainChart` 가 null). ':0.5' 는 "두 공개 차트가 다르게 말함"이므로 결론에 `절반만 레이즈` 를 쓰되 비교 블록에 DISCLAIMER 를 무조건 붙인다. '부터' 압축 금지(열거만) |
| cold_4bet | hero 만 보는 차트. reachable 항상 ok. 전부 폴드면 접힌 한 줄 |
| 미도달 칸 | `—` 흐리게, 다이제스트·퀴즈·비교·anchor 후보에서 제외, 범례 한 줄, 탭하면 G 문장 |
| 메모(해요체) | "차트 메모" 라벨로 인용 표시(ExplanationBody 와 같은 처리). 스타일 테스트에서 제외 |

---

## 7. 테스트 계획 (vitest)

**`tests/atlas.test.ts`** — 전수(169패 × 74칸, 셀 캐시 덕분에 explain 감사보다 가벼움; 30초 한도 내)
1. `handAtlas: 74 cells per hand, keys equal srs.cardKeyOf` — 모든 패에서 섹션 합이 5+15+15+15+15+5+4 이고 `cell.key === cardKeyOf(scenario, hand)`.
2. `isReachable mirrors buildSteps` — seedRandom 고정 후 `nextHandSequence` 2000회: 만들어진 모든 step 은 `isReachable(step.scenario, hand).ok === true`; 역으로 각 hero×hand 에 대해 `buildSteps` 를 전 villain 조합으로 돌려 나온 kind 집합이 reachable 집합과 같음.
3. `rfiProfile patterns` — 개수 스냅샷 {always 45, entry 41, half 12, partial 4, sbOnly 1, never 71, irregular 0}, `sbDiffers` 패 = {J4s, K6o}, `firstAlways===null` 패 = {Q8o, J8o, T8o, 98o} (K6o 는 sbOnly).
4. `newcomersAt partitions the openers` — 네 집합이 서로소이고 합집합 = firstAny≠null 인 패 전체; HJ = [K8s K7s QJo KTo T8s 97s 54s].
5. `claims re-derive from the charts` (**속성 테스트**) — 모든 패에 대해 `rfiThesis`, `selfQuestion`, 7개 `sectionDigest`, 6개 `seatSummary`, 모든 한 축 쌍의 `compareCells`(strip 10+10+6, 삼각형 행/열 쌍 40×4 = 186쌍/패) 를 생성하고, 각 `Line` 에 대해 (a) `claims` 의 `action === primaryAction`, `weight === weightClass` 재계산 일치, (b) 텍스트에서 정규식 `/(UTG|HJ|CO|BTN|SB|BB)(에서는|에서|부터|만) ?(절반만 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인|체크)/g` 와 `/(UTG|HJ|CO|BTN|SB) (오픈|3벳|4벳|올인)에는 (절반만 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인)/g` 로 뽑은 쌍이 `claims` 로 전부 설명되고 남는 쌍이 없음, (c) `/\d+(?=%|명|곳|문제|종)/g` 로 뽑은 모든 숫자가 `nums` 에 있고 `nums` 가 `share/tb/behind/count` 재계산과 같음(리터럴 숫자 금지; `1bb/1.5bb/5.5bb` 등 가격은 `priceFacts` 출력과 같아야 함), (d) `'부터'` 는 pattern ∈ {entry, half} 또는 villain 축 단조 절에서만, `'어디서든'/'어느 자리에서든'` 은 모든 칸 primary 동일일 때만, `'까지'` 는 `rowBoundary.monotone` 일 때만, (e) `source === 'constant'` 문장은 `explainStep(stepFor(s,h)).reasoning ∪ easy.why` 의 원소(그 kind 의 임의 패 하나로 확인) — 단 `sbOpen` 상수는 예외 목록.
6. `compareCells null-equivalence` — 결론이 `둘 다` 로 시작 ⇔ `primary(a) === primary(b)`; 레버 문장은 두 칸의 레버 값이 다를 때만(`differingLevers` 결과를 레버별로 재검사).
7. `unreachable cells never surface` — 다이제스트 개수, `atlasQuizKeys`, `nearestCellWithAction`, anchor 후보 어디에도 `reachable=false` 칸이 없음; `atlasQuizKeys` 는 vs_limp BB 를 제외하고 ≤ max, 중복 없음, 모두 `stepForKey` 로 복원 가능.
8. `nearestCellWithAction` — ATo vs_open:CO:HJ + call → BTN:HJ; Q9o rfi:BTN + fold → CO; KJo rfi:UTG + fold → null; 결과는 항상 같은 kind·reachable·`primary === action`.
9. `style lint` — 모든 생성 텍스트(메모·DISCLAIMER 제외): 느낌표/이모지 없음, `BANNED_KO`(coach lint 의 정규식 재사용, '솔버' 는 DISCLAIMER 전용) 없음, 문장 ≤ 30자(seatSummary 45), `해요`/`거든요` 없음, 괄호 없음, `~합니다|~입니다|~인가요|~나요` 로 끝남.
10. `OPEN[] class lines agree with the charts` (**기존 카피 감사**) — `OPEN[cls]` 문장에 `뒷자리에서만`·`앞자리 레인지에는 들어가지 않습니다` 가 있으면 그 클래스의 모든 패가 `firstAny ∈ {CO, BTN}` 이거나 null 이어야 하고, `어디서든/항상` 이 있으면 모든 패가 `firstAny === 'UTG'` 여야 함. 현재 실패하는 11패(K9s K8s K7s KQo KJo QJo KTo Q9s J9s T8s 97s) 를 고치는 카피 변경(이 스펙의 일부):
    - `offsuit_broadway`: `['자리가 뒤로 갈수록 더 많이 오픈합니다.', '킥커가 약한 쪽일수록 늦게 들어갑니다.']`
    - `suited_king`: `['큰 수티드 K는 앞자리, 작은 쪽은 뒷자리에서 오픈합니다.', '3벳에는 대부분 폴드합니다.']`
    - `suited_qj`: `['Q9s는 앞자리부터, 나머지는 뒷자리에서 오픈합니다.', '3벳에는 폴드가 기본입니다.']`
    - `suited_gapper`: `['높은 갭퍼는 앞자리, 낮은 갭퍼는 뒷자리에서 오픈합니다.', '플랍에서 드로우가 붙어야 계속 갑니다.']`
    - `offsuit_ace` 는 통과(A9o 이하 firstAny ∈ {CO,BTN}).

**`tests/data-invariants.test.ts`** (접목: CI 가드, 깨지면 패 이름과 거짓이 될 문장을 함께 출력)
11. `RFI raise weight is non-decreasing UTG→BTN for all 169 hands` (지금 0 위반).
12. `vs_open and vs_3bet hero rows are non-decreasing in AGGRESSION_ORDER and in continue weight along the villain axis` (각 kind 676행, 0 위반).
13. `vs_open: BB continues at least as much as every other hero vs the same opener` (0 위반).
14. `non-monotone row boundaries occur only in suited-A rows` (33/1850, 전부 A 수티드 줄).
15. `SB differs from BTN in rfi primary only for J4s, K6o` — 바뀌면 thesis 의 SB 절 규칙을 다시 볼 것.

**`tests/explain-golden.test.ts`**
16. `reasoning() is byte-identical after the priceFacts hoist` — 74차트 × 169패의 `explainStep(step).reasoning.join('\n')` 전체를 FNV-1a 로 해시한 상수와 비교. 리팩터 전에 상수를 기록하고, 카피를 의도적으로 바꿀 때만 갱신.

**`src/screens/charts/__tests__/charts.test.ts`** 에 추가
17. `DISCLAIMER module equals the strings ChartsScreen used to hold` — `vs_limp` 문장이 "림프는 솔버가 하지 않는 플레이라" 로 시작.

**`src/state/__tests__/atlas.test.ts`**
18. `openAtlas pauses a running session and closeAtlas resumes only what it paused` — sessionStore 를 시작해 running 상태에서 open → 'paused', close → 'running'; 이미 paused 였으면 close 후에도 paused.

---

## 8. 범위 밖 (지금 만들지 않는 것)

- 해설 본문 안의 **미니 SeatStrip**(심사 결함: 축이 상황마다 바뀌고 hold 오버레이에 죽은 UI). 링크 줄 하나로 대체.
- **예측 커버**("어디부터 오픈할까요?") — v1.1 후보. 지금은 selfQuestion + 퀴즈 버튼으로 회수(retrieval)를 담당.
- **두 축이 다른 칸의 비교**, 중간 칸 경로, '기준 바꾸기' 버튼, 섹션을 넘는 비교(오픈 ↔ 림프 대응 등).
- **손패×자리 인과 템플릿 테이블**(COMPARE[cls][fact:dir]) — 엔진에 근거 모델이 없어 만들지 않는다. "왜"는 숫자·기존 문장·메모·해설 전체 보기로만.
- `scenarioLines` 를 태그된 구조로 리팩터하는 일(가격 숫자 hoist 만 하고, 문장 생성은 그대로).
- 패 간 비교(KJo vs KQo), 상대 성향 가정, 스택 깊이.
- 코치 탭 진입점, 코치 카드와의 연동.
- 림퍼 자리별 레인지(출처 없음), cold_4bet 의 오프너/3벳터 구분.
- 메모(`chart.notes`)가 다른 자리의 액션을 단정하는 문장을 차트와 대조하는 린트 — 후속 과제(아틀라스가 그 모순을 더 잘 드러내므로 다음 스프린트 1순위로 기록).
- 아틀라스 자체의 SRS 채널·통계 — 헷갈려요 버튼은 기존 'chart' 채널을 그대로 쓴다.

---

### 구현 체크리스트 (파일 단위)
신규: `src/poker/atlas.ts`, `src/poker/priceFacts.ts`, `src/state/atlas.ts`, `src/screens/charts/disclaimer.ts`, `src/screens/atlas/{HandAtlasSheet,SeatStrip,SeatTriangle,AtlasDetail,HandPicker}.tsx`, `src/styles/atlas.css`, `tests/atlas.test.ts`, `tests/data-invariants.test.ts`, `tests/explain-golden.test.ts`, `src/state/__tests__/atlas.test.ts`.
수정: `src/poker/explain.ts`(export 4개 + OPEN 카피 4클래스 + scenarioLines 가격을 priceFacts 에서 읽기), `src/poker/range.ts`(AGGRESSION_ORDER export), `src/components/RangeGrid.tsx`(cellBackground export, paint prop), `src/components/ExplanationSheet.tsx`(onAcross prop 두 컴포넌트), `src/screens/charts/CellSheet.tsx`, `src/screens/ChartsScreen.tsx`(DISCLAIMER import, 헤더 IconButton), `src/screens/trainer/{RevealChart,SessionView,SummaryView}.tsx`, `src/screens/quiz/{QuizRound,QuizSummary}.tsx`, `src/screens/home/LastSession.tsx`, `src/App.tsx`(`<HandAtlasSheet/>` 1줄), `scripts/layout-audit.mjs`(.atlas__cell 근거 주석). 작업 순서: 테스트 16(골든 해시 기록) → priceFacts hoist → atlas.ts + 테스트 1~15 → UI → 진입점 → 레이아웃 감사 360/390/430.