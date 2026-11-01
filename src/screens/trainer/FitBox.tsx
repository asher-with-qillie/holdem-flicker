import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isSettling } from '../../state/viewport';

export interface BoxSize {
  width: number;
  height: number;
}

/** Scale steps (Duo spec §0.2): a few fixed sizes instead of a continuous scale, so the cards do not "breathe" by a
 *  pixel or two whenever a neighbour changes height. Below the last step the content is hidden (the label stays). */
export const SCALE_STEPS = [1, 0.875, 0.75, 0.625, 0.5] as const;

/** Largest step ≤ raw (raw > 1 → 1); below 0.5, NaN or ≤ 0 → 0 (= hide). */
export function quantizeScale(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  for (const s of SCALE_STEPS) if (raw >= s - 1e-6) return s;
  return 0;
}

/** Rough layout size (untransformed offset box) of a two-card HandView: padding 14+14 / 10+8, second card overlaps 30 %. */
export const FAN_CARD_W = { sm: 44, md: 84, lg: 160 } as const;
export type FanSize = keyof typeof FAN_CARD_W;
export function fanBox(size: FanSize): BoxSize {
  const w = FAN_CARD_W[size];
  return { width: 1.7 * w + 28, height: 1.4 * w + 18 };
}
/** Raw fit scale with FitBox's own margins (8 px across, 4 px down). */
export function fitScale(box: BoxSize, content: BoxSize): number {
  return Math.min(1, (box.width - 8) / content.width, (box.height - 4) / content.height);
}
/** The fan size that renders largest after quantizing (ties → the larger natural size). */
export function pickFanSize(box: BoxSize): FanSize {
  let best: FanSize = 'sm';
  let bestW = -1;
  for (const size of ['lg', 'md', 'sm'] as const) {
    const w = FAN_CARD_W[size] * quantizeScale(fitScale(box, fanBox(size)));
    if (w > bestW + 0.5) {
      best = size;
      bestW = w;
    }
  }
  return best;
}

/**
 * Centres its content and scales it down (never up) so it always fits the box it is given. The scale is quantized
 * to SCALE_STEPS; below 0.5 the content is hidden (`onScale(0)`). While the viewport is settling (fold / unfold /
 * rotate, viewport.ts debounce) the last non-zero scale is held so the transitional frames never flash a 0 px or an
 * over-sized fan; it re-measures once the viewport has settled.
 * The render prop receives the measured box so callers can pick a component size before scaling kicks in.
 */
export function FitBox({ className, children, onScale }: { className?: string; children: (box: BoxSize) => ReactNode; onScale?: (scale: number) => void }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<BoxSize>({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const last = useRef(1);
  const applied = useRef(1);
  const cb = useRef(onScale);
  cb.current = onScale;
  // The box the children were last rendered for: a measurement of children still sized for another box is stale.
  const rendered = useRef<BoxSize>({ width: 0, height: 0 });
  const measure = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let retry = 0;
    const update = () => {
      const ow = o.clientWidth;
      const oh = o.clientHeight;
      if (ow !== rendered.current.width || oh !== rendered.current.height) {
        // re-render the children for this box first; the layout effect on [box] measures them then
        setBox((b) => (b.width === ow && b.height === oh ? b : { width: ow, height: oh }));
        return;
      }
      const iw = i.offsetWidth;
      const ih = i.offsetHeight;
      if (!iw || !ih) return;
      let s = quantizeScale(fitScale({ width: ow, height: oh }, { width: iw, height: ih }));
      if (isSettling()) {
        // Hold the last good scale through the transitional resizes, then look again.
        window.clearTimeout(retry);
        retry = window.setTimeout(update, 200);
        if (last.current > 0) s = last.current;
      }
      if (s > 0) last.current = s;
      // The callback runs outside the state updater (StrictMode calls updaters twice).
      if (applied.current !== s) {
        applied.current = s;
        setScale(s);
        cb.current?.(s);
      }
    };
    measure.current = update;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(i);
    return () => {
      ro.disconnect();
      window.clearTimeout(retry);
    };
  }, []);

  useLayoutEffect(() => {
    rendered.current = box;
    measure.current();
  }, [box]);

  return (
    <div ref={outer} className={`fitbox${className ? ` ${className}` : ''}${scale === 0 ? ' fitbox--hidden' : ''}`}>
      <div ref={inner} className="fitbox__inner" style={{ transform: `scale(${scale || 0.5})` }} aria-hidden={scale === 0 || undefined}>
        {box.height > 0 ? children(box) : null}
      </div>
    </div>
  );
}
