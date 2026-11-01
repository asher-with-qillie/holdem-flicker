import { useMemo, type KeyboardEvent } from 'react';
import { lineHands, RangeGrid } from '../../components/RangeGrid';
import type { Step } from '../../poker/trainer';
import '../../styles/trainer.css';

export interface StageChartProps {
  step: Step;
  /** think = masked (every cell neutral, labels / ring / line outline kept); reveal = painted. Geometry never changes. */
  masked: boolean;
  /** thumb = label-less mini map (T); full = labelled 13×13 (G). */
  variant: 'thumb' | 'full';
  /** Reveal only: the map becomes a button that opens the 차트 sheet. */
  onOpen?: () => void;
  className?: string;
}

/**
 * The 13×13 chart of the card at hand, drawn into the session itself (Duo spec §4 "G" / "T"). While thinking it is
 * masked — every cell neutral, but the labels, the ring on this hand and the outline of its 13-cell line stay, so
 * the shape is there to recall into without giving the answer away (retrieval practice is kept). On reveal the colours
 * fade in over 200 ms (RangeGrid's paint layer) without any re-layout. Cells are never interactive here.
 */
export function StageChart({ step, masked, variant, onOpen, className }: StageChartProps): JSX.Element {
  const line = useMemo(() => lineHands(step.hand), [step.hand]);
  const button = !!onOpen && !masked;
  const cls = ['stagechart', `stagechart--${variant}`, masked ? 'stagechart--masked' : 'stagechart--painted', button ? 'stagechart--button' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const grid = <RangeGrid cells={step.cells} highlight={step.hand} masked={masked} focusLine={line} variant={variant} />;
  if (button) {
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen?.();
      }
    };
    return (
      <div className={cls} role="button" tabIndex={0} aria-label={`차트 크게 보기 · ${step.hand}`} onClick={onOpen} onKeyDown={onKey}>
        {grid}
      </div>
    );
  }
  return <div className={cls}>{grid}</div>;
}
