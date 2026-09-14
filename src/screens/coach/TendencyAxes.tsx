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

/**
 * 잠긴 축이 요구하는 것 한 줄. 화면 글씨와 aria-label 이 같은 사실을 말해야 둘이 어긋나지 않습니다.
 *
 * `needWhere` · `lockedBy` · `baselineNeed` 는 axes.ts 가 붙이는 **선택** 필드라 없으면 예전처럼
 * "실수 N개 더"로 떨어집니다. 있으면 두 가지 거짓말을 막아 줍니다.
 *   - 어디서 난 실수인지 안 적으면: seat 는 앞자리·뒷자리 실수만 세므로, BB 수비만 푸는 사람은
 *     실수를 아무리 쌓아도 이 숫자가 1도 안 줄어듭니다. 채울 수 없는 숙제를 내는 셈입니다.
 *   - 기준선이 없는데 "실수 N개 더"라고 적으면: 막고 있는 건 실수가 아니라 분모입니다. 실수를
 *     채워도 안 열립니다. 이때는 셀 수 있는 척하지 않고 '문제부터 풀기'라고 말합니다.
 */
export function axisNeedText(a: AxisView): string {
  const where = a.needWhere ? `${a.needWhere} ` : '';
  if (a.lockedBy === 'no-baseline') return `${where}문제부터 풀기`;
  if (a.lockedBy === 'baseline') return `${where}문제 ${a.baselineNeed ?? 0}개 더`;
  return `${where}실수 ${a.need}개 더`;
}

/**
 * 해금까지 남은 양. 어느 쪽이 먼저 열리는지를 고를 때 씁니다.
 * 기준선을 아예 못 잡은 축은 셀 수가 없으므로 '가장 먼저'의 후보에서 맨 뒤로 보냅니다.
 */
export function axisRemaining(a: AxisView): number {
  if (a.lockedBy === 'no-baseline') return Number.POSITIVE_INFINITY;
  if (a.lockedBy === 'baseline') return a.baselineNeed ?? 0;
  return a.need;
}

/** 진행 바가 그릴 [채운 것, 남은 것]. 무엇이 잠금을 쥐고 있느냐에 따라 세는 대상이 다릅니다. */
export function axisProgress(a: AxisView): [done: number, left: number] {
  if (a.lockedBy === 'no-baseline') return [0, 0];
  if (a.lockedBy === 'baseline') return [a.baselineTrials ?? 0, a.baselineNeed ?? 0];
  return [a.sample, a.need];
}

/** 스크린 리더가 읽을 값. 마커 위치는 눈으로만 읽히므로 세기와 방향을 말로 적어 둡니다. */
function valueText(a: AxisView): string {
  if (!a.unlocked) {
    const where = a.needWhere ? `${a.needWhere} ` : '';
    if (a.lockedBy === 'no-baseline') return `아직 잠겨 있어요. ${where}문제를 푼 적이 없어서 잴 수가 없어요`;
    if (a.lockedBy === 'baseline') return `아직 잠겨 있어요. ${where}문제를 ${a.baselineNeed ?? 0}개 더 풀면 기준이 잡혀요`;
    return `아직 잠겨 있어요. ${where}실수 ${a.need}개가 더 모이면 열려요`;
  }
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
          {!axis.unlocked && <span className="coach-axis__need tnum">{axisNeedText(axis)}</span>}
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
