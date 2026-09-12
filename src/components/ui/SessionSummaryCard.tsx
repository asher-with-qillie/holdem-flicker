import { useState } from 'react';
import type { Action, Card, ScenarioKind } from '../../poker/types';
import { ActionBadge } from '../ActionBadge';
import { HandView } from '../PlayingCard';
import { CapsuleButton } from './CapsuleButton';
import { Chip } from './Chip';
import { GlassPanel } from './GlassPanel';
import { IconFlame } from './icons';
import { ProgressRing } from './ProgressRing';

export interface SummaryRow {
  key: string;
  hand: string;
  cards: [Card, Card];
  title: string;
  action: Action;
  kind: ScenarioKind;
}

export interface SummaryData {
  mode: 'train' | 'quiz';
  headline: string; // "세션 끝!" | "여기까지 8장" | "퀴즈 끝!"
  seen: number;
  size: number;
  durationMs: number;
  speedLabel: string; // "보통" | "순간기억" | "노출 · 보통" | "퀴즈"
  rated: number;
  known: number;
  unsure: number; // quiz: rated = answered, known = correct(+partial), unsure = wrong
  byOrigin: { new: number; review: number; unsure: number };
  goalToday: number;
  goal: number;
  goalReachedNow: boolean;
  streak: number;
  streakIncremented: boolean;
  weekDots: boolean[]; // 7 entries, 월…일, goal reached
  weakest?: { label: string /* "SB · 오픈 대응" */; unsure: number; shown: number; quizAcc?: number };
  unsureRows: SummaryRow[];
  exposureOnly: boolean; // 순간기억/노출: hide ring %, show "노출 {seen}장 · 평가 없음"
  firstSession?: boolean; // shows the speed feedback chips
  levelUp?: string; // "레귤러 됐어요" one line in the streak card
}

export interface SessionSummaryCardProps {
  data: SummaryData;
  onRetryUnsure(): void;
  onAgain(): void;
  onHome(): void;
  onQuiz?(): void; // "퀴즈로 확인" (trainer only); quiz summary passes onTrain instead
  onTrain?(): void; // "훈련으로 복습" (quiz only)
  onOpenRow?(row: SummaryRow): void; // opens ExplanationSheet
  onSpeedFeedback?(v: 'slower' | 'ok' | 'faster'): void;
}

const MAX_ROWS = 6;
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}

