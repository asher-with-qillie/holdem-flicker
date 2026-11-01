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
 * Elapsed time per `scope|duration|resetKey`, so a timer that is remounted under a new parent (the phone ↔ HUD
 * placement swap when a fold or rotation changes the size class) carries on where it stopped instead of
 * granting a fresh full countdown. Only the last few keys are kept.
 */
const carry = new Map<string, { elapsed: number; fired: boolean }>();
const CARRY_MAX = 8;

function carryKey(scope: string | undefined, durationMs: number, resetKey: string): string | null {
  return scope ? `${scope}|${durationMs}|${resetKey}` : null;
}

function remember(key: string | null, elapsed: number, fired: boolean): void {
  if (!key) return;
  carry.delete(key);
  carry.set(key, { elapsed, fired });
  while (carry.size > CARRY_MAX) carry.delete(carry.keys().next().value as string);
}

/** Test hook: forget every carried countdown. */
export function resetTimerCarry(): void {
  carry.clear();
}

/**
 * requestAnimationFrame countdown. Elapsed time accumulates only while `running` (a paused timer keeps its
 * remaining time); `resetKey` change restarts from zero; `onExpire` fires once per key when the duration is reached.
 * With a `scope`, the elapsed time survives a remount with the same key (see `carry`).
 */
export function useRafTimer(durationMs: number, running: boolean, resetKey: string, onExpire: () => void, scope?: string): RafTimer {
  const key = carryKey(scope, durationMs, resetKey);
  const start = (key && carry.get(key)) || null;
  const [progress, setProgress] = useState(() => (start && durationMs > 0 ? Math.max(0, durationMs - start.elapsed) / durationMs : 1));
  const [remainingMs, setRemainingMs] = useState(() => (start ? Math.ceil(Math.max(0, durationMs - start.elapsed) / 100) * 100 : durationMs));
  const elapsed = useRef(start?.elapsed ?? 0);
  const fired = useRef(start?.fired ?? false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  // Restore only on mount (a remount with the same key). A key change inside one instance is a new card / phase —
  // or ◀ back to a card whose key was seen before — and starts fresh, as it always did.
  const seenKey = useRef<string | null>(null);
  useEffect(() => {
    const fresh = seenKey.current !== null && seenKey.current !== resetKey;
    seenKey.current = resetKey;
    if (fresh && key) carry.delete(key);
    const kept = key && !fresh ? carry.get(key) : undefined;
    elapsed.current = kept?.elapsed ?? 0;
    fired.current = kept?.fired ?? false;
    const left = Math.max(0, durationMs - elapsed.current);
    setProgress(durationMs > 0 ? left / durationMs : 0);
    setRemainingMs(Math.ceil(left / 100) * 100);
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
          remember(key, elapsed.current, true);
          expireRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      remember(key, elapsed.current, fired.current);
    };
  }, [running, durationMs, resetKey]);

  return { progress, remainingMs };
}

/** "6.4초" — one decimal, never negative. */
export function formatCountdown(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}
