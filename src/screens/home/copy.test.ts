import { describe, expect, it } from 'vitest';
import { dayLabel, deckForKind, estimateMinutes, homeCopy, levelInfo, spotLabel, streakLabel, type HomeCopyInput } from './copy';

const base: HomeCopyInput = {
  activeDays: 12,
  todayCards: 12,
  goal: 20,
  streak: 7,
  restDays: 0,
  prevStreak: 7,
  goalReachedToday: false,
  sessionSize: 20,
  cadenceMs: 6300, // 보통: 3500 + 2500 + 300
};

describe('homeCopy', () => {
  it('first run: never trained', () => {
    const c = homeCopy({ ...base, activeDays: 0, todayCards: 0, streak: 0, prevStreak: 0 });
    expect(c.state).toBe('empty');
    expect(c.headline).toBe('포커 프리플랍, 카드로 외워요');
    expect(c.cta).toBe('첫 세션 시작');
    expect(c.ctaTrailing).toBe('· 20장 · 약 2분');
    expect(c.remaining).toBe(20);
  });

  it('active day: remaining + 이어서 하기', () => {
    const c = homeCopy(base);
    expect(c.state).toBe('remaining');
    expect(c.headline).toBe('오늘 8장 남았어요');
    expect(c.sub).toBe('1분이면 끝나요');
    expect(c.cta).toBe('이어서 하기');
    expect(c.ctaTrailing).toBe('· 8장 남음');
  });

  it('no session yet today: 오늘 세션 시작', () => {
    const c = homeCopy({ ...base, todayCards: 0 });
    expect(c.state).toBe('remaining');
    expect(c.headline).toBe('오늘 20장 남았어요');
    expect(c.cta).toBe('오늘 세션 시작');
    expect(c.ctaTrailing).toBe('· 20장');
  });

  it('goal done wins over everything else', () => {
    const c = homeCopy({ ...base, todayCards: 24, goalReachedToday: true, streak: 8, restDays: 5, prevStreak: 9 });
    expect(c.state).toBe('goal_done');
    expect(c.headline).toBe('오늘 목표 끝! 🔥\u00A08일째');
    expect(c.sub).toBe('더 하면 내일 복습이 가벼워져요');
    expect(c.cta).toBe('한 세션 더');
    expect(c.remaining).toBe(0);
  });

  it('streak broken needs rest ≥ 2 and previous streak ≥ 3', () => {
    const broken = homeCopy({ ...base, todayCards: 0, streak: 0, restDays: 3, prevStreak: 5 });
    expect(broken.state).toBe('streak_broken');
    expect(broken.headline).toBe('3일 쉬었어요. 오늘\u00A0다시\u00A0시작');
    expect(broken.cta).toBe('오늘 세션 시작');

    expect(homeCopy({ ...base, todayCards: 0, streak: 0, restDays: 1, prevStreak: 5 }).state).toBe('remaining');
    expect(homeCopy({ ...base, todayCards: 0, streak: 0, restDays: 3, prevStreak: 2 }).state).toBe('remaining');
  });

  it('never yields a negative remaining', () => {
    expect(homeCopy({ ...base, todayCards: 35 }).remaining).toBe(0);
    expect(homeCopy({ ...base, goal: 0, todayCards: 0 }).remaining).toBe(1);
  });
});

describe('helpers', () => {
  it('estimateMinutes rounds and floors at 1', () => {
    expect(estimateMinutes(20, 6300)).toBe(2);
    expect(estimateMinutes(8, 6300)).toBe(1);
    expect(estimateMinutes(0, 6300)).toBe(1);
    expect(estimateMinutes(40, 6300)).toBe(4);
  });

  it('levelInfo tracks the next threshold', () => {
    expect(levelInfo(0)).toEqual({ name: '새싹', next: { name: '루키', remaining: 50 }, ratio: 0 });
    expect(levelInfo(142)).toMatchObject({ name: '루키', next: { name: '레귤러', remaining: 58 } });
    expect(levelInfo(1200)).toEqual({ name: '크러셔', ratio: 1 });
    expect(levelInfo(-5).name).toBe('새싹');
  });

  it('labels', () => {
    expect(spotLabel('vs_open', 'SB')).toBe('SB · 오픈 대응');
    expect(deckForKind('vs_5bet')).toBe('vs_4bet_allin');
    expect(deckForKind('cold_4bet')).toBe('vs_4bet_allin');
    expect(deckForKind('rfi')).toBe('rfi');
    expect(streakLabel(0)).toBe('연속 0일');
    expect(streakLabel(7)).toBe('7일째');
    expect(dayLabel('2026-09-03')).toBe('9월 3일');
  });
});
