import { getChartCells, getChartDef, hasChart } from './data';
import { ALL_HANDS, dealRandomHand, dealWeightedHand, pick, random } from './hands';
import { continueWeights, fullMix, primaryAction } from './range';
import { positionsAfter, positionsBefore } from './scenarios';
import { POSITIONS, POS_INDEX, type Action, type ActionMix, type ChartCells, type ChartDef, type HandName, type Pos, type Scenario, type ScenarioKind } from './types';

export interface Step {
  scenario: Scenario;
  hand: HandName;
  chart: ChartDef;
  cells: ChartCells;
  mix: ActionMix | undefined;
  /** The action to memorize. */
  answer: Action;
  /** Full mix incl. fold, sorted by weight. */
  mixList: Array<{ action: Action; weight: number }>;
  /** Index of this step within its hand sequence and the total count. */
  index: number;
  total: number;
}

export interface SessionOptions {
  positions: Pos[];
  kinds: ScenarioKind[];
  /** Include the cold 4-bet line (opener + 3-bettor in front). */
  /** 0..1: probability of dealing a hand from hero's "interesting" (non-fold somewhere) set instead of uniformly. */
  interestingBias: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  positions: [...POSITIONS],
  kinds: ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'],
  interestingBias: 0.6,
};

function makeStep(scenario: Scenario, hand: HandName): Step | null {
  if (!hasChart(scenario)) return null;
  const chart = getChartDef(scenario);
  const cells = getChartCells(scenario);
  const mix = cells[hand];
  return { scenario, hand, chart, cells, mix, answer: primaryAction(mix), mixList: fullMix(mix), index: 0, total: 0 };
}

/** Union of non-fold weights across every chart where `hero` acts. */
export function interestingWeights(hero: Pos): Record<HandName, number> {
  const out: Record<HandName, number> = {};
  const scenarios: Scenario[] = [];
  if (hero !== 'BB') scenarios.push({ kind: 'rfi', hero });
  for (const v of positionsBefore(hero)) scenarios.push({ kind: 'vs_open', hero, villain: v });
  for (const s of scenarios) {
    if (!hasChart(s)) continue;
    const w = continueWeights(getChartCells(s));
    for (const h of ALL_HANDS) if (w[h]) out[h] = Math.max(out[h] ?? 0, w[h]);
  }
  return out;
}

/**
 * Build the ordered list of decision steps for one dealt hand:
 *  Line A (hero opens): rfi → vs_3bet (random later villain) → vs_5bet
 *  Line B (hero faces an open): vs_open (random earlier villain) → vs_4bet
 *  Line C: cold_4bet (random opener + 3-bettor in front)
 * Later steps in a line only appear when the memorized answer of the previous step continues aggressively.
 */
export function buildSteps(hero: Pos, hand: HandName, opts: SessionOptions, rng: () => number = random): Step[] {
  const kinds = new Set(opts.kinds);
  const steps: Step[] = [];
  const pickFrom = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  // Line A
  if (hero !== 'BB') {
    let opened = false;
    if (kinds.has('rfi')) {
      const s = makeStep({ kind: 'rfi', hero }, hand);
      if (s) {
        steps.push(s);
        opened = s.answer === 'raise';
      }
    } else {
      const rfi = hasChart({ kind: 'rfi', hero }) ? getChartCells({ kind: 'rfi', hero })[hand] : undefined;
      opened = !!rfi?.raise;
    }
    const after = positionsAfter(hero);
    if (opened && after.length && (kinds.has('vs_3bet') || kinds.has('vs_5bet'))) {
      const villain = pickFrom(after);
      let fourBet = false;
      if (kinds.has('vs_3bet')) {
        const s = makeStep({ kind: 'vs_3bet', hero, villain }, hand);
        if (s) {
          steps.push(s);
          fourBet = s.answer === 'fourbet';
        }
      } else if (hasChart({ kind: 'vs_3bet', hero, villain })) {
        fourBet = !!getChartCells({ kind: 'vs_3bet', hero, villain })[hand]?.fourbet;
      }
      if (fourBet && kinds.has('vs_5bet')) {
        const s = makeStep({ kind: 'vs_5bet', hero, villain }, hand);
        if (s) steps.push(s);
      }
    }
  }

  // Line B
  const before = positionsBefore(hero);
  if (before.length && (kinds.has('vs_open') || kinds.has('vs_4bet'))) {
    const villain = pickFrom(before);
    let threeBet = false;
    if (kinds.has('vs_open')) {
      const s = makeStep({ kind: 'vs_open', hero, villain }, hand);
      if (s) {
        steps.push(s);
        threeBet = s.answer === 'threebet';
      }
    } else if (hasChart({ kind: 'vs_open', hero, villain })) {
      threeBet = !!getChartCells({ kind: 'vs_open', hero, villain })[hand]?.threebet;
    }
    if (threeBet && kinds.has('vs_4bet')) {
      const s = makeStep({ kind: 'vs_4bet', hero, villain }, hand);
      if (s) steps.push(s);
    }
  }

  // Line C
  if (kinds.has('cold_4bet') && POS_INDEX[hero] >= 2) {
    const opener = pickFrom(before.slice(0, -1));
    const threeBettor = pickFrom(before.filter((p) => POS_INDEX[p] > POS_INDEX[opener]));
    const s = makeStep({ kind: 'cold_4bet', hero, extras: { opener, threeBettor } }, hand);
    if (s) steps.push(s);
  }

  steps.forEach((s, i) => {
    s.index = i;
    s.total = steps.length;
  });
  return steps;
}

