import { ALL_HANDS, combos, parseHandName } from './hands';
import { ACTIONS, RANKS, type Action, type ActionMix, type ChartCells, type ChartDef, type HandName, type Rank } from './types';

/**
 * Range notation (comma/space separated tokens, case-insensitive ranks, T for ten):
 *   "AA"            single hand
 *   "77+"           pairs 77 through AA
 *   "77-22"         pairs 22 through 77 (either order)
 *   "K9s+"          K9s, KTs, KJs, KQs (same high card, kicker up to one below high)
 *   "A5s-A2s"       A2s..A5s (same high card, either order)
 *   "KQo:0.5"       weight 0.5 (applies to the whole token; e.g. "A5s-A2s:0.3")
 * Hands may appear under several actions; the weights across actions must sum to <= 1.
 * The remaining weight is fold.
 */

const RANK_SET = new Set<string>(RANKS);

function rankIdx(r: Rank): number {
  return RANKS.indexOf(r);
}

function normalizeHand(raw: string): HandName {
  const s = raw.trim();
  if (s.length < 2 || s.length > 3) throw new Error(`Bad hand token: "${raw}"`);
  const a = s[0].toUpperCase();
  const b = s[1].toUpperCase();
  if (!RANK_SET.has(a) || !RANK_SET.has(b)) throw new Error(`Bad ranks in hand: "${raw}"`);
  const suf = s.length === 3 ? s[2].toLowerCase() : '';
  if (a === b) {
    if (suf) throw new Error(`Pairs take no suffix: "${raw}"`);
    return `${a}${a}`;
  }
  if (suf !== 's' && suf !== 'o') throw new Error(`Non-pair hands need s/o suffix: "${raw}"`);
  const [hi, lo] = rankIdx(a as Rank) < rankIdx(b as Rank) ? [a, b] : [b, a];
  return `${hi}${lo}${suf}`;
}

/** Expand a single token (without weight) into a list of hand names. */
export function expandToken(token: string): HandName[] {
  const t = token.trim();
  if (!t) return [];
  if (t.endsWith('+')) {
    const h = normalizeHand(t.slice(0, -1));
    const info = parseHandName(h);
    const out: HandName[] = [];
    if (info.kind === 'pair') {
      for (let i = rankIdx(info.high); i >= 0; i--) out.push(`${RANKS[i]}${RANKS[i]}`);
    } else {
      const suf = info.kind === 'suited' ? 's' : 'o';
      const hiIdx = rankIdx(info.high);
      for (let i = rankIdx(info.low); i > hiIdx; i--) out.push(`${info.high}${RANKS[i]}${suf}`);
    }
    return out;
  }
  const dash = t.indexOf('-');
  if (dash > 0) {
    const a = normalizeHand(t.slice(0, dash));
    const b = normalizeHand(t.slice(dash + 1));
    const ia = parseHandName(a);
    const ib = parseHandName(b);
    if (ia.kind !== ib.kind) throw new Error(`Range endpoints differ in type: "${token}"`);
    const out: HandName[] = [];
    if (ia.kind === 'pair') {
      const lo = Math.min(rankIdx(ia.high), rankIdx(ib.high));
      const hi = Math.max(rankIdx(ia.high), rankIdx(ib.high));
      for (let i = lo; i <= hi; i++) out.push(`${RANKS[i]}${RANKS[i]}`);
    } else {
      if (ia.high !== ib.high) throw new Error(`Range endpoints must share the high card: "${token}"`);
      const suf = ia.kind === 'suited' ? 's' : 'o';
      const lo = Math.min(rankIdx(ia.low), rankIdx(ib.low));
      const hi = Math.max(rankIdx(ia.low), rankIdx(ib.low));
      for (let i = lo; i <= hi; i++) out.push(`${ia.high}${RANKS[i]}${suf}`);
    }
    return out;
  }
  return [normalizeHand(t)];
}

