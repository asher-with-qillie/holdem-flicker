import { beforeEach, describe, expect, it } from 'vitest';
import { getChartCells, hasChart } from '../src/poker/data';
import { ALL_HANDS, gridHand } from '../src/poker/hands';
import { fullMix, primaryAction } from '../src/poker/range';
import { allScenarios } from '../src/poker/scenarios';
import { isReachable } from '../src/poker/atlas';
import {
  BOUNDARY_WEIGHT,
  boundaryTable,
  buildSteps,
  cellDealWeight,
  DEFAULT_SESSION_OPTIONS,
  dealForHero,
  nextHandSequence,
  pruneSteps,
  stepFor,
} from '../src/poker/trainer';
import { DEFAULT_SETTINGS } from '../src/state/settings';
import { buildQueue, resetSrs } from '../src/state/srs';
import { POSITIONS, type Action, type ChartCells, type HandName, type Pos, type ScenarioKind } from '../src/poker/types';

/** 테스트 안에서만 쓰는 시드 난수(hands.ts 의 전역 시드와 섞이지 않게). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const passive = (a: Action) => a === 'fold' || a === 'check';
const rc = (h: HandName): [number, number] => {
  const i = ALL_HANDS.indexOf(h);
  return [Math.floor(i / 13), i % 13];
};

/** 엔진과 따로 쓴 경계 판정: 상하좌우(페어는 대각선 이웃 페어까지) 중 주 액션이 다른 칸이 하나라도 있으면 경계. */
function onEdge(cells: ChartCells, h: HandName): boolean {
  const [r, c] = rc(h);
  const a = primaryAction(cells[h]);
  const nb: Array<[number, number]> = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  if (r === c) nb.push([r - 1, c - 1], [r + 1, c + 1]);
  return nb.some(([y, x]) => y >= 0 && y < 13 && x >= 0 && x < 13 && primaryAction(cells[gridHand(y, x)]) !== a);
}

describe('경계 가중치 (cellDealWeight / boundaryTable)', () => {
  it('경계 ×3 · 혼합 ×1 · 안쪽 비폴드 ×1 · 안쪽 폴드·체크 0 — 모든 차트의 모든 칸', () => {
    for (const s of allScenarios()) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ALL_HANDS) {
        const [r, c] = rc(h);
        const top = fullMix(cells[h])[0];
        const mixed = top.weight < 0.6;
        const want = mixed ? 1 : onEdge(cells, h) ? BOUNDARY_WEIGHT : passive(top.action) ? 0 : 1;
        expect(cellDealWeight(cells, r, c), `${s.kind} ${s.hero} ${s.villain ?? ''} ${h}`).toBe(want);
      }
    }
  });

  it('패 하나의 가중치는 켜진 첫 결정 차트들에서의 최댓값이고, 0 인 패만 negatives 로 간다', () => {
    for (const hero of POSITIONS) {
      const kinds: ScenarioKind[] = ['rfi', 'vs_open', 'vs_limp'];
      const charts = allScenarios().filter((s) => s.hero === hero && kinds.includes(s.kind) && hasChart(s));
      const t = boundaryTable(hero, kinds);
      for (const h of ALL_HANDS) {
        const [r, c] = rc(h);
        const want = Math.max(0, ...charts.map((s) => cellDealWeight(getChartCells(s), r, c)));
        expect(t.weights[h] ?? 0, `${hero} ${h}`).toBe(want);
        expect(!!t.negatives[h], `${hero} ${h}`).toBe(want === 0);
      }
    }
  });

  it('꺼진 종류의 차트는 보지 않는다 — rfi 만 켜면 오픈 표의 경계만', () => {
    const rfiOnly = boundaryTable('UTG', ['rfi']);
    const cells = getChartCells({ kind: 'rfi', hero: 'UTG' });
    for (const h of ALL_HANDS) {
      const [r, c] = rc(h);
      expect(rfiOnly.weights[h] ?? 0, h).toBe(cellDealWeight(cells, r, c));
    }
    // 첫 결정 종류가 하나도 안 켜졌으면(3벳 대응만) hero 의 첫 결정 차트 전부로 계산합니다.
    expect(boundaryTable('CO', ['vs_3bet'])).toEqual(boundaryTable('CO', ['rfi', 'vs_open', 'vs_limp', 'cold_4bet']));
  });

  it('균등 딜이 사라졌다: interestingBias 0 이면 90% 이상이 경계·혼합·비폴드 칸, 안쪽 폴드는 바닥값(10%) 아래', () => {
    const rng = lcg(3);
    const opts = { ...DEFAULT_SESSION_OPTIONS, kinds: DEFAULT_SETTINGS.kinds, interestingBias: 0 };
    let inside = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const hero = POSITIONS[i % POSITIONS.length];
      if (boundaryTable(hero, opts.kinds).negatives[dealForHero(hero, opts, rng)]) inside++;
    }
    // 실측(lcg(3), N=6000): 안쪽 폴드 9.4% — 경계·혼합·비폴드 90.6%. 제목의 '90% 이상'과 같은 문턱으로 단언합니다.
    expect(inside / N).toBeGreaterThan(0.07);
    expect(inside / N).toBeLessThan(0.1);
  });
});

