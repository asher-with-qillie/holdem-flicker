/**
 * 성향 축의 귀무 편향 검증. docs/COACH_SPEC.md §1 이 약속한 "귀무값 0"을 합성 플레이어로 증명합니다.
 *
 * 이 파일의 존재 이유는 하나입니다 — 출제 풀이 폴드 쪽으로 쏠려 있어도 성향이 없는 사람에게
 * "루즈합니다"가 나오면 안 됩니다. 그래서 축을 눈으로 확인하는 대신 합성 플레이어를 돌려
 *   1) 중립 플레이어의 t 평균이 0 근처인지 (귀무 편향)
 *   2) 성향을 심어 준 플레이어에게서 그 축만 움직이는지 (감도 + 직교성)
 *   3) 폴드 쪽으로 크게 쏠린 문제 구성이 진단을 오염시키지 않는지 (설계 전체의 존재 이유)
 * 를 숫자로 못 박습니다. Math.random 은 쓰지 않습니다 — 실패가 재현되지 않으면 테스트가 아닙니다.
 */
import { describe, expect, it } from 'vitest';

import { SCENARIO_ACTIONS, type Action, type Pos, type ScenarioKind } from '../../../poker/types';
import { computeAxes } from '../axes';
import type { AxisId, AxisView, CoachMistake, SeenRow } from '../types';

/* ------------------------------------------------------------------ */
/* 시드 고정 PRNG (mulberry32)                                         */
/* ------------------------------------------------------------------ */

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 합성 출제 풀                                                        */
/* ------------------------------------------------------------------ */

/** 한 (kind, hero) 칸과 그 칸의 폴드-정답 비중. 실제 앱처럼 칸마다 난이도가 다릅니다. */
interface Cell {
  kind: ScenarioKind;
  hero: Pos;
  foldShare: number;
}

/**
 * 좌석·상황별로 폴드-정답 비중을 0.36~0.82 로 벌려 놓았습니다. 기준선 보정이 없으면
 * 이 불균형이 그대로 '성향'으로 새어 나오기 때문에, 편향 검증은 균일한 풀로 하면 의미가 없습니다.
 */
const CELLS: Cell[] = [
  { kind: 'rfi', hero: 'UTG', foldShare: 0.82 },
  { kind: 'rfi', hero: 'HJ', foldShare: 0.77 },
  { kind: 'rfi', hero: 'CO', foldShare: 0.68 },
  { kind: 'rfi', hero: 'BTN', foldShare: 0.52 },
  { kind: 'rfi', hero: 'SB', foldShare: 0.59 },
  { kind: 'vs_open', hero: 'HJ', foldShare: 0.74 },
  { kind: 'vs_open', hero: 'CO', foldShare: 0.7 },
  { kind: 'vs_open', hero: 'BTN', foldShare: 0.62 },
  { kind: 'vs_open', hero: 'SB', foldShare: 0.66 },
  { kind: 'vs_open', hero: 'BB', foldShare: 0.36 },
  { kind: 'vs_3bet', hero: 'UTG', foldShare: 0.55 },
  { kind: 'vs_3bet', hero: 'HJ', foldShare: 0.58 },
  { kind: 'vs_3bet', hero: 'CO', foldShare: 0.6 },
  { kind: 'vs_3bet', hero: 'BTN', foldShare: 0.57 },
  { kind: 'vs_4bet', hero: 'HJ', foldShare: 0.64 },
  { kind: 'vs_4bet', hero: 'CO', foldShare: 0.61 },
  { kind: 'vs_4bet', hero: 'BTN', foldShare: 0.58 },
  { kind: 'vs_5bet', hero: 'UTG', foldShare: 0.7 },
  { kind: 'vs_5bet', hero: 'CO', foldShare: 0.66 },
];

/** 축은 손패를 보지 않지만, 실수마다 다른 패가 들어가는 편이 실제 재료에 가깝습니다. */
const HANDS = ['AJo', 'KTs', 'A8o', '76s', 'QJo', '99', 'K9s', 'T8s', 'A5s', '44'];

