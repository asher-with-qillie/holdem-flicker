import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory localStorage installed before the module loads (vitest hoists `vi.hoisted` above imports).
const { memStorage } = vi.hoisted(() => {
  const make = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  };
  const memStorage = make();
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, configurable: true, writable: true });
  return { memStorage };
});

import { getChartCells, hasChart } from '../../poker/data';
import { ALL_HANDS, gridHand, random, seedRandom } from '../../poker/hands';
import { allScenarios, scenarioKey } from '../../poker/scenarios';
import { stepFor, type Step } from '../../poker/trainer';
import { POSITIONS, SCENARIO_KINDS, type Scenario, type ScenarioKind } from '../../poker/types';
import {
  buildQueue,
  cardKey,
  cardKeyOf,
  counts,
  flushSrs,
  fuzz,
  getCard,
  isDue,
  learnableHands,
  parseCardKey,
  previewQueue,
  rate,
  recordExposure,
  resetSrs,
  stepForKey,
  universeSize,
  weakKeys,
  weakSpots,
  type QueueItem,
  type QueueRequest,
} from '../srs';

const DAY = 86_400_000;
const TEN_MIN = 600_000;
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const SRS_KEY = 'holdem-flicker.srs.v1';
const STATS_KEY = 'holdem-flicker.stats.v1';

const UTG_RFI: Scenario = { kind: 'rfi', hero: 'UTG' };
const BB_VS_BTN: Scenario = { kind: 'vs_open', hero: 'BB', villain: 'BTN' };
const KINDS: ScenarioKind[] = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'];

const baseReq = (over: Partial<QueueRequest> = {}): QueueRequest => ({
  size: 20,
  deck: 'all',
  positions: [...POSITIONS],
  kinds: KINDS,
  mode: 'train',
  interestingBias: 0.6,
  activeDays: 10,
  now: NOW,
  rng: random,
  ...over,
});

/** Apply ratings one hour apart starting at `start`; returns the last card. */
function drive(step: Step, ratings: Array<'know' | 'unsure'>, start = NOW) {
  let card = recordExposure(step, start - 1);
  ratings.forEach((r, i) => {
    card = rate(step, r, 'swipe', { now: start + i * 3_600_000 });
  });
  return card;
}

const isNonFold = (s: Scenario, hand: string) => {
  const mix = getChartCells(s)[hand];
  return !!mix && Object.values(mix).some((w) => (w ?? 0) > 0);
};

function seedRelearning(n: number, at = NOW - 3_600_000) {
  const hands = learnableHands(UTG_RFI);
  for (let i = 0; i < n; i++) rate(stepFor(UTG_RFI, hands[i]), 'unsure', 'swipe', { now: at });
}

function seedReviews(n: number, at = NOW - 9 * DAY) {
  const hands = learnableHands(BB_VS_BTN);
  for (let i = 0; i < n; i++) {
    const s = stepFor(BB_VS_BTN, hands[i]);
    rate(s, 'know', 'swipe', { now: at - DAY });
    rate(s, 'know', 'swipe', { now: at }); // review, 3 d interval → due long ago
  }
}

beforeEach(() => {
  resetSrs();
  memStorage.clear();
  seedRandom(11);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('card keys', () => {
  it('builds `${scenarioKey}|${hand}` and parses it back (cold_4bet gets extras)', () => {
    expect(cardKeyOf(BB_VS_BTN, 'KTo')).toBe('vs_open:BB:BTN|KTo');
    expect(cardKeyOf({ kind: 'cold_4bet', hero: 'CO' }, 'AQs')).toBe('cold_4bet:CO|AQs');
    expect(cardKey(stepFor(BB_VS_BTN, 'KTo'))).toBe('vs_open:BB:BTN|KTo');

    const p = parseCardKey('vs_open:BB:BTN|KTo');
    expect(p.hand).toBe('KTo');
    expect(p.scenario).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'BTN' });
    expect(scenarioKey(p.scenario)).toBe('vs_open:BB:BTN');

    const cold = parseCardKey('cold_4bet:BTN|AQs');
    expect(cold.scenario.extras).toEqual({ opener: 'UTG', threeBettor: 'CO' });
    expect(parseCardKey('cold_4bet:CO|AQs').scenario.extras).toEqual({ opener: 'UTG', threeBettor: 'HJ' });

    for (const bad of ['', 'KTo', 'vs_open:BB:BTN|', 'vs_open:BB:BTN|ZZ', 'nope:BB:BTN|KTo', 'vs_open:XX|KTo', 'vs_open:BB:BTN:CO|KTo']) {
      expect(() => parseCardKey(bad), bad).toThrow();
    }
  });

  it('stepForKey returns a step for a valid key and null otherwise', () => {
    const step = stepForKey('vs_open:BB:BTN|KTo');
    expect(step?.hand).toBe('KTo');
    expect(step?.scenario.villain).toBe('BTN');
    expect(step?.answer).toBe(stepFor(BB_VS_BTN, 'KTo').answer);
    expect(stepForKey('garbage')).toBeNull();
    expect(stepForKey('rfi:BB|AA')).toBeNull(); // BB never opens: no chart
  });
});

