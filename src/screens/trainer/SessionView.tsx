import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExplanationBody, ExplanationSheet } from '../../components/ExplanationSheet';
import { TableDiagram } from '../../components/TableDiagram';
import { TimerBar } from '../../components/TimerBar';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { CoachMark, defaultCoachSteps } from '../../components/ui/CoachMark';
import { IconButton } from '../../components/ui/IconButton';
import { Sheet } from '../../components/ui/Sheet';
import { IconNext, IconPrev } from '../../components/ui/icons';
import { explainStep } from '../../poker/explain';
import { scenarioSituation } from '../../poker/scenarios';
import { SCENARIO_ACTIONS } from '../../poker/types';
import { useProgress } from '../../state/progress';
import { COACH_VERSION, updateSettings, type Settings } from '../../state/settings';
import { AnswerSlot } from './AnswerSlot';
import { ChoiceButtons } from './ChoiceButtons';
import { SessionHud } from './SessionHud';
import { setCoachOpen, type SessionCard } from './sessionStore';
import { StepCrumbs } from './StepCrumbs';
import { SwipeStage } from './SwipeStage';
import { formatCountdown, useRafTimer } from './useRafTimer';
import type { TrainerSession } from './useTrainerSession';

const PROMPT = '어떻게 할까요?';
const HOLD_HINT = '길게 누르면 멈추고 해설';
const HOLD_FOOTER = '손을 떼면 이어서 진행해요';
const QUIET_CAPTION = '훑어보기 중 · 선택 없이 답만 봐요';
const UNSURE_CAPTION = '헷갈려요로 기록 · 곧 다시 나와요';
const HINT_UNTIL_CARDS = 60; // ≈ first 3 sessions

/** Status line above the choices in the reveal state. */
function outcomeLine(card: SessionCard): { text: string; tone: 'correct' | 'partial' | 'wrong' | 'neutral' } {
  if (card.timedOut) return { text: '시간 초과 · 못 골랐어요', tone: 'neutral' };
  if (!card.chosenAction) return { text: '정답 확인', tone: 'neutral' };
  if (card.peeked) return { text: '답을 먼저 봤어요 · 헷갈려요로 기록', tone: 'neutral' };
  if (card.grade === 'correct') return { text: '정답 ✓', tone: 'correct' };
  if (card.grade === 'partial') return { text: '부분 정답 △ · 이것도 자주 해요', tone: 'partial' };
  return { text: '오답 ✕', tone: 'wrong' };
}

