import type { CSSProperties } from 'react';

export interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange(v: T): void;
  size?: 44 | 48;
  ariaLabel: string;
}

/** Glass capsule track; the active segment is a tinted pill that glides (320 ms spring). */
export function SegmentedControl<T extends string>({ options, value, onChange, size = 44, ariaLabel }: SegmentedControlProps<T>): JSX.Element {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const style = { '--n': options.length, '--i': index } as CSSProperties;
  return (
    <div className={`ui-seg glass glass-flat ui-seg--${size}`} role="radiogroup" aria-label={ariaLabel} style={style}>
      <span className="ui-seg__pill glass-tint glass-flat" aria-hidden="true" />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ui-seg__opt${active ? ' ui-seg__opt--active' : ''}`}
            disabled={o.disabled}
            onClick={() => {
              if (!active) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
