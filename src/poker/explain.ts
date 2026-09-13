import { getChartCells, hasChart } from './data';
import { ALL_HANDS, parseHandName, type HandInfo } from './hands';
import { foldWeight, fullMix, rangeShare } from './range';
import { heroInPosition } from './scenarios';
import type { Step } from './trainer';
import { ACTION_SHORT_KO, POS_INDEX, type Action, type ChartCells, type Pos, type Scenario, type ScenarioKind } from './types';

/*
 * 해설 생성기. 모든 문장은 docs/PLAIN_KO_STYLE.md(v2)를 따릅니다.
 *  - 포커 표준 용어(폴드·콜·레이즈·킥커·셋·블러프…)는 풀어 쓰지 않고 그대로 씁니다.
 *  - 어려운 개념(블로커·셋마이닝·SPR·c-bet…)만 기술 블록에서 딱 한 번 짧게 풉니다(applyGlosses).
 *  - `easy` : 결론 → 왜? → 예시 → (폴드가 아닐 때) 플랍에서는
 *  - 나머지 : "자세히" 아래에 접혀 있는 기술 블록
 */

/* ------------------------------------------------------------------ */
/* Hand classes                                                        */
/* ------------------------------------------------------------------ */

export type HandClass =
  | 'premium_pair'
  | 'big_pair'
  | 'mid_pair'
  | 'small_pair'
  | 'ak'
  | 'big_ace'
  | 'suited_ace'
  | 'wheel_ace'
  | 'offsuit_ace'
  | 'suited_broadway'
  | 'offsuit_broadway'
  | 'suited_king'
  | 'suited_qj'
  | 'suited_connector'
  | 'suited_gapper'
  | 'offsuit_connector'
  | 'junk';

export const HAND_CLASS_KO: Record<HandClass, string> = {
  premium_pair: '최상위 포켓페어',
  big_pair: '큰 포켓페어',
  mid_pair: '중간 포켓페어',
  small_pair: '작은 포켓페어',
  ak: 'AK',
  big_ace: '큰 킥커 A',
  suited_ace: '수티드 A',
  wheel_ace: '수티드 휠 에이스',
  offsuit_ace: '오프수트 A',
  suited_broadway: '수티드 브로드웨이',
  offsuit_broadway: '오프수트 브로드웨이',
  suited_king: '수티드 K',
  suited_qj: '수티드 Q·J',
  suited_connector: '수티드 커넥터',
  suited_gapper: '수티드 갭퍼',
  offsuit_connector: '오프수트 커넥터',
  junk: '약한 패',
};

export function classifyHand(name: string): HandClass {
  const h = parseHandName(name);
  const { kind, highV, lowV, gap } = h;
  if (kind === 'pair') {
    if (highV >= 13) return 'premium_pair';
    if (highV >= 11) return 'big_pair';
    if (highV >= 8) return 'mid_pair';
    return 'small_pair';
  }
  if (highV === 14 && lowV === 13) return 'ak';
  if (highV === 14 && lowV >= 10) return 'big_ace';
  if (highV === 14 && kind === 'suited') return lowV <= 5 ? 'wheel_ace' : 'suited_ace';
  if (highV === 14) return 'offsuit_ace';
  if (highV >= 10 && lowV >= 10) return kind === 'suited' ? 'suited_broadway' : 'offsuit_broadway';
  if (kind === 'suited' && highV === 13) return 'suited_king';
  if (kind === 'suited' && (highV === 12 || highV === 11) && gap >= 2) return 'suited_qj';
  if (kind === 'suited' && gap === 0) return 'suited_connector';
  if (kind === 'suited' && gap <= 2) return 'suited_gapper';
  if (kind === 'offsuit' && gap === 0 && highV >= 6) return 'offsuit_connector';
  return 'junk';
}

/* ------------------------------------------------------------------ */
/* Output types                                                        */
/* ------------------------------------------------------------------ */

export interface PostflopPlan {
  potType: string;
  role: string;
  position: string;
  spr: string;
  checklist: string[];
  goodBoards: string;
  badBoards: string;
  plan: string[];
}

/** 앞에 보이는 해설. 짧은 문장, 표준 용어, 카드 예시(♠/♦). */
export interface EasyExplanation {
  /** 결론: 액션 한 단어 + 이유 한 절. 60자 이하. */
  oneLiner: string;
  /** oneLiner에서 액션을 뺀 이유 절만. */
  reason: string;
  /** 왜? 불릿 2~3개. 각 30자 이하. */
  why: string[];
  /** 예시 1~3줄. 각 40자 이하. */
  example: string[];
  /** 폴드가 아닐 때만: 플랍에서는 불릿 3~4개. 각 35자 이하. */
  flop?: string[];
}

export interface Explanation {
  headline: string;
  situation: string;
  handProfile: string;
  reasoning: string[];
  rangeContext: string;
  mixNote?: string;
  chartNote?: string;
  postflop?: PostflopPlan;
  easy: EasyExplanation;
}

/* ------------------------------------------------------------------ */
/* Korean helpers                                                      */
/* ------------------------------------------------------------------ */

