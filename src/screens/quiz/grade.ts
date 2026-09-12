import type { Step } from '../../poker/trainer';
import type { Action } from '../../poker/types';

export type Grade = 'correct' | 'partial' | 'wrong';

/** A non-primary action with at least this much weight in the mix counts as a partial answer. */
export const PARTIAL_THRESHOLD = 0.4;

/** Weight (0..1) of `action` in the step's full mix (fold included). */
export function actionWeight(step: Step, action: Action): number {
  return step.mixList.find((m) => m.action === action)?.weight ?? 0;
}

/**
 * correct : chosen === step.answer (the memorized, highest-frequency action)
 * partial : any other action the solver takes ≥ 40% of the time
 * wrong   : everything else
 */
export function gradeAnswer(step: Step, chosen: Action): Grade {
  if (chosen === step.answer) return 'correct';
  if (actionWeight(step, chosen) >= PARTIAL_THRESHOLD) return 'partial';
  return 'wrong';
}

export const GRADE_LABEL_KO: Record<Grade, string> = {
  correct: '정답',
  partial: '부분 정답',
  wrong: '오답',
};
