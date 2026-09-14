/**
 * Spaced-repetition store (owner C) — spec §6.4 focus decks / queue and §7.1.
 *
 * One record per card key (`${scenarioKey}|${hand}`), fed by three channels: exposure (a card shown and
 * left unrated), rating (swipe / button / chart sheet) and quiz. Module-level state, `useSrs()` is a
 * `useSyncExternalStore` version counter, persistence is a debounced (300 ms) write-through to
 * `localStorage['holdem-flicker.srs.v1']`, flushed on `pagehide` / hidden visibility. Every storage access
 * is guarded, nothing touches `window` at import time, so the module runs in plain node.
 *
 * Decisions where the spec left room (all additive / documented):
 *  - `DeckId` is declared here as well (settings.ts / nav.ts belong to owner A); it is structurally the
 *    same union, so either import works once both land.
 *  - Fuzz: `intervalDays` always stores the unfuzzed integer; the deterministic ±10 % fuzz (`fuzz(key)`,
 *    intervals ≥ 3 d only) is applied to `due`. The §7.1 table writes `× fuzz` inside the review row but
 *    keeps `intervalDays 3` unfuzzed in the learning row — one rule for every row keeps `round(i × ease)`,
 *    the relearn halving and the "learned = intervalDays ≥ 7" threshold on clean integers and stops the
 *    fuzz from compounding. The cap is applied before the fuzz (`min(60, …) × fuzz` ⇒ due ≤ 66 d).
 *  - `partial` (quiz weight ≥ 0.4): know without the ease bonus, base interval × 0.8 rounded, min 1 day.
 *  - `rate(..., 'quiz')` accepts `opts.chosen` (the wrong action) to fill `lastWrongAction`; the spec
 *    signature had no slot for it. `recordExposure(step, now?)` takes an optional clock for tests.
 *  - Every `rate()` and `recordExposure()` counts one exposure (`exposures + 1`, `lastSeen = now`); a
 *    peeked 알아요 is exposure-only (no state change, `lastRating` untouched).
 *  - Persisted format packs each record into a tuple (kind/hero/villain/hand come from the key) so
 *    5 000 rated cards stay well under 1 MB. The in-memory shape is the spec's `SrsStore`.
 *  - `weakSpots.quizAcc` reads `stats.byKind` straight from `localStorage['holdem-flicker.stats.v1']`
 *    (stats.ts is read-only for every owner and exposes no getter); the `now` argument is reserved.
 *  - Queue: `QueueRequest.rng` (optional) seeds the engine; the order shuffle is seeded by `now`.
 *    `counts.due` includes `quizWrong` items (both are shown as 복습 in the previews). `chainId` is set
 *    only on chains that kept ≥ 2 steps. Deck `weak` uses the §6.4 pool (weak set ∩ positions, sorted
 *    lapses desc / due asc, no due filter) and deals new cards only from the weak kinds × weak heroes;
 *    deck `scenario` ignores `positions` (the scenario names its hero). Chains longer than the remaining
 *    room (+2) are skipped, never truncated, so `chainId` groups stay whole.
 *  - `flushSrs()` is exported so the trainer can persist at summary time and tests can assert storage.
 */
import { useSyncExternalStore } from 'react';
import { getChartCells, hasChart } from '../poker/data';
import { ALL_HANDS, dealWeightedHand, gridHand, pick, random } from '../poker/hands';
import { continueWeights } from '../poker/range';
import { allScenarios, positionsBefore, scenarioKey } from '../poker/scenarios';
import { feasiblePositions, nextHandSequence, stepFor, type SessionOptions, type Step } from '../poker/trainer';
import { ACTIONS, POSITIONS, SCENARIO_KINDS, type Action, type HandName, type Pos, type Scenario, type ScenarioKind } from '../poker/types';

export type DeckId = 'all' | 'rfi' | 'vs_open' | 'vs_3bet' | 'vs_4bet_allin' | 'weak' | 'scenario';

export type CardKey = string; // `${scenarioKey(scenario)}|${hand}` e.g. "vs_open:BB:BTN|KTo", "cold_4bet:CO|AQs"
export type Rating = 'know' | 'unsure';
export type RatingSource = 'swipe' | 'button' | 'quiz' | 'chart';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface SrsCard {
  key: CardKey;
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
  hand: HandName;
  answer: Action;
  /** 'new' = record exists (exposed) but never rated. */
  state: CardState;
  /** 1.3 .. 2.8, starts 2.3. */
  ease: number;
  /** 0 until the first 'know'; kept through a lapse (used for the relearn halving). Unfuzzed integer. */
  intervalDays: number;
  /** epoch ms */
  due: number;
  /** 'know' count */
  reps: number;
  /** 'unsure' count (any source) */
  lapses: number;
  /** every full showing, rated or not */
  exposures: number;
  quizWrong: number;
  /** 퀴즈에서 이 카드로 답을 낸 횟수. 코치 탭 성향 축의 분모 — 노출(exposures)과 달리 '답을 낸 것'만 셉니다. */
  quizSeen: number;
  /** 훈련에서 선택 버튼으로 답을 낸 횟수. 노출 모드·스와이프 평가는 방향이 없으므로 세지 않습니다. */
  pickSeen: number;
  quizWrongAt?: number;
  lastWrongAction?: Action;
  lastRating?: Rating;
  lastSeen: number;
}

