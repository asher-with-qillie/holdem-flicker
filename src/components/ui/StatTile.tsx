import { GlassPanel } from './GlassPanel';

export interface StatTileProps {
  label: string;
  value: string | number;
  dot?: string; // CSS color, 6 px before the label
  delta?: string; // e.g. "+6"
  onClick?(): void;
}

/** .glass tile (blur-free — tiles sit on the ground), radius md, padding 12; value Title 2 tnum, label caption --ink-2. */
export function StatTile({ label, value, dot, delta, onClick }: StatTileProps): JSX.Element {
  return (
    <GlassPanel as={onClick ? 'button' : 'div'} radius="md" padding={12} interactive={Boolean(onClick)} className="ui-stat glass-flat" onClick={onClick}>
      <span className="ui-stat__label">
        {dot && <span className="ui-stat__dot" style={{ background: dot }} aria-hidden="true" />}
        {label}
      </span>
      <span className="ui-stat__value tnum">{typeof value === 'number' ? value.toLocaleString('ko-KR') : value}</span>
      {delta && <span className="ui-stat__delta tnum">{delta}</span>}
    </GlassPanel>
  );
}
