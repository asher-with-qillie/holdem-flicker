import { useMemo, useState } from 'react';
import { ExplanationSheet } from '../../components/ExplanationSheet';
import { SessionSummaryCard, type SummaryData, type SummaryRow } from '../../components/ui/SessionSummaryCard';
import { toast } from '../../components/ui/Toast';
import { explainStep, suitOrientation } from '../../poker/explain';
import { dealCardsFor } from '../../poker/hands';
import type { Step } from '../../poker/trainer';
import { getProgress, type ProgressView, type SessionResult } from '../../state/progress';
import { applySpeedPreset, SPEED_PRESET_ORDER, type Settings } from '../../state/settings';
import { stepForKey, weakSpots } from '../../state/srs';
import { KIND_SHORT, speedLabel } from './decks';

function rowTitle(step: Step): string {
  const s = step.scenario;
  return `${s.hero} · ${s.villain ? `${s.villain} ` : ''}${KIND_SHORT[s.kind]}`;
}

/** SessionResult → the store-agnostic SummaryData the card renders (§5.6). */
export function toSummaryData(r: SessionResult, pv: ProgressView, goal: number, opts: { partial: boolean; firstSession: boolean }): SummaryData {
  const rows: SummaryRow[] = [];
  for (const key of r.unsureKeys) {
    const step = stepForKey(key);
    if (!step) continue;
    rows.push({ key, hand: step.hand, cards: dealCardsFor(step.hand), title: rowTitle(step), action: step.answer, kind: step.scenario.kind });
  }
  const data: SummaryData = {
    mode: 'train',
    headline: opts.partial ? `여기까지 ${r.seen}장` : '세션 끝!',
    seen: r.seen,
    size: r.config.size,
    durationMs: r.activeMs,
    speedLabel: speedLabel(r.config.speed, r.config.exposure),
    rated: r.rated,
    known: r.known,
    unsure: r.unsure,
    byOrigin: r.byOrigin,
    goalToday: pv.today.cards,
    goal,
    goalReachedNow: r.goalReachedNow,
    streak: pv.streak,
    streakIncremented: r.streakAfter > r.streakBefore,
    weekDots: pv.weekDots,
    unsureRows: rows,
    exposureOnly: r.exposureOnly,
  };
  if (opts.firstSession) data.firstSession = true;
  if (r.weakest) {
    const w = r.weakest;
    const spot = weakSpots(50).find((x) => x.kind === w.kind && x.hero === w.hero);
    data.weakest = { label: `${w.hero} · ${KIND_SHORT[w.kind]}`, unsure: w.unsure, shown: w.shown, ...(spot?.quizAcc !== undefined ? { quizAcc: spot.quizAcc * 100 } : {}) };
  }
  return data;
}

export interface SummaryViewProps {
  result: SessionResult;
  partial: boolean;
  settings: Settings;
  onRetryUnsure(keys: string[]): void;
  onAgain(): void;
  onQuiz(keys: string[]): void;
  onHome(): void;
}

export function SummaryView({ result, partial, settings, onRetryUnsure, onAgain, onQuiz, onHome }: SummaryViewProps) {
  const [row, setRow] = useState<SummaryRow | null>(null);
  // Snapshot once: the ring / streak must not re-animate when unrelated stores tick.
  const data = useMemo(() => {
    const pv = getProgress(settings.dailyGoal);
    const firstSession = pv.activeDays <= 1 && pv.today.sessions <= 1 && pv.totalCards === pv.today.cards;
    return toSummaryData(result, pv, settings.dailyGoal, { partial, firstSession });
  }, [result, partial, settings.dailyGoal]);

  const rowStep = useMemo(() => (row ? stepForKey(row.key) : null), [row]);
  const rowExplanation = useMemo(
    () => (rowStep && row ? explainStep(rowStep, suitOrientation(row.cards)) : null),
    [rowStep, row],
  );

  const onSpeedFeedback = (v: 'slower' | 'ok' | 'faster') => {
    if (v === 'ok') return;
    const cur = settings.speedPreset === 'custom' ? 'normal' : settings.speedPreset;
    const i = SPEED_PRESET_ORDER.indexOf(cur);
    const next = SPEED_PRESET_ORDER[v === 'slower' ? Math.max(0, i - 1) : Math.min(SPEED_PRESET_ORDER.length - 1, i + 1)];
    if (next === settings.speedPreset) return;
    applySpeedPreset(next);
    toast('속도를 바꿨어요', 'mint');
  };

  return (
    <div className="trainer-summary">
      <SessionSummaryCard
        data={data}
        onRetryUnsure={() => onRetryUnsure(result.unsureKeys)}
        onAgain={onAgain}
        onHome={onHome}
        onQuiz={() => onQuiz(result.allKeys)}
        onOpenRow={setRow}
        onSpeedFeedback={data.firstSession ? onSpeedFeedback : undefined}
      />
      {rowStep && rowExplanation && <ExplanationSheet step={rowStep} explanation={rowExplanation} onClose={() => setRow(null)} />}
    </div>
  );
}
