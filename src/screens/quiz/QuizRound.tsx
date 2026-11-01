import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { actionLabel } from '../../components/ActionBadge';
import { ExplanationSheet } from '../../components/ExplanationSheet';
import { SeatChips } from '../../components/SeatChips';
import { LineCapsule, LineStrip } from '../../components/LineStrip';
import { PlainText } from '../../components/Term';
import { HandView } from '../../components/PlayingCard';
import { TableDiagram } from '../../components/TableDiagram';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconButton } from '../../components/ui/IconButton';
import { IconClose } from '../../components/ui/icons';
import { nearestCellWithAction } from '../../poker/atlas';
import { explainStep, suitOrientation } from '../../poker/explain';
import { cardLabel } from '../../poker/hands';
import { scenarioSituation } from '../../poker/scenarios';
import { scenarioActions, type Card, type HandName } from '../../poker/types';
import { openAtlas } from '../../state/atlas';
import { onViewportJump, useLayout, type Layout } from '../../state/viewport';
import { getChartDef } from '../../poker/data';
import { restAction } from '../../poker/range';
import { ActionShares } from '../charts/ChartStats';
import { SessionRibbon, type RibbonItem } from '../trainer/SessionRibbon';
import { StageChart } from '../trainer/StageChart';
import { useSettings } from '../../state/settings';
import { useStats } from '../../state/stats';
import { FitBox, pickFanSize } from '../trainer/FitBox';
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
    <div className="quiz-handlabel t-title-3" aria-label={`패 ${hand}`}>
      <span className={`quiz-handlabel__card quiz-handlabel__card--${cards[0].suit}`}>{cardLabel(cards[0])}</span>
      <span className={`quiz-handlabel__card quiz-handlabel__card--${cards[1].suit}`}>{cardLabel(cards[1])}</span>
      <span className="quiz-handlabel__sep">·</span>
      <span className="quiz-handlabel__name">{hand}</span>
    </div>
  );
}

/**
 * One question — remounted per card (keyed by the parent). Returns its zones as siblings so the round's grid can place
 * them per size class (Duo spec §4.2): .quiz-zq (strip · situation · [hand | T] · label) · .quiz-za (prompt · answers ·
 * feedback) · .quiz-ctx (tall / wide: G · shares · S · R). phone / squat flatten zq / za with display: contents.
 */
