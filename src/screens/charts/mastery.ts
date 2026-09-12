/**
 * P2 mastery overlay for the chart grid (spec §5.8 "내 기록"): one state per hand of the selected scenario,
 * derived from the SRS record. Mirrors srs.ts's derived counts (§7.1) and its weak-set predicate (§6.4):
 *   mastered  = review && intervalDays ≥ 7            → 2px inner mint border
 *   weak      = lapses ≥ 1 || ease < 1.8 || quiz miss within 30 d (unless mastered)  → coral dot
 *   learning  = any other rated card                  → amber dot
 *   unseen    = no record, or exposed but never rated → dimmed
 */
import { ALL_HANDS } from '../../poker/hands';
import type { HandName, Scenario } from '../../poker/types';
import { cardKeyOf, getCard, learnableHands, type SrsCard } from '../../state/srs';
import type { MasteryOverlay, MasteryState } from '../../components/RangeGrid';

const DAY = 86_400_000;
const LEARNED_DAYS = 7;
const WEAK_EASE = 1.8;
const WEAK_QUIZ_WINDOW = 30 * DAY;

export function masteryOf(card: SrsCard | undefined, now: number = Date.now()): MasteryState {
  if (!card || card.state === 'new') return 'unseen';
  if (card.state === 'review' && card.intervalDays >= LEARNED_DAYS) return 'mastered';
  const quizMiss = card.quizWrongAt !== undefined && card.quizWrongAt >= now - WEAK_QUIZ_WINDOW;
  if (card.lapses >= 1 || card.ease < WEAK_EASE || quizMiss) return 'weak';
  return 'learning';
}

export interface MasterySummary {
  overlay: MasteryOverlay;
  /** `unseen` counts only hands in the learnable set (non-fold + boundary folds); rated interior folds still count in their state. */
  counts: Record<MasteryState, number>;
  /** Size of the learnable set for this chart. */
  learnable: number;
}

export function masteryFor(scenario: Scenario, now: number = Date.now()): MasterySummary {
  const learnable = new Set<HandName>(learnableHands(scenario));
  const overlay: MasteryOverlay = {};
  const counts: Record<MasteryState, number> = { mastered: 0, learning: 0, weak: 0, unseen: 0 };
  for (const hand of ALL_HANDS) {
    const state = masteryOf(getCard(cardKeyOf(scenario, hand)), now);
    overlay[hand] = state;
    if (state !== 'unseen' || learnable.has(hand)) counts[state] += 1;
  }
  return { overlay, counts, learnable: learnable.size };
}
