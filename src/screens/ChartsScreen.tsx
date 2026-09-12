import { useCallback, useEffect, useMemo, useState } from 'react';
import { RangeGrid } from '../components/RangeGrid';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { Chip } from '../components/ui/Chip';
import { GlassPanel } from '../components/ui/GlassPanel';
import { Switch } from '../components/ui/Switch';
import { IconCards } from '../components/ui/icons';
import { getChartCells, getChartDef, hasChart } from '../poker/data';
import { explainStep, type Explanation } from '../poker/explain';
import { scenarioKey, scenarioSituation, scenarioTitle } from '../poker/scenarios';
import { stepFor, type Step } from '../poker/trainer';
import { SCENARIO_KINDS, type HandName, type Pos, type ScenarioKind } from '../poker/types';
import { launch } from '../state/nav';
import { useSettings } from '../state/settings';
import { useSrs } from '../state/srs';
import { CellSheet } from './charts/CellSheet';
import { ChartFilters, FilterRow } from './charts/ChartFilters';
import { ActionShares, ChartLegend } from './charts/ChartStats';
import { masteryFor } from './charts/mastery';
import {
  KIND_CHIP_LABEL,
  VILLAIN_LABEL,
  heroHasAnyChart,
  heroesFor,
  kindHasAnyChart,
  loadOverlay,
  loadSelection,
  normalizeSelection,
  saveOverlay,
  saveSelection,
  toScenario,
  villainsFor,
  type ChartSelection,
} from './charts/selection';
import '../styles/charts.css';

/** Dev fixture for the `charts-empty` screenshot — every scenario has a chart today, so open …/#charts-empty. Remove before final. */
function forceEmpty(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#charts-empty';
}

function EmptyPanel() {
  return (
    <GlassPanel radius="md" className="glass-flat charts__empty" role="status">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect x="4" y="4" width="40" height="40" rx="8" />
        <path d="M4 17.3h40M4 30.7h40M17.3 4v40M30.7 4v40" />
      </svg>
      <strong className="t-headline">이 조합의 차트가 아직 없어요</strong>
      <p className="t-footnote ink-2">다른 상황이나 포지션을 골라 보세요</p>
    </GlassPanel>
  );
}

/**
 * 차트 (spec §5.8): large title + 내 기록 switch, sticky chip rows (상황 / 나 / 상대), scenario title, share bar,
 * the 13×13 RangeGrid on a glass panel, legend, chart summary and "이 상황으로 훈련하기". Selection lives in
 * sessionStorage; a cell tap opens the explanation sheet with the 헷갈려요 flag.
 */
