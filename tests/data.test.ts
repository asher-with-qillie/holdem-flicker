import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS, getChartCells, getChartDef, missingScenarios, hasChart } from '../src/poker/data';
import { allScenarios } from '../src/poker/scenarios';
import { buildChart, primaryAction, rangeShare, restAction } from '../src/poker/range';
import { ALL_HANDS } from '../src/poker/hands';
import { scenarioActions, type Action, type Scenario } from '../src/poker/types';

const scenarios = allScenarios();

describe('chart data integrity', () => {
  it('every chart parses and only uses actions legal in its scenario', () => {
    for (const def of ALL_CHART_DEFS) {
      const cells = buildChart(def);
      const legal = new Set<Action>(scenarioActions(def.kind, def.hero));
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

  it('has a chart for every scenario', () => {
    // rfi 5 · vs_open 15 · vs_3bet 15 · vs_4bet 15 · vs_5bet 15 · cold_4bet 4 · vs_limp 5
    expect(scenarios.length).toBe(5 + 15 + 15 + 15 + 15 + 4 + 5);
    expect(missingScenarios().map((s) => `${s.kind}:${s.hero}:${s.villain ?? ''}`)).toEqual([]);
  });

  it('premium hands are never folded', () => {
    for (const s of scenarios) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ['AA', 'KK']) {
        expect(primaryAction(cells[h]), `${s.kind} ${s.hero} ${s.villain ?? ''} folds ${h}`).not.toBe('fold');
      }
      // AA takes the most aggressive available action
      const aggressive = scenarioActions(s.kind, s.hero).at(-1)!;
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
    // 책(MPT 5장): SB 는 림프 38 · 레이즈 24 · 폴드 38 — 들어가는 비중(림프 + 레이즈)은 약 62%예요.
    expect(share('SB')).toBeGreaterThan(0.56);
    expect(share('SB')).toBeLessThan(0.68);
  });

  // 쓰레기 패는 어디서도 '들어가지' 않습니다. 다만 '들어가지 않는다'가 곧 폴드는 아닙니다 —
  // 빅블라인드는 이미 돈을 냈으니 접을 수 없고, 안 올린 패는 전부 체크입니다.
  // 여기서 규칙을 통째로 끄지 마세요(if kind !== 'vs_limp' 같은 식) — 끄면 이 규칙이 그 차트를
  // 영영 지켜 주지 않습니다. 예외는 한 곳뿐이고, 아래에서 그 모양까지 따로 확인합니다.
  //   BB vs SB 림프: 레이즈는 양극화(강한 패 + 체크하면 쇼다운까지 못 가는 가장 약한 오프수트)라서
  //   72o · 83o · 92o 가 블러프 레이즈예요(BOOK_CHART_SPEC §5, 공개 솔버 자료).
  const POLAR_TRASH_RAISE = new Set(['vs_limp:BB']);
  it("trash hands take the chart's rest action everywhere", () => {
    for (const s of scenarios) {
      if (!hasChart(s)) continue;
      const def = getChartDef(s);
      if (POLAR_TRASH_RAISE.has(def.id)) continue;
      const cells = getChartCells(s);
      const rest = restAction(def);
      for (const h of ['72o', '83o', '92o']) {
        expect(primaryAction(cells[h]), `${s.kind} ${s.hero} ${s.villain ?? ''} plays ${h}`).toBe(rest);
      }
    }
  });

  it('the one exception is polar: BB vs SB limp bluff-raises the weakest offsuit hands and checks the middle', () => {
    const cells = getChartCells({ kind: 'vs_limp', hero: 'BB' });
    for (const h of ['72o', '83o', '92o']) expect(primaryAction(cells[h]), `BB vs SB limp ${h}`).toBe('raise');
    // 가운데(쇼다운 가치가 있는 패)는 체크 — 레이즈가 쓰레기까지 이어진 '넓은 선형'이 아니라는 뜻이에요.
    for (const h of ['A2o', '22', 'J9s', 'T9s']) expect(primaryAction(cells[h]), `BB vs SB limp ${h}`).toBe('check');
    for (const h of ['AA', 'AKo', 'KQs']) expect(primaryAction(cells[h]), `BB vs SB limp ${h}`).toBe('raise');
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