function Question({ q, autoAdvance, showMix, layout, ribbon }: { q: QuizQuestion; autoAdvance: boolean; showMix: boolean; layout: Layout; ribbon: ReactNode }) {
  const stats = useStats();
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Opening the explanation (or folding / rotating the device) cancels auto-advance for this question. */
  const [autoCancelled, setAutoCancelled] = useState(false);

  const { step, cards, grade, chosen } = q;
  const { scenario } = step;
  const kind = scenario.kind;
  const actions = scenarioActions(kind, step.scenario.hero);
  const explanation = useMemo(() => explainStep(step, suitOrientation(cards)), [step, cards]);
  const autoPending = grade === 'correct' && autoAdvance && !sheetOpen && !autoCancelled;
  const rest = useMemo(() => restAction(getChartDef(scenario)), [scenario]);

  useEffect(() => {
    if (!autoPending) return;
    const t = window.setTimeout(() => next(), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [autoPending]);

  // Fold / unfold / rotate (Duo spec §6.2): never flip the card while the screen is changing shape.
  useEffect(() => onViewportJump(() => setAutoCancelled(true)), []);

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
  // 판정 줄(§5.1). 판정은 이 줄과 캡슐이 말하고, 줄 문장 앞에는 덧붙이지 않습니다.
  let verdict = '';
  if (grade === 'correct') verdict = '정답이에요';
  else if (grade === 'partial') verdict = '부분 정답이에요';
  else if (grade === 'wrong') verdict = `아쉬워요 · 정답은 ${explanation.capsule.label}`;
  const near = (grade === 'wrong' || grade === 'partial') && explanation.nearMiss;

  const openSheet = () => {
    setAutoCancelled(true);
    setSheetOpen(true);
  };
  /** 코치 규칙 "이 패를 UTG라고 생각하고 접은 건 아닌가요?" 를 그림으로: 오답이면 고른 답이 정답인 가장 가까운 칸을 비교로. */
  const across = () => {
    setSheetOpen(false);
    const compare = grade === 'wrong' && chosen ? nearestCellWithAction(scenario, step.hand, chosen) : null;
    openAtlas({ hand: step.hand, origin: scenario, ...(compare ? { compare } : {}) });
  };
  const seatsAcross = () => {
    setAutoCancelled(true);
    const compare = grade === 'wrong' && chosen ? nearestCellWithAction(scenario, step.hand, chosen) : null;
    openAtlas({ hand: step.hand, origin: scenario, ...(compare ? { compare } : {}) });
  };

  const masked = grade === undefined;
  const inline = layout === 'tall' || layout === 'wide';
  const md = inline;
  // T beside the hand (squat / land; masked until answered, then a button into the explanation), phone: the painted
  // map crossfades over the hand after answering when the box is ≥ 104 tall.
  const sideMap = layout === 'squat' || layout === 'land' ? <StageChart step={step} masked={masked} variant="thumb" onOpen={masked ? undefined : openSheet} /> : null;
  const revealMap = layout === 'phone' && !masked ? <StageChart step={step} masked={false} variant="thumb" onOpen={openSheet} /> : null;

  const feedback = (
    <GlassPanel variant="clear" radius="lg" padding={12} className={`quiz-feedback quiz-feedback--${grade ?? 'idle'}${md ? ' quiz-feedback--md' : ''}`} aria-live="polite">
      {grade ? (
        <div className="quiz-feedback__in">
          <div className="quiz-feedback__top">
            <span className="quiz-feedback__verdict">
              <span className="quiz-feedback__mark" aria-hidden="true">
                {MARK[grade]}
              </span>{' '}
              {verdict}
            </span>
            {near && <span className="quiz-feedback__near fill t-caption">{near}</span>}
          </div>
          <LineCapsule capsule={explanation.capsule} size={md ? 'md' : 'sm'} showSplit={showMix} className="quiz-feedback__cap" />
          <LineStrip view={explanation.line} size={md ? 'md' : 'sm'} className="quiz-feedback__strip" />
          <p className="quiz-feedback__reason">
            <PlainText text={explanation.line.sentence?.text ?? ''} />
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
  );
  const grid = (
    <div className="quiz-ctx__grid">
      <StageChart step={step} masked={masked} variant="full" />
    </div>
  );
  const seats = <SeatChips step={step} explanation={explanation} masked={masked} onPress={masked ? undefined : seatsAcross} />;

  return (
    <>
      <div className="quiz-zq">
        <TableDiagram scenario={scenario} compact />

        <p className="quiz-situation">
          <span>{scenarioSituation(scenario)}</span>
        </p>

        <div className={`quiz-stage${sideMap ? ' quiz-stage--split' : ''}${masked ? '' : ' quiz-stage--done'}`}>
          <div className="quiz-stage__row">
            <div className="quiz-stage__area">
              <FitBox className="quiz-hand">{(box) => <HandView cards={cards} size={pickFanSize(box)} />}</FitBox>
              {revealMap && <div className="quiz-revealmap">{revealMap}</div>}
            </div>
            {sideMap && <div className="quiz-stage__map">{sideMap}</div>}
          </div>
          <HandLabel cards={cards} hand={step.hand} />
        </div>
      </div>

      <div className="quiz-za">
        <p className="quiz-prompt" aria-live="polite">
          {grade ? kindLine : '어떻게 할까요?'}
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

        {layout !== 'wide' && feedback}
      </div>

      {inline && (
        <div className="quiz-ctx">
          {layout === 'wide' && feedback}
          {layout === 'tall' && (
            <>
              {grid}
              <div className={`quiz-shares${masked ? ' quiz-shares--masked' : ''}`} aria-hidden={masked || undefined}>
                <ActionShares cells={step.cells} kind={kind} hero={scenario.hero} rest={rest} />
              </div>
              {seats}
            </>
          )}
          {layout === 'wide' && (
            <>
              {seats}
              <div className="quiz-ctx__row">
                {grid}
                {ribbon}
              </div>
            </>
          )}
        </div>
      )}

      {sheetOpen && <ExplanationSheet step={step} explanation={explanation} onClose={() => setSheetOpen(false)} onAcross={across} />}
    </>
  );
}

/** Ribbon items for the round: answered questions, newest first. */
function roundRibbon(queue: QuizQuestion[]): RibbonItem[] {
  const out: RibbonItem[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (q.grade) out.push({ key: `${i}-${q.key}`, hand: q.step.hand, outcome: q.grade });
  }
  return out;
}

/**
 * Running round (§5.7): HUD capsule + the current question. Tab bar is hidden by the screen while this shows.
 * Duo spec §2/§4.2: `.vb` — the core (worst-toolbar height) holds everything; the slack band shows the ribbon.
 */
export function QuizRoundView({ round }: { round: QuizRound }) {
  const [settings] = useSettings();
  const layout = useLayout();
  const q = round.queue[round.index];
  const items = useMemo(() => roundRibbon(round.queue), [round.queue]);
  const inline = layout === 'tall' || layout === 'wide';
  return (
    <div className="vb quiz-vb">
      <div className={`vb__core quiz-round quiz-round--${layout}`}>
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
        {q && (
          <Question
            key={`${round.id}-${round.index}`}
            q={q}
            autoAdvance={settings.autoAdvance}
            showMix={settings.showMixFrequencies}
            layout={layout}
            ribbon={layout === 'wide' ? <SessionRibbon items={items} vertical className="quiz-ctx__rib" /> : null}
          />
        )}
        {layout === 'tall' && (
          <div className="quiz-rib">
            <SessionRibbon items={items} />
          </div>
        )}
      </div>
      <div className="vb__slack">{!inline && <SessionRibbon items={items} className="vb__ribbon" />}</div>
    </div>
  );
}
