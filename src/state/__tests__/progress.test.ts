import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_BOUNDARY_HOURS,
  dayKey,
  getProgress,
  heatLevel,
  levelName,
  logCards,
  logQuiz,
  logSeconds,
  logSession,
  resetProgress,
  setLastResult,
  shiftDay,
  type SessionResult,
} from '../progress';

/** Local wall-clock timestamp (the store keys days in local time). */
const T = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = T(2026, 9, 12); // Saturday 2026-09-12, noon local
const TODAY = '2026-09-12';
const GOAL = 20;

function reachGoalOn(key: string, cards = GOAL) {
  const [y, m, d] = key.split('-').map(Number);
  logCards(cards, { ts: T(y, m, d) });
}

function makeMemStorage() {
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
}

beforeEach(() => {
  resetProgress();
});

afterEach(() => {
  vi.resetModules();
});

describe('day keys', () => {
  it('rolls the day over at 04:00 local (03:59 is still yesterday, 04:01 is today)', () => {
    expect(DAY_BOUNDARY_HOURS).toBe(4);
    expect(dayKey(T(2026, 9, 12, 3, 59))).toBe('2026-09-11');
    expect(dayKey(T(2026, 9, 12, 4, 0))).toBe('2026-09-12');
    expect(dayKey(T(2026, 9, 12, 4, 1))).toBe('2026-09-12');
    expect(dayKey(T(2026, 9, 12, 23, 59))).toBe('2026-09-12');
    expect(dayKey(T(2026, 9, 13, 0, 30))).toBe('2026-09-12');
    expect(dayKey(T(2026, 1, 1, 1, 0))).toBe('2025-12-31');
  });

  it('shiftDay crosses month, year and leap boundaries', () => {
    expect(shiftDay('2026-09-12', 1)).toBe('2026-09-13');
    expect(shiftDay('2026-09-12', -12)).toBe('2026-08-31');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-09-12', 0)).toBe('2026-09-12');
    expect(shiftDay('2026-09-12', 400)).toBe('2027-10-17');
  });

  it('logs written at 03:59 land on the previous day', () => {
    logCards(3, { ts: T(2026, 9, 12, 3, 59) });
    logCards(4, { ts: T(2026, 9, 12, 4, 1) });
    const v = getProgress(GOAL, NOW);
    expect(v.days['2026-09-11']).toBe(3);
    expect(v.days['2026-09-12']).toBe(4);
    expect(v.today.cards).toBe(4);
  });
});

describe('day logs', () => {
  it('accumulates cards, ratings, quiz answers, seconds and sessions on the injected day', () => {
    logCards(3, { rated: 2, known: 1, ts: NOW });
    logCards(1, { ts: NOW + 1000 });
    logQuiz(true, NOW + 2000);
    logQuiz(false, NOW + 3000);
    logSeconds(30, NOW + 4000);
    logSeconds(12.5, NOW + 5000);
    logSession(NOW + 6000);
    const v = getProgress(GOAL, NOW + 7000);
    expect(v.todayKey).toBe(TODAY);
    expect(v.today).toEqual({ cards: 6, rated: 2, known: 1, quiz: 2, quizCorrect: 1, seconds: 42.5, sessions: 1 });
    expect(v.totalCards).toBe(6);
    expect(v.activeDays).toBe(1);
    expect(v.days).toEqual({ [TODAY]: 6 });
  });

  it('starts empty and exposes a copy of today', () => {
    const v = getProgress(GOAL, NOW);
    expect(v.today).toEqual({ cards: 0, rated: 0, known: 0, quiz: 0, quizCorrect: 0, seconds: 0, sessions: 0 });
    expect(v).toMatchObject({ streak: 0, bestStreak: 0, restDays: 0, prevStreak: 0, goalReachedToday: false, totalCards: 0, activeDays: 0 });
    expect(v.lastGoalDay).toBeUndefined();
    expect(v.lastResult).toBeUndefined();
    expect(v.weekDots).toEqual([false, false, false, false, false, false, false]);
    v.today.cards = 99; // mutating the view must not touch the store
    expect(getProgress(GOAL, NOW).today.cards).toBe(0);
  });
});

