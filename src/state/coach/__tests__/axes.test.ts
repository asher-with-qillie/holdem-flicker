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

/* ------------------------------------------------------------------ */
/* 2차 검수 회귀                                                       */
/* ------------------------------------------------------------------ */

/** 실수 n개를 한 칸에 쌓습니다. 카드키를 손패마다 다르게 주어 설계효과 보정이 1 로 남게 합니다. */
function pile(n: number, spec: { kind: ScenarioKind; hero: Pos; answer: Action; chosen: Action }): CoachMistake[] {
  const out: CoachMistake[] = [];
  for (let i = 0; i < n; i += 1) {
    const hand = `${HANDS[i % HANDS.length]}#${Math.floor(i / HANDS.length)}`;
    out.push({
      hand,
      handClass: 'junk',
      kind: spec.kind,
      hero: spec.hero,
      ip: false,
      answer: spec.answer,
      chosen: spec.chosen,
      daysAgo: 0,
      src: 'quiz',
      key: `${spec.kind}:${spec.hero}|${hand}`,
    });
  }
  return out;
}

/** 기준선 한 줄. weight 가 'seen' 의 Σ 이자 기준선 표본 수입니다. */
function seenRow(kind: ScenarioKind, hero: Pos, answer: Action, weight: number): SeenRow {
  return { kind, hero, answer, weight };
}

