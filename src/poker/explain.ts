import { getChartCells, hasChart } from './data';
import { ALL_HANDS, parseHandName, type HandInfo } from './hands';
import { foldWeight, fullMix, rangeShare } from './range';
import { heroInPosition } from './scenarios';
import type { Step } from './trainer';
import { ACTION_SHORT_KO, POS_INDEX, type Action, type ChartCells, type Pos, type Scenario, type ScenarioKind } from './types';

/*
 * 해설 생성기. 모든 문장은 docs/PLAIN_KO_STYLE.md(중학생 기준 쉬운 한국어)를 따릅니다.
 *  - `easy`      : 결론 한 줄 → 이유 2~3개 → 실제 카드 예시 → (접지 않을 때) 플랍 뒤 체크리스트
 *  - 나머지 필드 : "더 자세히" 아래에 접혀 보이는 자세한 설명 (같은 말투, 숫자는 차트 데이터에서 계산)
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
  premium_pair: '가장 센 포켓페어',
  big_pair: '큰 포켓페어',
  mid_pair: '중간 포켓페어',
  small_pair: '작은 포켓페어',
  ak: '에이스킹',
  big_ace: 'A + 큰 카드',
  suited_ace: '같은 무늬 A (중간 킥커)',
  wheel_ace: '같은 무늬 휠 에이스',
  offsuit_ace: '다른 무늬 A',
  suited_broadway: '같은 무늬 브로드웨이',
  offsuit_broadway: '다른 무늬 브로드웨이',
  suited_king: '같은 무늬 K',
  suited_qj: '같은 무늬 Q/J + 작은 카드',
  suited_connector: '같은 무늬 커넥터',
  suited_gapper: '같은 무늬 갭퍼',
  offsuit_connector: '다른 무늬 커넥터',
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

/** 중학생용 쉬운 해설. 모든 줄이 짧고, 예시는 실제 카드(♠/♦)로 보여 줍니다. */
export interface EasyExplanation {
  /** 결론 + 짧은 이유. 60자 이하. */
  oneLiner: string;
  /** oneLiner에서 결론을 뺀 이유 절만. 정답 캡슐 바로 아래(결론은 캡슐이 이미 보여 줘요)에 써요. */
  reason: string;
  /** 이유 2~3개. 각 45자 안팎. */
  why: string[];
  /** 실제 카드 예시 1~3줄. */
  example: string[];
  /** 접지 않을 때만: 플랍이 열리면 볼 것 3~4개(보드 예시 포함). */
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

/** "10번 중 3번쯤" 식의 감이 오는 빈도 표현. */
function outOfTen(w: number): string {
  const n = Math.max(1, Math.min(9, Math.round(w * 10)));
  return `10번 중 ${n}번쯤`;
}

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
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'raise', label: '내가 오픈한 패 묶음(레인지)' } : null;
    }
    case 'vs_4bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_open', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'threebet', label: '내가 3벳한 패 묶음(레인지)' } : null;
    }
    case 'vs_5bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_3bet', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'fourbet', label: '내가 4벳한 패 묶음(레인지)' } : null;
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
function freeCard(rank: string, pref: SuitGlyph, taken: Set<string>): string {
  for (const s of [pref, OTHER[pref]]) {
    const c: ExCard = { r: rank, s };
    if (!taken.has(key(c))) {
      taken.add(key(c));
      return cardStr(c);
    }
  }
  return show(rank);
}

/** Render an opponent hand ("AK", "A5s", "QQ") with suits, avoiding the hero's cards. */
function oppHand(name: string, taken: Set<string>): string {
  const hi = name[0];
  const lo = name[1];
  const suited = name[2] === 's';
  const t = new Set(taken);
  if (hi === lo) {
    const a: ExCard = { r: hi, s: '♠' };
    const b: ExCard = { r: hi, s: '♦' };
    if (t.has(key(a)) || t.has(key(b))) return `${hi}${hi}`;
    return `${cardStr(a)}${cardStr(b)}`;
  }
  if (suited) {
    for (const s of ['♦', '♠'] as SuitGlyph[]) {
      const a: ExCard = { r: hi, s };
      const b: ExCard = { r: lo, s };
      if (!t.has(key(a)) && !t.has(key(b))) return `${cardStr(a)}${cardStr(b)}`;
    }
    return `${show(hi)}${show(lo)}(같은 무늬)`;
  }
  const first = freeCard(hi, '♦', t);
  const second = freeCard(lo, first.endsWith('♦') ? '♠' : '♦', t);
  if (!/[♠♦]$/.test(first) || !/[♠♦]$/.test(second)) return `${show(hi)}${show(lo)}`;
  return `${first}${second}`;
}

/**
 * A three-card board string. Each slot takes a rank or a preference list; a rank the hero holds (or one already
 * used) is skipped for the next preference, so the suits come out exactly as requested.
 */
function board(slots: Array<string | string[]>, suits: SuitGlyph[], taken: Set<string>): string {
  const t = new Set(taken);
  const heroRanks = new Set(Array.from(taken, (k) => k[0]));
  const used = new Set<string>();
  return slots
    .map((slot, i) => {
      const prefs = Array.isArray(slot) ? slot : [slot];
      const r = prefs.find((x) => !heroRanks.has(x) && !used.has(x)) ?? prefs[0];
      used.add(r);
      return freeCard(r, suits[i] ?? '♦', t);
    })
    .join('');
}
const DRY_BOARD: string[][] = [['K', 'Q', 'J'], ['7', '8', '6'], ['2', '3', '4']];
/**
 * Ranks for the "nothing here" dry board. A pair (88+) gets three spread ranks BELOW it (QQ → 10·7·2, JJ → 9·6·2,
 * 88 → 7·4·2) so the example never contradicts the "A나 K가 뜨면 조심" bullet next to it; every other hand keeps K·7·2.
 */
function dryRanks(info: HandInfo, cls: HandClass): Array<string | string[]> {
  if (cls === 'premium_pair' || cls === 'big_pair' || cls === 'mid_pair') {
    const top = Math.max(info.highV - 2, 7);
    return [rankOf(top), rankOf(top - 3), '2'];
  }
  return DRY_BOARD;
}
/** Suits for a "nothing here" board: a ♠♠ hero must not be handed a flush draw, so suited hands see at most one ♠. */
const drySuits = (info: HandInfo): SuitGlyph[] => (info.kind === 'suited' ? ['♦', '♠', '♦'] : ['♠', '♦', '♠']);

/** The three board ranks that complete a straight with `info` (connectors / gappers), lowest window first. */
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
    return ranksInWindow.filter((v) => v !== hv && v !== lv).map(rankOf);
  }
  return null;
}

/** The three wheel cards the hero still needs (2-3-4-5 minus the low card), e.g. A2s → 3♦4♠5♦, A4s → 2♦3♠5♦. */
function wheelBoard(info: HandInfo, taken: Set<string>): string {
  const wheel = ['2', '3', '4', '5'].filter((r) => r !== info.low).slice(0, 3);
  return board(wheel, ['♦', '♠', '♦'], taken);
}

