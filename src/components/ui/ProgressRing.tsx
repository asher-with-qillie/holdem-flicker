import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ProgressRingProps {
  value: number;
  max: number;
  size?: 64 | 88 | 120;
  stroke?: 6 | 8 | 10;
  tint?: string; // default var(--mint); pass var(--gold) when goal reached
  innerValue?: number; // optional thin inner ring (rated cards) — stroke 3, --sky
  label?: ReactNode; // centered content
  animate?: boolean; // default true — fills 0→value on mount, transitions on change (600 ms)
  celebrate?: boolean; // one pulse scale 1→1.06→1, 420ms, when it becomes true
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function ProgressRing({ value, max, size = 88, stroke = 8, tint = 'var(--mint)', innerValue, label, animate = true, celebrate }: ProgressRingProps): JSX.Element {
  const target = clamp01(max > 0 ? value / max : 0);
  const [shown, setShown] = useState(animate ? 0 : target);
  const [pulse, setPulse] = useState(false);
  const prevCelebrate = useRef(false);

  useEffect(() => {
    if (!animate) {
      setShown(target);
      return;
    }
    const id = requestAnimationFrame(() => setShown(target));
    return () => cancelAnimationFrame(id);
  }, [target, animate]);

  useEffect(() => {
    if (celebrate && !prevCelebrate.current) setPulse(true);
    prevCelebrate.current = Boolean(celebrate);
  }, [celebrate]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const innerR = r - stroke / 2 - 4;
  const innerC = 2 * Math.PI * innerR;
  const innerShown = innerValue === undefined ? 0 : clamp01(max > 0 ? innerValue / max : 0);
  const style = { '--tint': tint, width: size, height: size } as CSSProperties;

  return (
    <div
      className={`ui-ring ui-ring--${size}${pulse ? ' ui-ring--celebrate' : ''}${animate ? '' : ' ui-ring--static'}`}
      style={style}
      role="progressbar"
      aria-valuenow={Math.round(target * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onAnimationEnd={() => setPulse(false)}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="ui-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="ui-ring__fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
        {innerValue !== undefined && innerR > 4 && (
          <circle className="ui-ring__inner" cx={size / 2} cy={size / 2} r={innerR} fill="none" strokeWidth={3} strokeDasharray={innerC} strokeDashoffset={innerC * (1 - innerShown)} />
        )}
      </svg>
      {label !== undefined && <div className="ui-ring__label">{label}</div>}
    </div>
  );
}
