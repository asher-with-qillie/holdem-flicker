import type { CSSProperties } from 'react';
import type { AtlasCell, AtlasSection } from '../../poker/atlas';
import { POS_INDEX } from '../../poker/types';
import { AtlasTile, type TileMarks } from './SeatStrip';

export interface SeatTriangleProps {
  section: AtlasSection;
  /** 열 머리 둘째 줄(상대의 오픈 % 등). 열 순서대로. */
  colSub?: string[];
  marks: TileMarks;
  onSelect(c: AtlasCell): void;
}

/**
 * 나 × 상대 삼각형. `tri-lower`(오픈·4벳 대응) 는 상대가 나보다 앞일 때만 칸이 있어 왼쪽 아래가 차고,
 * `tri-upper`(3벳·올인 대응) 는 3벳한 상대가 나보다 뒤라 오른쪽 위가 찹니다. 빈 자리는 그냥 비워 둡니다 —
 * 생기지 않는 상황('—')과 '그 조합 자체가 없는 자리'는 다른 것이라 섞어 그리지 않습니다.
 */
export function SeatTriangle({ section, colSub, marks, onSelect }: SeatTriangleProps) {
  const cols = section.cols ?? [];
  const style = { '--n': cols.length } as CSSProperties;
  const exists = (hero: string, villain: string) =>
    section.layout === 'tri-lower' ? POS_INDEX[villain as keyof typeof POS_INDEX] < POS_INDEX[hero as keyof typeof POS_INDEX] : POS_INDEX[villain as keyof typeof POS_INDEX] > POS_INDEX[hero as keyof typeof POS_INDEX];
  const cellAt = (hero: string, villain: string) => section.cells.find((c) => c.scenario.hero === hero && c.scenario.villain === villain);
  return (
    <div className="atlas__grid atlas__tri" style={style} role="group">
      <span className="atlas__corner t-caption ink-3">상대→</span>
      {cols.map((v, i) => (
        <span key={v} className="atlas__seat atlas__tri-h t-caption ink-2">
          {v}
          {colSub?.[i] && <small className="tnum">{colSub[i]}</small>}
        </span>
      ))}
      {section.rows.map((hero, r) => (
        <RowOf key={hero} hero={hero} first={r === 0} cols={cols} exists={exists} cellAt={cellAt} kind={section.kind} marks={marks} onSelect={onSelect} />
      ))}
    </div>
  );
}

function RowOf({
  hero,
  first,
  cols,
  exists,
  cellAt,
  kind,
  marks,
  onSelect,
}: {
  hero: string;
  first: boolean;
  cols: string[];
  exists(h: string, v: string): boolean;
  cellAt(h: string, v: string): AtlasCell | undefined;
  kind: AtlasSection['kind'];
  marks: TileMarks;
  onSelect(c: AtlasCell): void;
}) {
  return (
    <>
      <span className="atlas__rowlabel t-caption ink-2">
        {first && <small>나</small>}
        {hero}
      </span>
      {cols.map((v) => {
        const c = exists(hero, v) ? cellAt(hero, v) : undefined;
        return c ? <AtlasTile key={c.key} cell={c} kind={kind} marks={marks} onSelect={onSelect} /> : <span key={`${hero}-${v}`} className="atlas__blank" aria-hidden="true" />;
      })}
    </>
  );
}
