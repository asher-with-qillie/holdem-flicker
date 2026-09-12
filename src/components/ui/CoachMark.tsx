/**
 * First-run coach mark (spec §4 / §5.10, owner F). Store-agnostic: the trainer (owner B) renders it over the
 * paused session when `settings.coachSeen < 1` and writes `coachSeen: 1` on `onDone` / `onSkip`.
 *
 *   <CoachMark steps={defaultCoachSteps(settings.sessionSize)} onDone={resume} onSkip={resume} />
 *
 * Portaled to <body> at --z-coach. Backdrop = dim 55 % + blur 8 with a radial spotlight cut-out (mask) that keeps
 * the cards behind visible. Card = GlassPanel strong (blur-free, the backdrop already blurs). Step art loops
 * (ring 1.2 s, ghost swipe 1.6 s) become static frames under prefers-reduced-motion. Keyboard: Enter/Space on the
 * focused button, Esc = 건너뛰기 (last step: 시작할게요), ← / → = 다음 on the swipe step. A real horizontal swipe
 * ≥ 40 px on the card also counts as 다음 on the swipe step. No haptics (§8).
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../../poker/types';
import { HandView, PlayingCard } from '../PlayingCard';
import { CapsuleButton } from './CapsuleButton';
import { GlassPanel } from './GlassPanel';
import { ProgressRing } from './ProgressRing';
import '../../styles/coachmark.css';

export type CoachArt = 'hold' | 'swipe' | 'session';

export interface CoachStep {
  title: string;
  body: string;
  art: CoachArt;
  /** art 'session' only: the ring counts 0 → count (default 20) */
  count?: number;
}

export interface CoachMarkProps {
  steps: CoachStep[];
  onDone(): void;
  onSkip(): void;
}

const SWIPE_PX = 40;
const ACE: Card = { rank: 'A', suit: 's' };
const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The three §5.10 steps with the spec copy; `sessionSize` fills step 3. */
export function defaultCoachSteps(sessionSize = 20): CoachStep[] {
  return [
    { art: 'hold', title: '꾹 누르면 멈춰요', body: '누르는 동안 해설이 올라오고, 손을 떼면 바로 이어져요.' },
    { art: 'swipe', title: '답을 보고 스와이프', body: '오른쪽 → 알아요 · 왼쪽 ← 헷갈려요. 헷갈린 카드는 곧 다시 보여드릴게요' },
    { art: 'session', title: `${sessionSize}장이 한 세션이에요`, body: '끝나면 요약이 나와요. ✕는 언제든 저장하고 끝내요', count: sessionSize },
  ];
}

/* ---------------------------------------------------------------- art */

function Finger() {
  return (
    <svg className="cm-finger" viewBox="0 0 32 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21V6.5a3 3 0 0 1 6 0V19" />
      <path d="M18 19v-2a3 3 0 0 1 6 0v3" />
      <path d="M24 20v-.5a2.5 2.5 0 0 1 5 0V28a10 10 0 0 1-10 10h-3.2a10 10 0 0 1-8-4l-4.6-6.1a2.6 2.6 0 0 1 3.7-3.6L12 27.5" />
      <path className="cm-finger__fill" d="M12 21V6.5a3 3 0 0 1 6 0V19l0 0v-2a3 3 0 0 1 6 0v3a2.5 2.5 0 0 1 5 0V28a10 10 0 0 1-10 10h-3.2a10 10 0 0 1-8-4l-4.6-6.1a2.6 2.6 0 0 1 3.7-3.6L12 27.5z" />
    </svg>
  );
}

function HoldArt() {
  return (
    <div className="cm-art cm-art--hold" aria-hidden="true">
      <div className="cm-card">
        <PlayingCard card={ACE} size="md" />
      </div>
      <div className="cm-touch">
        <span className="cm-ring" />
        <Finger />
      </div>
    </div>
  );
}

function SwipeArt() {
  return (
    <div className="cm-art cm-art--swipe" aria-hidden="true">
      <span className="cm-cue cm-cue--l">←</span>
      <div className="cm-card cm-card--swipe">
        <PlayingCard card={ACE} size="md" />
        <span className="cm-stamp cm-stamp--know">알아요</span>
        <span className="cm-stamp cm-stamp--unsure">헷갈려요</span>
      </div>
      <span className="cm-cue cm-cue--r">→</span>
    </div>
  );
}

function SessionArt({ count }: { count: number }) {
  return (
    <div className="cm-art cm-art--session" aria-hidden="true">
      <ProgressRing value={count} max={count} size={64} stroke={6} label={<span className="cm-ring-num">{count}</span>} />
    </div>
  );
}

