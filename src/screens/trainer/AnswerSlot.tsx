import type { CSSProperties } from 'react';
import { actionLabel } from '../../components/ActionBadge';
import type { Explanation } from '../../poker/explain';
import type { Step } from '../../poker/trainer';
import { SCENARIO_ACTIONS, type Action } from '../../poker/types';
import type { Phase } from './sessionStore';

const ACT_COLOR: Record<Action, string> = {
  fold: 'var(--act-fold)',
  call: 'var(--act-call)',
  raise: 'var(--act-raise)',
  threebet: 'var(--act-threebet)',
  fourbet: 'var(--act-fourbet)',
  allin: 'var(--act-allin)',
};

/** Mix chips "콜 75% · 3벳 25%" (.fill, 24 high) — shown when settings.showMixFrequencies and the hand is mixed. */
export function MixChips({ step }: { step: Step }) {
  if (step.mixList.length < 2) return null;
  return (
    <span className="trainer-mix" aria-label="혼합 빈도">
      {step.mixList.map(({ action, weight }) => (
        <span key={action} className="trainer-mix__chip fill tnum">
          <i style={{ background: ACT_COLOR[action] }} aria-hidden="true" />
          {actionLabel(action, step.scenario.kind, true)} {Math.round(weight * 100)}%
        </span>
      ))}
    </span>
  );
}

/**
 * Fixed-height glass-clear slot (§5.3 / §5.4): `뭐 할래요?` + legal actions while thinking; on reveal the answer
 * capsule flips in (rotateX −90° → 0, 240 ms) with the mix chips and the first reasoning line.
 */
export function AnswerSlot({ step, phase, explanation, showMix, animKey }: { step: Step; phase: Phase; explanation: Explanation; showMix: boolean; animKey: string }) {
  const kind = step.scenario.kind;
  if (phase === 'think') {
    const options = SCENARIO_ACTIONS[kind].map((a) => actionLabel(a, kind, true)).join(' · ');
    return (
      <div className="trainer-answer glass-clear" aria-live="polite">
        <div className="trainer-answer__prompt t-headline">뭐 할래요?</div>
        <div className="trainer-answer__options t-subhead">{options}</div>
      </div>
    );
  }
  const hasMix = showMix && step.mixList.length >= 2;
  const answer = step.answer;
  const capStyle = { '--tint': ACT_COLOR[answer] } as CSSProperties;
  return (
    <div className="trainer-answer glass-clear" aria-live="polite">
      <div key={animKey} className="trainer-answer__flip">
        <span className={`trainer-answer__cap glass-tint glass-flat t-title-2 trainer-answer__cap--${answer}`} style={capStyle}>
          {actionLabel(answer, kind)}
        </span>
        {hasMix && (
          <div className="trainer-answer__mix">
            <MixChips step={step} />
          </div>
        )}
        {explanation.reasoning[0] && <p className={`trainer-answer__reason t-footnote${hasMix ? ' trainer-answer__reason--tight' : ''}`}>{explanation.reasoning[0]}</p>}
      </div>
    </div>
  );
}