export interface SrsStore {
  version: 1;
  cards: Record<CardKey, SrsCard>;
}

const KEY = 'holdem-flicker.srs.v1';
const STATS_KEY = 'holdem-flicker.stats.v1';
const DAY = 86_400_000;
const TEN_MIN = 600_000;
const EASE_START = 2.3;
const EASE_MIN = 1.3;
const EASE_MAX = 2.8;
const MAX_INTERVAL_DAYS = 60;
const LEARNED_DAYS = 7;
const WEAK_EASE = 1.8;
const WEAK_QUIZ_WINDOW = 30 * DAY;
const QUIZ_WRONG_WINDOW = 7 * DAY;
const ENGINE_CALL_CAP = 60;
const FIRST_WEEK_DAYS = 7;
const FIRST_WEEK_NEW_CAP = 10;
const WRITE_DEBOUNCE_MS = 300;

export const DECK_KINDS: Record<Exclude<DeckId, 'weak' | 'scenario' | 'all'>, ScenarioKind[]> = {
  rfi: ['rfi'],
  vs_open: ['vs_open'],
  vs_3bet: ['vs_3bet'],
  vs_4bet_allin: ['vs_4bet', 'vs_5bet', 'cold_4bet'],
};

/* ------------------------------------------------------------------------------------------------
 * Keys
 * ---------------------------------------------------------------------------------------------- */

const KIND_SET = new Set<string>(SCENARIO_KINDS);
const POS_SET = new Set<string>(POSITIONS);

function coldExtras(hero: Pos): Scenario['extras'] {
  const before = positionsBefore(hero);
  return before.length >= 2 ? { opener: before[0], threeBettor: before[before.length - 1] } : undefined;
}

/** Parse "kind:hero[:villain]" (the `scenarioId` format). Throws on malformed input. */
function parseScenarioId(id: string): Scenario {
  const [kind, hero, villain, ...rest] = id.split(':');
  if (!kind || !hero || rest.length || !KIND_SET.has(kind) || !POS_SET.has(hero) || (villain !== undefined && !POS_SET.has(villain))) {
    throw new Error(`Bad scenario id "${id}"`);
  }
  const s: Scenario = { kind: kind as ScenarioKind, hero: hero as Pos };
  if (villain) s.villain = villain as Pos;
  if (s.kind === 'cold_4bet') s.extras = coldExtras(s.hero);
  return s;
}

export function cardKeyOf(scenario: Scenario, hand: HandName): CardKey {
  return `${scenarioKey(scenario)}|${hand}`;
}

export function cardKey(step: Step): CardKey {
  return cardKeyOf(step.scenario, step.hand);
}

/** Inverse of `cardKeyOf`. cold_4bet gets `extras = { opener: first before hero, threeBettor: last before hero }`. */
export function parseCardKey(key: CardKey): { scenario: Scenario; hand: HandName } {
  const bar = key.indexOf('|');
  if (bar <= 0 || bar === key.length - 1) throw new Error(`Bad card key "${key}"`);
  const hand = key.slice(bar + 1);
  if (!ALL_HANDS.includes(hand)) throw new Error(`Bad hand in card key "${key}"`);
  return { scenario: parseScenarioId(key.slice(0, bar)), hand };
}

/** `stepFor(parse)` guarded by `hasChart`; null for malformed keys or missing charts. */
export function stepForKey(key: CardKey): Step | null {
  try {
    const { scenario, hand } = parseCardKey(key);
    if (!hasChart(scenario)) return null;
    return stepFor(scenario, hand);
  } catch {
    return null;
  }
}

function scenarioPart(key: CardKey): string {
  const bar = key.indexOf('|');
  return bar < 0 ? key : key.slice(0, bar);
}

/* ------------------------------------------------------------------------------------------------
 * Persistence (compact tuples) + change notification
 * ---------------------------------------------------------------------------------------------- */

const STATE_CODES: CardState[] = ['new', 'learning', 'review', 'relearning'];
const RATING_CODES: Array<Rating | undefined> = [undefined, 'know', 'unsure'];

/** [state, ease, intervalDays, due, reps, lapses, exposures, quizWrong, quizWrongAt, lastWrongAction, lastRating, lastSeen, answer, quizSeen, pickSeen]
 *  13·14번은 나중에 붙었습니다 — unpack 가드가 `length < 13`이라 예전 13칸 데이터도 그대로 읽히고 두 값만 0이 됩니다. */