/** A dry-ish "nothing hit" board for the hand: three spread ranks that avoid the hero's ranks. */
function missBoard(info: HandInfo, taken: Set<string>): string {
  const avoid = new Set<string>([info.high, info.low]);
  const pool = ['K', '9', '4', 'Q', '8', '3', 'J', '7', '2', 'T', '6', '5'];
  const picked: string[] = [];
  for (const r of pool) {
    if (avoid.has(r)) continue;
    if (picked.length && Math.abs(rankV(r) - rankV(picked[picked.length - 1])) <= 1) continue;
    picked.push(r);
    if (picked.length === 3) break;
  }
  picked.sort((a, b) => rankV(b) - rankV(a));
  return board(picked, drySuits(info), taken);
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
/* Hand profile (더 자세히 · 손패 설명)                                   */
/* ------------------------------------------------------------------ */

function dominators(info: HandInfo): string {
  if (info.lowV === 12) return 'AK·큰 페어';
  if (info.lowV === 11) return 'AK·AQ·큰 페어';
  return 'AK·AQ·AJ·큰 페어';
}

function handProfile(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  const suited = info.kind === 'suited';
  switch (cls) {
    case 'premium_pair':
      return n === 'AA'
        ? 'AA는 시작할 때 가장 강한 패예요. 어떤 패를 만나도 앞서 있어요(KK를 만나도 10번 중 8번 이겨요). 목표는 판을 최대한 키우는 거예요.'
        : 'KK는 두 번째로 강한 패예요. 웬만한 패는 10번 중 8번 이기지만 AA한테는 크게 져요(10번 중 2번). 그래도 플랍 전에 접는 일은 거의 없어요.';
    case 'big_pair':
      return `${hp(info, '는')} 큰 포켓페어(손에 든 두 장이 같은 숫자)예요. 대부분의 패보다 앞서지만 AA·KK한테는 크게 지고, 플랍에 A나 K가 뜨면 갑자기 불안해져요.`;
    case 'mid_pair':
      return `${hp(info, '는')} 중간 포켓페어예요. 보드보다 높은 페어(오버페어)가 되는 판이 많지 않아서, 셋(같은 숫자 3장)을 노리면서 작은 판을 이기는 패예요. 큰 판에서는 보통 상대의 뻥(블러프)만 잡는 역할이에요.`;
    case 'small_pair':
      return `${hp(info, '는')} 작은 포켓페어예요. 플랍에서 셋(같은 숫자 3장)이 될 확률이 약 8분의 1이고, 그때 크게 딸 수 있다는 기대(임플라이드 오즈)가 핵심이에요. 셋이 아니면 거의 항상 상대 페어보다 작아요.`;
    case 'ak':
      return `${n}는 페어가 아닌 패 중 가장 강해요. 페어가 아닌 다른 패는 다 킥커(옆 카드)로 이기고, QQ 아래 페어와는 반반이에요. 하지만 KK를 만나면 10번 중 3번, AA를 만나면 10번 중 1번만 이겨요. A나 K가 뜨면 가장 좋은 탑페어가 돼요.`;
    case 'big_ace':
      return `${n}는 A에 큰 카드가 붙은 패예요. 약한 A를 든 상대는 킥커로 이기지만, ${dominators(info)}를 만나면 같은 A를 맞춰도 킥커에서 져요(도미네이트). 그래서 상대가 센 패만 들수록 가치가 떨어져요.${suited ? ' 같은 무늬라서 가장 높은 플러시(넛)도 노릴 수 있어요.' : ''}`;
    case 'suited_ace':
      return `${n}는 같은 무늬(수티드) A예요. 가장 높은 플러시(넛 플러시)를 노릴 수 있고, 내가 A를 들어 상대가 AA·AK일 확률이 줄어요(블로커). 대신 A를 맞춰도 킥커가 약해서 큰 판보다 작은 판에 어울려요.`;
    case 'wheel_ace':
      return `${n}는 같은 무늬 휠 에이스(A에 작은 카드)예요. 넛 플러시와 A-2-3-4-5 스트레이트를 노릴 수 있고 A 블로커도 있어서, 솔버(컴퓨터 계산)가 3벳·4벳 뻥(블러프) 재료로 가장 좋아하는 패예요. A를 맞춘 페어 자체는 약해요.`;
    case 'offsuit_ace':
      return `${n}는 다른 무늬(오프수트) A예요. 플러시가 안 되고 킥커가 약해서, 같은 A를 맞춰도 킥커에서 지기 쉬워요(도미네이트). 뒷자리에서 상대 패가 넓을 때만 쓸 만해요.`;
    case 'suited_broadway':
      return `${n}는 같은 무늬 브로드웨이(큰 카드 두 장)예요. 탑페어·스트레이트·플러시를 고루 만들 수 있어서 플랍 뒤에 놀기 좋고, 콜하는 패 묶음의 중심이에요.`;
    case 'offsuit_broadway':
      return `${n}는 다른 무늬 브로드웨이예요. 탑페어는 자주 만들지만 킥커에서 지기 쉽고 플러시가 없어요. 상대 패가 셀 때는 콜보다 접거나 올리는 쪽이 나아요.`;
    case 'suited_king':
      return `${n}는 같은 무늬 K예요. K 높은 플러시와 K 블로커가 있지만 킥커가 약해서, K 한 쌍만으로 큰 판을 이기기는 어려워요.`;
    case 'suited_qj':
      return `${n}는 같은 무늬 Q/J에 작은 카드가 붙은 패예요. 플러시나 백도어(두 장 더 맞아야 완성) 가능성으로 뒷자리에서 오픈하거나, 상대 패가 아주 넓을 때만 써요.`;
    case 'suited_connector':
      return `${n}는 같은 무늬 커넥터(숫자가 이어진 두 장)예요. 스트레이트·플러시 같은 가장 센 패(넛)를 만들 수 있어서 크게 딸 기대(임플라이드 오즈)가 좋고, 낮은 보드에서 강해요.`;
    case 'suited_gapper':
      return `${n}는 같은 무늬 갭퍼(숫자 사이가 비는 두 장)예요. 커넥터보다 스트레이트는 덜 되지만 플러시와 백도어가 있어서, 나중에 행동하는 자리(포지션)에서는 쓸 만해요.`;
    case 'offsuit_connector':
      return `${n}는 다른 무늬 커넥터예요. 스트레이트는 되지만 플러시가 없고 페어를 맞춰도 약해서, 상대 패가 아주 넓은 상황(주로 BB 방어)에서만 플레이해요.`;
    case 'junk':
      return suited
        ? `${n}는 같은 무늬지만 숫자가 작은 패예요. 플러시는 노릴 수 있지만 큰 카드도 스트레이트도 부족해서, 상대 패가 가장 넓을 때만 플레이해요.`
        : `${n}는 플랍 전 가치가 낮은 패예요. 큰 카드·플러시·스트레이트 가능성이 모두 부족해서 거의 모든 상황에서 접어요.`;
  }
}

/* ------------------------------------------------------------------ */
/* Hand-level rationale (더 자세히 · 자세한 이유)                          */
/* ------------------------------------------------------------------ */

const OPEN: Record<HandClass, string> = {
  premium_pair: '가장 센 패라서 먼저 올려(오픈) 판을 키워요. 3벳을 받으면 4벳으로 돈을 더 받아요.',
  big_pair: '대부분의 패보다 앞서 있어서 돈을 받으려고 올려요(밸류). 3벳을 받아도 편하게 계속 가요.',
  mid_pair: '오픈하는 패 묶음에서 안정적인 패예요. 셋(같은 숫자 3장)도 노리고, 끝까지 가도 페어로 이길 수 있어요.',
  small_pair: '셋을 노릴 수 있어서 올려요(셋마이닝). 3벳을 받으면 보통 접지만, 칩이 깊고 내가 나중에 행동하면 콜도 돼요.',
  ak: '이기는 힘과 플랍 뒤 놀기 좋음을 다 갖춘 최고의 오픈 패예요. 3벳을 받으면 4벳이나 콜로 계속 가요.',
  big_ace: '약한 A와 브로드웨이를 킥커로 이기니까 돈을 받으려고 올려요. 3벳을 받으면 보통 콜로 대응해요.',
  suited_ace: '넛 플러시 가능성과 A 블로커 덕분에 어느 자리에서든 오픈할 수 있어요. 3벳을 받으면 대체로 접거나, 뻥(블러프) 4벳 재료가 돼요.',
  wheel_ace: '넛 플러시·휠 스트레이트 가능성과 A 블로커 때문에 오픈 묶음에 항상 들어가요. 3벳을 받으면 뻥 4벳 후보예요.',
  offsuit_ace: '뒷자리에서는 블라인드를 그냥 가져오려고 올려요. 킥커가 약해서 3벳을 받으면 접어요.',
  suited_broadway: '탑페어·스트레이트·플러시를 고루 만들어서 플랍 뒤에 놀기 좋은 오픈 패예요.',
  offsuit_broadway: '탑페어를 자주 만들어서 오픈하지만, 킥커에서 질 위험 때문에 앞자리에서는 빠져요.',
  suited_king: 'K 높은 플러시와 백도어 가능성으로 뒷자리에서 오픈해요. 3벳에는 대부분 접어요.',
  suited_qj: '플러시·백도어 가능성으로 뒷자리에서만 오픈하는 아래쪽 패예요.',
  suited_connector: '가장 센 패(넛)를 만들 수 있어서 오픈 묶음의 균형을 잡아 줘요. 낮은 보드에서 강해요.',
  suited_gapper: '플러시·스트레이트 가능성으로 뒷자리 오픈 묶음에 들어가요.',
  offsuit_connector: '아주 넓게 오픈하는 자리에서만 블라인드를 노리고 올려요.',
  junk: '아주 넓게 오픈하는 자리에서만 블라인드를 노리고 올려요.',
};

const AGGRESSIVE: Record<HandClass, string> = {
  premium_pair: '가장 센 패라서 돈을 최대한 받아요(밸류). 상대가 콜하거나 다시 올릴수록 이득이에요.',
  big_pair: '상대 패 대부분보다 앞서니까 돈을 받으려고 올려요. 상대가 더 세게 올리면 AA·KK를 생각하고 속도를 줄일 준비를 해요.',
  mid_pair: '상대의 넓은 패보다 앞서면서, 상대가 접어 주는 이득(폴드 에퀴티)도 얻어요. 다시 올리면 대부분 접거나 콜로 셋을 노려요.',
  small_pair: '상대가 접어 주는 이득과 셋 가능성을 함께 노려요. 다시 올리면 접는 게 기본이에요.',
  ak: '이기는 힘과 상대가 접어 주는 이득을 다 가진 최고의 공격 패예요. 다시 올려도 이길 확률이 충분해요.',
  big_ace: '상대의 약한 A·브로드웨이를 킥커로 이기면서 돈을 받아요. AK·큰 페어가 다시 올리면 물러나요.',
  suited_ace: 'A 블로커로 상대의 가장 센 패를 줄이고 상대가 접게 만드는, 반쯤 뻥(세미 블러프) 공격이에요. 콜을 받아도 넛 플러시 가능성이 있어요.',
  wheel_ace: 'A 블로커와 넛 가능성을 가진 전형적인 뻥(블러프) 레이즈예요. 콜하면 킥커에서 지기 쉬워서 접기보다 올리는 게 나아요.',
  offsuit_ace: 'A 블로커를 이용해 상대가 접기를 노리는 공격이에요. 다시 올리면 바로 접어요.',
  suited_broadway: '이기는 힘과 플랍 뒤 놀기 좋음을 함께 갖춰서 공격에 어울려요. 콜을 받아도 플랍 뒤에 괜찮아요.',
  offsuit_broadway: '콜하면 킥커에서 질 위험이 크니까, 상대가 접게 만드는 공격이 더 나아요. 다시 올리면 접어요.',
  suited_king: 'K 블로커와 플러시 가능성을 가진 반쯤 뻥(세미 블러프) 공격이에요.',
  suited_qj: '블로커와 플러시 가능성을 이용한, 가끔만 하는 뻥(블러프)이에요.',
  suited_connector: '넓은 패 상대로 접게 만들고, 콜을 받아도 넛 가능성으로 균형 잡힌 패 묶음을 만들어요.',
  suited_gapper: '상대가 접기를 노리는 뻥(블러프)이고, 콜을 받으면 플러시·스트레이트 가능성으로 플레이해요.',
  offsuit_connector: '상대 패가 넓은 상황에서 상대가 접기를 노리는 공격이에요.',
  junk: '상대 패가 넓은 상황에서만 상대가 접기를 노려요.',
};

const CALL: Record<HandClass, string> = {
  premium_pair: '다시 올리지 않고 콜해서 상대의 뻥(블러프)을 살려 두는 작전(트랩)이에요. 상대 패가 아주 센 것과 뻥으로 갈릴 때 잘 통해요.',
  big_pair: '다시 올리면 AA·KK만 남고 약한 패는 접어 버려요. 콜로 판 크기를 조절하면서 상대의 약한 패를 붙잡아 둬요.',
  mid_pair: '내 페어보다 큰 카드가 자주 뜨니까 판을 키우기보다, 콜로 셋 가능성과 페어의 힘을 함께 가져가요.',
  small_pair: '셋을 노리는 콜(셋마이닝)이에요. 상대 칩이 깊고(크게 딸 기대), 뒤에서 스퀴즈(누가 올리고 콜한 뒤 크게 올리는 것)당할 위험이 낮을 때 콜해요.',
  ak: '상대 패가 아주 세서 다시 올리면 더 센 패만 남을 때는, 콜로 내 이길 확률을 살려요.',
  big_ace: '다시 올리면 내가 이기는 패는 접고 나를 이기는 패만 남으니까, 콜이 더 좋아요.',
  suited_ace: '넛 플러시 가능성과 A 높은 카드의 힘으로 콜해서 플랍을 봐요. 3벳은 킥커가 약해서 돈을 받을 힘이 부족해요.',
  wheel_ace: '넛 플러시·휠 스트레이트가 되면 크게 딸 수 있어서(임플라이드 오즈) 콜해요.',
  offsuit_ace: '상대 패가 넓을 때만 콜해요. A가 뜨면 킥커 문제 때문에 큰 판은 피해요.',
  suited_broadway: '플랍 뒤에 놀기 좋고 상대 브로드웨이한테 킥커로 질 위험이 적어서, 콜하는 패 묶음의 중심이에요.',
  offsuit_broadway: '탑페어를 자주 만들어서 콜하지만, 맞추고도 더 큰 패에 져서 크게 잃을 위험(리버스 임플라이드 오즈) 때문에 큰 판은 피해요.',
  suited_king: 'K 높은 플러시와 백도어 가능성으로 싼값에 플랍을 봐요.',
  suited_qj: '플러시·백도어 가능성으로, 상대 패가 넓을 때만 콜해요.',
  suited_connector: '가장 센 스트레이트·플러시로 상대의 센 패한테서 큰 판을 이길 수 있어서, 크게 딸 기대(임플라이드 오즈)로 콜해요.',
  suited_gapper: '넛 가능성과 백도어를 가진, 크게 딸 기대(임플라이드 오즈)로 하는 콜이에요.',
  offsuit_connector: '싼값에 스트레이트 가능성을 노리는 콜이에요.',
  junk: '값이 아주 쌀 때만 콜해요.',
};

const FOLD: Record<HandClass, string> = {
  premium_pair: '',
  big_pair: '상대 패가 AA·KK 위주로 아주 좁아서 이길 확률이 부족해요.',
  mid_pair: '상대 패에는 내 페어보다 큰 페어(오버페어)가 많고, 셋을 맞춰도 충분히 크게 딸 수 없어요.',
  small_pair: '셋이 될 확률(약 8분의 1)에 비해 딸 수 있는 돈이 부족하고, 셋이 아니면 이길 수 없어요.',
  ak: '상대 패가 KK 이상 위주라서 AK도 이길 확률이 부족해요.',
  big_ace: 'AK·AQ·큰 페어를 만나면 같은 A를 맞추고도 킥커에서 져서 크게 잃어요(리버스 임플라이드 오즈). 콜하면 손해예요.',
  suited_ace: '이 자리에서는 킥커가 약해서 돈을 받을 힘이 부족하고, 콜해서 크게 딸 기대도 충분하지 않아요.',
  wheel_ace: '뻥(블러프)으로 올리는 빈도는 이미 충분하고, 콜하기에는 A 페어의 힘이 너무 약해요.',
  offsuit_ace: '플러시가 없고 킥커가 약해서 같은 A를 맞추고도 지기 쉬워요. 이 자리에서는 접어요.',
  suited_broadway: '상대 패가 세서 브로드웨이는 킥커에서 지기 쉬워요.',
  offsuit_broadway: '탑페어를 맞춰도 킥커에서 지는 경우가 많고 플러시가 없어서, 이 자리에서는 접어요.',
  suited_king: '킥커가 약해서 K 페어의 힘이 낮고, 이 자리의 패 묶음에는 들어가지 않아요.',
  suited_qj: '큰 카드의 힘이 부족하고, 플러시만으로는 이 자리의 값을 감당하지 못해요.',
  suited_connector: '이 자리에서는 스트레이트·플러시 가능성만으로 상대의 센 패를 이기지 못해요.',
  suited_gapper: '숫자 사이가 비어서 스트레이트도 잘 안 되고, 큰 카드의 힘도 부족해요.',
  offsuit_connector: '플러시가 없고 큰 카드의 힘도 낮아서 접어요.',
  junk: '큰 카드·플러시·스트레이트 가능성이 모두 부족한 패는 자리와 상관없이 접어요.',
};

/** All-in nodes (vs_5bet, and 'allin' answers) need their own wording — there is no re-raise to talk about. */
function allInRationale(step: Step, cls: HandClass): string {
  const { answer, scenario: s } = step;
  if (s.kind === 'vs_5bet') {
    if (answer === 'call') {
      return cls === 'premium_pair'
        ? '올인을 콜해요. 상대의 올인 패(KK 이상·AK 위주)보다도 크게 앞서요.'
        : cls === 'ak'
          ? '올인을 콜해요. 내 A와 K가 블로커가 되어 상대가 AA·KK일 확률을 절반으로 줄이고, AK끼리는 비기는 판이 많아서 필요한 이길 확률(약 38~40%)을 간신히 넘겨요.'
          : '올인을 콜해요. 상대의 올인 패에 QQ·AK가 충분히 섞여 있어서 필요한 이길 확률(약 38~40%)을 넘겨요.';
    }
    return cls === 'wheel_ace' || cls === 'suited_ace'
      ? '4벳은 뻥(블러프)이었으니까 올인에는 접어요. 블로커의 역할은 4벳에서 끝났어요.'
      : cls === 'big_pair' || cls === 'ak'
        ? '상대의 올인 패(KK 이상·AK 위주)를 이길 확률이 필요한 확률(약 38~40%)에 못 미쳐서 접어요. 4벳까지 넣은 칩은 잊고 남은 결정만 봐요.'
        : '상대의 올인 패를 이길 확률이 부족해서 접어요.';
  }
  // answer === 'allin' (5-bet jam) in vs_4bet
  switch (cls) {
    case 'premium_pair':
      return '올인(5벳)해요. 상대의 4벳 패(QQ 이상·AK + A5s 같은 뻥) 전부보다 앞서니까 올인으로 돈을 최대한 받고, 뻥이 접는 이득도 챙겨요. 올인 뒤에는 더 결정할 게 없어요.';
    case 'big_pair':
    case 'ak':
      return '올인(5벳)해요. 콜하면 먼저 행동하는 자리에서 남은 칩이 적은 채로 플레이하기 어려워요. 올인하면 상대의 4벳 뻥(A5s 같은 패)을 접게 하면서 AK·JJ와는 앞서거나 반반이에요.';
    case 'wheel_ace':
    case 'suited_ace':
      return '뻥(블러프) 올인이에요. A 블로커로 상대의 AA·AK를 줄여서 상대가 접을 확률을 높이고, 콜을 받아도 10번 중 3번쯤은 이겨요. 상대 4벳 패가 넓을 때만 가끔 써요.';
    default:
      return '올인해서 상대의 4벳 뻥은 접게 하고, 센 패와는 반반 승부를 받아요.';
  }
}

/* ------------------------------------------------------------------ */
/* Scenario-level reasoning (더 자세히)                                   */
/* ------------------------------------------------------------------ */

function scenarioLines(step: Step): string[] {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const out: string[] = [];
  const vc = villainChart(s);
  const vShare = vc ? rangeShare(vc.cells, vc.action) : null;
  const ip = heroIsIP(s);

  switch (s.kind) {
    case 'rfi': {
      const openShare = rangeShare(step.cells, 'raise');
      if (hero === 'SB') out.push(`SB는 BB 한 명만 남아서 넓게(약 ${pct(openShare)}) 오픈해요. 하지만 플랍 뒤에는 항상 먼저 행동해야 해서(아웃오브포지션) 3bb로 크게 올려 BB의 콜을 줄여요.`);
      else if (hero === 'BTN') out.push(`BTN은 플랍 뒤에 항상 나중에 행동하고(포지션) 블라인드 두 명만 상대해서, 가장 넓게(약 ${pct(openShare)}) 오픈해요.`);
      else out.push(`${seat(hero, '는')} 뒤에 ${seatsBehind(hero)}명이 남아 있어서 오픈하는 패 묶음을 약 ${pct(openShare)}로 줄여요. 뒤에 사람이 많을수록 3벳을 당하거나 불리한 자리에서 플레이할 확률이 커요.`);
      break;
    }
    case 'vs_open': {
      out.push(
        `${seat(v!, '는')} 전체 패의 약 ${vShare == null ? '?' : pct(vShare)}로 오픈해요. ${isEarly(v) ? '앞자리라 센 패 위주여서, 브로드웨이나 중간 A는 킥커에서 지기 쉬워요. 그래서 방어하는 패 묶음을 좁혀요.' : '뒷자리라 약한 패도 많이 섞여 있어서, 더 넓게 방어하고 3벳도 더 자주 해요.'}`,
      );
      if (hero === 'BB') {
        out.push(
          v === 'SB'
            ? 'BB는 이미 1bb를 냈으니까 2bb만 더 내고 약 6bb 판을 봐요(이기는 확률이 약 33%만 되면 손해가 아니에요). SB 상대로는 플랍 뒤에 나중에 행동해서 가장 넓게 방어해요.'
            : 'BB는 이미 1bb를 냈으니까 1.5bb만 더 내고 약 5.5bb 판을 봐요(이기는 확률이 약 27%만 되면 손해가 아니에요). 내가 마지막 차례라 뒤에서 누가 크게 올릴 걱정이 없어서 가장 넓게 콜하고, 3벳은 센 패와 뻥(같은 무늬 휠 에이스, 같은 무늬 커넥터)으로 나눠요.',
        );
      } else if (hero === 'SB') {
        out.push(
          answer === 'call'
            ? 'SB는 보통 3벳 아니면 접기지만, 이 패는 예외로 콜해요. 2bb를 더 내고 약 6bb 판을 보되(필요한 이길 확률 약 33%), BB가 크게 올릴 위험(스퀴즈)과 먼저 행동하는 불리함을 감수해요.'
            : 'SB는 콜하면 BB가 크게 올릴 위험(스퀴즈)과 먼저 행동하는 불리함이 겹쳐서, 3벳 아니면 접기 위주로 대응해요.',
        );
      } else {
        out.push(`${seat(hero, '는')} 플랍 뒤에 나중에 행동하지만 뒤에 ${seatsBehind(hero)}명이 남아 있어서, 콜하는 패는 뒤에서 크게 올려도(스퀴즈) 버틸 수 있는 패로 제한해요. 2.5bb를 내고 약 6.5bb 판을 봐요(필요한 이길 확률 약 38%).`);
      }
      break;
    }
    case 'vs_3bet': {
      out.push(
        `${seat(v!, '는')} 전체 패의 약 ${vShare == null ? '?' : pct(vShare)}로 3벳해요. ${isBlind(v) ? '센 패와 뻥(블러프)이 섞인 패 묶음이에요.' : '센 패 위주의 패 묶음이에요.'}`,
      );
      out.push(
        isBlind(v)
          ? `블라인드의 3벳(약 10~11bb)에 8bb 정도를 더 내고 약 22bb 판을 봐요(필요한 이길 확률 약 36%). ${ip ? '내가 플랍 뒤에 나중에 행동해서 콜해도 이길 확률을 살리기 쉬워요.' : '내가 먼저 행동해야 해서 콜하는 패를 좁히고 4벳이나 접기 비중을 높여요.'}`
          : `뒷자리의 3벳(약 7.5bb)에 5bb를 더 내고 약 16.5bb 판을 봐요(필요한 이길 확률 약 30%). 하지만 플랍 뒤에 먼저 행동해야 해서, 실제로 이기는 확률은 그보다 줄어요.`,
      );
      break;
    }
    case 'vs_4bet': {
      out.push(`${seat(v!, '는')} 전체 패의 약 ${vShare == null ? '?' : pct(vShare)}로 4벳해요: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내가 3벳한 패 중 올인하는 패: ${summarizeRange(step.cells, 'allin', 6)} / 콜하는 패: ${summarizeRange(step.cells, 'call', 6)}. 나머지는 접어요.`);
      out.push('4벳(약 22~25bb)을 콜하면 남은 칩이 판 크기의 1~1.5배뿐인 큰 판이 돼요. 필요한 이길 확률은 약 30%지만, 남은 칩이 적어서 플랍에서 사실상 올인까지 가요.');
      break;
    }
    case 'vs_5bet': {
      out.push(`${seat(v!, '는')} 전체 패의 약 ${vShare == null ? '?' : pct(vShare)}로 올인(5벳)해요: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내가 4벳한 패 중 콜하는 패: ${summarizeRange(step.cells, 'call', 6)}. 뻥으로 4벳한 패(A5s 등)는 당연히 접어요.`);
      out.push('올인 콜에 필요한 이길 확률은 약 38~40%예요(4벳 22~25bb 뒤 100bb 올인). 이미 넣은 4벳 칩은 돌아오지 않으니 잊어요.');
      break;
    }
    case 'cold_4bet': {
      out.push('앞에 오픈한 사람과 3벳한 사람이 모두 있어서 두 사람의 패를 동시에 상대해요. 콜하면 오픈한 사람이 다시 4벳할 수도 있어요.');
      out.push(
        answer === 'call'
          ? '여기서 콜은 드문 예외예요. 셋 같은 센 패를 노리고 3벳 판을 보되, 오픈한 사람이 4벳하면 접을 준비를 해요.'
          : '여기서 4벳하는 패는 KK 이상과 A5s 같은 소수의 뻥뿐이라 아주 좁아요. 콜은 QQ·AK 정도로만 가끔 하고, 나머지는 모두 접어요.',
      );
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

  let handLine: string;
  if (s.kind === 'vs_5bet' || answer === 'allin') handLine = allInRationale(step, cls);
  else if (s.kind === 'rfi' && answer === 'raise') handLine = OPEN[cls];
  else if (isAggressive) handLine = AGGRESSIVE[cls];
  else if (answer === 'call') handLine = CALL[cls];
  else handLine = FOLD[cls] || '이 자리에서는 접는 게 가장 손해가 적어요.';

  if (answer === 'fold' && mixed) handLine = `기본은 접기지만 가끔은 계속 플레이해요. ${handLine}`;
  else if (answer !== 'fold' && step.mixList.length >= 2) {
    const alt = step.mixList[1];
    if (alt && alt.action === 'fold' && mixed) handLine = `${handLine} 경계에 있는 패라서 ${outOfTen(alt.weight)}은 접어요.`;
    else if (alt && alt.action !== 'fold') handLine = `${handLine} ${ACTION_SHORT_KO[alt.action]}도 ${outOfTen(alt.weight)} 섞어요.`;
  }

  const out = [handLine, ...lines];

  const ip = heroIsIP(s);
  if (answer === 'call' && !ip && s.kind !== 'vs_5bet' && !(s.kind === 'vs_open' && s.hero === 'SB')) {
    out.push('먼저 행동해야 하는 자리(아웃오브포지션)에서 콜하니까, 플랍 뒤에는 체크하고 콜하거나 체크했다가 올리는(체크-레이즈) 계획이 필요해요. 이길 확률을 살리기 어려운 만큼 센 패 위주로만 콜해요.');
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
    if (answer === 'fold') return `${prev.label} 중 약 ${pct(contOfPrev)}만 계속 플레이해요. 이 패는 거기에 안 들어가요.`;
    const actShare = rangeShare(step.cells, answer);
    return `${prev.label} 중 약 ${pct(contOfPrev)}가 계속 플레이해요(${label}은 약 ${pct(prevShare > 0 ? actShare / prevShare : 0)}). 이 패는 그 안에 들어가요.`;
  }
  const total = rangeShare(step.cells);
  if (answer === 'fold') return `이 상황에서 ${seat(s.hero, '가')} 계속 플레이하는 패 묶음(레인지)은 전체 패의 약 ${pct(total)}이에요. 이 패는 거기에 안 들어가요.`;
  const share = rangeShare(step.cells, answer);
  const extra = Math.abs(share - total) > 0.001 ? ` (계속 플레이하는 패는 다 합쳐 약 ${pct(total)})` : '';
  return `${label}하는 패 묶음(레인지)은 전체 패의 약 ${pct(share)}${extra}이에요. 이 패는 그 안에 들어가요.`;
}

function mixNote(step: Step): string | undefined {
  const list = step.mixList;
  if (list.length <= 1) return undefined;
  const parts = list.map((m) => `${ACTION_SHORT_KO[m.action]} ${Math.round(m.weight * 100)}%`).join(' / ');
  const fold = foldWeight(step.mix);
  const tie = list.length >= 2 && Math.abs(list[0].weight - list[1].weight) < 1e-6;
  const tieNote = tie ? ' 빈도가 같으면 더 공격적인 쪽을 정답으로 삼아요.' : ' 외울 때는 가장 자주 하는 쪽을 정답으로 삼아요.';
  let tip: string;
  if (step.scenario.kind === 'rfi') tip = '뒤에 3벳을 자주 하는 사람이 있으면 접는 쪽으로, 조심스러운 사람만 남았으면 오픈하는 쪽으로 기울여요.';
  else if (fold > 0 && fold < 1) tip = '경계에 있는 패예요. 상대가 센 패만 하면 접는 쪽으로, 아무 패나 하면 플레이하는 쪽으로 기울여요.';
  else tip = '섞어서 하는 패예요. 상대가 4벳·5벳을 자주 하면 콜 쪽으로, 자주 접으면 공격 쪽으로 기울여요.';
  return `솔버(컴퓨터 계산) 빈도: ${parts}.${tieNote} ${tip}`;
}

/* ------------------------------------------------------------------ */
/* Postflop plan (더 자세히 · 플랍 이후 계획)                               */
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

const POT_LABEL: Record<PotType, string> = { srp: '한 번 올린 판', '3bp': '3벳 판', '4bp': '4벳 판' };
const SPR_TEXT: Record<PotType, string> = {
  srp: '남은 칩이 판의 10~18배(SPR, 깊음): 페어 하나로 칩을 다 넣지 않아요. 셋·투페어·강한 드로우가 칩을 다 거는 패예요.',
  '3bp': '남은 칩이 판의 4~6배(SPR, 중간): 오버페어나 가장 좋은 킥커의 탑페어는 대체로 끝까지 가도 되고, 약한 탑페어는 두 번 거는 정도가 한계예요.',
  '4bp': '남은 칩이 판의 1~1.5배(SPR, 얕음): 오버페어·탑페어·강한 드로우면 올인이 기본이에요. 플랍에서 사실상 마지막 결정을 해요.',
};

function postflopPlan(step: Step, cls: HandClass): PostflopPlan | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const { scenario: s } = step;
  const hero = s.hero;
  const ip = heroIsIP(s);
  const info = parseHandName(step.hand);
  const four = pt.pot === '4bp';
  const bet = pt.aggressor ? '걸어요' : '체크-레이즈하거나 콜해요';

  const checklist: string[] = [
    `누구한테 유리한 보드인가: 이 보드가 ${pt.aggressor ? '플랍 전에 마지막으로 올린 사람(어그레서, 나)' : '플랍 전에 마지막으로 올린 사람(어그레서, 상대)'}의 패 묶음에 잘 맞나요? A·K가 높은 보드나 브로드웨이 보드는 올린 쪽, 낮고 이어진 보드(예: 8♠7♦6♠)는 콜한 쪽에 유리해요.`,
    '가장 센 패는 누구 쪽에 많은가: 셋·투페어·스트레이트 같은 최강 패를 누가 더 많이 가질까요? 그쪽이 크게 걸 수 있어요.',
    '내 패의 상태: 이미 완성된 패(오버페어·탑페어·셋)인지, 드로우(한 장만 더 맞으면 완성)인지, 아무것도 없는지(큰 카드·블로커뿐) 나눠 보세요.',
    SPR_TEXT[pt.pot],
    '보드 모양: 드라이 보드(드로우가 거의 없는 보드)면 작게(판의 25~33%) 자주 걸고, 웻 보드(드로우가 많은 보드)면 크게(판의 60~75%) 좁게 걸어요.',
    `자리: 나는 ${ip ? '나중에 행동해요(인포지션)' : '먼저 행동해요(아웃오브포지션)'}. ${ip ? '상대가 체크하면 걸지 말지 고를 수 있어서 이길 확률을 살리기 쉬워요.' : '체크 비중을 높이고, 체크 뒤 콜하거나 올리는 패를 준비해요.'}`,
    '상대 성향: 상대가 먼저 걸거나, 체크-레이즈하거나, 콜하는 빈도가 보통보다 높나요 낮나요? 거기서 이득을 찾아요.',
  ];

  let good = '';
  let bad = '';
  const plan: string[] = [];
  const suitedNote = info.kind === 'suited' ? ' 같은 무늬가 두 장 깔리면 플러시 드로우, 한 장이면 백도어 플러시라서 계속 갈 근거가 돼요.' : '';

  switch (cls) {
    case 'premium_pair':
    case 'big_pair':
      good = `내 페어보다 낮은 카드만 있는 보드(오버페어). ${cls === 'big_pair' ? 'A·K가 없는' : '거의 모든'} 보드에서 돈을 받으려고 ${bet}.`;
      bad = cls === 'big_pair' ? 'A나 K가 뜬 보드(QQ·JJ는 작은 페어가 돼요), 4장이 이어지거나 한 무늬가 3장인 보드.' : '4장이 이어진 스트레이트 보드, 한 무늬 3장 보드, 상대가 세게 버텨서 셋이 의심될 때.';
      if (four) {
        plan.push('오버페어면 플랍에서 걸거나 올인해요. 내 페어보다 큰 카드 한 장 정도는 무시하고 끝까지 가요.');
        plan.push(cls === 'big_pair' ? 'A와 K가 둘 다 깔린 보드에서만 접고, 한 장이면 대부분 끝까지 가요.' : '사실상 어떤 보드에서도 칩을 다 넣어요.');
      } else {
        plan.push(pt.aggressor ? '오버페어면 세 번(플랍·턴·리버) 걸어서 돈을 받아요(드라이 보드는 작게, 웻 보드는 크게).' : '오버페어면 콜한 쪽으로서 체크-레이즈하거나, 두세 번 콜·레이즈하면서 돈을 받아요.');
        plan.push(cls === 'big_pair' ? '내 페어보다 큰 카드가 뜨면 판을 작게 유지해요: 한 번 걸고 체크, 크게 올리면 접는 것도 생각해요.' : '상대가 다시 올려도 대부분 콜하거나 또 올려요. 4장이 이어진 보드에서만 속도를 줄여요.');
      }
      break;
    case 'mid_pair':
    case 'small_pair':
      good = '셋을 맞춘 보드(약 8분의 1). 또는 낮은 보드에서 내 페어가 제일 높을 때(중간 페어).';
      bad = '내 페어보다 큰 카드가 2장 이상 깔렸는데 상대가 걸 때.';
      if (four) {
        plan.push('4벳 판(남은 칩이 판의 1.5배쯤)에서는 오버페어면 올인하고, 큰 카드 1장이면 상대가 거는 크기를 보고, 2장이면 접어요.');
        plan.push('셋이면 어떤 보드에서든 칩을 다 넣어요. 상대 패에는 오버페어가 많아요.');
      } else {
        plan.push('셋이면 웻 보드에서는 바로 올리거나 걸어서 판을 키우고, 드라이 보드에서는 한 번쯤 천천히 가도 돼요.');
        plan.push(cls === 'small_pair' ? '셋이 아니면 상대가 걸 때 접는 게 기본이에요. 상대가 체크하면 싸게 끝까지 가 보거나 상대의 뻥을 잡아요.' : '오버페어면 두 번 걸어서 돈을 받고, 작은 페어면 작은 벳만 콜하면서 상대의 뻥을 잡는 역할이에요.');
        if (pt.pot === '3bp') plan.push('3벳 판에서는 상대가 오버페어일 때가 많아요. 셋이 아니면 큰 벳에는 접어요.');
      }
      break;
    case 'ak':
    case 'big_ace':
      good = `A나 ${show(info.low)}가 제일 높은 보드(탑페어 + ${cls === 'ak' ? '가장 좋은 킥커' : '좋은 킥커'}). A가 높은 드라이 보드가 최고예요.`;
      bad = '낮고 이어진 보드(예: 8-7-6, 6-5-4)에서 상대가 버틸 때. 스트레이트·플러시가 이미 완성된 보드.';
      if (four) {
        plan.push(`4벳 판에서는 A나 ${show(info.low)}가 하나만 깔려도 대개 올인까지 가요.`);
        plan.push(pt.aggressor ? '아무것도 안 맞아도 큰 카드 두 장이니까, 드라이 보드에서는 작게 걸거나 올인으로 밀어붙일 수 있어요. 낮고 웻한 보드에서는 체크해요.' : '아무것도 안 맞았으면 상대의 작은 벳에 한 번은 콜할 수 있지만, 큰 벳에는 접어요.');
      } else {
        plan.push(pt.aggressor ? '올린 쪽으로서 A·K·Q가 높은 드라이 보드에서는 작게 넓게 이어서 걸어요(c-bet). 탑페어를 맞추면 세 번 걸어서 돈을 받아요.' : '콜한 쪽으로서 탑페어를 맞추면 두세 번 콜하거나 올려요. 못 맞추면 백도어가 있을 때 한 번 정도만 따라가요.');
        plan.push(pt.aggressor ? `못 맞췄을 때: 큰 카드 두 장은 맞출 카드가 6장 있으니까 드라이 보드에서는 한 번 걸고, 낮고 웻한 보드에서는 체크하거나 포기해요.${suitedNote}` : `못 맞췄을 때: 상대의 작은 벳에는 백도어가 있을 때만 콜하고, 큰 벳에는 접어요.${suitedNote}`);
      }
      break;
    case 'suited_ace':
    case 'wheel_ace':
      good = '내 무늬가 2장 깔린 보드(넛 플러시 드로우), 작은 카드(2·3·4·5)가 깔려 스트레이트 드로우가 있을 때, A가 높은 드라이 보드.';
      bad = 'A를 맞췄는데 상대가 세게 올릴 때(킥커 문제), 낮은 카드가 짝으로 깔린 보드.';
      if (four) {
        plan.push('4벳 판(남은 칩이 판의 1.5배쯤)에서는 A가 깔리거나 넛 플러시 드로우면 그대로 끝까지 가요. 킥커 걱정보다 남은 칩이 적다는 게 우선이에요.');
        plan.push('완전히 못 맞춘 보드에서 내가 올린 쪽이면 A 블로커로 작게 한 번 걸고, 상대가 버티면 포기해요.');
      } else {
        plan.push('넛 플러시 드로우나 드로우가 두 개 겹치면 반쯤 뻥(세미 블러프)으로 걸거나 올려서, 상대가 접는 이득과 맞출 기회를 함께 써요.');
        plan.push('A를 맞춘 탑페어는 킥커가 약하니까 두 번 이내로 판을 작게 유지하고, 크게 올리면 접는 것도 생각해요.');
        plan.push(pt.aggressor ? '완전히 못 맞춘 보드에서는 A 블로커로 한 번 이어서 걸고(c-bet), 상대가 버티면 포기해요.' : '완전히 못 맞춘 보드에서는 백도어가 없으면 포기해요.');
      }
      break;
    case 'offsuit_ace':
      good = 'A가 높은 드라이 보드에서 상대가 체크할 때.';
      bad = '탑페어를 맞췄는데 큰 벳이나 레이즈를 받을 때(킥커에서 짐), 못 맞춘 보드 전부.';
      plan.push('탑페어는 한 번 걸어서 돈을 받고 판을 작게 유지해요. 못 맞추면 백도어도 없으니까 거의 포기해요.');
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      good = '탑페어 + 좋은 킥커, 양쪽으로 열린 스트레이트 드로우, 브로드웨이 보드(10-J-Q-K).';
      bad = 'A가 높은 보드에서 상대가 버틸 때, 낮고 이어진 보드.';
      if (four) {
        plan.push('4벳 판에서는 탑페어나 맞출 카드가 8장 이상인 드로우면 끝까지 가고, 아무것도 없으면 포기해요.');
      } else {
        plan.push('탑페어면 두 번 걸어서 돈을 받는 게 기본이고, 세 번째는 상대의 패 묶음을 보고 정해요.');
        plan.push(`양쪽으로 열린 스트레이트 드로우(맞출 카드 8장)나 한 칸 드로우 + 큰 카드는 ${pt.aggressor ? '반쯤 뻥(세미 블러프)으로 걸어요' : '콜하고 턴에서 다시 봐요'}.${suitedNote}`);
        if (cls === 'offsuit_broadway') plan.push('플러시가 없으니까 못 맞춘 보드에서 따라가는 건 최소로 해요.');
      }
      break;
    case 'suited_king':
    case 'suited_qj':
      good = '내 무늬가 2장 깔린 보드(플러시 드로우), K·Q·J가 제일 높은 드라이 보드(탑페어).';
      bad = '탑페어를 맞췄지만 킥커가 약한 채로 큰 벳을 받을 때, A가 높은 보드.';
      plan.push('플러시 드로우는 반쯤 뻥(세미 블러프)이나 콜로 플레이하되, 가장 높은 플러시가 아니면(K·Q 높은 플러시) 큰 판에서 조심해요.');
      plan.push('킥커 약한 탑페어는 한두 번 걸어서 돈을 받고 판을 작게 유지해요.');
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector':
      good = '양쪽으로 열린 스트레이트 드로우, 플러시 드로우, 낮고 이어진 보드(투페어·스트레이트·셋 가능성). 콜한 쪽이 유리한 보드.';
      bad = 'A·K가 높은 드라이 보드(올린 쪽이 유리)에서 아무것도 없을 때.';
      plan.push(`강한 드로우(맞출 카드 8장 이상)는 ${pt.aggressor ? '걸어서' : '올려서'} 반쯤 뻥(세미 블러프)으로 상대가 접는 이득을 더해요. 약한 드로우(한 칸 스트레이트)는 값이 맞을 때만 콜해요.`);
      plan.push('백도어(플러시 + 스트레이트)가 겹치면 플랍에서 한 번은 따라가거나 걸어 볼 근거가 돼요. 아무것도 없으면 바로 포기해요.');
      plan.push('중간 페어나 제일 낮은 페어는 작은 벳에 한 번 콜하면서 상대의 뻥을 잡는 정도예요.');
      break;
    case 'junk':
      good = '투페어·트립스처럼 세게 맞은 보드.';
      bad = '대부분의 보드.';
      plan.push('세게 맞지 않으면 포기해요. 뻥(블러프)은 블로커가 있을 때만 아주 가끔 해요.');
      break;
  }
  if (pt.aggressor && pt.pot === '3bp') plan.push('3벳 판에서 내가 올린 쪽이면: 나한테 유리한 보드(A·K 높은 보드, 브로드웨이)에서는 작게 아주 넓게 이어서 걸고(c-bet), 낮고 이어진 보드에서는 체크 비중을 높여요.');
  if (!pt.aggressor && pt.pot === 'srp' && hero === 'BB') plan.push('BB로 콜했으면: 낮은 보드에서는 먼저 걸거나 체크-레이즈하는 패도 가지되, 상대의 작은 벳에는 넓게 방어해요(접는 빈도 50% 이하).');
  if (s.kind === 'cold_4bet' && !pt.aggressor) plan.push('콜한 뒤에도 오픈한 사람이 아직 남아 있어요. 그 사람이 4벳하면 셋을 노릴 가치가 사라지니까 접어요.');

  return {
    potType: POT_LABEL[pt.pot],
    role: pt.aggressor ? '플랍 전에 마지막으로 올린 쪽(어그레서)' : '플랍 전에 콜한 쪽(콜러)',
    position: ip ? '나중에 행동 (인포지션)' : '먼저 행동 (아웃오브포지션)',
    spr: SPR_TEXT[pt.pot],
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
  const foldedBetween = between ? ` 사이 ${between}명은 접었어요.` : '';
  switch (s.kind) {
    case 'rfi':
      return `${s.hero}까지 모두 접었어요. 먼저 올릴지(오픈) 접을지 정해요.`;
    case 'vs_open':
      return `${seat(v!, '가')} ${v === 'SB' ? '3bb' : '2.5bb'}로 먼저 올렸어요(오픈).${foldedBetween} ${s.hero}에서 접기·콜·3벳 중에 정해요.`;
    case 'vs_3bet':
      return `내가 ${s.hero}에서 오픈했는데 ${seat(v!, '가')} 다시 올렸어요(3벳). 나머지는 접었어요. 접기·콜·4벳 중에 정해요.`;
    case 'vs_4bet':
      return `${seat(v!, '가')} 오픈, 내가 ${s.hero}에서 3벳, ${seat(v!, '가')} 또 올렸어요(4벳). 접기·콜·올인 중에 정해요.`;
    case 'vs_5bet':
      return `내(${s.hero}) 오픈 → ${v} 3벳 → 내 4벳 → ${v}가 올인. 콜할지 접을지 정해요.`;
    case 'cold_4bet':
      return `${s.extras?.opener ?? '앞'} 오픈, ${s.extras?.threeBettor ?? '앞'} 3벳 뒤에 ${s.hero}에서 첫 차례예요. 접기·콜·4벳 중에 정해요.`;
  }
}

/* ------------------------------------------------------------------ */
/* Easy block: 결론 · 왜 · 예시 · 플랍                                     */
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

const VERDICT: Record<Verb, string> = {
  fold: '이 패는 접는 게 맞아요.',
  open: '이 패는 먼저 올리는(오픈) 게 맞아요.',
  call: '이 패는 따라 내는(콜) 게 맞아요.',
  threebet: '이 패는 다시 올리는(3벳) 게 맞아요.',
  fourbet: '이 패는 또 올리는(4벳) 게 맞아요.',
  allin: '이 패는 칩을 다 거는(올인) 게 맞아요.',
  callJam: '상대 올인을 받아도(콜) 돼요.',
  foldJam: '상대 올인에는 접는 게 맞아요.',
};

/** Short reason for the one-liner (≤ ~28 chars each; the verdict adds ≤ 22). */
function shortReason(cls: HandClass, verb: Verb, kind: ScenarioKind, info: HandInfo): string {
  switch (verb) {
    case 'fold':
      if ((kind === 'vs_4bet' || kind === 'vs_3bet') && (cls === 'wheel_ace' || cls === 'suited_ace')) return '뻥으로 올린 거라 상대가 또 올리면 접거든요.';
      if (cls === 'junk' && info.highV >= 10) return info.kind === 'suited' ? '큰 카드가 하나뿐이라 플러시 말곤 약하거든요.' : '큰 카드가 하나뿐이고 무늬도 달라서 약하거든요.';
      return {
        premium_pair: '지금은 이길 확률이 부족하거든요.',
        big_pair: '상대가 AA·KK를 들 때가 많거든요.',
        mid_pair: '상대가 더 큰 페어를 들 때가 많거든요.',
        small_pair: '셋(같은 숫자 3장)을 못 맞추면 거의 못 이기거든요.',
        ak: '상대 패가 너무 세서 AK도 부족하거든요.',
        big_ace: '같은 A를 맞춰도 옆 카드(킥커)에서 지기 쉽거든요.',
        suited_ace: '옆 카드(킥커)가 약해 큰 판을 못 이기거든요.',
        wheel_ace: 'A 한 쌍을 맞춰도 약해서 판을 못 이기거든요.',
        offsuit_ace: '플러시도 안 되고 옆 카드(킥커)도 약하거든요.',
        suited_broadway: '상대 패가 세서 옆 카드(킥커)에서 지기 쉽거든요.',
        offsuit_broadway: '페어를 맞춰도 옆 카드(킥커)에서 지기 쉽거든요.',
        suited_king: 'K 한 쌍을 맞춰도 옆 카드가 약하거든요.',
        suited_qj: '플러시 말고는 이길 길이 별로 없거든요.',
        suited_connector: '여기선 스트레이트·플러시 기대만으론 부족해요.',
        suited_gapper: '숫자가 떨어져 있어 스트레이트도 잘 안 되거든요.',
        offsuit_connector: '플러시가 안 되고 페어도 약하거든요.',
        junk: '큰 카드가 없어서 이길 확률이 낮거든요.',
      }[cls];
    case 'open':
      return {
        premium_pair: '가장 센 패라서 판을 키워야 하거든요.',
        big_pair: '대부분의 패보다 앞서 있거든요.',
        mid_pair: '페어라 든든하고 셋(같은 숫자 3장)도 노릴 수 있거든요.',
        small_pair: '플랍에서 셋(같은 숫자 3장)을 노릴 수 있거든요.',
        ak: '제일 큰 카드 두 장이라 자주 이기거든요.',
        big_ace: '약한 A를 든 상대를 옆 카드(킥커)로 이기거든요.',
        suited_ace: 'A가 있고 플러시도 노릴 수 있거든요.',
        wheel_ace: '플러시·스트레이트 둘 다 노릴 수 있거든요.',
        offsuit_ace: '미리 낸 돈(블라인드)을 먹기 좋거든요.',
        suited_broadway: '큰 카드 두 장에 플러시까지 노리거든요.',
        offsuit_broadway: '큰 카드 두 장이라 제일 높은 한 쌍(탑페어)을 자주 만들거든요.',
        suited_king: 'K가 있고 플러시도 노릴 수 있거든요.',
        suited_qj: '뒤에 사람이 적을 땐 이 정도도 올려요.',
        suited_connector: '이어진 같은 무늬라 큰 패를 만들기 좋거든요.',
        suited_gapper: '같은 무늬라 플러시를 노릴 수 있거든요.',
        offsuit_connector: '뒤에 사람이 적어 미리 낸 돈(블라인드)을 노려요.',
        junk: '뒤에 사람이 적어 미리 낸 돈(블라인드)을 노려요.',
      }[cls];
    case 'call':
      return {
        premium_pair: '일부러 안 올려서 상대의 뻥을 살려 두거든요.',
        big_pair: '올리면 AA·KK만 남아서 콜로 판을 조절해요.',
        mid_pair: '판을 키우기보다 셋(같은 숫자 3장)을 노리는 게 낫거든요.',
        small_pair: '플랍에서 셋(같은 숫자 3장)을 맞추면 크게 딸 수 있거든요.',
        ak: '올리면 더 센 패만 남아서 그냥 보는 게 나아요.',
        big_ace: '올리면 약한 패는 접고 센 패만 남거든요.',
        suited_ace: 'A에 플러시 가능성까지 있어 싸게 볼 만해요.',
        wheel_ace: '플러시·스트레이트가 되면 크게 딸 수 있거든요.',
        offsuit_ace: '상대 패가 넓어서 A 하나로도 볼 만하거든요.',
        suited_broadway: '큰 카드에 플러시까지 있어 볼 만하거든요.',
        offsuit_broadway: '제일 높은 한 쌍(탑페어)을 자주 만들어 싸게 볼 만해요.',
        suited_king: '플러시 가능성으로 싸게 플랍을 보거든요.',
        suited_qj: '싸게 플러시를 노려 볼 만하거든요.',
        suited_connector: '스트레이트·플러시로 크게 딸 수 있거든요.',
        suited_gapper: '스트레이트·플러시로 크게 딸 수 있거든요.',
        offsuit_connector: '싼값에 스트레이트를 노리거든요.',
        junk: '값이 아주 쌀 때만 보는 패예요.',
      }[cls];
    case 'threebet':
    case 'fourbet':
      return {
        premium_pair: '가장 센 패라 판을 최대한 키워야 하거든요.',
        big_pair: '상대 패 대부분보다 앞서 있거든요.',
        mid_pair: '상대가 접을 때가 많고 페어라 든든하거든요.',
        small_pair: '상대가 접으면 좋고, 셋(같은 숫자 3장)도 노려요.',
        ak: '이기는 패도 많고 상대가 접기도 하거든요.',
        big_ace: '약한 A를 든 상대한테 돈을 더 받거든요.',
        suited_ace: 'A를 들어 상대가 AA일 확률이 줄거든요(블로커).',
        wheel_ace: 'A를 들어 상대가 AA일 확률이 줄거든요(블로커).',
        offsuit_ace: 'A를 들어 상대 AA를 줄이는(블로커) 뻥(블러프)이에요.',
        suited_broadway: '센 패로 돈을 받고, 플랍 뒤에도 놀기 좋거든요.',
        offsuit_broadway: '따라 내면 옆 카드(킥커)에서 지기 쉬워 올려서 접게 해요.',
        suited_king: 'K를 들어 상대 KK·AK를 줄이는(블로커) 뻥(블러프)이에요.',
        suited_qj: '가끔 섞는 뻥(블러프)이에요.',
        suited_connector: '상대가 접으면 좋고, 안 접어도 큰 패를 노려요.',
        suited_gapper: '상대를 접게 하려는 뻥(블러프)이에요.',
        offsuit_connector: '상대를 접게 하려는 뻥(블러프)이에요.',
        junk: '상대를 접게 하려는 뻥(블러프)이에요.',
      }[cls];
    case 'allin':
      if (cls === 'premium_pair') return '상대의 4벳 패 전부보다 앞서 있거든요.';
      if (cls === 'big_pair' || cls === 'ak') return '상대의 뻥은 접게 하고, 센 패와는 반반이거든요.';
      if (cls === 'wheel_ace' || cls === 'suited_ace') return 'A를 들어 상대 AA를 줄이는(블로커) 뻥(블러프)이에요.';
      return '상대의 뻥을 접게 만들려는 거예요.';
    case 'callJam':
      if (cls === 'premium_pair') return '상대가 KK·AK를 들어도 대부분 이기거든요.';
      if (cls === 'ak') return 'A·K를 들어 상대가 AA·KK일 확률이 줄거든요(블로커).';
      return '상대 올인에 QQ·AK도 섞여 있어 충분히 이겨요.';
    case 'foldJam':
      if (cls === 'wheel_ace' || cls === 'suited_ace') return '4벳은 뻥이었고 올인엔 이길 확률이 낮거든요.';
      if (cls === 'big_pair' || cls === 'ak') return '상대가 KK·AA를 들 때가 많아 부족하거든요.';
      return '상대 올인 패가 너무 세서 이기기 어렵거든요.';
  }
}

/** One plain fact about the hand class (≤ 45 chars). */
function handFact(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  switch (cls) {
    case 'premium_pair':
      return n === 'AA' ? 'AA는 시작할 때 가장 센 패예요.' : 'KK는 두 번째로 센 패예요. AA한테만 져요.';
    case 'big_pair':
      return `${hp(info, '는')} 큰 페어지만 A나 K가 뜨면 불안해요.`;
    case 'mid_pair':
      return `${hp(info, '는')} 중간 페어라 셋(같은 숫자 3장)을 노려요.`;
    case 'small_pair':
      return `${hp(info, '는')} 작은 페어라 셋이 아니면 거의 못 이겨요.`;
    case 'ak':
      return 'AK는 페어가 아닌 패 중 가장 세요.';
    case 'big_ace':
      return `${n}는 A에 큰 옆 카드(킥커)가 붙은 패예요.`;
    case 'suited_ace':
      return `${n}는 같은 무늬(수티드) A라 플러시를 노려요.`;
    case 'wheel_ace':
      return `${n}는 A에 작은 카드가 붙은 같은 무늬 패예요.`;
    case 'offsuit_ace':
      return `${n}는 무늬가 달라(오프수트) 플러시가 안 돼요.`;
    case 'suited_broadway':
      return `${n}는 큰 카드 두 장(브로드웨이)에 무늬도 같아요.`;
    case 'offsuit_broadway':
      return `${n}는 큰 카드 두 장이지만 무늬가 달라요.`;
    case 'suited_king':
      return `${n}는 K가 있지만 옆 카드(킥커)가 작아요.`;
    case 'suited_qj':
      return `${n}는 큰 카드가 하나뿐이고 옆 카드가 작아요.`;
    case 'suited_connector':
      return `${n}는 숫자가 이어진 같은 무늬(수티드 커넥터)예요.`;
    case 'suited_gapper':
      return `${n}는 숫자 사이가 비지만 무늬가 같아요.`;
    case 'offsuit_connector':
      return `${n}는 숫자는 이어지지만 무늬가 달라요.`;
    case 'junk':
      if (info.kind === 'suited') return `${n}는 무늬만 같고 숫자가 작아 플러시 말곤 없어요.`;
      if (info.highV >= 10) return `${rp(info.high, '는')} 크지만 ${rp(info.low, '가')} 너무 작고 무늬도 달라요.`;
      return `${show(info.high)}, ${show(info.low)} 둘 다 작아서 서로 도움이 안 돼요.`;
  }
}

/** The situation reason (≤ 45 chars): who is behind / what the opponent's raise usually means. */
function situationReason(step: Step): string {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const fold = answer === 'fold';
  switch (s.kind) {
    case 'rfi':
      // A fold must never read like a reason to raise: "you can open wide here" + "fold" contradict each other.
      if (hero === 'BTN') return fold ? '넓게 올리는 자리지만, 이 패는 그래도 못 들어가요.' : '뒤에 블라인드 둘뿐이라 넓게 올려도 돼요.';
      if (hero === 'SB') return 'BB 하나뿐이지만 플랍 뒤엔 내가 먼저 움직여요.';
      if (hero === 'CO') return fold ? '뒤에 3명뿐이라 꽤 넓게 올리지만, 이 패는 빠져요.' : '뒤에 3명뿐이라 꽤 넓게 올릴 수 있어요.';
      return `뒤에 ${seatsBehind(hero)}명이 남아 있어서 센 패 위주로만 올려요.`;
    case 'vs_open': {
      const lateFold = `${seat(v!, '는')} 약한 패로도 올리지만, 이 패는 그보다 더 약해요.`;
      if (hero === 'BB') {
        if (isEarly(v)) return fold ? `${seat(v!, '는')} 앞자리라 센 패로만 올려요. 싸도 이기기 어려워요.` : `${seat(v!, '는')} 앞자리라 센 패로만 올려요. 난 싸게 봐요.`;
        return fold ? lateFold : `${seat(v!, '는')} 뒷자리라 약한 패로도 자주 올려요.`;
      }
      if (hero === 'SB') return 'SB는 플랍 뒤에 먼저 움직여야 해서 불리해요.';
      if (isEarly(v)) return `${seat(v!, '는')} 앞자리라 센 패로만 올려요.`;
      return fold ? lateFold : `${seat(v!, '는')} 뒷자리라 약한 패로도 자주 올려요.`;
    }
    case 'vs_3bet':
      if (fold) return isBlind(v) ? `${v}의 3벳엔 뻥(블러프)도 섞여 있지만, 이 패론 못 받아요.` : `${v}의 3벳은 센 패 위주라 이 패로는 못 받아요.`;
      return isBlind(v) ? `${v}의 3벳엔 센 패와 뻥(블러프)이 섞여 있어요.` : `${v}의 3벳은 센 패 위주예요. 뻥은 적어요.`;
    case 'vs_4bet':
      return '4벳은 보통 QQ 이상·AK에 가끔 A5s 같은 뻥이에요.';
    case 'vs_5bet':
      return '올인은 보통 AA·KK·AK예요. 이미 낸 칩은 잊어요.';
    case 'cold_4bet':
      return '앞에서 올리고 또 올렸으니 둘 다 센 패예요.';
  }
}

function positionReason(step: Step): string | null {
  const { scenario: s, answer } = step;
  if (answer === 'fold' || s.kind === 'vs_5bet' || answer === 'allin') return null;
  if (s.kind === 'rfi' || (s.kind === 'vs_open' && s.hero === 'SB')) return null; // the situation line already says it
  const ip = heroIsIP(s);
  return ip ? '플랍 뒤엔 내가 나중에 움직여서(포지션) 유리해요.' : '플랍 뒤엔 내가 먼저 움직여야 해서 조심해요.';
}

/** 2–3 bullets: a fact about the hand, the situation, then the mix (if any) or the position. */
function easyWhy(step: Step, info: HandInfo, cls: HandClass): string[] {
  const out: string[] = [handFact(info, cls), situationReason(step)];
  const alt = step.mixList.length >= 2 ? step.mixList[1] : null;
  if (alt) {
    const altLabel = alt.action === 'fold' ? '접기' : ACTION_SHORT_KO[alt.action];
    out.push(alt.weight >= 0.5 ? `${altLabel}도 반반이에요. 빈도가 같으면 더 공격적인 쪽이 정답이에요.` : `가끔은 ${altLabel}도 해요(${outOfTen(alt.weight)}). 정답은 더 자주 하는 쪽.`);
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
  opp: string; // "상대" or "3벳한 사람"
}

/** "상대 K♠K♦" etc. — an opponent hand with suits, safe against my cards. */
function vs(ctx: ExCtx, name: string): string {
  return `${ctx.opp} ${oppHand(name, ctx.taken)}`;
}

function pairExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, me, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  if (cls === 'premium_pair') {
    if (info.high === 'A') {
      out.push(`내 ${me}, ${vs(ctx, 'KK')} → 10번 중 8번은 내가 이겨요.`);
      if (kind === 'vs_5bet' || verb === 'allin' || verb === 'fourbet') out.push(`${vs(ctx, 'AKo')}가 와도 10번 중 9번 이겨요. 걱정 없어요.`);
      if (verb === 'allin') out.push('상대가 뭘 들었든 앞서요. 뻥은 접고 센 패는 콜해 주니 이득이에요.');
    } else {
      out.push(`내 ${me}, ${vs(ctx, 'QQ')} → 10번 중 8번은 내가 이겨요.`);
      out.push(`${vs(ctx, 'AA')}일 때만 크게 져요. 10번 중 2번만 이겨요.`);
      // 5-bet jam: the 4-bet range is QQ+·AK plus A5s-type bluffs — KK folds out the bluff and is ~70% against AK.
      if (verb === 'allin') out.push(`${vs(ctx, 'A5s')} 같은 뻥(블러프)은 접어 주고, AK는 10번 중 7번 이겨요.`);
    }
    if (verb === 'call') out.push('일부러 콜만 하면 상대가 뻥으로 더 걸어 줘요.');
    return out.slice(0, 3);
  }
  if (cls === 'big_pair') {
    if (verb === 'fold' || verb === 'foldJam') {
      out.push(`내 ${me}, ${vs(ctx, 'KK')} → 10번 중 2번만 이겨요.`);
      out.push(`${vs(ctx, 'AKo')}면 반반인데, 여기선 KK·AA일 때가 더 많아요.`);
    } else if (verb === 'allin') {
      // 5-bet jam over a 4-bet: the opponents are the 4-bet range (AK · A5s bluffs · KK/AA), never TT-type generic hands.
      out.push(`내 ${me}, ${vs(ctx, 'AKo')} → 반반 싸움이에요(10번 중 5번쯤).`);
      out.push(`${vs(ctx, 'A5s')} 같은 뻥(블러프)은 접어 줘요.`);
      out.push(`${vs(ctx, 'KK')}·${oppHand('AA', taken)}면 10번 중 2번만 이겨요.`);
    } else {
      out.push(`내 ${me}, ${vs(ctx, 'AKo')} → 반반 싸움이에요(10번 중 5번쯤).`);
      out.push(`${vs(ctx, 'TT')}처럼 작은 페어면 10번 중 8번 이겨요.`);
      if (verb === 'call' || verb === 'open') out.push(`플랍에 A나 K가 뜨면(예: ${board(['A', ['9', '8'], ['4', '5']], ['♦', '♠', '♦'], taken)}) 조심해요.`);
    }
    return out.slice(0, 3);
  }
  // mid / small pair
  out.push(`내 ${me} → 플랍에 ${rp(info.high, '가')} 뜨면 셋(같은 숫자 3장), 확률은 8분의 1쯤이에요.`);
  if (verb === 'fold' || verb === 'foldJam') {
    const over = cls === 'mid_pair' ? 'QQ' : 'JJ';
    out.push(`${vs(ctx, over)} → 셋을 못 맞추면 10번 중 8번 져요.`);
  } else if (verb === 'call') {
    out.push('셋이 되면 상대의 큰 페어한테서 칩을 다 받을 수 있어요.');
    const ub = cls === 'mid_pair' ? underBoard(info, taken) : null;
    if (ub) out.push(`${ub}처럼 낮은 보드면 내 페어가 제일 높아요(오버페어).`);
  } else {
    out.push(`${vs(ctx, 'AKo')} 같은 큰 카드 두 장과는 반반이에요.`);
  }
  return out.slice(0, 3);
}

function aceExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, me, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  if (cls === 'ak') {
    if (kind === 'vs_5bet') {
      out.push(verb === 'callJam' ? `내 ${me} → 상대가 AA·KK일 확률이 절반으로 줄어요(블로커).` : `내 ${me}, ${vs(ctx, 'KK')} → 10번 중 3번만 이겨요.`);
      out.push(`${vs(ctx, 'QQ')}면 반반이고, AK끼리면 대개 비겨요.`);
      return out;
    }
    if (verb === 'allin') {
      // 5-bet jam over a 4-bet: talk about the 4-bet range (A5s bluffs, KK, QQ), not the AQ that a 4-bettor never has.
      // I hold a K, so KK cannot be drawn with ♠/♦ only — it stays a chart name after "상대가".
      out.push(`내 ${me} → ${vs(ctx, 'A5s')} 같은 뻥(블러프)은 올인에 접어요.`);
      out.push(`상대가 KK면 10번 중 3번, ${oppHand('QQ', taken)}면 반반이에요.`);
      return out;
    }
    out.push(`내 ${me}, ${vs(ctx, 'AQo')} → 플랍에 A가 뜨면 둘 다 A 한 쌍이지만 킥커 K로 내가 이겨요.`);
    if (verb === 'fold') out.push(`${vs(ctx, 'KK')}면 10번 중 3번, AA면 10번 중 1번만 이겨요.`);
    else out.push(`${vs(ctx, 'QQ')}면 반반 싸움이에요(10번 중 5번쯤).`);
    return out;
  }
  const dom = dominatorOf(info);
  const weaker = dominatedBy(info);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(`내 ${me}, ${vs(ctx, dom)} → 둘 다 A를 맞추면 킥커 ${show(dom[1])}에 져요.`);
    // Ax vs KK ≈ 30% (never "QQ" here: a hero holding a Q would see a bare "QQ" and AQ vs QQ is a dominated ~32%).
    if (kind === 'vs_5bet' || kind === 'vs_4bet' || kind === 'cold_4bet') out.push(`${vs(ctx, 'KK')}면 10번 중 3번쯤만 이겨요.`);
    else if (cls === 'offsuit_ace') out.push('무늬가 달라서 플러시로 뒤집을 기회도 없어요.');
    else if (cls === 'big_ace') out.push(`${vs(ctx, 'KK')}처럼 큰 페어를 만나면 10번 중 3번쯤만 이겨요.`);
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet' || verb === 'allin') {
    if (cls === 'wheel_ace' || cls === 'suited_ace') {
      out.push(`내 ${me} → 상대가 AA일 확률이 반으로 줄어요(블로커).`);
      out.push(`상대가 ${oppHand('KQs', taken)}처럼 접어 주면 그냥 이겨요. 콜해도 플러시를 노려요.`);
      if (cls === 'wheel_ace' && verb !== 'allin') out.push(`플랍 ${wheelBoard(info, taken)}면 A-2-3-4-5 스트레이트예요.`);
    } else if (cls === 'big_ace' && weaker) {
      out.push(`내 ${me}, ${vs(ctx, weaker)} → 둘 다 ${rp(info.low, '를')} 맞추면 킥커 A로 내가 이겨요.`);
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 킥커에서 지니까 물러나요.`);
    } else {
      out.push(`내 ${me} → 상대가 AA·AK일 확률이 줄어요(블로커). 접어 주면 좋아요.`);
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 바로 접어요.`);
    }
    return out.slice(0, 3);
  }
  // call / open
  if (cls === 'wheel_ace' || cls === 'suited_ace') {
    out.push(`내 ${me} → 플랍에 ♠가 2장 더 뜨면 가장 높은 플러시(넛)를 노려요.`);
    if (cls === 'wheel_ace') out.push(`플랍 ${wheelBoard(info, taken)}면 A-2-3-4-5 스트레이트예요.`);
    if (dom) out.push(`${vs(ctx, dom)} → 둘 다 A를 맞추면 킥커 ${show(dom[1])}에 져요. 그래서 큰 판은 피해요.`);
  } else if (cls === 'big_ace') {
    if (weaker) out.push(`내 ${me}, ${vs(ctx, weaker)} → 둘 다 ${rp(info.low, '를')} 맞추면 킥커 A로 내가 이겨요.`);
    if (dom) out.push(`${vs(ctx, dom)} → 둘 다 A를 맞추면 킥커 ${show(dom[1])}에 져요. 그래서 판을 키우진 않아요.`);
    // A pair BELOW my kicker is the coin flip (AQ vs JJ ≈ 46%); a pair ON my kicker (AQ vs QQ ≈ 32%) is not.
    if (kind === 'vs_5bet' || kind === 'vs_4bet') out.push(`${vs(ctx, underPair(info))}면 반반에 가까워요(10번 중 4~5번).`);
  } else {
    // offsuit ace
    out.push(`내 ${me}, ${vs(ctx, 'ATo')} → 둘 다 A를 맞추면 킥커 10에 져요.`);
    out.push(`상대가 ${oppHand('K9o', taken)}처럼 약한 패면 A 하나로 이겨요.`);
  }
  return out.slice(0, 3);
}

function broadwayExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, me, taken, step } = ctx;
  const kind = step.scenario.kind;
  const out: string[] = [];
  const dom = dominatorOf(info);
  const weaker = dominatedBy(info);
  const lowP = rp(info.low, '를');
  const high = show(info.high);
  const topBoard = board([info.high, DRY_BOARD[1], DRY_BOARD[2]], ['♦', '♠', '♦'], taken);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(`내 ${me}, ${vs(ctx, dom)} → 둘 다 ${lowP} 맞추면 킥커 A에 져요.`);
    // AK only shares a card with a K-high broadway; against QJ/JT it simply makes the bigger pair.
    out.push(info.high === 'K' ? `${vs(ctx, 'AKo')} → 둘 다 K를 맞춰도 킥커에서 져요.` : `${vs(ctx, 'AKo')} → 서로 한 쌍씩 맞춰도 내 ${high} 한 쌍이 더 작아요.`);
    // An overpair to both my cards (KQ vs AA, QJ vs KK ≈ 18%) — never a pair on my high card (QJ vs QQ ≈ 12%, and a hero Q makes "QQ" render bare).
    if (kind === 'vs_5bet' || kind === 'vs_4bet' || kind === 'cold_4bet') out.push(`${vs(ctx, overPair(info))}처럼 큰 페어면 10번 중 2번쯤만 이겨요.`);
    else if (cls === 'offsuit_broadway') out.push('무늬가 달라서 플러시로 뒤집을 기회도 없어요.');
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    if (cls === 'offsuit_broadway') {
      if (dom) out.push(`내 ${me}, ${vs(ctx, dom)} → 콜해서 둘 다 ${lowP} 맞추면 킥커 A에 져요.`);
      out.push(`상대가 ${oppHand('A9o', taken)}처럼 접어 주면 그냥 이겨요. 그래서 올려요.`);
    } else {
      if (weaker) out.push(`내 ${me}, ${vs(ctx, weaker)} → 둘 다 ${lowP} 맞추면 킥커 ${high}로 내가 이겨요.`);
      out.push(`플랍 ${topBoard}면 제일 높은 ${high} 한 쌍(탑페어)이에요.`);
      if (dom) out.push(`${vs(ctx, dom)}가 다시 올리면 킥커에서 지니까 물러나요.`);
    }
    return out.slice(0, 3);
  }
  // call / open
  out.push(`플랍 ${topBoard}면 제일 높은 ${high} 한 쌍(탑페어)이에요.`);
  if (info.kind === 'suited') out.push(`내 ${me} → ♠가 2장 더 뜨면 플러시 드로우(한 장만 더 맞으면 완성)예요.`);
  else if (weaker) out.push(`내 ${me}, ${vs(ctx, weaker)} → 둘 다 ${lowP} 맞추면 킥커 ${high}로 내가 이겨요.`);
  if (dom) out.push(`${vs(ctx, dom)} → 둘 다 ${lowP} 맞추면 킥커 A에 져요. 큰 판은 피해요.`);
  return out.slice(0, 3);
}

function suitedKingExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, me, taken } = ctx;
  const out: string[] = [];
  const high = show(info.high);
  const dom = dominatorOf(info);
  if (verb === 'fold' || verb === 'foldJam') {
    if (dom) out.push(`내 ${me}, ${vs(ctx, dom)} → 둘 다 ${rp(info.high, '를')} 맞추면 킥커 A에 져요.`);
    out.push(`플러시는 ♠가 3장 더 떠야 해요. 10번 중 1번도 안 돼요.`);
    return out;
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    out.push(`내 ${me} → 상대가 ${high}${high}·A${high}일 확률이 조금 줄어요(블로커).`);
    out.push(`상대가 ${oppHand('A9o', taken)}처럼 접어 주면 그냥 이겨요. 콜해도 플러시를 노려요.`);
    return out;
  }
  out.push(`내 ${me} → 플랍에 ♠가 2장 더 뜨면 ${high} 높은 플러시 드로우예요.`);
  if (cls === 'suited_king') out.push(`플랍 ${board(['K', ['8', '9', '7'], ['3', '4', '2']], ['♦', '♠', '♦'], taken)}면 K 한 쌍이지만 킥커가 약해서 작게만 가요.`);
  else out.push(`${high} 한 쌍을 맞춰도 킥커가 약해서 큰 판은 피해요.`);
  if (dom) out.push(`${vs(ctx, dom)} → 둘 다 ${rp(info.high, '를')} 맞추면 킥커 A에 져요.`);
  return out.slice(0, 3);
}

