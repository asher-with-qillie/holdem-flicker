import { useEffect, useRef, useState } from 'react';

/** Longest single-frame delta we credit to the timer (keeps a backgrounded tab from expiring instantly on return). */
const MAX_FRAME_MS = 250;

/**
 * requestAnimationFrame countdown. Elapsed time accumulates only while `running`;
 * `resetKey` change restarts from zero; `onExpire` fires once per key when the duration is reached.
 * Returns the remaining fraction 1 → 0.
 */
export function useRafTimer(durationMs: number, running: boolean, resetKey: string, onExpire: () => void): number {
  const [progress, setProgress] = useState(1);
  const elapsed = useRef(0);
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    elapsed.current = 0;
    fired.current = false;
    setProgress(1);
  }, [resetKey]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      elapsed.current += Math.min(Math.max(0, ts - last), MAX_FRAME_MS);
      last = ts;
      const remaining = durationMs > 0 ? Math.max(0, 1 - elapsed.current / durationMs) : 0;
      setProgress(remaining);
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

  return progress;
}
