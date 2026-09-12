import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionBadge, actionLabel } from '../components/ActionBadge';
import { ExplanationSheet } from '../components/ExplanationSheet';
import { HandView } from '../components/PlayingCard';
import { TableDiagram } from '../components/TableDiagram';
import { explainStep } from '../poker/explain';
import { cardLabel, dealCardsFor } from '../poker/hands';
import { scenarioKey, scenarioSituation, scenarioTitle } from '../poker/scenarios';
import { randomQuizStep, type SessionOptions, type Step } from '../poker/trainer';
import { SCENARIO_ACTIONS, type Action, type Card } from '../poker/types';
import { useSettings, vibrate } from '../state/settings';
import { recordAnswer, useStats } from '../state/stats';
import { actionWeight, gradeAnswer, GRADE_LABEL_KO, type Grade } from './quiz/grade';
import { firstSentence, pct } from './quiz/format';
import { MistakeList } from './quiz/MistakeList';
import { QuizHeader } from './quiz/QuizHeader';
import '../styles/quiz.css';

const AUTO_ADVANCE_MS = 1500;

interface Round {
  step: Step;
  /** Dealt once per round so the suits don't reshuffle on re-render. */
  cards: [Card, Card];
}

function draw(opts: SessionOptions): Round | null {
  try {
    const step = randomQuizStep(opts);
    return { step, cards: dealCardsFor(step.hand) };
  } catch {
    return null;
  }
}

const MARK: Record<Grade, string> = { correct: '✓', partial: '△', wrong: '✕' };

