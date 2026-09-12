import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface BoxSize {
  width: number;
  height: number;
}

/**
 * Centres its content and scales it down (never up) so it always fits the box it is given.
 * The render prop receives the measured box so callers can pick a component size before scaling kicks in.
 */
export function FitBox({ className, children }: { className?: string; children: (box: BoxSize) => ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<BoxSize>({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const ow = o.clientWidth;
      const oh = o.clientHeight;
      setBox((b) => (b.width === ow && b.height === oh ? b : { width: ow, height: oh }));
      const iw = i.offsetWidth;
      const ih = i.offsetHeight;
      if (!iw || !ih) return;
      // Small margins so a fanned card's rotated corners do not touch the neighbours.
      const s = Math.min(1, (ow - 8) / iw, (oh - 4) / ih);
      setScale(Number.isFinite(s) && s > 0 ? Math.round(s * 1000) / 1000 : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outer} className={`fitbox${className ? ` ${className}` : ''}`}>
      <div ref={inner} className="fitbox__inner" style={{ transform: `scale(${scale})` }}>
        {box.height > 0 ? children(box) : null}
      </div>
    </div>
  );
}
