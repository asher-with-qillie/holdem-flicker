/**
 * 코치 카드 한 장의 렌더러. COACH_SPEC §6.6.
 *
 * 규칙 카드(L0)와 AI 카드가 **같은 모양**으로 나옵니다. 출처가 달라도 사람이 읽는 계약
 * (제목 → 내 기록 → 생각 절차)은 하나뿐이라 렌더러도 하나여야 합니다. 카드가 무슨 말을 할지는
 * state/coach 가 이미 정했고 여기서는 배치만 합니다 — 문구를 여기서 손대면 린터를 우회하게 됩니다.
 */
import type { CSSProperties } from 'react';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import type { CoachCard, CoachDrill } from '../../state/coach/types';
import { launch } from '../../state/nav';

/**
 * 훈련 버튼 라벨.
 *
 * 퀴즈로 보낼 때만 문제 수를 셉니다. 상황 훈련은 덱에서 새로 뽑아 오므로 "12장"처럼 미리 셀 수 있는
 * 수가 없습니다 — 대신 어느 자리로 가는지를 적습니다. 없는 숫자를 지어내는 것보다 낫습니다.
 */
export function drillLabel(d: CoachDrill): string {
  if (d.target === 'quiz') {
    const n = d.onlyKeys?.length ?? 0;
    return n > 0 ? `헷갈린 것만 퀴즈 · ${n}문제` : '헷갈린 것만 퀴즈';
  }
  const where = d.positions && d.positions.length > 0 ? ` · ${d.positions.join('·')}` : '';
  return `이 상황만 훈련${where}`;
}

export interface CoachCardViewProps {
  card: CoachCard;
  /** 1·2·3 순번 배지. AI 카드는 순번을 매기지 않고 'AI 코치' 배지를 답니다. */
  rank?: number;
  /** 좌측 악센트 바 색. 1순위만 --flame, 나머지는 --mint (SPEC §6.6). */
  accent: string;
  /** 화면당 solid 버튼은 하나뿐이라 첫 카드만 true 입니다. */
  primary?: boolean;
}

export function CoachCardView({ card, rank, accent, primary }: CoachCardViewProps): JSX.Element {
  const drill = card.drill;
  return (
    <GlassPanel as="section" radius="lg" padding={16} className="coach-card" style={{ '--accent': accent } as CSSProperties}>
      {/* 악센트 바는 실제 요소로 둡니다 — .glass 의 ::before(테두리 광택)·::after(상단 반사)가 이미 차 있습니다. */}
      <i className="coach-card__accent" aria-hidden="true" />
      <header className="coach-card__head">
        {rank === undefined ? (
          <span className="coach-card__ai">AI 코치</span>
        ) : (
          <span className="coach-card__rank tnum" aria-hidden="true">
            {rank}
          </span>
        )}
        <h3 className="t-title-3 coach-card__title">{card.title}</h3>
      </header>
      <p className="coach-card__ev tnum">{card.evidence}</p>
      <hr className="coach-card__rule" />
      <p className="coach-card__steps-label">이렇게 생각하세요</p>
      <ul className="coach-card__steps">
        {card.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {drill && (
        <CapsuleButton tone={primary ? 'primary' : 'neutral'} block onClick={() => launch({ ...drill, autostart: true })}>
          {drillLabel(drill)}
        </CapsuleButton>
      )}
    </GlassPanel>
  );
}
