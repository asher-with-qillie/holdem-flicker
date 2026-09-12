import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dealCardsFor } from '../../poker/hands';
import { nextHandSequence, type SessionOptions, type Step } from '../../poker/trainer';
import type { Card, HandName, Pos } from '../../poker/types';
import { vibrate, type Settings } from '../../state/settings';

export type Phase = 'think' | 'reveal';

export interface HandSeq {
  /** Monotonic id so timers/animations reset even if the same hand is dealt twice. */
  id: number;
  hero: Pos;
  hand: HandName;
  steps: Step[];
  /** Dealt once per hand and kept stable across its steps. */
  cards: [Card, Card];
}

let seqCounter = 0;

function deal(opts: SessionOptions): HandSeq {
  const { hero, hand, steps } = nextHandSequence(opts);
  return { id: ++seqCounter, hero, hand, steps, cards: dealCardsFor(hand) };
}

/**
 * Flashcard state machine: hand sequence → step index → think/reveal phase.
 * The countdown itself lives in `useRafTimer`; this hook only decides whether it runs and what expiry means.
 */
export function useTrainerSession(settings: Settings) {
  const opts = useMemo<SessionOptions>(
    () => ({ positions: settings.positions, kinds: settings.kinds, interestingBias: settings.interestingBias }),
    [settings.positions, settings.kinds, settings.interestingBias],
  );
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [seq, setSeq] = useState<HandSeq>(() => deal(opts));
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('think');
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const newHand = useCallback(() => {
    setSeq(deal(optsRef.current));
    setStepIndex(0);
    setPhase('think');
  }, []);

  const goTo = useCallback((i: number) => {
    setStepIndex(i);
    setPhase('think');
  }, []);

  const next = useCallback(() => {
    if (stepIndex + 1 < seq.steps.length) goTo(stepIndex + 1);
    else newHand();
  }, [stepIndex, seq.steps.length, goTo, newHand]);

  /** Previous step; at the first step it simply restarts the current card. */
  const prev = useCallback(() => goTo(Math.max(0, stepIndex - 1)), [stepIndex, goTo]);

  const reveal = useCallback(() => {
    setPhase('reveal');
    // Browsers block vibration until the page has seen a user gesture (and log an error); skip it until then.
    if (navigator.userActivation?.hasBeenActive !== false) vibrate(12);
  }, []);

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  // Restart the sequence when the trained positions / scenario kinds change.
  const restartKey = `${settings.positions.join(',')}|${settings.kinds.join(',')}`;
  const prevRestartKey = useRef(restartKey);
  useEffect(() => {
    if (prevRestartKey.current === restartKey) return;
    prevRestartKey.current = restartKey;
    newHand();
  }, [restartKey, newHand]);

  const step: Step | undefined = seq.steps[stepIndex];
  const waiting = phase === 'reveal' && !settings.autoAdvance;
  const running = !!step && !paused && !holding && !sheetOpen && !waiting;
  const durationMs = Math.max(200, (phase === 'think' ? settings.thinkSeconds : settings.revealSeconds) * 1000);
  const timerKey = `${seq.id}:${stepIndex}:${phase}`;

  const onExpire = useCallback(() => {
    if (phase === 'think') reveal();
    else next();
  }, [phase, reveal, next]);

  return {
    seq,
    step,
    stepIndex,
    phase,
    paused,
    holding,
    sheetOpen,
    waiting,
    running,
    durationMs,
    timerKey,
    onExpire,
    newHand,
    next,
    prev,
    togglePause,
    setHolding,
    setSheetOpen,
  };
}
