import { describe, expect, it } from 'vitest';
import { getChartCells, getChartDef, hasChart } from '../src/poker/data';
import { ALL_HANDS, parseHandName } from '../src/poker/hands';
import { AGGRESSION_ORDER, foldWeight, primaryAction, restAction } from '../src/poker/range';
import { allScenarios, positionsAfter, positionsBefore, scenarioKey } from '../src/poker/scenarios';
import { RANKS, type Action, type HandName, type Pos, type Scenario } from '../src/poker/types';

/*
 * 차트 데이터 불변식 — docs/ATLAS_SPEC.md §7 테스트 11~15 (CI 가드).
 * 자리별 보기의 '부터'·'어디서든'·'까지' 문장은 이 불변식 위에 서 있습니다. 하나라도 깨지면
 * 어느 패에서, 어떤 문장이 거짓이 되는지 함께 찍습니다 — 차트를 고친 사람이 바로 볼 수 있게.
 */

const aggression = (a: Action) => AGGRESSION_ORDER.indexOf(a);
const CORE: Pos[] = ['UTG', 'HJ', 'CO', 'BTN'];
const raiseW = (hero: Pos, hand: HandName) => getChartCells({ kind: 'rfi', hero })[hand]?.raise ?? 0;
const contW = (s: Scenario, hand: HandName) => 1 - foldWeight(getChartCells(s)[hand]);
const prim = (s: Scenario, hand: HandName) => primaryAction(getChartCells(s)[hand]);

/**
 * 줄의 계속 비중이 킥커 내림차순으로 비증가인가 — 옛 atlas.rowBoundary.monotone 을 여기서 직접 계산합니다
 * (그 함수는 line.ts 의 lineSentence 로 대체돼 지웠습니다). 줄은 페어 대각선, 또는 같은 높은 카드·같은 수티드 여부.
 */
function rowMonotone(s: Scenario, rep: HandName): { label: string; monotone: boolean } {
  const info = parseHandName(rep);
  let hands: HandName[];
  let label: string;
  if (info.kind === 'pair') {
    hands = RANKS.map((r) => `${r}${r}`);
    label = '포켓페어';
  } else {
    const suf = info.kind === 'suited' ? 's' : 'o';
    hands = RANKS.slice(RANKS.indexOf(info.high) + 1).map((r) => `${info.high}${r}${suf}`);
    label = `${info.kind === 'suited' ? '수티드' : '오프수트'} ${info.high}`;
  }
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  const weights = hands.map((h) => 1 - (rest === 'fold' ? foldWeight(cells[h]) : (cells[h]?.[rest] ?? 0)));
  return { label, monotone: weights.every((w, i) => i === 0 || w <= weights[i - 1] + 1e-6) };
}

describe('chart invariants the atlas sentences rely on', () => {
  it('RFI raise weight is non-decreasing UTG→BTN for all 169 hands', () => {
    const bad: string[] = [];
    for (const hand of ALL_HANDS) {
      const w = CORE.map((p) => raiseW(p, hand));
      for (let i = 1; i < w.length; i++) {
        if (w[i] < w[i - 1] - 1e-6) bad.push(`${hand}: ${CORE[i - 1]} ${w[i - 1]} > ${CORE[i]} ${w[i]} — "${hand}는 ${CORE[i - 1]}부터 오픈합니다"가 거짓이 됩니다`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('vs_open and vs_3bet hero rows are non-decreasing in AGGRESSION_ORDER and in continue weight along the villain axis', () => {
    const bad: string[] = [];
    let rows = 0;
    for (const kind of ['vs_open', 'vs_3bet'] as const) {
      for (const hero of ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Pos[]) {
        const villains = kind === 'vs_open' ? positionsBefore(hero) : positionsAfter(hero);
        if (villains.length < 2) continue;
        for (const hand of ALL_HANDS) {
          rows++;
          const cells = villains.map((villain) => ({ villain, s: { kind, hero, villain } as Scenario }));
          for (let i = 1; i < cells.length; i++) {
            const a = cells[i - 1];
            const b = cells[i];
            const pa = prim(a.s, hand);
            const pb = prim(b.s, hand);
            if (aggression(pb) < aggression(pa)) bad.push(`${scenarioKey(b.s)} ${hand}: ${pa} → ${pb} — "${a.villain} ${kind === 'vs_open' ? '오픈' : '3벳'}부터 ${pa}"가 거짓이 됩니다`);
            if (contW(b.s, hand) < contW(a.s, hand) - 1e-6) bad.push(`${scenarioKey(b.s)} ${hand}: continue ${contW(a.s, hand)} → ${contW(b.s, hand)}`);
          }
        }
      }
    }
    expect(rows).toBe(676 * 2);
    expect(bad).toEqual([]);
  });

  it('vs_open: BB continues at least as much as every other hero vs the same opener', () => {
    const bad: string[] = [];
    for (const villain of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) {
      for (const hero of positionsAfter(villain)) {
        if (hero === 'BB') continue;
        for (const hand of ALL_HANDS) {
          const bb = contW({ kind: 'vs_open', hero: 'BB', villain }, hand);
          const other = contW({ kind: 'vs_open', hero, villain }, hand);
          if (bb < other - 1e-6) bad.push(`${hand} vs ${villain}: BB ${bb} < ${hero} ${other} — "BB는 … 가장 넓게 콜합니다"가 거짓이 됩니다`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('non-monotone row boundaries occur only in suited-A rows', () => {
    // 줄 대표 패: 페어 줄 AA, 수티드/오프수트 줄은 그 줄의 첫 패(AKs, KQs, …, 32s / AKo, …, 32o) — 74차트 × 25줄 = 1850.
    const reps: HandName[] = ['AA'];
    for (let i = 0; i < RANKS.length - 1; i++) {
      reps.push(`${RANKS[i]}${RANKS[i + 1]}s`);
      reps.push(`${RANKS[i]}${RANKS[i + 1]}o`);
    }
    expect(reps.length).toBe(25);
    const nonMonotone: string[] = [];
    let rows = 0;
    for (const s of allScenarios().filter(hasChart)) {
      for (const rep of reps) {
        rows++;
        const r = rowMonotone({ kind: s.kind, hero: s.hero, villain: s.villain }, rep);
        if (!r.monotone) nonMonotone.push(`${scenarioKey(s)} ${r.label}`);
      }
    }
    expect(rows).toBe(1850);
    expect(nonMonotone.length).toBe(33);
    for (const row of nonMonotone) expect(row.endsWith('수티드 A'), `${row} — "{seat}는 {줄}을 X까지 오픈합니다"가 거짓이 됩니다`).toBe(true);
    // 수티드 A 가 아닌 줄은 전부 단조이므로 '까지' 문장을 쓸 수 있습니다.
    expect(parseHandName('A5s').kind).toBe('suited');
  });

  it('SB differs from BTN in rfi primary only for J4s, K6o', () => {
    const differs = ALL_HANDS.filter((hand) => prim({ kind: 'rfi', hero: 'SB' }, hand) !== prim({ kind: 'rfi', hero: 'BTN' }, hand));
    // 바뀌면 rfiThesis 의 SB 절 규칙("SB에서는 {act}합니다")을 다시 볼 것.
    expect(differs).toEqual(['J4s', 'K6o']);
  });
});