/**
 * 합성 플레이어. 두 손잡이가 서로 다른 축을 건드리도록 일부러 분리했습니다.
 *  - `errFold` / `errEnter` : **어디서** 틀리는가 → entry(그리고 seat·pressure)를 움직입니다.
 *  - `upBias`               : 틀렸을 때 **어느 쪽으로** 틀리는가 → aggression 만 움직입니다.
 * 그래서 타이트·루즈 플레이어는 upBias 0.5 로 두고도 entry 만 움직여야 하고,
 * 소극·공격 플레이어는 두 오류율이 같아 entry 가 0 에 머물러야 합니다. 그게 축의 직교성입니다.
 */
interface Player {
  errFold: number;
  errEnter: number;
  upBias: number;
}

const NEUTRAL: Player = { errFold: 0.3, errEnter: 0.3, upBias: 0.5 };
const PASSIVE: Player = { errFold: 0.3, errEnter: 0.3, upBias: 0.15 };
const AGGRO: Player = { errFold: 0.3, errEnter: 0.3, upBias: 0.85 };
const TIGHT: Player = { errFold: 0.08, errEnter: 0.45, upBias: 0.5 };
const LOOSE: Player = { errFold: 0.45, errEnter: 0.08, upBias: 0.5 };

interface Run {
  m: CoachMistake[];
  seen: SeenRow[];
}

/**
 * 카드 한 장. 앱과 같은 모양이어야 시뮬레이션이 의미가 있습니다 — 카드키 하나의 정답은 차트가
 * 정해 놓아 **고정**이고, 매 시행 새로 뽑히는 값이 아닙니다.
 */
interface Card {
  cell: Cell;
  hand: string;
  answer: Action;
  key: string;
}

function buildDeck(rng: () => number, cells: Cell[]): Card[] {
  const deck: Card[] = [];
  for (const cell of cells) {
    const acts = SCENARIO_ACTIONS[cell.kind];
    for (const hand of HANDS) {
      const isFold = rng() < cell.foldShare;
      const answer: Action = isFold ? 'fold' : acts[1 + Math.floor(rng() * (acts.length - 1))];
      deck.push({ cell, hand, answer, key: `${cell.kind}:${cell.hero}|${hand}` });
    }
  }
  return deck;
}

/** srs 의 되풀이를 흉내 냅니다: 방금 틀린 카드는 곧 다시 나옵니다(due = now + 10분, '내 약점' 덱). */
const REPEAT_BOOST = 6;

/**
 * 합성 세션. 앱의 모집단을 그대로 흉내 냅니다.
 *  - 카드마다 정답이 고정이고, 같은 카드가 여러 번 나옵니다.
 *  - 틀린 카드는 가중치가 올라가 더 자주 다시 나옵니다 — 그래서 실수는 서로 독립이 아닙니다.
 * 이 되풀이를 빼고 시뮬레이션하면 axes.ts 의 설계효과 보정이 필요한지 아닌지를 시험할 수 없습니다.
 */
function simulate(rng: () => number, cells: Cell[], player: Player, trials: number): Run {
  const deck = buildDeck(rng, cells);
  const weight = new Map<string, number>(deck.map((c) => [c.key, 1]));
  const seen = new Map<string, SeenRow>();
  const m: CoachMistake[] = [];

  const draw = (): Card => {
    let total = 0;
    for (const c of deck) total += weight.get(c.key) ?? 1;
    let r = rng() * total;
    for (const c of deck) {
      r -= weight.get(c.key) ?? 1;
      if (r < 0) return c;
    }
    return deck[deck.length - 1];
  };

  for (let i = 0; i < trials; i += 1) {
    const card = draw();
    const acts = SCENARIO_ACTIONS[card.cell.kind];
    const isFold = card.answer === 'fold';

    // seen 은 답을 실제로 낸 횟수의 집계입니다 — (kind, hero, answer) 한 줄에 몰아 셉니다.
    const sk = `${card.cell.kind}|${card.cell.hero}|${card.answer}`;
    const row = seen.get(sk);
    if (row) row.weight += 1;
    else seen.set(sk, { kind: card.cell.kind, hero: card.cell.hero, answer: card.answer, weight: 1 });

    if (rng() >= (isFold ? player.errFold : player.errEnter)) {
      weight.set(card.key, 1);
      continue;
    }
    weight.set(card.key, REPEAT_BOOST);

    // SCENARIO_ACTIONS 는 공격성 오름차순이라 마지막 오답이 '더 공격적인 쪽'입니다.
    const wrongs = acts.filter((a) => a !== card.answer);
    const chosen = wrongs.length === 1 ? wrongs[0] : wrongs[rng() < player.upBias ? wrongs.length - 1 : 0];

    m.push({
      hand: card.hand,
      handClass: 'junk',
      kind: card.cell.kind,
      hero: card.cell.hero,
      ip: false,
      answer: card.answer,
      chosen,
      daysAgo: 0,
      src: 'quiz',
      key: card.key,
    });
  }

  return { m, seen: [...seen.values()] };
}

