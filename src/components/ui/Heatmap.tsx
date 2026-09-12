import { useMemo, useState, type CSSProperties } from 'react';

export interface HeatmapProps {
  days: Record<string, number>; // dayKey 'YYYY-MM-DD' → cards
  weeks?: number; // default 12 (columns, oldest left; rows 월…일)
  goal: number; // for level thresholds (§7.2)
  todayKey: string; // gets a 1px --mint ring
  onSelect?(dayKey: string, value: number): void; // caller shows the footnote "9월 3일 · 32장"
}

/** Goal-relative level (§7.2): 0; 1–9 → 1; 10–(goal−1) → 2; goal–(2·goal−1) → 3; ≥ 2·goal → 4. */
export function heatLevel(cards: number, goal: number): 0 | 1 | 2 | 3 | 4 {
  if (!(cards > 0)) return 0;
  if (cards < 10) return 1;
  if (cards < goal) return 2;
  if (cards < 2 * goal) return 3;
  return 4;
}

const WEEKDAY_LABEL = ['월', '', '수', '', '금', '', '일'];

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function fmtKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

interface Cell {
  key: string;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
  label: string;
  col: number;
  row: number;
}

/** 12-week activity grid (Monday rows, oldest week left). Cells are tooltip-only targets (§9). */
export function Heatmap({ days, weeks = 12, goal, todayKey, onSelect }: HeatmapProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  const { cells, months } = useMemo(() => {
    const today = parseKey(todayKey);
    const todayWd = (today.getDay() + 6) % 7; // Monday = 0
    const weekEnd = addDays(today, 6 - todayWd);
    const start = addDays(weekEnd, -(weeks * 7 - 1));
    const list: Cell[] = [];
    const monthOfCol: number[] = [];
    for (let w = 0; w < weeks; w++) {
      monthOfCol.push(addDays(start, w * 7).getMonth());
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d);
        const key = fmtKey(date);
        const value = days[key] ?? 0;
        list.push({
          key,
          value,
          level: heatLevel(value, goal),
          future: date.getTime() > today.getTime(),
          label: `${date.getMonth() + 1}월 ${date.getDate()}일 · ${value}장`,
          col: w,
          row: d,
        });
      }
    }
    const changes = monthOfCol.map((m, i) => i > 0 && m !== monthOfCol[i - 1]);
    const labels: Array<{ col: number; text: string }> = [];
    for (let w = 0; w < weeks; w++) {
      const show = w === 0 ? !(changes[1] || changes[2]) : changes[w];
      if (show) labels.push({ col: w, text: `${monthOfCol[w] + 1}월` });
    }
    return { cells: list, months: labels };
  }, [days, weeks, goal, todayKey]);

  const pick = (c: Cell) => {
    if (!onSelect || c.future) return;
    setSelected(c.key);
    onSelect(c.key, c.value);
  };

  return (
    <div className="ui-heat" style={{ '--weeks': weeks } as CSSProperties} role="group" aria-label="최근 활동">
      {months.map((m) => (
        <span key={m.col} className="ui-heat__month" style={{ gridColumn: m.col + 2, gridRow: 1 }}>
          {m.text}
        </span>
      ))}
      {WEEKDAY_LABEL.map((t, i) => (
        <span key={i} className="ui-heat__wd" style={{ gridColumn: 1, gridRow: i + 2 }} aria-hidden="true">
          {t}
        </span>
      ))}
      {cells.map((c) => {
        const cls = ['ui-heat__cell', `ui-heat__cell--${c.level}`, c.key === todayKey ? 'ui-heat__cell--today' : '', c.future ? 'ui-heat__cell--future' : '', c.key === selected ? 'ui-heat__cell--selected' : '']
          .filter(Boolean)
          .join(' ');
        const style = { gridColumn: c.col + 2, gridRow: c.row + 2 };
        return onSelect && !c.future ? (
          <button key={c.key} type="button" className={cls} style={style} aria-label={c.label} aria-pressed={c.key === selected} onClick={() => pick(c)} />
        ) : (
          <span key={c.key} className={cls} style={style} aria-label={c.future ? undefined : c.label} aria-hidden={c.future || undefined} />
        );
      })}
      <div className="ui-heat__legend" aria-hidden="true">
        <span>적게</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`ui-heat__cell ui-heat__cell--${l}`} />
        ))}
        <span>많이</span>
      </div>
    </div>
  );
}
