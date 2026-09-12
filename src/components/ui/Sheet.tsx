import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  detent?: 'auto' | 'half' | 'full'; // auto = content height ≤ 62vh; half = 62vh; full = 92vh (scrollable)
  held?: boolean; // hold overlay variant: pointer-events none, height 72%, no backdrop tap, bottom fade mask 48px
  footer?: ReactNode; // sticky bottom row
  children: ReactNode;
}

const DISMISS_MS = 220;
const HELD_DISMISS_MS = 180;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Only the top-most open sheet handles Esc / Tab; the html scroll lock is ref-counted. */
const stack: number[] = [];
let sheetSeq = 0;
let lockCount = 0;
function lock() {
  if (lockCount++ === 0) document.documentElement.classList.add('ui-sheet-open');
}
function unlock() {
  if (--lockCount <= 0) {
    lockCount = 0;
    document.documentElement.classList.remove('ui-sheet-open');
  }
}

/**
 * Bottom sheet on .glass-strong (top radius --r-xl, 40×4 grabber). Slides up 420 ms spring, dismisses 220 ms.
 * Backdrop tap / Esc close it; focus is trapped and restored; the app scroller is locked while open.
 * Keep it mounted with `open={false}` to get the exit animation (it unmounts itself after the transition).
 */
export function Sheet({ open, onClose, title, detent = 'auto', held, footer, children }: SheetProps): JSX.Element | null {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const idRef = useRef(0);
  const restore = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // presence + enter/exit transitions
  useLayoutEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    setShown(false);
    if (!present) return;
    const t = window.setTimeout(() => setPresent(false), held ? HELD_DISMISS_MS : DISMISS_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, held]);

  useLayoutEffect(() => {
    if (!present || !open) return;
    // force the initial (translated) style to be computed so the transition runs
    void panel.current?.getBoundingClientRect();
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) setShown(true);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [present, open]);

  // focus trap, Esc, scroll lock (not for the held overlay)
  useEffect(() => {
    if (!present || held) return;
    const id = ++sheetSeq;
    idRef.current = id;
    stack.push(id);
    restore.current = document.activeElement;
    lock();
    const el = panel.current;
    el?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && el) {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (nodes.length === 0) {
          e.preventDefault();
          el.focus();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlock();
      const r = restore.current;
      if (r instanceof HTMLElement && r.isConnected) r.focus({ preventScroll: true });
    };
  }, [present, held]);

  if (!present) return null;

  const cls = ['ui-sheet', 'glass-strong', `ui-sheet--${detent}`, held ? 'ui-sheet--held' : '', shown ? 'ui-sheet--in' : ''].filter(Boolean).join(' ');
  const node = (
    <>
      <div className={`ui-sheet__backdrop${shown ? ' ui-sheet__backdrop--in' : ''}${held ? ' ui-sheet__backdrop--held' : ''}`} onClick={held ? undefined : onClose} aria-hidden="true" />
      <section ref={panel} className={cls} role="dialog" aria-modal={held ? undefined : true} aria-label={title} tabIndex={-1}>
        <div className="ui-sheet__grab" aria-hidden="true">
          <span />
        </div>
        {title && <h2 className="ui-sheet__title">{title}</h2>}
        <div className="ui-sheet__body">{children}</div>
        {footer && <div className="ui-sheet__footer">{footer}</div>}
      </section>
    </>
  );
  return createPortal(node, document.body);
}
