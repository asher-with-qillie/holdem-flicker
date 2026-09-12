import { useId } from 'react';
import type { Card, Rank, Suit } from '../poker/types';
import { SUIT_NAME_KO, cardLabel } from '../poker/hands';
import '../styles/cards.css';

export type CardSize = 'sm' | 'md' | 'lg';

/**
 * Suit pips as paths, centred at (0,0) inside a 100-unit box.
 * Never text: ♠/♦ glyphs differ per platform and may even render as emoji.
 */
const SUIT_PATH: Record<Suit, string> = {
  s: 'M0-47C4-38 13-29 24-19C37-8 45 4 45 17C45 31 34 41 22 41C13 41 6 36 2 29C3 39 8 46 15 50L-15 50C-8 46-3 39-2 29C-6 36-13 41-22 41C-34 41-45 31-45 17C-45 4-37-8-24-19C-13-29-4-38 0-47Z',
  d: 'M0-50C12-36 30-10 38 0C30 10 12 36 0 50C-12 36-30 10-38 0C-30-10-12-36 0-50Z',
};

type PipRank = Exclude<Rank, 'A' | 'K' | 'Q' | 'J'>;
/** Pip = [x, y, flipped?] in the 200×280 viewBox. Classic deck layouts; the bottom half is upside down like a real card. */
type PipSpec = readonly [number, number, boolean?];
const L = 66;
const C = 100;
const R = 134;
const PIPS: Record<PipRank, readonly PipSpec[]> = {
  '2': [[C, 52], [C, 228, true]],
  '3': [[C, 52], [C, 140], [C, 228, true]],
  '4': [[L, 52], [R, 52], [L, 228, true], [R, 228, true]],
  '5': [[L, 52], [R, 52], [C, 140], [L, 228, true], [R, 228, true]],
  '6': [[L, 52], [R, 52], [L, 140], [R, 140], [L, 228, true], [R, 228, true]],
  '7': [[L, 52], [R, 52], [C, 96], [L, 140], [R, 140], [L, 228, true], [R, 228, true]],
  '8': [[L, 52], [R, 52], [C, 96], [L, 140], [R, 140], [C, 184, true], [L, 228, true], [R, 228, true]],
  '9': [[L, 52], [R, 52], [L, 111], [R, 111], [C, 140], [L, 169, true], [R, 169, true], [L, 228, true], [R, 228, true]],
  T: [[L, 52], [R, 52], [C, 81], [L, 111], [R, 111], [L, 169, true], [R, 169, true], [C, 199, true], [L, 228, true], [R, 228, true]],
};

function isPipRank(rank: Rank): rank is PipRank {
  return rank in PIPS;
}

function rankText(rank: Rank): string {
  return rank === 'T' ? '10' : rank;
}

function Pip({ suit, x, y, size, flip = false }: { suit: Suit; x: number; y: number; size: number; flip?: boolean }) {
  const transform = `translate(${x} ${y})${flip ? ' rotate(180)' : ''} scale(${size / 100})`;
  return <path className="pc__ink" d={SUIT_PATH[suit]} transform={transform} />;
}

/** Corner index: rank above suit. Rendered once top-left and once rotated 180° for bottom-right. */
function Index({ rank, suit }: { rank: Rank; suit: Suit }) {
  const ten = rank === 'T';
  return (
    <g>
      <text className="pc__rank" x={26} y={43} textLength={ten ? 36 : undefined} lengthAdjust={ten ? 'spacingAndGlyphs' : undefined}>
        {rankText(rank)}
      </text>
      <Pip suit={suit} x={26} y={70} size={28} />
    </g>
  );
}

/** A / K / Q / J: framed large letter with the suit beneath. */
function CourtArt({ rank, suit }: { rank: Rank; suit: Suit }) {
  return (
    <g>
      <rect className="pc__frame" x={40} y={58} width={120} height={164} rx={8} />
      <rect className="pc__frame pc__frame--in" x={45} y={63} width={110} height={154} rx={5} />
      <text className="pc__big" x={100} y={146}>
        {rank}
      </text>
      <Pip suit={suit} x={100} y={186} size={44} />
    </g>
  );
}

export function PlayingCard({ card, size = 'md' }: { card: Card; size?: CardSize }) {
  const { rank, suit } = card;
  // Per-instance gradient id: many cards share a page and SVG ids are document-global.
  const gradientId = `pc-face-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className={`pc pc--${size} pc--${suit}`}>
      <svg className="pc__svg" viewBox="0 0 200 280" role="img" aria-label={`${rankText(rank)} ${SUIT_NAME_KO[suit]}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="pc__g0" />
            <stop offset="0.5" className="pc__g1" />
            <stop offset="1" className="pc__g2" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={200} height={280} rx={14} fill={`url(#${gradientId})`} />
        <rect className="pc__inner" x={7} y={7} width={186} height={266} rx={9} />
        <rect className="pc__edge" x={0.75} y={0.75} width={198.5} height={278.5} rx={13.5} />
        <Index rank={rank} suit={suit} />
        <g transform="rotate(180 100 140)">
          <Index rank={rank} suit={suit} />
        </g>
        {isPipRank(rank) ? (
          // 9 and 10 pack pips tightly, so they get slightly smaller ones — as on a real deck.
          PIPS[rank].map(([x, y, flip], i) => <Pip key={i} suit={suit} x={x} y={y} size={rank === '9' || rank === 'T' ? 31 : 34} flip={flip} />)
        ) : (
          <CourtArt rank={rank} suit={suit} />
        )}
      </svg>
    </div>
  );
}

/** Two cards fanned like a real hold'em hand: −7° / +7°, second card on top overlapping ~30%. */
export function HandView({ cards, size = 'lg' }: { cards: [Card, Card]; size?: CardSize }) {
  return (
    <div className={`hand hand--${size}`} role="group" aria-label={`${cardLabel(cards[0])} ${cardLabel(cards[1])}`}>
      <div className="hand__card hand__card--a">
        <PlayingCard card={cards[0]} size={size} />
      </div>
      <div className="hand__card hand__card--b">
        <PlayingCard card={cards[1]} size={size} />
      </div>
    </div>
  );
}