describe('records and exposures', () => {
  it('recordExposure creates a `new` record and counts every showing', () => {
    const step = stepFor(BB_VS_BTN, 'KTo');
    expect(getCard(cardKey(step))).toBeUndefined();
    const c1 = recordExposure(step, NOW);
    expect(c1).toMatchObject({ key: 'vs_open:BB:BTN|KTo', kind: 'vs_open', hero: 'BB', villain: 'BTN', hand: 'KTo', answer: step.answer, state: 'new', ease: 2.3, intervalDays: 0, reps: 0, lapses: 0, exposures: 1, quizWrong: 0, lastSeen: NOW });
    expect(c1.lastRating).toBeUndefined();
    const c2 = recordExposure(step, NOW + 5);
    expect(c2.exposures).toBe(2);
    expect(c2.lastSeen).toBe(NOW + 5);
    expect(c2.state).toBe('new');
    expect(getCard(cardKey(step))?.exposures).toBe(2);
  });

  it('rate also counts an exposure and records lastRating', () => {
    const step = stepFor(BB_VS_BTN, 'KTo');
    const c = rate(step, 'know', 'button', { now: NOW });
    expect(c.exposures).toBe(1);
    expect(c.lastRating).toBe('know');
    expect(c.lastSeen).toBe(NOW);
  });

  it('isDue compares due with now', () => {
    const c = rate(stepFor(BB_VS_BTN, 'KTo'), 'unsure', 'swipe', { now: NOW });
    expect(isDue(c, NOW)).toBe(false);
    expect(isDue(c, NOW + TEN_MIN)).toBe(true);
  });
});

describe('scheduling table', () => {
  const step = () => stepFor(BB_VS_BTN, 'KTo');
  const key = 'vs_open:BB:BTN|KTo';
  const H = 3_600_000;

  it('new + know → learning, 1 d, due now + 1 d (no fuzz), reps 1', () => {
    const c = drive(step(), ['know']);
    expect(c).toMatchObject({ state: 'learning', intervalDays: 1, due: NOW + DAY, reps: 1, lapses: 0, ease: 2.3 });
  });

  it('new + unsure → relearning, 0 d, due now + 10 min, lapses 1', () => {
    const c = drive(step(), ['unsure']);
    expect(c).toMatchObject({ state: 'relearning', intervalDays: 0, due: NOW + TEN_MIN, reps: 0, lapses: 1, ease: 2.3 });
  });

  it('learning + know → review, 3 d, due now + 3 d × fuzz', () => {
    const c = drive(step(), ['know', 'know']);
    expect(c).toMatchObject({ state: 'review', intervalDays: 3, reps: 2, ease: 2.3 });
    expect(c.due).toBe(Math.round(NOW + H + 3 * DAY * fuzz(key)));
  });

  it('learning + unsure → relearning, 0 d, due now + 10 min, lapses + 1, ease untouched', () => {
    const c = drive(step(), ['know', 'unsure']);
    expect(c).toMatchObject({ state: 'relearning', intervalDays: 0, due: NOW + H + TEN_MIN, reps: 1, lapses: 1, ease: 2.3 });
  });

  it('review + know → interval min(60, max(i + 1, round(i × ease))), ease + 0.05, due now + interval × fuzz', () => {
    const c = drive(step(), ['know', 'know', 'know']);
    expect(c).toMatchObject({ state: 'review', intervalDays: 7, reps: 3 }); // round(3 × 2.3) = 7
    expect(c.ease).toBeCloseTo(2.35, 6);
    expect(c.due).toBe(Math.round(NOW + 2 * H + 7 * DAY * fuzz(key)));
    const c2 = rate(step(), 'know', 'swipe', { now: NOW + 3 * H });
    expect(c2.intervalDays).toBe(16); // round(7 × 2.35) = 16
    expect(c2.ease).toBeCloseTo(2.4, 6);
  });

  it('review + know uses i + 1 when the ease product does not grow the interval', () => {
    // relearning + know halves 3 → 2, then review + know: max(3, round(2 × 2.1)) = 4
    const c = drive(step(), ['know', 'know', 'unsure', 'know', 'know']);
    expect(c.state).toBe('review');
    expect(c.intervalDays).toBe(4);
    const c2 = rate(step(), 'know', 'swipe', { now: NOW + 5 * H });
    expect(c2.intervalDays).toBe(Math.max(5, Math.round(4 * 2.15)));
  });

  it('review + unsure → relearning, lapses + 1, ease − 0.2, intervalDays kept, due now + 10 min', () => {
    const c = drive(step(), ['know', 'know', 'unsure']);
    expect(c).toMatchObject({ state: 'relearning', intervalDays: 3, reps: 2, lapses: 1, due: NOW + 2 * H + TEN_MIN });
    expect(c.ease).toBeCloseTo(2.1, 6);
  });

  it('relearning + know → review with the interval halved (min 1 d), reps + 1', () => {
    const c = drive(step(), ['know', 'know', 'unsure', 'know']);
    expect(c).toMatchObject({ state: 'review', intervalDays: 2, reps: 3, lapses: 1, due: NOW + 3 * H + 2 * DAY }); // round(1.5) = 2, < 3 d → no fuzz
    const short = drive(stepFor(BB_VS_BTN, 'A5s'), ['know', 'unsure', 'know']); // interval 0 → max(1, 0) = 1
    expect(short).toMatchObject({ state: 'review', intervalDays: 1, due: NOW + 2 * H + DAY });
  });

  it('relearning + unsure → stays relearning, lapses + 1, ease − 0.2, due now + 10 min', () => {
    const c = drive(step(), ['know', 'know', 'unsure', 'unsure']);
    expect(c).toMatchObject({ state: 'relearning', intervalDays: 3, lapses: 2, due: NOW + 3 * H + TEN_MIN });
    expect(c.ease).toBeCloseTo(1.9, 6);
  });

  it('caps the interval at 60 d (due ≤ 66 d with fuzz) and the ease at 2.8', () => {
    let c = drive(step(), ['know', 'know']);
    for (let i = 0; i < 12; i++) c = rate(step(), 'know', 'swipe', { now: NOW + (10 + i) * H });
    expect(c.intervalDays).toBe(60);
    expect(c.ease).toBe(2.8);
    expect(c.due - (NOW + 21 * H)).toBeLessThanOrEqual(66 * DAY);
    expect(c.due - (NOW + 21 * H)).toBeGreaterThanOrEqual(54 * DAY);
  });

  it('floors the ease at 1.3', () => {
    let c = drive(step(), ['know', 'know']);
    for (let i = 0; i < 8; i++) c = rate(step(), 'unsure', 'swipe', { now: NOW + (10 + i) * H });
    expect(c.ease).toBe(1.3);
    expect(c.lapses).toBe(8);
  });
});

