import type { ReactNode } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { IconClose, IconPause, IconPlay } from '../../components/ui/icons';
import { ORIGIN_TAG, type Origin } from './decks';
import type { Outcome } from './SessionRibbon';
import type { Phase } from './sessionStore';

const MAX_DOTS = 20;

export interface SessionHudProps {
  index: number;
  total: number;
  /** Configured session size — dots stay stable while requeues lengthen the queue. */
  size: number;
  origin: Origin;
  phase: Phase;
  /** 순간기억 / 노출: no choosing, so the think tag reads "보기" instead of "고르기". */
  quiet: boolean;
  paused: boolean;
  holding: boolean;
  /** Per-queue-entry outcome, `undefined` until that card is revealed (Duo spec §0.2: dots painted by result). */
  results?: Array<Outcome | undefined>;
  /** Squat / land / tall / wide: the phase timer (number + 3 px line) lives inside the HUD. */
  timer?: ReactNode;
  onClose(): void;
  onTogglePause(): void;
}

const WORST: Outcome[] = ['wrong', 'partial', 'correct', 'neutral'];

/**
 * Dot classes for the HUD. The dot count stays at the configured size while chained steps and requeues
 * lengthen the queue, so each dot stands for a contiguous run of queue entries (1:1 when the queue fits).
 * A dot is painted with the worst outcome of its run once every card in it is revealed; the run holding
 * the current card shows a hollow ring.
 */
export function dotClasses(index: number, total: number, size: number, results?: Array<Outcome | undefined>): string[] {
  const n = Math.max(1, Math.min(size, total));
  const out: string[] = [];
  for (let d = 0; d < n; d++) {
    const lo = Math.floor((d * total) / n);
    const hi = Math.max(lo + 1, Math.floor(((d + 1) * total) / n));
    const run = results?.slice(lo, hi);
    if (run && run.length > 0 && run.every((o) => o !== undefined)) {
      const worst = WORST.find((w) => run.includes(w)) ?? 'neutral';
      out.push(`on on--${worst}`);
    } else if (!results && hi <= index) {
      out.push('on');
    } else if (index >= lo && index < hi) {
      out.push('now');
    } else {
      out.push(run?.some((o) => o !== undefined) ? 'on' : '');
    }
  }
  return out;
}

/**
 * Capsule HUD (§5.3): ✕ · progress dots (≤ 20; bar for 40) · counter · origin dot · phase tag (고르기 / 보기 / 해설 — 명령형 없이 명사 태그로 맞춥니다) · ‖/▶.
 * Text swaps while held / paused.
 */
export function SessionHud({ index, total, size, origin, phase, quiet, paused, holding, results, timer, onClose, onTogglePause }: SessionHudProps) {
  const useDots = size <= MAX_DOTS;
  const dots = useDots ? dotClasses(index, total, size, results) : [];
  const tag = ORIGIN_TAG[origin];
  const status = holding ? '일시정지 · 손을 떼면 계속' : paused ? '일시정지' : null;
  const phaseLabel = phase === 'reveal' ? '해설' : quiet ? '보기' : '고르기';
  return (
    <div className={`trainer-hud glass ui-r-capsule${status ? ' trainer-hud--status' : ''}${timer ? ' trainer-hud--timer' : ''}`} role="group" aria-label="세션 진행">
      <IconButton icon={<IconClose />} label="세션 끝내기" size={40} tone="ghost" onClick={onClose} className="trainer-hud__btn" />
      {status ? (
        <>
          <span className="trainer-hud__count tnum">
            {index + 1}/{total}
          </span>
          <span className="trainer-hud__status t-footnote">{status}</span>
        </>
      ) : (
        <>
          {useDots ? (
            <span className="trainer-hud__dots" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={total} aria-label={`${index + 1}번째 카드`}>
              {dots.map((c, i) => (
                <i key={i} className={c} />
              ))}
            </span>
          ) : (
            <span className="trainer-hud__bar" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={total} aria-label={`${index + 1}번째 카드`}>
              <i style={{ width: `${(index / Math.max(1, total)) * 100}%` }} />
            </span>
          )}
          <span className="trainer-hud__count tnum">
            {index + 1}/{total}
          </span>
          <span className="trainer-hud__tag t-caption" style={{ color: tag.color }} title={tag.label} aria-label={tag.label}>
            <i style={{ background: tag.color }} aria-hidden="true" />
            <span className="trainer-hud__tag-label">{tag.label}</span>
          </span>
          <span className={`trainer-hud__phase t-caption trainer-hud__phase--${phase === 'reveal' ? 'reveal' : quiet ? 'quiet' : 'think'}`} role="status">
            {phaseLabel}
          </span>
        </>
      )}
      {timer}
      <IconButton icon={paused ? <IconPlay /> : <IconPause />} label={paused ? '계속' : '일시정지'} size={40} tone="ghost" active={paused} onClick={onTogglePause} className="trainer-hud__btn" />
    </div>
  );
}