describe('streaks', () => {
  it('counts consecutive goal days and does not break while today is still in progress', () => {
    reachGoalOn('2026-09-10');
    reachGoalOn('2026-09-11');
    logCards(5, { ts: NOW });
    let v = getProgress(GOAL, NOW);
    expect(v.streak).toBe(2);
    expect(v.goalReachedToday).toBe(false);
    expect(v.restDays).toBe(0);
    expect(v.lastGoalDay).toBe('2026-09-11');
    expect(v.prevStreak).toBe(2);

    logCards(15, { ts: NOW + 1 });
    v = getProgress(GOAL, NOW + 1);
    expect(v.streak).toBe(3);
    expect(v.goalReachedToday).toBe(true);
    expect(v.bestStreak).toBe(3);
    expect(v.lastGoalDay).toBe(TODAY);
    expect(v.restDays).toBe(0);
  });

  it('a missed day (before yesterday) ends the streak', () => {
    reachGoalOn('2026-09-08');
    reachGoalOn('2026-09-09');
    reachGoalOn('2026-09-11');
    const v = getProgress(GOAL, NOW);
    expect(v.streak).toBe(1);
    expect(v.bestStreak).toBe(2);
  });

  it('reports prevStreak and restDays after a break (for the "N일 쉬었어요" headline)', () => {
    reachGoalOn('2026-09-07');
    reachGoalOn('2026-09-08');
    reachGoalOn('2026-09-09');
    const v = getProgress(GOAL, NOW);
    expect(v.streak).toBe(0);
    expect(v.lastGoalDay).toBe('2026-09-09');
    expect(v.restDays).toBe(2); // 10th and 11th
    expect(v.prevStreak).toBe(3);
    expect(v.bestStreak).toBe(3);
    // a goal day today restarts the streak at 1 but prevStreak now refers to today
    logCards(GOAL, { ts: NOW });
    const after = getProgress(GOAL, NOW);
    expect(after.streak).toBe(1);
    expect(after.restDays).toBe(0);
    expect(after.prevStreak).toBe(1);
  });

  it('restDays is 0 when yesterday was a goal day, and when nothing was ever logged', () => {
    expect(getProgress(GOAL, NOW).restDays).toBe(0);
    reachGoalOn('2026-09-11');
    expect(getProgress(GOAL, NOW).restDays).toBe(0);
    reachGoalOn('2026-09-05');
    expect(getProgress(GOAL, NOW).restDays).toBe(0);
  });

  it('bestStreak is the longest run anywhere in the history', () => {
    for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-09-10', '2026-09-11']) reachGoalOn(d);
    const v = getProgress(GOAL, NOW);
    expect(v.bestStreak).toBe(4);
    expect(v.streak).toBe(2);
    expect(v.prevStreak).toBe(2);
  });

  it('depends on the goal passed in', () => {
    reachGoalOn('2026-09-11', 15);
    expect(getProgress(20, NOW).streak).toBe(0);
    expect(getProgress(10, NOW).streak).toBe(1);
    expect(getProgress(0, NOW).streak).toBe(1); // goal < 1 behaves like 1
  });

  it('ignores logs dated after today (clock skew) for goal days', () => {
    reachGoalOn('2026-09-13');
    reachGoalOn('2026-09-11');
    const v = getProgress(GOAL, NOW);
    expect(v.goalReachedToday).toBe(false);
    expect(v.streak).toBe(1);
    expect(v.lastGoalDay).toBe('2026-09-11');
    expect(v.totalCards).toBe(40); // still counted as cards
  });

  it('weekDots covers Monday…Sunday of the current week', () => {
    // 2026-09-12 is a Saturday → week = 09-07 (월) … 09-13 (일)
    reachGoalOn('2026-09-06'); // previous Sunday: not in this week
    reachGoalOn('2026-09-07');
    reachGoalOn('2026-09-09');
    reachGoalOn('2026-09-12');
    expect(getProgress(GOAL, NOW).weekDots).toEqual([true, false, true, false, false, true, false]);
    // on a Sunday the week still starts on Monday
    expect(getProgress(GOAL, T(2026, 9, 13)).weekDots).toEqual([true, false, true, false, false, true, false]);
    // on Monday 09-14 a new week begins
    expect(getProgress(GOAL, T(2026, 9, 14)).weekDots).toEqual([false, false, false, false, false, false, false]);
  });

  it('activeDays counts days with ≥ 1 card (the first-week new-card cap input)', () => {
    logCards(1, { ts: T(2026, 9, 1) });
    logCards(0, { ts: T(2026, 9, 2) });
    logCards(50, { ts: T(2026, 9, 3) });
    logQuiz(false, T(2026, 9, 4));
    expect(getProgress(GOAL, NOW).activeDays).toBe(3);
  });
});

