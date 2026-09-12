/**
 * Quiz round store (owner D) — spec §5.7. Module-level so a round survives the screen unmounting
 * (the tab bar is hidden while a round runs, but the pushed 설정 screen or a StrictMode remount must
 * not lose it). Read with `useQuizRound()`; `useQuizActive()` is what App / the screen use to hide the
 * floating tab bar (§3).
 *
 *   startRound(config)   buildQueue({ size: 10, mode: 'quiz', … }) → status 'running'
 *   answer(action)       grades once per question and writes stats + srs + progress exactly once
 *   next()               index + 1, or → summary after the last question
 *   endRound()           ✕: summary with the partial headline (nothing answered → back to idle)
 *   discardRound()       summary dismissed → idle
 *
 * Writes per answer (spec §5.7 / §7): `recordAnswer(kind, correct, mistake?)` (stats, partial counts as
 * correct and only wrong answers become 최근 실수 entries — unchanged from v1), `rate(step, know | unsure,
 * 'quiz', { partial, chosen })` (srs quiz channel) and `logQuiz(correct)` (progress; a question is a card).
 * At summary time: `logSeconds`, `logSession`, `setLastResult` (mode 'quiz').
 *
 * Round source: `buildQueue` (due / weak first, then single-step new cards). When the queue comes back
 * short and no `onlyKeys` were given, the rest is drawn with `randomQuizStep` so a round is always 10
 * whenever the deck × positions has charts. `onlyKeys` rounds (퀴즈로 확인 from the trainer summary) keep
 * the given order and size.
 */
import { useSyncExternalStore } from 'react';
import { dealCardsFor } from '../../poker/hands';
import { scenarioKey, scenarioTitle } from '../../poker/scenarios';
import { feasiblePositions, randomQuizStep, type SessionOptions, type Step } from '../../poker/trainer';
import { POSITIONS, type Action, type Card, type Pos, type ScenarioKind } from '../../poker/types';
import { getProgress, logQuiz, logSeconds, logSession, setLastResult, type SessionResult } from '../../state/progress';
import { getSettings, vibrate, type DeckId } from '../../state/settings';
import { buildQueue, cardKey, rate, type CardKey, type QueueItem } from '../../state/srs';
import { recordAnswer } from '../../state/stats';
import { deckKinds } from './DeckChips';
import { gradeAnswer, type Grade } from './grade';

export const ROUND_SIZE = 10;
/** Extra `randomQuizStep` draws allowed while topping a short queue up to `ROUND_SIZE`. */
const FILL_ATTEMPTS = 40;

export type QuizStatus = 'idle' | 'running' | 'summary';
export type QuizOrigin = QueueItem['origin'];

export interface QuizQuestion {
  key: CardKey;
  step: Step;
  /** Dealt once per question so the suits do not reshuffle on re-render. */
  cards: [Card, Card];
  origin: QuizOrigin;
  chosen?: Action;
  grade?: Grade;
}

export interface QuizRoundConfig {
  deck: DeckId;
  positions: Pos[];
  /** With deck 'scenario' (e.g. "vs_open:BB:BTN"). */
  scenarioId?: string;
  /** Exact keys in order (퀴즈로 확인 / 헷갈린 것만 다시); the round size is then the key count. */
  onlyKeys?: CardKey[];
}

export interface QuizResult {
  headline: string;
  partial: boolean;
  seen: number;
  size: number;
  durationMs: number;
  correct: number;
  partialCount: number;
  wrong: number;
  /** Longest run of correct (exact or partial) answers in this round. */
  bestStreak: number;
  byOrigin: { new: number; review: number; unsure: number };
  wrongKeys: CardKey[];
  allKeys: CardKey[];
  goalToday: number;
  goal: number;
  goalReachedNow: boolean;
  streak: number;
  streakIncremented: boolean;
  weekDots: boolean[];
  weakest?: { kind: ScenarioKind; hero: Pos; unsure: number; shown: number };
  /** Wrong answers in round order (chosen vs answer for the summary sheet). */
  mistakes: QuizQuestion[];
}

export interface QuizRound {
  id: number;
  status: QuizStatus;
  config: QuizRoundConfig;
  queue: QuizQuestion[];
  index: number;
  startedAt: number;
  correct: number;
  partial: number;
  wrong: number;
  /** Current run of non-wrong answers (HUD "연속"). */
  streak: number;
  bestStreak: number;
  goalBefore: boolean;
  streakBefore: number;
  result?: QuizResult;
}

