import { useId } from 'react';
import { POSITIONS, POS_INDEX, type Pos, type Scenario } from '../poker/types';
import { positionsBefore, scenarioTitle } from '../poker/scenarios';
import '../styles/table.css';

/* ------------------------------------------------------------------ */
/* Scenario → per-seat state                                           */
/* ------------------------------------------------------------------ */

type Bet = 'raise' | 'threebet' | 'fourbet' | 'allin';
type SeatRole = 'hero' | 'villain' | 'folded' | 'neutral';

const BET_LABEL: Record<Bet, string> = { raise: '오픈', threebet: '3벳', fourbet: '4벳', allin: '올인' };

interface SeatInfo {
  pos: Pos;
  role: SeatRole;
  /** Action chip(s) shown in front of the seat, e.g. ['raise', 'fourbet'] → "오픈 → 4벳". */
  bets?: Bet[];
}

function seatInfos(s: Scenario): SeatInfo[] {
  const chips = new Map<Pos, Bet[]>();
  const hero = s.hero;
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      break;
    case 'vs_open':
      if (v) chips.set(v, ['raise']);
      break;
    case 'vs_3bet':
      chips.set(hero, ['raise']);
      if (v) chips.set(v, ['threebet']);
      break;
    case 'vs_4bet':
      if (v) chips.set(v, ['raise', 'fourbet']);
      chips.set(hero, ['threebet']);
      break;
    case 'vs_5bet':
      chips.set(hero, ['raise', 'fourbet']);
      if (v) chips.set(v, ['threebet', 'allin']);
      break;
    case 'cold_4bet': {
      // extras are display-only and may be absent (e.g. allScenarios()); fall back to the outermost seats in front.
      const before = positionsBefore(hero);
      const opener = s.extras?.opener ?? before[0];
      const threeBettor = s.extras?.threeBettor ?? before[before.length - 1];
      if (opener) chips.set(opener, ['raise']);
      if (threeBettor && threeBettor !== opener) chips.set(threeBettor, ['threebet']);
      break;
    }
  }
  // In the re-raise lines the action has already gone around the table once: everyone else has folded.
  const wentAround = s.kind === 'vs_3bet' || s.kind === 'vs_4bet' || s.kind === 'vs_5bet';
  return POSITIONS.map((pos) => {
    if (pos === hero) return { pos, role: 'hero', bets: chips.get(pos) };
    if (chips.has(pos)) return { pos, role: 'villain', bets: chips.get(pos) };
    const folded = wentAround || POS_INDEX[pos] < POS_INDEX[hero];
    return { pos, role: folded ? 'folded' : 'neutral' };
  });
}

/* ------------------------------------------------------------------ */
/* Geometry (viewBox units ≈ CSS px at 390px-wide phones)              */
/* ------------------------------------------------------------------ */

type Dir = 'up' | 'down' | 'left' | 'right';
type TagSide = 'left' | 'right' | 'below';

interface SeatGeom {
  x: number;
  y: number;
  /** Direction from the seat towards the felt: where the action chip goes. */
  dir: Dir;
  /** Where the hero "나" tag sits relative to the seat. */
  tag: TagSide;
}

interface Layout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  railRx: number;
  railRy: number;
  feltRx: number;
  feltRy: number;
  seatR: number;
  pillH: number;
  pillGap: number;
  tagH: number;
  font: number;
  seats: Record<Pos, SeatGeom>;
}

const W = 358; // 390px phone minus 2 × 16px screen padding

function layoutFor(compact: boolean): Layout {
  if (compact) {
    return {
      w: W, h: 150, cx: 179, cy: 76,
      railRx: 140, railRy: 46, feltRx: 133, feltRy: 39,
      seatR: 15, pillH: 15, pillGap: 2, tagH: 15, font: 11,
      seats: {
        UTG: { x: 104, y: 30, dir: 'down', tag: 'left' },
        HJ: { x: 254, y: 30, dir: 'down', tag: 'right' },
        CO: { x: 322, y: 76, dir: 'left', tag: 'below' },
        BTN: { x: 254, y: 122, dir: 'up', tag: 'right' },
        SB: { x: 104, y: 122, dir: 'up', tag: 'left' },
        BB: { x: 36, y: 76, dir: 'right', tag: 'below' },
      },
    };
  }
  return {
    w: W, h: 190, cx: 179, cy: 96,
    railRx: 140, railRy: 63, feltRx: 133, feltRy: 56,
    seatR: 16, pillH: 18, pillGap: 4, tagH: 16, font: 11.5,
    seats: {
      UTG: { x: 104, y: 38, dir: 'down', tag: 'left' },
      HJ: { x: 254, y: 38, dir: 'down', tag: 'right' },
      CO: { x: 322, y: 96, dir: 'left', tag: 'below' },
      BTN: { x: 254, y: 154, dir: 'up', tag: 'right' },
      SB: { x: 104, y: 154, dir: 'up', tag: 'left' },
      BB: { x: 36, y: 96, dir: 'right', tag: 'below' },
    },
  };
}

