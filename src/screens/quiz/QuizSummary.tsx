import { useMemo, useState } from 'react';
import { ActionBadge } from '../../components/ActionBadge';
import { ExplanationBody } from '../../components/ExplanationSheet';
import { HandView } from '../../components/PlayingCard';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { SessionSummaryCard, type SummaryData, type SummaryRow } from '../../components/ui/SessionSummaryCard';
import { Sheet } from '../../components/ui/Sheet';
import { toast } from '../../components/ui/Toast';
import { explainStep } from '../../poker/explain';
import { scenarioTitle } from '../../poker/scenarios';
import { launch, setTab } from '../../state/nav';
import { NO_CHARTS_HINT } from './DeckChips';
import { discardRound, startRound, type QuizQuestion, type QuizRound } from './roundStore';

const KIND_LABEL = { rfi: '오픈', vs_open: '오픈 대응', vs_3bet: '3벳 대응', vs_4bet: '4벳 대응', vs_5bet: '5벳 대응', cold_4bet: '콜드 4벳' } as const;

/** Row tap → sheet with 내 선택 vs 정답 above the full explanation (kept mounted for the exit slide). */
function MistakeSheet({ q, open, onClose }: { q: QuizQuestion | null; open: boolean; onClose(): void }) {
  const explanation = useMemo(() => (q ? explainStep(q.step) : null), [q]);
  if (!q || !explanation) return null;
  const kind = q.step.scenario.kind;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="half"
      title={scenarioTitle(q.step.scenario)}
      footer={
        <CapsuleButton tone="neutral" size="lg" block onClick={onClose}>
          닫기
        </CapsuleButton>
      }
    >
      <div className="quiz-msheet__top">
        <HandView cards={q.cards} size="sm" />
        <span className="quiz-msheet__hand tnum">{q.step.hand}</span>
        <span className="quiz-msheet__vs">
          내 선택
          {q.chosen && <ActionBadge action={q.chosen} kind={kind} size="sm" short />}
          → 정답
          <ActionBadge action={q.step.answer} kind={kind} size="sm" short />
        </span>
      </div>
      <ExplanationBody step={q.step} explanation={explanation} />
    </Sheet>
  );
}

/** Round summary (§5.7): `SessionSummaryCard` in quiz mode + the §1 round line; mistakes open a chosen-vs-answer sheet. */
export function QuizSummary({ round }: { round: QuizRound }) {
  const r = round.result;
  const [row, setRow] = useState<QuizQuestion | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!r) return null;

  const rows: SummaryRow[] = r.mistakes.map((q) => ({
    key: q.key,
    hand: q.step.hand,
    cards: q.cards,
    title: scenarioTitle(q.step.scenario),
    action: q.step.answer,
    kind: q.step.scenario.kind,
  }));

  const data: SummaryData = {
    mode: 'quiz',
    headline: r.headline,
    seen: r.seen,
    size: r.size,
    durationMs: r.durationMs,
    speedLabel: '퀴즈',
    rated: r.seen,
    known: r.correct + r.partialCount,
    unsure: r.wrong,
    byOrigin: r.byOrigin,
    goalToday: r.goalToday,
    goal: r.goal,
    goalReachedNow: r.goalReachedNow,
    streak: r.streak,
    streakIncremented: r.streakIncremented,
    weekDots: r.weekDots,
    unsureRows: rows,
    exposureOnly: false,
  };
  if (r.weakest) {
    data.weakest = { label: `${r.weakest.hero} · ${KIND_LABEL[r.weakest.kind]}`, unsure: r.weakest.unsure, shown: r.weakest.shown };
  }

  const known = r.correct + r.partialCount;
  const roundLine = [`${known}/${r.seen}`, `최고 연속 ${r.bestStreak}`, r.wrong ? `틀린 ${r.wrong}장은 헷갈려요로 표시했어요` : '다 맞혔어요'].join(' · ');

  const restart = (onlyKeys?: string[]) => {
    const res = startRound(onlyKeys ? { ...round.config, onlyKeys } : round.config);
    if (res !== 'ok') toast(res === 'no_charts' ? NO_CHARTS_HINT : '풀 문제가 없어요', 'amber');
  };
  const goHome = () => {
    discardRound();
    setTab('home');
  };
  const toTrain = () => {
    discardRound();
    launch({ target: 'train', onlyKeys: r.wrongKeys, autostart: true });
  };
  const openRow = (s: SummaryRow) => {
    const q = r.mistakes.find((m) => m.key === s.key) ?? null;
    if (!q) return;
    setRow(q);
    setSheetOpen(true);
  };

  return (
    <div className="screen quiz quiz--summary">
      <p className="quiz-roundline tnum">{roundLine}</p>
      <SessionSummaryCard
        data={data}
        onRetryUnsure={() => restart(r.wrongKeys)}
        onAgain={() => restart()}
        onHome={goHome}
        onTrain={r.wrongKeys.length ? toTrain : undefined}
        onOpenRow={openRow}
      />
      <MistakeSheet q={row} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
