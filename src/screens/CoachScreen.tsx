/**
 * 코치 (COACH_SPEC §6·§7) — 퀴즈·훈련에서 낸 실수를 성향과 집중 포인트로 돌려주는 탭.
 *
 * 이 파일은 **조립만** 합니다. 무엇이 새는지는 state/coach 가 이미 정했고(축·뭉치·문구·린트),
 * 여기서 통계를 다시 내면 화면과 다이제스트가 서로 다른 말을 하게 됩니다. 그래서 세는 코드가
 * 한 줄도 없습니다 — 있는 것은 '지금 단계에 무엇을 보여 줄지'뿐입니다.
 *
 * 콜드 스타트는 빈 화면을 따로 만들지 않고 **같은 레이아웃을 잠가서** 보여 줍니다(§7). 표본이
 * 모자란 걸 '데이터 없음'으로 감추면 무엇을 더 해야 열리는지가 사라집니다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { GlassPanel } from '../components/ui/GlassPanel';
import { toast } from '../components/ui/Toast';
import { localCoach } from '../state/coach/copy';
import { useCoachDigest } from '../state/coach/digest';
import type { AxisId, AxisView } from '../state/coach/types';
import { launch } from '../state/nav';
import { useStats } from '../state/stats';
import { AskAiPanel } from './coach/AskAiPanel';
import { AxisSheet } from './coach/AxisSheet';
import { AXIS_GATE, BasicsCards, CoachEmpty, FULL_GATE, GateBar } from './coach/CoachEmpty';
import { CoachCardView } from './coach/CoachCardView';
import { TendencyAxes } from './coach/TendencyAxes';
import { useAskCoach } from './coach/useAskCoach';
import { WeakSpotList } from './coach/WeakSpotList';
import { useReducedMotion } from './home/useReducedMotion';
import { formatAgo } from './quiz/format';
import { MistakeList } from './quiz/MistakeList';
import '../styles/quiz.css';
import '../styles/coach.css';

/** 단계 0·1·2·3 (SPEC §7). 게이트는 언제나 |M| = mistakesUsed 하나입니다. */
function stageOf(used: number): 0 | 1 | 2 | 3 {
  if (used === 0) return 0;
  if (used < AXIS_GATE) return 1;
  if (used < FULL_GATE) return 2;
  return 3;
}

/**
 * 축이 새로 열린 순간을 한 번만 알립니다.
 *
 * 기억을 저장소에 남기지 않고 **이번 세션 안에서 열린 것만** 축하합니다. 첫 렌더에서는 지금 열려 있는
 * 축을 기준점으로만 잡고 아무 말도 하지 않습니다 — 앱을 다시 열 때마다 "새 성향이 열렸어요"가 뜨면
 * 그건 축하가 아니라 소음이고, 저장소 접근을 여기 하나 더 만들지 않으려는 이유도 같습니다.
 */
function useAxisUnlock(axes: AxisView[]): AxisId[] {
  const seen = useRef<Set<AxisId> | null>(null);
  const [entering, setEntering] = useState<AxisId[]>([]);

  useEffect(() => {
    const now = new Set<AxisId>(axes.filter((a) => a.unlocked).map((a) => a.id));
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const fresh = axes.filter((a) => a.unlocked && !before.has(a.id));
    if (fresh.length === 0) return;
    setEntering(fresh.map((a) => a.id));
    toast(`새 성향이 열렸어요 · ${fresh[0].koLabel}`, 'mint');
  }, [axes]);

  return entering;
}

