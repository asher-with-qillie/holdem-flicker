import { useCallback } from 'react';
import { RangeGrid } from '../../components/RangeGrid';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { entrySeat } from '../../poker/atlas';
import { getChartCells } from '../../poker/data';
import type { HandName, Pos } from '../../poker/types';

/** 손패 고르기 색: 어느 자리부터 오픈하는지. 앞자리부터 열수록 진한 민트, SB 에서만 열면 하늘색, 어디서도 안 열면 흐림. */
const ENTRY_COLOR: Record<Pos | 'SB', string | undefined> = {
  UTG: 'var(--heat-4)',
  HJ: 'var(--heat-3)',
  CO: 'var(--heat-2)',
  BTN: 'var(--heat-1)',
  SB: 'color-mix(in srgb, var(--sky) 55%, transparent)',
  BB: undefined,
};

const LEGEND: Array<{ seat: Pos | 'SB' | null; label: string }> = [
  { seat: 'UTG', label: 'UTG부터' },
  { seat: 'HJ', label: 'HJ부터' },
  { seat: 'CO', label: 'CO부터' },
  { seat: 'BTN', label: 'BTN부터' },
  { seat: 'SB', label: 'SB에서만' },
  { seat: null, label: '오픈 안 함' },
];

export function entrySeatPaint(hand: HandName): string | undefined {
  const seat = entrySeat(hand);
  return seat ? ENTRY_COLOR[seat] : undefined;
}

const RFI_UTG = { kind: 'rfi', hero: 'UTG' } as const;

/** 다른 패 고르기: 13×13 그리드를 '어디서부터 오픈하는가' 로 칠한 것 + 범례. 칸을 누르면 그 패의 아틀라스로. */
export function HandPicker({ hand, onSelect }: { hand: HandName; onSelect(hand: HandName): void }) {
  const paint = useCallback(entrySeatPaint, []);
  return (
    <div className="atlas__picker">
      <p className="t-footnote ink-2">색은 그 패를 처음 오픈하는 자리예요. 누르면 자리별 보기로 가요.</p>
      <GlassPanel radius="md" padding={0} className="glass-flat charts__panel">
        <RangeGrid cells={getChartCells(RFI_UTG)} highlight={hand} onSelect={onSelect} paint={paint} />
      </GlassPanel>
      <div className="charts__legend" aria-label="범례">
        {LEGEND.map((l) => (
          <span key={l.label} className="legend__item">
            <i className="legend__swatch" style={{ background: l.seat ? ENTRY_COLOR[l.seat] : 'var(--rg-fold)' }} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
