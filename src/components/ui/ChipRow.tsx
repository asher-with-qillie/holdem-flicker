import type { ReactNode } from 'react';

/** Horizontal chip scroller (bleeds to the screen edges, gap 8, no scrollbar). `wrap` → wrapping flex row instead. */
export function ChipRow({ children, wrap, ariaLabel }: { children: ReactNode; wrap?: boolean; ariaLabel?: string }): JSX.Element {
  return (
    <div className={`ui-chiprow${wrap ? ' ui-chiprow--wrap' : ''}`} role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
