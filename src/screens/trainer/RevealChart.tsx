import { RangeGrid } from '../../components/RangeGrid';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { Sheet } from '../../components/ui/Sheet';
import { scenarioTitle } from '../../poker/scenarios';
import type { Step } from '../../poker/trainer';
import { setTab } from '../../state/nav';
import { ActionShares, ChartLegend } from '../charts/ChartStats';
import { saveSelection, type ChartSelection } from '../charts/selection';
import { getSession, togglePause } from './sessionStore';

/**
 * 차트 sheet on the reveal screen (§5.4): the GTO chart of the card at hand, one tap away — action shares,
 * the 13×13 grid with the current hand ringed, the colour legend and the chart's Korean summary. The footer
 * jumps to the 차트 tab with this scenario preselected (`launch()` only targets 훈련 / 퀴즈, so the selection is
 * written the way the chart browser stores it and the tab is switched) — and pauses the session on the way out,
 * so the time spent browsing charts is not counted as study time.
 *
 * The caller opens it with `setSheetOpen(true)` (session paused + auto-advance cancelled) and closes it back
 * to the plain 다음 button. The sheet body scrolls on its own — the session screen behind it never scrolls.
 */
export function RevealChart({ open, step, onClose }: { open: boolean; step: Step; onClose(): void }): JSX.Element {
  const { scenario } = step;
  const openCharts = () => {
    const sel: ChartSelection = { kind: scenario.kind, hero: scenario.hero, ...(scenario.villain ? { villain: scenario.villain } : {}) };
    saveSelection(sel);
    onClose();
    // 차트 탭을 보는 동안은 세션 시계를 멈춰요 — 안 그러면 둘러본 시간이 공부한 시간으로 쌓여요.
    if (getSession()?.status === 'running') togglePause();
    setTab('charts');
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="full"
      title={scenarioTitle(scenario)}
      footer={
        <CapsuleButton tone="neutral" size="lg" block onClick={openCharts}>
          전체 차트 보기
        </CapsuleButton>
      }
    >
      <div className="trainer-chart">
        <ActionShares cells={step.cells} kind={scenario.kind} />
        <div className="trainer-chart__grid glass glass-flat">
          <RangeGrid cells={step.cells} highlight={step.hand} />
        </div>
        <p className="trainer-chart__you t-footnote">
          <i aria-hidden="true" />
          <span>
            내 패 <b>{step.hand}</b>는 여기
          </span>
        </p>
        <ChartLegend kind={scenario.kind} />
        {step.chart.summary && <p className="trainer-chart__summary t-subhead">{step.chart.summary}</p>}
      </div>
    </Sheet>
  );
}
