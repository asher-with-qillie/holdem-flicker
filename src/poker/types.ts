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
export const ACTIONS = ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL_KO: Record<Action, string> = {
  fold: '폴드',
  call: '콜',
  raise: '레이즈 (오픈)',
  threebet: '3벳',
  fourbet: '4벳',
  allin: '올인',
};

export const ACTION_SHORT_KO: Record<Action, string> = {
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
 */
export const SCENARIO_KINDS = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_LABEL_KO: Record<ScenarioKind, string> = {
  rfi: '오픈 (앞에 아무도 없음)',
  vs_open: '앞에서 오픈 (2벳)',
  vs_3bet: '내 오픈에 3벳',
  vs_4bet: '내 3벳에 4벳',
  vs_5bet: '내 4벳에 5벳 올인',
  cold_4bet: '앞에서 오픈 + 3벳 (콜드 4벳)',
};

/** Which actions are legal (offered) in each scenario, in display order. */
export const SCENARIO_ACTIONS: Record<ScenarioKind, Action[]> = {
  rfi: ['fold', 'raise'],
  vs_open: ['fold', 'call', 'threebet'],
  vs_3bet: ['fold', 'call', 'fourbet'],
  vs_4bet: ['fold', 'call', 'allin'],
  vs_5bet: ['fold', 'call'],
  cold_4bet: ['fold', 'call', 'fourbet'],
};

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
  /** Range strings per non-fold action. See src/poker/range.ts for notation. */
  actions: Partial<Record<Exclude<Action, 'fold'>, string>>;
  /** Short Korean strategic summary of the chart (1–3 sentences). */
  summary?: string;
  /** Optional hand-specific notes (hand name → Korean note). Shown in explanations. */
  notes?: Record<HandName, string>;
}

export interface Scenario {
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
  /** For cold_4bet: the opener and 3-bettor seats (for display only). */
  extras?: { opener: Pos; threeBettor: Pos };
}
