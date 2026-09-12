import { useEffect, useRef, useState } from 'react';

/** Longest single-frame delta we credit to the timer (keeps a backgrounded tab from expiring instantly on return). */
const MAX_FRAME_MS = 250;

export interface RafTimer {
  /** Remaining fraction 1 → 0 (drives the bar, updated every frame). */
  progress: number;
  /** Remaining time, quantised to 100 ms (drives the "6.4초" readout — re-renders only when the digit changes). */
  remainingMs: number;
}

/**
 * requestAnimationFrame countdown. Elapsed time accumulates only while `running` (a paused timer keeps its
 * remaining time); `resetKey` change restarts from zero; `onExpire` fires once per key when the duration is reached.
 */
export function useRafTimer(durationMs: number, running: boolean, resetKey: string, onExpire: () => void): RafTimer {
  const [progress, setProgress] = useState(1);
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const elapsed = useRef(0);
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    elapsed.current = 0;
    fired.current = false;
    setProgress(1);
    setRemainingMs(durationMs);
  }, [resetKey, durationMs]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      elapsed.current += Math.min(Math.max(0, ts - last), MAX_FRAME_MS);
      last = ts;
      const left = Math.max(0, durationMs - elapsed.current);
      setProgress(durationMs > 0 ? left / durationMs : 0);
      setRemainingMs(Math.ceil(left / 100) * 100);
      if (elapsed.current >= durationMs) {
        if (!fired.current) {
          fired.current = true;
          expireRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, durationMs, resetKey]);

  return { progress, remainingMs };
}

/** "6.4초" — one decimal, never negative. */
export function formatCountdown(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}
