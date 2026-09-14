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

/** aggression 축이 열리는 실수 수(axes.ts minSample). 게이트 문구가 이 숫자를 그대로 씁니다. */
export const AXIS_GATE = 12;
/** entry 축까지 열려 화면이 다 차는 실수 수. 빈 화면의 목표치로 씁니다. */
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
    title: 'BB를 접는 이유는 가격이 아니라 포지션이에요',
    line: '플랍부터 리버까지 내가 먼저 액션합니다.',
    cta: 'BB 수비 훈련',
    go: () => launch({ target: 'train', deck: 'vs_open', positions: ['BB'], autostart: true }),
  },
  {
    title: '무늬는 마지막에 더하는 보너스예요',
    line: '두 장이 높은지, 이어져 있는지를 먼저 보세요.',
    cta: '오픈 대응 훈련',
    go: () => launch({ target: 'train', deck: 'vs_open', autostart: true }),
  },
];

/**
 * 단계 0. `trainOnly` 는 훈련만 한 사용자 특례입니다 — 노출 모드와 스와이프 평가만으로는 방향이
 * 기록되지 않아서, 문제를 안 푼 게 아니라 '선택 버튼을 안 눌렀다'고 정확히 말해 줘야 합니다.
 */
export function CoachEmpty({ trainOnly, reducedMotion }: { trainOnly: boolean; reducedMotion: boolean }): JSX.Element {
  return (
    <GlassPanel variant="strong" radius="lg" padding={20} className="coach-empty">
      <p className="t-title-2">아직 볼 게 없어요</p>
      <p className="coach-empty__sub">{trainOnly ? '아직 틀린 게 없어요. 선택 버튼으로 답을 고르면 성향이 쌓입니다.' : `문제를 ${FULL_GATE}개쯤 풀면 성향이 보입니다`}</p>
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

/** 단계 1의 얇은 진행 바. 무엇을 얼마나 더 하면 열리는지가 이 단계의 유일한 동기부여입니다. */
export function GateBar({ used }: { used: number }): JSX.Element {
  const left = Math.max(0, AXIS_GATE - used);
  const ratio = Math.min(1, used / AXIS_GATE);
  return (
    <div className="coach-gate">
      <div className="coach-gate__bar" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={AXIS_GATE} aria-label="성향 분석까지 남은 실수">
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="coach-gate__text tnum">성향 분석까지 {left}개 남음</p>
    </div>
  );
}
