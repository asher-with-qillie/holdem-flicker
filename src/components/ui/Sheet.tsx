import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayout } from '../../state/viewport';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  /** auto = content height ≤ 62% core; half = top edge at 38% core; full = top edge at 8% core; peek = ≤ min(232, 42% core).
   *  peek exists only on phone/squat; on other classes it is treated as auto. Switching detent never remounts. */
  detent?: 'auto' | 'half' | 'full' | 'peek';
  held?: boolean; // hold overlay variant: pointer-events none, height 72%, no backdrop tap, bottom fade mask 48px
  footer?: ReactNode; // bottom row (flex: none, never sticky)
  /** land/wide: which edge the side sheet docks to (default 'end'). Ignored on phone/squat/tall. */
  side?: 'start' | 'end';
  /** default true. false = no backdrop, no scroll lock, aria-modal=false, no focus trap; Esc closes it while top-most. */
  modal?: boolean;
  /** land/wide: keep the bottom-sheet presentation instead of side/panel. */
  forceBottom?: boolean;
  /** sheet with a text field: height follows the visual viewport (keyboard) via --vv-h. */
  input?: boolean;
  children: ReactNode;
}

export type SheetPresentation = 'bottom' | 'side' | 'panel';
/** §7: (land|wide) ? (forceBottom ? bottom : detent==='full' && !side ? panel : side) : bottom. held → side end. */
export function sheetPresentation(layout: string, detent: SheetProps['detent'], side: SheetProps['side'], forceBottom?: boolean, held?: boolean): SheetPresentation {
  if (layout !== 'land' && layout !== 'wide') return 'bottom';
  if (held) return 'side';
  if (forceBottom) return 'bottom';
  return detent === 'full' && !side ? 'panel' : 'side';
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
export function Sheet({ open, onClose, title, detent = 'auto', held, footer, side, modal = true, forceBottom, input, children }: SheetProps): JSX.Element | null {
  const layout = useLayout();
  const presentation = sheetPresentation(layout, detent, side, forceBottom, held);
  const effDetent = detent === 'peek' && layout !== 'phone' && layout !== 'squat' ? 'auto' : detent;
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

  // focus trap, Esc, scroll lock (not for the held overlay; a non-modal sheet only gets Esc)
  useEffect(() => {
    if (!present || held) return;
    const id = ++sheetSeq;
    idRef.current = id;
    stack.push(id);
    const el = panel.current;
    if (modal) {
      restore.current = document.activeElement;
      lock();
      el?.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (modal && e.key === 'Tab' && el) {
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
      if (modal) {
        unlock();
        const r = restore.current;
        if (r instanceof HTMLElement && r.isConnected) r.focus({ preventScroll: true });
      }
    };
  }, [present, held, modal]);

  if (!present) return null;

  const cls = [
    'ui-sheet',
    'glass-strong',
    presentation === 'bottom' ? `ui-sheet--${effDetent}` : `ui-sheet--${presentation}`,
    presentation === 'side' && side === 'start' && !held ? 'ui-sheet--start' : '',
    input ? 'ui-sheet--input' : '',
    held ? 'ui-sheet--held' : '',
    modal ? '' : 'ui-sheet--modeless',
    shown ? 'ui-sheet--in' : '',
  ].filter(Boolean).join(' ');
  const backdrop = modal || held;
  const node = (
    <>
      {backdrop && (
        <div
          className={`ui-sheet__backdrop${presentation === 'side' ? ' ui-sheet__backdrop--side' : ''}${shown ? ' ui-sheet__backdrop--in' : ''}${held ? ' ui-sheet__backdrop--held' : ''}`}
          onClick={held ? undefined : onClose}
          aria-hidden="true"
        />
      )}
      <section ref={panel} className={cls} role="dialog" aria-modal={held ? undefined : modal} aria-label={title} tabIndex={-1} data-presentation={presentation}>
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