const pct = (x: number) => `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;
/** 정수 퍼센트. 스타일 가이드 §2.6: 빈도는 "10번 중 2번"이 아니라 "18%". */
const pctInt = (x: number) => `${Math.round(x * 100)}%`;

/** Seat names read out loud: only BTN (비티엔) ends in a consonant. */
function seat(p: Pos, particle: '가' | '는' | '를' | '와'): string {
  if (p !== 'BTN') return `${p}${particle}`;
  const consonant: Record<typeof particle, string> = { 가: '이', 는: '은', 를: '을', 와: '과' };
  return `${p}${consonant[particle]}`;
}

const isBlind = (p?: Pos) => p === 'SB' || p === 'BB';
const isEarly = (p?: Pos) => p === 'UTG' || p === 'HJ';
const seatsBetween = (a: Pos, b: Pos) => Math.max(0, Math.abs(POS_INDEX[a] - POS_INDEX[b]) - 1);
const seatsBehind = (hero: Pos) => 5 - POS_INDEX[hero];

/** Compact hand list for a chart action, e.g. "QQ+ · AKs · AKo · A5s(50%)". */
function summarizeRange(cells: ChartCells, action: Action, max = 9): string {
  const items: string[] = [];
  for (const h of ALL_HANDS) {
    const w = cells[h]?.[action] ?? 0;
    if (w <= 0) continue;
    items.push(w >= 1 ? h : `${h}(${Math.round(w * 100)}%)`);
  }
  if (!items.length) return '없음';
  return items.length > max ? `${items.slice(0, max).join(' · ')} 등 ${items.length}종` : items.join(' · ');
}

function villainChart(s: Scenario): { cells: ChartCells; action: Action } | null {
  const v = s.villain;
  if (!v) return null;
  switch (s.kind) {
    case 'vs_open': {
      const sc: Scenario = { kind: 'rfi', hero: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'raise' } : null;
    }
    case 'vs_3bet': {
      const sc: Scenario = { kind: 'vs_open', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'threebet' } : null;
    }
    case 'vs_4bet': {
      const sc: Scenario = { kind: 'vs_3bet', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'fourbet' } : null;
    }
    case 'vs_5bet': {
      const sc: Scenario = { kind: 'vs_4bet', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'allin' } : null;
    }
    default:
      return null;
  }
}

/** The range hero arrived with (opening range for vs_3bet, 3-bet range for vs_4bet, 4-bet range for vs_5bet). */
function previousRange(s: Scenario): { cells: ChartCells; action: Action; label: string } | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_3bet': {
      const sc: Scenario = { kind: 'rfi', hero: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'raise', label: '내 오픈 레인지' } : null;
    }
    case 'vs_4bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_open', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'threebet', label: '내 3벳 레인지' } : null;
    }
    case 'vs_5bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_3bet', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'fourbet', label: '내 4벳 레인지' } : null;
    }
    default:
      return null;
  }
}

function heroIsIP(s: Scenario): boolean {
  if (s.kind === 'rfi') return s.hero !== 'SB'; // assume the BB (or a later caller) defends
  const v = s.villain ?? s.extras?.threeBettor;
  return v ? heroInPosition(s.hero, v) : s.hero !== 'SB';
}

/* ------------------------------------------------------------------ */
/* Card helpers for examples (♠/♦ only, no collisions with my cards)   */
/* ------------------------------------------------------------------ */

type SuitGlyph = '♠' | '♦';
interface ExCard {
  r: string; // rank letter (T for ten)
  s: SuitGlyph;
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const rankV = (r: string) => RANK_ORDER.indexOf(r) + 2;
const rankOf = (v: number) => (v === 1 ? 'A' : RANK_ORDER[v - 2]);
const show = (r: string) => (r === 'T' ? '10' : r);
/** Korean particle after a rank read out loud (10=십, 8=팔, 7=칠, 6=육, 3=삼 end in a consonant; A=에이스, K=케이, 9=구 … in a vowel). */
const CONSONANT_RANKS = new Set(['T', '8', '7', '6', '3']);
function rp(rank: string, particle: '가' | '를' | '는' | '와'): string {
  const consonant: Record<typeof particle, string> = { 가: '이', 를: '을', 는: '은', 와: '과' };
  return `${show(rank)}${CONSONANT_RANKS.has(rank) ? consonant[particle] : particle}`;
}
/**
 * Hand name + particle. Pairs keep the chart spelling and are read letter by letter (TT=티티, QQ=큐큐, 99=구구 → 가/는;
 * 88=팔팔, 77=칠칠, 66=육육, 33=삼삼 → 이/은). Non-pairs end in s/o read as 수티드/오프수트 ("AJs는").
 */
const PAIR_CONSONANT_RANKS = new Set(['8', '7', '6', '3']);
function hp(info: HandInfo, particle: '가' | '는'): string {
  if (info.kind !== 'pair') return `${info.name}${particle}`;
  const consonant: Record<typeof particle, string> = { 가: '이', 는: '은' };
  return `${info.name}${PAIR_CONSONANT_RANKS.has(info.high) ? consonant[particle] : particle}`;
}
const cardStr = (c: ExCard) => `${show(c.r)}${c.s}`;
const key = (c: ExCard) => `${c.r}${c.s}`;

/** Deterministic cards for the hero's hand: suited → ♠♠, otherwise ♠ + ♦. */
function heroCards(info: HandInfo): [ExCard, ExCard] {
  if (info.kind === 'suited') return [{ r: info.high, s: '♠' }, { r: info.low, s: '♠' }];
  return [{ r: info.high, s: '♠' }, { r: info.low, s: '♦' }];
}

const OTHER: Record<SuitGlyph, SuitGlyph> = { '♠': '♦', '♦': '♠' };

/** One card of `rank` that is not already used; prefers `pref`. Falls back to the bare rank when both suits are taken. */
function freeCard(rank: string, pref: SuitGlyph, taken: Set<string>, forbid?: SuitGlyph): string {
  // forbid는 '요청한 무늬' 가 아니라 '대체 무늬' 만 막습니다 — 뒤집혔을 때만 히어로에게 없던 드로우가 생깁니다.
  for (const s of [pref, OTHER[pref]].filter((x, i) => i === 0 || x !== forbid)) {
    const c: ExCard = { r: rank, s };
    if (!taken.has(key(c))) {
      taken.add(key(c));
      return cardStr(c);
    }
  }
  return show(rank);
}

/**
 * Render an opponent hand ("AK", "A5s", "QQ") with suits, avoiding every card already used in this explanation.
 * The cards it picks are added to `taken`: the three example lines sit in one stacked list and read as one deal,
 * so a card may appear only once across them (docs/PLAIN_KO_STYLE.md §3). When no free suit is left the hand
 * falls back to its bare chart name ("A5s", "KK") — the shape the guide itself uses ("상대의 A5s 블러프").
 */
function oppHand(name: string, taken: Set<string>): string {
  const hi = name[0];
  const lo = name[1];
  const suited = name[2] === 's';
  const use = (...cs: ExCard[]) => {
    for (const c of cs) taken.add(key(c));
    return cs.map(cardStr).join('');
  };
  if (hi === lo) {
    const a: ExCard = { r: hi, s: '♠' };
    const b: ExCard = { r: hi, s: '♦' };
    if (taken.has(key(a)) || taken.has(key(b))) return `${hi}${hi}`;
    return use(a, b);
  }
  if (suited) {
    for (const s of ['♦', '♠'] as SuitGlyph[]) {
      const a: ExCard = { r: hi, s };
      const b: ExCard = { r: lo, s };
      if (!taken.has(key(a)) && !taken.has(key(b))) return use(a, b);
    }
    return name;
  }
  // Offsuit hands must READ offsuit: try both suit assignments and fall back to the bare chart name.
  for (const [a, b] of [['♦', '♠'], ['♠', '♦']] as Array<[SuitGlyph, SuitGlyph]>) {
    const c1: ExCard = { r: hi, s: a };
    const c2: ExCard = { r: lo, s: b };
    if (!taken.has(key(c1)) && !taken.has(key(c2))) return use(c1, c2);
  }
  // 무늬가 남지 않으면 차트 이름 그대로 씁니다("A10"이 아니라 "ATo") — 가이드 §3의 "상대의 A5s 블러프"와 같은 꼴입니다.
  return name;
}

/**
 * A three-card board string. Each slot takes a rank or a preference list; a rank the hero holds (or one already
 * used) is skipped for the next preference, so the suits come out exactly as requested.
 */
function board(slots: Array<string | string[]>, suits: SuitGlyph[], taken: Set<string>, forbid?: SuitGlyph): string {
  // `taken`은 이 해설의 예시 전체가 함께 쓰는 집합입니다 — 앞줄이 쓴 카드는 보드에 다시 깔리지 않습니다.
  const heldRanks = new Set(Array.from(taken, (k) => k[0]));
  const used = new Set<string>();
  const freeSuit = (r: string) => !taken.has(`${r}♠`) || !taken.has(`${r}♦`);
  return slots
    .map((slot, i) => {
      const prefs = Array.isArray(slot) ? slot : [slot];
      const pref = suits[i] ?? '♦';
      // 요청한 무늬가 살아 있는 랭크가 1순위입니다. 무늬를 뒤집으면 수티드 히어로의 보드에 ♠가 두 장 깔려
      // "아무것도 없습니다" 옆에서 플러시 드로우가 생깁니다(무늬보다 랭크를 바꾸는 편이 안전합니다).
      const fresh = (x: string) => !heldRanks.has(x) && !used.has(x);
      const r =
        prefs.find((x) => fresh(x) && !taken.has(`${x}${pref}`)) ??
        prefs.find(fresh) ??
        prefs.find((x) => !used.has(x) && freeSuit(x)) ??
        prefs[0];
      used.add(r);
      return freeCard(r, pref, taken, forbid);
    })
    .join('');
}
const DRY_BOARD: string[][] = [['K', 'Q', 'J'], ['7', '8', '6'], ['2', '3', '4']];
/**
 * Ranks for the "nothing here" dry board. A pair (88+) gets three spread ranks BELOW it (QQ → 10·7·2, JJ → 9·6·2,
 * 88 → 7·4·2) so the example never contradicts the "A나 K가 깔리면 조심" bullet next to it; every other hand keeps K·7·2.
 */
function dryRanks(info: HandInfo, cls: HandClass): Array<string | string[]> {
  if (cls === 'premium_pair' || cls === 'big_pair' || cls === 'mid_pair') {
    const top = Math.max(info.highV - 3, 7);
    return [rankOf(top), rankOf(top - 3), '2'];
  }
  return DRY_BOARD;
}
/** Suits for a "nothing here" board: a ♠♠ hero must not be handed a flush draw, so suited hands see at most one ♠. */
const drySuits = (info: HandInfo): SuitGlyph[] => (info.kind === 'suited' ? ['♦', '♠', '♦'] : ['♠', '♦', '♠']);

/**
 * Board ranks in the order every board in the app prints them: high → low, A first.
 * The wheel is the only place this matters — A-2-3-4-5 must read A♠3♦2♠, not 3♦2♠A♠.
 */
const boardOrder = (ranks: string[]): string[] => [...ranks].sort((a, b) => rankV(b) - rankV(a));

/** The three board ranks that complete a straight with `info` (connectors / gappers), lowest window first, printed high → low. */
function straightBoard(info: HandInfo): string[] | null {
  const h = info.highV;
  const l = info.lowV;
  for (let top = Math.max(h, 5); top <= Math.min(14, h + 3); top++) {
    const bottom = top - 4;
    const ranksInWindow: number[] = [];
    for (let v = top; v >= bottom; v--) ranksInWindow.push(v);
    const hv = h;
    const lv = l;
    if (!ranksInWindow.includes(hv) || !ranksInWindow.includes(lv)) continue;
    return boardOrder(ranksInWindow.filter((v) => v !== hv && v !== lv).map(rankOf));
  }
  return null;
}

/** The three wheel cards the hero still needs (2-3-4-5 minus the low card), high → low: A2s → 5♦4♠3♦, A4s → 5♦3♠2♦. */
function wheelBoard(info: HandInfo, taken: Set<string>): string {
  const wheel = ['2', '3', '4', '5'].filter((r) => r !== info.low).slice(0, 3);
  return board(boardOrder(wheel), ['♦', '♠', '♦'], taken);
}

/** A dry-ish "nothing hit" board for the hand: three spread ranks that avoid the hero's ranks. */
function missBoard(info: HandInfo, taken: Set<string>): string {
  const suits = drySuits(info);
  const pool = ['K', '9', '4', 'Q', '8', '3', 'J', '7', '2', 'T', '6', '5'];
  // 히어로 랭크와 붙은 카드는 갓샷을 만들어 "아무것도 없습니다"를 거짓말로 만듭니다 — 보드끼리도 벌려 놓습니다.
  const spread = (r: string, chosen: string[]) =>
    r !== info.high &&
    r !== info.low &&
    Math.abs(rankV(r) - info.highV) > 1 &&
    Math.abs(rankV(r) - info.lowV) > 1 &&
    chosen.every((p) => Math.abs(rankV(r) - rankV(p)) > 1);
  const chosen: string[] = [];
  for (const r of pool) {
    if (spread(r, chosen)) chosen.push(r);
    if (chosen.length === 3) break;
  }
  chosen.sort((a, b) => rankV(b) - rankV(a));
  // 요청한 무늬가 이미 쓰인 자리는 무늬를 뒤집지 않고 조건을 만족하는 다른 랭크로 바꿉니다.
  for (let i = 0; i < chosen.length; i++) {
    if (!taken.has(`${chosen[i]}${suits[i]}`)) continue;
    const others = chosen.filter((_, j) => j !== i);
    const alt = pool.find((x) => spread(x, others) && !taken.has(`${x}${suits[i]}`));
    if (alt) chosen[i] = alt;
  }
  return board(chosen, suits, taken, info.kind === 'suited' ? '♠' : undefined);
}

/** A board where the hero's pair is an overpair (three lower, spread ranks). */
function underBoard(info: HandInfo, taken: Set<string>): string | null {
  const v = info.highV;
  const ranks: string[] = [];
  for (let r = v - 2; r >= 2 && ranks.length < 3; r -= 3) ranks.push(rankOf(r));
  if (ranks.length < 3) return null;
  return board(ranks, ['♠', '♦', '♠'], taken);
}

/** The pocket pair one rank under my low card (AQ → JJ, AJ → TT, AT → 99): a genuine coin flip against a big ace. */
function underPair(info: HandInfo): string {
  const r = rankOf(Math.max(2, info.lowV - 1));
  return `${r}${r}`;
}
/** The pocket pair one rank over my high card (KQ → AA, QJ → KK, JT → QQ): an overpair to both of my cards. */
function overPair(info: HandInfo): string {
  const r = rankOf(Math.min(14, info.highV + 1));
  return `${r}${r}`;
}

/** The typical hand that beats mine on the same pair (weak aces, broadways, suited kings). */
export function dominatorOf(info: HandInfo): string | null {
  if (info.kind === 'pair') return null;
  const { high, low, lowV, highV } = info;
  if (high === 'A') {
    if (low === 'K') return null;
    if (low === 'Q') return 'AKo';
    if (lowV >= 10) return 'AQo';
    return 'AKo';
  }
  if (lowV >= 10) return `A${low}o`;
  if (high === 'K') return 'AKo';
  if (highV >= 11) return `A${high}o`;
  return null;
}

/** A hand I dominate (same pair, my kicker wins). Never a pocket pair: KQ vs "QQ" would be a set, not a kicker fight. */
export function dominatedBy(info: HandInfo): string | null {
  if (info.kind === 'pair') return null;
  const { high, low, lowV } = info;
  if (high === 'A') return low === 'K' ? 'AQo' : lowV >= 10 ? `K${low}o` : null;
  if (high === 'K' && lowV >= 10) return low === 'Q' ? 'QJo' : `Q${low}o`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Hand profile (자세히 · 손패)                                          */
/* ------------------------------------------------------------------ */

function dominators(info: HandInfo): string {
  if (info.lowV === 12) return 'AK·큰 포켓페어';
  if (info.lowV === 11) return 'AK·AQ·큰 포켓페어';
  return 'AK·AQ·AJ·큰 포켓페어';
}

/**
 * AK의 승률은 무늬에 따라 갈립니다 (work/review/eq.ts): AKs는 QQ 46 · KK 34 · AA 12, AKo는 QQ 43 · KK 30 · AA 8.
 * 한 해설 안에서 손패·왜?·예시가 서로 다른 값을 말하지 않도록 여기 한 곳에서만 꺼내 씁니다.
 */
const akEq = (suited: boolean) => (suited ? { qq: 46, kk: 34, aa: 12 } : { qq: 43, kk: 30, aa: 8 });

/**
 * 브로드웨이가 한 칸 위 오버페어를 만났을 때의 승률. 하나로 묶으면 최대 5%p 틀립니다
 * (KQo vs AA 16, KQs vs AA 18.6, QJs vs KK 20, JTs vs QQ 23).
 */
function overPairEq(info: HandInfo): number {
  const suited = info.kind === 'suited';
  if (info.high === 'J') return suited ? 23 : 20; // JT는 커넥터라 스트레이트가 잘 붙습니다
  if (info.high === 'Q') return suited ? 20 : 17;
  return suited ? 18 : 16; // K 하이
}

function handProfile(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  const suited = info.kind === 'suited';
  switch (cls) {
    case 'premium_pair':
      return n === 'AA'
        ? 'AA는 프리플랍 최강 패입니다. KK를 만나도 승률 80%입니다. 목표는 팟을 최대로 키우는 것입니다.'
        : 'KK는 두 번째로 강한 패입니다. 대부분의 레인지에 승률 80%입니다. 다만 AA에는 18%입니다. 프리플랍 폴드는 거의 없습니다.';
    case 'big_pair':
      return `${hp(info, '는')} 큰 포켓페어입니다. 대부분의 레인지보다 앞섭니다. 다만 AA·KK에는 크게 집니다. 플랍에 A나 K가 깔리면 오버페어가 아닙니다.`;
    case 'mid_pair':
      return `${hp(info, '는')} 중간 포켓페어입니다. 오버페어가 되는 보드는 많지 않습니다. 셋을 노리며 작은 팟을 이깁니다. 큰 팟에서는 상대 블러프를 잡는 역할입니다.`;
    case 'small_pair':
      return `${hp(info, '는')} 작은 포켓페어입니다. 플랍에서 셋이 될 확률은 12%입니다. 셋이 됐을 때 크게 받아 내는 임플라이드 오즈가 핵심입니다. 셋이 아니면 상대 페어보다 작습니다.`;
    case 'ak': {
      // 수티드와 오프수트는 QQ·KK·AA 모두에서 3~4%p씩 갈립니다. 세 수치를 한 곳(akEq)에서 꺼내 씁니다.
      const e = akEq(suited);
      return `${n}는 페어가 아닌 패 중 가장 강합니다. 페어가 아닌 레인지는 킥커로 이깁니다. QQ에는 ${e.qq}%, KK에는 ${e.kk}%, AA에는 ${e.aa}%입니다. A나 K가 깔리면 최고의 탑페어가 됩니다.`;
    }
    case 'big_ace':
      return `${n}는 A에 큰 킥커가 붙은 패입니다. 약한 A에는 킥커로 앞섭니다. 다만 ${dominators(info)}에는 도미네이트됩니다. 상대 레인지가 좁을수록 가치가 떨어집니다.${suited ? ' 수티드라 넛 플러시도 노립니다.' : ''}`;
    case 'suited_ace':
      return `${n}는 수티드 A입니다. 넛 플러시를 노릴 수 있고 A 블로커도 있습니다. 다만 A를 맞춰도 킥커가 약합니다. 큰 팟보다 작은 팟에 어울립니다.`;
    case 'wheel_ace':
      return `${n}는 수티드 휠 에이스입니다. 넛 플러시와 A-2-3-4-5 스트레이트를 함께 노립니다. A 블로커까지 있어 3벳·4벳 블러프 재료로 가장 좋습니다. A 페어 자체는 약합니다.`;
    case 'offsuit_ace':
      return `${n}는 오프수트 A입니다. 플러시가 없고 킥커도 약합니다. 같은 A를 맞춰도 도미네이트되기 쉽습니다. 뒷자리에서 상대 레인지가 넓을 때만 씁니다.`;
    case 'suited_broadway':
      return `${n}는 수티드 브로드웨이입니다. 탑페어·스트레이트·플러시를 고루 만듭니다. 그래서 플랍 이후가 편하고 콜 레인지의 중심입니다.`;
    case 'offsuit_broadway':
      return `${n}는 오프수트 브로드웨이입니다. 탑페어는 자주 만듭니다. 다만 킥커에서 밀리고 플러시가 없습니다. 상대 레인지가 강할 때는 콜보다 폴드나 레이즈가 낫습니다.`;
    case 'suited_king':
      return `${n}는 수티드 K입니다. K 하이 플러시와 K 블로커가 있습니다. 다만 킥커가 약해 K 탑페어만으로 큰 팟을 이기기는 어렵습니다.`;
    case 'suited_qj':
      return `${n}는 Q나 J에 낮은 카드가 붙은 수티드입니다. 플러시와 백도어를 보고 씁니다. 뒷자리 오픈이나 상대 레인지가 아주 넓을 때가 전부입니다.`;
    case 'suited_connector':
      return `${n}는 수티드 커넥터입니다. 스트레이트와 플러시로 넛을 만들 수 있습니다. 임플라이드 오즈가 좋고 낮은 보드에서 강합니다.`;
    case 'suited_gapper':
      return `${n}는 수티드 갭퍼입니다. 커넥터보다 스트레이트는 덜 됩니다. 그래도 플러시와 백도어가 있어 포지션이 있을 때 쓸 만합니다.`;
    case 'offsuit_connector':
      return `${n}는 오프수트 커넥터입니다. 스트레이트는 되지만 플러시가 없습니다. 페어도 약해 상대 레인지가 아주 넓은 BB 방어에서만 씁니다.`;
    case 'junk':
      return suited
        ? `${n}는 수티드지만 숫자가 작습니다. 플러시는 노려 볼 만합니다. 다만 큰 카드도 스트레이트도 부족해 상대 레인지가 가장 넓을 때만 씁니다.`
        : `${n}는 프리플랍 가치가 낮은 패입니다. 큰 카드가 없습니다. 플러시도 스트레이트도 기대하기 어렵습니다.`;
  }
}

/* ------------------------------------------------------------------ */
/* Hand-level rationale (자세히 · 이유)                                   */
/* ------------------------------------------------------------------ */

/*
 * 자세히 · "자세한 이유"의 첫 불릿들. 한 항목 = 한 문장(가이드 §2.1)이라 배열로 두고 그대로 불릿이 됩니다.
 * 손패 블록이 이미 말한 패 설명은 여기서 빼고, "이 자리에서 왜 그 결정인가"만 남깁니다(가이드 §2.4).
 */
const OPEN: Record<HandClass, string[]> = {
  premium_pair: ['가장 강한 패라 오픈으로 팟을 키웁니다.', '3벳을 받으면 4벳으로 더 받아 냅니다.'],
  big_pair: ['대부분의 레인지보다 앞서 밸류로 오픈합니다.', '3벳을 받아도 편하게 계속 갑니다.'],
  mid_pair: ['오픈 레인지에서 안정적인 패입니다.', '끝까지 가도 페어로 이길 때가 있습니다.'],
  small_pair: ['셋마이닝이 되는 패라 오픈합니다.', '3벳을 받으면 보통 폴드합니다.', '스택이 깊고 포지션이 있으면 콜도 됩니다.'],
  ak: ['밸류와 플랍 이후 플레이를 다 갖춘 오픈 패입니다.', '3벳을 받으면 4벳이나 콜로 계속 갑니다.'],
  big_ace: ['약한 A와 브로드웨이를 킥커로 이깁니다.', '3벳에는 보통 콜로 대응합니다.'],
  suited_ace: ['넛 플러시와 A 블로커 덕분에 어느 자리에서든 오픈합니다.', '3벳에는 폴드하거나 4벳 블러프로 씁니다.'],
  wheel_ace: ['넛 가능성과 A 블로커로 오픈 레인지에 항상 들어갑니다.', '3벳을 받으면 4벳 블러프 후보입니다.'],
  offsuit_ace: ['뒷자리에서 블라인드를 노리고 오픈합니다.', '킥커가 약해 3벳에는 폴드합니다.'],
  suited_broadway: ['앞자리부터 뒷자리까지 어디서든 오픈하는 패입니다.', '3벳을 받아도 콜로 플랍을 봅니다.'],
  offsuit_broadway: ['뒷자리에서만 오픈합니다.', '앞자리 레인지에는 들어가지 않습니다.'],
  suited_king: ['뒷자리에서 오픈하는 아래쪽 패입니다.', '3벳에는 대부분 폴드합니다.'],
  suited_qj: ['뒷자리에서만 오픈하는 아래쪽 패입니다.', '3벳에는 폴드가 기본입니다.'],
  suited_connector: ['넛을 만들 수 있어 오픈 레인지의 균형을 잡아 줍니다.', '낮은 보드에서 강합니다.'],
  suited_gapper: ['뒷자리 오픈 레인지의 아래쪽입니다.', '플랍에서 드로우가 붙어야 계속 갑니다.'],
  offsuit_connector: ['아주 넓게 오픈하는 자리에서만 씁니다.', '노리는 것은 블라인드입니다.'],
  junk: ['아주 넓게 오픈하는 자리에서만 씁니다.', '노리는 것은 블라인드입니다.'],
};

const AGGRESSIVE: Record<HandClass, string[]> = {
  premium_pair: ['밸류로 최대한 받아 냅니다.', '상대가 콜하거나 다시 올릴수록 이득입니다.'],
  big_pair: ['상대 레인지 대부분보다 앞서 밸류로 올립니다.', '상대가 더 세게 올리면 AA·KK를 생각하고 속도를 줄입니다.'],
  mid_pair: ['상대의 넓은 레인지보다 앞섭니다.', '상대가 폴드할 가능성도 함께 챙깁니다.', '다시 올라오면 폴드하거나 콜로 셋을 노립니다.'],
  small_pair: ['상대가 폴드할 가능성과 셋 확률을 함께 노립니다.', '다시 올라오면 폴드가 기본입니다.'],
  ak: ['밸류와 폴드 유도를 다 갖춘 최고의 공격 패입니다.', '다시 올라와도 승률이 충분합니다.'],
  big_ace: ['약한 A와 브로드웨이에서 밸류를 받습니다.', 'AK·큰 포켓페어가 다시 올리면 물러납니다.'],
  // 프리플랍에는 드로우가 없습니다 — "세미 블러프(드로우를 들고 하는 블러프)"는 플랍 이후 계획에서만 씁니다.
  suited_ace: ['A 블로커로 상대의 최상위 레인지를 줄이는 블러프 레이즈입니다.', '콜을 받아도 넛 플러시를 노립니다.'],
  wheel_ace: ['A 블로커와 넛 가능성을 가진 블러프 레이즈입니다.', '콜하면 킥커에서 밀리니 레이즈가 낫습니다.'],
  offsuit_ace: ['A 블로커로 폴드를 유도합니다.', '다시 올라오면 바로 폴드합니다.'],
  suited_broadway: ['밸류와 플랍 이후 플레이를 함께 갖췄습니다.', '콜을 받아도 보드가 편합니다.'],
  offsuit_broadway: ['콜하면 킥커에서 밀릴 위험이 큽니다.', '올려서 폴드를 받는 쪽이 낫습니다.', '다시 올라오면 폴드합니다.'],
  suited_king: ['K 블로커와 플러시 가능성을 가진 블러프 레이즈입니다.'],
  suited_qj: ['블로커와 플러시 가능성으로 가끔 섞는 블러프입니다.'],
  suited_connector: ['넓은 레인지에서 폴드를 받습니다.', '콜을 받아도 넛 가능성으로 균형이 맞습니다.'],
  suited_gapper: ['폴드를 노리는 블러프입니다.', '콜을 받으면 플러시·스트레이트로 플레이합니다.'],
  offsuit_connector: ['상대 레인지가 넓을 때 폴드를 노립니다.'],
  junk: ['상대 레인지가 넓을 때만 폴드를 노립니다.'],
};

const CALL: Record<HandClass, string[]> = {
  premium_pair: ['3벳하지 않고 상대 블러프를 살려 두는 트랩입니다.', '상대 레인지가 최상위와 블러프로 갈릴 때 잘 통합니다.'],
  big_pair: ['다시 올리면 AA·KK만 남습니다.', '콜로 팟 크기를 조절하며 약한 레인지를 붙잡아 둡니다.'],
  mid_pair: ['내 페어보다 큰 카드가 자주 깔립니다.', '팟을 키우기보다 셋 가능성과 페어의 힘을 함께 가져갑니다.'],
  small_pair: ['셋마이닝 콜입니다.', '상대 스택이 깊고 뒤에서 스퀴즈당할 위험이 낮을 때만 합니다.'],
  ak: ['상대 레인지가 강해 다시 올리면 더 강한 패만 남습니다.', '콜로 승률을 살립니다.'],
  big_ace: ['다시 올리면 내가 이기는 패는 폴드합니다.', '나를 이기는 패만 남으니 콜이 낫습니다.'],
  suited_ace: ['넛 플러시 가능성과 A 하이의 힘으로 플랍을 봅니다.', '3벳은 킥커가 약해 밸류가 부족합니다.'],
  wheel_ace: ['넛 플러시와 휠 스트레이트를 노립니다.', '붙으면 크게 받아 내는 임플라이드 오즈가 있습니다.'],
  offsuit_ace: ['상대 레인지가 넓을 때만 콜합니다.', 'A가 깔려도 킥커 때문에 큰 팟은 피합니다.'],
  suited_broadway: ['플랍 이후가 편한 콜 레인지의 중심입니다.', '브로드웨이끼리는 킥커에서 밀릴 위험이 적습니다.'],
  offsuit_broadway: ['탑페어를 자주 만들어 콜합니다.', '맞고도 더 큰 패에 지는 위험 때문에 큰 팟은 피합니다.'],
  suited_king: ['K 하이 플러시와 백도어를 보고 싸게 플랍을 봅니다.'],
  suited_qj: ['플러시와 백도어를 보고 하는 콜입니다.', '상대 레인지가 넓을 때만 합니다.'],
  suited_connector: ['넛 스트레이트·플러시로 큰 팟을 이길 수 있습니다.', '임플라이드 오즈를 보고 콜합니다.'],
  suited_gapper: ['넛 가능성과 백도어를 보고 하는 콜입니다.'],
  offsuit_connector: ['싼값에 스트레이트를 노리는 콜입니다.'],
  junk: ['이미 낸 블라인드 덕분에 값이 아주 쌉니다.', '플랍에서 크게 맞지 않으면 바로 접습니다.'],
};

const FOLD: Record<HandClass, string[]> = {
  premium_pair: [],
  big_pair: ['상대 레인지가 AA·KK 위주라 승률이 부족합니다.'],
  mid_pair: ['상대 레인지에 오버페어가 많습니다.', '셋을 맞춰도 받아 낼 스택이 부족합니다.'],
  small_pair: ['셋 확률 12%에 비해 받아 낼 스택이 부족합니다.', '셋이 아니면 이길 길이 없습니다.'],
  ak: ['상대 레인지가 KK 이상 위주라 AK도 승률이 부족합니다.'],
  big_ace: ['AK·AQ·큰 포켓페어에 도미네이트됩니다.', 'A를 맞추고도 킥커에서 크게 잃습니다.'],
  suited_ace: ['이 자리에서는 킥커가 약해 밸류가 부족합니다.', '콜할 임플라이드 오즈도 모자랍니다.'],
  wheel_ace: ['블러프 레이즈 빈도는 이미 충분합니다.', '콜하기에는 A 페어가 너무 약합니다.'],
  offsuit_ace: ['이 자리 레인지에는 약한 A가 들어가지 않습니다.'],
  // 결론(shortReason)이 이미 "상대 레인지가 강해 킥커에서 밀립니다"를 씁니다 — 이유는 다른 근거를 말합니다.
  suited_broadway: ['같은 브로드웨이라도 상대 레인지에는 더 좋은 킥커가 많습니다.', '수티드만 보고 큰 팟에 들어갈 패는 아닙니다.'],
  offsuit_broadway: ['상대 레인지가 강할 때는 탑페어로도 부족합니다.'],
  suited_king: ['이 자리 레인지에 들어가기에는 킥커가 약합니다.'],
  suited_qj: ['하이카드의 힘이 부족합니다.', '플러시만으로는 이 자리의 값을 감당하지 못합니다.'],
  suited_connector: ['이 자리에서는 드로우 가능성만으로 부족합니다.', '상대의 강한 레인지를 이기지 못합니다.'],
  suited_gapper: ['갭이 있어 스트레이트가 잘 안 됩니다.', '하이카드의 힘도 부족합니다.'],
  offsuit_connector: ['플러시가 없고 하이카드의 힘도 낮습니다.'],
  junk: ['가장 넓은 오픈 레인지에도 들어가지 않습니다.'],
};

/** All-in nodes (vs_5bet, and 'allin' answers) need their own wording — there is no re-raise to talk about. */
function allInRationale(step: Step, cls: HandClass): string[] {
  const { answer, scenario: s } = step;
  const isAA = step.hand === 'AA';
  if (s.kind === 'vs_5bet') {
    if (answer === 'call') {
      // KK는 그 레인지 전부를 이기지 않습니다: AA에는 18%, KK끼리는 찹입니다.
      if (cls === 'premium_pair')
        return isAA
          ? ['상대의 올인 레인지는 KK 이상·AK입니다.', '그보다도 크게 앞서니 콜합니다.']
          : ['상대의 올인 레인지는 KK 이상·AK입니다.', 'AA에만 지고 KK와는 찹, 나머지에는 크게 앞섭니다.'];
      if (cls === 'ak') return ['내 A와 K가 블로커라 상대의 AA·KK 조합이 절반으로 줄어듭니다.', 'AK끼리는 비기는 판이 많습니다.', '필요 승률 38~40%를 넘깁니다.'];
      return ['상대의 올인 레인지에 QQ·AK가 충분히 섞입니다.', '필요 승률 38~40%를 넘깁니다.'];
    }
    if (cls === 'wheel_ace' || cls === 'suited_ace') return ['4벳은 블러프였습니다.', '블로커의 역할은 거기서 끝났습니다.'];
    if (cls === 'big_pair' || cls === 'ak') return ['상대의 올인 레인지는 KK 이상·AK입니다.', '필요 승률 38~40%에 못 미칩니다.', '이미 넣은 칩은 잊고 남은 결정만 봅니다.'];
    return ['상대의 올인 레인지를 이길 승률이 부족합니다.'];
  }
  // answer === 'allin' (5-bet jam) in vs_4bet
  switch (cls) {
    case 'premium_pair':
      return [
        '상대의 4벳 레인지는 QQ 이상·AK에 A5s 블러프입니다.',
        isAA ? '그 전부보다 앞섭니다.' : '그중 AA에만 지고 나머지에는 앞섭니다.',
        '밸류로 다 받고 블러프의 폴드도 챙깁니다.',
      ];
    case 'big_pair':
    case 'ak':
      return ['콜하면 포지션 없이 얕은 스택으로 플레이해야 합니다.', '올인하면 상대의 4벳 블러프가 폴드합니다.', 'AK·JJ와는 앞서거나 반반입니다.'];
    case 'wheel_ace':
    case 'suited_ace':
      return ['A 블로커로 상대의 AA·AK를 줄이는 블러프 올인입니다.', '콜을 받아도 승률 30%쯤은 됩니다.', '상대 4벳 레인지가 넓을 때만 씁니다.'];
    default:
      return ['상대의 4벳 블러프는 폴드시킵니다.', '강한 패와는 반반 승부를 받습니다.'];
  }
}

/* ------------------------------------------------------------------ */
/* Scenario-level reasoning (자세히)                                     */
/* ------------------------------------------------------------------ */

function scenarioLines(step: Step): string[] {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const out: string[] = [];
  const vc = villainChart(s);
  const vShare = vc ? rangeShare(vc.cells, vc.action) : null;
  const ip = heroIsIP(s);
  const vPct = vShare == null ? '?' : pct(vShare);

  switch (s.kind) {
    case 'rfi': {
      const openShare = rangeShare(step.cells, 'raise');
      if (hero === 'SB') {
        out.push(`SB는 BB 한 명만 남아 약 ${pct(openShare)}로 넓게 오픈합니다.`);
        out.push('다만 플랍 이후 항상 먼저 액션합니다.');
        out.push('그래서 3bb로 크게 올려 BB의 콜을 줄입니다.');
      } else if (hero === 'BTN') {
        out.push(`BTN은 블라인드 둘만 상대해 약 ${pct(openShare)}로 가장 넓게 오픈합니다.`);
        out.push('플랍 이후에도 항상 포지션이 있습니다.');
      } else {
        out.push(`${seat(hero, '는')} 뒤에 ${seatsBehind(hero)}명이 남아 오픈 레인지가 약 ${pct(openShare)}입니다.`);
        out.push('뒤에 사람이 많을수록 3벳을 맞을 확률이 큽니다.');
        out.push('포지션 없이 플레이할 확률도 함께 올라갑니다.');
      }
      break;
    }
    case 'vs_open': {
      out.push(`${seat(v!, '는')} 전체의 약 ${vPct}로 오픈합니다.`);
      if (isEarly(v)) {
        out.push('앞자리라 레인지가 강합니다.');
        out.push('브로드웨이나 중간 A는 킥커에서 밀려 방어 레인지를 좁힙니다.');
      } else {
        out.push('뒷자리라 약한 패가 많이 섞여 있습니다.');
        out.push('그래서 더 넓게 방어하고 3벳도 더 자주 합니다.');
      }
      if (hero === 'BB') {
        if (v === 'SB') {
          out.push('BB는 이미 1bb를 냈으니 2bb만 더 내고 약 6bb 팟을 봅니다.');
          out.push('필요 승률은 33%입니다.');
          out.push('SB 상대로는 포지션이 있어 가장 넓게 방어합니다.');
        } else {
          out.push('BB는 이미 1bb를 냈으니 1.5bb만 더 내고 약 5.5bb 팟을 봅니다.');
          out.push('필요 승률은 27%입니다.');
          out.push('마지막 차례라 스퀴즈 걱정 없이 가장 넓게 콜합니다.');
        }
      } else if (hero === 'SB') {
        if (answer === 'call') {
          out.push('SB는 보통 3벳 아니면 폴드지만 이 패는 예외로 콜합니다.');
          out.push('2bb를 더 내고 약 6bb 팟을 봅니다.');
          out.push('BB의 스퀴즈와 포지션 불리는 감수합니다.');
        } else {
          out.push('SB는 콜하면 BB의 스퀴즈와 포지션 불리가 겹칩니다.');
          out.push('그래서 3벳 아니면 폴드 위주로 대응합니다.');
        }
      } else {
        out.push(`${seat(hero, '는')} 포지션은 있지만 뒤에 ${seatsBehind(hero)}명이 남습니다.`);
        out.push('그래서 스퀴즈를 맞아도 버틸 패로 콜 레인지를 제한합니다.');
        out.push('2.5bb를 내고 약 6.5bb 팟을 봅니다.');
      }
      break;
    }
    case 'vs_3bet': {
      out.push(`${seat(v!, '는')} 전체의 약 ${vPct}로 3벳합니다.`);
      out.push(isBlind(v) ? '밸류와 블러프가 섞인 레인지입니다.' : '밸류 위주의 레인지입니다.');
      if (isBlind(v)) {
        out.push('블라인드의 3벳은 약 10~11bb입니다.');
        out.push('8bb를 더 내고 약 22bb 팟을 봅니다.');
        out.push('필요 승률은 36%입니다.');
        out.push(ip ? '포지션이 있어 콜해도 끝까지 싸우기 좋습니다.' : '포지션이 없어 콜 레인지를 좁히고 4벳이나 폴드를 늘립니다.');
      } else {
        out.push('뒷자리의 3벳은 약 7.5bb입니다.');
        out.push('5bb를 더 내고 약 16.5bb 팟을 봅니다.');
        out.push('필요 승률은 30%입니다.');
        out.push('다만 플랍 이후 먼저 액션해야 해서 실제로는 더 어렵습니다.');
      }
      break;
    }
    case 'vs_4bet': {
      out.push(`${seat(v!, '는')} 전체의 약 ${vPct}로 4벳합니다.`);
      out.push(`상대 4벳 레인지: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내 3벳 레인지 중 올인하는 패: ${summarizeRange(step.cells, 'allin', 6)}.`);
      out.push(`콜하는 패: ${summarizeRange(step.cells, 'call', 6)}. 나머지는 폴드합니다.`);
      out.push('4벳 사이즈는 약 22~25bb입니다.');
      out.push('콜하면 남은 스택이 팟의 1~1.5배인 큰 팟이 됩니다.');
      out.push('필요 승률은 30%입니다.');
      out.push('다만 SPR이 낮아 플랍에서 사실상 올인까지 갑니다.');
      break;
    }
    case 'vs_5bet': {
      out.push(`${seat(v!, '는')} 전체의 약 ${vPct}로 올인합니다.`);
      out.push(`상대 올인 레인지: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내 4벳 레인지 중 콜하는 패: ${summarizeRange(step.cells, 'call', 6)}.`);
      out.push('블러프로 4벳한 패(A5s 등)는 당연히 폴드합니다.');
      out.push('4벳 22~25bb 뒤 100bb 올인입니다.');
      out.push('콜에 필요한 승률은 38~40%입니다.');
      out.push('이미 넣은 4벳 칩은 돌아오지 않으니 잊습니다.');
      break;
    }
    case 'cold_4bet': {
      out.push('앞에 오픈과 3벳이 모두 있어 두 레인지를 동시에 상대합니다.');
      out.push('콜하면 오픈한 사람이 다시 4벳할 수도 있습니다.');
      if (answer === 'call') {
        out.push('여기서 콜은 드문 예외입니다.');
        // 이 자리에 오는 패는 포켓페어만이 아닙니다(AQs). 페어가 아닌 패에게 셋 이야기를 하면 안 됩니다.
        out.push(parseHandName(step.hand).kind === 'pair' ? '셋 같은 강한 패를 노리고 3벳 팟을 봅니다.' : '포지션과 팟 오즈를 보고 플랍을 봅니다.');
        out.push('오픈한 사람이 4벳하면 폴드합니다.');
      } else {
        out.push('여기서 4벳하는 레인지는 KK 이상과 A5s 같은 블러프뿐입니다.');
        out.push('콜은 QQ·AK 정도로만 가끔 합니다.');
        out.push('나머지는 모두 폴드합니다.');
      }
      break;
    }
  }
  return out;
}

function reasoning(step: Step, cls: HandClass): string[] {
  const { scenario: s, answer } = step;
  const lines = scenarioLines(step);
  const mixed = foldWeight(step.mix) > 0 && foldWeight(step.mix) < 1;
  const isAggressive = answer === 'raise' || answer === 'threebet' || answer === 'fourbet' || answer === 'allin';

  let handLines: string[];
  if (s.kind === 'vs_5bet' || answer === 'allin') handLines = allInRationale(step, cls);
  else if (s.kind === 'rfi' && answer === 'raise') handLines = OPEN[cls];
  else if (isAggressive) handLines = AGGRESSIVE[cls];
  else if (answer === 'call') handLines = CALL[cls];
  else handLines = FOLD[cls].length ? FOLD[cls] : ['이 자리에서는 폴드가 가장 손해가 적습니다.'];

  const out = [...handLines];
  if (answer === 'fold' && mixed) out.unshift('기본은 폴드지만 가끔은 계속 갑니다.');
  else if (answer !== 'fold' && step.mixList.length >= 2) {
    const alt = step.mixList[1];
    // 폴드가 아닌 섞임은 왜? 불릿(easyWhy)과 바로 아래 혼합 빈도(mixNote)가 이미 말합니다 — 여기서 또 쓰지 않습니다.
    if (alt && alt.action === 'fold' && mixed) out.push(`경계에 있는 패라 ${pctInt(alt.weight)}는 폴드합니다.`);
  }
  out.push(...lines);

  const ip = heroIsIP(s);
  // BB는 싱글 레이즈 팟에서 마지막 차례라 "가장 넓게 콜합니다"가 맞는 자리입니다. 거기에 "강한 패 위주로만 콜"을
  // 덧붙이면 같은 목록이 두 가지 반대를 말합니다(SB는 이미 같은 이유로 빠져 있습니다).
  if (answer === 'call' && !ip && s.kind !== 'vs_5bet' && !(s.kind === 'vs_open' && (s.hero === 'SB' || s.hero === 'BB'))) {
    out.push('포지션 없이 콜하니 체크-콜이나 체크-레이즈 계획이 필요합니다.');
    out.push('끝까지 싸우기 어려운 만큼 강한 패 위주로만 콜합니다.');
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Range context / mix note                                            */
/* ------------------------------------------------------------------ */

function rangeContext(step: Step): string {
  const { answer, scenario: s } = step;
  const prev = previousRange(s);
  const label = ACTION_SHORT_KO[answer];
  if (prev) {
    const prevShare = rangeShare(prev.cells, prev.action);
    const cont = rangeShare(step.cells);
    const contOfPrev = prevShare > 0 ? cont / prevShare : 0;
    if (answer === 'fold') return `${prev.label} 중 약 ${pct(contOfPrev)}만 계속 갑니다. 이 패는 거기에 없습니다.`;
    const actShare = rangeShare(step.cells, answer);
    return `${prev.label} 중 약 ${pct(contOfPrev)}가 계속 갑니다. ${label}은 약 ${pct(prevShare > 0 ? actShare / prevShare : 0)}이고, 이 패가 그 안에 있습니다.`;
  }
  const total = rangeShare(step.cells);
  if (answer === 'fold') return `이 자리에서 ${seat(s.hero, '가')} 계속 가는 레인지는 전체의 약 ${pct(total)}입니다. 이 패는 거기에 없습니다.`;
  const share = rangeShare(step.cells, answer);
  const extra = Math.abs(share - total) > 0.001 ? ` 계속 가는 패는 다 합쳐 약 ${pct(total)}입니다.` : '';
  return `${label} 레인지는 전체의 약 ${pct(share)}이고, 이 패가 그 안에 있습니다.${extra}`;
}

function mixNote(step: Step): string | undefined {
  const list = step.mixList;
  if (list.length <= 1) return undefined;
  const parts = list.map((m) => `${ACTION_SHORT_KO[m.action]} ${Math.round(m.weight * 100)}%`).join(' / ');
  const fold = foldWeight(step.mix);
  const tie = list.length >= 2 && Math.abs(list[0].weight - list[1].weight) < 1e-6;
  const tieNote = tie ? '빈도가 같으면 더 공격적인 쪽을 정답으로 삼습니다.' : '외울 때는 가장 자주 하는 쪽을 정답으로 삼습니다.';
  let tip: string;
  if (step.scenario.kind === 'rfi') tip = '뒤에 3벳이 잦은 사람이 있으면 폴드 쪽입니다. 조심스러운 사람만 남았으면 오픈 쪽입니다.';
  else if (fold > 0 && fold < 1) tip = '경계에 있는 패입니다. 상대가 강한 패만 하면 폴드 쪽입니다. 아무 패나 하면 계속 가는 쪽입니다.';
  else tip = '섞어서 하는 패입니다. 상대가 4벳·5벳을 자주 하면 콜 쪽입니다. 자주 폴드하면 공격 쪽입니다.';
  return `기준 전략 빈도: ${parts}. ${tieNote} ${tip}`;
}

/* ------------------------------------------------------------------ */
/* Postflop plan (자세히 · 플랍 이후)                                      */
/* ------------------------------------------------------------------ */

type PotType = 'srp' | '3bp' | '4bp';

function potTypeAfter(step: Step): { pot: PotType; aggressor: boolean } | null {
  const { scenario: s, answer } = step;
  switch (s.kind) {
    case 'rfi':
      return answer === 'raise' ? { pot: 'srp', aggressor: true } : null;
    case 'vs_open':
      return answer === 'call' ? { pot: 'srp', aggressor: false } : answer === 'threebet' ? { pot: '3bp', aggressor: true } : null;
    case 'vs_3bet':
      return answer === 'call' ? { pot: '3bp', aggressor: false } : answer === 'fourbet' ? { pot: '4bp', aggressor: true } : null;
    case 'vs_4bet':
      return answer === 'call' ? { pot: '4bp', aggressor: false } : null; // allin: no postflop decision
    case 'vs_5bet':
      return null;
    case 'cold_4bet':
      return answer === 'call' ? { pot: '3bp', aggressor: false } : answer === 'fourbet' ? { pot: '4bp', aggressor: true } : null;
  }
}

const POT_LABEL: Record<PotType, string> = { srp: '싱글 레이즈 팟', '3bp': '3벳 팟', '4bp': '4벳 팟' };
/** 한 줄에 사실 하나. 앞줄이 SPR 수치, 뒷줄이 그 수치가 뜻하는 플레이입니다. */
const SPR_LINES: Record<PotType, string[]> = {
  srp: ['SPR이 10~18로 깊습니다.', '페어 하나로 스택을 다 넣지 않습니다.', '셋·투페어·강한 드로우가 올인까지 가는 패입니다.'],
  '3bp': ['SPR이 4~6으로 중간입니다.', '오버페어나 톱 킥커 탑페어는 대체로 끝까지 갑니다.', '약한 탑페어는 두 번 벳이 한계입니다.'],
  '4bp': ['SPR이 1~1.5로 얕습니다.', '오버페어·탑페어·강한 드로우면 올인이 기본입니다.', '플랍에서 사실상 마지막 결정을 합니다.'],
};

function postflopPlan(step: Step, cls: HandClass): PostflopPlan | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const { scenario: s } = step;
  const hero = s.hero;
  const ip = heroIsIP(s);
  const info = parseHandName(step.hand);
  const four = pt.pot === '4bp';
  const bet = pt.aggressor ? '벳합니다' : '체크-레이즈하거나 콜합니다';

  // 한 항목 = 한 가지 확인 (가이드 §2.1). 확인할 것과 그 답을 한 줄에 붙여, 혼자서는 읽히지 않는 뒷줄을 없앱니다.
  const checklist: string[] = [
    '보드 주도권 — A·K 하이와 브로드웨이 보드는 레이즈한 쪽 것입니다.',
    '낮고 이어진 보드 — 8♠7♦6♠ 같은 보드는 콜한 쪽 것입니다.',
    '넛 분포 — 셋·스트레이트를 더 많이 가진 쪽이 크게 벳합니다.',
    '내 패 — 완성된 패인지, 드로우인지, 아무것도 없는지 나눕니다.',
    '보드 질감 — 드라이 보드는 팟의 25~33%, 웻 보드는 60~75%로 벳합니다.',
    ip ? '포지션 — 나는 나중에 액션하니 상대 체크를 보고 정합니다.' : '포지션 — 나는 먼저 액션하니 체크-콜·체크-레이즈를 준비합니다.',
    '상대 성향 — 벳·콜 빈도가 평균과 다른 쪽에서 이득을 찾습니다.',
  ];

  let good = '';
  let bad = '';
  const plan: string[] = [];
  // 무늬 안내는 따로 한 줄로 둡니다 — 다른 문장에 이어 붙이면 그 불릿이 두 가지를 말하게 됩니다(가이드 §2.1).
  const suitedNote = info.kind === 'suited' ? ['같은 무늬가 두 장 깔리면 플러시 드로우, 한 장이면 백도어입니다.'] : [];

  switch (cls) {
    case 'premium_pair':
    case 'big_pair':
      good = `내 페어보다 낮은 카드만 깔린 보드. ${cls === 'big_pair' ? 'A·K가 없는' : '거의 모든'} 보드에서 밸류로 ${bet}.`;
      bad = cls === 'big_pair' ? 'A나 K가 깔린 보드. 거기서는 탑페어에도 밀립니다. 4장이 이어진 보드와 한 무늬 3장 보드.' : '4장이 이어진 보드. 한 무늬 3장 보드. 상대가 세게 버텨 셋이 의심될 때.';
      if (four) {
        plan.push('오버페어면 플랍에서 벳하거나 올인합니다.');
        plan.push('내 페어보다 큰 카드 한 장은 무시하고 끝까지 갑니다.');
        plan.push(cls === 'big_pair' ? 'A와 K가 둘 다 깔린 보드에서만 폴드합니다.' : '사실상 어떤 보드에서도 스택을 다 넣습니다.');
      } else {
        plan.push(pt.aggressor ? '오버페어면 플랍·턴·리버 세 번 벳해서 밸류를 받습니다.' : '오버페어면 체크-레이즈하거나 두세 번 콜하며 밸류를 받습니다.');
        if (pt.aggressor) plan.push('드라이 보드는 작게, 웻 보드는 크게 갑니다.');
        plan.push(cls === 'big_pair' ? '내 페어보다 큰 카드가 깔리면 팟 컨트롤합니다.' : '상대가 다시 올려도 대부분 콜하거나 또 올립니다.');
        plan.push(cls === 'big_pair' ? '한 번 벳하고 체크, 크게 올라오면 폴드도 생각합니다.' : '4장이 이어진 보드에서만 속도를 줄입니다.');
      }
      break;
    case 'mid_pair':
    case 'small_pair':
      good = '셋을 맞춘 보드. 확률은 12%입니다. 낮은 보드에서 내 페어가 오버페어일 때도 좋습니다.';
      bad = '내 페어보다 큰 카드가 2장 이상 깔렸는데 상대가 벳할 때.';
      if (four) {
        plan.push('오버페어면 올인합니다.');
        plan.push('큰 카드가 한 장이면 상대 벳 사이즈를 보고, 두 장이면 폴드합니다.');
        plan.push('셋이면 어떤 보드에서든 스택을 다 넣습니다.');
      } else {
        plan.push('셋이면 웻 보드에서 바로 벳하거나 레이즈해 팟을 키웁니다.');
        plan.push('드라이 보드에서는 한 번쯤 천천히 가도 됩니다.');
        plan.push(cls === 'small_pair' ? '셋이 아니면 상대 벳에 폴드가 기본입니다.' : '오버페어면 두 번 벳해서 밸류를 받습니다.');
        plan.push(cls === 'small_pair' ? '상대가 체크하면 싸게 끝까지 가 봅니다.' : '언더페어면 작은 벳만 콜하며 상대 블러프를 잡습니다.');
        if (pt.pot === '3bp') plan.push('3벳 팟에서는 상대가 오버페어일 때가 많습니다.');
        if (pt.pot === '3bp') plan.push('셋이 아니면 큰 벳에는 폴드합니다.');
      }
      break;
    case 'ak':
    case 'big_ace':
      good = `A나 ${rp(info.low, '가')} 톱이라 ${cls === 'ak' ? '톱 킥커' : '좋은 킥커'} 탑페어가 되는 보드. A 하이 드라이 보드가 최고입니다.`;
      bad = '8-7-6처럼 낮고 이어진 보드에서 상대가 버틸 때. 스트레이트나 플러시가 이미 완성된 보드.';
      if (four) {
        plan.push(`A나 ${rp(info.low, '가')} 하나만 깔려도 대개 올인까지 갑니다.`);
        plan.push(pt.aggressor ? '아무것도 안 맞아도 큰 카드 두 장입니다.' : '아무것도 안 맞았으면 상대의 작은 벳에 한 번은 콜할 수 있습니다.');
        plan.push(pt.aggressor ? '드라이 보드에서는 작게 벳하거나 올인으로 밉니다.' : '큰 벳에는 폴드합니다.');
        if (pt.aggressor) plan.push('낮고 웻한 보드에서는 체크합니다.');
      } else {
        plan.push(pt.aggressor ? 'A·K·Q 하이 드라이 보드에서는 작게 넓게 c-bet합니다.' : '탑페어를 맞추면 두세 번 콜하거나 레이즈합니다.');
        plan.push(pt.aggressor ? '탑페어를 맞추면 세 번 벳해서 밸류를 받습니다.' : '못 맞추면 백도어가 있을 때만 한 번 따라갑니다.');
        plan.push(pt.aggressor ? '못 맞춰도 큰 카드 두 장은 맞출 카드가 6장입니다.' : '못 맞췄을 때 큰 벳에는 폴드합니다.');
        plan.push(pt.aggressor ? '드라이 보드에서는 한 번 벳하고, 낮고 웻한 보드에서는 포기합니다.' : '상대의 작은 벳에는 백도어가 있을 때만 콜합니다.');
        plan.push(...suitedNote);
      }
      break;
    case 'suited_ace':
    case 'wheel_ace':
      good = '내 무늬가 2장 깔려 넛 플러시 드로우가 되는 보드. 낮은 카드가 깔려 스트레이트 드로우가 생긴 보드.';
      bad = 'A를 맞췄는데 상대가 세게 레이즈할 때. 킥커가 약해 곤란합니다. 낮은 카드가 짝으로 깔린 보드.';
      if (four) {
        plan.push('A가 깔리거나 넛 플러시 드로우면 그대로 끝까지 갑니다.');
        plan.push('킥커 걱정보다 얕은 SPR이 우선입니다.');
        plan.push('완전히 못 맞췄고 내가 레이즈한 쪽이면 A 블로커로 작게 한 번 벳합니다.');
        plan.push('상대가 버티면 포기합니다.');
      } else {
        plan.push('넛 플러시 드로우나 드로우 두 개가 겹치면 세미 블러프로 갑니다.');
        plan.push('A 탑페어는 킥커가 약하니 두 번 이내로 팟을 작게 유지합니다.');
        plan.push('크게 올라오면 폴드도 생각합니다.');
        plan.push(pt.aggressor ? '완전히 못 맞춘 보드에서는 A 블로커로 한 번 c-bet합니다.' : '완전히 못 맞춘 보드에서는 백도어가 없으면 포기합니다.');
      }
      break;
    case 'offsuit_ace':
      good = 'A 하이 드라이 보드에서 상대가 체크할 때.';
      bad = '탑페어를 맞췄는데 큰 벳이나 레이즈를 받을 때. 못 맞춘 보드도 전부 나쁩니다.';
      plan.push('탑페어는 한 번 벳해서 밸류를 받고 팟을 작게 유지합니다.');
      plan.push('못 맞추면 플러시도 없으니 거의 포기합니다.');
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      good = '좋은 킥커의 탑페어, 오픈엔드 스트레이트 드로우, 10-J-Q-K 같은 브로드웨이 보드.';
      bad = 'A 하이 보드에서 상대가 버틸 때, 낮고 이어진 보드.';
      if (four) {
        plan.push('탑페어나 맞출 카드 8장 이상인 드로우면 끝까지 갑니다.');
        plan.push('아무것도 없으면 포기합니다.');
      } else {
        plan.push('탑페어면 두 번 벳해서 밸류를 받는 것이 기본입니다.');
        plan.push('세 번째 벳은 상대 레인지를 보고 정합니다.');
        plan.push(`맞출 카드 8장짜리 오픈엔드 드로우는 ${pt.aggressor ? '세미 블러프로 벳합니다' : '콜하고 턴에서 다시 봅니다'}.`);
        plan.push(...suitedNote);
        if (cls === 'offsuit_broadway') plan.push('플러시가 없으니 못 맞춘 보드에서는 최소로 따라갑니다.');
      }
      break;
    case 'suited_king':
    case 'suited_qj':
      good = '내 무늬가 2장 깔려 플러시 드로우가 되는 보드. K·Q·J가 톱인 드라이 보드.';
      bad = '킥커가 약한 탑페어로 큰 벳을 받을 때. A 하이 보드.';
      plan.push('플러시 드로우는 세미 블러프나 콜로 플레이합니다.');
      plan.push('넛 플러시가 아니면 큰 팟에서 조심합니다.');
      plan.push('킥커 약한 탑페어는 한두 번 벳하고 팟을 작게 유지합니다.');
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector':
      good = '오픈엔드 스트레이트 드로우나 플러시 드로우가 붙은 보드. 낮고 이어진 보드.';
      bad = '레이즈한 쪽이 유리한 A·K 하이 드라이 보드에서 아무것도 없을 때.';
      plan.push(`맞출 카드 8장 이상인 강한 드로우는 ${pt.aggressor ? '벳해서' : '레이즈해서'} 세미 블러프로 갑니다.`);
      plan.push('약한 한 칸 드로우는 값이 맞을 때만 콜합니다.');
      plan.push('백도어가 두 개 겹치면 플랍에서 한 번은 따라갈 근거가 됩니다.');
      plan.push('아무것도 없으면 바로 포기합니다.');
      plan.push('미들 페어는 작은 벳에 한 번 콜하며 상대 블러프를 잡습니다.');
      break;
    case 'junk':
      good = '투페어·트립스처럼 세게 맞은 보드.';
      bad = '대부분의 보드.';
      plan.push('세게 맞지 않으면 포기합니다.');
      plan.push('블러프는 블로커가 있을 때만 아주 가끔 합니다.');
      break;
  }
  if (pt.aggressor && pt.pot === '3bp') {
    // 한 불릿 = 한 가지 사실 (가이드 §2.1).
    plan.push('3벳 팟에서 A·K 하이 보드는 나에게 유리합니다.');
    plan.push('그런 보드에서는 작게 아주 넓게 c-bet합니다.');
    plan.push('낮고 이어진 보드에서는 체크 비중을 높입니다.');
  }
  if (!pt.aggressor && pt.pot === 'srp' && hero === 'BB') {
    plan.push('BB로 콜했으면 낮은 보드에서 먼저 벳하는 패도 가집니다.');
    plan.push('상대의 작은 벳에는 넓게 방어합니다. 폴드는 50% 이하로 유지합니다.');
  }
  if (s.kind === 'cold_4bet' && !pt.aggressor) {
    plan.push('콜한 뒤에도 오픈한 사람이 아직 남아 있습니다.');
    plan.push(info.kind === 'pair' ? '그 사람이 4벳하면 셋을 노릴 값이 사라지니 폴드합니다.' : '그 사람이 4벳하면 팟 오즈가 사라지니 폴드합니다.');
  }

  return {
    potType: POT_LABEL[pt.pot],
    role: pt.aggressor ? '프리플랍 레이저' : '프리플랍 콜러',
    position: ip ? '포지션 있음' : '포지션 없음',
    spr: SPR_LINES[pt.pot].join(' '),
    checklist,
    goodBoards: good,
    badBoards: bad,
    plan,
  };
}

/* ------------------------------------------------------------------ */
/* Situation text                                                      */
/* ------------------------------------------------------------------ */

function situationText(s: Scenario): string {
  const v = s.villain;
  const between = v ? seatsBetween(s.hero, v) : 0;
  const foldedBetween = between ? ` 사이 ${between}명은 폴드했습니다.` : '';
  switch (s.kind) {
    case 'rfi':
      return `${s.hero}까지 모두 폴드했습니다. 오픈할지 폴드할지 정하세요.`;
    case 'vs_open':
      return `${seat(v!, '가')} ${v === 'SB' ? '3bb' : '2.5bb'}로 오픈했습니다.${foldedBetween} ${s.hero}에서 폴드·콜·3벳 중에 정하세요.`;
    case 'vs_3bet':
      return `내가 ${s.hero}에서 오픈했고 ${seat(v!, '가')} 3벳했습니다. 나머지는 폴드했습니다. 폴드·콜·4벳 중에 정하세요.`;
    case 'vs_4bet':
      return `${seat(v!, '가')} 오픈, 내가 ${s.hero}에서 3벳, ${seat(v!, '가')} 4벳했습니다. 폴드·콜·올인 중에 정하세요.`;
    case 'vs_5bet':
      return `내(${s.hero}) 오픈 → ${v} 3벳 → 내 4벳 → ${v} 올인입니다. 콜할지 폴드할지 정하세요.`;
    case 'cold_4bet':
      return `${s.extras?.opener ?? '앞자리'} 오픈, ${s.extras?.threeBettor ?? '앞자리'} 3벳 뒤 ${s.hero} 차례입니다. 폴드·콜·4벳 중에 정하세요.`;
  }
}

/* ------------------------------------------------------------------ */
/* Easy block: 결론 · 왜? · 예시 · 플랍에서는                               */
/* ------------------------------------------------------------------ */

type Verb = 'fold' | 'open' | 'call' | 'threebet' | 'fourbet' | 'allin' | 'callJam' | 'foldJam';

function verbOf(step: Step): Verb {
  const { answer, scenario: s } = step;
  if (s.kind === 'vs_5bet') return answer === 'call' ? 'callJam' : 'foldJam';
  if (answer === 'fold') return 'fold';
  if (answer === 'raise') return 'open';
  if (answer === 'call') return 'call';
  if (answer === 'threebet') return 'threebet';
  if (answer === 'fourbet') return 'fourbet';
  return 'allin';
}

/** 결론의 첫 단어 — 액션부터 말합니다(가이드 §2.2). */
const VERDICT: Record<Verb, string> = {
  fold: '폴드하세요.',
  open: '오픈하세요.',
  call: '콜하세요.',
  threebet: '3벳하세요.',
  fourbet: '4벳하세요.',
  allin: '올인하세요.',
  callJam: '올인을 콜하세요.',
  foldJam: '올인에는 폴드하세요.',
};

/**
 * 이 자리에서 "더 올린다"가 뜻하는 액션. 노드마다 다릅니다 — vs_open은 3벳, vs_3bet·cold_4bet은 4벳,
 * vs_4bet은 올인입니다. 결론이 없는 액션을 부르면("4벳 받은 판에 3벳하면…") 읽는 사람이 그 자리에서 막힙니다.
 */
const RAISE_WORD: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '3벳',
  vs_3bet: '4벳',
  vs_4bet: '올인',
  vs_5bet: '올인',
  cold_4bet: '4벳',
};

/** 결론의 이유 절. 액션(≤ 11자)을 더해 60자를 넘지 않게 씁니다. */
function shortReason(cls: HandClass, verb: Verb, kind: ScenarioKind, info: HandInfo): string {
  switch (verb) {
    case 'fold':
      if (kind === 'vs_4bet' && (cls === 'wheel_ace' || cls === 'suited_ace')) return '3벳이 블러프였고 4벳 레인지는 QQ 이상입니다.';
      if (cls === 'junk' && info.highV >= 10) {
        return info.kind === 'suited'
          ? `${show(info.high)} 하나뿐이고 플러시 말고는 만들 패가 없습니다.`
          : `${show(info.high)} 하나뿐이고 오프수트라 만들 수 있는 패가 없습니다.`;
      }
      return {
        premium_pair: '이 자리에서는 승률이 부족합니다.',
        big_pair: '상대 레인지가 AA·KK 위주입니다.',
        mid_pair: '상대에게 더 큰 포켓페어가 많습니다.',
        small_pair: '셋을 못 맞추면 이길 길이 없습니다.',
        ak: '상대 레인지가 KK 이상이라 AK도 부족합니다.',
        big_ace: 'A를 맞춰도 킥커에서 밀립니다.',
        suited_ace: '킥커가 약해 큰 팟을 이기기 어렵습니다.',
        wheel_ace: 'A 페어가 약해 콜로는 버티기 어렵습니다.',
        offsuit_ace: '플러시가 없고 킥커도 약합니다.',
        suited_broadway: '상대 레인지가 강해 킥커에서 밀립니다.',
        offsuit_broadway: '탑페어를 맞춰도 킥커에서 집니다.',
        suited_king: 'K 페어를 맞춰도 킥커가 너무 약합니다.',
        suited_qj: '플러시 말고는 이길 그림이 없습니다.',
        suited_connector: '스트레이트·플러시 기대만으로는 부족합니다.',
        suited_gapper: '갭이 있어 스트레이트도 잘 안 됩니다.',
        offsuit_connector: '오프수트라 플러시가 없고 페어도 약합니다.',
        junk: '큰 카드가 없어 승률이 너무 낮습니다.',
      }[cls];
    case 'open':
      return {
        premium_pair: '가장 강한 패라 팟을 키워야 합니다.',
        big_pair: '대부분의 레인지보다 앞서 있습니다.',
        mid_pair: '페어라 든든하고 셋도 노립니다.',
        small_pair: '플랍에서 셋이 될 확률이 12%입니다.',
        ak: '가장 큰 카드 두 장이라 자주 앞섭니다.',
        big_ace: '약한 A를 든 상대를 킥커로 이깁니다.',
        suited_ace: '수티드라 넛 플러시까지 노립니다.',
        wheel_ace: '넛 플러시와 휠 스트레이트를 노립니다.',
        offsuit_ace: '약한 A라도 블라인드를 노릴 만합니다.',
        suited_broadway: '탑페어를 자주 만들고 플랍이 편합니다.',
        offsuit_broadway: '큰 카드 두 장이라 탑페어를 자주 만듭니다.',
        suited_king: 'K에 수티드라 플러시를 노립니다.',
        suited_qj: '수티드라 뒷자리에서 겨우 들어갑니다.',
        suited_connector: '스트레이트와 플러시를 함께 노립니다.',
        suited_gapper: '수티드라 플러시와 드로우를 노립니다.',
        offsuit_connector: '뒤에 블라인드 둘만 남았습니다.',
        junk: '뒤에 블라인드 둘만 남았습니다.',
      }[cls];
    case 'call':
      return {
        premium_pair: '상대 블러프를 살려 두는 트랩입니다.',
        // 이 노드에 있는 액션만 부릅니다: vs_open이면 3벳, vs_3bet·cold_4bet이면 4벳, vs_4bet이면 올인.
        big_pair: kind === 'vs_4bet' ? '올인하면 더 강한 패만 남습니다.' : `${RAISE_WORD[kind]}하면 AA·KK만 남습니다.`,
        mid_pair: '팟을 키우기보다 셋을 노리는 쪽이 낫습니다.',
        small_pair: '셋이 되면 크게 받아 낼 수 있습니다.',
        ak: '올리면 더 강한 레인지만 남습니다.',
        big_ace: '올리면 약한 패는 폴드하고 강한 패만 남습니다.',
        suited_ace: 'A에 넛 플러시까지 있어 싸게 볼 만합니다.',
        wheel_ace: '플러시·스트레이트가 붙으면 크게 받습니다.',
        offsuit_ace: '상대 레인지가 넓어 A 하나로도 볼 만합니다.',
        suited_broadway: '큰 카드에 플러시까지 있어 플랍이 편합니다.',
        offsuit_broadway: '탑페어를 자주 만들어 싸게 볼 만합니다.',
        suited_king: '플러시를 보고 싸게 플랍을 봅니다.',
        suited_qj: '값이 싸서 플러시만 보고 갑니다.',
        suited_connector: '스트레이트·플러시로 크게 받아 냅니다.',
        suited_gapper: '수티드라 크게 받아 낼 그림이 있습니다.',
        offsuit_connector: '싼값에 스트레이트를 노립니다.',
        junk: '이미 낸 블라인드 덕에 값이 아주 쌉니다.',
      }[cls];
    case 'threebet':
    case 'fourbet':
      return {
        premium_pair: '가장 강한 패라 팟을 최대로 키웁니다.',
        big_pair: '상대 레인지 대부분보다 앞서 있습니다.',
        mid_pair: '상대가 자주 폴드하고 페어로도 버팁니다.',
        small_pair: '상대가 폴드하면 좋고 셋도 노립니다.',
        ak: '이기는 패도 많고 상대가 폴드하기도 합니다.',
        big_ace: '약한 A를 든 상대에게 더 받아 냅니다.',
        suited_ace: 'A 블로커로 상대 AA·AK가 줄어듭니다.',
        wheel_ace: 'A 블로커에 넛 가능성까지 갖췄습니다.',
        offsuit_ace: '약한 A지만 A 블로커는 있습니다.',
        suited_broadway: '밸류도 되고 플랍 이후도 편합니다.',
        offsuit_broadway: '콜하면 킥커에서 밀려 올리는 쪽이 낫습니다.',
        suited_king: 'K 블로커로 상대 KK·AK가 줄어듭니다.',
        suited_qj: '상대가 폴드하면 그대로 가져옵니다.',
        suited_connector: '폴드를 받으면 좋고 콜을 받아도 넛을 노립니다.',
        suited_gapper: '상대를 폴드시키려는 블러프입니다.',
        offsuit_connector: '상대를 폴드시키려는 블러프입니다.',
        junk: '상대를 폴드시키려는 블러프입니다.',
      }[cls];
    case 'allin':
      // premium_pair는 AA와 KK 둘 다입니다. 상대 4벳 레인지 안에 AA가 있으니 KK가 "전부보다 앞선다"는 말은 거짓입니다.
      if (cls === 'premium_pair') return info.name === 'AA' ? '상대의 4벳 레인지 전부보다 앞섭니다.' : 'AA만 아니면 다 앞섭니다.';
      if (cls === 'big_pair' || cls === 'ak') return '블러프는 폴드시키고 강한 패와는 반반입니다.';
      if (cls === 'wheel_ace' || cls === 'suited_ace') return 'A 블로커를 쓰는 블러프입니다.';
      return '상대 4벳 블러프를 폴드시킬 수 있습니다.';
    case 'callJam':
      // 내가 KK면 상대 KK는 이기는 것이 아니라 찹입니다. AA에는 18%입니다.
      if (cls === 'premium_pair') return info.name === 'AA' ? '상대가 KK·AK여도 대부분 이깁니다.' : 'AA만 아니면 다 앞서 승률이 충분합니다.';
      if (cls === 'ak') return 'A·K 블로커로 상대 AA·KK가 줄어듭니다.';
      return '상대 올인에 QQ·AK가 섞여 승률이 충분합니다.';
    case 'foldJam':
      // 같은 시트의 예시가 "상대 KK면 승률 30%"라고 적습니다 — "승률이 없다"는 그 줄과 정면으로 부딪힙니다.
      if (cls === 'wheel_ace' || cls === 'suited_ace') return '4벳은 블러프였고 콜에 필요한 38%에 못 미칩니다.';
      if (cls === 'big_pair' || cls === 'ak') return '상대 올인은 KK 이상이라 승률이 모자랍니다.';
      return '상대 올인 레인지가 너무 강합니다.';
  }
}

/**
 * 왜? 첫 불릿 — 손패 한 줄 (≤ 30자).
 * "왜?"는 결론을 받치는 자리입니다. 폴드가 아닌 결론 밑에 약점을 먼저 적으면 그 불릿은 결론의 반대 근거가 됩니다.
 * 그래서 폴드일 때만 약점을, 나머지 액션에서는 그 액션을 하는 이유(강점)를 적습니다.
 */
function handFact(info: HandInfo, cls: HandClass, verb: Verb): string {
  const n = info.name;
  if (verb !== 'fold' && verb !== 'foldJam') return handStrength(info, cls);
  switch (cls) {
    case 'premium_pair':
      return n === 'AA' ? 'AA는 프리플랍 최강 패입니다.' : 'KK는 AA에만 지는 두 번째 패입니다.';
    case 'big_pair':
      return `${hp(info, '는')} 큰 포켓페어라 A·K가 깔리면 불안합니다.`;
    case 'mid_pair':
      return `${hp(info, '는')} 중간이라 오버페어가 되기 어렵습니다.`;
    case 'small_pair':
      return `${hp(info, '는')} 셋이 아니면 거의 못 이깁니다.`;
    case 'ak': {
      const e = akEq(info.kind === 'suited');
      return `${n}는 QQ에 ${e.qq}%, KK에 ${e.kk}%입니다.`;
    }
    case 'big_ace':
      // 폴드 결론 밑의 첫 불릿입니다. handStrength의 "A 탑페어를 자주 만듭니다"를 그대로 쓰면 갈 이유가 됩니다.
      return `${n}는 상대 레인지가 좁을수록 가치가 떨어집니다.`;
    case 'suited_ace':
      return `${n}는 A가 강하지만 킥커가 약합니다.`;
    case 'wheel_ace':
      return `${n}는 A에 낮은 카드가 붙은 수티드입니다.`;
    case 'offsuit_ace':
      return `${n}는 A가 있지만 킥커가 약합니다.`;
    case 'suited_broadway':
      return `${n}는 브로드웨이 두 장에 수티드입니다.`;
    case 'offsuit_broadway':
      return `${n}는 브로드웨이지만 오프수트입니다.`;
    case 'suited_king':
      return `${n}는 K가 높고 킥커가 작습니다.`;
    case 'suited_qj':
      return `${n}는 큰 카드 하나에 킥커가 작습니다.`;
    case 'suited_connector':
      return `${n}는 숫자가 이어진 수티드입니다.`;
    case 'suited_gapper':
      return `${n}는 갭이 있는 수티드입니다.`;
    case 'offsuit_connector':
      return `${n}는 커넥터지만 오프수트입니다.`;
    case 'junk':
      if (info.kind === 'suited') return `${n}는 수티드지만 숫자가 너무 작습니다.`;
      if (info.highV >= 10) return `${rp(info.high, '는')} 크지만 ${rp(info.low, '가')} 너무 작습니다.`;
      return `${show(info.high)}·${show(info.low)} 둘 다 작아 도움이 안 됩니다.`;
  }
}

/** 폴드가 아닌 결론 밑에 오는 손패 한 줄 — 그 액션을 하는 이유 (≤ 30자). */
function handStrength(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  switch (cls) {
    case 'premium_pair':
      return n === 'AA' ? 'AA는 프리플랍 최강 패입니다.' : 'KK는 AA에만 지는 두 번째 패입니다.';
    case 'big_pair':
      return `${hp(info, '는')} 대부분의 레인지보다 앞섭니다.`;
    case 'mid_pair':
      return `${hp(info, '는')} 낮은 보드에서 오버페어가 됩니다.`;
    case 'small_pair':
      return `${hp(info, '는')} 셋이 되면 큰 팟을 이깁니다.`;
    case 'ak':
      return `${n}는 A·K 둘 다 톱 킥커가 됩니다.`;
    case 'big_ace':
      return `${n}는 A 탑페어를 자주 만듭니다.`;
    case 'suited_ace':
      return `${n}는 넛 플러시를 노리는 수티드 A입니다.`;
    case 'wheel_ace':
      return `${n}는 A 블로커에 넛 플러시까지 됩니다.`;
    case 'offsuit_ace':
      return `${n}는 A 한 장으로 약한 패를 이깁니다.`;
    case 'suited_broadway':
      return `${n}는 브로드웨이 두 장에 수티드입니다.`;
    case 'offsuit_broadway':
      return `${n}는 탑페어를 자주 만드는 브로드웨이입니다.`;
    case 'suited_king':
      return `${n}는 K 하이 플러시를 노립니다.`;
    case 'suited_qj':
      return `${n}는 수티드라 플러시를 노립니다.`;
    case 'suited_connector':
      return `${n}는 스트레이트와 플러시를 다 노립니다.`;
    case 'suited_gapper':
      return `${n}는 수티드라 플러시가 붙습니다.`;
    case 'offsuit_connector':
      return `${n}는 이어진 두 장이라 스트레이트가 됩니다.`;
    case 'junk':
      return info.kind === 'suited' ? `${n}는 수티드라 플러시는 노려 볼 만합니다.` : `${n}는 이 자리에서만 쓰는 아래쪽 패입니다.`;
  }
}

/** 왜? 둘째 불릿 — 자리와 상대 레인지 (≤ 30자). */
function situationReason(step: Step): string {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const fold = answer === 'fold';
  switch (s.kind) {
    case 'rfi':
      // A fold must never read like a reason to raise.
      if (hero === 'BTN') return fold ? '넓게 오픈하는 자리지만 이 패는 빠집니다.' : '뒤에 블라인드 둘뿐이라 넓게 오픈합니다.';
      // 오픈 밑에 "먼저 액션해야 한다"만 적으면 그 불릿이 오픈하지 말라는 말이 됩니다(가이드 §4.2). 포지션 이야기는 자세히에 있습니다.
      if (hero === 'SB') return fold ? 'SB는 플랍 이후 먼저 액션해야 합니다.' : 'BB 한 명만 남아 넓게 오픈합니다.';
      if (hero === 'CO') return fold ? '뒤에 3명뿐이라 넓지만 이 패는 빠집니다.' : '뒤에 3명뿐이라 꽤 넓게 오픈합니다.';
      return fold ? `뒤에 ${seatsBehind(hero)}명이라 레인지가 좁고 이 패는 빠집니다.` : `뒤에 ${seatsBehind(hero)}명이 남아 좁게 오픈합니다.`;
    case 'vs_open': {
      // 한국 포커판에서 "패를 열다"는 쇼다운에서 보여 주는 것입니다. 오픈은 "오픈하다"로 씁니다(가이드 §0).
      const lateFold = `${seat(v!, '는')} 약한 패도 오픈하지만 이건 더 약합니다.`;
      if (hero === 'BB') {
        if (isEarly(v)) return fold ? `${seat(v!, '는')} 앞자리라 레인지가 강합니다.` : '앞자리 오픈이라 강하지만 값이 쌉니다.';
        return fold ? lateFold : `${seat(v!, '는')} 뒷자리라 넓게 오픈합니다.`;
      }
      if (hero === 'SB') {
        // "왜?"에 들어가는 줄이라 결론을 뒷받침해야 합니다(rfi 분기와 같은 규칙).
        if (fold) return 'SB는 플랍 이후 먼저 액션해야 합니다.';
        return answer === 'call' ? 'SB가 드물게 콜로 받는 패입니다.' : 'SB는 콜보다 3벳이 나은 자리입니다.';
      }
      if (isEarly(v)) return `${seat(v!, '는')} 앞자리라 강한 패만 오픈합니다.`;
      return fold ? lateFold : `${seat(v!, '는')} 뒷자리라 넓게 오픈합니다.`;
    }
    case 'vs_3bet':
      if (fold) return isBlind(v) ? `${v}의 3벳엔 블러프도 있지만 부족합니다.` : `${v}의 3벳은 밸류 위주라 받기 어렵습니다.`;
      return isBlind(v) ? `${v}의 3벳은 밸류와 블러프가 섞입니다.` : `${v}의 3벳은 밸류 위주입니다.`;
    case 'vs_4bet':
      return '4벳은 QQ 이상·AK에 A5s 블러프입니다.';
    case 'vs_5bet':
      return '올인 레인지는 AA·KK·AK 위주입니다.';
    case 'cold_4bet':
      return '앞에서 오픈과 3벳이 나와 둘 다 강합니다.';
  }
}

function positionReason(step: Step): string | null {
  const { scenario: s, answer } = step;
  if (answer === 'fold' || s.kind === 'vs_5bet' || answer === 'allin') return null;
  if (s.kind === 'rfi' || (s.kind === 'vs_open' && s.hero === 'SB')) return null; // the situation line already says it
  return heroIsIP(s) ? '플랍 이후 내가 나중에 액션합니다.' : '플랍 이후 내가 먼저 액션합니다.';
}

/** 왜? 불릿 2~3개: 손패 → 자리 → 혼합 빈도(있으면) 또는 포지션. */
function easyWhy(step: Step, info: HandInfo, cls: HandClass, verb: Verb): string[] {
  const out: string[] = [handFact(info, cls, verb), situationReason(step)];
  const alt = step.mixList.length >= 2 ? step.mixList[1] : null;
  if (alt) {
    const altLabel = ACTION_SHORT_KO[alt.action];
    // 불릿은 사실 하나만 담습니다. "빈도가 같으면 더 공격적인 쪽" 규칙은 자세히 · 혼합 빈도에 이미 한 문장으로 있습니다.
    // 왜? 불릿에 괄호는 쓰지 않습니다(가이드 §4.2) — 자세히 블록과 같은 "…도 25% 섞습니다" 꼴로 적습니다.
    out.push(alt.weight >= 0.5 ? `절반은 ${altLabel}합니다.` : `${altLabel}도 ${pctInt(alt.weight)} 섞습니다.`);
  } else {
    const pos = positionReason(step);
    if (pos) out.push(pos);
  }
  return out.slice(0, 3);
}

/* ---- examples ---- */

interface ExCtx {
  step: Step;
  info: HandInfo;
  cls: HandClass;
  verb: Verb;
  me: string;
  taken: Set<string>;
}

/** "상대 K♠K♦" — an opponent hand with suits, safe against my cards. */
function vs(ctx: ExCtx, name: string): string {
  return `상대 ${oppHand(name, ctx.taken)}`;
}
/** 가이드 §3의 고정 형식: "내 A♠Q♦ vs 상대 A♦K♠ → …". */
function duel(ctx: ExCtx, name: string, tail: string): string {
  return `내 ${ctx.me} vs ${vs(ctx, name)} → ${tail}`;
}
const mine = (ctx: ExCtx, tail: string) => `내 ${ctx.me} → ${tail}`;

function pairExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  if (cls === 'premium_pair') {
    if (info.high === 'A') {
      out.push(duel(ctx, 'KK', '승률 80%입니다.'));
      // 내가 A♠A♦를 들고 있어 상대 AK는 무늬 없이 "AK"로 찍힙니다 → AKs 88%·AKo 93%의 가운데 값을 씁니다.
      if (kind === 'vs_5bet' || verb === 'allin' || verb === 'fourbet') out.push('상대가 AK여도 승률 90%입니다.');
      if (verb === 'allin') out.push('상대 블러프는 폴드하고 강한 패는 콜합니다.');
    } else {
      out.push(duel(ctx, 'QQ', '승률 80%입니다.'));
      out.push(`${vs(ctx, 'AA')}를 만나면 승률 18%입니다.`);
      // 5-bet jam: the 4-bet range is QQ+·AK plus A5s-type bluffs.
      if (verb === 'allin') out.push(`${vs(ctx, 'A5s')} 블러프는 폴드하고 AK에는 70%입니다.`);
    }
    if (verb === 'call') out.push('콜만 하면 상대가 블러프로 더 걸어 줍니다.');
    return out.slice(0, 3);
  }
  if (cls === 'big_pair') {
    if (verb === 'fold' || verb === 'foldJam') {
      out.push(duel(ctx, 'KK', '승률 18%입니다.'));
      out.push(`${vs(ctx, 'AKo')}에는 57%지만 여기선 페어가 많습니다.`);
    } else if (verb === 'allin') {
      // 5-bet jam over a 4-bet: the opponents are the 4-bet range (AK · A5s bluffs · KK/AA).
      out.push(duel(ctx, 'AKo', '승률 57%입니다.'));
      out.push(`${vs(ctx, 'A5s')} 블러프는 폴드해 줍니다.`);
      out.push(`${vs(ctx, 'KK')}·${oppHand('AA', taken)}면 승률 18%입니다.`);
    } else {
      out.push(duel(ctx, 'AKo', '승률 57%입니다.'));
      const lower = rankOf(Math.max(2, info.highV - 2));
      out.push(`${vs(ctx, `${lower}${lower}`)} 같은 낮은 페어에는 80%입니다.`);
      if (verb === 'call' || verb === 'open') out.push(`플랍 ${board(['A', ['9', '8'], ['4', '5']], ['♦', '♠', '♦'], taken)} → A가 깔리면 조심합니다.`);
    }
    return out.slice(0, 3);
  }
  // mid / small pair
  if (cls === 'small_pair' && verb === 'open') {
    // 결론이 이미 "플랍에서 셋이 될 확률이 12%"라고 말합니다 — 예시까지 같은 문장을 반복하면 카드 줄이 버는 것이 없습니다.
    out.push(duel(ctx, 'AKo', '거의 반반입니다.'));
    out.push('셋이 되면 상대 스택을 다 받습니다.');
    return out.slice(0, 3);
  }
  out.push(mine(ctx, `플랍에서 셋이 될 확률 12%.`));
  if (verb === 'fold' || verb === 'foldJam') {
    // 20%는 오버페어를 만났을 때의 "전체" 승률입니다(오버페어 80%의 반대쪽). 그 대부분이 셋을 맞추는 몫이라
    // "셋이 아니면 20%"로 붙이면 완전히 틀린 숫자가 됩니다 — 숫자와 조건을 두 줄로 나눕니다.
    const over = cls === 'mid_pair' ? 'QQ' : 'JJ';
    // 예시 줄은 "내 X vs 상대 Y → …" 한 가지 꼴로 씁니다 (가이드 §3).
    out.push(duel(ctx, over, '승률 20%입니다.'));
    out.push('그 20%도 대부분 셋을 맞출 때입니다.');
  } else if (verb === 'call') {
    out.push('셋이 되면 상대 오버페어에게 크게 받습니다.');
    const ub = cls === 'mid_pair' ? underBoard(info, taken) : null;
    if (ub) out.push(`플랍 ${ub} → 내 페어가 오버페어입니다.`);
  } else {
    out.push(`${vs(ctx, 'AKo')} 같은 큰 카드 두 장과는 반반입니다.`);
  }
  return out.slice(0, 3);
}

function aceExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  if (cls === 'ak') {
    // 승률은 무늬에 따라 갈립니다(akEq). 내가 K를 들어 KK는 ♠/♦로 못 뽑으니, 그 줄은 차트 이름으로 통일합니다.
    const eq = akEq(info.kind === 'suited');
    if (kind === 'vs_5bet') {
      out.push(duel(ctx, 'QQ', `승률 ${eq.qq}%입니다.`));
      out.push(`상대가 KK면 ${eq.kk}%, AK끼리는 대부분 비깁니다.`);
      return out;
    }
    if (verb === 'allin') {
      // 5-bet jam over a 4-bet: talk about the 4-bet range (A5s bluffs, KK, QQ).
      out.push(mine(ctx, `${vs(ctx, 'A5s')} 블러프는 올인에 폴드합니다.`));
      out.push(`상대가 KK면 ${eq.kk}%, QQ면 ${eq.qq}%입니다.`);
      return out;
    }
    out.push(duel(ctx, 'AQo', 'A가 깔리면 킥커 K로 이깁니다.'));
    if (verb === 'fold') out.push(`상대가 KK면 ${eq.kk}%, AA면 ${eq.aa}%입니다.`);
    else out.push(`${vs(ctx, 'QQ')}에는 승률 ${eq.qq}%입니다.`);
    return out;
  }
  const dom = dominatorOf(info);
  const weaker = dominatedBy(info);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(duel(ctx, dom, `A가 깔려도 킥커 ${show(dom[1])}에 집니다.`));
    // Ax vs KK ≈ 30% (never "QQ" here: a hero holding a Q would see a bare "QQ").
    if (kind === 'vs_5bet' || kind === 'vs_4bet' || kind === 'cold_4bet') out.push(`${vs(ctx, 'KK')}면 승률 30%입니다.`);
    else if (cls === 'offsuit_ace') out.push(`내 ${ctx.me}, 플랍 ${missBoard(info, taken)} → 아무것도 없습니다.`);
    else if (cls === 'big_ace') out.push(`${vs(ctx, 'KK')} 같은 큰 페어에는 30%입니다.`);
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet' || verb === 'allin') {
    if (cls === 'wheel_ace' || cls === 'suited_ace') {
      out.push(cls === 'wheel_ace' ? mine(ctx, 'A 블로커로 상대 AA가 줄어듭니다.') : mine(ctx, '♠가 2장 더 깔리면 넛 플러시 드로우입니다.'));
      out.push(`${vs(ctx, 'KQs')}가 폴드하면 그대로 이깁니다.`);
      if (cls === 'wheel_ace' && verb !== 'allin') out.push(`플랍 ${wheelBoard(info, taken)} → A-2-3-4-5 스트레이트입니다.`);
    } else if (cls === 'big_ace' && weaker) {
      out.push(duel(ctx, weaker, '킥커 A로 이깁니다.'));
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 킥커에서 집니다.`);
    } else {
      out.push(mine(ctx, 'A 블로커로 상대 AA·AK가 줄어듭니다.'));
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 바로 폴드합니다.`);
    }
    return out.slice(0, 3);
  }
  // call / open
  if (cls === 'wheel_ace' || cls === 'suited_ace') {
    out.push(mine(ctx, '♠가 2장 더 깔리면 넛 플러시 드로우입니다.'));
    if (cls === 'wheel_ace') out.push(`플랍 ${wheelBoard(info, taken)} → A-2-3-4-5 스트레이트입니다.`);
    if (dom) out.push(`${vs(ctx, dom)}에는 A가 깔려도 킥커에서 집니다.`);
  } else if (cls === 'big_ace') {
    if (weaker) out.push(duel(ctx, weaker, '킥커 A로 이깁니다.'));
    if (dom) out.push(`${vs(ctx, dom)}에는 A가 깔려도 킥커에서 집니다.`);
    // A pair BELOW my kicker is the coin flip (AQ vs JJ ≈ 46%); a pair ON my kicker is not.
    if (kind === 'vs_5bet' || kind === 'vs_4bet') out.push(`${vs(ctx, underPair(info))}면 반반에 가깝습니다(${info.kind === 'suited' ? 46 : 43}%).`);
  } else {
    // offsuit ace
    if (dom) out.push(duel(ctx, dom, `A가 깔려도 킥커 ${show(dom[1])}에 집니다.`));
    out.push(`${vs(ctx, 'K9o')} 같은 약한 패에는 A 하나로 이깁니다.`);
  }
  return out.slice(0, 3);
}

function broadwayExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  const dom = dominatorOf(info);
  const weaker = dominatedBy(info);
  const lowP = rp(info.low, '가');
  const high = show(info.high);
  const topBoard = board([info.high, DRY_BOARD[1], DRY_BOARD[2]], ['♦', '♠', '♦'], taken);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(duel(ctx, dom, `${lowP} 깔려도 킥커 A에 집니다.`));
    // AK only shares a card with a K-high broadway; against QJ/JT it simply makes the bigger pair.
    out.push(info.high === 'K' ? `${vs(ctx, 'AKo')}에는 K가 깔려도 킥커에서 집니다.` : `${vs(ctx, 'AKo')}에는 페어를 만들어도 더 작습니다.`);
    // An overpair to both my cards (KQ vs AA, QJ vs KK ≈ 18%).
    if (kind === 'vs_5bet' || kind === 'vs_4bet' || kind === 'cold_4bet') out.push(`${vs(ctx, overPair(info))} 같은 오버페어에는 ${overPairEq(info)}%입니다.`);
    else if (cls === 'offsuit_broadway') out.push('오프수트라 플러시로 뒤집을 기회가 없습니다.');
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    if (cls === 'offsuit_broadway') {
      if (dom) out.push(duel(ctx, dom, `${lowP} 깔려도 킥커 A에 집니다.`));
      out.push(`${vs(ctx, 'A9o')}가 폴드하면 그대로 이깁니다.`);
    } else {
      if (weaker) out.push(duel(ctx, weaker, `킥커 ${high}로 이깁니다.`));
      out.push(`플랍 ${topBoard} → ${high} 탑페어입니다.`);
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 킥커에서 집니다.`);
    }
    return out.slice(0, 3);
  }
  // call / open
  out.push(`플랍 ${topBoard} → ${high} 탑페어입니다.`);
  if (info.kind === 'suited') out.push(mine(ctx, '♠가 2장 더 깔리면 플러시 드로우입니다.'));
  else if (weaker) out.push(duel(ctx, weaker, `킥커 ${high}로 이깁니다.`));
  if (dom) out.push(`${vs(ctx, dom)}에는 ${lowP} 깔려도 킥커 A에 집니다.`);
  return out.slice(0, 3);
}

function suitedKingExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, taken } = ctx;
  const out: string[] = [];
  const high = show(info.high);
  const dom = dominatorOf(info);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(duel(ctx, dom, `${rp(info.high, '가')} 깔려도 킥커 A에 집니다.`));
    out.push('플러시는 ♠가 3장 더 깔려야 합니다.');
    return out;
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    out.push(mine(ctx, `♠ 2장이면 ${high} 하이 플러시 드로우입니다.`));
    out.push(`${vs(ctx, 'A9o')}가 폴드하면 그대로 이깁니다.`);
    return out;
  }
  out.push(mine(ctx, `♠ 2장이면 ${high} 하이 플러시 드로우입니다.`));
  if (cls === 'suited_king') out.push(`플랍 ${board(['K', ['8', '9', '7'], ['3', '4', '2']], ['♦', '♠', '♦'], taken)} → K 탑페어지만 킥커가 약합니다.`);
  else out.push(`${high} 탑페어를 맞춰도 킥커가 약합니다.`);
  if (dom) out.push(`${vs(ctx, dom)}에는 ${rp(info.high, '가')} 깔려도 킥커 A에 집니다.`);
  return out.slice(0, 3);
}

function connectorExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, taken } = ctx;
  const out: string[] = [];
  const st = straightBoard(info);
  const suited = info.kind === 'suited';
  const stBoard = st ? board(st, suited ? ['♦', '♠', '♦'] : ['♠', '♦', '♠'], taken, suited ? '♠' : undefined) : null;
  if (verb === 'fold' || verb === 'foldJam') {
    if (stBoard) out.push(mine(ctx, `${stBoard} 같은 플랍이 와야 스트레이트입니다.`));
    out.push(`${vs(ctx, 'AKo')}에는 페어를 맞춰도 작습니다.`);
    if (!suited) out.push('오프수트라 플러시도 없습니다.');
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    out.push(mine(ctx, `${vs(ctx, 'A9o')}가 폴드하면 그대로 이깁니다.`));
    if (stBoard) out.push(`콜을 받아도 ${stBoard} 플랍이면 스트레이트입니다.`);
    return out;
  }
  if (stBoard) out.push(`내 ${ctx.me}, 플랍 ${stBoard} → 스트레이트입니다.`);
  if (suited) out.push('♠가 2장 더 깔리면 플러시 드로우입니다.');
  else out.push('오프수트라 플러시 없이 스트레이트만 노립니다.');
  if (cls !== 'offsuit_connector') out.push(`크게 맞으면 ${vs(ctx, 'AA')}의 스택을 다 받습니다.`);
  return out.slice(0, 3);
}

