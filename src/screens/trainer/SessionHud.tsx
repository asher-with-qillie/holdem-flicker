import { IconButton } from '../../components/ui/IconButton';
import { IconClose, IconPause, IconPlay } from '../../components/ui/icons';
import { ORIGIN_TAG, type Origin } from './decks';
import type { Phase } from './sessionStore';

const MAX_DOTS = 20;

export interface SessionHudProps {
  index: number;
  total: number;
  /** Configured session size — dots stay stable while requeues lengthen the queue. */
  size: number;
  origin: Origin;
  phase: Phase;
  /** 순간기억 / 노출: no choosing, so the think tag reads "보기" instead of "선택하세요". */
  quiet: boolean;
  paused: boolean;
  holding: boolean;
  onClose(): void;
  onTogglePause(): void;
}

/**
 * Capsule HUD (§5.3): ✕ · progress dots (≤ 20; bar for 40) · counter · origin dot · phase tag (선택하세요 / 보기 / 해설) · ‖/▶.
 * Text swaps while held / paused.
 */
export function SessionHud({ index, total, size, origin, phase, quiet, paused, holding, onClose, onTogglePause }: SessionHudProps) {
  const useDots = size <= MAX_DOTS;
  const done = Math.min(size, Math.round((index / Math.max(1, total)) * size));
  const tag = ORIGIN_TAG[origin];
  const status = holding ? '일시정지 · 손을 떼면 계속' : paused ? '일시정지' : null;
  const phaseLabel = phase === 'reveal' ? '해설' : quiet ? '보기' : '선택하세요';
  return (
    <div className={`trainer-hud glass ui-r-capsule${status ? ' trainer-hud--status' : ''}`} role="group" aria-label="세션 진행">
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
              {Array.from({ length: size }, (_, i) => (
                <i key={i} className={i < done ? 'on' : ''} />
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
      <IconButton icon={paused ? <IconPlay /> : <IconPause />} label={paused ? '계속' : '일시정지'} size={40} tone="ghost" active={paused} onClick={onTogglePause} className="trainer-hud__btn" />
    </div>
  );
}
