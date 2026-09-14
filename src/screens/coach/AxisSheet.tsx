/**
 * 성향 근거 시트 (COACH_SPEC §6.5) — 숫자를 숨기지 않고 다 보여 주는 곳은 화면에서 여기 한 군데입니다.
 *
 * 목록은 다이제스트가 이미 추려 준 최근 실수에서 **이 축에 들어가는 것만** 골라 냅니다. 여기서
 * 통계를 다시 내지 않는 이유는 축이 쓴 표본 수(`axis.sample`)가 이미 계약에 들어 있기 때문입니다 —
 * 목록은 "어떤 문제였나"를 보여 주는 예시이고, 세는 일은 state/coach 가 합니다.
 */
import { ActionBadge } from '../../components/ActionBadge';
import { Sheet } from '../../components/ui/Sheet';
import { SCENARIO_ACTIONS, type Pos, type ScenarioKind } from '../../poker/types';
import type { AxisId, AxisView, CoachMistake } from '../../state/coach/types';
import { KIND_SHORT_KO } from '../home/copy';

/** 목록에 올리는 최대 개수. 더 길어지면 읽지 않고 스크롤만 합니다. */
const SHOWN = 10;

const EARLY_LATE: readonly Pos[] = ['UTG', 'HJ', 'CO', 'BTN'];

/**
 * 이 축이 무엇을 재는지 두 줄. SPEC §1 의 '왜 중요한가'를 카드 말투로 줄인 것입니다.
 * 사람을 평가하는 말이 들어가지 않도록 전부 '문제를 풀 때의 행동'으로만 적었습니다.
 */
const ABOUT: Record<AxisId, [string, string]> = {
  aggression: ['들어가기로 정한 다음이 문제입니다.', '콜로 새는지 올려서 새는지를 봅니다.'],
  entry: ['가장 비싼 실수는 들어가지 말았어야 할 판입니다.', '이 줄 하나가 나머지 실수의 절반을 만듭니다.'],
  seat: ['같은 패라도 UTG와 BTN에서 값이 다릅니다.', '자리를 안 보고 패만 보면 여기서 샙니다.'],
  pressure: ['3벳·4벳이 오면 팟이 커집니다.', '여기서 한 번 어긋나면 손해가 제일 큽니다.'],
};

/**
 * 축마다 쓰는 실수의 조건. axes.ts 의 분류와 같은 기준입니다 — 다만 여기서는 세는 게 아니라
 * 보여 줄 예시를 고르는 용도라 `sample` 과 개수가 다를 수 있고, 그래서 밑에 표본 수를 따로 적습니다.
 */
function belongs(id: AxisId, m: CoachMistake): boolean {
  switch (id) {
    // 오답 선택지가 둘인 상황만 방향을 말해 줍니다(rfi·vs_5bet 은 선택지가 하나뿐입니다).
    case 'aggression':
      return SCENARIO_ACTIONS[m.kind].length === 3;
    case 'seat':
      return EARLY_LATE.includes(m.hero);
    default:
      return true;
  }
}

function situation(kind: ScenarioKind, hero: Pos): string {
  return `${hero} · ${KIND_SHORT_KO[kind]}`;
}

export function AxisSheet({ axis, open, onClose, mistakes }: { axis: AxisView | null; open: boolean; onClose(): void; mistakes: CoachMistake[] }): JSX.Element | null {
  if (!axis) return null;
  const rows = mistakes.filter((m) => belongs(axis.id, m)).slice(0, SHOWN);
  const [a, b] = ABOUT[axis.id];

  return (
    <Sheet open={open} onClose={onClose} detent="half" title={`${axis.koLabel} 근거`}>
      <div className="coach-axissheet">
        <p className="coach-axissheet__about">{a}</p>
        <p className="coach-axissheet__about">{b}</p>

        {axis.unlocked ? (
          <p className="coach-axissheet__poles">
            <span>왼쪽 · {axis.poles[0]}</span>
            <span>오른쪽 · {axis.poles[1]}</span>
          </p>
        ) : (
          <p className="coach-axissheet__locked tnum">실수 {axis.need}개가 더 모이면 열려요</p>
        )}

        {rows.length > 0 ? (
          <ul className="coach-axissheet__list">
            {rows.map((m) => (
              <li key={`${m.key}:${m.daysAgo}:${m.chosen}`} className="coach-axissheet__row">
                <span className="coach-axissheet__hand tnum">{m.hand}</span>
                <span className="coach-axissheet__where">{situation(m.kind, m.hero)}</span>
                <span className="coach-axissheet__acts">
                  <ActionBadge action={m.chosen} kind={m.kind} size="sm" short />
                  <span>→ 정답</span>
                  <ActionBadge action={m.answer} kind={m.kind} size="sm" short />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="coach-axissheet__empty">이 줄에 들어간 실수가 아직 없어요</p>
        )}

        <p className="coach-axissheet__foot tnum">
          이 줄이 쓴 실수 {axis.sample}개{rows.length > 0 ? ` · 위에는 최근 ${rows.length}개` : ''}
        </p>
      </div>
    </Sheet>
  );
}
