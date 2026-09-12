import { useCallback, useMemo } from 'react';
import { toast } from '../../components/ui/Toast';
import type { Step } from '../../poker/trainer';
import type { Settings } from '../../state/settings';
import type { RatingSource } from '../../state/srs';
import {
  currentCard,
  endSession,
  EXIT_MS,
  expire,
  flagToggle as storeFlagToggle,
  getSession,
  markUnratedToast,
  next as storeNext,
  prev as storePrev,
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

const UNRATED_TOAST = '평가하면 다음에 더 잘 골라드려요';

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
  const quiet = !!s && (s.config.speed === 'flash' || s.config.exposure);
  /** Manual mode: the answer stays until a swipe / button / tap / ▶. */
  const waiting = !!s && manual && phase === 'reveal';
  const running = !!s && status === 'running' && !holding && !s.dragging && !sheetOpen && !coachOpen && !s.settling && !s.exiting && !waiting;
  const durationMs = s ? Math.max(200, s.config.exposure ? s.timing.expose : phase === 'think' ? s.timing.think : s.timing.reveal) : 1000;
  const timerKey = s && card ? `${s.id}:${card.id}:${phase}` : 'idle';
  const timerHidden = !s || manual || (s.config.exposure && manual);

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
    if (st.phase === 'reveal' || st.config.exposure) {
      const c = currentCard(st);
      const timed = st.config.speed === 'slow' || st.config.speed === 'normal';
      if (c && !c.rating && !c.flagged && timed && !st.config.exposure && !st.unratedToastShown) {
        markUnratedToast();
        toast(UNRATED_TOAST);
      }
    }
    expire();
  }, []);

  const rate = useCallback((r: Rating, source: RatingSource = 'button') => {
    const st = getSession();
    const c = currentCard(st);
    if (!st || !c) return false;
    if (r === 'know' && c.peeked) {
      toast('답을 먼저 봤어요 · 다음에 확인해요', 'amber');
      return false;
    }
    return rateCard(r, source, EXIT_MS);
  }, []);

  const flagToggle = useCallback(() => storeFlagToggle(), []);
  const revealNow = useCallback(() => storeRevealNow(), []);
  const next = useCallback(() => storeNext(), []);
  const prev = useCallback(() => storePrev(), []);
  const togglePause = useCallback(() => storeTogglePause(), []);
  const setHolding = useCallback((h: boolean) => storeSetHolding(h), []);
  const setSheetOpen = useCallback((o: boolean) => storeSetSheetOpen(o), []);
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
    paused,
    holding,
    sheetOpen,
    coachOpen,
    waiting,
    running,
    quiet,
    manual,
    exiting: s?.exiting ?? null,
    settling: !!s?.settling,
    durationMs,
    timerKey,
    timerHidden,
    onExpire,
    rate,
    flagToggle,
    revealNow,
    next,
    prev,
    togglePause,
    setHolding,
    setSheetOpen,
    endEarly,
    result: s?.result,
    showMix: settings.showMixFrequencies,
  };
}

export type TrainerSession = ReturnType<typeof useTrainerSession>;