/**
 * Why a junk hand loses even when it pairs its high card:
 * K-high → AK out-kicks me on a K; Q-high → KQ out-kicks me on a Q; lower → KQ simply has the bigger pair.
 */
function junkLossLine(ctx: ExCtx): string {
  const { info } = ctx;
  if (info.high === 'K') return duel(ctx, 'AKo', 'K가 깔려도 킥커 A에 집니다.');
  if (info.high === 'Q') return duel(ctx, 'KQo', 'Q가 깔려도 킥커 K에 집니다.');
  // 화살표 없는 줄이 화살표 있는 줄 옆에 서지 않게, 같은 꼴로 맞춥니다 (가이드 §3).
  return duel(ctx, 'KQo', `K와 ${rp(info.high, '가')} 깔리면 집니다.`);
}

function junkExamples(ctx: ExCtx): string[] {
  const { info, verb, taken } = ctx;
  const out: string[] = [];
  if (verb === 'fold' || verb === 'foldJam') {
    // 상대 패를 먼저 배정하고 보드를 깝니다. 보드는 랭크 후보가 여러 개라 비켜 갈 수 있지만 상대 패는 못 비킵니다.
    const loss = junkLossLine(ctx);
    out.push(`내 ${ctx.me}, 플랍 ${missBoard(info, taken)} → 아무것도 없습니다.`);
    out.push(loss);
    return out;
  }
  out.push(verb === 'call' ? mine(ctx, '싸게 플랍만 보고 안 맞으면 폴드합니다.') : mine(ctx, '상대가 폴드하면 블라인드를 가져옵니다.'));
  out.push(junkLossLine(ctx));
  return out;
}

