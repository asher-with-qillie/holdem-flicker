import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { HandView } from '../../components/PlayingCard';
import { cardLabel } from '../../poker/hands';
import type { Card, HandName } from '../../poker/types';
import { FitBox } from './FitBox';
import type { Phase, SessionCard } from './sessionStore';

/* §6.3 hold constants */
const HOLD_MS = 180;
const HOLD_MOVE_PX = 8;
const GHOST_MS = 180;
const GHOST_XFADE_MS = 120;

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  holdTimer: number;
  holding: boolean;
}

export interface SwipeStageProps {
  card: SessionCard;
  phase: Phase;
  /** 순간기억 / 노출: card transitions crossfade instead of sliding. */
  crossfade: boolean;
  transitionMs: number;
  /** Everything below the fan (timer, choices, answer slot) — stacked inside the stage so a hold works anywhere on the card. */
  children?: ReactNode;
  onHoldStart(): void;
  onHoldEnd(): void;
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function HandLabel({ cards, hand }: { cards: [Card, Card]; hand: HandName }) {
  return (
    <div className="trainer-handlabel t-title-3" aria-label={`핸드 ${hand}`}>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[0].suit}`}>{cardLabel(cards[0])}</span>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[1].suit}`}>{cardLabel(cards[1])}</span>
      <span className="trainer-handlabel__sep">·</span>
      <span className="trainer-handlabel__name">{hand}</span>
    </div>
  );
}

function Fan({ cards, hand, flagged }: { cards: [Card, Card]; hand: HandName; flagged?: boolean }) {
  return (
    <>
      <FitBox className="trainer-fan">{(box) => <HandView cards={cards} size={box.height >= 150 ? 'lg' : box.height >= 90 ? 'md' : 'sm'} />}</FitBox>
      <HandLabel cards={cards} hand={hand} />
      {flagged && (
        <span className="trainer-flag" role="img" aria-label="헷갈려요로 표시됨">
          🤔
        </span>
      )}
    </>
  );
}

/**
 * Owns the fan + hand label and the one stage gesture left in v2.1: hold-to-pause (pointer down ≥ 180 ms with
 * < 8 px movement → onHoldStart, release → onHoldEnd). Buttons inside the stage are ignored so the choice
 * capsules keep working. Card changes slide (or crossfade in quiet modes) with a ghost of the previous fan.
 */
export function SwipeStage({ card, phase, crossfade, transitionMs, children, onHoldStart, onHoldEnd }: SwipeStageProps) {
  const gesture = useRef<Gesture | null>(null);
  const [ghost, setGhost] = useState<SessionCard | null>(null);

  const cb = useRef({ onHoldStart, onHoldEnd });
  cb.current = { onHoldStart, onHoldEnd };

  // Card change: show a ghost of the previous fan.
  const prevCard = useRef(card);
  useLayoutEffect(() => {
    if (prevCard.current.id === card.id) return;
    const previous = prevCard.current;
    prevCard.current = card;
    if (!reducedMotion()) setGhost(previous);
  }, [card]);

  useEffect(() => {
    if (!ghost) return;
    const t = window.setTimeout(() => setGhost(null), crossfade ? GHOST_XFADE_MS : GHOST_MS);
    return () => window.clearTimeout(t);
  }, [ghost, crossfade]);

  const finishGesture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    window.clearTimeout(g.holdTimer);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (g.holding) cb.current.onHoldEnd();
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || gesture.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('button, a')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const g: Gesture = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, holdTimer: 0, holding: false };
    g.holdTimer = window.setTimeout(() => {
      if (gesture.current !== g) return;
      g.holding = true;
      cb.current.onHoldStart();
    }, HOLD_MS);
    gesture.current = g;
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || g.holding) return;
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) >= HOLD_MOVE_PX) {
      // Moved before the hold engaged: not a hold.
      window.clearTimeout(g.holdTimer);
      gesture.current = null;
    }
  }, []);

  const preventMenu = useCallback((e: ReactMouseEvent) => e.preventDefault(), []);

  const cls = ['trainer-stage', crossfade ? 'trainer-stage--xfade' : '', phase === 'reveal' ? 'trainer-stage--reveal' : 'trainer-stage--think'].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={{ '--t-in': `${transitionMs}ms` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onContextMenu={preventMenu}
    >
      <div className="trainer-stage__area">
        {ghost && (
          <div key={`ghost-${ghost.id}`} className="trainer-stage__card trainer-stage__card--ghost" aria-hidden="true">
            <Fan cards={ghost.cards} hand={ghost.step.hand} />
          </div>
        )}
        <div key={card.id} className="trainer-stage__card">
          <Fan cards={card.cards} hand={card.step.hand} flagged={card.flagged} />
        </div>
      </div>
      {children}
    </div>
  );
}
