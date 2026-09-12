import { useCallback, useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ExplanationBody, ExplanationSheet } from '../components/ExplanationSheet';
import { HandView } from '../components/PlayingCard';
import { TableDiagram } from '../components/TableDiagram';
import { TimerBar } from '../components/TimerBar';
import { explainStep } from '../poker/explain';
import { cardLabel } from '../poker/hands';
import { scenarioSituation } from '../poker/scenarios';
import type { Card, HandName } from '../poker/types';
import { useSettings } from '../state/settings';
import '../styles/trainer.css';
import { AnswerArea, HOLD_HINT } from './trainer/AnswerArea';
import { FitBox } from './trainer/FitBox';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from './trainer/icons';
import { StepCrumbs } from './trainer/StepCrumbs';
import { useRafTimer } from './trainer/useRafTimer';
import { useTrainerSession } from './trainer/useTrainerSession';

/** Owns the rAF loop so per-frame progress updates re-render only the bar. */
function PhaseTimer({ durationMs, running, resetKey, paused, onExpire }: { durationMs: number; running: boolean; resetKey: string; paused: boolean; onExpire: () => void }) {
  const progress = useRafTimer(durationMs, running, resetKey, onExpire);
  return <TimerBar progress={progress} paused={paused} />;
}

function HandLabel({ cards, hand }: { cards: [Card, Card]; hand: HandName }) {
  return (
    <div className="trainer-handlabel" aria-label={`핸드 ${hand}`}>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[0].suit}`}>{cardLabel(cards[0])}</span>
      <span className={`trainer-handlabel__card trainer-handlabel__card--${cards[1].suit}`}>{cardLabel(cards[1])}</span>
      <span className="trainer-handlabel__sep">·</span>
      <span className="trainer-handlabel__name">{hand}</span>
    </div>
  );
}

export function TrainerScreen() {
  const [settings] = useSettings();
  const s = useTrainerSession(settings);
  const { step, seq } = s;

  const explanation = useMemo(() => (step ? explainStep(step) : null), [step]);

  const onStagePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      if ((e.target as Element).closest('button, a')) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      s.setHolding(true);
    },
    [s.setHolding],
  );
  const endHold = useCallback(() => s.setHolding(false), [s.setHolding]);
  const preventMenu = useCallback((e: ReactMouseEvent) => e.preventDefault(), []);

  if (!step || !explanation) {
    return (
      <div className="trainer" onContextMenu={preventMenu}>
        <div className="trainer-empty">
          <div className="panel trainer-empty__panel">
            <h2 className="trainer-empty__title">훈련할 차트가 없습니다</h2>
            <p className="screen__sub">선택한 포지션·상황에 맞는 차트가 아직 없어요. 설정에서 다른 조합을 골라 보세요.</p>
            <button type="button" className="btn btn--primary btn--block" onClick={s.newHand}>
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  const barPaused = !s.running && !s.waiting;

  return (
    <div className="trainer" onContextMenu={preventMenu}>
      <header className="trainer-head">
        <span className="trainer-pos" aria-label={`내 포지션 ${seq.hero}`}>
          {seq.hero}
        </span>
        <span className="trainer-counter" aria-label={`${s.stepIndex + 1}번째 단계, 총 ${seq.steps.length}단계`}>
          {s.stepIndex + 1}/{seq.steps.length}
        </span>
        <span className="trainer-head__spacer" />
        <button type="button" className={`trainer-ibtn${s.paused ? ' trainer-ibtn--accent' : ''}`} onClick={s.togglePause} aria-label={s.paused ? '재생' : '일시정지'} aria-pressed={s.paused}>
          {s.paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button type="button" className="btn trainer-newbtn" onClick={s.newHand}>
          <ShuffleIcon />
          새 핸드
        </button>
      </header>

      <div
        className={`trainer-stage${s.holding ? ' trainer-stage--holding' : ''}`}
        onPointerDown={onStagePointerDown}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
        onContextMenu={preventMenu}
      >
        <div className="trainer-table">
          <TableDiagram scenario={step.scenario} compact />
        </div>
        <p className="trainer-situation">
          <span>{scenarioSituation(step.scenario)}</span>
        </p>
        <StepCrumbs steps={seq.steps} current={s.stepIndex} />

        <FitBox className="trainer-hand">
          {(box) => <HandView cards={seq.cards} size={box.height >= 150 ? 'lg' : box.height >= 90 ? 'md' : 'sm'} />}
        </FitBox>
        <HandLabel cards={seq.cards} hand={seq.hand} />

        <div className="trainer-timer">
          <PhaseTimer durationMs={s.durationMs} running={s.running} resetKey={s.timerKey} paused={barPaused} onExpire={s.onExpire} />
        </div>

        <AnswerArea step={step} phase={s.phase} explanation={explanation} showMix={settings.showMixFrequencies} animKey={s.timerKey} />
        <p className="trainer-hint trainer-hint--foot">{HOLD_HINT}</p>
      </div>

      <div className="trainer-controls">
        <button type="button" className="trainer-ibtn" onClick={s.prev} aria-label="이전 단계">
          <PrevIcon />
        </button>
        <button type="button" className="btn trainer-controls__main" onClick={() => s.setSheetOpen(true)}>
          해설
        </button>
        {s.waiting && (
          <button type="button" className="btn btn--primary trainer-controls__main" onClick={s.next}>
            다음
          </button>
        )}
        <button type="button" className="trainer-ibtn" onClick={s.next} aria-label="다음 단계">
          <NextIcon />
        </button>
      </div>

      <div className={`trainer-hold${s.holding ? ' trainer-hold--on' : ''}`} aria-hidden={!s.holding}>
        <div className="trainer-hold__handle" />
        <div className="trainer-hold__body">
          <ExplanationBody step={step} explanation={explanation} />
        </div>
      </div>

      {s.sheetOpen && <ExplanationSheet step={step} explanation={explanation} onClose={() => s.setSheetOpen(false)} />}
    </div>
  );
}