function easyExample(step: Step, info: HandInfo, cls: HandClass, verb: Verb): string[] {
  const cards = heroCards(info);
  const ctx: ExCtx = {
    step,
    info,
    cls,
    verb,
    me: cards.map(cardStr).join(''),
    taken: new Set(cards.map(key)),
  };
  let out: string[];
  switch (cls) {
    case 'premium_pair':
    case 'big_pair':
    case 'mid_pair':
    case 'small_pair':
      out = pairExamples(ctx);
      break;
    case 'ak':
    case 'big_ace':
    case 'suited_ace':
    case 'wheel_ace':
    case 'offsuit_ace':
      out = aceExamples(ctx);
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      out = broadwayExamples(ctx);
      break;
    case 'suited_king':
    case 'suited_qj':
      out = suitedKingExamples(ctx);
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector':
      out = connectorExamples(ctx);
      break;
    default:
      out = junkExamples(ctx);
  }
  if (!out.length) out = [mine(ctx, '이 자리에서는 딱 경계인 패입니다.')];
  return out.slice(0, 3);
}

/* ---- flop checklist ---- */

function easyFlop(step: Step, info: HandInfo, cls: HandClass): string[] | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const ip = heroIsIP(step.scenario);
  const cards = heroCards(info);
  // 플랍 불릿의 보드들은 서로 다른 "만약"입니다(예시 줄과 달리 한 판이 아닙니다) — 각자 내 두 장만 피하면 됩니다.
  const fresh = () => new Set(cards.map(key));
  const out: string[] = [];
  const suited = info.kind === 'suited';
  const dry = board(dryRanks(info, cls), drySuits(info), fresh());
  // 4벳 팟은 SPR이 1~1.5입니다. 거기서 "팟 컨트롤"은 바로 아래 "탑페어만 맞아도 올인까지"와 반대를 가리킵니다.
  const four = pt.pot === '4bp';

  // 1. what to look for with this hand
  switch (cls) {
    case 'premium_pair':
    case 'big_pair': {
      const ub = underBoard(info, fresh());
      out.push(ub ? `${ub}처럼 낮은 보드면 자신 있게 벳` : '내 페어보다 낮은 보드면 자신 있게 벳');
      // 4벳 팟은 SPR이 1~1.5라 팟 컨트롤할 여지가 없습니다 — 두 장이 다 깔렸을 때만 물러섭니다.
      if (cls === 'big_pair') out.push(four ? 'A와 K가 둘 다 깔리면 조심' : 'A나 K가 깔리면 팟 컨트롤');
      break;
    }
    case 'mid_pair':
    case 'small_pair':
      out.push(`플랍에 ${rp(info.high, '가')} 깔리면 셋, 팟 키우기`);
      out.push(cls === 'small_pair' ? '셋이 아닌데 벳이 오면 폴드' : '내 페어 위로 두 장 깔리면 조심');
      break;
    case 'ak':
    case 'big_ace':
      out.push(`A나 ${rp(info.low, '가')} 깔리면 탑페어, 벳`);
      out.push(suited ? '못 맞췄으면 ♠가 2장인지 확인' : '못 맞췄으면 큰 벳은 따라가지 않기');
      break;
    case 'suited_ace':
    case 'wheel_ace':
      out.push('♠ 2장이면 넛 플러시 드로우, 벳이나 레이즈');
      // 스택이 얕다는 근거는 아래 "스택이 얕아 탑페어만 맞아도 올인까지" 불릿이 말합니다 — 여기서는 이 패의 사실만.
      out.push(four ? 'A가 깔리면 킥커가 약해도 그대로 올인' : 'A가 깔려도 킥커가 약해 팟 컨트롤');
      break;
    case 'offsuit_ace':
      out.push(four ? 'A가 깔리면 킥커 걱정 없이 끝까지' : 'A가 깔리면 한 번만 벳하고 팟 컨트롤');
      out.push('못 맞췄으면 플러시도 없으니 포기');
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      out.push(`${show(info.high)}나 ${rp(info.low, '가')} 톱이면 탑페어, 두 번 벳`);
      out.push(suited ? '♠ 2장이나 이어진 보드면 드로우 확인' : 'A가 깔린 보드에서 저항하면 조심');
      break;
    case 'suited_king':
    case 'suited_qj':
      out.push('♠ 2장이면 플러시 드로우, 넛이 아니면 조심');
      out.push(four ? `${show(info.high)} 탑페어면 얕은 스택이라 그대로 올인` : `${show(info.high)} 탑페어는 킥커가 약해 팟 컨트롤`);
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector': {
      const st = straightBoard(info);
      out.push(st ? `${board(st, ['♦', '♠', '♦'], fresh())}처럼 이어진 보드가 나에게 유리` : '낮고 이어진 보드가 나에게 유리');
      out.push('드로우면 벳이나 콜, 아무것도 없으면 폴드');
      break;
    }
    default:
      out.push('투페어 이상으로 맞지 않으면 바로 포기');
  }

  // 2. board texture — 4벳 팟은 SPR이 1~1.5라 보드보다 스택이 먼저입니다. 여기서 "드라이 보드는 팟의 30%"를 쓰면
  //    바로 아래의 "탑페어만 맞아도 올인까지"와 반대 방향을 가리키고, 낮은 보드 예시도 1번 불릿과 겹칩니다.
  if (four) {
    // 포켓페어는 "미스"가 없습니다 — 오버페어인지로 말해야 위 불릿과 어긋나지 않습니다.
    const pair = cls === 'premium_pair' || cls === 'big_pair' || cls === 'mid_pair' || cls === 'small_pair';
    if (pair) out.push(pt.aggressor ? '오버페어면 그대로 올인까지 밀기' : '오버페어면 첫 벳을 받고 끝까지');
    else out.push(pt.aggressor ? '못 맞춰도 한 번은 작게 c-bet' : '못 맞추면 첫 벳에 폴드');
  }
  else if (pt.aggressor) out.push(`${dry} 같은 드라이 보드는 팟의 30%로 c-bet`);
  else out.push(`${dry} 같은 드라이 보드면 작은 벳은 한 번 콜`);

  // 3. position / pot size — 체크-레이즈를 "당하는" 쪽은 플랍에서 벳하는 쪽(프리플랍 레이저)뿐입니다.
  //    포지션 없는 콜러는 자기가 먼저 체크하므로 체크-레이즈를 맞을 수가 없습니다.
  if (four) out.push('스택이 얕아 탑페어만 맞아도 올인까지');
  // 3벳 팟에서 포지션 없이 레이즈한 쪽은 바로 위 불릿이 "드라이 보드는 팟의 30%로 c-bet"입니다.
  // 거기에 "체크로 시작해도 된다"를 붙이면 같은 목록이 서로 반대를 가리킵니다 — 체크할 보드를 집어서 말합니다.
  else if (pt.pot === '3bp') out.push(ip ? '큰 팟이니 상대가 체크하면 벳' : pt.aggressor ? '낮고 이어진 보드에서는 체크로 시작' : '먼저 액션하니 체크-콜부터 준비');
  else if (ip) out.push('포지션이 있으니 체크를 보고 결정');
  else out.push(pt.aggressor ? '체크-레이즈가 오면 폴드도 고려' : '체크-레이즈할 패도 준비');

  return out.slice(0, 4);
}

