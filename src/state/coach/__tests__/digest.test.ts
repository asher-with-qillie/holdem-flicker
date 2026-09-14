/**
 * 다이제스트가 저장소에서 재료를 옳게 긁어 오는지. COACH_SPEC §3.
 *
 * 축 계산 자체는 axes.test.ts 가 합성 플레이어로 증명하므로 여기서는 그 **앞단**만 봅니다 —
 * 무엇을 세고 무엇을 빼는가. 못 박는 것은 네 가지입니다.
 *   1) `hash` 는 재료의 지문이다. 같은 재료면 같고, 하나라도 달라지면 달라지고, 시계는 섞이지 않는다.
 *   2) 부분 정답이 가능한 문제는 실수에서도 기준선에서도 빠진다(pure 필터).
 *   3) mistakesUsed / trials / trainShare 가 재료와 맞는다.
 *   4) 저장소가 비었거나 깨져 있어도 터지지 않고 빈 다이제스트가 나온다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 저장소를 모듈 로드보다 먼저 심습니다(vi.hoisted 가 import 위로 끌려 올라갑니다) — srs 는
// import 시점에 한 번 읽고 그 뒤로는 메모리 안에서만 삽니다.
const { memStorage } = vi.hoisted(() => {
  const map = new Map<string, string>();
  const memStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, configurable: true, writable: true });
  return { memStorage };
});

import type { Action } from '../../../poker/types';
import { flushSrs, rate, resetSrs, stepForKey } from '../../srs';
import { buildDigest } from '../digest';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const STATS_KEY = 'holdem-flicker.stats.v1';

/* 차트에서 미리 확인한 카드키들. 앞의 다섯은 정답 하나뿐이고, 뒤의 하나는 0.5/0.5 혼합이라
 * grade.ts 가 '부분 정답'으로 쳐 줍니다 — 그래서 '틀렸다'의 뜻이 흐려지고 pure 필터에 걸립니다. */
const FOLD_KEY = 'vs_open:BTN:UTG|72o'; // 정답 폴드
const THREEBET_KEY = 'vs_open:BTN:UTG|AKs'; // 정답 3벳
const RFI_KEY = 'rfi:UTG|AJo'; // 정답 오픈, villain 없음
const MIXED_KEY = 'vs_open:CO:UTG|AQo'; // 3벳 0.5 / 콜 0.5

interface SeedMistake {
  at: number;
  scenarioId: string;
  hand: string;
  answer: Action;
  chosen: Action;
  src?: 'quiz' | 'train';
}

const BASE_MISTAKES: SeedMistake[] = [
  // 혼합 문제 — 콜도 부분 정답이라 분석 집합에서 빠져야 합니다.
  { at: NOW - 1 * DAY, scenarioId: 'vs_open:CO:UTG', hand: 'AQo', answer: 'threebet', chosen: 'call' },
  { at: NOW - 2 * DAY, scenarioId: 'vs_open:BTN:UTG', hand: '72o', answer: 'fold', chosen: 'call', src: 'train' },
  // src 가 없는 옛 기록. 'quiz' 로 읽혀야 합니다.
  { at: NOW - 3 * DAY, scenarioId: 'vs_open:BTN:UTG', hand: 'AKs', answer: 'threebet', chosen: 'call' },
  { at: NOW - 4 * DAY, scenarioId: 'rfi:UTG', hand: 'AJo', answer: 'raise', chosen: 'fold', src: 'train' },
  // 차트가 없는 기록(옛 판 데이터). stepForKey 가 null 이라 조용히 빠져야 합니다.
  { at: NOW - 5 * DAY, scenarioId: 'vs_open:UTG:BTN', hand: 'AA', answer: 'fold', chosen: 'call' },
];

function writeStats(mistakes: SeedMistake[]): void {
  memStorage.setItem(
    STATS_KEY,
    JSON.stringify({
      byKind: {
        rfi: { attempts: 20, correct: 12 },
        vs_open: { attempts: 20, correct: 17 },
        vs_3bet: { attempts: 10, correct: 10 },
      },
      streak: 3,
      bestStreak: 9,
      mistakes,
      total: 50,
      totalCorrect: 39,
    }),
  );
}

