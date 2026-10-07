import { ACTION_LABEL_KO, ACTION_SHORT_KO, type Action, type ScenarioKind } from '../poker/types';
import { actWord } from '../poker/ko';

/**
 * 버튼·캡슐·문장이 같이 쓰는 액션 이름(docs/EXPLAIN_SPEC.md §2.2). 상황(kind)을 알면 긴 이름도 짧은 이름 그대로입니다 —
 * '5벳 올인'·'올인 콜'·'콜드 4벳'·'오픈 레이즈'·'림프에 레이즈'는 폐기했습니다. 문장은 '올인해요'·'콜해요'라고 말하는데
 * 버튼만 다른 이름이면 같은 단서가 둘로 갈립니다. 360px 선택 버튼 폭도 오히려 줄어듭니다.
 * 림프에 올리는 건 '오픈'이 아니라 '레이즈'입니다(ko.actWord).
 */
export function actionLabel(action: Action, kind?: ScenarioKind, short = false): string {
  if (kind) return actWord(action, kind);
  return short ? ACTION_SHORT_KO[action] : ACTION_LABEL_KO[action];
}

export function ActionBadge({ action, kind, size = 'md', short }: { action: Action; kind?: ScenarioKind; size?: 'sm' | 'md' | 'lg'; short?: boolean }) {
  return <span className={`badge badge--${size} badge--${action}`}>{actionLabel(action, kind, short)}</span>;
}
