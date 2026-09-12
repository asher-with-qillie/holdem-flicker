import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory localStorage installed before the stores load (vi.hoisted runs above the imports).
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

import { ALL_HANDS, seedRandom } from '../../../poker/hands';
import { stepFor } from '../../../poker/trainer';
import { POSITIONS, SCENARIO_ACTIONS, type Action } from '../../../poker/types';
import { getProgress, resetProgress } from '../../../state/progress';
import { resetSettings, updateSettings } from '../../../state/settings';
import { cardKey, getCard, rate, resetSrs, flushSrs } from '../../../state/srs';
import { resetStats } from '../../../state/stats';
import { gradeAnswer } from '../grade';
import { answer, discardRound, endRound, getQuizRound, next, ROUND_SIZE, startRound } from '../roundStore';

const NOW = new Date(2026, 8, 12, 12, 0, 0).getTime(); // local noon
const STATS_KEY = 'holdem-flicker.stats.v1';

function readStats(): { total: number; totalCorrect: number; streak: number; mistakes: unknown[] } {
  return JSON.parse(memStorage.getItem(STATS_KEY) ?? '{"total":0,"totalCorrect":0,"streak":0,"mistakes":[]}');
}

/** An action for the current question that grades as `wanted` (wrong = the lowest-weight legal action). */
function pick(wanted: 'correct' | 'wrong'): Action {
  const r = getQuizRound()!;
  const step = r.queue[r.index].step;
  if (wanted === 'correct') return step.answer;
  const legal = SCENARIO_ACTIONS[step.scenario.kind];
  const wrong = legal.filter((a) => gradeAnswer(step, a) === 'wrong');
  if (!wrong.length) throw new Error(`no wrong action for ${cardKey(step)}`);
  return wrong[0];
}

beforeEach(() => {
  memStorage.clear();
  resetSettings();
  resetStats();
  resetProgress();
  resetSrs();
  discardRound();
  seedRandom(7);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  discardRound();
  vi.useRealTimers();
});

