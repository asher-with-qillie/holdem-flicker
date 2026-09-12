/**
 * Training-session store (spec §6.1) — module-level, survives unmount, read with `useSession()` /
 * `useSessionStatus()` (App hides the tab bar while `running`).
 *
 *   idle ──startSession(config)──▶ running: card[i].think ──choose(a) | expire──▶ card[i].reveal ──다음 (choose mode) | expire (노출·순간기억)──▶ i+1
 *     ▲                             │ hold ⇄ overlay (timer frozen, peeked if think)            │ unsure → requeue at min(i+6, end) (≤ 2×)
 *     │                             │ ‖ → paused ⇄ 계속                                          │
 *     │                             ◀────────────────────────── i+1 < queue.length ─────────────┘  else ──▶ summary
 *     └──────── discardSession() ◀───────────────────────────────────────────────────────────────────────┘
 *
 * Choosing (v2.1): the think phase shows the legal actions as buttons. `choose(action)` grades the pick like the
 * quiz (`gradeAnswer`: exact / weight ≥ 0.4 partial / wrong) and rates the card itself — correct or partial → 'know'
 * (partial passes `{ partial: true }` to srs), wrong → 'unsure'; a peeked card (held during think) is always 'unsure'.
 * The think timer running out → `expireThink()`: 시간 초과, rated 'unsure'. 순간기억 / 노출 skip choosing entirely
 * (answer shown, exposure-only write, the 🤔 flag is the only rating). The reveal-state 헷갈려요로 표시 toggle sets
 * `flagged`, which always commits as 'unsure'.
 *
 * Leaving the reveal state: in choose mode the reveal has NO countdown — the card waits for the 다음 button (`next()`,
 * see `awaitsNext`) however the reveal was reached (choice or 시간 초과); `expire()` is a no-op there. 노출 / 순간기억 keep
 * the automatic reveal / expose timer (`expire` → next) unless `config.manual` (직접 넘기기), which waits for ▶.
 *
 * Every card that leaves the screen is committed exactly once: rated → `srs.rate`, flagged → `rate('unsure','button')`,
 * otherwise `recordExposure`; always `logCards(1, {rated, known})`. A card revisited with ◀ and re-rated gets a
 * corrective write (SRS rated again, progress adjusted by the delta) instead of a second full commit.
 *
 * Timers: the rAF countdown lives in the component (`useRafTimer`); the store only owns the short card-transition
 * delay before the next timer starts and the `activeMs` clock, which runs while the session is `running` and
 * neither held nor covered by a sheet / coach mark (manual waiting counts as active — the user is looking at the card).
 *
 * Node-safe: no `window` at import time (the store test runs in plain node).
 */
import { useSyncExternalStore } from 'react';
import { dealCardsFor } from '../../poker/hands';
import type { Step } from '../../poker/trainer';
import type { Action, Card, Pos, ScenarioKind } from '../../poker/types';
import { getProgress, logCards, logSeconds, logSession, setLastResult, type SessionResult } from '../../state/progress';
import { COACH_VERSION, getSettings, vibrate, type DeckId, type SpeedPreset } from '../../state/settings';
import { buildQueue, rate as srsRate, recordExposure, type CardKey, type QueueResult, type RatingSource } from '../../state/srs';
import { gradeAnswer, type Grade } from '../quiz/grade';
import { timingFor, type Origin, type Timing } from './decks';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'summary';
export type Phase = 'think' | 'reveal';
export type Rating = 'know' | 'unsure';

export interface SessionConfig {
  deck: DeckId;
  positions: Pos[];
  scenarioId?: string;
  onlyKeys?: string[];
  size: 10 | 20 | 40;
  speed: SpeedPreset;
  exposure: boolean;
  /** = !settings.autoAdvance (or forced for 헷갈린 것만 다시). */
  manual: boolean;
}

export interface SessionCard {
  /** Unique per queue entry (a requeued copy gets a new id) — used for timer / animation keys. */
  id: number;
  key: CardKey;
  step: Step;
  /** Dealt once per hand chain and kept stable across its steps. */
  cards: [Card, Card];
  origin: Origin;
  /** Steps of one dealt hand share it (StepCrumbs). */
  chainId?: number;
  rating?: Rating;
  ratingSource?: RatingSource;
  /** The action picked with a choice button (think phase). */
  chosenAction?: Action;
  /** Grade of `chosenAction` (quiz rules). */
  grade?: Grade;
  /** Think timer ran out with no choice (시간 초과). */
  timedOut?: boolean;
  peeked?: boolean;
  /** 헷갈려요로 표시 — always commits as 'unsure'. */
  flagged?: boolean;
  /** Committed to srs/progress (left the screen at least once). */
  exposed?: boolean;
  /** What was written at commit time ('none' = exposure only) — for corrective writes after ◀. */
  committedRating?: Rating | 'none';
}

