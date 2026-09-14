/**
 * 성향 근거 시트 (COACH_SPEC §6.5) — 숫자를 숨기지 않고 다 보여 주는 곳은 화면에서 여기 한 군데입니다.
 *
 * 목록은 다이제스트가 이미 추려 준 최근 실수에서 **이 축에 들어가는 것만** 골라 냅니다. 여기서
 * 통계를 다시 내지 않는 이유는 축이 쓴 표본 수(`axis.sample`)가 이미 계약에 들어 있기 때문입니다 —
 * 목록은 "어떤 문제였나"를 보여 주는 예시이고, 세는 일은 state/coach 가 합니다.
 *
 * 그래서 이 파일이 특히 조심하는 것이 **목록과 숫자가 서로 다른 말을 하지 않는 것**입니다.
 *  - `belongs()` 는 axes.ts 의 분류를 그대로 따라갑니다. 예전처럼 `default: true` 로 흘리면
 *    3벳·4벳 축의 근거라며 오픈 대응 실수만 열 줄 늘어놓게 됩니다.
 *  - 그룹이 둘인 축(seat·pressure)은 목록을 두 덩이로 나눕니다. 이 축들은 한쪽 편차가 아니라
 *    **두 쪽의 차이**를 재므로, 어느 쪽이 비어 있는지가 곧 왜 잠겼는지입니다.
 *  - 잠긴 축은 `sample` 을 적지 않습니다. 잠긴 축의 sample 은 두 그룹의 합이라 한쪽이 0이어도
 *    큰 숫자가 찍히는데, 그걸 "이 줄이 쓴 실수"라고 적으면 재지도 않은 것을 잰 척하게 됩니다.
 */
import { ActionBadge } from '../../components/ActionBadge';
import { Sheet } from '../../components/ui/Sheet';
import { SCENARIO_ACTIONS, type Pos, type ScenarioKind } from '../../poker/types';
import type { AxisId, AxisView, CoachMistake } from '../../state/coach/types';
import { KIND_SHORT_KO } from '../home/copy';

/** 목록에 올리는 최대 개수. 더 길어지면 읽지 않고 스크롤만 합니다. */
const SHOWN = 10;

/** seat 축의 두 그룹. SB·BB 는 이 축에서 통째로 빠집니다(axes.ts 와 같은 기준). */
const EARLY: readonly Pos[] = ['UTG', 'HJ'];
const LATE: readonly Pos[] = ['CO', 'BTN'];

/** pressure 축의 두 그룹. 큰 팟(HEAT)과 첫 결정(OPEN)을 견줍니다(axes.ts 와 같은 기준). */
const HEAT: readonly ScenarioKind[] = ['vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'];
const OPEN: readonly ScenarioKind[] = ['rfi', 'vs_open'];

/**
 * 이 축이 무엇을 재는지. SPEC §1 의 '왜 중요한가'를 카드 말투로 줄인 것입니다.
 * 사람을 평가하는 말이 들어가지 않도록 전부 '문제를 풀 때의 행동'으로만 적었습니다.
 *
 * seat·pressure 는 한 줄을 더 씁니다 — 이 둘은 두 쪽을 견주는 축이라, 그 말을 안 해 두면
 * 아래 목록에 나오는 반대쪽 실수가 왜 여기 있는지 알 수 없습니다.
 */
const ABOUT: Record<AxisId, readonly string[]> = {
  aggression: ['들어가기로 정한 다음이 문제입니다.', '콜로 새는지 올려서 새는지를 봅니다.'],
  entry: ['가장 비싼 실수는 들어가지 말았어야 할 판입니다.', '이 줄 하나가 나머지 실수의 절반을 만듭니다.'],
  seat: ['같은 패라도 UTG와 BTN에서 값이 다릅니다.', '자리를 안 보고 패만 보면 여기서 샙니다.', '앞자리와 뒷자리를 따로 세서 견줍니다.'],
  pressure: ['3벳·4벳이 오면 팟이 커집니다.', '여기서 한 번 어긋나면 손해가 제일 큽니다.', '3벳·4벳 쪽과 오픈 쪽을 따로 세서 견줍니다.'],
};