export function CoachScreen(): JSX.Element {
  const digest = useCoachDigest();
  const stats = useStats();
  const reducedMotion = useReducedMotion();
  const coach = useAskCoach(digest);
  const entering = useAxisUnlock(digest.axes);
  const [axis, setAxis] = useState<AxisView | null>(null);
  const [axisOpen, setAxisOpen] = useState(false);

  // 같은 다이제스트면 같은 카드가 나와야 합니다 — 스크롤할 때마다 조언이 바뀌면 그 순간 신뢰를 잃습니다.
  const cards = useMemo(() => localCoach(digest), [digest]);

  const used = digest.volume.mistakesUsed;
  const stage = stageOf(used);
  const good = cards.find((c) => c.tone === 'good');
  const tendency = cards.find((c) => c.tone === 'tendency');
  // 단계 2는 표본이 아직 얇아서 한 장만 냅니다(SPEC §7).
  const focus = cards.filter((c) => c.tone === 'focus').slice(0, stage === 2 ? 1 : 3);
  const retryKeys = useMemo(() => Array.from(new Set(digest.recentMistakes.map((m) => m.key))), [digest]);

  const openAxis = (a: AxisView) => {
    setAxis(a);
    setAxisOpen(true);
  };

  return (
    <div className="screen coach" data-stage={stage}>
      <header className="coach__head">
        <h1 className="screen__title">코치</h1>
        <p className="screen__sub">{used > 0 ? `퀴즈·훈련에서 낸 실수 ${used}개를 봤어요` : '퀴즈·훈련에서 낸 실수를 모아 성향을 봐요'}</p>
      </header>

      {stage === 1 && <GateBar used={used} />}

      {stage === 0 ? (
        <>
          <CoachEmpty trainOnly={digest.volume.trials > 0} reducedMotion={reducedMotion} />
          <BasicsCards />
        </>
      ) : (
        <>
          {stage >= 2 && (
            <GlassPanel variant="strong" radius="lg" padding={20} className="coach-summary">
              <p className="t-title-2 coach-summary__line">{tendency ? tendency.title : '아직 한쪽으로 치우치지 않았어요'}</p>
              <p className="coach-summary__note">퀴즈·훈련에서 문제를 풀 때의 성향입니다</p>
              <p className="coach-summary__note tnum">실수 {used}개 기준</p>
            </GlassPanel>
          )}

          {stage >= 2 && good && (
            <GlassPanel variant="tint" tint="var(--mint)" radius="md" padding={12} className="coach-good">
              <span className="coach-good__title">{good.title}</span>
              <span className="coach-good__ev tnum">{good.evidence}</span>
            </GlassPanel>
          )}

          <section className="coach-section" aria-label="내 성향">
            <header className="coach-sec">
              <h2 className="t-title-3">내 성향</h2>
            </header>
            <TendencyAxes axes={digest.axes} entering={reducedMotion ? [] : entering} onOpen={openAxis} />
          </section>

          {stage >= 2 && focus.length > 0 && (
            <section className="coach-section" aria-label="집중할 포인트">
              <header className="coach-sec">
                <h2 className="t-title-3">집중할 포인트</h2>
              </header>
              <div className="coach-stack">
                {focus.map((c, i) => (
                  <CoachCardView key={c.id} card={c} rank={i + 1} accent={i === 0 ? 'var(--flame)' : 'var(--mint)'} primary={i === 0} />
                ))}
              </div>
            </section>
          )}

          {/* AI 카드는 규칙 카드를 대체하지 않고 그 아래에 붙습니다 — 답이 안 와도 화면은 이미 완성돼 있습니다. */}
          {stage >= 2 && coach.answer && (
            <section className="coach-section" aria-label="AI 코치가 준 카드">
              <div className="coach-stack">
                {coach.answer.map((c) => (
                  <CoachCardView key={`ai:${c.id}`} card={c} accent="var(--sky)" />
                ))}
              </div>
              <div className="coach-again">
                <span className="coach-again__at tnum">{coach.at === null ? '받아 둔 답이에요' : `${formatAgo(coach.at)} 받았어요`}</span>
                <CapsuleButton tone="ghost" size="md" disabled={!coach.canAsk} onClick={coach.ask}>
                  {coach.busy ? '받는 중' : '새로 받기'}
                </CapsuleButton>
              </div>
            </section>
          )}

          {stage >= 2 && <AskAiPanel digest={digest} coach={coach} />}

          {stage === 1 && <BasicsCards />}

          {digest.weakSpots.length > 0 && <WeakSpotList spots={digest.weakSpots} />}

          {stats.mistakes.length > 0 && (
            <section className="coach-section" aria-label="최근 실수">
              <MistakeList mistakes={stats.mistakes} />
              {retryKeys.length > 0 && (
                <CapsuleButton tone="ghost" block onClick={() => launch({ target: 'quiz', onlyKeys: retryKeys, autostart: true })}>
                  틀린 것만 다시 풀기 · {retryKeys.length}문제
                </CapsuleButton>
              )}
            </section>
          )}
        </>
      )}

      <AxisSheet axis={axis} open={axisOpen} onClose={() => setAxisOpen(false)} mistakes={digest.recentMistakes} />
    </div>
  );
}
