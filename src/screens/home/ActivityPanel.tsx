import { useState } from 'react';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { Heatmap } from '../../components/ui/Heatmap';
import type { DayLog } from '../../state/progress';
import { dayLabel, pct } from './copy';

export interface ActivityPanelProps {
  days: Record<string, number>;
  goal: number;
  todayKey: string;
  totalCards: number;
  /** never trained → all --heat-0 + the empty copy in the footnote row */
  empty: boolean;
  /** DayLog for a tapped day (알아요 % in the tooltip row) */
  logFor(dayKey: string): DayLog;
}

/** "9월 3일 · 32장 · 알아요 81%" (알아요 only when something was rated that day). */
export function dayNote(key: string, log: DayLog): string {
  const parts = [dayLabel(key), `${log.cards}장`];
  if (log.rated > 0) parts.push(`알아요 ${pct(log.known / log.rated)}`);
  if (log.quiz > 0) parts.push(`퀴즈 ${log.quizCorrect}/${log.quiz}`);
  return parts.join(' · ');
}

/** §5.1 최근 12주: Heatmap + one reserved footnote row that shows the tapped day. */
export function ActivityPanel({ days, goal, todayKey, totalCards, empty, logFor }: ActivityPanelProps): JSX.Element {
  const [note, setNote] = useState('');
  const text = empty ? '첫 세션을 하면 여기가 채워져요' : note;
  return (
    <section className="home-section" aria-label="최근 활동">
      <header className="home-sec">
        <h2 className="t-title-3">최근 12주</h2>
        {totalCards > 0 && <span className="home-sec__aside tnum">총 {totalCards.toLocaleString('ko-KR')}회 노출</span>}
      </header>
      <GlassPanel as="div" className="home-activity">
        <Heatmap days={days} goal={goal} todayKey={todayKey} onSelect={empty ? undefined : (key) => setNote(dayNote(key, logFor(key)))} />
        <p className={`home-activity__note tnum${empty ? ' home-activity__note--empty' : ''}`} aria-live="polite">
          {text}
        </p>
      </GlassPanel>
    </section>
  );
}
