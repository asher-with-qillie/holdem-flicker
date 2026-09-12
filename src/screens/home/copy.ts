/**
 * Home screen copy + small pure helpers (owner C, spec §1 microcopy table and §5.1 behaviours).
 * No React, no stores — everything here is unit-testable and drives HomeScreen.tsx.
 */
import type { DeckId } from '../../state/nav';
import type { Pos, ScenarioKind } from '../../poker/types';

/** Short scenario names for the 약점 rows and summary labels ("SB · 오픈 대응"). */
export const KIND_SHORT_KO: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '5벳 올인 대응',
  cold_4bet: '콜드 4벳',
};

/** Focus deck that contains a scenario kind (§6.4). */
export function deckForKind(kind: ScenarioKind): DeckId {
  switch (kind) {
    case 'rfi':
      return 'rfi';
    case 'vs_open':
      return 'vs_open';
    case 'vs_3bet':
      return 'vs_3bet';
    default:
      return 'vs_4bet_allin';
  }
}

export function spotLabel(kind: ScenarioKind, hero: Pos): string {
  return `${hero} · ${KIND_SHORT_KO[kind]}`;
}

export function pct(n: number): string {
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

/* ------------------------------------------------------------------------------------------------
 * Levels (levelName() lives in progress.ts; this adds "next level" progress for the level line)
 * ---------------------------------------------------------------------------------------------- */

export const LEVELS: ReadonlyArray<{ name: string; min: number }> = [
  { name: '새싹', min: 0 },
  { name: '루키', min: 50 },
  { name: '레귤러', min: 200 },
  { name: '샤크', min: 500 },
  { name: '크러셔', min: 1000 },
];

export interface LevelInfo {
  name: string;
  /** undefined at the top level */
  next?: { name: string; remaining: number };
  /** 0..1 progress from this level's floor to the next (1 at the top level) */
  ratio: number;
}

export function levelInfo(learned: number): LevelInfo {
  const n = Math.max(0, learned);
  let i = 0;
  while (i + 1 < LEVELS.length && n >= LEVELS[i + 1].min) i += 1;
  const cur = LEVELS[i];
  const nxt = LEVELS[i + 1];
  if (!nxt) return { name: cur.name, ratio: 1 };
  return { name: cur.name, next: { name: nxt.name, remaining: nxt.min - n }, ratio: (n - cur.min) / (nxt.min - cur.min) };
}

/* ------------------------------------------------------------------------------------------------
 * Headline + CTA
 * ---------------------------------------------------------------------------------------------- */

export type HomeState = 'empty' | 'remaining' | 'goal_done' | 'streak_broken';

export interface HomeCopyInput {
  /** progress.activeDays — 0 means the user never trained */
  activeDays: number;
  todayCards: number;
  goal: number;
  streak: number;
  restDays: number;
  prevStreak: number;
  goalReachedToday: boolean;
  /** cards the next session will actually contain (session size, or the previewed deck when smaller) */
  sessionSize: number;
  /** ms per card for the current speed preset (think + reveal + transition, or expose + transition) */
  cadenceMs: number;
}

export interface HomeCopy {
  state: HomeState;
  headline: string;
  sub: string;
  cta: string;
  ctaTrailing: string;
  /** cards left to today's goal (0 when reached) */
  remaining: number;
}

/** Rounded minutes for `cards` at `cadenceMs` (+0.3 s), never below 1. */
export function estimateMinutes(cards: number, cadenceMs: number): number {
  const ms = Math.max(0, cards) * Math.max(0, cadenceMs) + 300;
  return Math.max(1, Math.round(ms / 60_000));
}

export function homeCopy(i: HomeCopyInput): HomeCopy {
  const goal = Math.max(1, i.goal);
  const remaining = Math.max(0, goal - i.todayCards);
  const sessionTrailing = `· ${i.sessionSize}장`;

  if (i.activeDays === 0 && i.todayCards === 0) {
    return {
      state: 'empty',
      headline: '포커 프리플랍, 카드로 외워요',
      sub: `매일 ${goal}장이면 충분해요`,
      cta: '첫 세션 시작',
      ctaTrailing: `· ${i.sessionSize}장 · 약 ${estimateMinutes(i.sessionSize, i.cadenceMs)}분`,
      remaining,
    };
  }

  if (i.goalReachedToday) {
    return {
      state: 'goal_done',
      headline: `오늘 목표 끝! 🔥\u00A0${i.streak}일째`, // nbsp: the flame wraps together with the day count
      sub: '더 하면 내일 복습이 가벼워져요',
      cta: '한 세션 더',
      ctaTrailing: sessionTrailing,
      remaining: 0,
    };
  }

  const minutes = estimateMinutes(remaining, i.cadenceMs);
  const inProgress = i.todayCards > 0;
  const cta = inProgress ? '이어서 하기' : '오늘 세션 시작';
  const ctaTrailing = inProgress ? `· ${remaining}장 남음` : sessionTrailing;

  if (i.restDays >= 2 && i.prevStreak >= 3) {
    return {
      state: 'streak_broken',
      headline: `${i.restDays}일 쉬었어요. 오늘\u00A0다시\u00A0시작`, // nbsp: wraps after the period, never inside the phrase
      sub: `오늘 ${remaining}장 · 약 ${minutes}분이면 끝나요`,
      cta,
      ctaTrailing,
      remaining,
    };
  }

  return {
    state: 'remaining',
    headline: `오늘 ${remaining}장 남았어요`,
    sub: `${minutes}분이면 끝나요`,
    cta,
    ctaTrailing,
    remaining,
  };
}

/** Eyebrow "🔥 7일째" — 0 reads as 연속 0일 (no "0일째"). */
export function streakLabel(streak: number): string {
  return streak > 0 ? `${streak}일째` : '연속 0일';
}

/** "9월 3일" from a 'YYYY-MM-DD' day key. */
export function dayLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일`;
}
