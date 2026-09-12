import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS, getChartCells, missingScenarios, hasChart } from '../src/poker/data';
import { allScenarios } from '../src/poker/scenarios';
import { buildChart, primaryAction, rangeShare } from '../src/poker/range';
import { ALL_HANDS } from '../src/poker/hands';
import { SCENARIO_ACTIONS, type Action, type Scenario } from '../src/poker/types';

const scenarios = allScenarios();

describe('chart data integrity', () => {
  it('every chart parses and only uses actions legal in its scenario', () => {
    for (const def of ALL_CHART_DEFS) {
      const cells = buildChart(def);
      const legal = new Set<Action>(SCENARIO_ACTIONS[def.kind]);
      for (const [action, str] of Object.entries(def.actions)) {
        expect(legal.has(action as Action), `${def.id}: action ${action} not legal for ${def.kind}`).toBe(true);
        expect(typeof str).toBe('string');
      }
      for (const h of ALL_HANDS) {
        for (const a of Object.keys(cells[h] ?? {})) expect(legal.has(a as Action), `${def.id}: ${h} uses ${a}`).toBe(true);
      }
      for (const h of Object.keys(def.notes ?? {})) expect(ALL_HANDS, `${def.id}: note for unknown hand ${h}`).toContain(h);
    }
  });

  it('lists which scenarios still lack charts (informational)', () => {
    const missing = missingScenarios();
    // eslint-disable-next-line no-console
    if (missing.length) console.log(`Missing charts: ${missing.length}/${scenarios.length}`);
    expect(scenarios.length).toBe(5 + 15 + 15 + 15 + 15 + 4);
  });

  it('premium hands are never folded', () => {
    for (const s of scenarios) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ['AA', 'KK']) {
        expect(primaryAction(cells[h]), `${s.kind} ${s.hero} ${s.villain ?? ''} folds ${h}`).not.toBe('fold');
      }
      // AA takes the most aggressive available action
      const aggressive = SCENARIO_ACTIONS[s.kind].at(-1)!;
      expect(primaryAction(cells.AA), `${s.kind} ${s.hero} ${s.villain ?? ''} AA should ${aggressive}`).toBe(aggressive);
    }
  });

  it('RFI ranges widen from UTG to BTN', () => {
    const share = (hero: Scenario['hero']) => rangeShare(getChartCells({ kind: 'rfi', hero }));
    expect(share('UTG')).toBeLessThan(share('HJ'));
    expect(share('HJ')).toBeLessThan(share('CO'));
    expect(share('CO')).toBeLessThan(share('BTN'));
    expect(share('UTG')).toBeGreaterThan(0.13);
    expect(share('UTG')).toBeLessThan(0.21);
    expect(share('BTN')).toBeGreaterThan(0.38);
    expect(share('BTN')).toBeLessThan(0.52);
    expect(share('SB')).toBeGreaterThan(0.36);
    expect(share('SB')).toBeLessThan(0.55);
  });

  it('trash hands fold everywhere', () => {
    for (const s of scenarios) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ['72o', '83o', '92o']) {
        expect(primaryAction(cells[h]), `${s.kind} ${s.hero} ${s.villain ?? ''} plays ${h}`).toBe('fold');
      }
    }
  });
});

describe('tree consistency (only for charts that exist)', () => {
  const nonFold = (s: Scenario) => Object.entries(getChartCells(s)).filter(([, mix]) => Object.values(mix).some((w) => (w ?? 0) > 0)).map(([h]) => h);
  const weight = (s: Scenario, hand: string, action: Action) => getChartCells(s)[hand]?.[action] ?? 0;

  it('vs_3bet continuing hands are inside the RFI opening range', () => {
    for (const s of scenarios.filter((x) => x.kind === 'vs_3bet' && hasChart(x))) {
      const rfi: Scenario = { kind: 'rfi', hero: s.hero };
      if (!hasChart(rfi)) continue;
      for (const h of nonFold(s)) expect(weight(rfi, h, 'raise'), `${s.hero} vs ${s.villain} 3bet: ${h} continues but never opens`).toBeGreaterThan(0);
    }
  });

  it('vs_4bet continuing hands are inside the vs_open 3-bet range', () => {
    for (const s of scenarios.filter((x) => x.kind === 'vs_4bet' && hasChart(x))) {
      const vo: Scenario = { kind: 'vs_open', hero: s.hero, villain: s.villain };
      if (!hasChart(vo)) continue;
      for (const h of nonFold(s)) expect(weight(vo, h, 'threebet'), `${s.hero} vs ${s.villain} 4bet: ${h} continues but never 3-bets`).toBeGreaterThan(0);
    }
  });

  it('vs_5bet calling hands are inside the vs_3bet 4-bet range', () => {
    for (const s of scenarios.filter((x) => x.kind === 'vs_5bet' && hasChart(x))) {
      const v3: Scenario = { kind: 'vs_3bet', hero: s.hero, villain: s.villain };
      if (!hasChart(v3)) continue;
      for (const h of nonFold(s)) expect(weight(v3, h, 'fourbet'), `${s.hero} vs ${s.villain} 5bet: ${h} calls but never 4-bets`).toBeGreaterThan(0);
    }
  });

  it('defends wider against later openers (vs_open total continue share)', () => {
    for (const hero of ['CO', 'BTN', 'SB', 'BB'] as const) {
      const vs = scenarios.filter((x) => x.kind === 'vs_open' && x.hero === hero && hasChart(x));
      for (let i = 1; i < vs.length; i++) {
        const a = rangeShare(getChartCells(vs[i - 1]));
        const b = rangeShare(getChartCells(vs[i]));
        expect(b, `${hero} vs ${vs[i].villain} (${(b * 100).toFixed(1)}%) should defend at least as wide as vs ${vs[i - 1].villain} (${(a * 100).toFixed(1)}%)`).toBeGreaterThanOrEqual(a - 0.005);
      }
    }
  });
});
