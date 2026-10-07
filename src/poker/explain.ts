import { getChartCells, hasChart } from './data';
import { parseHandName, type HandInfo } from './hands';
import { josa } from './ko';
import { capsuleLabel, lineOf, lineSentence, nearMiss, stripView, type LineDef, type LineSentence, type MixItem, type StripView } from './line';
import { fullMix, restAction } from './range';
import { acrossRow, mixBlock, oneExample, seatLever, seatNumbers, siblingLine } from './sheet';
import { heroInPosition } from './scenarios';
import type { Step } from './trainer';
import type { AtlasCell, Line } from './atlas';
import { POS_INDEX, type Action, type Card, type ChartCells, type Pos, type Scenario, type ScenarioKind } from './types';
import { DISCLAIMER } from '../screens/charts/disclaimer'; // 순수 문자열 표 — 차트 탭·자리별 보기와 같은 원문을 씁니다.

/*
 * 해설 조립기. docs/EXPLAIN_SPEC.md §6.2 · docs/PLAIN_KO_STYLE.md(v3).
 *
 * 해설은 이제 "줄 하나, 문장 하나"입니다. 이 패의 답(캡슐), 이 패가 속한 차트 줄(스트립), 그 줄을 읽어 주는
 * 해요체 문장 하나 — 그리고 시트에서 형제 줄 · 자리 숫자 · 레버 · 자리 칩 줄을 덧붙입니다.
 * 문장은 line.ts · sheet.ts 가 차트에서 계산해 만들고, 여기서는 모으기만 합니다.
 *
 * 손패 이론(왜? 불릿, 손패 에세이, 플랍 이후 계획)은 지웠습니다. 자리가 바뀌어도 문장이 같아서
 * 차트에서 가장 어려운 부분 — 자리에 따라 경계가 어디로 움직이는지 — 를 하나도 가르치지 못했습니다.
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
/* Output type                                                         */
/* ------------------------------------------------------------------ */

export interface Explanation {
  /** `${hero} ${상황 짧은 이름} · ${hand}` — 답은 캡슐이 말하므로 제목에 넣지 않습니다. */
  title: string;
  /** split = 섞인 칸이면 fullMix, 단색이면 null */
  capsule: { label: string; action: Action; split: MixItem[] | null };
  /**
   * 이 패의 줄. sentence 는 리빌·퀴즈·시트·자리별 보기가 글자까지 같이 쓰는 문장입니다.
   * 차트 탭에서 도달할 수 없는 칸을 누르면 줄 전체가 도달 불가일 수 있어 null 이 됩니다(리빌에서는 생기지 않음).
   */
  line: StripView & { def: LineDef; sentence: LineSentence | null };
  /** UI 가 grade 를 보고 보일지 정합니다(오답·부분 정답일 때만). */
  nearMiss: '한 칸 밖' | '마지막 칸' | null;
  sibling: LineSentence | null;
  mix: { chips: Array<{ action: Action; pct: number }>; partial: string | null } | null;
  seat: { numbers: string; ladder: Array<{ pos: Pos; pct: number; me: boolean }> | null; lever: string | null };
  across: { cells: AtlasCell[]; line: Line };
  /** 자세히: 사람이 쓴 차트 메모, 메모가 없을 때만 예시 한 줄. 무늬 뒤집기는 여기에만 적용됩니다. */
  more: { memo: string | null; example: string | null };
  /** vs_limp → DISCLAIMER.vs_limp */
  disclaimer: string | null;
}

/* ------------------------------------------------------------------ */
/* Seat helpers                                                        */
/* ------------------------------------------------------------------ */

/** 정수 퍼센트. 스타일 가이드 §2.6: 빈도는 "10번 중 2번"이 아니라 "18%". */
export const pctInt = (x: number) => `${Math.round(x * 100)}%`;

const isBlind = (p?: Pos) => p === 'SB' || p === 'BB';
export const seatsBehind = (hero: Pos) => 5 - POS_INDEX[hero];