/** 그룹 하나. `label` 은 목록 덩이의 제목이자 '어느 쪽이 비었나'를 읽는 이름입니다. */
interface AxisGroup {
  label: string;
  has(m: CoachMistake): boolean;
}

/**
 * 그룹이 둘인 축만 여기 들어갑니다. 순서는 axes.ts 의 (pos, neg) 와 같습니다 — 앞이 t 의 양수 쪽.
 * 라벨은 axes.ts 의 `needWhere`('3벳·4벳 자리' 등)와 같은 것을 가리키되 제목으로 읽히게 줄였습니다.
 */
const GROUPED: Partial<Record<AxisId, readonly [AxisGroup, AxisGroup]>> = {
  seat: [
    { label: '앞자리(UTG·HJ)', has: (m) => EARLY.includes(m.hero) },
    { label: '뒷자리(CO·BTN)', has: (m) => LATE.includes(m.hero) },
  ],
  pressure: [
    { label: '3벳·4벳 쪽', has: (m) => HEAT.includes(m.kind) },
    { label: '오픈 쪽', has: (m) => OPEN.includes(m.kind) },
  ],
};

/**
 * 축마다 쓰는 실수의 조건. axes.ts 의 분류와 같은 기준입니다 — 다만 여기서는 세는 게 아니라
 * 보여 줄 예시를 고르는 용도라 `sample` 과 개수가 다를 수 있고, 그래서 밑에 표본 수를 따로 적습니다.
 *
 * 네 축을 모두 적습니다. `default` 로 뭉치면 새 축이 생겼을 때 조용히 '전부 통과'가 되는데,
 * pressure 가 바로 그렇게 오픈 대응 실수를 3벳·4벳 축의 근거로 내보내고 있었습니다.
 */
function belongs(id: AxisId, m: CoachMistake): boolean {
  switch (id) {
    // 오답 선택지가 둘인 상황만 방향을 말해 줍니다(rfi·vs_5bet 은 선택지가 하나뿐입니다).
    case 'aggression':
      return SCENARIO_ACTIONS[m.kind].length === 3;
    // 거르는 조건이 없는 유일한 축입니다 — 실수 전체가 그대로 재료입니다.
    case 'entry':
      return true;
    // 두 그룹 중 한쪽에 들어가야 재료가 됩니다. seat 는 SB·BB 가, pressure 는 아무것도 빠지지 않습니다.
    case 'seat':
    case 'pressure': {
      const groups = GROUPED[id];
      return groups !== undefined && groups.some((g) => g.has(m));
    }
  }
}

/** 화면에 그리는 목록 한 덩이. `label` 이 null 이면 그룹 구분이 없는 축입니다. */
interface Chunk {
  label: string | null;
  rows: CoachMistake[];
}

/**
 * 받은 최근 실수를 이 축의 덩이로 나눕니다.
 *
 * 그룹이 둘인 축에서 앞에서부터 10개만 자르면 최근에 한쪽만 푼 사람에게는 그 한쪽만 열 줄 나옵니다.
 * 제목은 두 쪽을 말하는데 목록은 한쪽 얘기만 하던 어긋남이 거기서 났습니다. 그래서 먼저 양쪽에
 * 절반씩 자리를 주고, 남는 자리만 더 많은 쪽이 가져갑니다 — 한쪽이 0줄이면 그건 자리가 모자라서가
 * 아니라 **정말로 없는 것**이라는 뜻이 됩니다.
 */
function chunksOf(id: AxisId, mistakes: CoachMistake[]): Chunk[] {
  const mine = mistakes.filter((m) => belongs(id, m));
  const groups = GROUPED[id];
  if (!groups) return [{ label: null, rows: mine.slice(0, SHOWN) }];

  const pools = groups.map((g) => mine.filter((m) => g.has(m)));
  const half = Math.floor(SHOWN / 2);
  const take = pools.map((p) => Math.min(p.length, half));
  let left = SHOWN - take.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pools.length && left > 0; i += 1) {
    const more = Math.min(left, pools[i].length - take[i]);
    take[i] += more;
    left -= more;
  }
  return groups.map((g, i) => ({ label: g.label, rows: pools[i].slice(0, take[i]) }));
}

