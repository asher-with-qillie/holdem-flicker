import { useEffect, useMemo, useState } from 'react';
import { ActionBadge, actionLabel } from '../../components/ActionBadge';
import { ExplanationSheet } from '../../components/ExplanationSheet';
import { PlainText } from '../../components/Term';
import { HandView } from '../../components/PlayingCard';
import { TableDiagram } from '../../components/TableDiagram';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconButton } from '../../components/ui/IconButton';
import { IconClose } from '../../components/ui/icons';
import { explainStep } from '../../poker/explain';
import { cardLabel } from '../../poker/hands';
import { scenarioSituation } from '../../poker/scenarios';
import { SCENARIO_ACTIONS, type Card, type HandName } from '../../poker/types';
import { useSettings } from '../../state/settings';
import { useStats } from '../../state/stats';
import { FitBox } from '../trainer/FitBox';
import { pct } from './format';
import { actionWeight, PARTIAL_THRESHOLD, type Grade } from './grade';
import { answer, endRound, next, type QuizQuestion, type QuizRound } from './roundStore';

const AUTO_ADVANCE_MS = 1500;
/** Up to this many questions the HUD shows one dot per question; longer (onlyKeys) rounds get a bar. */
const MAX_DOTS = 20;

const MARK: Record<Grade, string> = { correct: '✓', partial: '△', wrong: '✕' };

function HudProgress({ queue, index }: { queue: QuizQuestion[]; index: number }) {
  if (queue.length > MAX_DOTS) {
    return (
      <span className="quiz-bar" aria-hidden="true">
        <i style={{ width: `${(index / queue.length) * 100}%` }} />
      </span>
    );
  }
  return (
    <span className="quiz-dots" aria-hidden="true">
      {queue.map((q, i) => (
        <i key={q.key} className={q.grade ?? (i === index ? 'now' : '')} />
      ))}
    </span>
  );
}

function HandLabel({ cards, hand }: { cards: [Card, Card]; hand: HandName }) {
  return (
    <div className="quiz-handlabel t-title-3" aria-label={`핸드 ${hand}`}>
      <span className={`quiz-handlabel__card quiz-handlabel__card--${cards[0].suit}`}>{cardLabel(cards[0])}</span>
      <span className={`quiz-handlabel__card quiz-handlabel__card--${cards[1].suit}`}>{cardLabel(cards[1])}</span>
      <span className="quiz-handlabel__sep">·</span>
      <span className="quiz-handlabel__name">{hand}</span>
    </div>
  );
}

