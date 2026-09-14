/**
 * 내 성향 4줄 (COACH_SPEC §6.4) — 양극 슬라이더입니다.
 *
 * 레이더 차트를 쓰지 않은 이유가 이 컴포넌트의 전부입니다. 양극 축에서는 '가운데'와 '데이터 없음'이
 * 같은 모양이 돼 버려서, 재 본 결과가 중립인 사람과 아직 표본이 없는 사람이 구별되지 않습니다.
 * 그래서 잠긴 줄도 지우지 않고 회색 트랙으로 남기고 "실수 N개 더"를 숫자로 적습니다 — 표본 부족을
 * '없음'으로 감추는 대신 '무엇을 하면 열리는지'로 바꿔 보여 주는 것이 이 화면의 원칙입니다.
 */
import type { CSSProperties } from 'react';
import { GlassPanel } from '../../components/ui/GlassPanel';
import type { AxisId, AxisLevel, AxisView } from '../../state/coach/types';

/** 마커 색은 신호 세기입니다 — 약한 신호를 강한 색으로 칠하면 그 자체가 단정이 됩니다. */
const MARKER_COLOR: Record<AxisLevel, string> = {
  confident: 'var(--amber)',
  leaning: 'var(--sky)',
  flat: 'var(--ink-3)',
  locked: 'var(--ink-3)',
};

/** 스크린 리더가 읽을 값. 마커 위치는 눈으로만 읽히므로 세기와 방향을 말로 적어 둡니다. */
function valueText(a: AxisView): string {
  if (!a.unlocked) return `아직 잠겨 있어요. 실수 ${a.need}개가 더 모이면 열려요`;
  if (a.pole === null || a.level === 'flat') return '아직 한쪽으로 치우치지 않았어요';
  return `${a.level === 'confident' ? '뚜렷하게' : '조금'} ${a.pole}`;
}

function AxisRow({ axis, entering, onOpen }: { axis: AxisView; entering: boolean; onOpen(a: AxisView): void }): JSX.Element {
  const marked = axis.unlocked && axis.t !== null;
  return (
    <li className="coach-axis">
      <button type="button" className="coach-axis__btn" aria-label={`${axis.koLabel}. ${valueText(axis)}. 근거 보기`} onClick={() => onOpen(axis)}>
        <span className="coach-axis__head">
          <span className="coach-axis__label">{axis.koLabel}</span>
          {!axis.unlocked && <span className="coach-axis__need tnum">실수 {axis.need}개 더</span>}
        </span>

        <span className={`coach-axis__track${marked ? '' : ' coach-axis__track--locked'}`} aria-hidden="true">
          <i className="coach-axis__tick" />
          {marked && (
            <i
              className={`coach-axis__marker${entering ? ' coach-axis__marker--enter' : ''}`}
              style={{ '--t': axis.t ?? 0, background: MARKER_COLOR[axis.level] } as CSSProperties}
            />
          )}
        </span>

        <span className="coach-axis__poles" aria-hidden="true">
          <span>{axis.poles[0]}</span>
          <span>{axis.poles[1]}</span>
        </span>

        {axis.unlocked && <span className="coach-axis__foot tnum">실수 {axis.sample}개 기준</span>}
      </button>
    </li>
  );
}

export function TendencyAxes({ axes, entering, onOpen }: { axes: AxisView[]; entering: readonly AxisId[]; onOpen(a: AxisView): void }): JSX.Element {
  return (
    <GlassPanel className="glass-flat" radius="lg" padding={16}>
      <ul className="coach-axes">
        {axes.map((a) => (
          <AxisRow key={a.id} axis={a} entering={entering.includes(a.id)} onOpen={onOpen} />
        ))}
      </ul>
    </GlassPanel>
  );
}