function connectorExamples(ctx: ExCtx): string[] {
  const { info, cls, verb, me, taken } = ctx;
  const out: string[] = [];
  const st = straightBoard(info);
  const suited = info.kind === 'suited';
  const stBoard = st ? board(st, suited ? ['♦', '♠', '♠'] : ['♠', '♦', '♠'], taken) : null;
  if (verb === 'fold' || verb === 'foldJam') {
    if (stBoard) out.push(`내 ${me} → ${stBoard} 같은 플랍이 와야 스트레이트인데, 자주 안 와요.`);
    out.push(`${vs(ctx, 'AKo')}처럼 큰 카드를 만나면 페어를 맞춰도 작아요.`);
    if (!suited) out.push('무늬가 달라서 플러시도 안 돼요.');
    return out.slice(0, 3);
  }
  if (verb === 'threebet' || verb === 'fourbet') {
    out.push(`내 ${me} → 상대가 ${oppHand('A9o', taken)}처럼 접어 주면 그냥 이겨요(뻥).`);
    if (stBoard) out.push(`콜을 받아도 ${stBoard} 같은 플랍이면 스트레이트로 크게 딸 수 있어요.`);
    return out;
  }
  if (stBoard) out.push(`내 ${me} → 플랍 ${stBoard}면 스트레이트예요.`);
  if (suited) out.push('♠가 2장 더 뜨면 플러시 드로우(한 장만 더 맞으면 완성)예요.');
  else out.push('무늬가 달라서 플러시는 안 되고, 스트레이트만 노려요.');
  if (cls !== 'offsuit_connector') out.push(`${vs(ctx, 'AA')} 같은 센 패한테 크게 맞으면 칩을 다 받을 수 있어요.`);
  return out.slice(0, 3);
}

