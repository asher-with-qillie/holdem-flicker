import { actionLabel } from '../../components/ActionBadge';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import type { Step } from '../../poker/trainer';
import { SCENARIO_ACTIONS, type Action } from '../../poker/types';
import { actionWeight, PARTIAL_THRESHOLD, type Grade } from '../quiz/grade';

const MARK: Record<Grade, string> = { correct: '✓', partial: '△', wrong: '✕' };

export interface ChoiceButtonsProps {
  step: Step;
  /** Picked action (reveal state); undefined while thinking or after 시간 초과. */
  chosen?: Action;
  grade?: Grade;
  /** Reveal state — buttons disabled, correct one outlined. */
  revealed: boolean;
  onChoose(a: Action): void;
}

/**
 * The step's legal actions as large action-coloured capsules (fold first → most aggressive last), 56 high,
 * 2–3 per row (§5.3 v2.1). After a choice the picked one is marked ✓ / △ / ✕ and the correct one is outlined.
 * `data-answer` / `data-partial` mirror the quiz hooks for the screenshot / e2e scripts.
 */
export function ChoiceButtons({ step, chosen, grade, revealed, onChoose }: ChoiceButtonsProps): JSX.Element {
  const kind = step.scenario.kind;
  const actions = SCENARIO_ACTIONS[kind];
  const partial = actions.filter((a) => a !== step.answer && actionWeight(step, a) >= PARTIAL_THRESHOLD).join(',');
  return (
    <div className={`trainer-choices${revealed ? ' trainer-choices--done' : ''}`} role="group" aria-label="액션 선택" data-answer={step.answer} data-partial={partial}>
      {actions.map((a) => {
        const isChosen = chosen === a;
        const isAnswer = revealed && step.answer === a;
        const cls = ['trainer-choice', `trainer-choice--${a}`, isChosen ? `trainer-choice--chosen trainer-choice--${grade ?? 'wrong'}${grade === 'correct' ? ' glass-solid' : ''}` : '', isAnswer ? 'trainer-choice--answer' : '']
          .filter(Boolean)
          .join(' ');
        const mark = isChosen && grade ? MARK[grade] : isAnswer ? MARK.correct : '';
        return (
          <CapsuleButton
            key={a}
            tone="tint"
            tint={`var(--act-${a})`}
            size="xl"
            className={cls}
            data-action={a}
            onClick={() => onChoose(a)}
            disabled={revealed}
            aria-pressed={isChosen}
            icon={mark ? <span className="trainer-choice__mark" aria-hidden="true">{mark}</span> : undefined}
          >
            {actionLabel(a, kind)}
          </CapsuleButton>
        );
      })}
    </div>
  );
}