function axisOf(axes: AxisView[], id: AxisId): AxisView {
  const found = axes.find((a) => a.id === id);
  if (!found) throw new Error(`축이 사라졌습니다: ${id}`);
  return found;
}

/** 축별 t 의 평균. 표본 미달 런이 섞이면 평균이 거짓말을 하므로 해금 여부도 같이 돌려줍니다. */
function meanT(cells: Cell[], player: Player, runs: number, trials: number, seed: number) {
  const sum: Record<AxisId, number> = { aggression: 0, entry: 0, seat: 0, pressure: 0 };
  let allUnlocked = true;
  let confidentRuns = 0;

  for (let r = 0; r < runs; r += 1) {
    const { m, seen } = simulate(makeRng(seed + r), cells, player, trials);
    const axes = computeAxes(m, seen);
    for (const a of axes) {
      if (!a.unlocked || a.t === null) {
        allUnlocked = false;
        continue;
      }
      sum[a.id] += a.t;
      if (a.level === 'confident') confidentRuns += 1;
    }
  }

  const mean: Record<AxisId, number> = {
    aggression: sum.aggression / runs,
    entry: sum.entry / runs,
    seat: sum.seat / runs,
    pressure: sum.pressure / runs,
  };
  return { mean, allUnlocked, confidentRuns };
}

/* ------------------------------------------------------------------ */

describe('computeAxes — 형태 계약', () => {
  it('축은 언제나 네 개, 언제나 같은 순서다', () => {
    const empty = computeAxes([], []);
    expect(empty.map((a) => a.id)).toEqual(['aggression', 'entry', 'seat', 'pressure']);

    const { m, seen } = simulate(makeRng(7), CELLS, NEUTRAL, 900);
    expect(computeAxes(m, seen).map((a) => a.id)).toEqual(['aggression', 'entry', 'seat', 'pressure']);
  });

  it('headline 은 confident 인 축 중 |z| 최대 하나에만 붙는다', () => {
    const { m, seen } = simulate(makeRng(11), CELLS, AGGRO, 900);
    const axes = computeAxes(m, seen);
    const flagged = axes.filter((a) => a.headline);
    expect(flagged.length).toBeLessThanOrEqual(1);

    const confident = axes.filter((a) => a.level === 'confident');
    if (confident.length === 0) {
      expect(flagged).toHaveLength(0);
    } else {
      expect(flagged).toHaveLength(1);
      const top = Math.max(...confident.map((a) => Math.abs(a.z ?? 0)));
      expect(Math.abs(flagged[0].z ?? 0)).toBeCloseTo(top, 10);
      expect(flagged[0].level).toBe('confident');
    }
  });

  it('중립 플레이어가 단정(headline)을 받는 비율은 낮게 묶여 있다', () => {
    // |z| ≥ 2.2 를 쓰는 이상 우연한 단정은 0 이 될 수 없습니다. 축 네 개를 따로 단정하게 두면
    // 그 확률이 네 배가 되므로, headline 을 화면당 하나로 묶어 상한을 고정한 것입니다.
    const runs = 200;
    let headlined = 0;
    for (let r = 0; r < runs; r += 1) {
      const { m, seen } = simulate(makeRng(400 + r), CELLS, NEUTRAL, 900);
      const flagged = computeAxes(m, seen).filter((a) => a.headline);
      expect(flagged.length).toBeLessThanOrEqual(1);
      headlined += flagged.length;
    }
    expect(headlined / runs).toBeLessThan(0.06);
  });
});