export function QuizScreen() {
  const [settings] = useSettings();
  const stats = useStats();

  const posKey = settings.positions.join(',');
  const kindKey = settings.kinds.join(',');
  const opts = useMemo<SessionOptions>(
    () => ({ positions: settings.positions, kinds: settings.kinds, interestingBias: settings.interestingBias }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posKey, kindKey, settings.interestingBias],
  );

  const [round, setRound] = useState<Round | null>(() => draw(opts));
  const [chosen, setChosen] = useState<Action | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Opening the explanation cancels auto-advance for the current round. */
  const [autoCancelled, setAutoCancelled] = useState(false);

  const next = useCallback(() => {
    setRound(draw(opts));
    setChosen(null);
    setGrade(null);
    setSheetOpen(false);
    setAutoCancelled(false);
  }, [opts]);

  // Settings changed while mounted → start over with the new pool (skips the initial mount).
  const [seenOpts, setSeenOpts] = useState(opts);
  useEffect(() => {
    if (seenOpts !== opts) {
      setSeenOpts(opts);
      next();
    }
  }, [opts, seenOpts, next]);

  // Auto-advance 1.5s after an exact correct answer.
  useEffect(() => {
    if (grade !== 'correct' || !settings.autoAdvance || sheetOpen || autoCancelled) return;
    const t = window.setTimeout(next, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [grade, settings.autoAdvance, sheetOpen, autoCancelled, next]);

  const explanation = useMemo(() => (round ? explainStep(round.step) : null), [round]);

  const answer = (action: Action) => {
    if (!round || grade) return;
    const { step } = round;
    const g = gradeAnswer(step, action);
    setChosen(action);
    setGrade(g);
    vibrate(g === 'wrong' ? [30, 40, 30] : 12);
    const s = step.scenario;
    recordAnswer(
      s.kind,
      g !== 'wrong',
      g === 'wrong' ? { scenarioId: scenarioKey(s), title: scenarioTitle(s), hand: step.hand, answer: step.answer, chosen: action } : undefined,
    );
  };

  const openSheet = () => {
    setAutoCancelled(true);
    setSheetOpen(true);
  };

  if (!round) {
    return (
      <div className="screen quiz">
        <QuizHeader stats={stats} />
        <div className="panel quiz-empty">
          <strong>출제할 차트가 없습니다</strong>
          <p className="screen__sub">설정에서 포지션과 상황 종류를 확인해 주세요.</p>
        </div>
        <MistakeList mistakes={stats.mistakes} />
      </div>
    );
  }

  const { step, cards } = round;
  const { scenario } = step;
  const kind = scenario.kind;
  const actions = SCENARIO_ACTIONS[kind];
  const tableProps = { scenario, compact: true };
  const autoPending = grade === 'correct' && settings.autoAdvance && !autoCancelled;
  const showMix = settings.showMixFrequencies && step.mixList.length > 1;
  const kindStat = stats.byKind[kind];
  const kindLine = kindStat?.attempts ? `이 유형 정답률 ${Math.round((kindStat.correct / kindStat.attempts) * 100)}% · ${kindStat.attempts}문제` : '이 유형의 첫 문제입니다';
  // scenarioTitle() starts with "HERO · " for rfi/vs_open — the gold pill already says that.
  const title = scenarioTitle(scenario).replace(new RegExp(`^${scenario.hero} · `), '');

  let verdict = '';
  if (grade === 'correct') verdict = '정답입니다!';
  else if (grade === 'partial' && chosen) verdict = `${GRADE_LABEL_KO.partial} · ${actionLabel(chosen, kind, true)}도 ${pct(actionWeight(step, chosen))}`;
  else if (grade === 'wrong' && chosen) verdict = `${GRADE_LABEL_KO.wrong} · 내 선택: ${actionLabel(chosen, kind, true)}`;

  return (
    <div className="screen quiz">
      <QuizHeader stats={stats} />

      <TableDiagram {...tableProps} />

      <div className="quiz-situation">
        <div className="quiz-situation__meta">
          <span className="quiz-pill">{scenario.hero}</span>
          <span className="quiz-situation__title">{title}</span>
        </div>
        <p className="quiz-situation__text">{scenarioSituation(scenario)}</p>
      </div>

      <div className="quiz-hand">
        <HandView cards={cards} size="md" />
        <div className="quiz-hand__label">
          {cardLabel(cards[0])} {cardLabel(cards[1])} · {step.hand}
        </div>
      </div>

      <div className="quiz-answers" role="group" aria-label="액션 선택">
        {actions.map((a) => {
          const isChosen = chosen === a;
          const isAnswer = grade !== null && step.answer === a;
          const cls = [
            'quiz-answer',
            `quiz-answer--${a}`,
            grade ? 'quiz-answer--done' : '',
            isChosen && grade ? `quiz-answer--chosen quiz-answer--${grade}` : '',
            isAnswer ? 'quiz-answer--answer' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const mark = isChosen && grade ? MARK[grade] : isAnswer ? MARK.correct : '';
          return (
            <button key={a} type="button" className={cls} onClick={() => answer(a)} disabled={grade !== null} aria-pressed={isChosen}>
              {mark && (
                <span className="quiz-answer__mark" aria-hidden="true">
                  {mark}
                </span>
              )}
              {actionLabel(a, kind)}
            </button>
          );
        })}
      </div>

      <div className={`quiz-reveal quiz-reveal--${grade ?? 'idle'}`} aria-live="polite">
        {grade ? (
          <>
            <div className="quiz-reveal__top">
              <ActionBadge action={step.answer} kind={kind} size="lg" />
              <span className="quiz-reveal__verdict">{verdict}</span>
            </div>
            {showMix && (
              <div className="quiz-mix" aria-label="혼합 빈도">
                {step.mixList.map((m) => (
                  <span key={m.action} className="quiz-mix__chip">
                    <span className="quiz-mix__dot" style={{ background: `var(--act-${m.action})` }} />
                    {actionLabel(m.action, kind, true)} {pct(m.weight)}
                  </span>
                ))}
              </div>
            )}
            {explanation && <p className="quiz-reveal__reason">{firstSentence(explanation.reasoning[0] ?? '')}</p>}
          </>
        ) : (
          <>
            <p className="quiz-reveal__hint">이 핸드로 어떻게 하시겠습니까?</p>
            <p className="quiz-reveal__kind">{kindLine}</p>
          </>
        )}
      </div>

      <div className="quiz-actions">
        {grade ? (
          <>
            <button type="button" className="btn" onClick={openSheet}>
              해설
            </button>
            <button type="button" className={`btn btn--primary quiz-actions__next${autoPending ? ' quiz-actions__next--auto' : ''}`} onClick={next}>
              다음
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={next}>
            건너뛰기
          </button>
        )}
      </div>

      <MistakeList mistakes={stats.mistakes} />

      {sheetOpen && explanation && <ExplanationSheet step={step} explanation={explanation} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