describe('fuzz', () => {
  it('is deterministic per key, within ±10 %, and not constant', () => {
    expect(fuzz('vs_open:BB:BTN|KTo')).toBe(fuzz('vs_open:BB:BTN|KTo'));
    const values = new Set<number>();
    for (const s of allScenarios()) for (const h of ALL_HANDS.slice(0, 20)) values.add(fuzz(cardKeyOf(s, h)));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.9);
      expect(v).toBeLessThanOrEqual(1.1);
    }
    expect(values.size).toBeGreaterThan(5);
  });

  it('gives the same due for the same key and rating history, and only applies to intervals ≥ 3 d', () => {
    const a = drive(stepFor(BB_VS_BTN, 'KTo'), ['know', 'know']).due;
    resetSrs();
    const b = drive(stepFor(BB_VS_BTN, 'KTo'), ['know', 'know']).due;
    expect(a).toBe(b);
    // 1-day interval is exact
    expect(drive(stepFor(BB_VS_BTN, 'A5s'), ['know']).due).toBe(NOW + DAY);
  });
});

describe('channel modifiers', () => {
  const step = () => stepFor(BB_VS_BTN, 'KTo');

  it('peeked + know is exposure only', () => {
    recordExposure(step(), NOW - 1);
    const c = rate(step(), 'know', 'swipe', { peeked: true, now: NOW });
    expect(c).toMatchObject({ state: 'new', reps: 0, intervalDays: 0, exposures: 2, lastSeen: NOW });
    expect(c.lastRating).toBeUndefined();
    // peeked + unsure is a normal unsure
    const u = rate(step(), 'unsure', 'swipe', { peeked: true, now: NOW + 1 });
    expect(u.state).toBe('relearning');
  });

  it('partial know skips the ease bonus and shortens the interval × 0.8', () => {
    const s = step();
    rate(s, 'know', 'quiz', { now: NOW });
    const learning = rate(s, 'know', 'quiz', { partial: true, now: NOW + 1 });
    expect(learning).toMatchObject({ state: 'review', intervalDays: 2, ease: 2.3 }); // round(3 × 0.8)
    const review = rate(s, 'know', 'quiz', { partial: true, now: NOW + 2 });
    expect(review).toMatchObject({ state: 'review', intervalDays: 4, ease: 2.3 }); // max(3, round(2 × 2.3)) = 5 → round(4.0)
    const full = rate(s, 'know', 'quiz', { now: NOW + 3 });
    expect(full.ease).toBeCloseTo(2.35, 6);
  });

  it('quiz unsure adds ease − 0.1, quizWrong + 1, quizWrongAt and lastWrongAction', () => {
    const s = step();
    rate(s, 'know', 'swipe', { now: NOW - 2 * DAY });
    rate(s, 'know', 'swipe', { now: NOW - DAY });
    const c = rate(s, 'unsure', 'quiz', { now: NOW, chosen: 'fold' });
    expect(c).toMatchObject({ state: 'relearning', lapses: 1, quizWrong: 1, quizWrongAt: NOW, lastWrongAction: 'fold', due: NOW + TEN_MIN });
    expect(c.ease).toBeCloseTo(2.0, 6);
  });

  it('chart source is a plain unsure', () => {
    const c = rate(step(), 'unsure', 'chart', { now: NOW });
    expect(c).toMatchObject({ state: 'relearning', lapses: 1, quizWrong: 0, ease: 2.3 });
    expect(c.quizWrongAt).toBeUndefined();
  });
});