/** End-of-session card (trainer + quiz). Store-agnostic: the caller maps its result into `SummaryData`. */
export function SessionSummaryCard({ data: d, onRetryUnsure, onAgain, onHome, onQuiz, onTrain, onOpenRow, onSpeedFeedback }: SessionSummaryCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<'slower' | 'ok' | 'faster' | null>(null);

  const pct = d.rated > 0 ? Math.round((d.known / d.rated) * 100) : 0;
  const unsureCount = d.unsureRows.length || d.unsure;
  const hasUnsure = unsureCount > 0;
  const rows = expanded ? d.unsureRows : d.unsureRows.slice(0, MAX_ROWS);
  const hiddenRows = d.unsureRows.length - rows.length;
  const weekDone = d.weekDots.filter(Boolean).length;
  const secondary = d.mode === 'quiz' ? (onTrain ? { label: '훈련으로 복습', fn: onTrain } : null) : onQuiz ? { label: '퀴즈로 확인', fn: onQuiz } : null;

  const pickFeedback = (v: 'slower' | 'ok' | 'faster') => {
    setFeedback(v);
    onSpeedFeedback?.(v);
  };

  return (
    <GlassPanel radius="xl" padding={16} className="ui-summary" as="section" aria-label={d.headline}>
      <h2 className="ui-summary__headline t-title-1">{d.headline}</h2>
      <p className="ui-summary__meta tnum">
        {d.seen}장 · {formatDuration(d.durationMs)} · {d.speedLabel}
      </p>

      <div className="ui-summary__ring">
        {d.exposureOnly ? (
          <p className="ui-summary__expose t-title-3">노출 {d.seen}장 · 평가 없음</p>
        ) : (
          <>
            <ProgressRing
              value={d.known}
              max={Math.max(1, d.rated)}
              size={120}
              stroke={10}
              tint={d.goalReachedNow ? 'var(--gold)' : 'var(--mint)'}
              celebrate={d.goalReachedNow}
              label={
                <span className="ui-summary__ringnum tnum">
                  {d.known}/{d.rated}
                </span>
              }
            />
            <p className="ui-summary__ringcap">{d.rated > 0 ? `알아요 ${pct}%` : '평가 없음'}</p>
          </>
        )}
      </div>

      <div className="ui-summary__origins" aria-label="카드 구성">
        <span className="ui-summary__origin fill">
          <i style={{ background: 'var(--lilac)' }} /> 새 카드 {d.byOrigin.new}
        </span>
        <span className="ui-summary__origin fill">
          <i style={{ background: 'var(--sky)' }} /> 복습 {d.byOrigin.review}
        </span>
        <span className="ui-summary__origin fill">
          <i style={{ background: 'var(--amber)' }} /> 헷갈려요 {d.byOrigin.unsure}
        </span>
      </div>

      <GlassPanel variant="tint" tint="var(--gold)" radius="sm" padding={12} className="ui-summary__streak glass-flat">
        <div className="ui-summary__streak-row">
          <span className={`ui-summary__flame${d.streakIncremented ? ' ui-summary__flame--pulse' : ''}`}>
            <IconFlame size={20} />
            <b className="tnum">{d.streak}일째</b>
            {d.streakIncremented && <em className="tnum">(+1)</em>}
          </span>
          <span className={`ui-summary__goal tnum${d.goalReachedNow || d.goalToday >= d.goal ? ' ui-summary__goal--done' : ''}`}>
            오늘 목표 {Math.min(d.goalToday, d.goal)}/{d.goal}
            {(d.goalReachedNow || d.goalToday >= d.goal) && ' ✓'}
          </span>
        </div>
        <div className="ui-summary__week">
          <span className="ui-summary__dots" aria-label={`이번 주 ${weekDone}/7`}>
            {d.weekDots.map((on, i) => (
              <i key={i} className={on ? 'on' : ''} title={WEEKDAYS[i]} />
            ))}
          </span>
          <span className="tnum">이번 주 {weekDone}/7</span>
        </div>
        {d.levelUp && <p className="ui-summary__levelup">{d.levelUp}</p>}
      </GlassPanel>

      {d.weakest && (
        <section className="ui-summary__section">
          <h3 className="t-title-3">이번 세션 약점</h3>
          <button type="button" className="ui-summary__weak fill" onClick={onRetryUnsure}>
            <span className="ui-summary__weak-label">{d.weakest.label}</span>
            <span className="ui-summary__weak-stat tnum">
              헷갈려요 {d.weakest.unsure}/{d.weakest.shown}
              {d.weakest.quizAcc !== undefined && ` · 퀴즈 ${Math.round(d.weakest.quizAcc)}%`}
            </span>
            <span className="ui-summary__chev" aria-hidden="true">
              ▸
            </span>
          </button>
        </section>
      )}

      {d.unsureRows.length > 0 ? (
        <section className="ui-summary__section">
          <h3 className="t-title-3">헷갈린 카드 {d.unsureRows.length}</h3>
          <ul className="ui-summary__rows">
            {rows.map((row) => (
              <li key={row.key}>
                <button type="button" className="ui-summary__row" onClick={onOpenRow ? () => onOpenRow(row) : undefined} disabled={!onOpenRow}>
                  <span className="ui-summary__cards" aria-hidden="true">
                    <HandView cards={row.cards} size="sm" />
                  </span>
                  <span className="ui-summary__hand tnum">{row.hand}</span>
                  <span className="ui-summary__title">{row.title}</span>
                  <ActionBadge action={row.action} kind={row.kind} size="sm" short />
                </button>
              </li>
            ))}
          </ul>
          {hiddenRows > 0 && (
            <button type="button" className="ui-summary__more" onClick={() => setExpanded(true)}>
              … {hiddenRows}개 더
            </button>
          )}
        </section>
      ) : (
        !d.exposureOnly && d.rated > 0 && <p className="ui-summary__allknown">다 알고 있었네요. 다음엔 새 카드를 더 섞을게요</p>
      )}

      {d.firstSession && onSpeedFeedback && (
        <div className="ui-summary__speed" role="group" aria-label="속도 어땠어요?">
          <span className="ui-summary__speed-q">속도 어땠어요?</span>
          <span className="ui-summary__speed-chips">
          <Chip size={32} selected={feedback === 'slower'} onClick={() => pickFeedback('slower')}>
            천천히
          </Chip>
          <Chip size={32} selected={feedback === 'ok'} onClick={() => pickFeedback('ok')}>
            딱 좋아요
          </Chip>
          <Chip size={32} selected={feedback === 'faster'} onClick={() => pickFeedback('faster')}>
            더 빠르게
          </Chip>
          </span>
        </div>
      )}

      <div className="ui-summary__ctas">
        {hasUnsure && (
          <CapsuleButton tone="primary" size="xl" block onClick={onRetryUnsure}>
            헷갈린 것만 다시 · {unsureCount}장
          </CapsuleButton>
        )}
        <div className="ui-summary__cta-row">
          <CapsuleButton tone={hasUnsure ? 'neutral' : 'primary'} size="lg" onClick={onAgain}>
            한 번 더
          </CapsuleButton>
          {secondary && (
            <CapsuleButton tone="neutral" size="lg" onClick={secondary.fn}>
              {secondary.label}
            </CapsuleButton>
          )}
        </div>
        <CapsuleButton tone="ghost" size="md" onClick={onHome}>
          홈으로
        </CapsuleButton>
      </div>
    </GlassPanel>
  );
}