/** Owns the rAF loop so per-frame progress updates re-render only the bar + the countdown number. */
function PhaseTimer({ durationMs, running, resetKey, paused, hidden, phase, onExpire }: { durationMs: number; running: boolean; resetKey: string; paused: boolean; hidden: boolean; phase: 'think' | 'reveal'; onExpire: () => void }) {
  const { progress, remainingMs } = useRafTimer(durationMs, running, resetKey, onExpire);
  const num = formatCountdown(remainingMs);
  return (
    <div className={`trainer-timer__wrap${hidden ? ' trainer-timer__wrap--hidden' : ''}`} aria-hidden={hidden || undefined}>
      <TimerBar progress={progress} paused={paused} />
      <span className={`trainer-timer__num tnum trainer-timer__num--${paused ? 'paused' : phase}`} role="timer" aria-live="off">
        {paused ? '일시정지' : phase === 'think' ? num : `다음까지 ${num}`}
      </span>
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
    updateSettings({ coachSeen: COACH_VERSION });
    setCoachOpen(false);
  }, []);

  const quiet = s.quiet;
  const onHoldStart = useCallback(() => s.setHolding(true), [s.setHolding]);
  const onHoldEnd = useCallback(() => s.setHolding(false), [s.setHolding]);

  // Keyboard equivalents (desktop testing): 1–3 pick a choice · Space / Enter = 다음 in the reveal state.
  useEffect(() => {
    if (s.status !== 'running' || s.sheetOpen || s.coachOpen || !step) return;
    const actions = SCENARIO_ACTIONS[step.scenario.kind];
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (s.phase === 'think' && !quiet && n >= 1 && n <= actions.length) {
        e.preventDefault();
        s.choose(actions[n - 1]);
      } else if ((e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') && s.phase === 'reveal') {
        e.preventDefault();
        s.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.status, s.sheetOpen, s.coachOpen, s.phase, quiet, step, s.choose, s.next]);

  if (!card || !step || !explanation || !session) return null;

  const seenCount = session.queue.filter((c) => c.exposed).length + (s.phase === 'reveal' && !card.exposed ? 1 : 0);
  const showHint = pv.totalCards < HINT_UNTIL_CARDS;
  const timerPaused = s.paused || s.holding || s.sheetOpen || s.coachOpen;
  const timerHidden = s.waiting || (session.config.exposure && s.manual);
  const reveal = s.phase === 'reveal';
  const outcome = reveal && !quiet ? outcomeLine(card) : null;
  const canFlag = reveal && (quiet || card.rating === 'know' || card.flagged);

  const rootCls = [
    'trainer-session',
    reveal ? `trainer-session--reveal trainer-session--${s.tone}` : 'trainer-session--think',
    s.holding ? 'trainer-session--holding' : '',
    s.paused ? 'trainer-session--paused' : '',
    quiet ? 'trainer-session--quiet' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootCls}>
      <div className="trainer-session__wash" aria-hidden="true" />
      <SessionHud index={s.index} total={session.queue.length} size={session.config.size} origin={card.origin} phase={s.phase} quiet={quiet} paused={s.paused} holding={s.holding} onClose={openConfirm} onTogglePause={s.togglePause} />

      <div className="trainer-strip fill">
        <TableDiagram scenario={step.scenario} compact />
      </div>
      <p className="trainer-situation t-headline">
        <span>{scenarioSituation(step.scenario)}</span>
      </p>
      <div className="trainer-crumbs-slot">{s.chain.length > 1 && <StepCrumbs steps={s.chain} current={s.chainIndex} />}</div>

      <SwipeStage card={card} phase={s.phase} crossfade={quiet} transitionMs={session.timing.transition} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd}>
        <div className="trainer-timer">
          <PhaseTimer durationMs={s.durationMs} running={s.running} resetKey={s.timerKey} paused={timerPaused} hidden={timerHidden} phase={s.phase} onExpire={s.onExpire} />
        </div>

        {!quiet && (
          <div className="trainer-choose">
            <p className={`trainer-choose__prompt t-headline${outcome ? ` trainer-choose__prompt--${outcome.tone}` : ''}`} role="status" aria-live="polite">
              {outcome ? outcome.text : PROMPT}
            </p>
            <ChoiceButtons step={step} chosen={card.chosenAction} grade={card.grade} revealed={reveal} onChoose={s.choose} />
          </div>
        )}

        <AnswerSlot step={step} phase={s.phase} explanation={explanation} showMix={s.showMix} animKey={s.timerKey} hint={showHint ? HOLD_HINT : undefined} />
      </SwipeStage>

      <div className="trainer-rateslot">
        {canFlag ? (
          <CapsuleButton tone={card.flagged ? 'unsure' : 'ghost'} size="md" className="trainer-flagbtn" onClick={s.flagToggle} aria-pressed={!!card.flagged}>
            {card.flagged ? '🤔 헷갈려요로 표시됨' : '헷갈려요로 표시'}
          </CapsuleButton>
        ) : reveal && !quiet ? (
          <p className="trainer-rateslot__caption t-footnote">{UNSURE_CAPTION}</p>
        ) : quiet ? (
          <p className="trainer-rateslot__caption t-footnote">{QUIET_CAPTION}</p>
        ) : null}
      </div>

      <div className="trainer-controls">
        <IconButton icon={<IconPrev />} label="이전 카드" onClick={s.prev} disabled={s.index === 0} />
        <CapsuleButton tone="neutral" size="lg" className="trainer-controls__main" onClick={() => s.setSheetOpen(true)}>
          해설
        </CapsuleButton>
        <IconButton icon={<IconNext />} label="다음 카드" onClick={s.next} />
      </div>

      <Sheet open={s.holding} onClose={onHoldEnd} held title="해설" footer={<p className="trainer-hold__foot t-footnote">{HOLD_FOOTER}</p>}>
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
