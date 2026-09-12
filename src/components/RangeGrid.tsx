import { useMemo } from 'react';
import { RANKS, type Action, type ChartCells, type HandName } from '../poker/types';
import { gridHand } from '../poker/hands';
import { fullMix } from '../poker/range';
import '../styles/charts.css';

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
 * Mixed cells are painted as proportional vertical slices; the pair diagonal is outlined.
 */
export function RangeGrid({ cells, highlight, onSelect }: { cells: ChartCells; highlight?: HandName; onSelect?: (hand: HandName) => void }) {
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
    <div className="rgrid" role="group" aria-label="핸드 레인지 차트">
      {rows.map((row, r) => (
        <div key={RANKS[r]} className="rgrid__row">
          {row.map(({ hand, pair, playable, background }) => {
            const hl = highlight === hand;
            const cls = ['rgrid__cell', pair && 'rgrid__cell--pair', !playable && 'rgrid__cell--fold', hl && 'rgrid__cell--hl'].filter(Boolean).join(' ');
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
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
