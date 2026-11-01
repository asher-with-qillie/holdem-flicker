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
function useStuck<T extends HTMLElement>(enabled: boolean): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setStuck(false);
      return;
    }
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
    // Safari 툴바가 페이지 끝에서 다시 자랄 때는 visualViewport 이벤트만 옵니다.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      vv?.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return [ref, stuck];
}

/**
 * Sticky block under the large title; becomes a `.glass-strong` bar (edge to edge) once it is pinned.
 * `inline` (차트 스테이지 — land/tall/wide): 스크롤 페이지가 아니므로 sticky 도 유리 막대도 없이 제자리에 둡니다.
 */
export function ChartFilters({ children, inline }: { children: ReactNode; inline?: boolean }) {
  const [ref, stuck] = useStuck<HTMLDivElement>(!inline);
  return (
    <div ref={ref} className={`charts__filters${inline ? ' charts__filters--inline' : ''}${stuck ? ' glass-strong charts__filters--stuck' : ''}`}>
      {children}
    </div>
  );
}

/**
 * One chip row with a short inline label (상황 / 나 / 상대); the chips scroll horizontally past the right edge.
 * `wrap` — 좁은 옆 칼럼(land/wide): 가로 스크롤 대신 줄바꿈해서 칩이 전부 보이게.
 */
export function FilterRow({ label, ariaLabel, wrap, className, children }: { label: string; ariaLabel: string; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`charts__row${wrap ? ' charts__row--wrap' : ''}${className ? ` ${className}` : ''}`}>
      <span className="charts__rowlabel t-caption" aria-hidden="true">
        {label}
      </span>
      <ChipRow ariaLabel={ariaLabel} wrap={wrap}>
        {children}
      </ChipRow>
    </div>
  );
}
