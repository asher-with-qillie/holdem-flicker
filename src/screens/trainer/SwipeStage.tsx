import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { HandView } from '../../components/PlayingCard';
import { cardLabel } from '../../poker/hands';
import type { Card, HandName } from '../../poker/types';
import { FitBox } from './FitBox';
import type { Phase, Rating, SessionCard } from './sessionStore';

/* §6.3 gesture constants */
const HOLD_MS = 180;
const HOLD_MOVE_PX = 8;
const START_PX = 10;
const DIR_RATIO = 1.4;
const COMMIT_PX = 72;
const COMMIT_MIN_PX = 24;
const COMMIT_VX = 0.5; // px/ms
const VEL_WINDOW_MS = 80;
const RESIST_PX = 8;
const ROT_DIV = 22;
const ROT_MAX = 10;
const STAMP_FROM = 24;
const STAMP_SPAN = 48;
const DEBOUNCE_MS = 250;
const GHOST_MS = 180;
const GHOST_XFADE_MS = 120;
const RESIST_CAPTION_MS = 900;

type Mode = 'none' | 'swipe' | 'resist' | 'hold' | 'cancel';

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  t0: number;
  dx: number;
  dy: number;
  mode: Mode;
  holdTimer: number;
  samples: Array<{ t: number; x: number }>;
}

export interface SwipeStageProps {
  card: SessionCard;
  phase: Phase;
  /** reveal phase, ratings allowed (not 순간기억 / 노출). */
  swipeEnabled: boolean;
  /** Button / keyboard driven fly-out. */
  exit: Rating | null;
  /** 순간기억 / 노출: card transitions crossfade instead of sliding. */
  crossfade: boolean;
  transitionMs: number;
  /** TimerBar, rendered between the fan and the answer slot (does not move with the finger). */
  timer?: ReactNode;
  /** AnswerSlot — follows the finger 1:1 together with the fan. */
  answer: ReactNode;
  onTap(): void;
  onHoldStart(): void;
  onHoldEnd(): void;
  onSwipe(r: Rating): void;
  onDragChange(dragging: boolean): void;
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
 * Owns the fan + hand label + answer slot and every stage gesture (§6.3): tap, hold (180 ms / < 8 px),
 * horizontal swipe (start 10 px, commit 72 px or 24 px + 0.5 px/ms), vertical cancel. Transforms are written
 * straight to the DOM (no re-render per move); stamps fade with |dx|.
 */
export function SwipeStage({ card, phase, swipeEnabled, exit, crossfade, transitionMs, timer, answer, onTap, onHoldStart, onHoldEnd, onSwipe, onDragChange }: SwipeStageProps) {
  const root = useRef<HTMLDivElement>(null);
  const stampL = useRef<HTMLSpanElement>(null);
  const stampR = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const blockedUntil = useRef(0);
  const flew = useRef(false);
  const captionTimer = useRef(0);

  const [dragging, setDragging] = useState(false);
  const [exitDir, setExitDir] = useState<Rating | null>(null);
  const [ghost, setGhost] = useState<SessionCard | null>(null);
  const [resistCaption, setResistCaption] = useState(false);

  // latest callbacks / flags for the gesture handlers (registered once per card)
  const cb = useRef({ onTap, onHoldStart, onHoldEnd, onSwipe, onDragChange, swipeEnabled, peeked: !!card.peeked, phase });
  cb.current = { onTap, onHoldStart, onHoldEnd, onSwipe, onDragChange, swipeEnabled, peeked: !!card.peeked, phase };

  const setVars = useCallback((dx: number, rot: number) => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty('--dx', `${dx}px`);
    el.style.setProperty('--rot', `${rot}deg`);
  }, []);

  const setStamps = useCallback((dx: number) => {
    const o = Math.max(0, Math.min(1, (Math.abs(dx) - STAMP_FROM) / STAMP_SPAN));
    if (stampL.current) stampL.current.style.opacity = dx < 0 ? String(o) : '0';
    if (stampR.current) stampR.current.style.opacity = dx > 0 ? String(o) : '0';
  }, []);

  // Card change: reset transforms, show a ghost of the previous fan unless it already flew out.
  const prevCard = useRef(card);
  useLayoutEffect(() => {
    if (prevCard.current.id === card.id) return;
    const previous = prevCard.current;
    prevCard.current = card;
    setVars(0, 0);
    setStamps(0);
    setExitDir(null);
    setDragging(false);
    if (!flew.current && !reducedMotion()) setGhost(previous);
    flew.current = false;
  }, [card, setVars, setStamps]);

  useEffect(() => {
    if (!ghost) return;
    const t = window.setTimeout(() => setGhost(null), crossfade ? GHOST_XFADE_MS : GHOST_MS);
    return () => window.clearTimeout(t);
  }, [ghost, crossfade]);

  // Button / keyboard rating → fly-out
  useEffect(() => {
    if (!exit) return;
    flew.current = true;
    setExitDir(exit);
    setStamps(exit === 'know' ? 200 : -200);
  }, [exit, setStamps]);

  useEffect(() => () => window.clearTimeout(captionTimer.current), []);

  const showResistCaption = useCallback(() => {
    setResistCaption(true);
    window.clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(() => setResistCaption(false), RESIST_CAPTION_MS);
  }, []);

