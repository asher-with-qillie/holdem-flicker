import { RANKS, type Card, type HandName, type Rank, type Suit } from './types';

export const RANK_VALUE: Record<Rank, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

/** All 169 canonical hands in grid order (row = first rank, col = second rank). */
export const ALL_HANDS: HandName[] = (() => {
  const out: HandName[] = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      out.push(gridHand(r, c));
    }
  }
  return out;
})();

/** Hand name at grid cell (row, col): diagonal = pairs, above = suited, below = offsuit. */
export function gridHand(row: number, col: number): HandName {
  const a = RANKS[row];
  const b = RANKS[col];
  if (row === col) return `${a}${a}`;
  if (row < col) return `${a}${b}s`;
  return `${b}${a}o`;
}

export type HandKind = 'pair' | 'suited' | 'offsuit';

export interface HandInfo {
  name: HandName;
  kind: HandKind;
  high: Rank;
  low: Rank;
  highV: number;
  lowV: number;
  gap: number; // 0 for connectors/pairs, 1 for one-gappers, ...
}

export function parseHandName(name: HandName): HandInfo {
  const high = name[0] as Rank;
  const low = name[1] as Rank;
  const kind: HandKind = name.length === 2 ? 'pair' : name[2] === 's' ? 'suited' : 'offsuit';
  const highV = RANK_VALUE[high];
  const lowV = RANK_VALUE[low];
  return { name, kind, high, low, highV, lowV, gap: kind === 'pair' ? 0 : highV - lowV - 1 };
}

/** Canonical hand name from two concrete cards. */
export function handNameFromCards(a: Card, b: Card): HandName {
  const [hi, lo] = RANK_VALUE[a.rank] >= RANK_VALUE[b.rank] ? [a, b] : [b, a];
  if (hi.rank === lo.rank) return `${hi.rank}${lo.rank}`;
  return `${hi.rank}${lo.rank}${hi.suit === lo.suit ? 's' : 'o'}`;
}

/** Number of card combinations for a hand (pair 6, suited 4, offsuit 12). */
export function combos(name: HandName): number {
  const k = parseHandName(name).kind;
  return k === 'pair' ? 6 : k === 'suited' ? 4 : 12;
}

let seed = 0;
let seeded = false;
/** Small deterministic-when-seeded PRNG for tests; falls back to Math.random. */
export function random(): number {
  if (!seeded) return Math.random();
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export function seedRandom(s: number) {
  seed = s >>> 0;
  seeded = true;
}
export function pick<T>(arr: readonly T[], rng: () => number = random): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 손패 이름에서 뽑는 작은 해시 (FNV-1a). 무늬를 고르는 데만 씁니다. */
function nameHash(name: HandName): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deal two concrete cards for a canonical hand.
 * Suits: only ♠ and ♦ (user preference) — 수딧인지 오프수딧인지 한눈에 갈리게 하려는 것이므로,
 * 무늬는 **손패 이름에서 결정론적으로** 나옵니다. 같은 패는 언제 어디서 봐도 같은 그림입니다.
 *
 * 예전에는 무늬를 매번 무작위로 뽑았습니다. 그래서 같은 페어가 7♠7♦ 로도, 7♦7♠ 로도 나왔는데,
 * 페어는 두 장의 숫자가 같아서 눈에 보이는 차이가 '왼쪽이 스페이드냐 다이아냐' 뿐입니다 —
 * 같은 문제가 '스페이드 페어'와 '다이아 페어' 두 개로 읽혔습니다. 게다가 요약·홈 목록은
 * 렌더할 때마다 다시 뽑아서 세션에서 본 카드와 무늬가 어긋나기도 했습니다.
 *
 *   · 페어·오프수트 → 언제나 ♠ 먼저, ♦ 나중 (두 장의 무늬가 다르다 = 수딧이 아니다)
 *   · 수딧          → 두 장 모두 ♠ 이거나 모두 ♦ (어느 쪽인지는 패마다 고정)
 */
export function dealCardsFor(name: HandName): [Card, Card] {
  const info = parseHandName(name);
  if (info.kind === 'suited') {
    // 화면이 온통 스페이드가 되지 않게 패마다 갈라 두되, 그 선택은 패에 고정합니다.
    const s: Suit = nameHash(name) % 2 === 0 ? 's' : 'd';
    return [
      { rank: info.high, suit: s },
      { rank: info.low, suit: s },
    ];
  }
  return [
    { rank: info.high, suit: 's' },
    { rank: info.low, suit: 'd' },
  ];
}

/** Deal a uniformly random hand (by combinatorial weight: pairs 6, suited 4, offsuit 12). */
export function dealRandomHand(rng: () => number = random): HandName {
  // 1326 combos total
  let r = rng() * 1326;
  for (const h of ALL_HANDS) {
    r -= combos(h);
    if (r < 0) return h;
  }
  return 'AA';
}

/** Deal a random hand weighted by `weights` (hand → weight in [0,1]) × combos. Returns null if empty. */
export function dealWeightedHand(weights: Record<HandName, number>, rng: () => number = random): HandName | null {
  let total = 0;
  for (const h of ALL_HANDS) total += (weights[h] ?? 0) * combos(h);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const h of ALL_HANDS) {
    r -= (weights[h] ?? 0) * combos(h);
    if (r < 0) return h;
  }
  return null;
}

export const SUIT_GLYPH: Record<Suit, string> = { s: '♠', d: '♦' };
export const SUIT_NAME_KO: Record<Suit, string> = { s: '스페이드', d: '다이아' };

export function cardLabel(c: Card): string {
  return `${c.rank}${SUIT_GLYPH[c.suit]}`;
}
