import { useState } from 'react';
import { CapsuleButton } from './CapsuleButton';

export interface RatingBarProps {
  onRate(r: 'know' | 'unsure'): void;
  disabled?: boolean;
  knowDisabled?: boolean; // peeked rule: 알아요 dimmed + footnote below
  knowDisabledHint?: string;
  compact?: boolean; // 44 high instead of 56
  pulseOnce?: boolean; // first reveal of a fresh install: one spring pulse
}

/** 헷갈려요 (amber, 42 %) · 알아요 (mint, 58 %) capsules, 56 high, gap 12. Announces the rating in a live region. */
export function RatingBar({ onRate, disabled, knowDisabled, knowDisabledHint, compact, pulseOnce }: RatingBarProps): JSX.Element {
  const [announce, setAnnounce] = useState('');
  const rate = (r: 'know' | 'unsure') => {
    setAnnounce(r === 'know' ? '알아요로 표시' : '헷갈려요로 표시');
    onRate(r);
  };
  return (
    <div className={`ui-rating${compact ? ' ui-rating--compact' : ''}${pulseOnce ? ' ui-rating--pulse' : ''}`} role="group" aria-label="카드 평가">
      <div className="ui-rating__buttons">
        <CapsuleButton tone="unsure" size={compact ? 'md' : 'xl'} className="ui-rating__unsure" disabled={disabled} onClick={() => rate('unsure')}>
          헷갈려요
        </CapsuleButton>
        <CapsuleButton
          tone="know"
          size={compact ? 'md' : 'xl'}
          className={`ui-rating__know${knowDisabled ? ' ui-rating__know--dim' : ''}`}
          disabled={disabled || knowDisabled}
          aria-describedby={knowDisabled && knowDisabledHint ? 'ui-rating-hint' : undefined}
          onClick={() => rate('know')}
        >
          알아요
        </CapsuleButton>
      </div>
      {knowDisabled && knowDisabledHint && (
        <p id="ui-rating-hint" className="ui-rating__hint">
          {knowDisabledHint}
        </p>
      )}
      <span className="ui-sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