type Packed = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

function pack(c: SrsCard): Packed {
  return [
    STATE_CODES.indexOf(c.state),
    c.ease,
    c.intervalDays,
    c.due,
    c.reps,
    c.lapses,
    c.exposures,
    c.quizWrong,
    c.quizWrongAt ?? 0,
    c.lastWrongAction ? ACTIONS.indexOf(c.lastWrongAction) : -1,
    c.lastRating ? RATING_CODES.indexOf(c.lastRating) : 0,
    c.lastSeen,
    ACTIONS.indexOf(c.answer),
    c.quizSeen,
    c.pickSeen,
  ];
}

function unpack(key: CardKey, p: unknown): SrsCard | null {
  if (!Array.isArray(p) || p.length < 13) return null;
  try {
    const { scenario, hand } = parseCardKey(key);
    const n = (i: number, fallback = 0) => (typeof p[i] === 'number' && Number.isFinite(p[i]) ? (p[i] as number) : fallback);
    const card: SrsCard = {
      key,
      kind: scenario.kind,
      hero: scenario.hero,
      hand,
      answer: ACTIONS[n(12)] ?? 'fold',
      state: STATE_CODES[n(0)] ?? 'new',
      ease: clampEase(n(1, EASE_START)),
      intervalDays: n(2),
      due: n(3),
      reps: n(4),
      lapses: n(5),
      exposures: n(6),
      quizWrong: n(7),
      quizSeen: n(13),
      pickSeen: n(14),
      lastSeen: n(11),
    };
    if (scenario.villain) card.villain = scenario.villain;
    const wrongAt = n(8);
    if (wrongAt > 0) card.quizWrongAt = wrongAt;
    const wrongIdx = n(9, -1);
    if (wrongIdx >= 0 && ACTIONS[wrongIdx]) card.lastWrongAction = ACTIONS[wrongIdx];
    const rating = RATING_CODES[n(10)];
    if (rating) card.lastRating = rating;
    return card;
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function load(): SrsStore {
  const cards: Record<CardKey, SrsCard> = {};
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: number; c?: Record<string, unknown> } | null;
      if (parsed && parsed.v === 1 && parsed.c && typeof parsed.c === 'object') {
        for (const [key, p] of Object.entries(parsed.c)) {
          const card = unpack(key, p);
          if (card) cards[key] = card;
        }
      }
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return { version: 1, cards };
}

function serialize(): string {
  const c: Record<CardKey, Packed> = {};
  for (const [key, card] of Object.entries(store.cards)) c[key] = pack(card);
  return JSON.stringify({ v: 1, c });
}

let store: SrsStore = load();
let version = 0;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** Write pending changes to storage now (also runs on pagehide / hidden visibility). */
export function flushSrs(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    storage()?.setItem(KEY, serialize());
  } catch {
    /* ignore quota / unavailable storage */
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer !== null) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushSrs();
  }, WRITE_DEBOUNCE_MS);
}

function touch() {
  version += 1;
  scheduleWrite();
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushSrs);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSrs();
    });
  }
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