/** Parse a range string into hand → weight (0..1]. Later duplicates overwrite earlier ones. */
export function parseRange(range: string): Record<HandName, number> {
  const out: Record<HandName, number> = {};
  const tokens = range
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const tok of tokens) {
    let weight = 1;
    let body = tok;
    const colon = tok.indexOf(':');
    if (colon >= 0) {
      body = tok.slice(0, colon);
      const w = tok.slice(colon + 1);
      if (!/^(0?\.\d+|1(\.0+)?)$/.test(w)) throw new Error(`Bad weight in token "${tok}"`);
      weight = Number(w);
      if (weight <= 0 || weight > 1) throw new Error(`Bad weight in token "${tok}"`);
    }
    if (!body) throw new Error(`Bad token "${tok}"`);
    for (const h of expandToken(body)) out[h] = weight;
  }
  return out;
}

const EPS = 1e-6;

/** Build the 169-cell chart from a ChartDef. Throws on invalid notation or weights > 1. */
export function buildChart(def: ChartDef): ChartCells {
  const cells: ChartCells = {};
  for (const action of ACTIONS) {
    if (action === 'fold') continue;
    const str = def.actions[action];
    if (!str) continue;
    const parsed = parseRange(str);
    for (const [hand, w] of Object.entries(parsed)) {
      const mix = (cells[hand] ??= {});
      mix[action] = (mix[action] ?? 0) + w;
    }
  }
  for (const [hand, mix] of Object.entries(cells)) {
    const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    if (total > 1 + EPS) throw new Error(`Chart ${def.id}: weights for ${hand} sum to ${total.toFixed(2)} > 1`);
  }
  return cells;
}

/** Fold weight of a mix (1 - sum of other weights). */
export function foldWeight(mix: ActionMix | undefined): number {
  if (!mix) return 1;
  const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
  return Math.max(0, 1 - total);
}

/** Full mix including fold, as a sorted list (desc by weight). */
export function fullMix(mix: ActionMix | undefined): Array<{ action: Action; weight: number }> {
  const out: Array<{ action: Action; weight: number }> = [];
  const f = foldWeight(mix);
  if (f > EPS) out.push({ action: 'fold', weight: f });
  if (mix) {
    for (const a of ACTIONS) {
      const w = mix[a];
      if (a !== 'fold' && w && w > EPS) out.push({ action: a, weight: w });
    }
  }
  return out.sort((a, b) => (Math.abs(a.weight - b.weight) < EPS ? ACTIONS.indexOf(b.action) - ACTIONS.indexOf(a.action) : b.weight - a.weight));
}

/** The action to memorize: highest weight; ties go to the more aggressive action. */
export function primaryAction(mix: ActionMix | undefined): Action {
  return fullMix(mix)[0]?.action ?? 'fold';
}

/** Share of all 1326 combos taking `action` (or any non-fold action when omitted), 0..1. */
export function rangeShare(cells: ChartCells, action?: Action): number {
  let total = 0;
  for (const h of ALL_HANDS) {
    const mix = cells[h];
    if (!mix) continue;
    const w = action ? (mix[action] ?? 0) : 1 - foldWeight(mix);
    total += w * combos(h);
  }
  return total / 1326;
}

/** Hand → non-fold weight, used for sampling hands that reach a later street of the tree. */
export function continueWeights(cells: ChartCells, actions?: Action[]): Record<HandName, number> {
  const out: Record<HandName, number> = {};
  for (const h of ALL_HANDS) {
    const mix = cells[h];
    if (!mix) continue;
    let w = 0;
    for (const a of ACTIONS) {
      if (a === 'fold') continue;
      if (actions && !actions.includes(a)) continue;
      w += mix[a] ?? 0;
    }
    if (w > EPS) out[h] = w;
  }
  return out;
}

/** Debug helper: cells → compact per-action range string. */
export function describeChart(cells: ChartCells): Record<Action, string> {
  const by: Record<Action, string[]> = { fold: [], call: [], raise: [], threebet: [], fourbet: [], allin: [] };
  for (const h of ALL_HANDS) {
    for (const { action, weight } of fullMix(cells[h])) {
      if (action === 'fold') continue;
      by[action].push(weight < 1 - EPS ? `${h}:${weight.toFixed(2)}` : h);
    }
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.join(',')])) as Record<Action, string>;
}