export interface SessionState {
  id: string;
  status: SessionStatus;
  config: SessionConfig;
  timing: Timing;
  queue: SessionCard[];
  index: number;
  phase: Phase;
  startedAt: number;
  /** Accumulated while active (see header). */
  activeMs: number;
  /** key → times requeued (max 2). */
  requeues: Record<string, number>;
  holding: boolean;
  sheetOpen: boolean;
  coachOpen: boolean;
  /** Card transition in progress — the next card's timer waits. */
  settling: boolean;
  cardsAtStart: number;
  streakAtStart: number;
  /** Ended with ✕ before the queue ran out (summary headline `여기까지 {n}장`). */
  endedEarly: boolean;
  result?: SessionResult;
}

const REQUEUE_MAX = 2;
const REQUEUE_GAP = 6;

let state: SessionState | null = null;
let activeSince: number | null = null;
let cardSeq = 0;
let sessionSeq = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const now = () => Date.now();

function isActive(s: SessionState | null): boolean {
  return !!s && s.status === 'running' && !s.holding && !s.sheetOpen && !s.coachOpen;
}

/** Fold the active clock into `activeMs` and (re)start it according to the new state. */
function syncClock(t: number) {
  const active = isActive(state);
  if (active && activeSince === null) activeSince = t;
  else if (!active && activeSince !== null) {
    if (state) state.activeMs += Math.max(0, t - activeSince);
    activeSince = null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

/** Replace the state (immutable for `useSyncExternalStore`), keep the clock in step, notify. */
function commit(patch: Partial<SessionState>) {
  if (!state) return;
  state = { ...state, ...patch };
  syncClock(now());
  emit();
}

function clearPending() {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
}

function schedule(sessionId: string, ms: number, fn: () => void) {
  clearPending();
  pending = setTimeout(() => {
    pending = null;
    if (state && state.id === sessionId) fn();
  }, ms);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => state;

/* ------------------------------------------------------------------------------------------------ reads */

export function useSession(): SessionState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** For App (tab-bar hide) and cheap status checks. */
export function useSessionStatus(): SessionStatus {
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}

function getStatus(): SessionStatus {
  return state ? state.status : 'idle';
}

export function getSession(): SessionState | null {
  return state;
}

export function currentCard(s: SessionState | null = state): SessionCard | undefined {
  return s ? s.queue[s.index] : undefined;
}

/* ------------------------------------------------------------------------------------------------ lifecycle */

export type StartResult = { ok: true } | { ok: false; reason: NonNullable<QueueResult['reason']> };

/** Build the queue (§7.1) and start. Fails (status unchanged) when the deck has no charts / no cards. */
export function startSession(config: SessionConfig, at: number = now()): StartResult {
  const settings = getSettings();
  const progress = getProgress(settings.dailyGoal, at);
  const req = {
    size: config.size,
    deck: config.deck,
    positions: config.positions,
    kinds: settings.kinds,
    mode: 'train' as const,
    interestingBias: settings.interestingBias,
    activeDays: progress.activeDays,
    now: at,
    ...(config.scenarioId ? { scenarioId: config.scenarioId } : {}),
    ...(config.onlyKeys ? { onlyKeys: config.onlyKeys } : {}),
  };
  const q = buildQueue(req);
  if (!q.items.length) return { ok: false, reason: q.reason ?? 'empty' };

  const chainCards = new Map<number, [Card, Card]>();
  const queue: SessionCard[] = q.items.map((it) => {
    let cards = it.chainId !== undefined ? chainCards.get(it.chainId) : undefined;
    if (!cards) {
      cards = dealCardsFor(it.step.hand);
      if (it.chainId !== undefined) chainCards.set(it.chainId, cards);
    }
    const card: SessionCard = { id: ++cardSeq, key: it.key, step: it.step, cards, origin: it.origin };
    if (it.chainId !== undefined) card.chainId = it.chainId;
    return card;
  });

  clearPending();
  if (state) syncClockOff(at);
  const id = `s${at.toString(36)}-${++sessionSeq}`;
  const timing = timingFor(config.speed, settings);
  state = {
    id,
    status: 'running',
    config: { ...config, positions: [...config.positions] },
    timing,
    queue,
    index: 0,
    phase: config.exposure ? 'reveal' : 'think',
    startedAt: at,
    activeMs: 0,
    requeues: {},
    holding: false,
    sheetOpen: false,
    coachOpen: settings.coachSeen < COACH_VERSION,
    settling: true,
    cardsAtStart: progress.today.cards,
    streakAtStart: progress.streak,
    endedEarly: false,
  };
  activeSince = null;
  syncClock(at);
  emit();
  schedule(id, timing.transition, () => commit({ settling: false }));
  return { ok: true };
}

function syncClockOff(t: number) {
  if (activeSince !== null && state) state.activeMs += Math.max(0, t - activeSince);
  activeSince = null;
}

/** Back to idle (홈으로 / a new launch). */
export function discardSession(): void {
  clearPending();
  syncClockOff(now());
  state = null;
  emit();
}

/* ------------------------------------------------------------------------------------------------ flags */

/**
 * Hold-to-pause. Holding during the think phase shows the explanation (answer included) in the held sheet —
 * intended, but the card is marked `peeked` so a later choice commits as 'unsure'. The phase stays 'think'
 * (timer frozen where it was) so the buttons are still there on release.
 */
export function setHolding(holding: boolean): void {
  if (!state || state.status !== 'running' || state.holding === holding) return;
  if (holding) {
    if (state.phase === 'think' && currentCard() && !quiet(state)) updateCard(state.index, { peeked: true });
    commit({ holding: true });
    vibrate(8);
  } else commit({ holding: false });
}

export function setSheetOpen(sheetOpen: boolean): void {
  if (!state || state.sheetOpen === sheetOpen) return;
  commit({ sheetOpen });
}

export function setCoachOpen(coachOpen: boolean): void {
  if (!state || state.coachOpen === coachOpen) return;
  commit({ coachOpen });
}

export function togglePause(): void {
  if (!state) return;
  if (state.status === 'running') commit({ status: 'paused', holding: false });
  else if (state.status === 'paused') commit({ status: 'running' });
}

/* ------------------------------------------------------------------------------------------------ card flow */

function updateCard(i: number, patch: Partial<SessionCard>): SessionCard | undefined {
  if (!state || !state.queue[i]) return undefined;
  const queue = state.queue.slice();
  queue[i] = { ...queue[i], ...patch };
  state = { ...state, queue };
  return queue[i];
}

/** 순간기억 / 노출: no choosing, exposure-only writes (플래그 제외). */
export function quiet(s: SessionState): boolean {
  return s.config.speed === 'flash' || s.config.exposure;
}

/**
 * The revealed card leaves only with 다음 / ▶ (`next()`): always in choose mode (the answer stays until the user
 * has read it), and in 노출 / 순간기억 when 직접 넘기기 (`manual`) is on. Otherwise the reveal / expose timer advances.
 */
export function awaitsNext(s: SessionState): boolean {
  return s.phase === 'reveal' && (!quiet(s) || s.config.manual);
}

function userActive(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.userActivation?.hasBeenActive !== false;
  } catch {
    return true;
  }
}

/** think → reveal without a choice (순간기억 timer, tests). No rating — the card commits as exposure. */
export function revealNow(): void {
  if (!state || state.status !== 'running' || state.phase !== 'think') return;
  if (!quiet(state) && userActive()) vibrate(12);
  commit({ phase: 'reveal' });
}

/**
 * Choice button in the think phase: grade, rate, reveal. Correct / partial → 'know' (partial noted for srs),
 * wrong → 'unsure'; a peeked card is 'unsure' whatever was picked. Not available in 순간기억 / 노출.
 * Nothing is scheduled: the card stays revealed until `next()` (다음).
 */
export function choose(action: Action): boolean {
  if (!state || state.status !== 'running' || state.phase !== 'think' || quiet(state)) return false;
  const card = currentCard();
  if (!card || card.chosenAction || card.timedOut) return false;
  const grade = gradeAnswer(card.step, action);
  const rating: Rating = grade === 'wrong' || card.peeked ? 'unsure' : 'know';
  updateCard(state.index, { chosenAction: action, grade, rating, ratingSource: 'button' });
  if (userActive()) vibrate(rating === 'know' ? 10 : [18, 30, 18]);
  commit({ phase: 'reveal' });
  return true;
}

/**
 * Think timer ran out with no choice: 시간 초과 → reveal, rated 'unsure' (not in 순간기억 / 노출: exposure only).
 * Like a choice, the 시간 초과 reveal waits for `next()` (다음).
 */
export function expireThink(): void {
  if (!state || state.status !== 'running' || state.phase !== 'think') return;
  if (quiet(state)) {
    revealNow();
    return;
  }
  const card = currentCard();
  if (!card) return;
  updateCard(state.index, { timedOut: true, rating: 'unsure', ratingSource: 'button' });
  if (userActive()) vibrate([18, 30, 18]);
  commit({ phase: 'reveal' });
}

/** Toggle 헷갈려요로 표시 (🤔). A flagged card always commits as 'unsure' (also when the choice was correct). */
export function flagToggle(): void {
  if (!state || state.status !== 'running') return;
  const card = currentCard();
  if (!card) return;
  const flagged = !card.flagged;
  updateCard(state.index, { flagged });
  if (flagged) vibrate([18, 30, 18]);
  commit({});
}

/**
 * Explicit rating of the revealed card (keyboard / tests / corrective ◀ path) — advances at once.
 * `know` on a peeked card is refused (§5.4 peeked rule).
 */
export function rateCard(rating: Rating, source: RatingSource): boolean {
  if (!state || state.status !== 'running') return false;
  const card = currentCard();
  if (!card || state.phase !== 'reveal') return false;
  if (rating === 'know' && card.peeked) return false;
  updateCard(state.index, { rating, ratingSource: source, flagged: rating === 'unsure' ? card.flagged : false });
  vibrate(rating === 'know' ? 10 : [18, 30, 18]);
  commit({});
  advance();
  return true;
}

/**
 * Timer expiry: think → 시간 초과 reveal (or plain reveal in quiet modes); reveal → next only where a reveal timer
 * runs (노출 / 순간기억 without 직접 넘기기). A revealed card in choose mode ignores it — only 다음 leaves it.
 */
export function expire(): void {
  if (!state || state.status !== 'running') return;
  if (state.phase === 'think' && !state.config.exposure) expireThink();
  else if (awaitsNext(state)) return;
  else advance();
}

/** 다음 / ▶ in reveal (or a skip while thinking): leave the current card now. */
export function next(): void {
  if (!state || state.status !== 'running') return;
  advance();
}

/** ◀: previous card in reveal phase so its rating can be changed (until summary). */
export function prev(): void {
  if (!state || state.status !== 'running' || state.index === 0) return;
  clearPending();
  const id = state.id;
  commit({ index: state.index - 1, phase: 'reveal', settling: true, holding: false });
  schedule(id, state.timing.transition, () => commit({ settling: false }));
}

/** Write the card's outcome to srs + progress (once), or the delta of a changed rating. */
function leaveCard(i: number, at: number) {
  if (!state) return;
  const card = state.queue[i];
  if (!card) return;
  const rating: Rating | undefined = card.flagged ? 'unsure' : card.rating;
  const source: RatingSource = card.rating ? (card.ratingSource ?? 'button') : 'button';
  const partial = rating === 'know' && card.grade === 'partial';
  const opts = { now: at, ...(card.peeked ? { peeked: true } : {}), ...(partial ? { partial: true } : {}) };
  if (!card.exposed) {
    if (rating) srsRate(card.step, rating, source, opts);
    else recordExposure(card.step, at);
    logCards(1, { rated: rating ? 1 : 0, known: rating === 'know' ? 1 : 0, ts: at });
    updateCard(i, { exposed: true, committedRating: rating ?? 'none' });
    return;
  }
  const before = card.committedRating ?? 'none';
  const after = rating ?? 'none';
  if (before === after) return;
  if (rating) srsRate(card.step, rating, source, opts);
  logCards(0, { rated: before === 'none' ? 1 : 0, known: (after === 'know' ? 1 : 0) - (before === 'know' ? 1 : 0), ts: at });
  updateCard(i, { committedRating: after });
}

function advance() {
  if (!state || state.status !== 'running') return;
  clearPending();
  const at = now();
  const i = state.index;
  leaveCard(i, at);
  const card = state.queue[i];
  const isUnsure = card.rating === 'unsure' || !!card.flagged;
  let queue = state.queue;
  const requeues = { ...state.requeues };
  if (isUnsure && (requeues[card.key] ?? 0) < REQUEUE_MAX) {
    requeues[card.key] = (requeues[card.key] ?? 0) + 1;
    const copy: SessionCard = { id: ++cardSeq, key: card.key, step: card.step, cards: card.cards, origin: 'requeue' };
    if (card.chainId !== undefined) copy.chainId = card.chainId;
    queue = queue.slice();
    queue.splice(Math.min(i + REQUEUE_GAP, queue.length), 0, copy);
  }
  if (i + 1 < queue.length) {
    const id = state.id;
    commit({ queue, requeues, index: i + 1, phase: state.config.exposure ? 'reveal' : 'think', settling: true, holding: false });
    schedule(id, state.timing.transition, () => commit({ settling: false }));
  } else {
    state = { ...state, queue, requeues };
    finish(at);
  }
}

/* ------------------------------------------------------------------------------------------------ summary */

/** ✕ 끝내기 / natural end: commit what was seen, write progress, status 'summary'. Idempotent once in summary. */
export function endSession(): SessionResult | null {
  if (!state) return null;
  if (state.status === 'summary') return state.result ?? null;
  clearPending();
  const at = now();
  const card = currentCard();
  if (card && state.phase === 'reveal' && !card.exposed) leaveCard(state.index, at); // the answer was shown → it counts
  state = { ...state, endedEarly: true };
  return finish(at);
}

function finish(at: number): SessionResult {
  const s = state!;
  const settings = getSettings();
  syncClockOff(at);
  const seen = s.queue.filter((c) => c.exposed);
  const rated = seen.filter((c) => c.committedRating === 'know' || c.committedRating === 'unsure');
  const known = rated.filter((c) => c.committedRating === 'know').length;
  const unsure = rated.length - known;
  const byOrigin = { new: 0, review: 0, unsure: 0 };
  const buckets = new Map<string, { kind: ScenarioKind; hero: Pos; unsure: number; shown: number }>();
  const unsureKeys: CardKey[] = [];
  const restKeys: CardKey[] = [];
  const seenKeys = new Set<CardKey>();
  for (const c of seen) {
    if (c.origin === 'new') byOrigin.new += 1;
    else if (c.origin === 'unsure' || c.origin === 'requeue') byOrigin.unsure += 1;
    else byOrigin.review += 1;
    const id = `${c.step.scenario.kind}:${c.step.scenario.hero}`;
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { kind: c.step.scenario.kind, hero: c.step.scenario.hero, unsure: 0, shown: 0 }));
    b.shown += 1;
    if (c.committedRating === 'unsure') b.unsure += 1;
    if (c.committedRating === 'unsure' && !unsureKeys.includes(c.key)) unsureKeys.push(c.key);
    seenKeys.add(c.key);
  }
  for (const k of seenKeys) if (!unsureKeys.includes(k)) restKeys.push(k);
  let weakest: SessionResult['weakest'];
  for (const b of buckets.values()) {
    if (!b.unsure) continue;
    if (!weakest || b.unsure / b.shown > weakest.unsure / weakest.shown || (b.unsure / b.shown === weakest.unsure / weakest.shown && b.unsure > weakest.unsure)) weakest = { ...b };
  }

  logSeconds(Math.round(s.activeMs / 1000), at);
  logSession(at);
  const after = getProgress(settings.dailyGoal, at);
  const goalReachedNow = s.cardsAtStart < settings.dailyGoal && after.today.cards >= settings.dailyGoal;
  const result: SessionResult = {
    id: s.id,
    mode: 'train',
    startedAt: s.startedAt,
    endedAt: at,
    activeMs: s.activeMs,
    config: { deck: s.config.deck, positions: [...s.config.positions], size: s.config.size, speed: s.config.speed, exposure: s.config.exposure, manual: s.config.manual },
    seen: seen.length,
    rated: rated.length,
    known,
    unsure,
    exposureOnly: quiet(s),
    byOrigin,
    unsureKeys,
    allKeys: [...unsureKeys, ...restKeys],
    goalReachedNow,
    streakBefore: s.streakAtStart,
    streakAfter: after.streak,
  };
  if (weakest) result.weakest = weakest;
  setLastResult(result);

  if (goalReachedNow) vibrate([30, 60, 30]);
  else if (after.streak > s.streakAtStart) vibrate([12, 60, 12]);
  else vibrate([10, 40, 10, 40]);

  state = { ...s, status: 'summary', holding: false, sheetOpen: false, coachOpen: false, settling: false, result };
  emit();
  return result;
}

/** Test hook: drop everything (also cancels timers). */
export function resetSessionStore(): void {
  clearPending();
  state = null;
  activeSince = null;
  emit();
}