/** Version counter; components re-render on any change. */
export function useSrs(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export function resetSrs(): void {
  store = { version: 1, cards: {} };
  touch();
  flushSrs();
}

/* ------------------------------------------------------------------------------------------------
 * Records + scheduling
 * ---------------------------------------------------------------------------------------------- */

function clampEase(e: number): number {
  return Math.round(Math.min(EASE_MAX, Math.max(EASE_MIN, e)) * 1000) / 1000;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic ±10 % per key: 1 + ((hash % 21) − 10) / 100. */
export function fuzz(key: CardKey): number {
  return 1 + ((hash(key) % 21) - 10) / 100;
}

function dueAfterDays(key: CardKey, days: number, now: number): number {
  return Math.round(now + days * DAY * (days >= 3 ? fuzz(key) : 1));
}

function ensure(step: Step, now: number): SrsCard {
  const key = cardKey(step);
  let card = store.cards[key];
  if (!card) {
    card = {
      key,
      kind: step.scenario.kind,
      hero: step.scenario.hero,
      hand: step.hand,
      answer: step.answer,
      state: 'new',
      ease: EASE_START,
      intervalDays: 0,
      due: now,
      reps: 0,
      lapses: 0,
      exposures: 0,
      quizWrong: 0,
      quizSeen: 0,
      pickSeen: 0,
      lastSeen: now,
    };
    if (step.scenario.villain) card.villain = step.scenario.villain;
    store.cards[key] = card;
  }
  return card;
}

/** 저장된 카드 전체의 얕은 복사본. 코치 탭이 기준선(받은 문제의 폴드-정답 비중)을 구할 때 씁니다. */
export function allCards(): SrsCard[] {
  return Object.values(store.cards).map((c) => ({ ...c }));
}

export function getCard(key: CardKey): SrsCard | undefined {
  const c = store.cards[key];
  return c ? { ...c } : undefined;
}

/** Creates the record if missing (state 'new'); `exposures + 1`, `lastSeen = now`, state untouched. */
export function recordExposure(step: Step, now: number = Date.now()): SrsCard {
  const card = ensure(step, now);
  card.exposures += 1;
  card.lastSeen = now;
  touch();
  return { ...card };
}

function applyKnow(card: SrsCard, now: number, partial: boolean) {
  let base: number;
  switch (card.state) {
    case 'new':
      base = 1;
      card.state = 'learning';
      break;
    case 'learning':
      base = 3;
      card.state = 'review';
      break;
    case 'review':
      base = Math.min(MAX_INTERVAL_DAYS, Math.max(card.intervalDays + 1, Math.round(card.intervalDays * card.ease)));
      if (!partial) card.ease = clampEase(card.ease + 0.05);
      break;
    case 'relearning':
      base = Math.max(1, Math.round(card.intervalDays * 0.5));
      card.state = 'review';
      break;
  }
  if (partial) base = Math.max(1, Math.round(base * 0.8));
  card.intervalDays = base;
  card.due = dueAfterDays(card.key, base, now);
  card.reps += 1;
}

function applyUnsure(card: SrsCard, now: number, source: RatingSource, chosen?: Action) {
  card.lapses += 1;
  switch (card.state) {
    case 'new':
    case 'learning':
      card.intervalDays = 0;
      break;
    case 'review':
    case 'relearning':
      card.ease = clampEase(card.ease - 0.2);
      break;
  }
  card.state = 'relearning';
  card.due = now + TEN_MIN;
  // 어느 경로로 고른 답이든 '무엇을 골랐는지'는 남깁니다 — 코치 탭이 실수의 방향을 읽는 재료입니다.
  if (chosen) card.lastWrongAction = chosen;
  if (source === 'quiz') {
    card.ease = clampEase(card.ease - 0.1);
    card.quizWrong += 1;
    card.quizWrongAt = now;
  }
}

export function rate(
  step: Step,
  rating: Rating,
  source: RatingSource,
  opts: { peeked?: boolean; partial?: boolean; now?: number; chosen?: Action } = {},
): SrsCard {
  const now = opts.now ?? Date.now();
  const card = ensure(step, now);
  card.exposures += 1;
  card.lastSeen = now;
  // 성향 축의 분모: '실제로 답을 낸' 횟수만 셉니다. 답을 먼저 본 카드(peeked)는 어느 쪽도 아닙니다.
  if (!opts.peeked) {
    if (source === 'quiz') card.quizSeen += 1;
    else if (source === 'button' && opts.chosen !== undefined) card.pickSeen += 1;
  }
  if (rating === 'know' && opts.peeked) {
    // Answer was seen during the think phase: exposure only.
    touch();
    return { ...card };
  }
  if (rating === 'know') applyKnow(card, now, !!opts.partial);
  else applyUnsure(card, now, source, opts.chosen);
  card.lastRating = rating;
  touch();
  return { ...card };
}

export function isDue(card: SrsCard, now: number = Date.now()): boolean {
  return card.due <= now;
}

function isLearned(c: SrsCard): boolean {
  return c.state === 'review' && c.intervalDays >= LEARNED_DAYS;
}

function isLearning(c: SrsCard): boolean {
  return c.state === 'learning' || c.state === 'relearning' || (c.state === 'review' && c.intervalDays < LEARNED_DAYS);
}

/* ------------------------------------------------------------------------------------------------
 * Learnable set, universe, counts
 * ---------------------------------------------------------------------------------------------- */

const learnableMemo = new Map<string, HandName[]>();

/** Non-fold hands plus pure-fold 4-neighbours (grid up/down/left/right) of a non-fold hand. [] without a chart. */
export function learnableHands(scenario: Scenario): HandName[] {
  const k = scenarioKey(scenario);
  const memo = learnableMemo.get(k);
  if (memo) return memo;
  if (!hasChart(scenario)) return [];
  const cells = getChartCells(scenario);
  const nonFold = new Set<HandName>();
  for (const h of ALL_HANDS) {
    const mix = cells[h];
    if (mix && Object.values(mix).some((w) => (w ?? 0) > 0)) nonFold.add(h);
  }
  const out: HandName[] = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const h = gridHand(r, c);
      if (nonFold.has(h)) {
        out.push(h);
        continue;
      }
      const near =
        (r > 0 && nonFold.has(gridHand(r - 1, c))) ||
        (r < 12 && nonFold.has(gridHand(r + 1, c))) ||
        (c > 0 && nonFold.has(gridHand(r, c - 1))) ||
        (c < 12 && nonFold.has(gridHand(r, c + 1)));
      if (near) out.push(h);
    }
  }
  learnableMemo.set(k, out);
  return out;
}

