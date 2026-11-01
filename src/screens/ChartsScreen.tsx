import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RangeGrid, lineHands } from '../components/RangeGrid';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { Chip } from '../components/ui/Chip';
import { GlassPanel } from '../components/ui/GlassPanel';
import { Switch } from '../components/ui/Switch';
import { IconButton } from '../components/ui/IconButton';
import { IconCards, IconGrid } from '../components/ui/icons';
import { getChartCells, getChartDef, hasChart } from '../poker/data';
import { restAction } from '../poker/range';
import { explainStep, type Explanation } from '../poker/explain';
import { scenarioKey, scenarioSituation, scenarioTitle } from '../poker/scenarios';
import { stepFor, type Step } from '../poker/trainer';
import { SCENARIO_KINDS, type HandName, type Pos, type ScenarioKind } from '../poker/types';
import { openAtlas } from '../state/atlas';
import { launch } from '../state/nav';
import { useSettings } from '../state/settings';
import { useSrs } from '../state/srs';
import { useLayout } from '../state/viewport';
import { CellCard, forgetCellFlag } from './charts/CellCard';
import { CellSheet } from './charts/CellSheet';
import { DISCLAIMER } from './charts/disclaimer';
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
 * 차트 (spec §5.8 · Duo spec §4.4). 크기 클래스마다 배치가 다릅니다(같은 상태, 같은 조각):
 *  - phone/squat: 스크롤 페이지 — 큰 제목, sticky 칩 줄, 시나리오 · 비율, 13×13 격자, 범례 · 요약 · 훈련 버튼.
 *    칸을 누르면 non-modal peek 시트(≤ min(232, 0.42 core))가 뜨고, 고른 칸의 줄에 외곽선(나머지 45%)을 긋고
 *    그 행이 시트 위로 보이게 스크롤합니다. 다른 칸을 누르면 시트 내용만 바뀝니다. squat 은 머리를 압축해 격자를 y≈200 에 둡니다.
 *  - land: 스테이지(스크롤 없음) — 왼쪽 옆 칼럼(안쪽 스크롤: 제목 · 칩 줄바꿈 · 시나리오 · 셀 카드/요약 · 훈련),
 *    오른쪽 격자 고정(core 기준 크기, 세로 가운데 — 59pt 모서리를 피함).
 *  - tall: 스테이지 — 제목 · 칩(나|상대 한 줄) · 시나리오 한 줄 · 격자(≤440) · 아래 dock(셀 카드 또는 범례 · 요약 · 훈련).
 *    툴바가 접혀 생긴 높이는 dock 이 가져갑니다. 「자세히」는 auto 바텀 시트(두 칸 본문).
 *  - wide: 스테이지 — 접힘선 왼쪽 패널(레일 옆, 안쪽 스크롤: 제목 · 칩 · 시나리오 · 셀 카드), 오른쪽 패널(격자 · 범례 · 훈련).
 *  land/wide 의 「자세히」는 셀 카드를 그 자리에서 해설 전체로 펼칩니다(옆 칼럼이 스크롤하므로 격자는 계속 보이고 눌립니다).
 * 선택(sessionStorage) · 고른 칸 · 펼침 상태는 클래스가 바뀌어도(접기/펼치기) 그대로입니다.
 */