describe('learnable set and universe', () => {
  it('includes every non-fold hand and only boundary folds', () => {
    for (const s of allScenarios()) {
      if (!hasChart(s)) continue;
      const set = new Set(learnableHands(s));
      for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
          const h = gridHand(r, c);
          const nonFold = isNonFold(s, h);
          const near =
            (r > 0 && isNonFold(s, gridHand(r - 1, c))) ||
            (r < 12 && isNonFold(s, gridHand(r + 1, c))) ||
            (c > 0 && isNonFold(s, gridHand(r, c - 1))) ||
            (c < 12 && isNonFold(s, gridHand(r, c + 1)));
          expect(set.has(h), `${scenarioKey(s)} ${h}`).toBe(nonFold || near);
        }
      }
    }
    const utg = learnableHands(UTG_RFI);
    expect(utg).toContain('AA');
    expect(utg).toContain('54s'); // boundary fold next to 65s
    expect(utg).not.toContain('72o'); // interior fold
    expect(learnableHands(UTG_RFI)).toBe(utg); // memoised
    expect(learnableHands({ kind: 'rfi', hero: 'BB' })).toEqual([]);
  });

  it('universeSize sums learnable hands over kinds × hero positions with charts', () => {
    const all = universeSize([...SCENARIO_KINDS], [...POSITIONS]);
    let expected = 0;
    for (const s of allScenarios()) if (hasChart(s)) expected += learnableHands(s).length;
    expect(all).toBe(expected);
    expect(all).toBeGreaterThan(1000);
    expect(universeSize(['rfi'], ['UTG'])).toBe(learnableHands(UTG_RFI).length);
    expect(universeSize(['rfi'], ['BB'])).toBe(0);
    expect(universeSize([], [...POSITIONS])).toBe(0);
    expect(universeSize(KINDS, [...POSITIONS])).toBeLessThan(all);
  });
});

describe('derived counts', () => {
  it('classifies learned / learning / new and never goes negative', () => {
    expect(counts()).toEqual({ learned: 0, learning: 0, fresh: universeSize([...SCENARIO_KINDS], [...POSITIONS]) });
    seedRelearning(15);
    const rfiUtg = universeSize(['rfi'], ['UTG']);
    expect(counts(['rfi'], ['UTG'])).toEqual({ learned: 0, learning: 15, fresh: rfiUtg - 15 });
    expect(counts(['vs_open'], ['UTG']).learning).toBe(0);

    // exposure-only records are still new
    recordExposure(stepFor(UTG_RFI, 'AKo'), NOW);
    expect(counts(['rfi'], ['UTG']).learning).toBe(15);

    // review with interval ≥ 7 counts as learned; < 7 counts as learning
    drive(stepFor(BB_VS_BTN, 'KTo'), ['know', 'know', 'know']); // 7 d
    drive(stepFor(BB_VS_BTN, 'A5s'), ['know', 'know']); // 3 d
    expect(counts(['vs_open'], ['BB'])).toMatchObject({ learned: 1, learning: 1 });

    // rating every hand (incl. interior folds outside the universe) clamps fresh at 0
    for (const h of ALL_HANDS) rate(stepFor(UTG_RFI, h), 'unsure', 'swipe', { now: NOW });
    const c = counts(['rfi'], ['UTG']);
    expect(c.learning).toBe(169);
    expect(c.fresh).toBe(0);
  });
});

