import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function mql(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

function snapshot(): boolean {
  return mql()?.matches ?? false;
}

/** true when the OS asks for reduced motion — the ring then fills instantly (`animate={false}`, §8). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
