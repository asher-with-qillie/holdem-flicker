import type { HandName } from '../../poker/types';
import type { Grade } from '../quiz/grade';
import '../../styles/trainer.css';

export type Outcome = Grade | 'neutral';

export interface RibbonItem {
  key: string | number;
  hand: HandName;
  outcome: Outcome;
}

const MARK: Record<Outcome, string> = { correct: '✓', partial: '△', wrong: '✕', neutral: '·' };
const WORD: Record<Outcome, string> = { correct: '정답', partial: '부분 정답', wrong: '오답', neutral: '본 카드' };

/** Outcome of a session card for the ribbon / HUD dots: a choice's grade, otherwise neutral (노출 · 시간 초과 · 엿보기). */
export function cardOutcome(c: { grade?: Grade; chosenAction?: unknown; peeked?: boolean; timedOut?: boolean }): Outcome {
  if (!c.chosenAction || c.peeked || c.timedOut || !c.grade) return 'neutral';
  return c.grade;
}

/**
 * R — the cards already played this session, newest first: `AQo ✓ · 76s ✕ · A5s △` chips (12 px) plus one tally line.
 * Horizontal in the slack band / the tall core row, vertical in the wide companion column. Purely informational.
 */
export function SessionRibbon({ items, vertical, className }: { items: RibbonItem[]; vertical?: boolean; className?: string }): JSX.Element | null {
  const tally = { correct: 0, partial: 0, wrong: 0 };
  for (const it of items) if (it.outcome !== 'neutral') tally[it.outcome] += 1;
  const graded = tally.correct + tally.partial + tally.wrong;
  const cls = ['ribbon', vertical ? 'ribbon--v' : 'ribbon--h', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} aria-label="지난 카드">
      <ol className="ribbon__list">
        {items.length === 0 && <li className="ribbon__empty t-caption">지난 카드가 여기 쌓여요</li>}
        {items.map((it) => (
          <li key={it.key} className={`ribbon__chip ribbon__chip--${it.outcome}`} aria-label={`${it.hand} ${WORD[it.outcome]}`}>
            <span className="ribbon__hand">{it.hand}</span>
            <span className="ribbon__mark" aria-hidden="true">
              {MARK[it.outcome]}
            </span>
          </li>
        ))}
      </ol>
      {graded > 0 && (
        <p className="ribbon__tally t-caption tnum">
          {vertical ? (
            <>
              <span className="ribbon__t ribbon__t--correct">✓{tally.correct}</span>
              <span className="ribbon__t ribbon__t--partial">△{tally.partial}</span>
              <span className="ribbon__t ribbon__t--wrong">✕{tally.wrong}</span>
            </>
          ) : (
            <>
              정답 {tally.correct} · 부분 {tally.partial} · 오답 {tally.wrong}
            </>
          )}
        </p>
      )}
    </div>
  );
}
