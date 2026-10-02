import type { CSSProperties } from 'react';
import { actionLabel } from '../../components/ActionBadge';
import { cellBackground } from '../../components/RangeGrid';
import type { AtlasCell } from '../../poker/atlas';
import type { Scenario, ScenarioKind } from '../../poker/types';

/** 같은 칸인가 (kind · hero · villain). cold_4bet 은 extras 를 보지 않습니다 — 차트가 hero 만 봅니다. */
export function sameScenario(a: Scenario | undefined, b: Scenario | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.hero === b.hero && a.villain === b.villain;
}

export interface TileMarks {
  selected?: Scenario;
  compare?: Scenario;
  origin?: Scenario;
}

/**
 * 타일 하나. 배경은 RangeGrid 와 같은 좌→우 분할(`cellBackground`), 라벨은 1순위 액션 + 비중(100% 미만일 때만).
 * 미도달 칸은 '—' 로 흐리게. BB 의 림프 대응 체크는 --act-check 바탕에 '체크' 글자 — 회색 폴드처럼 보이면 안 됩니다.
 */
export function AtlasTile({ cell, kind, marks, onSelect }: { cell: AtlasCell; kind: ScenarioKind; marks: TileMarks; onSelect(c: AtlasCell): void }) {
  const { scenario, primary, mixList, reachable } = cell;
  const pct = reachable && mixList[0] && mixList[0].weight < 0.999 ? Math.round(mixList[0].weight * 100) : null;
  const label = reachable ? actionLabel(primary, kind, true) : '—';
  const sel = sameScenario(marks.selected, scenario);
  const cmp = !sel && sameScenario(marks.compare, scenario);
  const cls = [
    'atlas__cell',
    reachable && primary === 'fold' && 'atlas__cell--fold',
    reachable && primary === 'check' && 'atlas__cell--check',
    !reachable && 'atlas__cell--gated',
    sel && 'atlas__cell--sel',
    cmp && 'atlas__cell--cmp',
    sameScenario(marks.origin, scenario) && 'atlas__cell--origin',
  ]
    .filter(Boolean)
    .join(' ');
  const background = reachable && primary !== 'check' ? cellBackground(mixList) : undefined;
  const where = scenario.villain ? `${scenario.hero} vs ${scenario.villain}` : scenario.hero;
  return (
    <button
      type="button"
      className={cls}
      style={background ? { background } : undefined}
      onClick={() => onSelect(cell)}
      aria-label={`${where} · ${reachable ? `${label}${pct !== null ? ` ${pct}%` : ''}` : '생기지 않는 상황'}`}
      aria-pressed={sel}
    >
      <span className="atlas__cell-act">{label}</span>
      {pct !== null && <span className="atlas__cell-pct tnum">{pct}%</span>}
    </button>
  );
}

export interface SeatStripProps {
  cells: AtlasCell[];
  kind: ScenarioKind;
  marks: TileMarks;
  /** 타일 아래 숫자 줄(뒤에 5명 … / 오픈 18% …). */
  captions?: Array<{ label: string; values: string[] }>;
  /** SB 앞에 점선 구분 — '…부터' 가 SB 열을 가로질러 읽히지 않게. */
  sbDivider?: boolean;
  /** 타일 줄의 왼쪽 라벨 (기본 '나'). */
  rowLabel?: string;
  onSelect(c: AtlasCell): void;
}

/**
 * 자리 스트립(rfi · 림프 대응 · 콜드 4벳): 자리 이름 줄 → 타일 줄 → 숫자 줄들.
 * 라벨 열 36px + N 칸(1fr) — 360px 에서 칸이 52px, 폭이 넓어지면 칸이 같이 자랍니다(타일은 정사각).
 */
export function SeatStrip({ cells, kind, marks, captions, sbDivider, rowLabel = '나', onSelect }: SeatStripProps) {
  const style = { '--n': cells.length } as CSSProperties;
  const divider = (c: AtlasCell) => (sbDivider && c.scenario.hero === 'SB' ? ' atlas__sb-divider' : '');
  return (
    <div className="atlas__grid" style={style} role="group">
      <span className="atlas__corner" aria-hidden="true" />
      {cells.map((c) => (
        <span key={c.key} className={`atlas__seat t-caption ink-2${divider(c)}`}>
          {c.scenario.hero}
          {/* D 는 칸 안이 아니라 자리 이름 옆에 — 칸 안에 두면 두 줄 라벨('레이즈 50%')의 첫 글자를 덮습니다. */}
          {c.scenario.hero === 'BTN' && <i className="pstrip__dealer atlas__dealer">D</i>}
        </span>
      ))}
      <span className="atlas__rowlabel t-caption ink-2">{rowLabel}</span>
      {cells.map((c) => (
        <span key={c.key} className={`atlas__slot${divider(c)}`}>
          <AtlasTile cell={c} kind={kind} marks={marks} onSelect={onSelect} />
        </span>
      ))}
      {captions?.map((row) => (
        <CaptionRow key={row.label} label={row.label} values={row.values} cells={cells} divider={divider} />
      ))}
    </div>
  );
}

function CaptionRow({ label, values, cells, divider }: { label: string; values: string[]; cells: AtlasCell[]; divider(c: AtlasCell): string }) {
  return (
    <>
      <span className="atlas__rowlabel t-caption ink-2">{label}</span>
      {values.map((v, i) => (
        <span key={cells[i]?.key ?? i} className={`atlas__num t-caption tnum${cells[i] ? divider(cells[i]) : ''}`}>
          {v}
        </span>
      ))}
    </>
  );
}