/**
 * Why a junk hand loses even when it pairs its high card:
 * K-high → AK out-kicks me on a K; Q-high → KQ out-kicks me on a Q; lower → KQ simply has the bigger pair.
 */
function junkLossLine(ctx: ExCtx): string {
  const { info, me } = ctx;
  const high = show(info.high);
  if (info.high === 'K') return `내 ${me}, ${vs(ctx, 'AKo')} → 둘 다 K를 맞추면 킥커 A에 져요.`;
  if (info.high === 'Q') return `내 ${me}, ${vs(ctx, 'KQo')} → 둘 다 Q를 맞추면 킥커 K에 져요.`;
  return `플랍에 K와 ${rp(info.high, '가')} 뜨면 ${vs(ctx, 'KQo')}는 K 한 쌍, 나는 ${high} 한 쌍이라 져요.`;
}

function junkExamples(ctx: ExCtx): string[] {
  const { info, verb, me, taken } = ctx;
  const out: string[] = [];
  if (verb === 'fold' || verb === 'foldJam') {
    out.push(`내 ${me} → ${missBoard(info, taken)} 같은 플랍에서 아무것도 안 맞아요.`);
    out.push(junkLossLine(ctx));
    return out;
  }
  out.push(verb === 'call' ? `내 ${me} → 싸게 플랍만 보고, 안 맞으면 바로 접어요.` : `내 ${me} → 상대가 접어 주면 그냥 블라인드를 먹어요.`);
  out.push(`${junkLossLine(ctx)} 크게 가진 말아요.`);
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
    opp: step.scenario.kind === 'cold_4bet' ? '3벳한 사람' : '상대',
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
  if (!out.length) out = [`내 ${ctx.me} → 이 자리에서는 이 정도 패가 딱 경계예요.`];
  return out.slice(0, 3);
}