/** One question: strip, situation, hand, answer buttons, feedback slot. Remounted per question (keyed by the parent). */
function Question({ q, autoAdvance, showMix }: { q: QuizQuestion; autoAdvance: boolean; showMix: boolean }) {
  const stats = useStats();
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Opening the explanation cancels auto-advance for this question. */
  const [autoCancelled, setAutoCancelled] = useState(false);

  const { step, cards, grade, chosen } = q;
  const { scenario } = step;
  const kind = scenario.kind;
  const actions = SCENARIO_ACTIONS[kind];
  const explanation = useMemo(() => explainStep(step), [step]);
  const autoPending = grade === 'correct' && autoAdvance && !sheetOpen && !autoCancelled;

  useEffect(() => {
    if (!autoPending) return;
    const t = window.setTimeout(() => next(), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [autoPending]);

  // Keyboard (desktop QA, §9): 1…n picks an answer, Enter / Space goes on after an answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || sheetOpen) return;
      const n = Number(e.key);
      if (!grade && n >= 1 && n <= actions.length) {
        e.preventDefault();
        answer(actions[n - 1]);
      } else if (grade && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [grade, actions, sheetOpen]);

  const kindStat = stats.byKind[kind];
  const kindLine = kindStat?.attempts ? `이 유형 정답률 ${Math.round((kindStat.correct / kindStat.attempts) * 100)}% · ${kindStat.attempts}문제` : '이 유형의 첫 문제예요';
  const hasMix = showMix && step.mixList.length >= 2;

  let verdict = '';
  if (grade === 'correct') verdict = '정답이에요';
  else if (grade === 'partial' && chosen) verdict = `부분 정답 · ${actionLabel(chosen, kind, true)}도 ${pct(actionWeight(step, chosen))}`;
  else if (grade === 'wrong') verdict = `아쉬워요 · 정답은 ${actionLabel(step.answer, kind, true)}`;

  const openSheet = () => {
    setAutoCancelled(true);
    setSheetOpen(true);
  };

  return (
    <div className="quiz-q">
      <TableDiagram scenario={scenario} compact />

      <p className="quiz-situation">
        <span>{scenarioSituation(scenario)}</span>
      </p>

      <FitBox className="quiz-hand">{(box) => <HandView cards={cards} size={box.height >= 150 ? 'lg' : box.height >= 90 ? 'md' : 'sm'} />}</FitBox>
      <HandLabel cards={cards} hand={step.hand} />

      <p className="quiz-prompt" aria-live="polite">
        {grade ? kindLine : '어떻게 할래요?'}
      </p>

      {/* data-answer / data-partial: QA hooks for the screenshot script (§9 keyboard/QA equivalents); the 해설 sheet reveals the same data. */}
      <div
        className={`quiz-answers${grade ? ' quiz-answers--done' : ''}`}
        role="group"
        aria-label="액션 선택"
        data-answer={step.answer}
        data-partial={actions.filter((a) => a !== step.answer && actionWeight(step, a) >= PARTIAL_THRESHOLD).join(',')}
      >
        {actions.map((a) => {
          const isChosen = chosen === a;
          const isAnswer = grade !== undefined && step.answer === a;
          const cls = [
            'quiz-answer',
            `quiz-answer--${a}`,
            isChosen ? `quiz-answer--chosen quiz-answer--${grade} glass-solid` : '',
            isAnswer ? 'quiz-answer--answer' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const mark = isChosen && grade ? MARK[grade] : isAnswer ? MARK.correct : '';
          return (
            <CapsuleButton
              key={a}
              tone="tint"
              tint={`var(--act-${a})`}
              size="xl"
              className={cls}
              data-action={a}
              onClick={() => answer(a)}
              disabled={grade !== undefined}
              aria-pressed={isChosen}
              icon={mark ? <span className="quiz-answer__mark" aria-hidden="true">{mark}</span> : undefined}
            >
              {actionLabel(a, kind)}
            </CapsuleButton>
          );
        })}
      </div>

      <GlassPanel variant="clear" radius="lg" padding={12} className={`quiz-feedback quiz-feedback--${grade ?? 'idle'}`} aria-live="polite">
        {grade ? (
          <div className="quiz-feedback__in">
            <div className="quiz-feedback__top">
              <ActionBadge action={step.answer} kind={kind} size="md" />
              <span className="quiz-feedback__verdict">
                <span className="quiz-feedback__mark" aria-hidden="true">
                  {MARK[grade]}
                </span>{' '}
                {verdict}
              </span>
            </div>
            <div className="quiz-feedback__mix" aria-label={hasMix ? '혼합 빈도' : undefined}>
              {hasMix &&
                step.mixList.map((m) => (
                  <span key={m.action} className="quiz-mix fill tnum">
                    <i style={{ background: `var(--act-${m.action})` }} aria-hidden="true" />
                    {actionLabel(m.action, kind, true)} {pct(m.weight)}
                  </span>
                ))}
            </div>
            <p className="quiz-feedback__reason">
              <PlainText text={explanation.easy.oneLiner} />
            </p>
            <div className="quiz-feedback__row">
              <CapsuleButton tone="neutral" size="md" onClick={openSheet}>
                해설
              </CapsuleButton>
              <CapsuleButton tone="primary" size="md" className={`quiz-next${autoPending ? ' quiz-next--auto' : ''}`} onClick={() => next()}>
                다음
              </CapsuleButton>
            </div>
          </div>
        ) : (
          <p className="quiz-feedback__hint">{kindLine}</p>
        )}
      </GlassPanel>

      {sheetOpen && <ExplanationSheet step={step} explanation={explanation} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

/** Running round (§5.7): HUD capsule + the current question. Tab bar is hidden by the screen while this shows. */
export function QuizRoundView({ round }: { round: QuizRound }) {
  const [settings] = useSettings();
  const q = round.queue[round.index];
  return (
    <div className="quiz-round">
      <GlassPanel radius="capsule" padding={0} className="quiz-hud" role="group" aria-label="라운드 진행">
        <IconButton icon={<IconClose />} label="라운드 끝내기" size={40} tone="ghost" className="quiz-hud__close" onClick={() => endRound()} />
        <HudProgress queue={round.queue} index={round.index} />
        <span className="quiz-hud__counter tnum" aria-label={`${round.index + 1}번째 문제, 총 ${round.queue.length}문제`}>
          {round.index + 1}/{round.queue.length}
        </span>
        <span className="quiz-hud__score tnum">
          정답 {round.correct + round.partial} · 연속 {round.streak}
        </span>
      </GlassPanel>
      {q && <Question key={`${round.id}-${round.index}`} q={q} autoAdvance={settings.autoAdvance} showMix={settings.showMixFrequencies} />}
    </div>
  );
}