/** Σ learnable over `allScenarios()` filtered by kinds / hero positions and `hasChart`. */
export function universeSize(kinds: ScenarioKind[], positions: Pos[]): number {
  const ks = new Set(kinds);
  const ps = new Set(positions);
  let total = 0;
  for (const s of allScenarios()) {
    if (!ks.has(s.kind) || !ps.has(s.hero)) continue;
    total += learnableHands(s).length;
  }
  return total;
}

function matches(c: SrsCard, kinds?: ScenarioKind[], positions?: Pos[]): boolean {
  return (!kinds || kinds.includes(c.kind)) && (!positions || positions.includes(c.hero));
}

/** 외웠어요 / 배우는 중 / 새 카드 (universe − learned − learning, never negative). */
export function counts(kinds?: ScenarioKind[], positions?: Pos[]): { learned: number; learning: number; fresh: number } {
  let learned = 0;
  let learning = 0;
  for (const c of Object.values(store.cards)) {
    if (!matches(c, kinds, positions)) continue;
    if (isLearned(c)) learned += 1;
    else if (isLearning(c)) learning += 1;
  }
  const universe = universeSize(kinds ?? [...SCENARIO_KINDS], positions ?? [...POSITIONS]);
  return { learned, learning, fresh: Math.max(0, universe - learned - learning) };
}

/* ------------------------------------------------------------------------------------------------
 * Weak spots
 * ---------------------------------------------------------------------------------------------- */

export interface WeakSpot {
  kind: ScenarioKind;
  hero: Pos;
  unsureRate: number;
  rated: number;
  quizAcc?: number;
}

