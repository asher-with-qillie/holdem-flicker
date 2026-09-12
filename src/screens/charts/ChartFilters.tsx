import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChipRow } from '../../components/ui/ChipRow';

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * True while a `position: sticky` element is pinned at its `top` inside the nearest scroller (or the window).
 * Measured on scroll/resize (rAF-coalesced) — exact, no sentinel arithmetic.
 */
function useStuck<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = scrollParent(el);
    const target: EventTarget = scroller ?? window;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const stickyTop = parseFloat(getComputedStyle(el).top) || 0;
      const edge = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0;
      setStuck(el.getBoundingClientRect().top <= edge + stickyTop + 1);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return [ref, stuck];
}

/** Sticky block under the large title; becomes a `.glass-strong` bar (edge to edge) once it is pinned. */
export function ChartFilters({ children }: { children: ReactNode }) {
  const [ref, stuck] = useStuck<HTMLDivElement>();
  return (
    <div ref={ref} className={`charts__filters${stuck ? ' glass-strong charts__filters--stuck' : ''}`}>
      {children}
    </div>
  );
}

/** One chip row with a short inline label (상황 / 나 / 상대); the chips scroll horizontally past the right edge. */
export function FilterRow({ label, ariaLabel, children }: { label: string; ariaLabel: string; children: ReactNode }) {
  return (
    <div className="charts__row">
      <span className="charts__rowlabel t-caption" aria-hidden="true">
        {label}
      </span>
      <ChipRow ariaLabel={ariaLabel}>{children}</ChipRow>
    </div>
  );
}