describe('도달 가능한 스텝만 낸다 (리뷰: 뒤 종류만 켠 딜)', () => {
  /**
   * 앞 스텝을 끄고 뒤 종류만 켜면(vs_4bet 만, vs_5bet 만 …) 딜러와 buildSteps 가 앞 차트를 비중으로 보고 이어서,
   * 3벳 25% 칸 같은 도달 불가 칸을 냈습니다(vs_4bet 만 7%, vs_5bet 만 25%). 리빌은 그 칸을 점선으로 그리고 캡슐과 다른
   * 문장을 보여 줍니다. 이제 1순위로만 잇고(isReachable 과 같은 규칙), pruneSteps 가 남은 것을 한 번 더 걸러냅니다.
   */
  const KINDS: ScenarioKind[][] = [['vs_4bet'], ['vs_5bet'], ['vs_3bet'], ['cold_4bet'], DEFAULT_SETTINGS.kinds];
  for (const kinds of KINDS) {
    it(`kinds = [${kinds.join(', ')}]: 3,000 손 동안 낸 스텝이 전부 isReachable`, () => {
      const rng = lcg(11);
      let steps = 0;
      for (let i = 0; i < 3000; i++) {
        const seq = nextHandSequence({ ...DEFAULT_SESSION_OPTIONS, kinds }, rng);
        for (const st of seq.steps) {
          steps++;
          expect(isReachable(st.scenario, st.hand).ok, `${st.scenario.kind} ${st.scenario.hero} ${st.scenario.villain ?? ''} ${st.hand}`).toBe(true);
          expect(kinds).toContain(st.scenario.kind);
        }
      }
      expect(steps).toBeGreaterThanOrEqual(3000);
    });
  }

  it('pruneSteps 는 도달 불가 스텝을 빼고 번호를 다시 매긴다', () => {
    // 0.25 만 3벳하는 칸의 4벳 대응 — 1순위가 3벳이 아니라 도달 불가입니다.
    const cells = getChartCells({ kind: 'vs_open', hero: 'BB', villain: 'BTN' });
    const hand = ALL_HANDS.find((h) => primaryAction(cells[h]) !== 'threebet' && (cells[h]?.threebet ?? 0) > 0)!;
    const raw = [stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, hand), stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, hand)];
    expect(isReachable(raw[1].scenario, hand).ok).toBe(false);
    const out = pruneSteps(raw);
    expect(out.map((s) => s.scenario.kind)).toEqual(['vs_open']);
    expect(out[0]).toMatchObject({ index: 0, total: 1 });
  });
});