describe('귀무 편향 — 중립 플레이어', () => {
  it('200회 × 900문제에서 네 축의 t 평균이 모두 |0.05| 이내다', () => {
    const { mean, allUnlocked, confidentRuns } = meanT(CELLS, NEUTRAL, 200, 900, 1000);

    // 모든 런에서 네 축이 다 열려야 평균이 의미를 가집니다.
    expect(allUnlocked).toBe(true);

    expect(Math.abs(mean.aggression)).toBeLessThan(0.05);
    expect(Math.abs(mean.entry)).toBeLessThan(0.05);
    expect(Math.abs(mean.seat)).toBeLessThan(0.05);
    expect(Math.abs(mean.pressure)).toBeLessThan(0.05);

    // 800개(200런 × 4축)의 축 중 'confident' 로 단정되는 것이 거의 없어야 합니다.
    expect(confidentRuns).toBeLessThan(20);
  });
});

describe('감도 — aggression', () => {
  it('소극 플레이어는 t 가 뚜렷한 음수이고 z 가 −2.2 아래다', () => {
    const { m, seen } = simulate(makeRng(2001), CELLS, PASSIVE, 900);
    const a = axisOf(computeAxes(m, seen), 'aggression');

    expect(a.unlocked).toBe(true);
    expect(a.t).toBeLessThan(-0.4);
    expect(a.z).toBeLessThan(-2.2);
    expect(a.level).toBe('confident');
    expect(a.pole).toBe('콜·폴드 쪽으로 샌다');
  });

  it('공격 플레이어는 t 가 뚜렷한 양수이고 z 가 +2.2 위다', () => {
    const { m, seen } = simulate(makeRng(2002), CELLS, AGGRO, 900);
    const a = axisOf(computeAxes(m, seen), 'aggression');

    expect(a.unlocked).toBe(true);
    expect(a.t).toBeGreaterThan(0.4);
    expect(a.z).toBeGreaterThan(2.2);
    expect(a.level).toBe('confident');
    expect(a.pole).toBe('레이즈·3벳 쪽으로 샌다');
  });

  it('소극·공격 플레이어는 entry 를 움직이지 않는다 (축이 직교한다)', () => {
    for (const [seed, player] of [
      [2101, PASSIVE],
      [2102, AGGRO],
    ] as const) {
      const { mean } = meanT(CELLS, player, 30, 900, seed);
      expect(Math.abs(mean.entry)).toBeLessThan(0.08);
    }
  });
});

describe('감도 — entry', () => {
  it('타이트 플레이어는 entry 가 음수이고 aggression 은 0 근처에 머문다', () => {
    const { m, seen } = simulate(makeRng(3001), CELLS, TIGHT, 900);
    const axes = computeAxes(m, seen);
    const entry = axisOf(axes, 'entry');
    const aggression = axisOf(axes, 'aggression');

    expect(entry.unlocked).toBe(true);
    expect(entry.t).toBeLessThan(-0.3);
    expect(entry.z).toBeLessThan(-2.2);
    expect(entry.level).toBe('confident');
    expect(entry.pole).toBe('접어야 할 자리는 잘 접는다');

    expect(Math.abs(aggression.t ?? 1)).toBeLessThan(0.25);
    expect(aggression.level).not.toBe('confident');
  });

  it('루즈 플레이어는 entry 가 양수이고 aggression 은 0 근처에 머문다', () => {
    // 한 판이 아니라 여러 판의 평균으로 봅니다 — 씨앗 하나에 임계를 맞추면 그 씨앗을 통과하는
    // 테스트가 되지, 축이 루즈를 잡는다는 주장이 되지 않습니다.
    let tSum = 0;
    let confident = 0;
    const runs = 20;
    for (let r = 0; r < runs; r += 1) {
      const { m, seen } = simulate(makeRng(3002 + r), CELLS, LOOSE, 900);
      const axes = computeAxes(m, seen);
      const entry = axisOf(axes, 'entry');
      const aggression = axisOf(axes, 'aggression');

      expect(entry.unlocked).toBe(true);
      expect(entry.t).toBeGreaterThan(0);
      expect(entry.pole).toBe('접어야 할 자리에 들어간다');
      expect(Math.abs(aggression.t ?? 1)).toBeLessThan(0.25);

      tSum += entry.t ?? 0;
      if (entry.level === 'confident') confident += 1;
    }
    expect(tSum / runs).toBeGreaterThan(0.3);
    // 되풀이 보정 뒤에도 루즈는 대부분의 판에서 단정으로 잡혀야 합니다.
    expect(confident / runs).toBeGreaterThan(0.7);
  });

  it('타이트·루즈 플레이어의 aggression 은 평균적으로도 0 이다', () => {
    for (const [seed, player] of [
      [3101, TIGHT],
      [3102, LOOSE],
    ] as const) {
      const { mean } = meanT(CELLS, player, 30, 900, seed);
      expect(Math.abs(mean.aggression)).toBeLessThan(0.08);
    }
  });
});