/* ---------------------------------------------------------------- component */

export function CoachMark({ steps, onDone, onSkip }: CoachMarkProps): JSX.Element | null {
  const [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const titleId = useId();
  const step = steps[index];
  const last = index >= steps.length - 1;

  const latest = useRef({ onDone, onSkip, last, art: step?.art });
  latest.current = { onDone, onSkip, last, art: step?.art };

  const next = () => {
    if (latest.current.last) latest.current.onDone();
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  // focus the primary button on every step; keyboard equivalents; minimal focus trap
  useEffect(() => {
    const el = panel.current;
    el?.querySelector<HTMLButtonElement>('.cm-next')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const { last: isLast, onDone: done, onSkip: skip, art } = latest.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isLast) done();
        else skip();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && art === 'swipe') {
        e.preventDefault();
        next();
      } else if (e.key === 'Tab' && el) {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const end = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!step) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (step.art !== 'swipe') return;
    swipeStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.id !== e.pointerId || step.art !== 'swipe') return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) next();
  };

  const node = (
    <div className="cm-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="cm-backdrop" aria-hidden="true" />
      <div className="cm-layout">
        <GlassPanel variant="strong" radius="lg" padding={20} className="cm-panel glass-flat">
          <div
            ref={panel}
            key={index}
            className={`cm-step cm-step--${step.art}`}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              swipeStart.current = null;
            }}
          >
            <div className="cm-dots" aria-hidden="true">
              {steps.map((_, k) => (
                <i key={k} className={k === index ? 'on' : undefined} />
              ))}
            </div>
            <span className="ui-sr">
              {index + 1} / {steps.length} 단계
            </span>
            {step.art === 'hold' && <HoldArt />}
            {step.art === 'swipe' && <SwipeArt />}
            {step.art === 'session' && <SessionArt count={step.count ?? 20} />}
            <h2 id={titleId} className="cm-title t-title-3">
              {step.title}
            </h2>
            <p className="cm-body">{step.body}</p>
            <div className="cm-actions">
              {!last && (
                <CapsuleButton tone="ghost" size="md" onClick={onSkip}>
                  건너뛰기
                </CapsuleButton>
              )}
              <CapsuleButton tone="primary" size="md" className="cm-next" block={last} onClick={next}>
                {last ? '시작할게요' : '다음'}
              </CapsuleButton>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

/* ---------------------------------------------------------------- dev fixture (#coach) */

const FIXTURE_HAND: [Card, Card] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'd' },
];

/**
 * Dev fixture for the `coach-fixture` screenshot: a static think-phase stage (HUD pill, fan, answer slot, rating
 * capsules — flat, no store) with <CoachMark> over it. Mount from App.tsx next to the `#ui` route:
 *   if (hash === '#coach') return <CoachMarkFixture />;
 */
export function CoachMarkFixture(): JSX.Element {
  const [open, setOpen] = useState(true);
  const [ended, setEnded] = useState<'done' | 'skip' | null>(null);
  const finish = (how: 'done' | 'skip') => {
    setEnded(how);
    setOpen(false);
  };
  return (
    <div className="cm-fx">
      <div className="cm-fx__hud glass-clear glass-flat">
        <span className="cm-fx__x">✕</span>
        <span className="tnum">3 / 20</span>
        <span className="cm-fx__speed">보통</span>
      </div>
      <div className="cm-fx__strip fill">
        {['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map((p) => (
          <span key={p} className={p === 'BB' ? 'cm-fx__seat cm-fx__seat--me' : 'cm-fx__seat'}>
            {p}
          </span>
        ))}
      </div>
      <div className="cm-fx__stage">
        <HandView cards={FIXTURE_HAND} size="lg" />
        <p className="cm-fx__hand t-title-3">AKo</p>
      </div>
      <div className="cm-fx__slot glass-clear glass-flat">
        <span className="t-headline">뭐 할래요?</span>
        <span className="cm-fx__legal">폴드 · 콜 · 3벳</span>
      </div>
      <div className="cm-fx__rate">
        <span className="cm-fx__pill cm-fx__pill--unsure">헷갈려요</span>
        <span className="cm-fx__pill cm-fx__pill--know">알아요</span>
      </div>
      {!open && (
        <div className="cm-fx__again">
          <CapsuleButton tone="neutral" size="md" onClick={() => setOpen(true)}>
            다시 보기 · 마지막: {ended === 'done' ? '시작할게요' : '건너뛰기'}
          </CapsuleButton>
        </div>
      )}
      {open && <CoachMark steps={defaultCoachSteps(20)} onDone={() => finish('done')} onSkip={() => finish('skip')} />}
    </div>
  );
}