export function ChartsScreen() {
  const [sel, setSel] = useState<ChartSelection>(loadSelection);
  const [overlayOn, setOverlayOn] = useState<boolean>(loadOverlay);
  const [picked, setPicked] = useState<{ step: Step; explanation: Explanation } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastHand, setLastHand] = useState<HandName | undefined>(undefined);
  const [settings] = useSettings();
  const srsVersion = useSrs();

  useEffect(() => saveSelection(sel), [sel]);
  useEffect(() => saveOverlay(overlayOn), [overlayOn]);

  const scenario = useMemo(() => toScenario(sel), [sel]);
  const key = scenarioKey(scenario);
  const ready = hasChart(scenario) && !forceEmpty();
  const cells = ready ? getChartCells(scenario) : null;
  const summary = ready ? getChartDef(scenario).summary : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- srsVersion re-runs the memo when a rating lands
  const mastery = useMemo(() => (overlayOn && ready ? masteryFor(scenario) : null), [overlayOn, ready, scenario, srsVersion]);

  const heroes = heroesFor(sel.kind);
  const villains = villainsFor(sel.kind, sel.hero);

  const pickKind = (kind: ScenarioKind) => setSel((s) => normalizeSelection({ ...s, kind }));
  const pickHero = (hero: Pos) => setSel((s) => normalizeSelection({ ...s, hero }));
  const pickVillain = (villain: Pos) => setSel((s) => normalizeSelection({ ...s, villain }));

  const openHand = useCallback(
    (hand: HandName) => {
      try {
        const step = stepFor(scenario, hand);
        setPicked({ step, explanation: explainStep(step) });
        setSheetOpen(true);
        setLastHand(hand);
      } catch {
        /* no chart for this scenario — the empty panel is already showing */
      }
    },
    [scenario],
  );

  const train = () => launch({ target: 'train', deck: 'scenario', scenarioId: key, positions: [sel.hero], autostart: true });

  const rated = mastery ? mastery.counts.mastered + mastery.counts.learning + mastery.counts.weak : 0;

  return (
    <div className="screen charts">
      <header className="charts__head">
        <h1 className="t-title-l">차트</h1>
        <label className="charts__toggle">
          내 기록
          <Switch checked={overlayOn} onChange={setOverlayOn} label="내 기록 표시" />
        </label>
      </header>

      <ChartFilters>
        <FilterRow label="상황" ariaLabel="상황">
          {SCENARIO_KINDS.map((k) => (
            <Chip key={k} selected={sel.kind === k} disabled={!kindHasAnyChart(k)} onClick={() => pickKind(k)}>
              {KIND_CHIP_LABEL[k]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="나" ariaLabel="내 포지션">
          {heroes.map((h) => (
            <Chip key={h} className="charts__chip--pos" selected={sel.hero === h} disabled={!heroHasAnyChart(sel.kind, h)} onClick={() => pickHero(h)}>
              {h}
            </Chip>
          ))}
        </FilterRow>
        {villains.length > 0 && (
          <FilterRow label="상대" ariaLabel={VILLAIN_LABEL[sel.kind] ?? '상대 포지션'}>
            {villains.map((v) => (
              <Chip
                key={v}
                className="charts__chip--pos"
                selected={sel.villain === v}
                disabled={!hasChart({ kind: sel.kind, hero: sel.hero, villain: v })}
                onClick={() => pickVillain(v)}
              >
                {v}
              </Chip>
            ))}
          </FilterRow>
        )}
      </ChartFilters>

      <section key={key} className="charts__chart">
        <h2 className="t-title-2">{scenarioTitle(scenario)}</h2>
        <p className="charts__situation t-footnote">{scenarioSituation(scenario)}</p>

        {cells ? (
          <>
            <ActionShares cells={cells} kind={sel.kind} />
            <GlassPanel radius="md" padding={0} className="glass-flat charts__panel">
              <RangeGrid cells={cells} highlight={lastHand} onSelect={openHand} overlay={mastery?.overlay} />
            </GlassPanel>
            <ChartLegend kind={sel.kind} overlay={overlayOn} />
            {mastery && (
              <p className="charts__mastery t-footnote">
                {rated === 0 ? (
                  '아직 기록이 없어요 · 훈련하면 여기에 쌓여요'
                ) : (
                  <>
                    외웠어요 <b>{mastery.counts.mastered}</b> · 배우는 중 <b>{mastery.counts.learning}</b> · 약점 <b>{mastery.counts.weak}</b> · 아직 안 봄{' '}
                    <b>{mastery.counts.unseen}</b>
                  </>
                )}
              </p>
            )}
            {summary && (
              <p className="charts__summary t-body">
                <b>요약</b>
                {summary}
              </p>
            )}
            <CapsuleButton tone="neutral" size="lg" block icon={<IconCards />} trailing={`· ${settings.sessionSize}장`} onClick={train}>
              이 상황으로 훈련하기
            </CapsuleButton>
          </>
        ) : (
          <EmptyPanel />
        )}
      </section>

      <p className="charts__disclaimer t-footnote">솔버 결과를 단순화한 근사치예요. 레이크·상대 성향에 따라 경계 핸드는 달라질 수 있어요.</p>

      {picked && (
        <CellSheet key={`${key}|${picked.step.hand}`} step={picked.step} explanation={picked.explanation} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  );
}
