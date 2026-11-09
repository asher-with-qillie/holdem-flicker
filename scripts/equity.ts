/**
 * Preflop all-in equity: one hand against a range, Monte Carlo over boards. For checking explanation numbers
 * ("내 Q♠Q♦ vs 상대 A♠K♦ → 승률 57%", "상대 올인 레인지에 AKo는 약 40%").
 *
 *   npx vite-node scripts/equity.ts <hero> <villain> [trials]
 *     hero    — a hand class (AKo, QQ, A5s) averaged over its combos, or exact cards (AsKd)
 *     villain — a range string (KK+,AKs,AQs:0.5,A5s-A2s), exact cards (AhKh), or a chart action:
 *               chart:<chart id>:<action>   e.g. chart:vs_4bet:HJ:UTG:allin  (weights from the chart)
 *   prints: equity (win + tie/2) and the villain combos used after card removal.
 */
import { getChartCells } from '../src/poker/data/index';
import { ALL_CHART_DEFS } from '../src/poker/data/index';
import { fullMix, parseRange } from '../src/poker/range';
import type { HandName } from '../src/poker/types';

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
type C = number; // rank*4 + suit, rank 0..12

const card = (s: string): C => RANKS.indexOf(s[0].toUpperCase()) * 4 + SUITS.indexOf(s[1].toLowerCase());

function combosOf(hand: string): Array<[C, C]> {
  if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/i.test(hand)) return [[card(hand.slice(0, 2)), card(hand.slice(2))]];
  const a = RANKS.indexOf(hand[0]);
  const b = RANKS.indexOf(hand[1]);
  const out: Array<[C, C]> = [];
  for (let s1 = 0; s1 < 4; s1++)
    for (let s2 = 0; s2 < 4; s2++) {
      if (a === b && s2 <= s1) continue;
      if (hand[2] === 's' && s1 !== s2) continue;
      if (hand[2] === 'o' && s1 === s2) continue;
      out.push([a * 4 + s1, b * 4 + s2]);
    }
  return out;
}

/** 7-card hand value: category * 13^5 + tiebreak. */
function evaluate(cs: C[]): number {
  const cnt = new Array(13).fill(0);
  const suitCnt = [0, 0, 0, 0];
  const bySuit: number[][] = [[], [], [], []];
  for (const c of cs) {
    const r = c >> 2;
    const s = c & 3;
    cnt[r]++;
    suitCnt[s]++;
    bySuit[s].push(r);
  }
  const B = 13;
  const pack = (cat: number, ks: number[]) => {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * B + (ks[i] ?? 0);
    return v;
  };
  const straightHigh = (mask: number): number => {
    for (let hi = 12; hi >= 4; hi--) {
      let ok = true;
      for (let k = 0; k < 5; k++) if (!(mask & (1 << (hi - k)))) { ok = false; break; }
      if (ok) return hi;
    }
    if ((mask & 0b1000000001111) === 0b1000000001111) return 3; // wheel
    return -1;
  };
  for (let s = 0; s < 4; s++) {
    if (suitCnt[s] >= 5) {
      let m = 0;
      for (const r of bySuit[s]) m |= 1 << r;
      const sh = straightHigh(m);
      if (sh >= 0) return pack(8, [sh]);
      const ks = bySuit[s].sort((x, y) => y - x).slice(0, 5);
      // flush (but check quads / full house first below would be higher; flush < full house)
      const fl = pack(5, ks);
      // quads or full house beat a flush
      const q = cnt.findIndex((x: number) => x === 4);
      if (q >= 0) break;
      const trips = [];
      const pairs = [];
      for (let r = 12; r >= 0; r--) { if (cnt[r] >= 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r); }
      if (trips.length && (trips.length > 1 || pairs.length)) break;
      return fl;
    }
  }
  let mask = 0;
  for (let r = 0; r < 13; r++) if (cnt[r]) mask |= 1 << r;
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (cnt[r] === 4) quads.push(r);
    else if (cnt[r] === 3) trips.push(r);
    else if (cnt[r] === 2) pairs.push(r);
    else if (cnt[r] === 1) singles.push(r);
  }
  if (quads.length) {
    const k = [...trips, ...pairs, ...singles].sort((x, y) => y - x)[0];
    return pack(7, [quads[0], k]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? -1) : pairs[0];
    return pack(6, [trips[0], p]);
  }
  for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) return pack(5, bySuit[s].sort((x, y) => y - x).slice(0, 5));
  const sh = straightHigh(mask);
  if (sh >= 0) return pack(4, [sh]);
  if (trips.length) return pack(3, [trips[0], ...singles.slice(0, 2)]);
  if (pairs.length >= 2) {
    const rest = [...pairs.slice(2), ...singles].sort((x, y) => y - x);
    return pack(2, [pairs[0], pairs[1], rest[0]]);
  }
  if (pairs.length) return pack(1, [pairs[0], ...singles.slice(0, 3)]);
  return pack(0, singles.slice(0, 5));
}

function villainCombos(spec: string): Array<{ c: [C, C]; w: number }> {
  if (spec.startsWith('chart:')) {
    const parts = spec.slice(6).split(':');
    const action = parts.pop()!;
    const id = parts.join(':');
    const def = ALL_CHART_DEFS.find((d) => d.id === id);
    if (!def) throw new Error(`no chart ${id}`);
    const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as never;
    const cells = getChartCells(sc);
    const out: Array<{ c: [C, C]; w: number }> = [];
    for (const [h, mix] of Object.entries(cells)) {
      const w = fullMix(mix).find((m) => m.action === action)?.weight ?? 0;
      if (w > 0) for (const c of combosOf(h)) out.push({ c, w });
    }
    return out;
  }
  if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/i.test(spec)) return [{ c: combosOf(spec)[0], w: 1 }];
  const r = parseRange(spec) as Record<HandName, number>;
  const out: Array<{ c: [C, C]; w: number }> = [];
  for (const [h, w] of Object.entries(r)) for (const c of combosOf(h)) out.push({ c, w });
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const [heroSpec, villSpec, trialsArg] = process.argv.slice(2);
if (!heroSpec || !villSpec) {
  console.error('usage: equity.ts <hero> <villain> [trials]');
  process.exit(1);
}
const trials = Number(trialsArg ?? 200000);
const heroCombos = combosOf(heroSpec);
const vAll = villainCombos(villSpec);
const rand = rng(12345);
let eq = 0;
let n = 0;
let usedW = 0;
for (const hc of heroCombos) {
  const pool = vAll.filter(({ c }) => !c.includes(hc[0]) && !c.includes(hc[1]));
  const tot = pool.reduce((a, x) => a + x.w, 0);
  usedW += tot;
  const per = Math.ceil(trials / heroCombos.length);
  for (let t = 0; t < per; t++) {
    let x = rand() * tot;
    let v = pool[0].c;
    for (const p of pool) { x -= p.w; if (x <= 0) { v = p.c; break; } }
    const dead = new Set([hc[0], hc[1], v[0], v[1]]);
    const board: C[] = [];
    while (board.length < 5) {
      const c = Math.floor(rand() * 52);
      if (!dead.has(c)) { dead.add(c); board.push(c); }
    }
    const a = evaluate([hc[0], hc[1], ...board]);
    const b = evaluate([v[0], v[1], ...board]);
    eq += a > b ? 1 : a === b ? 0.5 : 0;
    n++;
  }
}
console.log(`${heroSpec} vs ${villSpec}: equity ${((eq / n) * 100).toFixed(1)}%  (villain combos after removal ≈ ${(usedW / heroCombos.length).toFixed(1)}, trials ${n})`);