export type StartResult = 'ok' | 'no_charts' | 'empty';

let round: QuizRound | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function commit(next: QuizRound | null) {
  round = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => round;
const getActive = () => round?.status === 'running';

export function useQuizRound(): QuizRound | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** true while a round is running (App hides the tab bar, §3). */
export function useQuizActive(): boolean {
  return useSyncExternalStore(subscribe, getActive, getActive);
}

/** Non-hook read (event handlers, tests). */
export function getQuizRound(): QuizRound | null {
  return round;
}

/* ------------------------------------------------------------------------------------------------
 * Round source
 * ---------------------------------------------------------------------------------------------- */

function toQuestion(key: CardKey, step: Step, origin: QuizOrigin): QuizQuestion {
  return { key, step, cards: dealCardsFor(step.hand), origin };
}

/** Engine options for the deck (used for the feasibility check and the random fill). */
export function quizOptions(config: Pick<QuizRoundConfig, 'deck' | 'positions'>): SessionOptions {
  const s = getSettings();
  const positions = config.positions.length ? config.positions : [...POSITIONS];
  return { positions, kinds: deckKinds(config.deck, s.kinds), interestingBias: s.interestingBias };
}

function draw(config: QuizRoundConfig, now: number): QuizQuestion[] | StartResult {
  const s = getSettings();
  const positions = config.positions.length ? config.positions : [...POSITIONS];
  const req = {
    size: ROUND_SIZE,
    deck: config.deck,
    positions,
    kinds: s.kinds,
    mode: 'quiz' as const,
    interestingBias: s.interestingBias,
    activeDays: getProgress(s.dailyGoal, now).activeDays,
    now,
    ...(config.scenarioId ? { scenarioId: config.scenarioId } : {}),
    ...(config.onlyKeys ? { onlyKeys: config.onlyKeys } : {}),
  };
  const built = buildQueue(req);
  const items = built.items.map((it) => toQuestion(it.key, it.step, it.origin));
  if (config.onlyKeys || config.deck === 'scenario') return items.length ? items : built.reason === 'no_charts' ? 'no_charts' : 'empty';
  if (built.reason === 'no_charts') return 'no_charts';

  // Short queue (few records yet, weak deck smaller than a round, engine exhausted…) → random single steps.
  if (items.length < ROUND_SIZE) {
    const opts = quizOptions(config);
    if (!feasiblePositions(opts).length) return items.length ? items : 'no_charts';
    const seen = new Set(items.map((q) => q.key));
    for (let attempt = 0; attempt < FILL_ATTEMPTS && items.length < ROUND_SIZE; attempt++) {
      let step: Step;
      try {
        step = randomQuizStep(opts);
      } catch {
        break;
      }
      const key = cardKey(step);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(toQuestion(key, step, 'new'));
    }
  }
  return items.length ? items : 'empty';
}

/** Build a round and start it. 'no_charts' / 'empty' leave the store untouched. */
export function startRound(config: QuizRoundConfig, now: number = Date.now()): StartResult {
  const queue = draw(config, now);
  if (typeof queue === 'string') return queue;
  const s = getSettings();
  const p = getProgress(s.dailyGoal, now);
  commit({
    id: ++seq,
    status: 'running',
    config,
    queue,
    index: 0,
    startedAt: now,
    correct: 0,
    partial: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    goalBefore: p.goalReachedToday,
    streakBefore: p.streak,
  });
  return 'ok';
}

/* ------------------------------------------------------------------------------------------------
 * Answering
 * ---------------------------------------------------------------------------------------------- */

/** Grade the current question. No-op when the round is not running or the question is already answered. */
export function answer(action: Action, now: number = Date.now()): Grade | null {
  const r = round;
  if (!r || r.status !== 'running') return null;
  const q = r.queue[r.index];
  if (!q || q.grade) return null;

  const { step } = q;
  const g = gradeAnswer(step, action);
  const correct = g !== 'wrong';
  const s = step.scenario;

  // Each store exactly once per answer (§5.7 / §10 D checklist).
  recordAnswer(s.kind, correct, correct ? undefined : { scenarioId: scenarioKey(s), title: scenarioTitle(s), hand: step.hand, answer: step.answer, chosen: action });
  rate(step, correct ? 'know' : 'unsure', 'quiz', correct ? { partial: g === 'partial', now } : { chosen: action, now });
  logQuiz(correct, now);
  vibrate(correct ? 12 : [30, 40, 30]);

  const queue = r.queue.slice();
  queue[r.index] = { ...q, chosen: action, grade: g };
  const streak = correct ? r.streak + 1 : 0;
  commit({
    ...r,
    queue,
    correct: r.correct + (g === 'correct' ? 1 : 0),
    partial: r.partial + (g === 'partial' ? 1 : 0),
    wrong: r.wrong + (g === 'wrong' ? 1 : 0),
    streak,
    bestStreak: Math.max(r.bestStreak, streak),
  });
  return g;
}

/** Advance after an answer; the last question ends the round. */
export function next(now: number = Date.now()): void {
  const r = round;
  if (!r || r.status !== 'running') return;
  if (r.index + 1 < r.queue.length) commit({ ...r, index: r.index + 1 });
  else finish(false, now);
}

/** ✕: end early. With nothing answered there is nothing to summarize → idle. */
export function endRound(now: number = Date.now()): void {
  const r = round;
  if (!r || r.status !== 'running') return;
  const answered = r.queue.filter((q) => q.grade).length;
  if (!answered) {
    commit(null);
    return;
  }
  finish(answered < r.queue.length, now);
}

export function discardRound(): void {
  if (round) commit(null);
}

/* ------------------------------------------------------------------------------------------------
 * Summary
 * ---------------------------------------------------------------------------------------------- */

function weakestOf(answered: QuizQuestion[]): QuizResult['weakest'] {
  const buckets = new Map<string, { kind: ScenarioKind; hero: Pos; unsure: number; shown: number }>();
  for (const q of answered) {
    const id = `${q.step.scenario.kind}:${q.step.scenario.hero}`;
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { kind: q.step.scenario.kind, hero: q.step.scenario.hero, unsure: 0, shown: 0 }));
    b.shown += 1;
    if (q.grade === 'wrong') b.unsure += 1;
  }
  let best: QuizResult['weakest'];
  for (const b of buckets.values()) {
    if (b.unsure < 2) continue;
    if (!best || b.unsure > best.unsure || (b.unsure === best.unsure && b.shown < best.shown)) best = b;
  }
  return best;
}