function easyBlock(step: Step, info: HandInfo, cls: HandClass): EasyExplanation {
  const verb = verbOf(step);
  const reason = shortReason(cls, verb, step.scenario.kind, info);
  const oneLiner = `${VERDICT[verb]} ${reason}`;
  const easy: EasyExplanation = {
    oneLiner,
    reason,
    why: easyWhy(step, info, cls, verb),
    example: easyExample(step, info, cls, verb),
  };
  const flop = easyFlop(step, info, cls);
  if (flop) easy.flop = flop;
  return easy;
}

/* ------------------------------------------------------------------ */
/* Tier-B glosses (docs/PLAIN_KO_STYLE.md §1.B)                        */
/* ------------------------------------------------------------------ */

/**
 * 어려운 개념은 해설 하나에서 딱 한 번만 풉니다. 앞쪽(결론·왜?·예시·플랍에서는)은 글자 수가 빠듯해서
 * 용어를 그대로 쓰고(용어집에서 눌러 볼 수 있습니다), 풀이는 "자세히" 블록의 첫 등장에만 붙입니다.
 * 긴 용어를 먼저 둬야 "임플라이드 오즈"가 "팟 오즈"보다 먼저 걸립니다.
 * [용어, 풀이, 조사] — 풀이는 문장 가운데가 아니라 그 문장 뒤에 한 문장으로 붙습니다(가이드 §2.1).
 */
