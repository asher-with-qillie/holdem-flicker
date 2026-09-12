import { useMemo, useState } from 'react';
import { ExplanationSheet } from '../../components/ExplanationSheet';
import { IconNext } from '../../components/ui/icons';
import { SessionSummaryCard, formatDuration, type SummaryData, type SummaryRow } from '../../components/ui/SessionSummaryCard';
import { Sheet } from '../../components/ui/Sheet';
import { explainStep } from '../../poker/explain';
import { dealCardsFor } from '../../poker/hands';
import { scenarioTitle } from '../../poker/scenarios';
import { launch } from '../../state/nav';
import type { SessionResult } from '../../state/progress';
import { SPEED_PRESETS } from '../../state/settings';
import { stepForKey } from '../../state/srs';
import { pct, spotLabel } from './copy';

export interface LastSessionProps {
  result: SessionResult;
  goal: number;
  todayCards: number;
  weekDots: boolean[];
}

function speedLabel(r: SessionResult): string {
  if (r.mode === 'quiz') return '퀴즈';
  const name = r.config.speed === 'custom' ? '사용자' : SPEED_PRESETS[r.config.speed].label;
  return r.config.exposure ? `노출 · ${name}` : name;
}

/** One-line row text: "20장 · 정답 80% · 2분 08초" (노출만 when nothing was rated). */
export function lastSessionText(r: SessionResult): string {
  const seen = r.mode === 'quiz' ? `퀴즈 ${r.seen}문제` : `${r.seen}장`;
  const acc = r.rated > 0 ? `정답 ${pct(r.known / r.rated)}` : '노출만';
  return `${seen} · ${acc} · ${formatDuration(r.activeMs)}`;
}

function unsureRows(keys: string[]): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const key of keys) {
    const step = stepForKey(key);
    if (!step) continue;
    rows.push({ key, hand: step.hand, cards: dealCardsFor(step.hand), title: scenarioTitle(step.scenario), action: step.answer, kind: step.scenario.kind });
  }
  return rows;
}

/** SessionResult (progress store) → SummaryData (store-agnostic card). */
export function toSummaryData(r: SessionResult, goal: number, todayCards: number, weekDots: boolean[], rows: SummaryRow[]): SummaryData {
  const partial = r.seen < r.config.size;
  const headline = partial ? `여기까지 ${r.seen}장` : r.mode === 'quiz' ? '퀴즈 끝!' : '세션 끝!';
  const data: SummaryData = {
    mode: r.mode,
    headline,
    seen: r.seen,
    size: r.config.size,
    durationMs: r.activeMs,
    speedLabel: speedLabel(r),
    rated: r.rated,
    known: r.known,
    unsure: r.unsure,
    byOrigin: r.byOrigin,
    goalToday: todayCards,
    goal,
    goalReachedNow: r.goalReachedNow,
    streak: r.streakAfter,
    streakIncremented: r.streakAfter > r.streakBefore,
    weekDots,
    unsureRows: rows,
    exposureOnly: r.exposureOnly,
  };
  if (r.weakest) data.weakest = { label: spotLabel(r.weakest.kind, r.weakest.hero), unsure: r.weakest.unsure, shown: r.weakest.shown };
  return data;
}

/** §5.1 지난 세션 row → reopens the last summary in a sheet (rows open the explanation sheet on top). */
export function LastSession({ result, goal, todayCards, weekDots }: LastSessionProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<SummaryRow | null>(null);
  // Suits are dealt once per result so the mini cards don't reshuffle on re-render.
  const rows = useMemo(() => unsureRows(result.unsureKeys), [result.id, result.unsureKeys]);
  const data = useMemo(() => toSummaryData(result, goal, todayCards, weekDots, rows), [result, goal, todayCards, weekDots, rows]);
  const step = row ? stepForKey(row.key) : null;

  const close = () => setOpen(false);
  const go = (fn: () => void) => {
    close();
    fn();
  };
  const unsureFirst = [...result.unsureKeys, ...result.allKeys.filter((k) => !result.unsureKeys.includes(k))];

  return (
    <>
      <button type="button" className="home-last" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="home-last__label">지난 세션</span>
        <span className="home-last__value tnum">{lastSessionText(result)}</span>
        <IconNext size={20} />
      </button>
      <Sheet open={open} onClose={close} title="지난 세션" detent="full">
        <SessionSummaryCard
          data={data}
          onRetryUnsure={() => go(() => launch({ target: 'train', onlyKeys: result.unsureKeys, autostart: true }))}
          onAgain={() => go(() => launch({ target: result.mode, deck: result.config.deck, positions: result.config.positions, autostart: true }))}
          onHome={close}
          onQuiz={result.mode === 'train' ? () => go(() => launch({ target: 'quiz', onlyKeys: unsureFirst, autostart: true })) : undefined}
          onTrain={result.mode === 'quiz' ? () => go(() => launch({ target: 'train', onlyKeys: unsureFirst, autostart: true })) : undefined}
          onOpenRow={setRow}
        />
      </Sheet>
      {row && step && <ExplanationSheet step={step} explanation={explainStep(step)} onClose={() => setRow(null)} />}
    </>
  );
}
