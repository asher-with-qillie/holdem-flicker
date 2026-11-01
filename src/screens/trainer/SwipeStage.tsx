import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { HandView } from '../../components/PlayingCard';
import { IconGrid } from '../../components/ui/icons';
import { cardLabel } from '../../poker/hands';
import type { Card, HandName } from '../../poker/types';
import { FitBox, pickFanSize } from './FitBox';
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
  /** Side map (T) next to the cards — squat / land (Duo spec §4.1 "[카드 | T]"). */
  map?: ReactNode;
  /** Phone reveal: the painted map crossfades over the cards when the fan box is ≥ 104 tall. */
  revealMap?: ReactNode;
  /** squat / land reveal: a small 차트 button on the label line, shown only when the stage is too short for T. */
  onChart?: () => void;
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function HandLabel({ cards, hand, onChart }: { cards: [Card, Card]; hand: HandName; onChart?: () => void }) {
  return (
    <div className="trainer-handlabel t-title-3" aria-label={`패 ${hand}`}>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[0].suit}`}>{cardLabel(cards[0])}</span>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[1].suit}`}>{cardLabel(cards[1])}</span>
      <span className="trainer-handlabel__sep">·</span>
      <span className="trainer-handlabel__name">{hand}</span>
      {onChart && (
        <button type="button" className="trainer-handlabel__chart trainer-chartbtn" onClick={onChart} aria-label="차트 보기">
          <IconGrid />
        </button>
      )}
    </div>
  );
}

function Fan({ cards, flagged }: { cards: [Card, Card]; flagged?: boolean }) {
  return (
    <>
      <FitBox className="trainer-fan">{(box) => <HandView cards={cards} size={pickFanSize(box)} />}</FitBox>
      {flagged && (
        <span className="trainer-flag" role="img" aria-label="헷갈려요로 표시됨">
          🤔
        </span>
      )}
    </>
  );
}

/**
 * Hold-to-pause (§6.3 v2.1): pointer down ≥ 180 ms with < 8 px movement → onHoldStart, release → onHoldEnd.
 * Attach the returned handlers to the session core; only presses inside a `[data-hold]` area count (the stage,
 * the answer column, the in-session chart) and buttons / links are ignored so the choice capsules keep working.
 * `onPress` fires for any press inside a hold area (used to cancel the reveal auto-advance).
 */
export function useHoldGesture({ onHoldStart, onHoldEnd, onPress }: { onHoldStart(): void; onHoldEnd(): void; onPress?(): void }) {
  const gesture = useRef<Gesture | null>(null);
  const cb = useRef({ onHoldStart, onHoldEnd, onPress });
  cb.current = { onHoldStart, onHoldEnd, onPress };

  const finish = useCallback((e: ReactPointerEvent<HTMLElement>) => {
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

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!e.isPrimary || gesture.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as Element;
    const area = target.closest('[data-hold]');
    if (!area || !e.currentTarget.contains(area)) return;
    cb.current.onPress?.(); // any touch on the card area counts as interaction (cancels auto-advance)
    if (target.closest('button, a, [role="button"]')) return;
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

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || g.holding) return;
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) >= HOLD_MOVE_PX) {
      // Moved before the hold engaged: not a hold.
      window.clearTimeout(g.holdTimer);
      gesture.current = null;
    }
  }, []);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if ((e.target as Element).closest('[data-hold]')) e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onContextMenu };
}

/**
 * The card stage: fan (+ optional side map T) over a hand-label line. Card changes slide (or crossfade in quiet
 * modes) with a ghost of the previous fan; the label sits outside the fan box so it survives when the fan is hidden
 * (box too small) and when the phone reveal map covers the cards. The stage is a size container (`stage`) so its
 * contents can drop the map / the fan / enlarge the label by height alone.
 */
export function SwipeStage({ card, phase, crossfade, transitionMs, map, revealMap, onChart }: SwipeStageProps) {
  const [ghost, setGhost] = useState<SessionCard | null>(null);

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

  const cls = ['trainer-stage', crossfade ? 'trainer-stage--xfade' : '', phase === 'reveal' ? 'trainer-stage--reveal' : 'trainer-stage--think', map ? 'trainer-stage--split' : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} style={{ '--t-in': `${transitionMs}ms` } as CSSProperties} data-hold="">
      <div className="trainer-stage__row">
        <div className="trainer-stage__area">
          {ghost && (
            <div key={`ghost-${ghost.id}`} className="trainer-stage__card trainer-stage__card--ghost" aria-hidden="true">
              <Fan cards={ghost.cards} />
            </div>
          )}
          <div key={card.id} className="trainer-stage__card">
            <Fan cards={card.cards} flagged={card.flagged} />
          </div>
          {revealMap && <div className="trainer-revealmap">{revealMap}</div>}
        </div>
        {map && <div className="trainer-stage__map">{map}</div>}
      </div>
      <HandLabel cards={card.cards} hand={card.step.hand} onChart={onChart} />
    </div>
  );
}