describe('표본 미달', () => {
  it('실수가 거의 없으면 네 축 모두 잠긴 채로 배열에 남는다', () => {
    const { m, seen } = simulate(makeRng(4001), CELLS, NEUTRAL, 20);
    const axes = computeAxes(m, seen);

    expect(axes).toHaveLength(4);
    for (const a of axes) {
      expect(a.unlocked).toBe(false);
      expect(a.level).toBe('locked');
      expect(a.need).toBeGreaterThan(0);
      expect(a.t).toBeNull();
      expect(a.z).toBeNull();
      expect(a.pole).toBeNull();
      expect(a.headline).toBe(false);
      // 잠겨 있어도 화면은 이 줄을 그립니다 — 라벨은 항상 채워져 있어야 합니다.
      expect(a.koLabel.length).toBeGreaterThan(0);
      expect(a.poles[0].length).toBeGreaterThan(0);
      expect(a.poles[1].length).toBeGreaterThan(0);
    }
  });

  it('재료가 아예 없어도 네 줄을 돌려주고 need 가 남은 수를 말한다', () => {
    const axes = computeAxes([], []);
    expect(axisOf(axes, 'aggression').need).toBe(12);
    expect(axisOf(axes, 'entry').need).toBe(20);
    // seat·pressure 는 그룹 두 개가 각각 12 를 채워야 열립니다.
    expect(axisOf(axes, 'seat').need).toBe(24);
    expect(axisOf(axes, 'pressure').need).toBe(24);
    expect(axes.every((a) => a.sample === 0)).toBe(true);
  });

  it('축별 표본으로 판정한다 — vs_open 만 푼 사람은 aggression 만 열린다', () => {
    const seen: SeenRow[] = [
      { kind: 'vs_open', hero: 'BB', answer: 'fold', weight: 60 },
      { kind: 'vs_open', hero: 'BB', answer: 'call', weight: 40 },
    ];
    const m: CoachMistake[] = [];
    for (let i = 0; i < 15; i += 1) {
      m.push({
        hand: HANDS[i % HANDS.length],
        handClass: 'junk',
        kind: 'vs_open',
        hero: 'BB',
        ip: false,
        answer: i % 2 === 0 ? 'fold' : 'call',
        chosen: i % 2 === 0 ? 'call' : 'fold',
        daysAgo: 0,
        src: 'quiz',
        key: `vs_open:BB|${HANDS[i % HANDS.length]}`,
      });
    }
    const axes = computeAxes(m, seen);

    expect(axisOf(axes, 'aggression').unlocked).toBe(true);
    expect(axisOf(axes, 'aggression').sample).toBe(15);
    expect(axisOf(axes, 'entry').unlocked).toBe(false);
    expect(axisOf(axes, 'entry').need).toBe(5);
    // BB 는 seat 축에서 완전히 제외됩니다 — 실수 15개를 내도 이 축은 안 열립니다.
    expect(axisOf(axes, 'seat').unlocked).toBe(false);
    expect(axisOf(axes, 'seat').sample).toBe(0);
    // pressure 는 OPEN 쪽만 찼습니다.
    expect(axisOf(axes, 'pressure').unlocked).toBe(false);
    expect(axisOf(axes, 'pressure').need).toBe(12);
  });
});