describe('weak spots', () => {
  it('needs ≥ 8 ratings per kind × hero bucket and sorts by unsure rate', () => {
    seedRelearning(7);
    expect(weakSpots()).toEqual([]);
    rate(stepFor(UTG_RFI, learnableHands(UTG_RFI)[7]), 'unsure', 'swipe', { now: NOW });
    expect(weakSpots()).toEqual([{ kind: 'rfi', hero: 'UTG', unsureRate: 1, rated: 8 }]);

    // BB vs BTN: 8 know + 8 unsure ratings → 50 %
    const hands = learnableHands(BB_VS_BTN);
    for (let i = 0; i < 8; i++) {
      const s = stepFor(BB_VS_BTN, hands[i]);
      rate(s, 'know', 'swipe', { now: NOW });
      rate(s, 'unsure', 'swipe', { now: NOW + 1 });
    }
    const spots = weakSpots(5);
    expect(spots.map((s) => `${s.kind}:${s.hero}:${s.unsureRate}:${s.rated}`)).toEqual(['rfi:UTG:1:8', 'vs_open:BB:0.5:16']);
    expect(weakSpots(1)).toHaveLength(1);
    expect(spots[0].quizAcc).toBeUndefined();
  });

  it('peeked ratings do not count as ratings', () => {
    const hands = learnableHands(UTG_RFI);
    for (let i = 0; i < 8; i++) rate(stepFor(UTG_RFI, hands[i]), 'know', 'swipe', { peeked: true, now: NOW });
    expect(weakSpots()).toEqual([]);
  });

  it('reads quizAcc from the stats store when attempts ≥ 5', () => {
    memStorage.setItem(STATS_KEY, JSON.stringify({ byKind: { rfi: { attempts: 10, correct: 6 }, vs_open: { attempts: 4, correct: 4 } } }));
    seedRelearning(8);
    const hands = learnableHands(BB_VS_BTN);
    for (let i = 0; i < 8; i++) rate(stepFor(BB_VS_BTN, hands[i]), 'unsure', 'swipe', { now: NOW });
    const byKind = Object.fromEntries(weakSpots(5).map((s) => [s.kind, s.quizAcc]));
    expect(byKind.rfi).toBeCloseTo(0.6, 6);
    expect(byKind.vs_open).toBeUndefined();
  });

  it('weakKeys = lapses ≥ 1 || ease < 1.8 || recent quiz wrong, sorted lapses desc then due asc', () => {
    const a = stepFor(UTG_RFI, 'AA');
    const b = stepFor(UTG_RFI, 'KK');
    const clean = stepFor(UTG_RFI, 'QQ');
    rate(a, 'unsure', 'swipe', { now: NOW - 3 * TEN_MIN });
    rate(a, 'unsure', 'swipe', { now: NOW - 2 * TEN_MIN }); // 2 lapses
    rate(b, 'unsure', 'swipe', { now: NOW - TEN_MIN }); // 1 lapse
    rate(clean, 'know', 'swipe', { now: NOW });
    recordExposure(stepFor(UTG_RFI, 'JJ'), NOW);
    expect(weakKeys(NOW)).toEqual(['rfi:UTG|AA', 'rfi:UTG|KK']);

    // a quiz wrong 31 days ago no longer qualifies on its own once lapses are irrelevant → still weak via lapses,
    // so check the window with a card that only has the quiz flag: not constructible (quiz unsure lapses too);
    // instead verify that clean review cards with ease ≥ 1.8 are excluded and the sort is stable.
    const c = stepFor(UTG_RFI, 'TT');
    rate(c, 'unsure', 'swipe', { now: NOW - 5 * TEN_MIN }); // 1 lapse, earlier due than KK
    expect(weakKeys(NOW)).toEqual(['rfi:UTG|AA', 'rfi:UTG|TT', 'rfi:UTG|KK']);
  });
});

/* ---- queue helpers ---- */

function runsOf(items: QueueItem[], pred: (it: QueueItem) => boolean): QueueItem[][] {
  const runs: QueueItem[][] = [];
  let cur: QueueItem[] = [];
  for (const it of items) {
    if (pred(it)) cur.push(it);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function expectChainsConsecutive(items: QueueItem[]) {
  const seen = new Map<number, number>();
  items.forEach((it, i) => {
    if (it.chainId === undefined) return;
    const last = seen.get(it.chainId);
    if (last !== undefined) expect(i, `chain ${it.chainId} split at ${i}`).toBe(last + 1);
    seen.set(it.chainId, i);
  });
}

function expectAtMostThreeNewInARow(items: QueueItem[]) {
  for (const run of runsOf(items, (it) => it.origin === 'new')) {
    if (run.length > 3) {
      const ids = new Set(run.map((it) => it.chainId));
      expect(ids.size, `run of ${run.length} new items must be one chain`).toBe(1);
      expect(run[0].chainId).toBeDefined();
    }
  }
}

function expectNoAdjacentScenarioOutsideChains(items: QueueItem[]) {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1];
    const b = items[i];
    const sameChain = a.chainId !== undefined && a.chainId === b.chainId;
    if (!sameChain) expect(a.key.split('|')[0], `items ${i - 1},${i}`).not.toBe(b.key.split('|')[0]);
  }
}

