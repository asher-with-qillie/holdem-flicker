/**
 * 169패 전부의 에퀴티를 한 범위에 맞대 JSON 으로 — 차트를 책에 맞춰 다시 만들 때 순서와 경계를 보는 용도.
 *   npx vite-node scripts/equity-table.ts <villain> [trials-per-hand] > out.json
 *   villain: 범위 문자열이나 chart:<id>:<action> (scripts/equity.ts 와 같은 형식)
 */
import { ALL_HANDS } from '../src/poker/hands';
import { equityVs } from './equity-lib';

const [villSpec, trialsArg] = process.argv.slice(2);
if (!villSpec) {
  console.error('usage: equity-table.ts <villain> [trials-per-hand]');
  process.exit(1);
}
const trials = Number(trialsArg ?? 20000);
const out: Record<string, number> = {};
for (const h of ALL_HANDS) out[h] = Math.round(equityVs(h, villSpec, trials).eq * 1000) / 10;
console.log(JSON.stringify(out));
