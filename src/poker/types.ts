/** 6-max positions in preflop acting order. */
export const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Pos = (typeof POSITIONS)[number];

export const POS_INDEX: Record<Pos, number> = { UTG: 0, HJ: 1, CO: 2, BTN: 3, SB: 4, BB: 5 };

export const POS_LABEL_KO: Record<Pos, string> = {
  UTG: '언더더건 (UTG / LJ)',
  HJ: '하이잭 (HJ)',
  CO: '컷오프 (CO)',
  BTN: '버튼 (BTN)',
  SB: '스몰블라인드 (SB)',
  BB: '빅블라인드 (BB)',
};

/**
 * Preflop actions.
 *  - raise   : open raise (RFI)
 *  - threebet: 3-bet (vs open, or squeeze)
 *  - fourbet : 4-bet (vs 3-bet, or cold 4-bet) — not all-in at 100bb
 *  - allin   : 5-bet jam (vs 4-bet)
 */
/**
 * `check` 는 **반드시 맨 뒤**에 둡니다. src/state/srs.ts 가 저장할 때 `ACTIONS.indexOf(...)` 를 그대로
 * 숫자로 적고 불러올 때 `ACTIONS[n]` 으로 되읽는데, 버전 표시가 없습니다. 중간에 끼워 넣으면 이미
 * 저장된 모든 카드의 정답이 한 칸씩 밀려 조용히 다른 액션이 됩니다 — 에러도 안 납니다.
 * 이 배열의 순서는 '저장 형식'이지 '공격성 순서'가 아닙니다. 공격성은 range.ts 의 AGGRESSION_ORDER 입니다.
 */
export const ACTIONS = ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin', 'check'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL_KO: Record<Action, string> = {
  check: '체크',
  fold: '폴드',
  call: '콜',
  raise: '레이즈 (오픈)',
  threebet: '3벳',
  fourbet: '4벳',
  allin: '올인',
};

export const ACTION_SHORT_KO: Record<Action, string> = {
  check: '체크',
  fold: '폴드',
  call: '콜',
  raise: '오픈',
  threebet: '3벳',
  fourbet: '4벳',
  allin: '올인',
};

/**
 * Scenario kinds (hero = the player whose decision we train).
 *  - rfi      : folded to hero, hero decides to open or fold.        villain: none
 *  - vs_open  : villain (earlier position) opened, hero decides.      villain: opener
 *  - vs_3bet  : hero opened, villain (later position) 3-bet.          villain: 3-bettor
 *  - vs_4bet  : villain opened, hero 3-bet, villain 4-bet.            villain: opener/4-bettor
 *  - vs_5bet  : hero opened, villain 3-bet, hero 4-bet, villain jams. villain: 3-bettor/jammer
 *  - cold_4bet: an open and a 3-bet happened in front of hero.        villain: none (generic)
 *  - vs_limp  : exactly one player limped (called the BB) in front.   villain: none (generic — 자리를 안 가립니다)
 */
export const SCENARIO_KINDS = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet', 'vs_limp'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_LABEL_KO: Record<ScenarioKind, string> = {
  rfi: '오픈 (앞에 아무도 없음)',
  vs_open: '앞에서 오픈 (2벳)',
  vs_3bet: '내 오픈에 3벳',
  vs_4bet: '내 3벳에 4벳',
  vs_5bet: '내 4벳에 5벳 올인',
  cold_4bet: '앞에서 오픈 + 3벳 (콜드 4벳)',
  vs_limp: '앞에서 림프 (1bb만 내고 콜)',
};

/**
 * Which actions are legal (offered) in each scenario, in display order.
 *
 * 직접 쓰지 말고 `scenarioActions(kind, hero)` 를 쓰세요. 어떤 상황은 legal action 이 자리에
 * 따라 달라집니다(빅블라인드는 이미 돈을 냈으므로 폴드가 없습니다).
 */