const GLOSS: Array<[string, string, '은' | '는']> = [
  ['임플라이드 오즈', '맞았을 때 더 받아낼 수 있는 몫', '는'],
  ['세미 블러프', '드로우를 들고 하는 블러프', '는'],
  ['도미네이트', '같은 카드를 맞춰도 킥커에서 지는 상태', '는'],
  ['셋마이닝', '셋을 노리고 콜하는 것', '은'],
  ['팟 오즈', '콜 금액 대비 팟 크기', '는'],
  ['블로커', '내가 그 카드를 들어 상대 조합이 줄어드는 효과', '는'],
  ['스퀴즈', '오픈과 콜 뒤에 크게 올리는 것', '는'],
  ['백도어', '두 장을 더 맞아야 완성되는 드로우', '는'],
  ['c-bet', '프리플랍 레이저가 플랍에서 잇는 벳', '은'],
  ['SPR', '팟 대비 남은 스택 비율', '은'],
];

/**
 * 용어 풀이 한 문장. 예전에는 용어 바로 뒤에 괄호로 끼워 넣었는데, 그러면 17자짜리 괄호를 뛰어넘어야
 * 서술어에 닿는 50~66자 문장이 됐습니다. 이제는 그 문장을 끝내고 다음 한 문장으로 풉니다.
 * 화면(Term.tsx)은 이 문장이 있는 본문에서 같은 용어에 밑줄을 긋지 않습니다 — 설명은 한 번이면 됩니다.
 */