function finish(partial: boolean, now: number) {
  const r = round;
  if (!r) return;
  const s = getSettings();
  const answered = r.queue.filter((q) => q.grade);
  const seen = answered.length;
  const activeMs = Math.max(0, now - r.startedAt);
  const mistakes = answered.filter((q) => q.grade === 'wrong');
  const wrongKeys = mistakes.map((q) => q.key);
  const allKeys = answered.map((q) => q.key);
  const byOrigin = { new: 0, review: 0, unsure: 0 };
  for (const q of answered) {
    if (q.origin === 'new') byOrigin.new += 1;
    else if (q.origin === 'unsure') byOrigin.unsure += 1;
    else byOrigin.review += 1;
  }
  const weakest = weakestOf(answered);

  logSeconds(Math.round(activeMs / 1000), now);
  logSession(now);
  const p = getProgress(s.dailyGoal, now);
  const goalReachedNow = !r.goalBefore && p.goalReachedToday;

  const sessionResult: SessionResult = {
    id: `quiz-${r.id}-${r.startedAt}`,
    mode: 'quiz',
    startedAt: r.startedAt,
    endedAt: now,
    activeMs,
    config: { deck: r.config.deck, positions: r.config.positions, size: r.queue.length, speed: s.speedPreset, exposure: false, manual: !s.autoAdvance },
    seen,
    rated: seen,
    known: r.correct + r.partial,
    unsure: r.wrong,
    exposureOnly: false,
    byOrigin,
    unsureKeys: wrongKeys,
    allKeys,
    goalReachedNow,
    streakBefore: r.streakBefore,
    streakAfter: p.streak,
  };
  if (weakest) sessionResult.weakest = weakest;
  setLastResult(sessionResult);

  const result: QuizResult = {
    headline: partial ? `여기까지 ${seen}장` : '퀴즈 끝!',
    partial,
    seen,
    size: r.queue.length,
    durationMs: activeMs,
    correct: r.correct,
    partialCount: r.partial,
    wrong: r.wrong,
    bestStreak: r.bestStreak,
    byOrigin,
    wrongKeys,
    allKeys,
    goalToday: p.today.cards,
    goal: s.dailyGoal,
    goalReachedNow,
    streak: p.streak,
    streakIncremented: p.streak > r.streakBefore,
    weekDots: p.weekDots,
    mistakes,
  };
  if (weakest) result.weakest = weakest;
  vibrate([10, 40, 10, 40]);
  commit({ ...r, status: 'summary', result });
}
