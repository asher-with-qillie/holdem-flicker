import { actionLabel } from '../../components/ActionBadge';
import { rangeShare } from '../../poker/range';
import { SCENARIO_ACTIONS, type Action, type ChartCells, type ScenarioKind } from '../../poker/types';
import { formatPct } from './selection';

function swatchColor(action: Action): string {
  return action === 'fold' ? 'var(--rg-fold)' : `var(--act-${action})`;
}

/** Share bar (8 px, aggressive → passive, the fold share is the track) + footnote "오픈 18.1% · 폴드 81.9%". */
export function ActionShares({ cells, kind }: { cells: ChartCells; kind: ScenarioKind }) {
  const actions = SCENARIO_ACTIONS[kind].filter((a) => a !== 'fold').reverse();
  const shares = actions.map((action) => ({ action, share: rangeShare(cells, action) }));
  const cont = rangeShare(cells);
  return (
    <div className="charts__shares">
      <div className="charts__bar" aria-hidden="true">
        {shares
          .filter((s) => s.share > 0.0005)
          .map(({ action, share }) => (
            <i key={action} style={{ width: `${(share * 100).toFixed(2)}%`, background: swatchColor(action) }} />
          ))}
      </div>
      <p className="charts__sharetext t-footnote" aria-label="액션별 비율">
        {shares.map(({ action, share }) => (
          <span key={action} className="share">
            <i className="share__dot" style={{ background: swatchColor(action) }} aria-hidden="true" />
            {actionLabel(action, kind, true)} <b>{formatPct(share)}</b>
          </span>
        ))}
        <span className="share share--fold">
          폴드 <b>{formatPct(1 - cont)}</b>
        </span>
      </p>
    </div>
  );
}

/** Colour legend: every action of the kind, how mixed cells and the pair diagonal are drawn, and (내 기록 on) the overlay marks. */
export function ChartLegend({ kind, overlay }: { kind: ScenarioKind; overlay?: boolean }) {
  const actions = [...SCENARIO_ACTIONS[kind]].reverse();
  const nonFold = actions.filter((a) => a !== 'fold');
  const mixA = swatchColor(nonFold[0] ?? 'fold');
  const mixB = swatchColor(nonFold[1] ?? 'fold');
  return (
    <div className="charts__legend" aria-label="범례">
      {actions.map((a) => (
        <span key={a} className="legend__item">
          <i className="legend__swatch" style={{ background: swatchColor(a) }} aria-hidden="true" />
          {actionLabel(a, kind, true)}
        </span>
      ))}
      <span className="legend__item">
        <i className="legend__swatch" style={{ background: `linear-gradient(90deg, ${mixA} 0 60%, ${mixB} 60% 100%)` }} aria-hidden="true" />
        혼합
      </span>
      <span className="legend__item">
        <i className="legend__swatch legend__swatch--pair" aria-hidden="true" />
        페어
      </span>
      {overlay && (
        <>
          <span className="legend__item">
            <i className="legend__swatch legend__swatch--mastered" aria-hidden="true" />
            외웠어요
          </span>
          <span className="legend__item">
            <i className="legend__swatch legend__swatch--dot legend__swatch--amber" aria-hidden="true" />
            배우는 중
          </span>
          <span className="legend__item">
            <i className="legend__swatch legend__swatch--dot legend__swatch--coral" aria-hidden="true" />
            약점
          </span>
          <span className="legend__item">
            <i className="legend__swatch legend__swatch--unseen" aria-hidden="true" />
            아직 안 봄
          </span>
        </>
      )}
    </div>
  );
}