/** 퀴즈에서 답을 낸 것(quizSeen +1). */
function answeredInQuiz(key: string, times = 1): void {
  const step = stepForKey(key);
  if (!step) throw new Error(`no step for ${key}`);
  for (let i = 0; i < times; i += 1) rate(step, 'know', 'quiz', { now: NOW });
}

/** 훈련에서 선택 버튼을 누른 것(pickSeen +1). */
function answeredInTrain(key: string, times = 1): void {
  const step = stepForKey(key);
  if (!step) throw new Error(`no step for ${key}`);
  for (let i = 0; i < times; i += 1) rate(step, 'know', 'button', { now: NOW, chosen: step.answer });
}

/** 실수 5건 + 답을 낸 카드 4장. 그중 혼합 카드 하나는 어느 쪽에서도 세지 않아야 합니다. */
function seed(): void {
  writeStats(BASE_MISTAKES);
  answeredInQuiz(FOLD_KEY, 3);
  answeredInQuiz(THREEBET_KEY, 1);
  answeredInTrain(THREEBET_KEY, 1);
  answeredInTrain(RFI_KEY, 2);
  answeredInQuiz(MIXED_KEY, 5);
}

beforeEach(() => {
  memStorage.clear();
  resetSrs();
  memStorage.clear();
});

afterEach(() => {
  flushSrs(); // 디바운스 타이머를 남기지 않습니다.
});

