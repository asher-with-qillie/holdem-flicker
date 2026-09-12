/** Dump chart defs from a data module to JSON. Usage: npx vite-node scripts/dump-charts.ts <module> <out.json> */
import { writeFileSync } from 'node:fs';
import * as rfi from '../src/poker/data/rfi';
import * as vsOpen from '../src/poker/data/vsOpen';
import * as vs3bet from '../src/poker/data/vs3bet';
import * as vs4bet from '../src/poker/data/vs4bet';
import * as vs5bet from '../src/poker/data/vs5bet';
import * as cold4bet from '../src/poker/data/cold4bet';
const mods: Record<string, unknown[]> = {
  rfi: rfi.RFI_CHARTS,
  vsOpen: vsOpen.VS_OPEN_CHARTS,
  vs3bet: vs3bet.VS_3BET_CHARTS,
  vs4bet: vs4bet.VS_4BET_CHARTS,
  vs5bet: vs5bet.VS_5BET_CHARTS,
  cold4bet: cold4bet.COLD_4BET_CHARTS,
};
const [mod, out] = process.argv.slice(2);
const charts = mods[mod];
if (!charts) throw new Error(`unknown module ${mod}; one of ${Object.keys(mods).join(', ')}`);
writeFileSync(out, JSON.stringify({ charts }, null, 2));
console.log(`wrote ${charts.length} charts to ${out}`);
