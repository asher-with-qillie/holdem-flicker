import { useMemo, type CSSProperties } from 'react';
import { RANKS, type Action, type ChartCells, type HandName } from '../poker/types';
import { gridHand } from '../poker/hands';
import { lineOf } from '../poker/line';
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
  /**
   * 손패 고르기 색칠(자리별 보기 §3). 주면 `cells` 의 혼합 대신 이 색을 칸 배경으로 씁니다 — undefined 는 폴드 칸처럼 흐리게.
   * 그리드 모양·라벨·링은 그대로라서 '같은 13×13' 으로 읽힙니다.
   */
  paint?: (hand: HandName) => string | undefined;
  /**
   * 인출 연습용 가림(Duo spec §4 G/T, think 단계). 모든 칸을 중립색으로 그리고 폴드 여부도 숨깁니다 — 행동 색이 DOM 에도 없습니다.
   * 라벨 · 페어 대각선 · highlight 링 · focusLine 외곽선은 그대로라 기하가 바뀌지 않고, false 로 바뀌면 200 ms 페이드로 칠해집니다.
   */
  masked?: boolean;
  /** 이 칸들(보통 `lineHands(hand)`, 13칸 줄)에 외곽선을 긋고 나머지는 45% 로 흐립니다. */
  focusLine?: readonly HandName[];
  /** thumb: 라벨 없는 썸네일. role=img, 칸은 누를 수 없는 span(포커스·탭 대상 아님), pointer-events none. */
  variant?: 'full' | 'thumb';
}

/** 패가 속한 13칸 줄(lineOf)의 실제 칸 — 유령 칸·빈칸은 뺍니다. focusLine 에 그대로 넘기면 됩니다. */
export function lineHands(hand: HandName): HandName[] {
  return lineOf(hand)
    .slots.filter((s) => s.inLine && s.hand)
    .map((s) => s.hand as HandName);
}

/** Slice order inside a cell: most aggressive on the left, fold (dim) on the right.
    손으로 적은 배열입니다 — 빠진 액션은 조용히 사라지고 그라데이션이 100%가 안 됩니다. */
const SLICE_ORDER: Action[] = ['allin', 'fourbet', 'threebet', 'raise', 'call', 'check', 'fold'];

/** 혼합 비중 → 칸 배경. 단색이면 `var(--act-*)`, 폴드뿐이면 undefined(칸의 --rg-fold 가 보임), 섞였으면 좌→우 분할 그라데이션. */
export function cellBackground(mix: Array<{ action: Action; weight: number }>): string | undefined {
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
export function RangeGrid({ cells, highlight, onSelect, overlay, paint, masked, focusLine, variant = 'full' }: RangeGridProps) {
  const rows = useMemo(
    () =>
      RANKS.map((_, r) =>
        RANKS.map((_, c) => {
          const hand = gridHand(r, c);
          if (paint) {
            const background = paint(hand);
            return { hand, pair: r === c, playable: background !== undefined, background };
          }
          const mix = fullMix(cells[hand]);
          const playable = mix.some((m) => m.action !== 'fold');
          return { hand, pair: r === c, playable, background: cellBackground(mix) };
        }),
      ),
    [cells, paint],
  );
  const line = useMemo(() => (focusLine && focusLine.length ? new Set<HandName>(focusLine) : null), [focusLine]);
  const thumb = variant === 'thumb';
  const gridCls = ['rgrid', overlay && 'rgrid--overlay', masked && 'rgrid--masked', line && 'rgrid--focus', thumb && 'rgrid--thumb'].filter(Boolean).join(' ');
  const label = thumb ? (masked ? '패 레인지 차트 (가림)' : highlight ? `패 레인지 차트 · ${highlight}` : '패 레인지 차트') : '패 레인지 차트';
  return (
    <div className={gridCls} role={thumb ? 'img' : 'group'} aria-label={label}>
      {rows.map((row, r) => (
        <div key={RANKS[r]} className="rgrid__row">
          {row.map(({ hand, pair, playable, background }) => {
            const hl = highlight === hand;
            const mastery = overlay ? (overlay[hand] ?? 'unseen') : undefined;
            const cls = [
              'rgrid__cell',
              pair && 'rgrid__cell--pair',
              !masked && !playable && 'rgrid__cell--fold',
              !masked && background && 'rgrid__cell--painted',
              hl && 'rgrid__cell--hl',
              line?.has(hand) && 'rgrid__cell--line',
              mastery && `rgrid__cell--${mastery}`,
            ]
              .filter(Boolean)
              .join(' ');
            // 칠은 ::before 층(--paint)에 둡니다 — 가림이 풀릴 때 글자는 그대로 두고 색만 페이드인할 수 있게. 가린 동안에는 아예 싣지 않습니다.
            const style = !masked && background ? ({ '--paint': background } as CSSProperties) : undefined;
            const dot = (mastery === 'learning' || mastery === 'weak') && <i className="rgrid__dot" aria-hidden="true" />;
            if (thumb) {
              return (
                <span key={hand} className={cls} style={style}>
                  {dot}
                </span>
              );
            }
            return (
              <button
                key={hand}
                type="button"
                className={cls}
                style={style}
                onClick={onSelect ? () => onSelect(hand) : undefined}
                aria-label={hand}
                aria-current={hl ? 'true' : undefined}
                tabIndex={onSelect ? 0 : -1}
              >
                {hand}
                {dot}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