export function ChartsScreen() {
  const [sel, setSel] = useState<ChartSelection>(loadSelection);
  const [overlayOn, setOverlayOn] = useState<boolean>(loadOverlay);
  const [picked, setPicked] = useState<{ step: Step; explanation: Explanation } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lastHand, setLastHand] = useState<HandName | undefined>(undefined);
  const [settings] = useSettings();
  const srsVersion = useSrs();
  const layout = useLayout();
  const stage = layout === 'land' || layout === 'tall' || layout === 'wide';
  const rootRef = useRef<HTMLDivElement>(null);
  const revealRowRef = useRef<(hand: HandName) => void>(() => undefined);
  const openRef = useRef<{ hand: HandName | null; sheetOpen: boolean }>({ hand: null, sheetOpen: false });

  useEffect(() => saveSelection(sel), [sel]);
  useEffect(() => forgetCellFlag, []);   // leaving the chart tab: a later visit can flag the same cell again
  useEffect(() => saveOverlay(overlayOn), [overlayOn]);

  const scenario = useMemo(() => toScenario(sel), [sel]);
  const key = scenarioKey(scenario);
  const ready = hasChart(scenario);
  const cells = ready ? getChartCells(scenario) : null;
  const summary = ready ? getChartDef(scenario).summary : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- srsVersion re-runs the memo when a rating lands
  const mastery = useMemo(() => (overlayOn && ready ? masteryFor(scenario) : null), [overlayOn, ready, scenario, srsVersion]);

  const heroes = heroesFor(sel.kind);
  const villains = villainsFor(sel.kind, sel.hero);

  // 상황·자리를 바꾸면 고른 칸은 다른 차트의 것이 되므로 닫습니다.
  const closeCell = useCallback(() => {
    setSheetOpen(false);
    setExpanded(false);
  }, []);
  const pickKind = (kind: ScenarioKind) => {
    closeCell();
    setSel((s) => normalizeSelection({ ...s, kind }));
  };
  const pickHero = (hero: Pos) => {
    closeCell();
    setSel((s) => normalizeSelection({ ...s, hero }));
  };
  const pickVillain = (villain: Pos) => {
    closeCell();
    setSel((s) => normalizeSelection({ ...s, villain }));
  };

  /** phone/squat: 고른 칸의 행이 peek 시트 위(그리고 sticky 칩 줄 아래)로 보이게 .app__main 을 굴립니다. */
  const revealRow = useCallback((hand: HandName) => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>('.app__main');
    const cell = root?.querySelector<HTMLElement>(`.rgrid__cell[aria-label="${hand}"]`);
    if (!root || !scroller || !cell) return;
    const row = cell.closest<HTMLElement>('.rgrid__row') ?? cell;
    // peek, or half after 더 보기 (the detent change is instant — only the sheet's transform animates)
    const sheet = document.querySelector<HTMLElement>('.ui-sheet.ui-sheet--peek, .ui-sheet.ui-sheet--half');
    const peekH = sheet?.offsetHeight || Math.min(232, window.innerHeight * 0.42);
    const sheetTop = window.innerHeight - peekH;
    const filters = root.querySelector<HTMLElement>('.charts__filters');
    const topEdge = Math.max(scroller.getBoundingClientRect().top, filters?.classList.contains('charts__filters--stuck') ? filters.getBoundingClientRect().bottom : 0);
    const r = row.getBoundingClientRect();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let dy = 0;
    if (r.bottom > sheetTop - 10) dy = r.bottom - (sheetTop - 10);
    else if (r.top < topEdge + 8) dy = r.top - (topEdge + 8);
    if (Math.abs(dy) > 1) scroller.scrollBy({ top: dy, behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  revealRowRef.current = revealRow;

  /** land/wide: 옆 칼럼(안쪽 스크롤)을 셀 카드가 보이는 데까지 굴립니다. tall 의 dock 은 맨 위로. */
  const revealCard = useCallback(() => {
    const root = rootRef.current;
    const card = root?.querySelector<HTMLElement>('.cellcard');
    const scroller = card?.closest<HTMLElement>('.charts__side, .charts__dock');
    if (!card || !scroller) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const s = scroller.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const top = scroller.scrollTop + (c.top - s.top) - 12;
    // 카드가 이미 다 보이면 그대로 둡니다.
    if (c.top >= s.top && c.bottom <= s.bottom) return;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  // After a rotation or fold, bring the picked cell back into view. land/wide: the open card (its column starts at the
  // top again). phone/squat: the picked row above the sheet — the stage layouts clamp .app__main to 0, so coming back
  // with the sheet at 더 보기 (half) left the row under it. Refs, so picking a cell (which reveals on its own) does
  // not re-run this.
  openRef.current = { hand: picked?.step.hand ?? null, sheetOpen };
  useEffect(() => {
    let id = 0;
    if (layout === 'land' || layout === 'wide') id = requestAnimationFrame(() => (id = requestAnimationFrame(revealCard)));
    else if (layout === 'phone' || layout === 'squat') {
      const { hand, sheetOpen: open } = openRef.current;
      if (hand && open) id = requestAnimationFrame(() => (id = requestAnimationFrame(() => revealRowRef.current(hand))));
    }
    return () => cancelAnimationFrame(id);
  }, [layout, revealCard]);

  const openHand = useCallback(
    (hand: HandName) => {
      try {
        const step = stepFor(scenario, hand);
        setPicked({ step, explanation: explainStep(step) });
        setSheetOpen(true);
        // phone/squat 은 새 칸마다 peek 로(격자가 보이게). 스테이지(land/tall/wide)는 펼친 해설을 그대로 두고 내용만 바꿉니다.
        if (!stage) setExpanded(false);
        setLastHand(hand);
        // phone/squat: 시트가 그려지고(높이를 잴 수 있고) 난 다음 프레임에 행을 시트 위로. land/wide: 옆 칼럼을 카드까지.
        requestAnimationFrame(() => requestAnimationFrame(() => (stage ? revealCard() : revealRow(hand))));
      } catch {
        /* no chart for this scenario — the empty panel is already showing */
      }
    },
    [scenario, stage, revealRow, revealCard],
  );

  // 「이 패, 다른 자리에서는」 — 카드/시트를 닫고 자리별 보기로(시트는 한 장만).
  const across = () => {
    if (!picked) return;
    closeCell();
    openAtlas({ hand: picked.step.hand, origin: picked.step.scenario });
  };

  const train = () => launch({ target: 'train', deck: 'scenario', scenarioId: key, positions: [sel.hero], autostart: true });

  const rated = mastery ? mastery.counts.mastered + mastery.counts.learning + mastery.counts.weak : 0;
  const active = sheetOpen && picked ? picked : null;
  const focusLine = useMemo(() => (active ? lineHands(active.step.hand) : undefined), [active]);

  /* ---------- 조각 ---------- */
  const head = (
    <header className="charts__head">
      <h1 className="t-title-l">차트</h1>
      <IconButton icon={<IconGrid />} label="패로 보기" className="charts__atlas" onClick={() => openAtlas({ hand: lastHand ?? 'KJo', mode: 'pick' })} />
      <label className="charts__toggle">
        내 기록
        <Switch checked={overlayOn} onChange={setOverlayOn} label="내 기록 표시" />
      </label>
    </header>
  );

  // land · wide: 옆 칼럼 안에서 칩을 감아 모든 상황 · 자리가 한눈에 보이게 합니다(가로 스크롤로 숨기지 않음).
  const wrapRows = layout === 'land' || layout === 'wide';
  const filters = (
    <ChartFilters inline={stage}>
      <FilterRow label="상황" ariaLabel="상황" wrap={wrapRows} className="charts__row--kind">
        {SCENARIO_KINDS.map((k) => (
          <Chip key={k} selected={sel.kind === k} disabled={!kindHasAnyChart(k)} onClick={() => pickKind(k)}>
            {KIND_CHIP_LABEL[k]}
          </Chip>
        ))}
      </FilterRow>
      <FilterRow label="나" ariaLabel="내 포지션" wrap={wrapRows} className="charts__row--hero">
        {heroes.map((h) => (
          <Chip key={h} className="charts__chip--pos" selected={sel.hero === h} disabled={!heroHasAnyChart(sel.kind, h)} onClick={() => pickHero(h)}>
            {h}
          </Chip>
        ))}
      </FilterRow>
      {villains.length > 0 && (
        <FilterRow label="상대" ariaLabel={VILLAIN_LABEL[sel.kind] ?? '상대 포지션'} wrap={wrapRows} className="charts__row--villain">
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
  );

  const scen = (
    <div className="charts__scen">
      <h2 className="charts__title t-title-2">{scenarioTitle(scenario)}</h2>
      <p className="charts__situation t-footnote">{scenarioSituation(scenario)}</p>
      {cells && <ActionShares cells={cells} kind={sel.kind} hero={sel.hero} rest={restAction(getChartDef(sel))} />}
    </div>
  );

  const grid = cells ? (
    <GlassPanel radius="md" padding={0} className="glass-flat charts__panel">
      <RangeGrid cells={cells} highlight={lastHand} onSelect={openHand} overlay={mastery?.overlay} focusLine={focusLine} />
    </GlassPanel>
  ) : (
    <EmptyPanel />
  );

  const legend = cells ? <ChartLegend kind={sel.kind} hero={sel.hero} overlay={overlayOn} /> : null;
  const masteryLine = mastery && (
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
  );
  const summaryP = cells && summary && (
    <p className="charts__summary t-body">
      <b>요약</b>
      {summary}
    </p>
  );
  const trainBtn = cells && (
    <CapsuleButton tone="neutral" size="lg" block icon={<IconCards />} trailing={`· ${settings.sessionSize}장`} onClick={train} className="charts__train">
      이 상황으로 훈련하기
    </CapsuleButton>
  );
  const disclaimer = <p className="charts__disclaimer t-footnote">{DISCLAIMER[sel.kind]}</p>;

  const card = active && stage && (
    <CellCard
      step={active.step}
      explanation={active.explanation}
      expanded={expanded && layout !== 'tall'}
      onExpand={(v) => {
        setExpanded(v);
        if (layout !== 'tall') requestAnimationFrame(() => requestAnimationFrame(revealCard));
      }}
      onClose={closeCell}
      onAcross={across}
    />
  );

  // 셀 시트는 한 노드를 유지합니다(접기/펼치기로 클래스가 바뀌어도 다시 마운트하지 않음). 세 배치가 루트의 다른 자리에
  // 시트를 두므로 key 로 같은 노드임을 알려 줍니다 — 없으면 클래스가 바뀔 때마다 새로 마운트되어 스크롤과 등장 애니메이션이 되풀이됩니다.
  const sheet = picked && (
    <CellSheet
      key="cellsheet"
      step={picked.step}
      explanation={picked.explanation}
      open={!stage ? sheetOpen : layout === 'tall' ? sheetOpen && expanded : false}
      detent={layout === 'tall' ? 'auto' : undefined}
      expanded={expanded}
      onExpand={(v) => {
        setExpanded(v);
        // phone/squat: 더 보기로 시트가 반으로 올라오면 고른 칸의 행을 그 위로 다시 올립니다.
        if (!stage && v) requestAnimationFrame(() => requestAnimationFrame(() => revealRow(picked.step.hand)));
      }}
      onClose={layout === 'tall' ? () => setExpanded(false) : closeCell}
      onAcross={across}
    />
  );

  if (!stage) {
    return (
      <div ref={rootRef} className={`screen charts charts--${layout}${sheetOpen && expanded ? ' charts--expanded' : ''}`}>
        {head}
        {filters}
        <section key={key} className="charts__chart">
          {scen}
          {grid}
          {legend}
          {masteryLine}
          {summaryP}
          {trainBtn}
        </section>
        {disclaimer}
        {sheet}
      </div>
    );
  }

  if (layout === 'tall') {
    return (
      <div ref={rootRef} className="screen charts charts--stage charts--tall">
        {head}
        {filters}
        {scen}
        <section key={key} className="charts__chart charts__stagegrid">
          {grid}
        </section>
        {/* 「자세히」 시트가 열려 dock 을 덮는 동안 dock 내용은 숨깁니다(유리 시트 너머로 카드의 ✕ 가 비치지 않게). */}
        <div className={`charts__dock glass-flat${sheetOpen && expanded ? ' charts__dock--under' : ''}`}>
          {card || (
            <div className="charts__dockinfo">
              <div className="charts__dockcol">
                {legend}
                {masteryLine}
                {summaryP}
              </div>
              <div className="charts__dockcol">
                {trainBtn}
                {disclaimer}
              </div>
            </div>
          )}
        </div>
        {sheet}
      </div>
    );
  }

  // land · wide: 왼쪽 옆 칼럼(스크롤) + 오른쪽 격자(고정)
  return (
    <div ref={rootRef} className={`screen charts charts--stage charts--${layout}`}>
      <div className="charts__side">
        {head}
        {filters}
        {scen}
        {card || (layout === 'land' ? (
          <>
            {legend}
            {masteryLine}
            {summaryP}
          </>
        ) : (
          summaryP
        ))}
        {layout === 'land' && trainBtn}
        {disclaimer}
      </div>
      <div className="charts__pane">
        <section key={key} className="charts__chart charts__stagegrid">
          {grid}
        </section>
        {layout === 'wide' && (
          <div className="charts__paneinfo">
            {legend}
            {masteryLine}
            {trainBtn}
          </div>
        )}
      </div>
      {sheet}
    </div>
  );
}