/** 상대가 이 상황까지 오며 쓴 레인지(오픈 → 3벳 → 4벳 → 올인). 숫자 줄의 W 가 여기서 나옵니다. */
export function villainChart(s: Scenario): { cells: ChartCells; action: Action } | null {
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

export function heroIsIP(s: Scenario): boolean {
  if (s.kind === 'rfi') return s.hero !== 'SB'; // assume the BB (or a later caller) defends
  // 림퍼는 언제나 내 앞자리(UTG~BTN)에 앉아 있습니다. 그러니 블라인드가 아닌 나는 항상 포지션이 있고,
  // SB·BB 는 항상 먼저 액션합니다. extras.limper 를 보지 않는 이유: 림퍼 자리는 화면용이라 비어 있을 수 있는데,
  // 비어 있다고 BB 가 "포지션이 있어요"로 읽히면 모든 BB 림프 카드가 거짓말을 합니다.
  if (s.kind === 'vs_limp') return !isBlind(s.hero);
  const v = s.villain ?? s.extras?.threeBettor;
  return v ? heroInPosition(s.hero, v) : s.hero !== 'SB';
}

/* ------------------------------------------------------------------ */
/* Card helpers for the one example line (♠/♦ only, no collisions)     */
/* ------------------------------------------------------------------ */

type SuitGlyph = '♠' | '♦';
interface ExCard {
  r: string; // rank letter (T for ten)
  s: SuitGlyph;
}

/** 카드 그림의 랭크 표기: T 는 10. 줄 이름·패 이름은 T 그대로 씁니다(§2.4). */
export const show = (r: string) => (r === 'T' ? '10' : r);
const cardStr = (c: ExCard) => `${show(c.r)}${c.s}`;
const key = (c: ExCard) => `${c.r}${c.s}`;

/** Deterministic cards for the hero's hand: suited → ♠♠, otherwise ♠ + ♦. */
export function heroCards(info: HandInfo): [ExCard, ExCard] {
  if (info.kind === 'suited') return [{ r: info.high, s: '♠' }, { r: info.low, s: '♠' }];
  return [{ r: info.high, s: '♠' }, { r: info.low, s: '♦' }];
}

const OTHER: Record<SuitGlyph, SuitGlyph> = { '♠': '♦', '♦': '♠' };

/** One card of `rank` that is not already used; prefers `pref`. Falls back to the bare rank when both suits are taken. */
export function freeCard(rank: string, pref: SuitGlyph, taken: Set<string>, forbid?: SuitGlyph): string {
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
 * The cards it picks are added to `taken` so a card appears only once in the example line. When no free suit is
 * left the hand falls back to its bare chart name ("A5s", "KK").
 */
export function oppHand(name: string, taken: Set<string>): string {
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
  return name;
}

/** 예시 한 줄의 재료: 내 카드 글자와, 이미 쓴 카드 집합. */
export interface ExCtx {
  me: string;
  taken: Set<string>;
}

export function exampleCtx(info: HandInfo): ExCtx {
  const cards = heroCards(info);
  return { me: cards.map(cardStr).join(''), taken: new Set(cards.map(key)) };
}

/** "상대 K♠K♦" — an opponent hand with suits, safe against my cards. */
export function vs(ctx: ExCtx, name: string): string {
  return `상대 ${oppHand(name, ctx.taken)}`;
}

/** 가이드 §3의 고정 형식: "내 A♠Q♦ vs 상대 A♦K♠ → …". */
export function duel(ctx: ExCtx, name: string, tail: string): string {
  return `내 ${ctx.me} vs ${vs(ctx, name)} → ${tail}`;
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
/* Tier-B glosses (docs/PLAIN_KO_STYLE.md §1.B)                        */
/* ------------------------------------------------------------------ */

/**
 * 어려운 개념의 풀이. 해설 본문에는 붙이지 않고(§2.3-11), 용어집 팝오버와 Term.tsx 의 "이미 풀이한 등장" 판정만
 * 이 문장을 씁니다. 긴 용어를 먼저 둬야 "임플라이드 오즈"가 "팟 오즈"보다 먼저 걸립니다.
 */
export const GLOSS: Array<[string, string]> = [
  ['임플라이드 오즈', '맞았을 때 더 딸 수 있는 몫'],
  ['세미 블러프', '드로우를 들고 하는 블러프'],
  ['도미네이트', '같은 카드를 맞춰도 킥커에서 지는 상태'],
  ['셋마이닝', '셋을 노리고 콜하는 것'],
  ['팟 오즈', '콜 금액 대비 팟 크기'],
  ['블로커', '내가 그 카드를 들어 상대 조합이 줄어드는 효과'],
  ['스퀴즈', '오픈과 콜 뒤에 크게 올리는 것'],
  ['백도어', '두 장을 더 맞아야 완성되는 드로우'],
  ['c-bet', '프리플랍 레이저가 플랍에서 잇는 벳'],
  ['SPR', '팟 대비 남은 스택 비율'],
];

/** 용어 풀이 한 문장, 해요체: "블로커는 내가 그 카드를 들어 상대 조합이 줄어드는 효과예요." */
export function glossSentence(term: string): string | null {
  const g = GLOSS.find(([t]) => t === term);
  return g ? `${josa(g[0], '은/는')} ${josa(g[1], '이에요/예요')}.` : null;
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

/**
 * 예시 카드의 무늬 방향.
 *
 * 예시의 카드는 전부 "내 패는 ♠ 쪽"이라는 한 가지 배치로 만들어집니다(수티드 → ♠♠, 그 밖 → ♠ + ♦).
 * 그런데 화면에 깔리는 카드는 매번 새로 뽑히므로 10♦9♦를 들고 있는데 예시만 10♠9♠라고 적히는 일이 생깁니다.
 * 무늬가 ♠·♦ 둘뿐이라 ♠↔♦를 통째로 맞바꾸면 카드가 겹치는지, 무늬가 같은지 다른지가 전부 그대로 보존됩니다.
 */
export type SuitOrientation = 'spade' | 'diamond';

/** 받은 카드에서 무늬 방향을 읽습니다. `dealCardsFor`는 항상 높은 카드를 앞에 두므로 첫 장만 보면 됩니다. */
export function suitOrientation(cards: readonly [Card, Card]): SuitOrientation {
  return cards[0].suit === 'd' ? 'diamond' : 'spade';
}

const MIRRORED: Record<string, string> = { '♠': '♦', '♦': '♠' };
const mirrorText = (t: string): string => t.replace(/[♠♦]/g, (c) => MIRRORED[c] ?? c);

/** 문자열·배열·객체 안의 모든 ♠와 ♦를 맞바꿉니다. */
export function mirrorSuits<T>(value: T): T {
  if (typeof value === 'string') return mirrorText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(mirrorSuits) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mirrorSuits(v);
    return out as T;
  }
  return value;
}

export const KIND_LABEL_KO: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '올인 대응',
  cold_4bet: '콜드 4벳',
  vs_limp: '림프 대응',
};

/** 조립만 합니다. 무늬 뒤집기는 more.* 에만 — 줄 문장·자리 문장에는 카드 그림이 없습니다. */
export function explainStep(step: Step, orientation: SuitOrientation = 'spade'): Explanation {
  const { scenario: s, hand } = step;
  const def = lineOf(hand);
  const rest = restAction(step.chart);
  const numbers = seatNumbers(s);
  const memo = step.chart.notes?.[hand] ?? null;
  const more = { memo, example: memo ? null : oneExample(step) };
  return {
    title: `${s.hero} ${KIND_LABEL_KO[s.kind]} · ${hand}`,
    capsule: { label: capsuleLabel(step.mixList, rest, s.kind), action: step.answer, split: step.mixList.length >= 2 ? step.mixList : null },
    line: { ...stripView(s, hand), def, sentence: lineSentence(s, def) },
    nearMiss: nearMiss(s, hand),
    sibling: siblingLine(s, hand),
    mix: mixBlock(step),
    seat: { numbers: numbers.text, ladder: numbers.ladder, lever: seatLever(s)?.text ?? null },
    across: acrossRow(s, hand),
    more: orientation === 'diamond' ? mirrorSuits(more) : more,
    disclaimer: s.kind === 'vs_limp' ? DISCLAIMER.vs_limp : null,
  };
}

export { fullMix };