/** Deal a hand for `hero`, biased toward hands that are playable somewhere for that seat. */
export function dealForHero(hero: Pos, opts: SessionOptions, rng: () => number = random): HandName {
  const kinds = new Set(opts.kinds);
  // If only "later" scenarios are trained, sample from the range that reaches them.
  const onlyLater = !kinds.has('rfi') && !kinds.has('vs_open') && !kinds.has('cold_4bet');
  if (onlyLater) {
    if ((kinds.has('vs_3bet') || kinds.has('vs_5bet')) && hero !== 'BB' && hasChart({ kind: 'rfi', hero })) {
      const h = dealWeightedHand(continueWeights(getChartCells({ kind: 'rfi', hero })));
      if (h) return h;
    }
    if (kinds.has('vs_4bet') && hero !== 'UTG') {
      const villain = pick(positionsBefore(hero));
      if (hasChart({ kind: 'vs_open', hero, villain })) {
        const h = dealWeightedHand(continueWeights(getChartCells({ kind: 'vs_open', hero, villain }), ['threebet']));
        if (h) return h;
      }
    }
  }
  if (rng() < opts.interestingBias) {
    const h = dealWeightedHand(interestingWeights(hero));
    if (h) return h;
  }
  return dealRandomHand();
}

/** Produce the next non-empty hand sequence (hero + hand + steps). */
export function nextHandSequence(opts: SessionOptions): { hero: Pos; hand: HandName; steps: Step[] } {
  const positions = opts.positions.length ? opts.positions : [...POSITIONS];
  for (let attempt = 0; attempt < 50; attempt++) {
    const hero = pick(positions);
    const hand = dealForHero(hero, opts);
    const steps = buildSteps(hero, hand, opts);
    if (steps.length) return { hero, hand, steps };
  }
  // Fallback: any scenario with a chart
  const hero = pick(positions);
  const hand = dealRandomHand();
  return { hero, hand, steps: buildSteps(hero, hand, { ...opts, kinds: ['rfi', 'vs_open'] }) };
}

/** Produce a single random step for quiz mode (any enabled scenario kind, hand sampled sensibly). */
export function randomQuizStep(opts: SessionOptions): Step {
  for (let attempt = 0; attempt < 100; attempt++) {
    const seq = nextHandSequence(opts);
    if (seq.steps.length) return pick(seq.steps);
  }
  const hero: Pos = 'BTN';
  const step = makeStep({ kind: 'rfi', hero }, dealRandomHand());
  if (!step) throw new Error('No charts available');
  return step;
}

/** Build a standalone step for any scenario + hand (used by the chart browser and quiz). Throws if no chart. */
export function stepFor(scenario: Scenario, hand: HandName): Step {
  const s = makeStep(scenario, hand);
  if (!s) throw new Error(`No chart for ${scenario.kind} ${scenario.hero} ${scenario.villain ?? ''}`);
  s.total = 1;
  return s;
}
