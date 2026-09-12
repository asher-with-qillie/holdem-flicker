import { ACTION_LABEL_KO, ACTION_SHORT_KO, type Action, type ScenarioKind } from '../poker/types';

/** Context-aware label: e.g. allin in vs_4bet is "5벳 올인", fourbet in cold_4bet is "콜드 4벳". */
export function actionLabel(action: Action, kind?: ScenarioKind, short = false): string {
  if (kind === 'vs_4bet' && action === 'allin') return short ? '올인' : '5벳 올인';
  if (kind === 'vs_5bet' && action === 'call') return short ? '콜' : '올인 콜';
  if (kind === 'cold_4bet' && action === 'fourbet') return short ? '4벳' : '콜드 4벳';
  if (kind === 'rfi' && action === 'raise') return short ? '오픈' : '오픈 레이즈';
  return short ? ACTION_SHORT_KO[action] : ACTION_LABEL_KO[action];
}

export function ActionBadge({ action, kind, size = 'md', short }: { action: Action; kind?: ScenarioKind; size?: 'sm' | 'md' | 'lg'; short?: boolean }) {
  return <span className={`badge badge--${size} badge--${action}`}>{actionLabel(action, kind, short)}</span>;
}