const KIND_ACTIONS: Record<ScenarioKind, Action[]> = {
  rfi: ['fold', 'raise'],
  vs_open: ['fold', 'call', 'threebet'],
  vs_3bet: ['fold', 'call', 'fourbet'],
  vs_4bet: ['fold', 'call', 'allin'],
  vs_5bet: ['fold', 'call'],
  cold_4bet: ['fold', 'call', 'fourbet'],
  // 빅블라인드는 여기서 폴드가 없습니다 — scenarioActions 가 자리를 보고 갈아 끼웁니다.
  vs_limp: ['fold', 'raise'],
};

/** 림프를 맞은 빅블라인드: 이미 돈을 냈으니 공짜로 접을 수 없습니다. 체크 아니면 레이즈. */
const VS_LIMP_BB: Action[] = ['check', 'raise'];

/**
 * 이 상황에서 고를 수 있는 액션 — **공격성 오름차순**입니다.
 *
 * 순서가 값을 가집니다. `src/state/coach/patterns.ts` 는 이 배열의 인덱스를 그대로 '공격성 등수'로
 * 읽고, 여러 곳이 `.at(-1)` 로 '제일 공격적인 액션'을 꺼냅니다. 뒤집으면 전부 컴파일은 되지만
 * 코치 탭의 성향 축이 통째로 반대로 읽힙니다.
 */
export function scenarioActions(kind: ScenarioKind, hero: Pos): readonly Action[] {
  if (kind === 'vs_limp' && hero === 'BB') return VS_LIMP_BB;
  return KIND_ACTIONS[kind];
}

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export type Rank = (typeof RANKS)[number];

/** Only spades and diamonds are used for visuals (user preference: suited/offsuit must be unmistakable). */
export const SUITS = ['s', 'd'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Canonical 169-hand name: "AA", "AKs", "AKo" (high rank first). */
export type HandName = string;

/** Weighted action mix for one hand. Weights sum to <= 1; the remainder is fold. */
export type ActionMix = Partial<Record<Action, number>>;

/** A full 169-hand chart: hand name → action mix. Missing hands are pure fold. */
export type ChartCells = Record<HandName, ActionMix>;

export interface ChartDef {
  id: string;
  kind: ScenarioKind;
  hero: Pos;
  /** Opener (vs_open, vs_4bet) or 3-bettor (vs_3bet, vs_5bet). Absent for rfi and cold_4bet. */
  villain?: Pos;
  /**
   * Range strings per action. See src/poker/range.ts for notation.
   * `fold` 와 `check` 는 여기 못 씁니다 — 둘은 '적지 않은 나머지'(`rest`)로만 들어갑니다.
   */
  actions: Partial<Record<Exclude<Action, 'fold' | 'check'>, string>>;
  /**
   * 아무 액션에도 안 적힌 나머지 비중이 무엇인가. 기본은 폴드입니다.
   *
   * 빅블라인드는 이미 돈을 냈으니 **공짜로 폴드할 수 없습니다** — 레이즈하지 않는 패는 전부
   * 체크입니다. 이 칸을 안 두면 앱이 "빅블라인드에서 폴드"를 가르치게 됩니다.
   * `buildChart` 가 이 값을 실제 비중으로 만들어 주므로, 아래 소비자들은 그냥 진짜 액션으로 봅니다.
   */
  rest?: Action;
  /** Short Korean strategic summary of the chart (1–3 sentences). */
  summary?: string;
  /** Optional hand-specific notes (hand name → Korean note). Shown in explanations. */
  notes?: Record<HandName, string>;
}

export interface Scenario {
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
  /**
   * 화면에만 쓰는 상대 자리. 차트는 이 값을 보지 않습니다 —
   * cold_4bet 은 두 상대를 뭉뚱그리고, vs_limp 는 림퍼의 자리를 가리지 않습니다
   * (어느 자리에서 림프했는지로 레인지를 나누는 출처가 없습니다).
   */
  extras?: { opener?: Pos; threeBettor?: Pos; limper?: Pos };
}
