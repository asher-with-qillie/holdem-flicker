import { ActionBadge, actionLabel } from '../../components/ActionBadge';
import type { Explanation } from '../../poker/explain';
import type { Step } from '../../poker/trainer';
import { SCENARIO_ACTIONS } from '../../poker/types';
import type { Phase } from './useTrainerSession';

export const HOLD_HINT = '화면을 길게 누르면 타이머가 멈추고 해설이 보입니다';

/** Mix chips like "3벳 75% · 콜 25%" (fold included when the hand is not pure). */
export function MixChips({ step }: { step: Step }) {
  if (step.mixList.length < 2) return null;
  return (
    <span className="mixchips" aria-label="혼합 빈도">
      {step.mixList.map(({ action, weight }) => (
        <span key={action} className={`mixchip mixchip--${action}`}>
          {actionLabel(action, step.scenario.kind, true)} {Math.round(weight * 100)}%
        </span>
      ))}
    </span>
  );
}

/** Fixed-height answer slot: prompt while thinking, badge + reason + mix once revealed. */
export function AnswerArea({ step, phase, explanation, showMix, animKey }: { step: Step; phase: Phase; explanation: Explanation; showMix: boolean; animKey: string }) {
  if (phase === 'think') {
    const options = SCENARIO_ACTIONS[step.scenario.kind].map((a) => actionLabel(a, step.scenario.kind, true)).join(' · ');
    return (
      <div className="trainer-answer" aria-live="polite">
        <div className="trainer-think">생각해 보세요…</div>
        <div className="trainer-options">{options}</div>
        <div className="trainer-hint trainer-hint--inline">{HOLD_HINT}</div>
      </div>
    );
  }
  const hasMix = showMix && step.mixList.length >= 2;
  return (
    <div className="trainer-answer" aria-live="polite">
      <div key={animKey} className="trainer-reveal">
        <ActionBadge action={step.answer} kind={step.scenario.kind} size="lg" />
        {hasMix && (
          <div className="trainer-reveal__mix">
            <MixChips step={step} />
          </div>
        )}
        {explanation.reasoning[0] && <p className={`trainer-reason${hasMix ? ' trainer-reason--tight' : ''}`}>{explanation.reasoning[0]}</p>}
      </div>
    </div>
  );
}
