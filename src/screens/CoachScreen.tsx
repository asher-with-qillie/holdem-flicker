/**
 * 코치 (COACH_SPEC §6·§7) — 퀴즈·훈련에서 낸 실수를 성향과 집중 포인트로 돌려주는 탭.
 *
 * 이 파일은 **조립만** 합니다. 무엇이 새는지는 state/coach 가 이미 정했고(축·뭉치·문구·린트),
 * 여기서 통계를 다시 내면 화면과 다이제스트가 서로 다른 말을 하게 됩니다. 그래서 세는 코드가
 * 한 줄도 없습니다 — 있는 것은 '지금 단계에 무엇을 보여 줄지'뿐입니다.
 *
 * 콜드 스타트는 빈 화면을 따로 만들지 않고 **같은 레이아웃을 잠가서** 보여 줍니다(§7). 표본이
 * 모자란 걸 '데이터 없음'으로 감추면 무엇을 더 해야 열리는지가 사라집니다.
 *
 * 게이트가 두 종류라는 점이 이 화면의 핵심입니다. 섹션을 켜고 끄는 건 전역 |M| 이지만,
 * **성향에 대해 말해도 되는가**는 |M| 이 아니라 '축이 실제로 열렸는가'입니다. 둘을 같은 것으로
 * 보면 한 번도 재 보지 않은 사람에게 "재 봤더니 중립"이라고 말하게 됩니다.
 */
import { useEffect, useMemo, useState } from 'react';
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
import { axisRemaining, TendencyAxes } from './coach/TendencyAxes';
import { useAskCoach } from './coach/useAskCoach';
import { WeakSpotList } from './coach/WeakSpotList';
import { useReducedMotion } from './home/useReducedMotion';
import { formatAgo } from './quiz/format';
import { MistakeList } from './quiz/MistakeList';
import '../styles/quiz.css';
import '../styles/coach.css';

/** §6.9 의 '최근 실수' 와 같은 개수 — 목록에 보이는 것과 다시 푸는 것이 어긋나면 안 됩니다. */
const RETRY_LIMIT = 20;

/**
 * 단계 0·1·2·3 (SPEC §7). **부피**만 봅니다 — 요약·집중 포인트·AI 를 켜도 될 만큼 재료가
 * 모였는가. 성향을 말해도 되는지는 축이 따로 판정하므로 이 값으로 묻지 않습니다.
 */
function stageOf(used: number): 0 | 1 | 2 | 3 {
  if (used === 0) return 0;
  if (used < AXIS_GATE) return 1;
  if (used < FULL_GATE) return 2;
  return 3;
}

/* ------------------------------------------------------------------------------------------------
 * 해금 기록 — 축이 열린 순간을 한 번만 축하하기 위한 최소한의 저장소
 * ---------------------------------------------------------------------------------------------- */

/** 다른 스토어와 같은 `holdem-flicker.*.v1` 꼴. 다른 키를 건드리지 않으려고 따로 씁니다. */
const UNLOCK_KEY = 'holdem-flicker.coach.unlocked.v1';

const AXIS_IDS: readonly AxisId[] = ['aggression', 'entry', 'seat', 'pressure'];

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 기록이 아예 없으면 null. '한 번도 안 적었다'와 '적었는데 비어 있다'를 갈라야 첫 방문에 소음이 안 납니다. */
function readUnlocked(): Set<AxisId> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(UNLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // 모르는 id 한 줄 때문에 기록 전체를 버리지 않습니다 — 아는 것만 남깁니다.
    return new Set(parsed.filter((v): v is AxisId => AXIS_IDS.includes(v as AxisId)));
  } catch {
    return null;
  }
}

function writeUnlocked(ids: Set<AxisId>): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(UNLOCK_KEY, JSON.stringify([...ids]));
  } catch {
    /* 저장소가 꽉 찼거나 막혀 있어도 이번 세션은 그대로 굴러갑니다 — 축하 한 번을 못 할 뿐입니다. */
  }
}