describe('buildDigest', () => {
  it('재료가 같으면 hash 가 같고 시계는 섞이지 않는다', () => {
    seed();
    const a = buildDigest(NOW);
    const b = buildDigest(NOW + 3 * DAY);
    expect(a.hash).toBe(b.hash);
    expect(a.hash.length).toBeGreaterThan(0);
    // at 은 시계를 그대로 받습니다 — 지문에만 안 섞일 뿐입니다.
    expect(b.at).toBe(NOW + 3 * DAY);
  });

  it('실수 하나만 달라져도 hash 가 달라진다', () => {
    seed();
    const base = buildDigest(NOW).hash;

    // (1) 고른 액션만 바꾼다 — 개수도 시각도 그대로다.
    const swapped = BASE_MISTAKES.map((m, i) => (i === 1 ? { ...m, chosen: 'threebet' as Action } : m));
    writeStats(swapped);
    const afterSwap = buildDigest(NOW).hash;
    expect(afterSwap).not.toBe(base);

    // (2) 한 건을 더한다.
    writeStats([{ at: NOW, scenarioId: 'rfi:UTG', hand: '72o', answer: 'fold', chosen: 'raise' }, ...BASE_MISTAKES]);
    expect(buildDigest(NOW).hash).not.toBe(base);

    // (3) 실수는 그대로 두고 trials 만 늘린다.
    writeStats(BASE_MISTAKES);
    expect(buildDigest(NOW).hash).toBe(base);
    answeredInQuiz(FOLD_KEY, 1);
    expect(buildDigest(NOW).hash).not.toBe(base);
  });

  it('부분 정답이 가능한 문제는 실수에서도 기준선에서도 빠진다', () => {
    seed();
    const d = buildDigest(NOW);

    // 혼합 카드는 퀴즈에서 다섯 번 답을 냈지만 trials 에 들어가지 않습니다.
    expect(d.volume.trials).toBe(3 + 2 + 2);
    expect(d.volume.srsCards).toBe(4);
    expect(d.recentMistakes.some((m) => m.key === MIXED_KEY)).toBe(false);
    expect(d.byKind.find((r) => r.kind === 'vs_open')?.trials).toBe(5);
    expect(d.byHero.some((r) => r.hero === 'CO')).toBe(false);
  });

  it('mistakesUsed / trials / trainShare 가 재료와 맞는다', () => {
    seed();
    const d = buildDigest(NOW);

    expect(d.volume.mistakesStored).toBe(5);
    expect(d.volume.mistakesUsed).toBe(3); // 혼합 1건 + 차트 없는 1건이 빠집니다.
    expect(d.volume.trainShare).toBeCloseTo(2 / 3, 10);
    expect(d.volume.quizTotal).toBe(50);
    expect(d.volume.quizCorrect).toBe(39);
    expect(d.volume.streak).toBe(3);
    expect(d.volume.bestStreak).toBe(9);

    // 기준선: vs_open 은 폴드-정답 3회 / 전체 5회.
    expect(d.byKind.find((r) => r.kind === 'vs_open')?.foldAnswerShare).toBeCloseTo(0.6, 10);
    expect(d.byKind.find((r) => r.kind === 'rfi')).toEqual({ kind: 'rfi', trials: 2, mistakes: 1, foldAnswerShare: 0 });
    expect(d.byHero.find((r) => r.hero === 'BTN')).toEqual({ hero: 'BTN', trials: 5, mistakes: 2, foldAnswerShare: 0.6 });

    // 최신순 20건. src 가 없던 기록은 'quiz' 로 읽힙니다.
    expect(d.recentMistakes.map((m) => m.key)).toEqual([FOLD_KEY, THREEBET_KEY, RFI_KEY]);
    expect(d.recentMistakes[0]).toMatchObject({ kind: 'vs_open', hero: 'BTN', villain: 'UTG', ip: true, daysAgo: 2, src: 'train' });
    expect(d.recentMistakes[1].src).toBe('quiz');
    expect(d.recentMistakes[2]).toMatchObject({ kind: 'rfi', hero: 'UTG', ip: false, daysAgo: 4 });
    expect(d.recentMistakes[2].villain).toBeUndefined();

    // 칭찬 한 줄: 정답률이 더 높아도 시도 15회 미만인 vs_3bet 은 뽑히지 않습니다.
    expect(d.good).toEqual({ kind: 'vs_open', trials: 20, acc: 0.85 });
  });

  it('저장소가 비어 있어도 빈 다이제스트를 낸다', () => {
    const d = buildDigest(NOW);

    expect(d.v).toBe(1);
    expect(d.volume.mistakesUsed).toBe(0);
    expect(d.volume.mistakesStored).toBe(0);
    expect(d.volume.trials).toBe(0);
    expect(d.volume.trainShare).toBe(0);
    expect(d.byKind).toEqual([]);
    expect(d.byHero).toEqual([]);
    expect(d.patterns).toEqual([]);
    expect(d.recentMistakes).toEqual([]);
    expect(d.weakSpots).toEqual([]);
    expect(d.good).toBeNull();
    expect(d.hash.length).toBeGreaterThan(0);
    // 축은 지우지 않고 네 줄 그대로 잠긴 채 나옵니다 — 화면이 "무엇을 더 하면 열리는지"를 그립니다.
    expect(d.axes).toHaveLength(4);
    expect(d.axes.every((a) => !a.unlocked && a.level === 'locked' && a.t === null)).toBe(true);
  });

  it('저장소가 깨져 있어도 터지지 않는다', () => {
    memStorage.setItem(STATS_KEY, '{"mistakes": [1, null, {"hand":"AA"}], "total": "많이"');
    expect(() => buildDigest(NOW)).not.toThrow();
    expect(buildDigest(NOW).volume.mistakesUsed).toBe(0);

    // 모양이 어긋난 항목 하나가 나머지를 못 먹게 합니다.
    memStorage.setItem(
      STATS_KEY,
      JSON.stringify({ mistakes: [null, { scenarioId: 'vs_open:BTN:UTG', hand: '72o', answer: 'fold', chosen: 'call' }, { hand: 'AA' }] }),
    );
    const d = buildDigest(NOW);
    expect(d.volume.mistakesStored).toBe(1);
    expect(d.volume.mistakesUsed).toBe(1);
    expect(d.volume.quizTotal).toBe(0);
  });
});