function quizAccByKind(): Partial<Record<ScenarioKind, number>> {
  const out: Partial<Record<ScenarioKind, number>> = {};
  try {
    const raw = storage()?.getItem(STATS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as { byKind?: Partial<Record<ScenarioKind, { attempts?: number; correct?: number }>> } | null;
    for (const [kind, v] of Object.entries(parsed?.byKind ?? {})) {
      const attempts = v?.attempts ?? 0;
      if (attempts >= 5 && KIND_SET.has(kind)) out[kind as ScenarioKind] = (v?.correct ?? 0) / attempts;
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** kind × hero buckets with ≥ 8 ratings, sorted by unsure rate desc. `now` is reserved (signature parity). */
export function weakSpots(limit = 3, _now: number = Date.now()): WeakSpot[] {
  const buckets = new Map<string, { kind: ScenarioKind; hero: Pos; rated: number; unsure: number }>();
  for (const c of Object.values(store.cards)) {
    const n = c.reps + c.lapses;
    if (!n) continue;
    const id = `${c.kind}:${c.hero}`;
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { kind: c.kind, hero: c.hero, rated: 0, unsure: 0 }));
    b.rated += n;
    b.unsure += c.lapses;
  }
  const acc = quizAccByKind();
  const spots: WeakSpot[] = [];
  for (const b of buckets.values()) {
    if (b.rated < 8) continue;
    const spot: WeakSpot = { kind: b.kind, hero: b.hero, unsureRate: b.unsure / b.rated, rated: b.rated };
    const q = acc[b.kind];
    if (q !== undefined) spot.quizAcc = q;
    spots.push(spot);
  }
  spots.sort((a, b) => b.unsureRate - a.unsureRate || b.rated - a.rated || a.kind.localeCompare(b.kind) || a.hero.localeCompare(b.hero));
  return spots.slice(0, Math.max(0, limit));
}

function isWeak(c: SrsCard, now: number): boolean {
  return c.lapses >= 1 || c.ease < WEAK_EASE || (c.quizWrongAt !== undefined && c.quizWrongAt >= now - WEAK_QUIZ_WINDOW);
}

function weakRecords(now: number): SrsCard[] {
  return Object.values(store.cards)
    .filter((c) => c.state !== 'new' && isWeak(c, now))
    .sort((a, b) => b.lapses - a.lapses || a.due - b.due || a.key.localeCompare(b.key));
}

/** 내 약점 deck: `lapses ≥ 1 || ease < 1.8 || quizWrongAt ≥ now − 30 d`, sorted lapses desc, due asc. */
export function weakKeys(now: number = Date.now()): CardKey[] {
  return weakRecords(now).map((c) => c.key);
}

/* ------------------------------------------------------------------------------------------------
 * Queue
 * ---------------------------------------------------------------------------------------------- */

export interface QueueRequest {
  size: number;
  deck: DeckId;
  positions: Pos[];
  /** settings.kinds — used by deck 'all'. */
  kinds: ScenarioKind[];
  scenarioId?: string;
  onlyKeys?: CardKey[];
  mode: 'train' | 'quiz';
  interestingBias: number;
  /** progress: days with cards ≥ 1 (first-week new-card cap). */
  activeDays: number;
  now?: number;
  /** Engine rng (default `random` from hands.ts, seedable in tests). */
  rng?: () => number;
}

export interface QueueItem {
  key: CardKey;
  step: Step;
  origin: 'new' | 'due' | 'unsure' | 'quizWrong';
  chainId?: number;
}

export interface QueueResult {
  items: QueueItem[];
  counts: { new: number; due: number; unsure: number };
  reason?: 'no_charts' | 'empty';
}

interface DeckPlan {
  kinds: ScenarioKind[];
  positions: Pos[];
  scenario?: Scenario;
  /** Records matching deck × positions (any state, any due). */
  records: SrsCard[];
  weakOrder: boolean;
}

function planDeck(req: QueueRequest, now: number): DeckPlan | 'no_charts' | 'empty' {
  const positions = req.positions.length ? req.positions : [...POSITIONS];
  const cards = Object.values(store.cards);
  if (req.deck === 'scenario') {
    let scenario: Scenario;
    try {
      scenario = parseScenarioId(req.scenarioId ?? '');
    } catch {
      return 'no_charts';
    }
    if (!hasChart(scenario)) return 'no_charts';
    const id = scenarioKey(scenario);
    return { kinds: [scenario.kind], positions: [scenario.hero], scenario, records: cards.filter((c) => scenarioPart(c.key) === id), weakOrder: false };
  }
  if (req.deck === 'weak') {
    const weak = weakRecords(now).filter((c) => positions.includes(c.hero));
    if (!weak.length) return 'empty';
    const kinds = [...new Set(weak.map((c) => c.kind))];
    const heroes = [...new Set(weak.map((c) => c.hero))];
    return { kinds, positions: heroes, records: weak, weakOrder: true };
  }
  const kinds = req.deck === 'all' ? (req.kinds.length ? req.kinds : [...SCENARIO_KINDS]) : DECK_KINDS[req.deck];
  const opts: SessionOptions = { positions, kinds, interestingBias: req.interestingBias };
  if (!feasiblePositions(opts).length) return 'no_charts';
  return { kinds, positions, records: cards.filter((c) => matches(c, kinds, positions)), weakOrder: false };
}

function originOf(card: SrsCard | undefined, now: number): QueueItem['origin'] {
  if (!card || card.state === 'new') return 'new';
  if (card.state === 'relearning') return 'unsure';
  if (card.quizWrongAt !== undefined && card.quizWrongAt >= now - QUIZ_WRONG_WINDOW) return 'quizWrong';
  return 'due';
}

function tier(c: SrsCard, now: number): number {
  if (c.state === 'relearning') return 0;
  if (c.quizWrongAt !== undefined && c.quizWrongAt >= now - QUIZ_WRONG_WINDOW) return 1;
  return 2;
}

function overdueRatio(c: SrsCard, now: number): number {
  return (now - c.due) / Math.max(c.intervalDays * DAY, TEN_MIN);
}

function tally(items: QueueItem[]): QueueResult['counts'] {
  const counts = { new: 0, due: 0, unsure: 0 };
  for (const it of items) {
    if (it.origin === 'new') counts.new += 1;
    else if (it.origin === 'unsure') counts.unsure += 1;
    else counts.due += 1;
  }
  return counts;
}

function finish(items: QueueItem[], reason?: QueueResult['reason']): QueueResult {
  const out: QueueResult = { items, counts: tally(items) };
  if (reason) out.reason = reason;
  else if (!items.length) out.reason = 'empty';
  return out;
}

function buildOnlyKeys(keys: CardKey[], now: number): QueueResult {
  const items: QueueItem[] = [];
  const seen = new Set<CardKey>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    const step = stepForKey(key);
    if (!step) continue;
    seen.add(key);
    items.push({ key, step, origin: originOf(store.cards[key], now) });
  }
  return finish(items);
}

/** Small seeded PRNG (mulberry32) for the order shuffle. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Sample one step of a scenario deck: `interestingBias` → non-fold weighted, else uniform over the learnable set (combo-weighted). */
function sampleScenarioStep(scenario: Scenario, bias: number, rng: () => number): Step[] {
  const cells = getChartCells(scenario);
  let hand: HandName | null = null;
  if (rng() < bias) hand = dealWeightedHand(continueWeights(cells), rng);
  if (!hand) {
    const weights: Record<HandName, number> = {};
    for (const h of learnableHands(scenario)) weights[h] = 1;
    hand = dealWeightedHand(weights, rng);
  }
  if (!hand) return [];
  return [stepFor(scenario, hand)];
}

/**
 * Interleave reviews and new units (chains) — rules §7.1: (1) first item is a review when any exist,
 * (2) chains stay consecutive, (3) ≤ 3 new in a row, (4) ≤ 2 reviews in a row, (5) no two consecutive
 * items share a scenarioKey unless in a chain — each "where possible"; otherwise shuffled (seeded).
 *
 * Units are packed into new-blocks of ≤ 3 items (a longer chain forms its own block), then the reviews
 * are spread over the slots around the blocks: slot 0 first, one per interior slot next, the remainder
 * evenly. That gives the smallest possible maximum run on both sides.
 */
function interleave(reviews: QueueItem[], units: QueueItem[][], rng: () => number): QueueItem[] {
  const R = shuffle(reviews, rng);
  const U = shuffle(units, rng);
  const sameScenario = (a: QueueItem | undefined, b: QueueItem) => !!a && scenarioPart(a.key) === scenarioPart(b.key);

  // 1. pack units into blocks of ≤ `cap` items (≤ 3; smaller when reviews outnumber new cards so that
  //    enough slots exist for runs of ≤ 2 reviews), preferring a unit that does not repeat the block's last scenario
  const totalNew = U.reduce((n, u) => n + u.length, 0);
  const slotsWanted = Math.max(1, Math.ceil(R.length / 2) - 1);
  const cap = Math.max(1, Math.min(3, Math.floor(totalNew / slotsWanted)));
  const blocks: QueueItem[][] = [];
  let cur: QueueItem[] = [];
  while (U.length) {
    const last = cur[cur.length - 1];
    let i = pickBalanced(U, (u) => u[0], (u) => cur.length + u.length <= cap && !sameScenario(last, u[0]));
    if (i < 0) i = U.findIndex((u) => cur.length + u.length <= cap);
    if (i < 0) {
      if (cur.length) {
        blocks.push(cur);
        cur = [];
        continue;
      }
      i = 0; // oversize chain: its own block
    }
    cur.push(...U.splice(i, 1)[0]);
    if (cur.length >= cap) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);

  // 2. review counts per slot (slot i sits before block i; the last slot is the tail)
  const slots = blocks.length + 1;
  const counts = new Array<number>(slots).fill(0);
  let left = R.length;
  if (left) {
    counts[0] = 1;
    left -= 1;
  }
  const interior = Math.max(0, blocks.length - 1);
  if (left >= interior) {
    for (let i = 1; i <= interior; i++) counts[i] += 1;
    left -= interior;
  } else {
    for (let k = 0; k < left; k++) counts[1 + Math.floor((k * interior) / left)] += 1;
    left = 0;
  }
  for (let i = 0; i < slots; i++) counts[i] += Math.floor(((i + 1) * left) / slots) - Math.floor((i * left) / slots);

  // 3. assemble: reviews prefer a scenario that differs from the last item and still has the most
  //    cards left (so no scenario is drained early); blocks prefer a first item that changes scenario
  const out: QueueItem[] = [];
  const takeReview = (): QueueItem => {
    const last = out[out.length - 1];
    const i = pickBalanced(R, (r) => r, (r) => !sameScenario(last, r));
    return R.splice(i < 0 ? 0 : i, 1)[0];
  };
  const takeBlock = (): QueueItem[] => {
    const last = out[out.length - 1];
    let i = blocks.findIndex((b) => !sameScenario(last, b[0]));
    if (i < 0) i = 0;
    return blocks.splice(i, 1)[0];
  };
  for (let i = 0; i < slots; i++) {
    for (let k = 0; k < counts[i] && R.length; k++) out.push(takeReview());
    if (blocks.length) out.push(...takeBlock());
  }
  while (R.length) out.push(takeReview());
  repairAdjacency(out);
  return out;
}

/**
 * Index of the eligible entry whose scenario (by `first`) has the most entries left in `list` — spreads
 * repeated scenarios instead of draining the rare ones first. −1 when nothing is eligible.
 */
function pickBalanced<T>(list: T[], first: (t: T) => QueueItem, eligible: (t: T) => boolean): number {
  const freq = new Map<string, number>();
  for (const t of list) {
    const s = scenarioPart(first(t).key);
    freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    if (!eligible(list[i])) continue;
    if (best < 0 || (freq.get(scenarioPart(first(list[i]).key)) ?? 0) > (freq.get(scenarioPart(first(list[best]).key)) ?? 0)) best = i;
  }
  return best;
}

/**
 * Rule 5 clean-up: when adjacent items outside a chain still share a scenario, swap one of them with a
 * structurally equivalent item elsewhere — a review with a review, a single new card with a single new
 * card — so rule 1 and the run lengths are untouched.
 */
function repairAdjacency(out: QueueItem[]) {
  const clash = (a: QueueItem | undefined, b: QueueItem | undefined) =>
    !!a && !!b && !(a.chainId !== undefined && a.chainId === b.chainId) && scenarioPart(a.key) === scenarioPart(b.key);
  const clean = (i: number) => !clash(out[i - 1], out[i]) && !clash(out[i], out[i + 1]);
  const kind = (it: QueueItem) => (it.origin !== 'new' ? 'review' : it.chainId === undefined ? 'single' : 'chain');
  const swap = (i: number, j: number) => {
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  };
  for (let i = 1; i < out.length; i++) {
    if (!clash(out[i - 1], out[i])) continue;
    for (const a of [i, i - 1]) {
      const k = kind(out[a]);
      if (k === 'chain' || a === 0) continue;
      let fixed = false;
      for (let j = 1; j < out.length && !fixed; j++) {
        if (j === a || kind(out[j]) !== k) continue;
        swap(a, j);
        if (clean(a) && clean(j)) fixed = true;
        else swap(a, j);
      }
      if (fixed) break;
    }
  }
}

export function buildQueue(req: QueueRequest): QueueResult {
  const now = req.now ?? Date.now();
  if (req.onlyKeys) return buildOnlyKeys(req.onlyKeys, now);
  const N = Math.max(0, Math.floor(req.size));
  const plan = planDeck(req, now);
  if (typeof plan === 'string') return finish([], plan);
  if (!N) return finish([]);
  const rng = req.rng ?? random;

  // pool: due records (weak deck: the whole weak set), never state 'new'
  const pool = plan.records
    .filter((c) => c.state !== 'new' && (plan.weakOrder || c.due <= now))
    .sort((a, b) => {
      if (plan.weakOrder) return b.lapses - a.lapses || a.due - b.due || a.key.localeCompare(b.key);
      const ta = tier(a, now);
      const tb = tier(b, now);
      if (ta !== tb) return ta - tb;
      if (ta < 2) return a.due - b.due || a.key.localeCompare(b.key);
      return overdueRatio(b, now) - overdueRatio(a, now) || a.key.localeCompare(b.key);
    });
  const toItem = (c: SrsCard): QueueItem | null => {
    const step = stepForKey(c.key);
    return step ? { key: c.key, step, origin: originOf(c, now) } : null;
  };
  const unsureItems: QueueItem[] = [];
  const dueItems: QueueItem[] = [];
  for (const c of pool) {
    const it = toItem(c);
    if (!it) continue;
    (c.state === 'relearning' ? unsureItems : dueItems).push(it);
  }
  const unsure = unsureItems.slice(0, Math.ceil(N * 0.3));
  const reviews = [...unsure, ...dueItems].slice(0, Math.ceil(N * 0.6));
  const queued = new Set(reviews.map((it) => it.key));

  let newN = N - reviews.length;
  if (req.activeDays < FIRST_WEEK_DAYS) newN = Math.min(newN, FIRST_WEEK_NEW_CAP);

  // new: chains from the engine (train) / single steps (quiz, scenario)
  const units: QueueItem[][] = [];
  let newCount = 0;
  let chainCounter = 0;
  if (newN > 0) {
    const opts: SessionOptions = { positions: plan.positions, kinds: plan.kinds, interestingBias: req.interestingBias };
    for (let calls = 0; calls < ENGINE_CALL_CAP && newCount < newN; calls++) {
      let steps: Step[];
      if (plan.scenario) steps = sampleScenarioStep(plan.scenario, req.interestingBias, rng);
      else {
        const seq = nextHandSequence(opts, rng);
        if (!seq.steps.length) break; // nothing feasible — engine exhausted
        steps = req.mode === 'quiz' ? [pick(seq.steps, rng)] : seq.steps;
      }
      const fresh: QueueItem[] = [];
      for (const step of steps) {
        const key = cardKey(step);
        const rec = store.cards[key];
        if ((rec && rec.state !== 'new') || queued.has(key) || fresh.some((f) => f.key === key)) continue;
        fresh.push({ key, step, origin: 'new' });
      }
      if (!fresh.length) continue;
      if (newCount + fresh.length > newN + 2) continue; // a chain may overflow by ≤ 2, never split
      if (fresh.length > 1 && req.mode === 'train') {
        const chainId = ++chainCounter;
        for (const f of fresh) f.chainId = chainId;
      }
      for (const f of fresh) queued.add(f.key);
      units.push(fresh);
      newCount += fresh.length;
    }
  }

  // fill (앞당겨 복습): engine could not supply enough new cards → not-yet-due records, due asc
  if (newCount < newN) {
    const ahead = plan.records
      .filter((c) => c.state !== 'new' && c.due > now && !queued.has(c.key))
      .sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
    for (const c of ahead) {
      if (reviews.length + newCount >= N) break;
      const it = toItem(c);
      if (!it) continue;
      it.origin = c.state === 'relearning' ? 'unsure' : 'due';
      reviews.push(it);
      queued.add(it.key);
    }
  }

  return finish(interleave(reviews, units, seeded(now)));
}

/** Same algorithm as `buildQueue` (engine calls capped at 60), counts only. */
export function previewQueue(req: QueueRequest): QueueResult['counts'] {
  return buildQueue(req).counts;
}
