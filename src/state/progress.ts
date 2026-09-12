/**
 * Daily progress store (owner C) — spec §7.2.
 *
 * Per-day logs keyed by a local day that starts at 04:00 (`DAY_BOUNDARY_HOURS`), the last session result,
 * and a pure `ProgressView` (streaks, heat data, week dots) recomputed from `days` on every read — no
 * stored counters that could drift. Module-level state, `useProgress()` via `useSyncExternalStore`,
 * synchronous write-through to `localStorage['holdem-flicker.progress.v1']` guarded with try/catch;
 * nothing touches `window` at import time, so the module runs in plain node.
 *
 * Decisions where the spec left room (all additive / documented):
 *  - `SpeedPreset` is declared here as well (settings.ts is owner A's); structurally the same union.
 *  - Every logger takes an optional timestamp (`logSession(ts?)` included) so tests inject the clock.
 *  - `restDays` is 0 when no goal day exists yet; `prevStreak` is then 0 too.
 *  - `weekDots` covers the Monday-start week of `now` (days after today are simply false).
 *  - `heatLevel` treats `goal < 1` as 1. `logQuiz` adds `cards + 1` only (rated/known stay trainer-only).
 *  - `days` is pruned to the 400 most recent keys on every commit.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { Pos, ScenarioKind } from '../poker/types';
import type { CardKey, DeckId } from './srs';

export type SpeedPreset = 'slow' | 'normal' | 'fast' | 'flash' | 'custom';

export interface DayLog {
  cards: number;
  rated: number;
  known: number;
  quiz: number;
  quizCorrect: number;
  seconds: number;
  sessions: number;
}

/** Written by trainer / quiz at summary time. */
export interface SessionResult {
  id: string;
  mode: 'train' | 'quiz';
  startedAt: number;
  endedAt: number;
  activeMs: number;
  config: { deck: DeckId; positions: Pos[]; size: number; speed: SpeedPreset; exposure: boolean; manual: boolean };
  seen: number;
  rated: number;
  known: number;
  unsure: number;
  exposureOnly: boolean;
  byOrigin: { new: number; review: number; unsure: number };
  weakest?: { kind: ScenarioKind; hero: Pos; unsure: number; shown: number };
  unsureKeys: CardKey[];
  allKeys: CardKey[];
  goalReachedNow: boolean;
  streakBefore: number;
  streakAfter: number;
}

export interface ProgressStore {
  version: 1;
  /** dayKey → log, pruned to 400 days */
  days: Record<string, DayLog>;
  lastResult?: SessionResult;
}

export interface ProgressView {
  today: DayLog;
  todayKey: string;
  /** dayKey → cards (for Heatmap) */
  days: Record<string, number>;
  streak: number;
  bestStreak: number;
  lastGoalDay?: string;
  restDays: number;
  prevStreak: number;
  goalReachedToday: boolean;
  totalCards: number;
  activeDays: number;
  /** 월…일 of the current week (Monday start): goal reached */
  weekDots: boolean[];
  lastResult?: SessionResult;
}

const KEY = 'holdem-flicker.progress.v1';
const MAX_DAYS = 400;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 04:00 local: 1 a.m. still counts as "today". */
export const DAY_BOUNDARY_HOURS = 4;

const EMPTY_LOG: DayLog = { cards: 0, rated: 0, known: 0, quiz: 0, quizCorrect: 0, seconds: 0, sessions: 0 };

/* ------------------------------------------------------------------------------------------------
 * Day keys
 * ---------------------------------------------------------------------------------------------- */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseKey(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) throw new Error(`Bad day key "${key}"`);
  return [y, m, d];
}

