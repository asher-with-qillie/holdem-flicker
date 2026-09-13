import { useCallback, useMemo } from 'react';
import type { Step } from '../../poker/trainer';
import type { Action } from '../../poker/types';
import type { Settings } from '../../state/settings';
import type { RatingSource } from '../../state/srs';
import {
  autoNextArmed,
  awaitsNext,
  cancelAutoNext as storeCancelAutoNext,
  choose as storeChoose,
  currentCard,
  endSession,
  expire,
  flagToggle as storeFlagToggle,
  getSession,
  next as storeNext,
  prev as storePrev,
  quiet as isQuiet,
  rateCard,
  revealNow as storeRevealNow,
  setHolding as storeSetHolding,
  setSheetOpen as storeSetSheetOpen,
  togglePause as storeTogglePause,
  useSession,
  type Phase,
  type Rating,
  type SessionCard,
  type SessionConfig,
  type SessionState,
  type SessionStatus,
} from './sessionStore';

export type { Phase } from './sessionStore';

/** Background wash of the reveal state (§5.4 v2.1): correct → teal, wrong → amber, 시간 초과 / 노출 / no choice → slate. */
export type RevealTone = 'correct' | 'wrong' | 'neutral';

export function revealTone(card: SessionCard | undefined, quiet: boolean): RevealTone {
  if (!card || quiet || card.timedOut || !card.chosenAction) return 'neutral';
  return card.grade === 'wrong' ? 'wrong' : 'correct';
}

/**
 * View-model over `sessionStore` (spec §6.1): same shape the v1 hook returned (`card` for `seq`, `index` for
 * `stepIndex`) plus the session fields. Decides whether the rAF countdown runs and what expiry means.
 */
export function useTrainerSession(settings: Settings) {
  const s: SessionState | null = useSession();

  const status: SessionStatus = s?.status ?? 'idle';
  const card: SessionCard | undefined = s ? s.queue[s.index] : undefined;
  const step: Step | undefined = card?.step;
  const phase: Phase = s?.phase ?? 'think';
  const paused = status === 'paused';
  const holding = !!s?.holding;
  const sheetOpen = !!s?.sheetOpen;
  const coachOpen = !!s?.coachOpen;
  const manual = !!s?.config.manual;
  const quiet = !!s && isQuiet(s);
  /** The revealed card waits for 다음 / ▶ (choose mode always; 노출 / 순간기억 with 직접 넘기기) — no reveal countdown. */
  const waiting = !!s && awaitsNext(s);
  /** Choose mode reveal: the prominent 다음 button replaces ▶ and the timer row reads 다음을 눌러 넘어가요. */
  const waitNext = waiting && !quiet;
  /** The 다음 button is counting down (5 s) — cancelled by any other interaction, off in 직접 넘기기. */
  const autoNext = autoNextArmed(s) && !sheetOpen && !coachOpen && !holding;
  /** Restarts the button countdown per card / per reveal. */
  const autoNextKey = s && card ? `${s.id}:${card.id}:auto` : 'idle';
  const running = !!s && status === 'running' && !holding && !sheetOpen && !coachOpen && !s.settling && !waiting;
  const durationMs = s ? Math.max(200, s.config.exposure ? s.timing.expose : phase === 'think' ? s.timing.think : s.timing.reveal) : 1000;
  const timerKey = s && card ? `${s.id}:${card.id}:${phase}` : 'idle';
  /** 노출 / 순간기억 + 직접 넘기기: no timer to show. Choose mode keeps the row for the 다음 hint. */
  const timerHidden = !s || (waiting && quiet);
  const tone: RevealTone = revealTone(card, quiet);

  /** Steps of the current hand chain (for StepCrumbs). */
  const chain = useMemo(() => {
    if (!s || !card || card.chainId === undefined) return card ? [card.step] : [];
    const id = card.chainId;
    return s.queue.filter((c) => c.chainId === id && c.origin !== 'requeue').map((c) => c.step);
  }, [s, card]);
  const chainIndex = card ? Math.max(0, chain.indexOf(card.step)) : 0;

  const onExpire = useCallback(() => {
    const st = getSession();
    if (!st || st.status !== 'running') return;
    expire();
  }, []);

  const choose = useCallback((a: Action) => storeChoose(a), []);

  /** Explicit rating (keyboard / corrective ◀ path). `know` on a peeked card is refused. */
  const rate = useCallback((r: Rating, source: RatingSource = 'button') => {
    const st = getSession();
    const c = currentCard(st);
    if (!st || !c) return false;
    return rateCard(r, source);
  }, []);

  const flagToggle = useCallback(() => storeFlagToggle(), []);
  const revealNow = useCallback(() => storeRevealNow(), []);
  const next = useCallback(() => storeNext(), []);
  const prev = useCallback(() => storePrev(), []);
  const togglePause = useCallback(() => storeTogglePause(), []);
  const setHolding = useCallback((h: boolean) => storeSetHolding(h), []);
  const setSheetOpen = useCallback((o: boolean) => storeSetSheetOpen(o), []);
  /** Any interaction that is not 다음 (stage tap, 차트 sheet…) stops the auto-advance for this card. */
  const cancelAutoNext = useCallback(() => storeCancelAutoNext(), []);
  const endEarly = useCallback(() => endSession(), []);

  const config: SessionConfig | undefined = s?.config;

  return {
    session: s,
    status,
    config,
    queue: s?.queue ?? [],
    index: s?.index ?? 0,
    card,
    step,
    chain,
    chainIndex,
    phase,
    tone,
    paused,
    holding,
    sheetOpen,
    coachOpen,
    waiting,
    waitNext,
    autoNext,
    autoNextKey,
    running,
    quiet,
    manual,
    settling: !!s?.settling,
    durationMs,
    timerKey,
    timerHidden,
    onExpire,
    choose,
    rate,
    flagToggle,
    revealNow,
    next,
    prev,
    togglePause,
    setHolding,
    setSheetOpen,
    cancelAutoNext,
    endEarly,
    result: s?.result,
    showMix: settings.showMixFrequencies,
  };
}

export type TrainerSession = ReturnType<typeof useTrainerSession>;