describe('heat levels and level names', () => {
  it('maps cards to 0..4 relative to the goal', () => {
    const cases: Array<[number, number, 0 | 1 | 2 | 3 | 4]> = [
      [0, 20, 0],
      [-3, 20, 0],
      [1, 20, 1],
      [9, 20, 1],
      [10, 20, 2],
      [19, 20, 2],
      [20, 20, 3],
      [39, 20, 3],
      [40, 20, 4],
      [400, 20, 4],
      [9, 10, 1],
      [10, 10, 3],
      [19, 10, 3],
      [20, 10, 4],
      [10, 40, 2],
      [39, 40, 2],
      [40, 40, 3],
      [79, 40, 3],
      [80, 40, 4],
      [10, 80, 2],
      [80, 80, 3],
      [160, 80, 4],
      [1, 0, 3], // goal < 1 behaves like 1
    ];
    for (const [cards, goal, level] of cases) expect(heatLevel(cards, goal), `cards ${cards} goal ${goal}`).toBe(level);
  });

  it('names levels by learned count', () => {
    const cases: Array<[number, string]> = [
      [0, '새싹'],
      [49, '새싹'],
      [50, '루키'],
      [199, '루키'],
      [200, '레귤러'],
      [499, '레귤러'],
      [500, '샤크'],
      [999, '샤크'],
      [1000, '크러셔'],
      [5000, '크러셔'],
    ];
    for (const [learned, name] of cases) expect(levelName(learned), `learned ${learned}`).toBe(name);
  });
});

const RESULT: SessionResult = {
  id: 's1',
  mode: 'train',
  startedAt: NOW - 128_000,
  endedAt: NOW,
  activeMs: 128_000,
  config: { deck: 'all', positions: ['BTN', 'BB'], size: 20, speed: 'normal', exposure: false, manual: false },
  seen: 20,
  rated: 18,
  known: 16,
  unsure: 2,
  exposureOnly: false,
  byOrigin: { new: 11, review: 6, unsure: 3 },
  weakest: { kind: 'vs_open', hero: 'SB', unsure: 3, shown: 4 },
  unsureKeys: ['vs_open:BB:BTN|KTo', 'vs_3bet:CO:BTN|A4s'],
  allKeys: ['vs_open:BB:BTN|KTo', 'vs_3bet:CO:BTN|A4s', 'rfi:UTG|AA'],
  goalReachedNow: true,
  streakBefore: 7,
  streakAfter: 8,
};

describe('lastResult and reset', () => {
  it('stores the last session result and clears everything on reset', () => {
    setLastResult(RESULT);
    logCards(20, { ts: NOW });
    expect(getProgress(GOAL, NOW).lastResult).toEqual(RESULT);
    resetProgress();
    const v = getProgress(GOAL, NOW);
    expect(v.lastResult).toBeUndefined();
    expect(v.totalCards).toBe(0);
    expect(v.days).toEqual({});
  });

  it('prunes the day map to the 400 most recent days', () => {
    for (let i = 0; i < 405; i++) logCards(1, { ts: T(2026, 9, 12) - i * 86_400_000 });
    const v = getProgress(GOAL, NOW);
    const keys = Object.keys(v.days).sort();
    expect(keys).toHaveLength(400);
    expect(keys[0]).toBe(shiftDay(TODAY, -399));
    expect(keys[keys.length - 1]).toBe(TODAY);
    expect(v.activeDays).toBe(400);
  });
});

describe('persistence', () => {
  it('round-trips through localStorage and tolerates corrupt data', async () => {
    const mem = makeMemStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
    try {
      vi.resetModules();
      const a = await import('../progress');
      a.logCards(7, { rated: 3, known: 2, ts: NOW });
      a.setLastResult(RESULT);
      const raw = mem.getItem('holdem-flicker.progress.v1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).version).toBe(1);

      vi.resetModules();
      const b = await import('../progress');
      const v = b.getProgress(GOAL, NOW);
      expect(v.today).toEqual({ cards: 7, rated: 3, known: 2, quiz: 0, quizCorrect: 0, seconds: 0, sessions: 0 });
      expect(v.lastResult).toEqual(RESULT);

      mem.setItem('holdem-flicker.progress.v1', '{"version":1,"days":{"bad key":{"cards":"x"},"2026-09-11":{"cards":5}}}');
      vi.resetModules();
      const c = await import('../progress');
      expect(c.getProgress(GOAL, NOW).days).toEqual({ '2026-09-11': 5 });

      mem.setItem('holdem-flicker.progress.v1', 'not json');
      vi.resetModules();
      const d = await import('../progress');
      expect(d.getProgress(GOAL, NOW).totalCards).toBe(0);
      expect(() => d.logCards(1, { ts: NOW })).not.toThrow();
    } finally {
      // @ts-expect-error -- back to the bare node environment
      delete globalThis.localStorage;
    }
  });

  it('works without localStorage (this file runs in plain node)', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    logCards(2, { ts: NOW });
    logSession(NOW);
    expect(getProgress(GOAL, NOW).today.sessions).toBe(1);
  });
});