  const finishGesture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      gesture.current = null;
      window.clearTimeout(g.holdTimer);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const c = cb.current;
      if (g.mode === 'hold') {
        c.onHoldEnd();
      } else if (g.mode === 'swipe' && !cancelled) {
        const dx = g.dx;
        const rightBlocked = c.peeked && dx > 0;
        const recent = g.samples.filter((s) => s.t >= performance.now() - VEL_WINDOW_MS);
        const first = recent[0] ?? g.samples[0];
        const last = g.samples[g.samples.length - 1];
        const vx = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
        const commit = !rightBlocked && (Math.abs(dx) >= COMMIT_PX || (Math.abs(dx) >= COMMIT_MIN_PX && Math.abs(vx) >= COMMIT_VX && Math.sign(vx) === Math.sign(dx)));
        if (commit) {
          const r: Rating = dx > 0 ? 'know' : 'unsure';
          flew.current = true;
          blockedUntil.current = performance.now() + DEBOUNCE_MS;
          setDragging(false);
          setExitDir(r);
          setStamps(r === 'know' ? 200 : -200);
          c.onSwipe(r);
        } else {
          setDragging(false);
          setVars(0, 0);
          setStamps(0);
        }
      } else if (g.mode === 'none' && !cancelled) {
        const short = performance.now() - g.t0 < HOLD_MS && Math.hypot(g.dx, g.dy) < HOLD_MOVE_PX;
        setDragging(false);
        setVars(0, 0);
        if (short) c.onTap();
      } else {
        setDragging(false);
        setVars(0, 0);
        setStamps(0);
      }
      c.onDragChange(false);
    },
    [setVars, setStamps],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary || gesture.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as Element).closest('button, a')) return;
      if (performance.now() < blockedUntil.current || exitDir) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      const t0 = performance.now();
      const g: Gesture = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0, dx: 0, dy: 0, mode: 'none', holdTimer: 0, samples: [{ t: t0, x: e.clientX }] };
      g.holdTimer = window.setTimeout(() => {
        const cur = gesture.current;
        if (!cur || cur !== g || cur.mode !== 'none') return;
        if (Math.hypot(cur.dx, cur.dy) >= HOLD_MOVE_PX) return;
        cur.mode = 'hold';
        cb.current.onHoldStart();
      }, HOLD_MS);
      gesture.current = g;
      setDragging(true);
      cb.current.onDragChange(true);
    },
    [exitDir],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      g.dx = e.clientX - g.x0;
      g.dy = e.clientY - g.y0;
      const t = performance.now();
      g.samples.push({ t, x: e.clientX });
      if (g.samples.length > 12) g.samples.splice(0, g.samples.length - 12);
      const adx = Math.abs(g.dx);
      const ady = Math.abs(g.dy);
      if (g.mode === 'none') {
        if (Math.hypot(g.dx, g.dy) >= HOLD_MOVE_PX) window.clearTimeout(g.holdTimer);
        if (ady >= START_PX && ady > DIR_RATIO * adx) {
          g.mode = 'cancel';
          window.clearTimeout(g.holdTimer);
          setDragging(false);
          setVars(0, 0);
          cb.current.onDragChange(false);
          return;
        }
        if (adx >= START_PX && adx > DIR_RATIO * ady) {
          window.clearTimeout(g.holdTimer);
          g.mode = cb.current.swipeEnabled ? 'swipe' : 'resist';
          if (g.mode === 'resist') showResistCaption();
        }
      }
      if (g.mode === 'swipe') {
        const blocked = cb.current.peeked && g.dx > 0;
        const dx = blocked ? Math.max(-RESIST_PX, Math.min(RESIST_PX, g.dx)) : g.dx;
        const rot = blocked || reducedMotion() ? 0 : Math.max(-ROT_MAX, Math.min(ROT_MAX, dx / ROT_DIV));
        setVars(dx, rot);
        setStamps(blocked ? 0 : dx);
      } else if (g.mode === 'resist') {
        setVars(Math.max(-RESIST_PX, Math.min(RESIST_PX, g.dx)), 0);
      }
    },
    [setVars, setStamps, showResistCaption],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => finishGesture(e, false), [finishGesture]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => finishGesture(e, true), [finishGesture]);
  const preventMenu = useCallback((e: ReactMouseEvent) => e.preventDefault(), []);

  const cls = [
    'trainer-stage',
    dragging ? 'trainer-stage--dragging' : '',
    exitDir ? `trainer-stage--exit trainer-stage--exit-${exitDir}` : '',
    crossfade ? 'trainer-stage--xfade' : '',
    phase === 'reveal' ? 'trainer-stage--reveal' : 'trainer-stage--think',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={root}
      className={cls}
      style={{ '--t-in': `${transitionMs}ms` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={preventMenu}
    >
      <div className="trainer-stage__area">
        <span ref={stampL} className="trainer-stamp trainer-stamp--unsure" aria-hidden="true">
          ◁ 헷갈려요
        </span>
        <span ref={stampR} className="trainer-stamp trainer-stamp--know" aria-hidden="true">
          알아요 ▷
        </span>
        {ghost && (
          <div key={`ghost-${ghost.id}`} className="trainer-stage__card trainer-stage__card--ghost" aria-hidden="true">
            <Fan cards={ghost.cards} hand={ghost.step.hand} />
          </div>
        )}
        <div key={card.id} className="trainer-stage__card">
          <Fan cards={card.cards} hand={card.step.hand} flagged={card.flagged} />
        </div>
        {resistCaption && (
          <span className="trainer-stage__caption" role="status">
            답을 먼저 보고요
          </span>
        )}
      </div>
      {timer && <div className="trainer-timer">{timer}</div>}
      <div className="trainer-stage__answer">{answer}</div>
    </div>
  );
}