/** Rough advance-width estimate (em) so pills can be sized without measuring text. */
function textWidth(s: string, fontSize: number): number {
  let em = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x20) em += 0.3;
    else if (c === 0x2192) em += 1.0; // →
    else if (c >= 0x30 && c <= 0x39) em += 0.64;
    else if (c >= 0xac00 && c <= 0xd7a3) em += 1.0; // Hangul syllables
    else em += 0.72;
  }
  return em * fontSize;
}

function polar(x: number, y: number, deg: number, dist: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [x + Math.cos(a) * dist, y + Math.sin(a) * dist];
}

/* ------------------------------------------------------------------ */
/* Small SVG parts                                                     */
/* ------------------------------------------------------------------ */

function Pill({ x, y, w, h, fill, text, textClass }: { x: number; y: number; w: number; h: number; fill: string; text: string; textClass: string }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={fill} className="tbl__pill" />
      <text x={x} y={y} className={`tbl__text ${textClass}`}>
        {text}
      </text>
    </g>
  );
}

function BlindChip({ x, y, r, stacked }: { x: number; y: number; r: number; stacked?: boolean }) {
  const ring = r * 0.66;
  const dash = (2 * Math.PI * ring) / 8;
  const face = (dy: number) => (
    <g transform={`translate(0 ${dy})`}>
      <circle r={r} className="tbl__blind" />
      <circle r={ring} fill="none" className="tbl__blind-stripes" strokeWidth={r * 0.4} strokeDasharray={`${dash} ${dash}`} />
      <circle r={r * 0.4} className="tbl__blind-core" />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      {stacked && face(2.5)}
      {face(0)}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TableDiagram({ scenario, compact = false }: { scenario: Scenario; compact?: boolean }) {
  const id = useId().replace(/:/g, '');
  const L = layoutFor(compact);
  const infos = seatInfos(scenario);

  // Gradients needed for two-step chips ("오픈 → 4벳" etc.).
  const combos = new Map<string, [Bet, Bet]>();
  for (const s of infos) if (s.bets && s.bets.length === 2) combos.set(`${s.bets[0]}-${s.bets[1]}`, [s.bets[0], s.bets[1]]);

  const feltId = `${id}-felt`;
  const railId = `${id}-rail`;
  const goldId = `${id}-gold`;
  const btnR = compact ? 8 : 9;
  const blindR = compact ? 6 : 7;

  return (
    <svg
      className={`tbl${compact ? ' tbl--compact' : ''}`}
      viewBox={`0 0 ${L.w} ${L.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`테이블: ${scenarioTitle(scenario)}`}
    >
      <defs>
        <radialGradient id={feltId} cx="50%" cy="42%" r="62%">
          <stop offset="0" className="tbl__stop-felt-a" />
          <stop offset="1" className="tbl__stop-felt-b" />
        </radialGradient>
        <linearGradient id={railId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="tbl__stop-rail-a" />
          <stop offset="0.55" className="tbl__stop-rail-b" />
          <stop offset="1" className="tbl__stop-rail-c" />
        </linearGradient>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="tbl__stop-gold-a" />
          <stop offset="1" className="tbl__stop-gold-b" />
        </linearGradient>
        {[...combos.entries()].map(([key, [a, b]]) => (
          <linearGradient key={key} id={`${id}-${key}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0.3" className={`tbl__stop-${a}`} />
            <stop offset="0.7" className={`tbl__stop-${b}`} />
          </linearGradient>
        ))}
      </defs>

      {/* table: shadow → rail → felt → inner shadow → betting line */}
      <ellipse cx={L.cx} cy={L.cy + 4} rx={L.railRx + 6} ry={L.railRy + 6} className="tbl__shadow" />
      <ellipse cx={L.cx} cy={L.cy} rx={L.railRx + 4} ry={L.railRy + 4} fill={`url(#${railId})`} className="tbl__rail" />
      <ellipse cx={L.cx} cy={L.cy} rx={L.feltRx} ry={L.feltRy} fill={`url(#${feltId})`} />
      <ellipse cx={L.cx} cy={L.cy} rx={L.feltRx - 1.5} ry={L.feltRy - 1.5} className="tbl__felt-edge" />
      <ellipse cx={L.cx} cy={L.cy} rx={L.feltRx - 24} ry={L.feltRy - 16} className="tbl__line" />
      <text x={L.cx} y={L.cy} className="tbl__text tbl__mark">
        ♠♦
      </text>

      {infos.map((info) => {
        const g = L.seats[info.pos];
        const isHero = info.role === 'hero';
        const isFolded = info.role === 'folded';

        // action / fold chip in front of the seat
        let chip: JSX.Element | null = null;
        const label = info.bets ? info.bets.map((b) => BET_LABEL[b]).join(' → ') : isFolded ? '폴드' : null;
        if (label) {
          const w = Math.ceil(textWidth(label, L.font) + L.pillH * 0.95);
          const off = L.seatR + L.pillGap;
          let px = g.x;
          let py = g.y;
          if (g.dir === 'down') py = g.y + off + L.pillH / 2;
          else if (g.dir === 'up') py = g.y - off - L.pillH / 2;
          else if (g.dir === 'right') px = g.x + off + w / 2;
          else px = g.x - off - w / 2;
          const fill = !info.bets
            ? 'var(--act-fold)'
            : info.bets.length === 2
              ? `url(#${id}-${info.bets[0]}-${info.bets[1]})`
              : `var(--act-${info.bets[0]})`;
          chip = <Pill x={px} y={py} w={w} h={L.pillH} fill={fill} text={label} textClass={info.bets ? 'tbl__chip-text' : 'tbl__fold-text'} />;
        }

        // hero tag
        let tag: JSX.Element | null = null;
        if (isHero) {
          const tw = 24;
          let tx = g.x;
          let ty = g.y;
          if (g.tag === 'left') tx = g.x - L.seatR - 3 - tw / 2;
          else if (g.tag === 'right') tx = g.x + L.seatR + 3 + tw / 2;
          else ty = g.y + L.seatR + 3 + L.tagH / 2;
          tag = <Pill x={tx} y={ty} w={tw} h={L.tagH} fill="var(--gold)" text="나" textClass="tbl__tag-text" />;
        }

        // dealer button / blind chips, pinned to the seat's inner edge, beside the chip lane
        let badge: JSX.Element | null = null;
        if (info.pos === 'BTN') {
          const [bx, by] = polar(g.x, g.y, -155, L.seatR + btnR - 4);
          badge = (
            <g transform={`translate(${bx} ${by})`}>
              <circle r={btnR} className="tbl__button" />
              <text className="tbl__text tbl__button-text">D</text>
            </g>
          );
        } else if (info.pos === 'SB') {
          const [bx, by] = polar(g.x, g.y, -25, L.seatR + blindR - 3);
          badge = <BlindChip x={bx} y={by} r={blindR} />;
        } else if (info.pos === 'BB') {
          const [bx, by] = polar(g.x, g.y, -62, L.seatR + blindR - 2);
          badge = <BlindChip x={bx} y={by} r={blindR} stacked />;
        }

        return (
          <g key={info.pos} className={`tbl__seat tbl__seat--${info.role}`}>
            {chip}
            {isHero && <circle cx={g.x} cy={g.y} r={L.seatR + 4} className="tbl__hero-glow" />}
            <circle cx={g.x} cy={g.y} r={L.seatR} style={isHero ? { fill: `url(#${goldId})` } : undefined} className={`tbl__seat-disc${isHero ? ' tbl__seat-disc--hero' : ''}`} />
            <text x={g.x} y={g.y} className={`tbl__text tbl__pos${isHero ? ' tbl__pos--hero' : ''}`}>
              {info.pos}
            </text>
            {badge}
            {tag}
          </g>
        );
      })}
    </svg>
  );
}