describe('buildQueue', () => {
  it('fills a fresh store with new chains only, kept consecutive', () => {
    const q = buildQueue(baseReq());
    expect(q.reason).toBeUndefined();
    expect(q.items.length).toBeGreaterThanOrEqual(20);
    expect(q.items.length).toBeLessThanOrEqual(22);
    expect(q.counts).toEqual({ new: q.items.length, due: 0, unsure: 0 });
    expect(new Set(q.items.map((it) => it.key)).size).toBe(q.items.length);
    expectChainsConsecutive(q.items);
    expect(q.items.some((it) => it.chainId !== undefined)).toBe(true);
    for (const it of q.items) expect(cardKey(it.step)).toBe(it.key);
    expect(q.items.every((it) => it.origin === 'new')).toBe(true);
  });

  it('applies the 30 % / 60 % caps and starts with a review', () => {
    seedRelearning(15);
    seedReviews(15);
    seedRandom(11);
    const q = buildQueue(baseReq());
    expect(q.counts.unsure).toBe(6); // ceil(20 × 0.3)
    expect(q.counts.unsure + q.counts.due).toBe(12); // ceil(20 × 0.6)
    expect(q.counts.new).toBeGreaterThanOrEqual(8);
    expect(q.counts.new).toBeLessThanOrEqual(10); // 8 + chain overflow ≤ 2
    expect(q.items.length).toBe(12 + q.counts.new);
    expect(q.items[0].origin).not.toBe('new');
    expectChainsConsecutive(q.items);
    expectAtMostThreeNewInARow(q.items);
    expectNoAdjacentScenarioOutsideChains(q.items);
    // 12 reviews around ≥ 4 new-blocks (≤ 3 items each) → ≥ 5 slots → runs of ≤ 3 are the optimum here
    for (const run of runsOf(q.items, (it) => it.origin !== 'new')) expect(run.length).toBeLessThanOrEqual(3);
    // review items carry a rebuilt step for their key
    for (const it of q.items) expect(cardKey(it.step)).toBe(it.key);
  });

  it('keeps reviews to ≤ 2 in a row when there are enough new cards to separate them', () => {
    seedRelearning(3);
    seedReviews(3);
    seedRandom(8);
    const q = buildQueue(baseReq());
    expect(q.counts.unsure + q.counts.due).toBe(6);
    expect(q.counts.new).toBeGreaterThanOrEqual(14);
    expect(q.items[0].origin).not.toBe('new');
    for (const run of runsOf(q.items, (it) => it.origin !== 'new')) expect(run.length).toBeLessThanOrEqual(2);
    expectAtMostThreeNewInARow(q.items);
    expectChainsConsecutive(q.items);
    expectNoAdjacentScenarioOutsideChains(q.items);
  });

  it('interleaves ≤ 3 new in a row when reviews are scarce', () => {
    seedReviews(4);
    seedRandom(5);
    const q = buildQueue(baseReq({ size: 10 }));
    expect(q.counts.due).toBe(4);
    expect(q.items[0].origin).toBe('due');
    expectAtMostThreeNewInARow(q.items);
    expectChainsConsecutive(q.items);
  });

  it('orders the pool relearning → recent quiz wrong → overdue ratio, so the most urgent cards make the cut', () => {
    // 3 relearning, 2 quiz-wrong reviews, 4 plain overdue reviews; size 10 → unsure cap 3, reviews cap 6
    const hands = learnableHands(BB_VS_BTN);
    const quizWrong = hands.slice(0, 2).map((h) => stepFor(BB_VS_BTN, h));
    for (const s of quizWrong) {
      rate(s, 'know', 'swipe', { now: NOW - 20 * DAY });
      rate(s, 'know', 'swipe', { now: NOW - 19 * DAY });
      rate(s, 'unsure', 'quiz', { now: NOW - 5 * DAY }); // relearning, quizWrongAt within 7 d
      rate(s, 'know', 'swipe', { now: NOW - 5 * DAY + TEN_MIN }); // back to review (2 d), due 3 d ago
    }
    const overdue = hands.slice(2, 6).map((h) => stepFor(BB_VS_BTN, h));
    for (const s of overdue) {
      rate(s, 'know', 'swipe', { now: NOW - 40 * DAY });
      rate(s, 'know', 'swipe', { now: NOW - 39 * DAY });
    }
    seedRelearning(3);
    seedRandom(2);
    const q = buildQueue(baseReq({ size: 10 }));
    const origins = q.items.filter((it) => it.origin !== 'new').map((it) => it.origin).sort();
    expect(origins).toEqual(['due', 'quizWrong', 'quizWrong', 'unsure', 'unsure', 'unsure']);
    expect(q.counts).toEqual({ new: q.counts.new, due: 3, unsure: 3 });
  });

  it('caps new cards at 10 during the first week', () => {
    const q = buildQueue(baseReq({ activeDays: 3 }));
    expect(q.counts.new).toBeGreaterThanOrEqual(10);
    expect(q.counts.new).toBeLessThanOrEqual(12);
    expect(q.counts.due + q.counts.unsure).toBe(0);
  });

  it('reports no_charts when deck × positions cannot produce a step', () => {
    expect(buildQueue(baseReq({ deck: 'rfi', positions: ['BB'] }))).toEqual({ items: [], counts: { new: 0, due: 0, unsure: 0 }, reason: 'no_charts' });
    expect(buildQueue(baseReq({ deck: 'vs_open', positions: ['UTG'] })).reason).toBe('no_charts');
    expect(buildQueue(baseReq({ deck: 'scenario', scenarioId: 'rfi:BB' })).reason).toBe('no_charts');
    expect(buildQueue(baseReq({ deck: 'scenario', scenarioId: 'bogus' })).reason).toBe('no_charts');
    expect(buildQueue(baseReq({ deck: 'weak' })).reason).toBe('empty');
    expect(buildQueue(baseReq({ size: 0 })).reason).toBe('empty');
  });

  it('respects the deck kinds', () => {
    for (const [deck, kinds] of [
      ['rfi', ['rfi']],
      ['vs_open', ['vs_open']],
      ['vs_3bet', ['vs_3bet']],
      ['vs_4bet_allin', ['vs_4bet', 'vs_5bet', 'cold_4bet']],
    ] as const) {
      const q = buildQueue(baseReq({ deck, size: 10 }));
      expect(q.items.length).toBeGreaterThan(0);
      for (const it of q.items) expect(kinds as readonly string[], `${deck}: ${it.key}`).toContain(it.step.scenario.kind);
    }
    const q = buildQueue(baseReq({ deck: 'all', kinds: ['vs_3bet'], positions: ['CO'], size: 10 }));
    for (const it of q.items) {
      expect(it.step.scenario.kind).toBe('vs_3bet');
      expect(it.step.scenario.hero).toBe('CO');
    }
  });

  it('scenario deck samples that scenario only and mixes in its due records', () => {
    seedReviews(4);
    seedRandom(4);
    const q = buildQueue(baseReq({ deck: 'scenario', scenarioId: 'vs_open:BB:BTN', size: 10, positions: ['UTG'] }));
    expect(q.items).toHaveLength(10);
    for (const it of q.items) {
      expect(it.key.startsWith('vs_open:BB:BTN|')).toBe(true);
      expect(it.chainId).toBeUndefined();
    }
    expect(q.counts.due).toBe(4);
    expect(q.counts.new).toBe(6);
    const learnable = new Set(learnableHands(BB_VS_BTN));
    for (const it of q.items) expect(learnable.has(it.step.hand), it.key).toBe(true);
  });

  it('weak deck draws reviews from the weak set and new cards from the weak kinds × heroes', () => {
    seedRelearning(15);
    seedRandom(9);
    const q = buildQueue(baseReq({ deck: 'weak', size: 10 }));
    const weak = new Set(weakKeys(NOW));
    expect(q.counts.unsure).toBe(3);
    expect(q.counts.due).toBe(0);
    for (const it of q.items) {
      if (it.origin === 'new') expect(it.key.startsWith('rfi:UTG|')).toBe(true);
      else expect(weak.has(it.key)).toBe(true);
    }
    expect(buildQueue(baseReq({ deck: 'weak', positions: ['BB'] })).reason).toBe('empty');
  });

  it('fills with not-yet-due records when the engine cannot supply new cards', () => {
    for (const h of learnableHands(BB_VS_BTN)) {
      const s = stepFor(BB_VS_BTN, h);
      rate(s, 'know', 'swipe', { now: NOW - 2 * DAY });
      rate(s, 'know', 'swipe', { now: NOW - DAY }); // review, due in ≥ 2 d
    }
    seedRandom(6);
    const q = buildQueue(baseReq({ deck: 'scenario', scenarioId: 'vs_open:BB:BTN', size: 10 }));
    expect(q.items).toHaveLength(10);
    expect(q.counts).toEqual({ new: 0, due: 10, unsure: 0 });
    const dues = q.items.map((it) => getCard(it.key)!.due);
    for (const d of dues) expect(d).toBeGreaterThan(NOW);
    // filled in due-asc order before the shuffle → the 10 earliest dues were chosen
    const all = learnableHands(BB_VS_BTN).map((h) => getCard(cardKeyOf(BB_VS_BTN, h))!.due).sort((a, b) => a - b);
    expect([...dues].sort((a, b) => a - b)).toEqual(all.slice(0, 10));
  });

  it('onlyKeys keeps the given order, drops unknown keys and duplicates, sets origin from the record', () => {
    seedRelearning(2);
    seedReviews(1);
    const relearn = learnableHands(UTG_RFI).slice(0, 2).map((h) => cardKeyOf(UTG_RFI, h));
    const review = cardKeyOf(BB_VS_BTN, learnableHands(BB_VS_BTN)[0]);
    const keys = [review, 'garbage', relearn[1], 'rfi:CO|72o', relearn[0], review];
    const q = buildQueue(baseReq({ onlyKeys: keys, size: 3 }));
    expect(q.items.map((it) => it.key)).toEqual([review, relearn[1], 'rfi:CO|72o', relearn[0]]);
    expect(q.items.map((it) => it.origin)).toEqual(['due', 'unsure', 'new', 'unsure']);
    expect(q.counts).toEqual({ new: 1, due: 1, unsure: 2 });
    expect(q.items.every((it) => it.chainId === undefined)).toBe(true);
    expect(buildQueue(baseReq({ onlyKeys: ['garbage'] }))).toEqual({ items: [], counts: { new: 0, due: 0, unsure: 0 }, reason: 'empty' });
  });

  it('quiz mode has no chains: every new item is a single step', () => {
    seedRelearning(15);
    seedReviews(15);
    seedRandom(3);
    const q = buildQueue(baseReq({ mode: 'quiz', size: 10 }));
    expect(q.items).toHaveLength(10);
    expect(q.items.every((it) => it.chainId === undefined)).toBe(true);
    expect(q.counts).toEqual({ new: 4, due: 3, unsure: 3 });
    expect(q.items[0].origin).not.toBe('new');
    expectAtMostThreeNewInARow(q.items);
    for (const run of runsOf(q.items, (it) => it.origin !== 'new')) expect(run.length).toBeLessThanOrEqual(2);
  });

  it('is deterministic for a seeded engine and a fixed now; previewQueue matches', () => {
    seedRelearning(5);
    seedReviews(5);
    seedRandom(21);
    const a = buildQueue(baseReq());
    seedRandom(21);
    const b = buildQueue(baseReq());
    expect(b.items.map((it) => it.key)).toEqual(a.items.map((it) => it.key));
    seedRandom(21);
    expect(previewQueue(baseReq())).toEqual(a.counts);
    seedRandom(21);
    const c = buildQueue(baseReq({ now: NOW + 1 }));
    expect(c.counts).toEqual(a.counts); // same selection, different order seed
  });
});

