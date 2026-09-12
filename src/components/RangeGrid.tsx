import { useMemo } from 'react';
import { RANKS, type Action, type ChartCells, type HandName } from '../poker/types';
import { gridHand } from '../poker/hands';
import { fullMix } from '../poker/range';
import '../styles/charts.css';

/** P2 mastery overlay state per hand (spec §5.8): mastered = inner mint border, learning = amber dot, weak = coral dot, unseen = dimmed. */
export type MasteryState = 'mastered' | 'learning' | 'weak' | 'unseen';
export type MasteryOverlay = Partial<Record<HandName, MasteryState>>;

export interface RangeGridProps {
  cells: ChartCells;
  highlight?: HandName;
  onSelect?: (hand: HandName) => void;
  /** When given, hands missing from the map render as 'unseen'. */
  overlay?: MasteryOverlay;
}

/** Slice order inside a cell: most aggressive on the left, fold (dim) on the right. */
const SLICE_ORDER: Action[] = ['allin', 'fourbet', 'threebet', 'raise', 'call', 'fold'];

function cellBackground(mix: Array<{ action: Action; weight: number }>): string | undefined {
  const parts = SLICE_ORDER.map((action) => ({ action, weight: mix.find((m) => m.action === action)?.weight ?? 0 })).filter((p) => p.weight > 0.0005);
  if (parts.length === 1) return parts[0].action === 'fold' ? undefined : `var(--act-${parts[0].action})`;
  let acc = 0;
  const stops = parts.map(({ action, weight }) => {
    const from = (acc * 100).toFixed(2);
    acc += weight;
    const to = (Math.min(1, acc) * 100).toFixed(2);
    const color = action === 'fold' ? 'var(--rg-fold)' : `var(--act-${action})`;
    return `${color} ${from}% ${to}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * 13×13 hand grid (rows/cols in rank order A→2; diagonal = pairs, above = suited, below = offsuit).
 * Mixed cells are painted as proportional vertical slices; the pair diagonal is outlined; `highlight` gets a
 * 2 px mint ring. Labels stay ≥ 10 px down to 360 px wide (cells are `--r-xs` inside the `--r-md` panel).
 */
export function RangeGrid({ cells, highlight, onSelect, overlay }: RangeGridProps) {
  const rows = useMemo(
    () =>
      RANKS.map((_, r) =>
        RANKS.map((_, c) => {
          const hand = gridHand(r, c);
          const mix = fullMix(cells[hand]);
          const playable = mix.some((m) => m.action !== 'fold');
          return { hand, pair: r === c, playable, background: cellBackground(mix) };
        }),
      ),
    [cells],
  );
  return (
    <div className={`rgrid${overlay ? ' rgrid--overlay' : ''}`} role="group" aria-label="핸드 레인지 차트">
      {rows.map((row, r) => (
        <div key={RANKS[r]} className="rgrid__row">
          {row.map(({ hand, pair, playable, background }) => {
            const hl = highlight === hand;
            const mastery = overlay ? (overlay[hand] ?? 'unseen') : undefined;
            const cls = ['rgrid__cell', pair && 'rgrid__cell--pair', !playable && 'rgrid__cell--fold', hl && 'rgrid__cell--hl', mastery && `rgrid__cell--${mastery}`]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={hand}
                type="button"
                className={cls}
                style={background ? { background } : undefined}
                onClick={onSelect ? () => onSelect(hand) : undefined}
                aria-label={hand}
                aria-current={hl ? 'true' : undefined}
                tabIndex={onSelect ? 0 : -1}
              >
                {hand}
                {(mastery === 'learning' || mastery === 'weak') && <i className="rgrid__dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