/**
 * 축이 새로 열린 순간을 한 번만 알립니다.
 *
 * 기억을 컴포넌트 ref 에 두면 이 화면에서는 **절대 뜨지 않습니다**. App 이 `<div key={nav.tab}>` 로
 * 탭을 감싸서 탭을 떠나면 이 컴포넌트가 언마운트되고 ref 가 날아가는데, 축이 열리는 계기(새 실수)는
 * 퀴즈·훈련 탭에서만 생기기 때문입니다. 돌아오면 언제나 첫 렌더 = 기준점만 잡고 침묵입니다.
 * 그래서 SPEC §7 이 적어 둔 대로 해금 기록을 저장소에 남깁니다.
 *
 * 기록이 아예 없을 때는 지금 열려 있는 축을 조용히 적어 두기만 합니다 — 이 기능이 생기기 전부터
 * 쓰던 사람에게 옛날에 열린 축 네 개를 몰아서 축하하면 그건 축하가 아니라 소음입니다.
 */
function useAxisUnlock(axes: AxisView[]): AxisId[] {
  const [entering, setEntering] = useState<AxisId[]>([]);

  useEffect(() => {
    const unlocked = axes.filter((a) => a.unlocked);
    const before = readUnlocked();
    if (!before) {
      writeUnlocked(new Set(unlocked.map((a) => a.id)));
      return;
    }
    const fresh = unlocked.filter((a) => !before.has(a.id));
    if (fresh.length === 0) return;
    writeUnlocked(new Set([...before, ...fresh.map((a) => a.id)]));
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
  // 저장은 됐지만 분석에 못 쓴 실수. 퀴즈 탭에는 그대로 보이므로 여기서도 있다고 말해야 합니다.
  const excluded = Math.max(0, digest.volume.mistakesStored - used);
  const stage = stageOf(used);

  const unlockedCount = digest.axes.filter((a) => a.unlocked).length;
  // 가장 먼저 열릴 축. 진행 바는 전역 |M| 이 아니라 이 축의 표본을 재야 바로 아래 축 줄과 숫자가 맞습니다.
  const gateAxis = useMemo(() => {
    let first: AxisView | null = null;
    for (const a of digest.axes) {
      if (a.unlocked) continue;
      if (!first || axisRemaining(a) < axisRemaining(first)) first = a;
    }
    return first;
  }, [digest.axes]);

  const good = cards.find((c) => c.tone === 'good');
  const tendency = cards.find((c) => c.tone === 'tendency');
  // 단계 2는 표본이 아직 얇아서 한 장만 냅니다(SPEC §7).
  const focus = cards.filter((c) => c.tone === 'focus').slice(0, stage === 2 ? 1 : 3);
  // 목록에 보이는 실수를 그대로 다시 풉니다 — 분석에서 뺀 실수도 문제로는 멀쩡합니다.
  const retryKeys = useMemo(
    () => Array.from(new Set(stats.mistakes.slice(0, RETRY_LIMIT).map((m) => `${m.scenarioId}|${m.hand}`))),
    [stats],
  );

  const openAxis = (a: AxisView) => {
    setAxis(a);
    setAxisOpen(true);
  };

  return (
    <div className="screen coach" data-stage={stage}>
      <header className="coach__head">
        <h1 className="screen__title">코치</h1>
        <p className="screen__sub">{used > 0 ? `퀴즈·훈련에서 낸 실수 ${used}개를 봤어요` : '퀴즈·훈련에서 낸 실수를 모아 성향을 봐요'}</p>
        {excluded > 0 && <p className="coach__note">틀린 {excluded}개는 정답이 갈리는 문제라 성향에는 안 넣었어요</p>}
      </header>

      {/* 한 축도 안 열렸으면 단계와 상관없이 '무엇이 얼마나 더 필요한지'를 먼저 보여 줍니다. */}
      {used > 0 && unlockedCount === 0 && gateAxis && <GateBar axis={gateAxis} />}

      {stage === 0 ? (
        <>
          <CoachEmpty
            quizTotal={digest.volume.quizTotal}
            trials={digest.volume.trials}
            mistakesStored={digest.volume.mistakesStored}
            reducedMotion={reducedMotion}
          />
          <BasicsCards />
        </>
      ) : (
        <>
          {stage >= 2 && (
            <GlassPanel variant="strong" radius="lg" padding={20} className="coach-summary">
              {/* 재 본 축이 하나도 없으면 '중립'이라고 말할 수 없습니다 — 재지 않은 것과 재 보니 가운데인 것은 다릅니다. */}
              <p className="t-title-2 coach-summary__line">
                {unlockedCount === 0 ? '아직 성향을 재는 중이에요' : (tendency ? tendency.title : '아직 한쪽으로 치우치지 않았어요')}
              </p>
              <p className="coach-summary__note">
                {unlockedCount === 0 ? '표본이 모이면 어느 쪽으로 기우는지 말해 드려요' : '퀴즈·훈련에서 문제를 풀 때의 성향입니다'}
              </p>
              <p className="coach-summary__note tnum">{unlockedCount === 0 ? `실수 ${used}개를 모았어요` : `실수 ${used}개 기준`}</p>
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

          {/*
            AI 카드는 규칙 카드를 대체하지 않고 그 아래에 붙습니다 — 답이 안 와도 화면은 이미 완성돼 있습니다.
            섹션이 뜨는 조건(받아 둔 답이 있거나 키가 있다)과 버튼이 열리는 조건(다시 물어볼 때가 됐다)을
            갈라 둡니다. 둘을 묶어 두면 [새로 받기]는 답이 있을 때만 보이는데 답이 있으면 곧바로 잠기는,
            구조적으로 눌리지 않는 버튼이 됩니다.
          */}
          {stage >= 2 && (coach.answer !== null || coach.hasKey) && (
            <section className="coach-section" aria-label="AI 코치">
              {coach.answer !== null && (
                <div className="coach-stack">
                  {coach.answer.map((c) => (
                    <CoachCardView key={`ai:${c.id}`} card={c} accent="var(--sky)" />
                  ))}
                </div>
              )}
              <div className="coach-again">
                <span className="coach-again__at tnum">{coach.at === null ? '아직 받은 답이 없어요' : `${formatAgo(coach.at)} 받았어요`}</span>
                <CapsuleButton tone="ghost" size="md" disabled={!coach.canAsk} onClick={coach.ask}>
                  {coach.busy ? '받는 중' : coach.answer !== null ? '새로 받기' : '바로 받기'}
                </CapsuleButton>
              </div>
              {/*
                왜 못 누르는지를 적습니다. 남은 개수는 적지 않습니다 — 그 기준값은 aiStore 안에 있어서
                여기서 읽을 수 없고, 읽지 못한 숫자를 지어내는 건 이 화면이 하지 않는 일입니다.
              */}
              {!coach.canAsk && !coach.busy && (
                <p className="coach-again__why">
                  {coach.hasKey ? '새 실수가 더 쌓이거나 하루가 지나면 다시 받을 수 있어요' : 'API 키가 없어서 지금은 못 받아요'}
                </p>
              )}
            </section>
          )}

          {stage >= 2 && <AskAiPanel digest={digest} coach={coach} />}

          {stage === 1 && <BasicsCards />}
        </>
      )}

      {/*
        아래 두 섹션은 단계 밖입니다(SPEC §7: 1건이라도 있으면 켠다). 성향을 못 재는 것과 실수 목록이
        없는 것은 다른 이야기인데, 단계 0 분기 안에 두면 같은 기기의 퀴즈 탭에는 보이는 실수가
        코치 탭에서만 사라집니다.
      */}
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

      <AxisSheet axis={axis} open={axisOpen} onClose={() => setAxisOpen(false)} mistakes={digest.recentMistakes} />
    </div>
  );
}
