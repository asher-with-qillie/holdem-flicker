import { useEffect, useState, useSyncExternalStore } from 'react';

export type ToastTone = 'neutral' | 'mint' | 'amber';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const SHOW_MS = 2200;
const OUT_MS = 200;

let current: ToastItem | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => current;

/** Show one toast (replaces the current one). Renders through <ToastHost/>, mounted once in App. */
export function toast(message: string, tone: ToastTone = 'neutral'): void {
  current = { id: ++seq, message, tone };
  listeners.forEach((l) => l());
}

/** Capsule .glass-strong above the tab bar, 2200 ms, one at a time. */
export function ToastHost(): JSX.Element {
  const item = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [shown, setShown] = useState<ToastItem | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!item) return;
    setShown(item);
    setVisible(false);
    const inId = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    const hide = window.setTimeout(() => setVisible(false), SHOW_MS);
    const clear = window.setTimeout(() => setShown((s) => (s?.id === item.id ? null : s)), SHOW_MS + OUT_MS);
    return () => {
      cancelAnimationFrame(inId);
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [item]);

  return (
    <div className="ui-toast-host" role="status" aria-live="polite">
      {shown && (
        <div key={shown.id} className={`ui-toast glass-strong ui-toast--${shown.tone}${visible ? ' ui-toast--in' : ''}`}>
          {shown.message}
        </div>
      )}
    </div>
  );
}