describe('pruneSteps — 줄기 구조는 그대로, 빼기만', () => {
  it('모든 답이 폴드·체크인 손패는 한 장만, 경계 스텝을 먼저 고른다', () => {
    const opts = { ...DEFAULT_SESSION_OPTIONS, kinds: DEFAULT_SETTINGS.kinds };
    let seen = 0;
    for (const hero of POSITIONS) {
      for (const hand of ALL_HANDS) {
        const raw = buildSteps(hero, hand, opts, lcg(1));
        if (raw.length < 2 || !raw.every((s) => passive(s.answer))) continue;
        seen++;
        const out = pruneSteps(raw);
        expect(out, `${hero} ${hand}`).toHaveLength(1);
        expect(out[0]).toMatchObject({ index: 0, total: 1 });
        const edge = raw.find((s) => onEdge(s.cells, s.hand) && fullMix(s.mix)[0].weight >= 0.6);
        expect(out[0].scenario, `${hero} ${hand}`).toEqual((edge ?? raw[0]).scenario);
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('들어가는 답이 하나라도 있으면 뒤 스텝(3벳에 폴드 등)은 남기고, 안쪽 폴드인 뿌리 스텝만 뺀다', () => {
    const opts = { ...DEFAULT_SESSION_OPTIONS, kinds: DEFAULT_SETTINGS.kinds };
    const roots = new Set<ScenarioKind>(['rfi', 'vs_open', 'vs_limp', 'cold_4bet']);
    let dropped = 0;
    for (const hero of POSITIONS) {
      for (const hand of ALL_HANDS) {
        const raw = buildSteps(hero, hand, opts, lcg(2));
        if (raw.every((s) => passive(s.answer))) continue;
        const out = pruneSteps(raw);
        const kept = new Set(out.map((s) => s.scenario.kind + (s.scenario.villain ?? '')));
        for (const s of raw) {
          const [r, c] = rc(s.hand);
          const drop = roots.has(s.scenario.kind) && cellDealWeight(s.cells, r, c) === 0;
          expect(kept.has(s.scenario.kind + (s.scenario.villain ?? '')), `${hero} ${hand} ${s.scenario.kind}`).toBe(!drop);
          if (drop) dropped++;
        }
        // 남은 스텝의 순서는 buildSteps 그대로, 번호는 다시 매깁니다.
        expect(out.map((s) => s.scenario)).toEqual(raw.filter((s) => out.some((o) => o.scenario === s.scenario)).map((s) => s.scenario));
        out.forEach((s, i) => expect(s).toMatchObject({ index: i, total: out.length }));
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('한 장짜리는 그대로 돌려준다', () => {
    const one = [stepFor({ kind: 'rfi', hero: 'UTG' }, '72o')];
    expect(pruneSteps(one)).toBe(one);
  });
});

describe('첫 세션 출제 시뮬레이션 (학습효과 보고서 §3-9)', () => {
  beforeEach(() => resetSrs());

  it('N=2000 첫 세션: 폴드·체크 정답이 56%에서 크게 줄고, 경계 칸이 대부분을 차지한다', () => {
    const rng = lcg(12345);
    const N = 2000;
    let items = 0;
    let foldCheck = 0;
    let edge = 0;
    let interiorPassive = 0;
    let chains = 0;
    let passiveChains = 0;
    const heroes = new Set<Pos>();
    for (let i = 0; i < N; i++) {
      const q = buildQueue({
        size: 20,
        deck: 'all',
        positions: [...POSITIONS],
        kinds: DEFAULT_SETTINGS.kinds,
        mode: 'train',
        interestingBias: DEFAULT_SETTINGS.interestingBias,
        activeDays: 0,
        now: 1_700_000_000_000 + i * 1000,
        rng,
      });
      const byChain = new Map<number, Action[]>();
      for (const it of q.items) {
        items++;
        heroes.add(it.step.scenario.hero);
        const p = passive(it.step.answer);
        if (p) foldCheck++;
        const e = onEdge(it.step.cells, it.step.hand);
        if (e) edge++;
        else if (p) interiorPassive++;
        if (it.chainId !== undefined) byChain.set(it.chainId, [...(byChain.get(it.chainId) ?? []), it.step.answer]);
      }
      for (const answers of byChain.values()) {
        chains++;
        if (answers.every(passive)) passiveChains++;
      }
    }
    // 바꾸기 전(균등 40%): 폴드·체크 55.2% · 경계 44.2% · 안쪽 폴드·체크 38.5% · 전부 폴드인 체인 28.7%.
    // 바꾼 뒤:             폴드·체크 38.1% · 경계 64.2% · 안쪽 폴드·체크 12.4% · 전부 폴드인 체인 0%.
    expect(items / N).toBeGreaterThan(9.5);
    expect(foldCheck / items).toBeLessThan(0.43);
    expect(edge / items).toBeGreaterThan(0.58);
    expect(interiorPassive / items).toBeLessThan(0.16);
    expect(passiveChains).toBe(0);
    expect(chains).toBeGreaterThan(N);
    expect(heroes.size).toBe(POSITIONS.length);
  });

  it('같은 시드면 같은 출제 — 순수하고 시드 난수로 재현된다', () => {
    const run = () => {
      const rng = lcg(99);
      return Array.from({ length: 50 }, () => {
        const seq = nextHandSequence({ ...DEFAULT_SESSION_OPTIONS, kinds: DEFAULT_SETTINGS.kinds }, rng);
        return `${seq.hero}:${seq.hand}:${seq.steps.map((s) => s.scenario.kind).join(',')}`;
      });
    };
    expect(run()).toEqual(run());
  });
});
