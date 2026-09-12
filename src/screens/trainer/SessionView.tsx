import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExplanationBody, ExplanationSheet } from '../../components/ExplanationSheet';
import { TableDiagram } from '../../components/TableDiagram';
import { TimerBar } from '../../components/TimerBar';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { CoachMark, defaultCoachSteps } from '../../components/ui/CoachMark';
import { IconButton } from '../../components/ui/IconButton';
import { RatingBar } from '../../components/ui/RatingBar';
import { Sheet } from '../../components/ui/Sheet';
import { IconNext, IconPrev } from '../../components/ui/icons';
import { explainStep } from '../../poker/explain';
import { scenarioSituation } from '../../poker/scenarios';
import { useProgress } from '../../state/progress';
import { updateSettings, type Settings } from '../../state/settings';
import { AnswerSlot } from './AnswerSlot';
import { SessionHud } from './SessionHud';
import { setCoachOpen, setDragging } from './sessionStore';
import { StepCrumbs } from './StepCrumbs';
import { SwipeStage } from './SwipeStage';
import { useRafTimer } from './useRafTimer';
import type { TrainerSession } from './useTrainerSession';

const PEEKED_HINT = '답을 먼저 봤어요 · 다음에 확인해요';
const QUIET_CAPTION = '훑어보기 중 · 탭하면 헷갈려요로 표시';
const HOLD_HINT = '길게 누르면 멈추고 해설';
const HOLD_FOOTER = '손을 떼면 이어서 진행해요';
const HINT_UNTIL_CARDS = 60; // ≈ first 3 sessions

/** Owns the rAF loop so per-frame progress updates re-render only the bar. */
function PhaseTimer({ durationMs, running, resetKey, paused, hidden, onExpire }: { durationMs: number; running: boolean; resetKey: string; paused: boolean; hidden: boolean; onExpire: () => void }) {
  const progress = useRafTimer(durationMs, running, resetKey, onExpire);
  return (
    <div className={`trainer-timer__wrap${hidden ? ' trainer-timer__wrap--hidden' : ''}`} aria-hidden={hidden || undefined}>
      <TimerBar progress={progress} paused={paused} />
    </div>
  );
}

