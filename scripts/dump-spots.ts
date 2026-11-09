// All 74 spot reasons (theory layer) — for review.
import { allSpotReasons } from '../src/poker/theory/spot';
for (const { id, reason: r } of allSpotReasons()) {
  console.log(`## ${id}\n${r.lines.join(' ')}\n  [${r.principles.join(', ')}] ${r.numbers ?? ''}\n  책과 다른 점: ${r.bookDiff ?? '-'}\n`);
}
