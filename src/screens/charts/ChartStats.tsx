import { actionLabel } from '../../components/ActionBadge';
import { rangeShare } from '../../poker/range';
import { SCENARIO_ACTIONS, type Action, type ChartCells, type ScenarioKind } from '../../poker/types';
import { formatPct } from './selection';

function swatchColor(action: Action): string {
  return action === 'fold' ? 'var(--rg-fold)' : `var(--act-${action})`;
}

/** Share of all combos per action, aggressive first, then the non-fold total and fold: "3벳 8.1% · 콜 12.4% · 계속 20.5% · 폴드 79.5%". */
export function ActionShares({ cells, kind }: { cells: ChartCells; kind: ScenarioKind }) {
  const actions = SCENARIO_ACTIONS[kind].filter((a) => a !== 'fold').reverse();
  const cont = rangeShare(cells);
  return (
    <div className="charts__shares" aria-label="액션별 비율">
      {actions.map((a) => (
        <span key={a} className="share">
          <i className="share__dot" style={{ background: swatchColor(a) }} aria-hidden="true" />
          {actionLabel(a, kind, true)} <b>{formatPct(rangeShare(cells, a))}</b>
        </span>
      ))}
      {actions.length > 1 && (
        <span className="share share--total">
          계속 <b>{formatPct(cont)}</b>
        </span>
      )}
      <span className="share share--fold">
        폴드 <b>{formatPct(1 - cont)}</b>
      </span>
    </div>
  );
}

/** Colour legend for the grid: every action of the kind + how mixed cells and the pair diagonal are drawn. */
export function ChartLegend({ kind }: { kind: ScenarioKind }) {
  const actions = [...SCENARIO_ACTIONS[kind]].reverse();
  const nonFold = actions.filter((a) => a !== 'fold');
  const mixA = swatchColor(nonFold[0] ?? 'fold');
  const mixB = swatchColor(nonFold[1] ?? 'fold');
  return (
    <div className="legend charts__legend" aria-label="범례">
      {actions.map((a) => (
        <span key={a} className="legend__item">
          <i className="legend__swatch" style={{ background: swatchColor(a) }} aria-hidden="true" />
          {actionLabel(a, kind, true)}
        </span>
      ))}
      <span className="legend__item">
        <i className="legend__swatch" style={{ background: `linear-gradient(90deg, ${mixA} 0 60%, ${mixB} 60% 100%)` }} aria-hidden="true" />
        혼합 (비율만큼 나뉨)
      </span>
      <span className="legend__item">
        <i className="legend__swatch legend__swatch--pair" aria-hidden="true" />
        포켓페어 대각선
      </span>
    </div>
  );
}