/** Local 'YYYY-MM-DD' of (ts − 4 h). */
export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts - DAY_BOUNDARY_HOURS * HOUR);
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = parseKey(key);
  const dt = new Date(y, m - 1, d + delta, 12); // noon: immune to DST shifts
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Whole days from `a` to `b` (b − a). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parseKey(a);
  const [by, bm, bd] = parseKey(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

/** 0 = Monday … 6 = Sunday */
function weekdayIndex(key: string): number {
  const [y, m, d] = parseKey(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/* ------------------------------------------------------------------------------------------------
 * Store + persistence
 * ---------------------------------------------------------------------------------------------- */

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function sanitizeLog(v: unknown): DayLog | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const num = (k: keyof DayLog) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  return { cards: num('cards'), rated: num('rated'), known: num('known'), quiz: num('quiz'), quizCorrect: num('quizCorrect'), seconds: num('seconds'), sessions: num('sessions') };
}

function load(): ProgressStore {
  const out: ProgressStore = { version: 1, days: {} };
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<ProgressStore> | null;
    if (!parsed || parsed.version !== 1) return out;
    for (const [key, log] of Object.entries(parsed.days ?? {})) {
      const clean = sanitizeLog(log);
      if (clean && /^\d{4}-\d{2}-\d{2}$/.test(key)) out.days[key] = clean;
    }
    if (parsed.lastResult && typeof parsed.lastResult === 'object') out.lastResult = parsed.lastResult;
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return out;
}

let store: ProgressStore = load();
let version = 0;
const listeners = new Set<() => void>();

function prune() {
  const keys = Object.keys(store.days);
  if (keys.length <= MAX_DAYS) return;
  keys.sort();
  for (const k of keys.slice(0, keys.length - MAX_DAYS)) delete store.days[k];
}

function commit() {
  prune();
  try {
    storage()?.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / unavailable storage */
  }
  version += 1;
  listeners.forEach((l) => l());
}

function logFor(ts: number): DayLog {
  const key = dayKey(ts);
  return (store.days[key] ??= { ...EMPTY_LOG });
}

/* ------------------------------------------------------------------------------------------------
 * Writers
 * ---------------------------------------------------------------------------------------------- */

export function logCards(n: number, opts: { rated?: number; known?: number; ts?: number } = {}): void {
  const log = logFor(opts.ts ?? Date.now());
  log.cards += n;
  log.rated += opts.rated ?? 0;
  log.known += opts.known ?? 0;
  commit();
}

/** quiz + 1, quizCorrect + correct, cards + 1 (a question is a card). */
export function logQuiz(correct: boolean, ts: number = Date.now()): void {
  const log = logFor(ts);
  log.quiz += 1;
  if (correct) log.quizCorrect += 1;
  log.cards += 1;
  commit();
}

export function logSeconds(s: number, ts: number = Date.now()): void {
  const log = logFor(ts);
  log.seconds += s;
  commit();
}

/** sessions + 1 on today's log. */
export function logSession(ts: number = Date.now()): void {
  const log = logFor(ts);
  log.sessions += 1;
  commit();
}

export function setLastResult(r: SessionResult): void {
  store.lastResult = r;
  commit();
}

export function resetProgress(): void {
  store = { version: 1, days: {} };
  commit();
}

/* ------------------------------------------------------------------------------------------------
 * Derived view (pure)
 * ---------------------------------------------------------------------------------------------- */

/** Consecutive goal days ending at `end` (inclusive), walking backwards. */
function runEndingAt(end: string, isGoal: (key: string) => boolean): number {
  let n = 0;
  let k = end;
  while (n <= MAX_DAYS && isGoal(k)) {
    n += 1;
    k = shiftDay(k, -1);
  }
  return n;
}

export function getProgress(goal: number, now: number = Date.now()): ProgressView {
  const dailyGoal = Math.max(1, goal);
  const todayKey = dayKey(now);
  const days: Record<string, number> = {};
  let totalCards = 0;
  let activeDays = 0;
  const goalDays: string[] = [];
  for (const [key, log] of Object.entries(store.days)) {
    days[key] = log.cards;
    totalCards += log.cards;
    if (log.cards >= 1) activeDays += 1;
    if (log.cards >= dailyGoal && key <= todayKey) goalDays.push(key);
  }
  goalDays.sort();
  const goalSet = new Set(goalDays);
  const isGoal = (key: string) => goalSet.has(key);

  const goalReachedToday = isGoal(todayKey);
  const streak = runEndingAt(goalReachedToday ? todayKey : shiftDay(todayKey, -1), isGoal);

  let bestStreak = 0;
  let run = 0;
  for (let i = 0; i < goalDays.length; i++) {
    run = i > 0 && shiftDay(goalDays[i - 1], 1) === goalDays[i] ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
  }

  const lastGoalDay = goalDays.length ? goalDays[goalDays.length - 1] : undefined;
  const restDays = lastGoalDay ? Math.max(0, daysBetween(lastGoalDay, todayKey) - 1) : 0;
  const prevStreak = lastGoalDay ? runEndingAt(lastGoalDay, isGoal) : 0;

  const monday = shiftDay(todayKey, -weekdayIndex(todayKey));
  const weekDots: boolean[] = [];
  for (let i = 0; i < 7; i++) weekDots.push(isGoal(shiftDay(monday, i)));

  const view: ProgressView = {
    today: { ...(store.days[todayKey] ?? EMPTY_LOG) },
    todayKey,
    days,
    streak,
    bestStreak,
    restDays,
    prevStreak,
    goalReachedToday,
    totalCards,
    activeDays,
    weekDots,
  };
  if (lastGoalDay) view.lastGoalDay = lastGoalDay;
  if (store.lastResult) view.lastResult = store.lastResult;
  return view;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

export function useProgress(goal: number): ProgressView {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const todayKey = dayKey(); // re-derive when the 04:00 boundary passes between renders
  return useMemo(() => getProgress(goal), [v, goal, todayKey]);
}

/** 0; 1–9 → 1; 10–(goal−1) → 2; goal–(2·goal−1) → 3; ≥ 2·goal → 4 */
export function heatLevel(cards: number, goal: number): 0 | 1 | 2 | 3 | 4 {
  const g = Math.max(1, goal);
  if (cards <= 0) return 0;
  if (cards >= 2 * g) return 4;
  if (cards >= g) return 3;
  if (cards >= 10) return 2;
  return 1;
}

/** 0–49 새싹 · 50–199 루키 · 200–499 레귤러 · 500–999 샤크 · 1000+ 크러셔 */
export function levelName(learned: number): string {
  if (learned >= 1000) return '크러셔';
  if (learned >= 500) return '샤크';
  if (learned >= 200) return '레귤러';
  if (learned >= 50) return '루키';
  return '새싹';
}