/* ---- flop checklist ---- */

function easyFlop(step: Step, info: HandInfo, cls: HandClass): string[] | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const ip = heroIsIP(step.scenario);
  const cards = heroCards(info);
  const taken = new Set(cards.map(key));
  const out: string[] = [];
  const suited = info.kind === 'suited';
  const dry = board(dryRanks(info, cls), drySuits(info), taken);

  // 1. what to look for with this hand
  switch (cls) {
    case 'premium_pair':
    case 'big_pair': {
      const ub = underBoard(info, taken);
      out.push(ub ? `${ub}처럼 내 페어보다 낮은 카드만 있으면 자신 있게 걸어요.` : '내 페어보다 낮은 카드만 있으면 자신 있게 걸어요.');
      if (cls === 'big_pair') out.push('A나 K가 뜨면 판을 작게 유지하고, 크게 올리면 접을 수도 있어요.');
      break;
    }
    case 'mid_pair':
    case 'small_pair':
      out.push(`플랍에 ${rp(info.high, '가')} 떴으면 셋(같은 숫자 3장)이에요. 판을 키워요.`);
      out.push(cls === 'small_pair' ? '셋이 아니고 상대가 걸면 접는 게 기본이에요.' : '내 페어보다 큰 카드가 두 장 이상이면 조심해요.');
      break;
    case 'ak':
    case 'big_ace':
      out.push(`A나 ${rp(info.low, '가')} 뜨면 제일 높은 한 쌍(탑페어)이에요. 걸어도 돼요.`);
      out.push(suited ? '못 맞췄으면 ♠가 2장 있는지 봐요(플러시 드로우).' : '못 맞췄으면 큰 벳은 따라가지 말아요.');
      break;
    case 'suited_ace':
    case 'wheel_ace':
      out.push('♠가 2장 깔리면 넛 플러시 드로우예요. 걸거나 올려도 돼요.');
      out.push('A가 떠도 킥커가 약하니까 판을 작게 유지해요.');
      break;
    case 'offsuit_ace':
      out.push('A가 뜨면 한 번만 걸고 판을 작게 유지해요.');
      out.push('못 맞췄으면 거의 포기해요. 플러시도 없어요.');
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      out.push(`${show(info.high)}나 ${rp(info.low, '가')} 제일 높은 카드로 뜨면 탑페어예요. 두 번 정도 걸어요.`);
      out.push(suited ? '♠ 2장이나 이어진 카드가 있으면 드로우(한 장만 더 맞으면 완성)를 노려요.' : 'A가 뜬 보드에서 상대가 세게 나오면 조심해요.');
      break;
    case 'suited_king':
    case 'suited_qj':
      out.push('♠가 2장 깔리면 플러시 드로우예요. 더 높은 플러시는 조심해요.');
      out.push(`${show(info.high)} 한 쌍을 맞춰도 킥커가 약하니 판을 작게 가요.`);
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector': {
      const st = straightBoard(info);
      out.push(st ? `${board(st, ['♦', '♠', '♦'], taken)}처럼 낮고 이어진 보드가 내 보드예요.` : '낮고 이어진 보드가 내 보드예요.');
      out.push('드로우(한 장만 더 맞으면 완성)면 걸거나 콜하고, 아무것도 없으면 바로 접어요.');
      break;
    }
    default:
      out.push('투페어 이상으로 세게 맞지 않으면 바로 포기해요.');
  }

  // 2. board texture example
  if (pt.aggressor) out.push(`${dry}처럼 드라이한 보드(드로우가 거의 없음)면 작게 걸어도 돼요.`);
  else out.push(`${dry}처럼 드라이한 보드면 상대의 작은 벳은 한 번 받아 볼 만해요.`);

  // 3. position / pot size
  if (pt.pot === '4bp') out.push('남은 칩이 적어서 페어 하나만 맞아도 올인까지 가요.');
  else if (pt.pot === '3bp') out.push(ip ? '판이 커요. 내가 나중에 움직이니 상대가 체크하면 걸어요.' : '판이 커요. 내가 먼저 움직이니 체크로 시작해도 돼요.');
  else out.push(ip ? '내가 나중에 움직여요(포지션). 상대가 체크하면 걸지 말지 골라요.' : '내가 먼저 움직여요. 페어 하나로 칩을 다 걸진 말아요.');

  return out.slice(0, 4);
}

function easyBlock(step: Step, info: HandInfo, cls: HandClass): EasyExplanation {
  const verb = verbOf(step);
  const reason = shortReason(cls, verb, step.scenario.kind, info);
  const oneLiner = `${VERDICT[verb]} ${reason}`;
  const easy: EasyExplanation = {
    oneLiner,
    reason,
    why: easyWhy(step, info, cls),
    example: easyExample(step, info, cls, verb),
  };
  const flop = easyFlop(step, info, cls);
  if (flop) easy.flop = flop;
  return easy;
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
  return {
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
}

export { fullMix };