describe('storage', () => {
  it('debounces writes by 300 ms and flushes on demand', () => {
    vi.useFakeTimers();
    rate(stepFor(BB_VS_BTN, 'KTo'), 'know', 'swipe', { now: NOW });
    expect(memStorage.getItem(SRS_KEY)).toBeNull();
    vi.advanceTimersByTime(299);
    expect(memStorage.getItem(SRS_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(memStorage.getItem(SRS_KEY)).not.toBeNull();
    rate(stepFor(BB_VS_BTN, 'A5s'), 'unsure', 'swipe', { now: NOW });
    flushSrs();
    const parsed = JSON.parse(memStorage.getItem(SRS_KEY)!) as { v: number; c: Record<string, unknown[]> };
    expect(parsed.v).toBe(1);
    expect(Object.keys(parsed.c).sort()).toEqual(['vs_open:BB:BTN|A5s', 'vs_open:BB:BTN|KTo']);
  });

  it('stays ≤ 1 MB after 5 000 rated cards and round-trips every field', async () => {
    const pairs: Array<[Scenario, string]> = [];
    for (const s of allScenarios()) for (const h of ALL_HANDS) pairs.push([s, h]);
    const sample = pairs.slice(0, 5000);
    expect(sample).toHaveLength(5000);
    sample.forEach(([s, h], i) => {
      const step = stepFor(s, h);
      rate(step, 'know', 'swipe', { now: NOW - 3 * DAY + i });
      rate(step, i % 3 === 0 ? 'unsure' : 'know', i % 5 === 0 ? 'quiz' : 'button', { now: NOW + i, chosen: 'call', partial: i % 7 === 0 });
    });
    flushSrs();
    const raw = memStorage.getItem(SRS_KEY)!;
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(1_000_000);

    const before = getCard(cardKeyOf(sample[15][0], sample[15][1]))!;
    const beforeQuiz = getCard(cardKeyOf(sample[0][0], sample[0][1]))!;
    vi.resetModules();
    const fresh = await import('../srs');
    expect(fresh.getCard(before.key)).toEqual(before);
    expect(fresh.getCard(beforeQuiz.key)).toEqual(beforeQuiz);
    expect(beforeQuiz.lastWrongAction).toBe('call');
    expect(Object.keys(JSON.parse(memStorage.getItem(SRS_KEY)!).c)).toHaveLength(5000);
    expect(fresh.counts().learned + fresh.counts().learning).toBe(5000);
  });

  it('ignores corrupt storage and works without localStorage at all', async () => {
    memStorage.setItem(SRS_KEY, '{not json');
    vi.resetModules();
    const corrupt = await import('../srs');
    expect(corrupt.counts().learning).toBe(0);

    const saved = globalThis.localStorage;
    // @ts-expect-error -- simulate an environment without storage
    delete globalThis.localStorage;
    try {
      vi.resetModules();
      const bare = await import('../srs');
      const c = bare.rate(stepFor(BB_VS_BTN, 'KTo'), 'know', 'swipe', { now: NOW });
      expect(c.state).toBe('learning');
      expect(() => bare.flushSrs()).not.toThrow();
      expect(bare.weakSpots()).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true, writable: true });
    }
  });
});

