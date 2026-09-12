import type { CSSProperties } from 'react';
import { actionLabel } from '../../components/ActionBadge';
import { PlainText } from '../../components/Term';
import type { Explanation } from '../../poker/explain';
import type { Step } from '../../poker/trainer';
import type { Action } from '../../poker/types';
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
 * Fixed-height glass-clear slot (§5.3 / §5.4): a quiet placeholder while thinking (the choice buttons sit above
 * it); on reveal the answer capsule flips in (rotateX −90° → 0, 240 ms) with the mix chips and the easy
 * reason clause (glossary terms tappable). Only the reason is shown — the verdict half of the one-liner repeats
 * the capsule, and on ≤ 740 px-tall phones the line is clamped to one row, so the reason must come first.
 */
export function AnswerSlot({ step, phase, explanation, showMix, animKey, hint }: { step: Step; phase: Phase; explanation: Explanation; showMix: boolean; animKey: string; hint?: string }) {
  const kind = step.scenario.kind;
  if (phase === 'think') {
    return (
      <div className="trainer-answer trainer-answer--idle glass-clear" aria-live="polite">
        <div className="trainer-answer__idle t-footnote">{hint ?? '고르면 정답과 해설이 나와요'}</div>
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
        <p className={`trainer-answer__reason t-footnote${hasMix ? ' trainer-answer__reason--tight' : ''}`}>
          <PlainText text={explanation.easy.reason} />
        </p>
      </div>
    </div>
  );
}