describe("잠긴 축의 '실수 N개 더' 는 어디서 필요한지를 같이 말한다", () => {
  it('BB 수비만 푸는 사람은 seat 실수를 아무리 쌓아도 need 가 안 줄고, 화면은 그 이유를 받는다', () => {
    // seat 은 UTG·HJ / CO·BTN 실수만 씁니다. BB 만 푸는 사람에게 "실수 24개 더"만 적으면
    // 60개를 더 틀려도 1 도 줄지 않는 숫자를 보여 주는 것입니다 — 셀 수 없는 조건을 센 척하는 것.
    const m = pile(60, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' });
    const seen = [seenRow('vs_open', 'BB', 'fold', 300), seenRow('vs_open', 'BB', 'call', 300)];
    const seat = axisOf(computeAxes(m, seen), 'seat');

    expect(seat.unlocked).toBe(false);
    expect(seat.need).toBe(24);
    expect(seat.needWhere).toBe('앞자리·뒷자리');
  });

  it('한쪽 그룹만 모자라면 그 쪽만 짚는다', () => {
    // 앞자리는 다 채웠고 뒷자리만 비었으면 '앞자리·뒷자리' 가 아니라 '뒷자리' 여야 합니다.
    const m = pile(20, { kind: 'rfi', hero: 'UTG', answer: 'fold', chosen: 'raise' });
    const seen = [
      seenRow('rfi', 'UTG', 'fold', 60),
      seenRow('rfi', 'UTG', 'raise', 60),
      seenRow('rfi', 'BTN', 'fold', 60),
      seenRow('rfi', 'BTN', 'raise', 60),
    ];
    const seat = axisOf(computeAxes(m, seen), 'seat');

    expect(seat.unlocked).toBe(false);
    expect(seat.need).toBe(12);
    expect(seat.needWhere).toBe('뒷자리');
  });

  it('pressure 는 큰 팟 쪽이 비었다고 말한다', () => {
    const m = pile(30, { kind: 'vs_open', hero: 'CO', answer: 'fold', chosen: 'call' });
    const seen = [
      seenRow('vs_open', 'CO', 'fold', 200),
      seenRow('vs_open', 'CO', 'call', 200),
      seenRow('vs_3bet', 'CO', 'fold', 100),
      seenRow('vs_3bet', 'CO', 'call', 100),
    ];
    const pressure = axisOf(computeAxes(m, seen), 'pressure');

    expect(pressure.unlocked).toBe(false);
    expect(pressure.need).toBe(12);
    expect(pressure.needWhere).toBe('3벳·4벳 자리');
  });

  it('aggression 은 답이 셋인 자리 실수만 쓴다고 말하고, entry 는 전체라 말하지 않는다', () => {
    // rfi 는 오답이 하나뿐이라 부호 검정에 못 들어갑니다. rfi 만 푼 사람의 aggression need 도
    // 줄지 않는 숫자라서 같은 이유로 어디서 필요한지를 적어야 합니다.
    const m = pile(40, { kind: 'rfi', hero: 'UTG', answer: 'fold', chosen: 'raise' });
    const seen = [seenRow('rfi', 'UTG', 'fold', 200), seenRow('rfi', 'UTG', 'raise', 200)];
    const axes = computeAxes(m, seen);

    const aggression = axisOf(axes, 'aggression');
    expect(aggression.unlocked).toBe(false);
    expect(aggression.sample).toBe(0);
    expect(aggression.need).toBe(12);
    expect(aggression.needWhere).toBe('답이 셋인 자리');

    // entry 는 실수 전체를 쓰므로 좁힐 자리가 없습니다 — 없는 조건을 붙이지 않습니다.
    expect(axisOf(axes, 'entry').needWhere).toBeUndefined();
  });
});

describe('기준선 표본 하한', () => {
  it('seen 이 한 줄이면 entry 를 열지 않는다 (마커가 트랙 끝까지 가던 자리)', () => {
    // 예전에는 b 가 계산만 되면 열렸습니다. b=1 → varQ=0 → z=0 → level 'flat' 이라 색만 회색이
    // 되는데, t 는 그대로 q−b 라 마커가 극단에 붙었습니다. 사람이 읽는 건 마커 위치입니다.
    const m = pile(25, { kind: 'vs_open', hero: 'BB', answer: 'call', chosen: 'fold' });
    const entry = axisOf(computeAxes(m, [seenRow('vs_open', 'BB', 'fold', 1)]), 'entry');

    expect(entry.unlocked).toBe(false);
    expect(entry.level).toBe('locked');
    expect(entry.t).toBeNull();
    expect(entry.lockedBy).toBe('baseline');
    expect(entry.baselineTrials).toBe(1);
    expect(entry.baselineNeed).toBe(79);
    // 실수는 넉넉하므로 '실수 N개 더'가 아닙니다 — 화면이 이 숫자로 문구를 고르면 안 됩니다.
    expect(entry.need).toBe(0);
  });

  it('하한을 넘기면 그대로 열린다 (하한이 축을 영영 막지 않는다)', () => {
    const m = [
      ...pile(12, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' }),
      ...pile(8, { kind: 'vs_open', hero: 'BB', answer: 'call', chosen: 'fold' }),
    ];
    const seen = [seenRow('vs_open', 'BB', 'fold', 40), seenRow('vs_open', 'BB', 'call', 40)];
    const entry = axisOf(computeAxes(m, seen), 'entry');

    expect(entry.baselineTrials).toBe(80);
    expect(entry.baselineNeed).toBe(0);
    expect(entry.unlocked).toBe(true);
    expect(entry.lockedBy).toBeUndefined();
  });

  it('seat·pressure 는 그룹마다 따로 하한을 본다', () => {
    // 앞자리는 두껍고 뒷자리는 얇습니다. 실수는 양쪽 다 넉넉하지만 기준선이 한쪽만 서 있습니다.
    const m = [
      ...pile(20, { kind: 'rfi', hero: 'UTG', answer: 'fold', chosen: 'raise' }),
      ...pile(20, { kind: 'rfi', hero: 'BTN', answer: 'fold', chosen: 'raise' }),
    ];
    const seen = [
      seenRow('rfi', 'UTG', 'fold', 100),
      seenRow('rfi', 'UTG', 'raise', 100),
      seenRow('rfi', 'BTN', 'fold', 10),
      seenRow('rfi', 'BTN', 'raise', 10),
    ];
    const seat = axisOf(computeAxes(m, seen), 'seat');

    expect(seat.unlocked).toBe(false);
    expect(seat.lockedBy).toBe('baseline');
    expect(seat.need).toBe(0);
    // 잠금을 쥐고 있는 건 뒷자리 20 회입니다. 진행도는 그 쪽 숫자여야 말이 됩니다.
    expect(seat.baselineTrials).toBe(20);
    expect(seat.baselineNeed).toBe(28);
    expect(seat.needWhere).toBe('뒷자리');
  });
});

describe("신호가 없으면(flat) 마커를 가운데로 눕힌다", () => {
  it('flat 인 축의 t 는 0 이고, 잰 값은 tRaw 에 남는다', () => {
    // b=0.5, q=0.6 → 편차 +0.1, t 0.2, z 0.894. 기울었다고 말할 만큼은 아닙니다.
    const m = [
      ...pile(12, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' }),
      ...pile(8, { kind: 'vs_open', hero: 'BB', answer: 'call', chosen: 'fold' }),
    ];
    const seen = [seenRow('vs_open', 'BB', 'fold', 40), seenRow('vs_open', 'BB', 'call', 40)];
    const entry = axisOf(computeAxes(m, seen), 'entry');

    expect(entry.level).toBe('flat');
    expect(entry.t).toBe(0);
    expect(entry.tRaw).toBeCloseTo(0.2, 10);
  });

  it('기준선이 한쪽으로만 몰려 신호가 0 이어도 마커가 극단으로 가지 않는다', () => {
    // b=1 이면 varQ=0 이라 z 는 0 입니다. 그런데 t 는 (q−b)/max(b,1−b) = −0.4 로 왼쪽 끝 가까이 갑니다.
    const m = [
      ...pile(12, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' }),
      ...pile(8, { kind: 'vs_open', hero: 'BB', answer: 'call', chosen: 'fold' }),
    ];
    const entry = axisOf(computeAxes(m, [seenRow('vs_open', 'BB', 'fold', 80)]), 'entry');

    expect(entry.unlocked).toBe(true);
    expect(entry.z).toBe(0);
    expect(entry.level).toBe('flat');
    expect(entry.tRaw).toBeCloseTo(-0.4, 10);
    expect(entry.t).toBe(0);
  });

  it('눕히기는 flat 에서만 한다 — 기운 축의 마커는 그대로다', () => {
    const { m, seen } = simulate(makeRng(2002), CELLS, AGGRO, 900);
    const a = axisOf(computeAxes(m, seen), 'aggression');
    expect(a.level).toBe('confident');
    expect(a.t).toBe(a.tRaw);
  });

  it('눕히기가 귀무 편향 검증을 대신 통과시키지 않는다', () => {
    // t 를 0 으로 눕히면 중립 플레이어의 t 평균은 저절로 0 에 가까워집니다. 그래서 잰 값(tRaw)으로도
    // 따로 못 박습니다 — 이 줄이 없으면 위의 편향 테스트들이 눕히기 덕에 통과하게 됩니다.
    const runs = 60;
    const sum: Record<AxisId, number> = { aggression: 0, entry: 0, seat: 0, pressure: 0 };
    for (let r = 0; r < runs; r += 1) {
      const { m, seen } = simulate(makeRng(9700 + r), CELLS, NEUTRAL, 900);
      for (const a of computeAxes(m, seen)) {
        expect(a.unlocked).toBe(true);
        expect(a.tRaw).not.toBeNull();
        sum[a.id] += a.tRaw ?? 0;
      }
    }
    for (const id of ['aggression', 'entry', 'seat', 'pressure'] as const) {
      expect(Math.abs(sum[id] / runs)).toBeLessThan(0.05);
    }
  });
});

describe("기준선이 '없는 것' 과 '얇은 것' 은 다른 말이다", () => {
  const m = pile(30, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' });

  it('seen 이 비면 no-baseline — 기준을 못 잡은 것이지 덜 푼 것이 아니다', () => {
    // 옛 저장 형식(13칸)에서 quizSeen·pickSeen 이 0 이던 사용자가 여기에 옵니다. srs 가
    // reps+lapses 로 어림잡아 주지만, 스와이프 평가도 없던 카드는 여전히 분모가 0 입니다.
    const axes = computeAxes(m, []);
    for (const id of ['entry', 'seat', 'pressure'] as const) {
      const a = axisOf(axes, id);
      expect(a.unlocked).toBe(false);
      expect(a.lockedBy).toBe('no-baseline');
      expect(a.baselineTrials).toBe(0);
    }
  });

  it('seen 이 얇으면 baseline — 문제를 더 풀면 잡힌다', () => {
    const thin = [seenRow('vs_open', 'BB', 'fold', 25), seenRow('vs_open', 'BB', 'call', 15)];
    const entry = axisOf(computeAxes(m, thin), 'entry');

    expect(entry.lockedBy).toBe('baseline');
    expect(entry.baselineTrials).toBe(40);
    expect(entry.baselineNeed).toBe(40);
  });

  it('기준선이 서 있고 실수만 모자라면 mistakes', () => {
    const few = pile(5, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' });
    const seen = [seenRow('vs_open', 'BB', 'fold', 60), seenRow('vs_open', 'BB', 'call', 60)];
    const entry = axisOf(computeAxes(few, seen), 'entry');

    expect(entry.lockedBy).toBe('mistakes');
    expect(entry.need).toBe(15);
    expect(entry.baselineNeed).toBe(0);
  });

  it('세 상태가 서로 구별된다 — 화면이 같은 문구를 쓰면 안 된다', () => {
    const seen = [seenRow('vs_open', 'BB', 'fold', 60), seenRow('vs_open', 'BB', 'call', 60)];
    const locks = [
      axisOf(computeAxes(m, []), 'entry').lockedBy,
      axisOf(computeAxes(m, [seenRow('vs_open', 'BB', 'fold', 10)]), 'entry').lockedBy,
      axisOf(computeAxes(pile(5, { kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call' }), seen), 'entry').lockedBy,
    ];
    expect(new Set(locks).size).toBe(3);
    // 열린 축에는 잠금 이유가 없습니다.
    const { m: sm, seen: ss } = simulate(makeRng(2002), CELLS, AGGRO, 900);
    for (const a of computeAxes(sm, ss)) expect(a.lockedBy).toBeUndefined();
  });
});