describe('예전 저장 형식 (13칸)', () => {
  it('13칸 기록도 읽히고, 답을 낸 횟수를 평가 횟수로 어림잡는다', async () => {
    // quizSeen/pickSeen 이 없던 시절의 기록. 0으로 두면 코치 탭의 분모가 통째로 비어
    // 성향 축이 영영 안 열리므로 평가 횟수(reps + lapses)로 어림잡는다.
    const legacy = { v: 1, c: { 'rfi:UTG|AKs': [2, 2.3, 3, 1, 4, 2, 9, 1, 0, -1, 1, 1, 2] } };
    localStorage.setItem('holdem-flicker.srs.v1', JSON.stringify(legacy));
    vi.resetModules();
    const fresh = await import('../srs');
    const card = fresh.getCard('rfi:UTG|AKs');
    expect(card).toBeDefined();
    expect(card!.reps).toBe(4);
    expect(card!.lapses).toBe(2);
    expect(card!.quizSeen).toBe(6);
    expect(card!.pickSeen).toBe(0);
    // 15칸 기록은 저장된 값을 그대로 읽는다.
    localStorage.setItem('holdem-flicker.srs.v1', JSON.stringify({ v: 1, c: { 'rfi:UTG|AKs': [2, 2.3, 3, 1, 4, 2, 9, 1, 0, -1, 1, 1, 2, 7, 3] } }));
    vi.resetModules();
    const fresh2 = await import('../srs');
    expect(fresh2.getCard('rfi:UTG|AKs')!.quizSeen).toBe(7);
    expect(fresh2.getCard('rfi:UTG|AKs')!.pickSeen).toBe(3);
  });
});
