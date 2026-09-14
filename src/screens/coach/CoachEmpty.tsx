/**
 * 콜드 스타트 조각들 (COACH_SPEC §7).
 *
 * 빈 화면을 만들지 않는 방법은 "잠긴 진짜 화면"을 보여 주는 것입니다. 그래서 여기 있는 것은
 * 빈 상태 안내가 아니라 **다음에 할 일**뿐입니다 — 얼마나 남았는지(GateBar), 지금 뭘 누르면
 * 되는지(CoachEmpty), 데이터가 0이어도 읽을 값이 있는 것(BasicsCards).
 *
 * BasicsCards 는 내 기록이 아니라 일반론이라 그렇다고 화면에 적습니다. 기록인 척하면 카드 계약의
 * 전제('내 기록 한 줄')가 깨지고, 그 순간 나머지 카드까지 못 믿게 됩니다.
 */
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { launch } from '../../state/nav';
import type { AxisView } from '../../state/coach/types';
import { axisNeedText, axisProgress } from './TendencyAxes';

/**
 * 화면을 단계로 가르는 실수 개수입니다. **축이 열리는 약속이 아닙니다** — 축은 전역 |M| 이 아니라
 * 축마다 제 표본으로 열립니다(rfi 만 푼 사람은 |M| 이 12를 넘어도 aggression 이 안 열립니다).
 * 그래서 "얼마나 더"를 말하는 곳은 전부 축의 need 를 읽고, 이 상수는 섹션을 켜고 끄는 데만 씁니다.
 */
export const AXIS_GATE = 12;
/** 집중 포인트를 세 장까지 여는 실수 수. 빈 화면의 목표치로도 씁니다. */
export const FULL_GATE = 20;

interface Basic {
  title: string;
  line: string;
  cta: string;
  go(): void;
}

const BASICS: Basic[] = [
  {
    title: '앞자리와 뒷자리는 다른 게임이에요',
    line: 'UTG는 뒤에 다섯 명이 남아 있습니다.',
    cta: '앞자리로 훈련',
    go: () => launch({ target: 'train', deck: 'rfi', positions: ['UTG', 'HJ'], autostart: true }),
  },
  {
    // '이미 낸 돈이 아까워서'가 아니라 포지션이 이유입니다. 다만 SB 오픈에는 BB 가 포지션을 가지므로
    // 자리를 싸잡아 말하지 않고 '대개'로 둡니다.
    title: 'BB는 싸게 보지만 대개 먼저 액션해요',
    line: '값이 싼 것과 치기 쉬운 것은 다릅니다.',
    cta: 'BB 수비 훈련',
    go: () => launch({ target: 'train', deck: 'vs_open', positions: ['BB'], autostart: true }),
  },
  {
    // "무늬는 보너스"라고 하면 차트와 어긋납니다 — 수티드라서 플레이하는 패가 실제로 많습니다.
    // 무늬의 값을 부정하지 않고, 그 값이 자리에 따라 달라진다는 쪽으로 말합니다.
    title: '같은 패도 자리에 따라 값이 달라요',
    line: '뒤에 몇 명이 남았는지를 먼저 보세요.',
    cta: '오픈 대응 훈련',
    go: () => launch({ target: 'train', deck: 'vs_open', autostart: true }),
  },
];

export interface CoachEmptyProps {
  /** stats.total — 퀴즈를 푼 적이 있는가. 문구를 훈련 탭 용어로 쓸지 가르는 기준입니다. */
  quizTotal: number;
  /** Σ(quizSeen + pickSeen) — 어느 탭에서든 실제로 답을 낸 횟수. */
  trials: number;
  /** 저장된 실수 전체 수. 분석에 못 쓴 실수도 여기엔 들어 있습니다. */
  mistakesStored: number;
  reducedMotion: boolean;
}

