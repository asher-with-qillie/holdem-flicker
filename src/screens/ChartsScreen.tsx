import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExplanationSheet } from '../components/ExplanationSheet';
import { RangeGrid } from '../components/RangeGrid';
import { ALL_CHART_DEFS, getChartCells, getChartDef, hasChart } from '../poker/data';
import { explainStep, type Explanation } from '../poker/explain';
import { allScenarios, scenarioSituation, scenarioTitle } from '../poker/scenarios';
import { stepFor, type Step } from '../poker/trainer';
import { SCENARIO_KINDS, type HandName, type Pos, type ScenarioKind } from '../poker/types';
import { vibrate } from '../state/settings';
import { ActionShares, ChartLegend } from './charts/ChartStats';
import {
  KIND_CHIP_LABEL,
  VILLAIN_LABEL,
  heroHasAnyChart,
  heroesFor,
  kindHasAnyChart,
  loadSelection,
  normalizeSelection,
  saveSelection,
  toScenario,
  villainsFor,
  type ChartSelection,
} from './charts/selection';
import '../styles/charts.css';

const TOTAL_SCENARIOS = allScenarios().length;

function Chip({ on, dim, onClick, children }: { on: boolean; dim?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`cchip${on ? ' cchip--on' : ''}${dim ? ' cchip--dim' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="charts__group" role="group" aria-label={label}>
      <div className="charts__label">{label}</div>
      <div className="cchips">{children}</div>
    </div>
  );
}

export function ChartsScreen() {
  const [sel, setSel] = useState<ChartSelection>(loadSelection);
  const [picked, setPicked] = useState<{ step: Step; explanation: Explanation } | null>(null);
  const [lastHand, setLastHand] = useState<HandName | undefined>(undefined);

  useEffect(() => saveSelection(sel), [sel]);

  const scenario = useMemo(() => toScenario(sel), [sel]);
  const ready = hasChart(scenario);
  const cells = ready ? getChartCells(scenario) : null;
  const summary = ready ? getChartDef(scenario).summary : undefined;

  const heroes = heroesFor(sel.kind);
  const villains = villainsFor(sel.kind, sel.hero);
  const villainLabel = VILLAIN_LABEL[sel.kind];
  const anyDim = SCENARIO_KINDS.some((k) => !kindHasAnyChart(k)) || heroes.some((h) => !heroHasAnyChart(sel.kind, h)) || villains.some((v) => !hasChart({ kind: sel.kind, hero: sel.hero, villain: v }));

  const pickKind = (kind: ScenarioKind) => setSel((s) => normalizeSelection({ ...s, kind }));
  const pickHero = (hero: Pos) => setSel((s) => normalizeSelection({ ...s, hero }));
  const pickVillain = (villain: Pos) => setSel((s) => normalizeSelection({ ...s, villain }));

  const openHand = (hand: HandName) => {
    try {
      const step = stepFor(scenario, hand);
      setPicked({ step, explanation: explainStep(step) });
      setLastHand(hand);
      vibrate(8);
    } catch {
      /* chart not authored yet — the empty state is already showing */
    }
  };

  return (
    <div className="screen charts">
      <header>
        <h1 className="screen__title">차트</h1>
        <p className="screen__sub">상황과 포지션을 고르고, 칸을 누르면 해설이 열려요.</p>
      </header>

      <section className="charts__picker">
        <ChipGroup label="상황">
          {SCENARIO_KINDS.map((k) => (
            <Chip key={k} on={sel.kind === k} dim={!kindHasAnyChart(k)} onClick={() => pickKind(k)}>
              {KIND_CHIP_LABEL[k]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="내 포지션">
          {heroes.map((h) => (
            <Chip key={h} on={sel.hero === h} dim={!heroHasAnyChart(sel.kind, h)} onClick={() => pickHero(h)}>
              {h}
            </Chip>
          ))}
        </ChipGroup>
        {villainLabel && villains.length > 0 && (
          <ChipGroup label={villainLabel}>
            {villains.map((v) => (
              <Chip key={v} on={sel.villain === v} dim={!hasChart({ kind: sel.kind, hero: sel.hero, villain: v })} onClick={() => pickVillain(v)}>
                {v}
              </Chip>
            ))}
          </ChipGroup>
        )}
        {anyDim && <p className="charts__note">흐린 항목은 아직 준비 중인 차트예요.</p>}
      </section>

      <section className="charts__chart">
        <h2 className="charts__title">{scenarioTitle(scenario)}</h2>
        <p className="charts__situation">{scenarioSituation(scenario)}</p>

        {cells ? (
          <>
            <ActionShares cells={cells} kind={sel.kind} />
            <RangeGrid cells={cells} highlight={lastHand} onSelect={openHand} />
            <ChartLegend kind={sel.kind} />
          </>
        ) : (
          <div className="charts__empty" role="status">
            <svg className="charts__empty-icon" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="4" y="4" width="40" height="40" rx="6" />
              <path d="M4 17.3h40M4 30.7h40M17.3 4v40M30.7 4v40" />
            </svg>
            <strong>아직 준비 중인 차트예요</strong>
            <p>이 상황의 레인지는 아직 작성 중입니다. 다른 상황이나 포지션을 골라 보세요.</p>
            <p className="charts__empty-count">
              준비된 차트 {ALL_CHART_DEFS.length}개 / 전체 {TOTAL_SCENARIOS}개
            </p>
          </div>
        )}
      </section>

      {summary && (
        <section className="panel">
          <div className="panel__title">차트 요약</div>
          <p className="charts__summary">{summary}</p>
        </section>
      )}

      <p className="charts__disclaimer">솔버 결과를 단순화한 근사치입니다. 레이크·상대 성향에 따라 경계 핸드는 달라질 수 있어요.</p>

      {picked && <ExplanationSheet step={picked.step} explanation={picked.explanation} onClose={() => setPicked(null)} />}
    </div>
  );
}