export function SessionView({ s, settings }: { s: TrainerSession; settings: Settings }) {
  const { card, step, session } = s;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pv = useProgress(settings.dailyGoal);

  const explanation = useMemo(() => (step ? explainStep(step) : null), [step]);

  const openConfirm = useCallback(() => {
    setConfirmOpen(true);
    s.setSheetOpen(true);
  }, [s.setSheetOpen]);
  const closeConfirm = useCallback(() => {
    setConfirmOpen(false);
    s.setSheetOpen(false);
  }, [s.setSheetOpen]);
  const finishNow = useCallback(() => {
    setConfirmOpen(false);
    s.endEarly();
  }, [s.endEarly]);

  const coachDone = useCallback(() => {
    updateSettings({ coachSeen: 1 });
    setCoachOpen(false);
  }, []);

  const quiet = s.quiet;
  const swipeEnabled = s.phase === 'reveal' && !quiet && !s.exiting;

  const onTap = useCallback(() => {
    if (s.phase === 'think' && !quiet) s.revealNow();
    else if (quiet) s.flagToggle();
    else s.next();
  }, [s.phase, quiet, s.revealNow, s.flagToggle, s.next]);

  const onHoldStart = useCallback(() => s.setHolding(true), [s.setHolding]);
  const onHoldEnd = useCallback(() => s.setHolding(false), [s.setHolding]);
  const onSwipe = useCallback((r: 'know' | 'unsure') => void s.rate(r, 'swipe'), [s.rate]);
  const onDragChange = useCallback((d: boolean) => setDragging(d), []);

  // Keyboard equivalents (§6.3): ← unsure · → know · Space reveal-or-next (flag in quiet modes)
  useEffect(() => {
    if (s.status !== 'running' || s.sheetOpen || s.coachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && s.phase === 'reveal' && !quiet) {
        e.preventDefault();
        s.rate('unsure', 'button');
      } else if (e.key === 'ArrowRight' && s.phase === 'reveal' && !quiet) {
        e.preventDefault();
        s.rate('know', 'button');
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.status, s.sheetOpen, s.coachOpen, s.phase, quiet, s.rate, onTap]);

  if (!card || !step || !explanation || !session) return null;

  const seenCount = session.queue.filter((c) => c.exposed).length + (s.phase === 'reveal' && !card.exposed ? 1 : 0);
  const fresh = pv.activeDays === 0 || (pv.activeDays === 1 && pv.today.sessions === 0);
  const showHint = pv.totalCards < HINT_UNTIL_CARDS;
  const timerPaused = !s.running && !s.waiting;
  const timerHidden = s.waiting || (session.config.exposure && s.manual);

  return (
    <div className={`trainer-session${s.holding ? ' trainer-session--holding' : ''}${s.paused ? ' trainer-session--paused' : ''}`}>
      <SessionHudSlot s={s} onClose={openConfirm} />

      <div className="trainer-strip fill">
        <TableDiagram scenario={step.scenario} compact />
      </div>
      <p className="trainer-situation t-headline">
        <span>{scenarioSituation(step.scenario)}</span>
      </p>
      <div className="trainer-crumbs-slot">{s.chain.length > 1 && <StepCrumbs steps={s.chain} current={s.chainIndex} />}</div>

      <SwipeStage
        card={card}
        phase={s.phase}
        swipeEnabled={swipeEnabled}
        exit={s.exiting}
        crossfade={quiet}
        transitionMs={session.timing.transition}
        timer={<PhaseTimer durationMs={s.durationMs} running={s.running} resetKey={s.timerKey} paused={timerPaused} hidden={timerHidden} onExpire={s.onExpire} />}
        answer={<AnswerSlot step={step} phase={s.phase} explanation={explanation} showMix={s.showMix} animKey={s.timerKey} />}
        onTap={onTap}
        onHoldStart={onHoldStart}
        onHoldEnd={onHoldEnd}
        onSwipe={onSwipe}
        onDragChange={onDragChange}
      />

      <div className={`trainer-rateslot${card.peeked && s.phase === 'reveal' && !quiet ? ' trainer-rateslot--hint' : ''}`}>
        {quiet ? (
          <p className="trainer-rateslot__caption t-footnote">{QUIET_CAPTION}</p>
        ) : s.phase === 'reveal' ? (
          <RatingBar onRate={(r) => s.rate(r, 'button')} disabled={!!s.exiting} knowDisabled={!!card.peeked} knowDisabledHint={PEEKED_HINT} pulseOnce={fresh && s.index === 0} />
        ) : (
          showHint && <p className="trainer-rateslot__caption t-footnote">{HOLD_HINT}</p>
        )}
      </div>

      <div className="trainer-controls">
        <IconButton icon={<IconPrev />} label="이전 카드" onClick={s.prev} disabled={s.index === 0 || !!s.exiting} />
        <CapsuleButton tone="neutral" size="lg" className="trainer-controls__main" onClick={() => s.setSheetOpen(true)}>
          해설
        </CapsuleButton>
        <IconButton icon={<IconNext />} label="다음 카드" onClick={s.next} disabled={!!s.exiting} />
      </div>

      <Sheet open={s.holding} onClose={onHoldEnd} held title={explanation.headline} footer={<p className="trainer-hold__foot t-footnote">{HOLD_FOOTER}</p>}>
        <ExplanationBody step={step} explanation={explanation} />
      </Sheet>

      {s.sheetOpen && !confirmOpen && <ExplanationSheet step={step} explanation={explanation} onClose={() => s.setSheetOpen(false)} />}

      <Sheet
        open={confirmOpen}
        onClose={closeConfirm}
        title="여기까지 기록할까요?"
        footer={
          <>
            <CapsuleButton tone="neutral" size="lg" block onClick={closeConfirm}>
              계속하기
            </CapsuleButton>
            <CapsuleButton tone="primary" size="lg" block onClick={finishNow}>
              끝내기
            </CapsuleButton>
          </>
        }
      >
        <p className="trainer-confirm t-body">본 카드 {seenCount}장은 저장돼요</p>
      </Sheet>

      {s.coachOpen && <CoachMark steps={defaultCoachSteps(session.config.size)} onDone={coachDone} onSkip={coachDone} />}
    </div>
  );
}

function SessionHudSlot({ s, onClose }: { s: TrainerSession; onClose(): void }) {
  const { card, session } = s;
  if (!card || !session) return null;
  return <SessionHud index={s.index} total={session.queue.length} size={session.config.size} origin={card.origin} paused={s.paused} holding={s.holding} onClose={onClose} onTogglePause={s.togglePause} />;
}