describe('폴드 쪽으로 쏠린 출제 풀 — 이 설계 전체의 존재 이유', () => {
  const SKEWED: Cell[] = CELLS.map((c) => ({ ...c, foldShare: 0.85 }));

  it("중립 플레이어를 '루즈'로 진단하지 않는다", () => {
    let qSum = 0;
    let tSum = 0;
    let looseVerdicts = 0;
    const runs = 100;

    for (let r = 0; r < runs; r += 1) {
      const { m, seen } = simulate(makeRng(5000 + r), SKEWED, NEUTRAL, 900);
      const entry = axisOf(computeAxes(m, seen), 'entry');

      expect(entry.unlocked).toBe(true);
      // 보정 없는 순진한 지표: 실수 중 '정답이 폴드였던' 비중. 여기서는 구조적으로 0.85 근처입니다.
      qSum += m.filter((x) => x.answer === 'fold').length / m.length;
      tSum += entry.t ?? 0;
      if (entry.level === 'confident' && (entry.t ?? 0) > 0) looseVerdicts += 1;
    }

    // 순진한 지표는 "실수의 85%가 폴드 자리 → 이 사람은 루즈하다"고 말합니다. 그게 거짓말입니다.
    expect(qSum / runs).toBeGreaterThan(0.8);
    // 기준선을 깐 t 는 같은 데이터에서 0 에 머뭅니다.
    expect(Math.abs(tSum / runs)).toBeLessThan(0.05);
    // 그리고 단 한 번도 '루즈'로 단정되지 않습니다.
    expect(looseVerdicts).toBe(0);
  });

  it('쏠린 풀에서도 seat·pressure 의 t 평균이 0 근처다', () => {
    const { mean } = meanT(SKEWED, NEUTRAL, 60, 900, 6000);
    expect(Math.abs(mean.seat)).toBeLessThan(0.06);
    expect(Math.abs(mean.pressure)).toBeLessThan(0.06);
  });

  it('쏠린 풀에서도 타이트 플레이어는 여전히 타이트로 잡힌다', () => {
    const { m, seen } = simulate(makeRng(7001), SKEWED, TIGHT, 900);
    const entry = axisOf(computeAxes(m, seen), 'entry');
    expect(entry.t).toBeLessThan(-0.3);
    expect(entry.pole).toBe('접어야 할 자리는 잘 접는다');
  });
});

describe('되풀이되는 실수 — 설계효과 보정', () => {
  it('같은 카드를 여러 번 틀려도 단정이 쏟아지지 않는다', () => {
    // srs 는 틀린 카드를 10분 뒤로 되돌리고 '내 약점' 덱은 그 카드들만 모읍니다. 그래서 실수는
    // 서로 독립이 아닙니다. 보정을 빼면 같은 이야기를 세 번 센 것이 서로 다른 증거 세 개가 되어,
    // 성향이 전혀 없는 사람의 1/3이 '뚜렷하다'는 말을 듣습니다. 이 테스트가 그걸 막습니다.
    const runs = 120;
    let confident = 0;
    let repeatRatio = 0;
    for (let r = 0; r < runs; r += 1) {
      const { m, seen } = simulate(makeRng(9100 + r), CELLS, NEUTRAL, 900);
      repeatRatio += m.length / new Set(m.map((x) => x.key)).size;
      confident += computeAxes(m, seen).filter((a) => a.level === 'confident').length;
    }
    // 시뮬레이터가 실제로 되풀이를 만들어 내는지부터 확인합니다 — 되풀이가 없으면 이 테스트는 공회전입니다.
    expect(repeatRatio / runs).toBeGreaterThan(1.5);
    // 축 네 개 × 120판 = 480줄 중 우연한 단정은 5%(24줄) 아래여야 합니다.
    expect(confident / (runs * 4)).toBeLessThan(0.05);
  });

  it('보정은 되풀이가 없을 때 아무 일도 하지 않는다', () => {
    // 카드마다 한 번씩만 나오면 되풀이 비율이 1 이라 보정 계수도 1 입니다.
    const { m, seen } = simulate(makeRng(9500), CELLS, AGGRO, 900);
    const unique = new Map<string, CoachMistake>();
    for (const x of m) if (!unique.has(x.key)) unique.set(x.key, x);
    const once = [...unique.values()];
    expect(once.length).toBeLessThan(m.length);

    const axes = computeAxes(once, seen);
    const aggression = axisOf(axes, 'aggression');
    expect(aggression.unlocked).toBe(true);
    // 되풀이가 없으니 z 는 부호 검정 그대로여야 합니다.
    const used = once.filter((x) => SCENARIO_ACTIONS[x.kind].length === 3);
    const s = used.reduce((acc, x) => {
      const acts = SCENARIO_ACTIONS[x.kind];
      const wrongs = acts.filter((a) => a !== x.answer);
      return acc + (x.chosen === wrongs[wrongs.length - 1] ? 1 : -1);
    }, 0);
    expect(aggression.z).toBeCloseTo(s / Math.sqrt(used.length), 6);
  });
});