/**
 * 잠긴 이유 한 줄. `lockedBy`·`needWhere`·`baselineNeed` 는 axes.ts 가 붙이는 **선택** 필드라
 * 없으면 예전처럼 "실수 N개가 더 모이면 열려요"로 떨어집니다.
 *
 * 있으면 두 가지 거짓말을 막습니다. 하나는 잠금을 쥔 쪽을 안 적는 것 — 3벳·4벳 쪽이 비어서 잠긴
 * 축에 그냥 "실수 12개 더"라고 적으면, 오픈 대응만 푸는 사람은 실수를 아무리 쌓아도 안 줄어드는
 * 숙제를 받습니다. 다른 하나는 재 본 적 없는 자리를 "모자라다"고 말하는 것 — 기준선 자체가 없으면
 * 실수가 아니라 문제부터 풀어야 합니다.
 */
function lockLine(axis: AxisView): string {
  const where = axis.needWhere;
  if (axis.lockedBy === 'no-baseline') {
    return where ? `아직 ${where} 기록이 없어요 · 거기 문제부터 풀면 열려요` : '아직 답을 낸 기록이 없어요 · 문제부터 풀면 열려요';
  }
  if (axis.lockedBy === 'baseline') {
    return `${where ? `${where} ` : ''}문제를 ${axis.baselineNeed ?? 0}개 더 풀면 기준이 잡혀요`;
  }
  return `${where ? `${where} ` : ''}실수 ${axis.need}개가 더 모이면 열려요`;
}

function situation(kind: ScenarioKind, hero: Pos): string {
  return `${hero} · ${KIND_SHORT_KO[kind]}`;
}

function Rows({ rows }: { rows: CoachMistake[] }): JSX.Element {
  return (
    <ul className="coach-axissheet__list">
      {rows.map((m, i) => (
        <li key={`${m.key}:${i}`} className="coach-axissheet__row">
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
  );
}

export function AxisSheet({ axis, open, onClose, mistakes }: { axis: AxisView | null; open: boolean; onClose(): void; mistakes: CoachMistake[] }): JSX.Element | null {
  if (!axis) return null;
  const chunks = chunksOf(axis.id, mistakes);
  const shown = chunks.reduce((n, c) => n + c.rows.length, 0);
  const tail = shown > 0 ? ` · 위에는 최근 ${shown}개` : '';

  return (
    <Sheet open={open} onClose={onClose} detent="half" title={`${axis.koLabel} 근거`}>
      <div className="coach-axissheet">
        {ABOUT[axis.id].map((line) => (
          <p key={line} className="coach-axissheet__about">
            {line}
          </p>
        ))}

        {axis.unlocked ? (
          <p className="coach-axissheet__poles">
            <span>왼쪽 · {axis.poles[0]}</span>
            <span>오른쪽 · {axis.poles[1]}</span>
          </p>
        ) : (
          <p className="coach-axissheet__locked tnum">{lockLine(axis)}</p>
        )}

        {chunks.map((c) =>
          c.label === null ? (
            c.rows.length > 0 ? (
              <Rows key="all" rows={c.rows} />
            ) : (
              <p key="all" className="coach-axissheet__empty">
                이 줄에 들어간 실수가 아직 없어요
              </p>
            )
          ) : (
            // 제목의 개수는 '바로 아래 몇 줄이 보이는가'입니다. 두 제목의 합이 맨 아래 '위에는
            // 최근 N개'와 맞아떨어져야 읽는 사람이 숫자를 검산할 수 있습니다.
            <div key={c.label} className="coach-axissheet__group">
              <p className="coach-axissheet__grouphead tnum">
                {c.label} {c.rows.length}개
              </p>
              {c.rows.length > 0 ? <Rows rows={c.rows} /> : <p className="coach-axissheet__empty">최근 실수 중에는 없어요</p>}
            </div>
          ),
        )}

        <p className="coach-axissheet__foot tnum">
          {/* 잠긴 축의 sample 은 두 그룹의 합이라 한쪽이 0이어도 큰 숫자가 됩니다. 재지 않은 것을
              "이 줄이 쓴 실수"라고 적지 않고, 무엇이 모자란지는 위의 잠금 한 줄이 말합니다. */}
          {axis.unlocked ? `이 줄이 쓴 실수 ${axis.sample}개${tail}` : `아직 이 줄로는 재지 않았어요${tail}`}
        </p>
      </div>
    </Sheet>
  );
}