describe('startRound', () => {
  it('draws a round of 10 unique questions for a normal deck (queue + random fill)', () => {
    expect(startRound({ deck: 'all', positions: [...POSITIONS] }, NOW)).toBe('ok');
    const r = getQuizRound()!;
    expect(r.status).toBe('running');
    expect(r.queue).toHaveLength(ROUND_SIZE);
    expect(new Set(r.queue.map((q) => q.key)).size).toBe(ROUND_SIZE);
    expect(r.index).toBe(0);
  });

  it('reports no_charts when the deck × positions cannot produce a step', () => {
    expect(startRound({ deck: 'rfi', positions: ['BB'] }, NOW)).toBe('no_charts');
    expect(getQuizRound()).toBeNull();
  });

  it('onlyKeys keeps the given order and size, dropping keys without a chart', () => {
    const keys = ['vs_open:BB:BTN|KTo', 'rfi:UTG|AQs', 'rfi:BB|AA' /* BB never opens → no chart */, 'vs_3bet:CO:BTN|AKo'];
    expect(startRound({ deck: 'all', positions: [...POSITIONS], onlyKeys: keys }, NOW)).toBe('ok');
    const r = getQuizRound()!;
    expect(r.queue.map((q) => q.key)).toEqual(['vs_open:BB:BTN|KTo', 'rfi:UTG|AQs', 'vs_3bet:CO:BTN|AKo']);
  });

  it('tops a short SRS queue up to 10 with random single steps', () => {
    // one relearning record → the queue alone would hold 1 item
    rate(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AJs'), 'unsure', 'swipe', { now: NOW - 3_600_000 });
    expect(startRound({ deck: 'rfi', positions: ['UTG'] }, NOW)).toBe('ok');
    const r = getQuizRound()!;
    expect(r.queue).toHaveLength(ROUND_SIZE);
    expect(r.queue.some((q) => q.key === 'rfi:UTG|AJs' && q.origin === 'unsure')).toBe(true);
  });
});

describe('answer', () => {
  it('writes stats, the srs quiz channel and progress exactly once per question', () => {
    startRound({ deck: 'all', positions: [...POSITIONS], onlyKeys: ['vs_open:BB:BTN|KTo', 'rfi:UTG|72o'] }, NOW);
    const r = getQuizRound()!;
    const q = r.queue[0];
    const before = getProgress(20, NOW).today;

    expect(answer(pick('correct'), NOW)).toBe('correct');
    // a second tap on the same question is ignored
    expect(answer(pick('correct'), NOW)).toBeNull();

    const after = getProgress(20, NOW).today;
    expect(after.quiz - before.quiz).toBe(1);
    expect(after.quizCorrect - before.quizCorrect).toBe(1);
    expect(after.cards - before.cards).toBe(1);

    const card = getCard(q.key)!;
    expect(card.state).toBe('learning'); // new + know
    expect(card.reps).toBe(1);
    expect(card.exposures).toBe(1);

    const stats = readStats();
    expect(stats.total).toBe(1);
    expect(stats.totalCorrect).toBe(1);
    expect(stats.streak).toBe(1);
    expect(stats.mistakes).toHaveLength(0);
    expect(getQuizRound()!.correct).toBe(1);
    expect(getQuizRound()!.streak).toBe(1);
  });

  it('a wrong answer becomes a 최근 실수 entry, an srs lapse with the chosen action and a quiz miss', () => {
    startRound({ deck: 'all', positions: [...POSITIONS], onlyKeys: ['rfi:UTG|72o'] }, NOW);
    const step = getQuizRound()!.queue[0].step;
    const wrong = pick('wrong');
    expect(answer(wrong, NOW)).toBe('wrong');

    const card = getCard(cardKey(step))!;
    expect(card.state).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(card.quizWrong).toBe(1);
    expect(card.quizWrongAt).toBe(NOW);
    expect(card.lastWrongAction).toBe(wrong);

    const stats = readStats();
    expect(stats.total).toBe(1);
    expect(stats.totalCorrect).toBe(0);
    expect(stats.mistakes).toHaveLength(1);
    expect(getProgress(20, NOW).today.quizCorrect).toBe(0);
    expect(getQuizRound()!.wrong).toBe(1);
    expect(getQuizRound()!.streak).toBe(0);
  });

  it('partial (weight ≥ 0.4) counts as know for srs without the ease bonus and as correct for stats', () => {
    // find a hand with a ≥ 0.4 secondary action anywhere in the BB vs BTN chart
    const scenario = { kind: 'vs_open' as const, hero: 'BB' as const, villain: 'BTN' as const };
    let key = '';
    let partialAction: Action | null = null;
    for (const hand of ALL_HANDS) {
      const step = stepFor(scenario, hand);
      const a = SCENARIO_ACTIONS.vs_open.find((x) => gradeAnswer(step, x) === 'partial');
      if (a) {
        key = cardKey(step);
        partialAction = a;
        break;
      }
    }
    expect(partialAction, 'chart has a mixed hand').not.toBeNull();
    startRound({ deck: 'all', positions: [...POSITIONS], onlyKeys: [key] }, NOW);
    expect(answer(partialAction!, NOW)).toBe('partial');
    const card = getCard(key)!;
    expect(card.state).toBe('learning');
    expect(card.ease).toBe(2.3);
    expect(readStats().totalCorrect).toBe(1);
    expect(getQuizRound()!.partial).toBe(1);
  });
});

describe('round end', () => {
  it('next() after the last question produces the full summary and the progress session result', () => {
    startRound({ deck: 'all', positions: [...POSITIONS], onlyKeys: ['vs_open:BB:BTN|KTo', 'rfi:UTG|72o', 'rfi:CO|AKs'] }, NOW);
    answer(pick('correct'), NOW);
    next(NOW + 1000);
    answer(pick('wrong'), NOW + 2000);
    next(NOW + 3000);
    answer(pick('correct'), NOW + 4000);
    next(NOW + 5000);
    const r = getQuizRound()!;
    expect(r.status).toBe('summary');
    const res = r.result!;
    expect(res.headline).toBe('퀴즈 끝!');
    expect(res.partial).toBe(false);
    expect(res.seen).toBe(3);
    expect(res.correct).toBe(2);
    expect(res.wrong).toBe(1);
    expect(res.bestStreak).toBe(1);
    expect(res.wrongKeys).toEqual(['rfi:UTG|72o']);
    expect(res.mistakes.map((m) => m.key)).toEqual(['rfi:UTG|72o']);
    expect(res.durationMs).toBe(5000);
    expect(res.byOrigin).toEqual({ new: 3, review: 0, unsure: 0 });

    const p = getProgress(20, NOW + 5000);
    expect(p.today.sessions).toBe(1);
    expect(p.today.seconds).toBe(5);
    expect(p.lastResult?.mode).toBe('quiz');
    expect(p.lastResult?.unsureKeys).toEqual(['rfi:UTG|72o']);
    expect(p.lastResult?.seen).toBe(3);
    expect(p.lastResult?.known).toBe(2);
  });

  it('✕ with answers ends early with the partial headline; ✕ with nothing answered goes back to idle', () => {
    startRound({ deck: 'all', positions: [...POSITIONS] }, NOW);
    endRound(NOW);
    expect(getQuizRound()).toBeNull();
    expect(getProgress(20, NOW).today.sessions).toBe(0);

    startRound({ deck: 'all', positions: [...POSITIONS] }, NOW);
    answer(pick('correct'), NOW);
    next(NOW);
    answer(pick('correct'), NOW);
    endRound(NOW + 30_000);
    const r = getQuizRound()!;
    expect(r.status).toBe('summary');
    expect(r.result!.headline).toBe('여기까지 2장');
    expect(r.result!.partial).toBe(true);
    expect(r.result!.seen).toBe(2);
    expect(r.result!.size).toBe(ROUND_SIZE);
    expect(getProgress(20, NOW).today.sessions).toBe(1);
  });

  it('crossing the daily goal inside a round sets goalReachedNow and bumps the streak', () => {
    updateSettings({ dailyGoal: 10 });
    startRound({ deck: 'all', positions: [...POSITIONS] }, NOW);
    for (let i = 0; i < ROUND_SIZE; i++) {
      answer(pick('correct'), NOW + i);
      next(NOW + i);
    }
    const res = getQuizRound()!.result!;
    expect(res.goalReachedNow).toBe(true);
    expect(res.goalToday).toBe(10);
    expect(res.streak).toBe(1);
    expect(res.streakIncremented).toBe(true);
    flushSrs();
  });
});
