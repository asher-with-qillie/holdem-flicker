import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  count?: number;
  dot?: string; // CSS color
  tint?: string; // selected tint (default var(--mint))
  size?: 32 | 36 | 40;
}

/** Capsule chip: .fill at rest, .glass-tint when selected (blur-free — chips are small and often many). 4 px vertical hit-slop → 44 px target. */
export function Chip({ selected, count, dot, tint, size = 36, className, style, children, type = 'button', ...rest }: ChipProps): JSX.Element {
  const cls = ['ui-chip', `ui-chip--${size}`, selected ? 'glass-tint glass-flat ui-chip--selected' : 'fill', className ?? ''].filter(Boolean).join(' ');
  const merged: CSSProperties | undefined = tint ? ({ ...style, '--tint': tint } as CSSProperties) : style;
  return (
    <button type={type} className={cls} style={merged} aria-pressed={selected === undefined ? undefined : selected} {...rest}>
      {dot && <span className="ui-chip__dot" style={{ background: dot }} aria-hidden="true" />}
      <span className="ui-chip__label">{children}</span>
      {count !== undefined && <span className="ui-chip__count tnum">{count}</span>}
    </button>
  );
}