/**
 * 단계 0. 같은 "아직 없어요"라도 이유가 셋이라 문구를 갈라야 합니다.
 *
 *   - 실수가 저장은 돼 있는데 분석에 못 쓴 경우: 퀴즈 탭에는 그 실수가 그대로 보이므로 "아무것도
 *     없다"고 하면 화면끼리 다른 말을 합니다. 제목을 '성향이 안 보인다'로 바꾸고, 왜 안 넣었는지는
 *     머리말 각주가 이미 말하므로 여기서는 다음에 할 일만 적습니다.
 *   - 훈련만 한 경우: 노출 모드와 스와이프 평가로는 방향이 기록되지 않으니 '선택 버튼'을 집어 말합니다.
 *   - 퀴즈를 푼 적이 있는 경우: '선택 버튼'은 훈련 탭 용어라 뜻이 안 통합니다. 그냥 더 풀라고 합니다.
 */
export function CoachEmpty({ quizTotal, trials, mistakesStored, reducedMotion }: CoachEmptyProps): JSX.Element {
  const mixedOnly = mistakesStored > 0;
  const trainOnly = quizTotal === 0 && trials > 0;

  const title = mixedOnly ? '아직 성향이 안 보여요' : '아직 볼 게 없어요';
  const sub = mixedOnly
    ? '답이 하나인 문제를 풀면 성향이 쌓입니다.'
    : trainOnly
      ? '아직 틀린 게 없어요. 선택 버튼으로 답을 고르면 성향이 쌓입니다.'
      : quizTotal > 0
        ? '아직 틀린 게 없어요. 문제를 더 풀면 성향이 쌓입니다.'
        : `문제를 ${FULL_GATE}개쯤 풀면 성향이 보입니다`;

  return (
    <GlassPanel variant="strong" radius="lg" padding={20} className="coach-empty">
      <p className="t-title-2">{title}</p>
      <p className="coach-empty__sub">{sub}</p>
      <ProgressRing
        size={64}
        stroke={6}
        value={0}
        max={FULL_GATE}
        animate={!reducedMotion}
        label={
          <span className="coach-empty__ring tnum">
            0 / {FULL_GATE}
          </span>
        }
      />
      <CapsuleButton tone="primary" block onClick={() => launch({ target: 'quiz', autostart: true })}>
        퀴즈 시작
      </CapsuleButton>
    </GlassPanel>
  );
}

/** 단계 0~1 내내 남아 있는 고정 카드 3장. */
export function BasicsCards(): JSX.Element {
  return (
    <section className="coach-section" aria-label="초보가 제일 많이 틀리는 곳">
      <header className="coach-sec">
        <h2 className="t-title-3">초보가 제일 많이 틀리는 곳</h2>
      </header>
      <p className="coach-basics__note">내 기록이 아니라 일반적인 이야기예요</p>
      <div className="coach-stack">
        {BASICS.map((b) => (
          <GlassPanel key={b.title} as="section" className="glass-flat coach-basic" radius="lg" padding={16}>
            <h3 className="t-headline coach-basic__title">{b.title}</h3>
            <p className="coach-basic__line">{b.line}</p>
            <CapsuleButton tone="neutral" size="md" block onClick={b.go}>
              {b.cta}
            </CapsuleButton>
          </GlassPanel>
        ))}
      </div>
    </section>
  );
}

/**
 * 아직 한 축도 안 열렸을 때의 얇은 진행 바.
 *
 * 전역 실수 개수를 상수에 재면 바로 아래 축 줄과 숫자가 어긋납니다 — rfi 를 주로 푸는 사람은
 * |M| 이 12를 넘어도 부호 검정 표본(L=3 상황)이 모자라 aggression 이 안 열리는데, 바는 다 찼다고
 * 말하게 됩니다. 그래서 **가장 먼저 열릴 축**을 그대로 받아 그 축의 표본으로 그립니다.
 */
export function GateBar({ axis }: { axis: AxisView }): JSX.Element {
  const [done, left] = axisProgress(axis);
  const total = done + left;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="coach-gate">
      <div
        className="coach-gate__bar"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${axis.koLabel} 축이 열리기까지 남은 것`}
      >
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="coach-gate__text tnum">
        <span className="coach-gate__axis">{axis.koLabel}</span>
        <span>{axisNeedText(axis)}</span>
      </p>
    </div>
  );
}
