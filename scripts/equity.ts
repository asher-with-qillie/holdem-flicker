/**
 * Preflop all-in equity: one hand against a range, Monte Carlo over boards. For checking explanation numbers
 * ("내 Q♠Q♦ vs 상대 A♠K♦ → 승률 57%", "상대 올인 레인지에 AKo는 약 40%").
 *
 *   npx vite-node scripts/equity.ts <hero> <villain> [trials]
 *     hero    — a hand class (AKo, QQ, A5s) averaged over its combos, or exact cards (AsKd)
 *     villain — a range string (KK+,AKs,AQs:0.5,A5s-A2s), exact cards (AhKh), or a chart action:
 *               chart:<chart id>:<action>   e.g. chart:vs_4bet:HJ:UTG:allin  (weights from the chart)
 *   prints: equity (win + tie/2) and the villain combos used after card removal.
 */
import { equityVs } from './equity-lib';

const [heroSpec, villSpec, trialsArg] = process.argv.slice(2);
if (!heroSpec || !villSpec) {
  console.error('usage: equity.ts <hero> <villain> [trials]');
  process.exit(1);
}
const trials = Number(trialsArg ?? 200000);
const { eq, combos } = equityVs(heroSpec, villSpec, trials);
console.log(`${heroSpec} vs ${villSpec}: equity ${(eq * 100).toFixed(1)}%  (villain combos after removal ≈ ${combos.toFixed(1)}, trials ${trials})`);