export function glossSentence(term: string): string | null {
  const g = GLOSS.find(([t]) => t === term);
  return g ? `${g[0]}${g[2]} ${g[1]}입니다.` : null;
}

/** 문장 끝(마침표 + 공백/문자열 끝)을 찾습니다. "1~1.5"의 소수점은 문장 끝이 아닙니다. */
function sentenceEndAfter(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '.') continue;
    if (i + 1 >= text.length || text[i + 1] === ' ') return i + 1;
  }
  return text.length;
}

/** 기술 블록 문자열을 순서대로 훑어 각 용어의 첫 등장 문장 뒤에 풀이 한 문장을 답니다. */
function applyGlosses(exp: Explanation): void {
  const done = new Set<string>();
  // 차트 메모도 같은 "자세히" 블록에 그대로 렌더됩니다. 거기서 이미 푼 용어는 본문에서 다시 풀지 않습니다
  // (가이드 §2.4 — 한 해설 안에서 용어 설명은 딱 한 번). 메모는 괄호 꼴을 씁니다.
  const note = exp.chartNote ?? '';
  for (const [term] of GLOSS) if (note.includes(`${term}(`)) done.add(term);
  const gloss = (text: string): string => {
    let out = text;
    for (const [term] of GLOSS) {
      if (done.has(term)) continue;
      const i = out.indexOf(term);
      if (i < 0) continue;
      done.add(term);
      // 이미 괄호 풀이가 붙어 있으면 그대로 둡니다.
      if (out[i + term.length] === '(') continue;
      const cut = sentenceEndAfter(out, i + term.length);
      out = `${out.slice(0, cut)} ${glossSentence(term) ?? ''}${out.slice(cut)}`;
    }
    return out;
  };
  exp.situation = gloss(exp.situation);
  exp.handProfile = gloss(exp.handProfile);
  exp.reasoning = exp.reasoning.map(gloss);
  exp.rangeContext = gloss(exp.rangeContext);
  if (exp.mixNote) exp.mixNote = gloss(exp.mixNote);
  const p = exp.postflop;
  if (p) {
    p.spr = gloss(p.spr);
    p.checklist = p.checklist.map(gloss);
    p.goodBoards = gloss(p.goodBoards);
    p.badBoards = gloss(p.badBoards);
    p.plan = p.plan.map(gloss);
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export function explainStep(step: Step): Explanation {
  const info = parseHandName(step.hand);
  const cls = classifyHand(step.hand);
  const { scenario: s, answer } = step;
  const kindLabel: Record<ScenarioKind, string> = { rfi: '오픈', vs_open: '오픈 대응', vs_3bet: '3벳 대응', vs_4bet: '4벳 대응', vs_5bet: '올인 대응', cold_4bet: '콜드 4벳' };
  const headline = `${s.hero} ${kindLabel[s.kind]} · ${step.hand} → ${ACTION_SHORT_KO[answer]}`;
  const out: Explanation = {
    headline,
    situation: situationText(s),
    handProfile: `${HAND_CLASS_KO[cls]} · ${handProfile(info, cls)}`,
    reasoning: reasoning(step, cls),
    rangeContext: rangeContext(step),
    mixNote: mixNote(step),
    chartNote: step.chart.notes?.[step.hand],
    postflop: postflopPlan(step, cls),
    easy: easyBlock(step, info, cls),
  };
  applyGlosses(out);
  return out;
}

export { fullMix };
