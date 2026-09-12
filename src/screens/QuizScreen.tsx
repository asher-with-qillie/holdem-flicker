import { useEffect, useMemo } from 'react';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { IconPlay } from '../components/ui/icons';
import { toast } from '../components/ui/Toast';
import { feasiblePositions } from '../poker/trainer';
import type { Pos } from '../poker/types';
import { consumeLaunch, setChromeHidden, useNav } from '../state/nav';
import { getSettings, updateSettings, useSettings, type DeckId, type Settings } from '../state/settings';
import { useSrs, weakKeys } from '../state/srs';
import { useStats } from '../state/stats';
import { DeckChips, NO_CHARTS_HINT, PositionChips, WEAK_LOCKED_HINT, WEAK_MIN, resolvePositions } from './quiz/DeckChips';
import { MistakeList } from './quiz/MistakeList';
import { QuizHeader } from './quiz/QuizHeader';
import { QuizRoundView } from './quiz/QuizRound';
import { QuizSummary } from './quiz/QuizSummary';
import { quizOptions, startRound, useQuizRound, type StartResult } from './quiz/roundStore';
import '../styles/quiz.css';

function startToast(res: StartResult) {
  if (res === 'ok') return;
  toast(res === 'no_charts' ? NO_CHARTS_HINT : '풀 문제가 없어요', 'amber');
}

/** Idle state (§5.7): title + stat pills, deck / position chips shared with the trainer via settings, 10문제 시작, 최근 실수. */
function QuizIdle() {
  const [settings, update] = useSettings();
  const stats = useStats();
  const srsVersion = useSrs();

  const deck = settings.lastDeck;
  const positions = resolvePositions(settings.lastPositions, settings.positions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weakCount = useMemo(() => weakKeys().length, [srsVersion]);
  const feasible = feasiblePositions(quizOptions({ deck, positions })).length > 0;
  const weakLocked = deck === 'weak' && weakCount < WEAK_MIN;
  const reason = weakLocked ? WEAK_LOCKED_HINT : !feasible ? NO_CHARTS_HINT : null;

  const setDeck = (d: DeckId) => update({ lastDeck: d === 'scenario' ? 'all' : d });
  const setPositions = (p: Pos[]) => update({ lastPositions: p.length === settings.positions.length ? null : p });

  return (
    <div className="screen quiz quiz--idle">
      <QuizHeader stats={stats} />
      <p className="quiz-sub">10문제씩 풀어요. 틀린 카드는 복습으로 돌아가요</p>

      <section className="quiz-group">
        <h2 className="quiz-label t-caption">덱</h2>
        <DeckChips value={deck} onChange={setDeck} weakCount={weakCount} />
      </section>
      <section className="quiz-group">
        <h2 className="quiz-label t-caption">포지션</h2>
        <PositionChips value={positions} all={settings.positions} onChange={setPositions} />
      </section>

      <div className="quiz-start">
        <CapsuleButton tone="primary" size="xl" block icon={<IconPlay />} disabled={reason !== null} onClick={() => startToast(startRound({ deck, positions }))}>
          10문제 시작
        </CapsuleButton>
        {reason && <p className="quiz-start__reason">{reason}</p>}
      </div>

      <MistakeList mistakes={stats.mistakes} />
    </div>
  );
}

export function QuizScreen() {
  const round = useQuizRound();
  const { launch: pendingLaunch } = useNav();
  const active = round?.status === 'running';

  // Tab bar hidden while a round runs (§3); always released on unmount.
  useEffect(() => {
    setChromeHidden('quiz', active);
    return () => setChromeHidden('quiz', false);
  }, [active]);

  // LaunchIntent (§3): deck / positions pre-select; onlyKeys (퀴즈로 확인) or autostart begin a round at once.
  // Runs on mount and whenever a new intent lands while this tab is already showing.
  useEffect(() => {
    if (!pendingLaunch) return;
    const intent = consumeLaunch();
    if (!intent || intent.target !== 'quiz') return;
    const patch: Partial<Settings> = {};
    if (intent.deck && intent.deck !== 'scenario') patch.lastDeck = intent.deck;
    if (intent.positions?.length) patch.lastPositions = intent.positions;
    if (Object.keys(patch).length) updateSettings(patch);
    if (!intent.onlyKeys?.length && !intent.autostart) return;
    const s = getSettings();
    const config = {
      deck: intent.deck === 'scenario' && intent.scenarioId ? ('scenario' as const) : s.lastDeck,
      positions: resolvePositions(s.lastPositions, s.positions),
      ...(intent.scenarioId ? { scenarioId: intent.scenarioId } : {}),
      ...(intent.onlyKeys?.length ? { onlyKeys: intent.onlyKeys } : {}),
    };
    startToast(startRound(config));
  }, [pendingLaunch]);

  if (round?.status === 'running') return <QuizRoundView round={round} />;
  if (round?.status === 'summary') return <QuizSummary round={round} />;
  return <QuizIdle />;
}
