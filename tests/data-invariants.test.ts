import { describe, expect, it } from 'vitest';
import { getChartCells, getChartDef, hasChart } from '../src/poker/data';
import { ALL_HANDS, parseHandName } from '../src/poker/hands';
import { AGGRESSION_ORDER, foldWeight, primaryAction, restAction } from '../src/poker/range';
import { allScenarios, positionsAfter, positionsBefore, scenarioKey } from '../src/poker/scenarios';
import { RANKS, type Action, type HandName, type Pos, type Scenario } from '../src/poker/types';

/*
 * 차트 데이터 불변식 — docs/ATLAS_SPEC.md §7 테스트 11~15 (CI 가드).
 * 자리별 보기의 '부터'·'어디서든'·'까지' 문장은 이 불변식 위에 서 있습니다. 하나라도 깨지면
 * 어느 패에서, 어떤 문장이 거짓이 되는지 함께 찍습니다 — 차트를 고친 사람이 바로 볼 수 있게.
 *
 * 차트를 책(MPT 5장)에 맞춘 뒤로 일부 불변식은 책이 일부러 깨는 곳이 생겼어요(villain 축의 블라인드 경계, BB 의 BTN/SB 3벳 모양,
 * BB 의 림프 대응 블러프). 그런 곳은 지우지 않고 **어느 묶음이 단조이고, 예외가 정확히 어디이며, 책의 어느 말 때문인지**로 다시 적었어요.
 */

const aggression = (a: Action) => AGGRESSION_ORDER.indexOf(a);
const CORE: Pos[] = ['UTG', 'HJ', 'CO', 'BTN'];
const raiseW = (hero: Pos, hand: HandName) => getChartCells({ kind: 'rfi', hero })[hand]?.raise ?? 0;
const contW = (s: Scenario, hand: HandName) => 1 - foldWeight(getChartCells(s)[hand]);
const prim = (s: Scenario, hand: HandName) => primaryAction(getChartCells(s)[hand]);

/**
 * 줄의 계속 비중이 킥커 내림차순으로 비증가인가 — 옛 atlas.rowBoundary.monotone 을 여기서 직접 계산합니다
 * (그 함수는 line.ts 의 lineSentence 로 대체돼 지웠습니다). 줄은 페어 대각선, 또는 같은 높은 카드·같은 수티드 여부.
 */
function rowMonotone(s: Scenario, rep: HandName): { label: string; monotone: boolean } {
  const info = parseHandName(rep);
  let hands: HandName[];
  let label: string;
  if (info.kind === 'pair') {
    hands = RANKS.map((r) => `${r}${r}`);
    label = '포켓페어';
  } else {
    const suf = info.kind === 'suited' ? 's' : 'o';
    hands = RANKS.slice(RANKS.indexOf(info.high) + 1).map((r) => `${info.high}${r}${suf}`);
    label = `${info.kind === 'suited' ? '수티드' : '오프수트'} ${info.high}`;
  }
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  const weights = hands.map((h) => 1 - (rest === 'fold' ? foldWeight(cells[h]) : (cells[h]?.[rest] ?? 0)));
  return { label, monotone: weights.every((w, i) => i === 0 || w <= weights[i - 1] + 1e-6) };
}

describe('chart invariants the atlas sentences rely on', () => {
  it('RFI raise weight is non-decreasing UTG→BTN for all 169 hands', () => {
    const bad: string[] = [];
    for (const hand of ALL_HANDS) {
      const w = CORE.map((p) => raiseW(p, hand));
      for (let i = 1; i < w.length; i++) {
        if (w[i] < w[i - 1] - 1e-6) bad.push(`${hand}: ${CORE[i - 1]} ${w[i - 1]} > ${CORE[i]} ${w[i]} — "${hand}는 ${CORE[i - 1]}부터 오픈합니다"가 거짓이 됩니다`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('vs_open · vs_3bet: villain 축(상대 자리 순서)으로 단조인 묶음과, 책이 일부러 깨는 예외', () => {
    // villain 축 단조(상대가 뒷자리일수록 같거나 더 공격적 · 같거나 더 많이 계속)는 예전 seatSummary 의 '{v} 오픈부터 {act}' 문장이
    // 기대던 사실이에요. 지금 자리별 보기 문장은 이 축의 '부터'를 쓰지 않아요 — tests/atlas.test.ts 의 claims 재계산이 '부터'를
    // rfi 첫 문장 밖에서 막고, 칸을 부르는 문장(다이제스트 · 비교 · 오픈 대응 둘째 문장)은 칸마다 claims 를 차트와 대조합니다.
    // 그래서 이 테스트는 차트의 모양을 정확히 적어 두는 가드예요: 예외가 늘거나 줄면 어느 칸인지 찍힙니다.
    const prim: string[] = [];
    const cont: string[] = [];
    let rows = 0;
    for (const kind of ['vs_open', 'vs_3bet'] as const) {
      for (const hero of ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Pos[]) {
        const villains = kind === 'vs_open' ? positionsBefore(hero) : positionsAfter(hero);
        if (villains.length < 2) continue;
        for (const hand of ALL_HANDS) {
          rows++;
          for (let i = 1; i < villains.length; i++) {
            const a: Scenario = { kind, hero, villain: villains[i - 1] };
            const b: Scenario = { kind, hero, villain: villains[i] };
            const step = `${kind} ${hero} ${villains[i - 1]}→${villains[i]} ${hand}`;
            if (aggression(primaryAction(getChartCells(b)[hand])) < aggression(primaryAction(getChartCells(a)[hand]))) prim.push(step);
            if (contW(b, hand) < contW(a, hand) - 1e-6) cont.push(step);
          }
        }
      }
    }
    expect(rows).toBe(676 * 2);
    // vs_open — 1순위: BB 만 예외. 책 5장 5절: BB 는 BTN 상대로 선형으로, SB 상대로 양극화로 3벳해요. 그래서 BTN 에게 3벳하던
    // 중간 패(A9s · ATo 는 늘, A8s~A6s · KTs · K9s · QJs · QTs · KJo · QJo · KTo · A9o · 77 은 주로 · 반반)는 SB 에게 늘 콜하고,
    // CO 에게 3벳 · 콜 반반이던 수티드 커넥터(87s · 76s · 65s · 54s)는 선형인 BTN 상대 3벳에서 빠져 늘 콜해요.
    const bbBtnToSb = ['A9s', 'A8s', 'A7s', 'A6s', 'KTs', 'K9s', 'QJs', 'QTs', 'KJo', 'QJo', 'ATo', 'KTo', 'A9o', '77'];
    const bbCoToBtn = ['87s', '76s', '65s', '54s'];
    const openPrim = prim.filter((x) => x.startsWith('vs_open'));
    expect(openPrim.filter((x) => x.startsWith('vs_open BB BTN→SB ')).map((x) => x.split(' ').at(-1)).sort()).toEqual([...bbBtnToSb].sort());
    expect(openPrim.filter((x) => x.startsWith('vs_open BB CO→BTN ')).map((x) => x.split(' ').at(-1)).sort()).toEqual([...bbCoToBtn].sort());
    expect(openPrim.length).toBe(bbBtnToSb.length + bbCoToBtn.length);
    // vs_open — 계속 비중: BTN 의 작은 페어 둘만 예외. 책 5장 5절: 오프너가 넓을수록 BTN 의 콜 범위는 줄어요(블라인드의 스퀴즈가 늘어서).
    expect(cont.filter((x) => x.startsWith('vs_open'))).toEqual(['vs_open BTN HJ→CO 33', 'vs_open BTN UTG→HJ 22']);
    // vs_3bet: 블라인드가 아닌 3벳(HJ · CO · BTN — 오프너는 포지션 없음)끼리, 블라인드 3벳(SB · BB — 포지션 있음)끼리는 단조이고,
    // 예외는 전부 BTN → SB 한 걸음(포지션이 뒤집히는 곳)이에요. 책 5장 3절: 포지션이 없으면 4벳과 폴드가 늘고, 있으면 콜 위주예요
    // (HJ 는 CO 3벳에 약 22%, BB 3벳에 약 10%를 4벳). 블라인드의 3벳은 크기도 커서 덜 지켜요.
    const v3 = [...prim, ...cont].filter((x) => x.startsWith('vs_3bet'));
    expect(v3.length).toBe(32);
    for (const x of v3) expect(x, x).toMatch(/^vs_3bet (UTG|HJ|CO) BTN→SB /);
    // 그 한 걸음에서 1순위는 블라인드 3벳 쪽으로 갈 때 더 공격적이 되지 않아요(4벳 → 콜 · 폴드, 콜 → 폴드 쪽으로만 바뀜).
    // 계속 비중은 몇 패(HJ 의 AQo · 55, CO 의 A9s)가 블라인드 3벳에 오히려 늘어요 — 포지션이 있어 콜로 지키는 패예요.
    for (const hero of ['UTG', 'HJ', 'CO'] as Pos[]) {
      for (const hand of ALL_HANDS) {
        const vsBtn = primaryAction(getChartCells({ kind: 'vs_3bet', hero, villain: 'BTN' })[hand]);
        const vsSb = primaryAction(getChartCells({ kind: 'vs_3bet', hero, villain: 'SB' })[hand]);
        expect(aggression(vsSb), `${hero} ${hand}: BTN 3벳 ${vsBtn} → SB 3벳 ${vsSb}`).toBeLessThanOrEqual(aggression(vsBtn));
      }
    }
    expect(prim.length + cont.length).toBe(52);
  });

  it('vs_open: BB continues at least as much as every other hero vs the same opener', () => {
    const bad: string[] = [];
    for (const villain of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) {
      for (const hero of positionsAfter(villain)) {
        if (hero === 'BB') continue;
        for (const hand of ALL_HANDS) {
          const bb = contW({ kind: 'vs_open', hero: 'BB', villain }, hand);
          const other = contW({ kind: 'vs_open', hero, villain }, hand);
          if (bb < other - 1e-6) bad.push(`${hand} vs ${villain}: BB ${bb} < ${hero} ${other} — "BB는 … 가장 넓게 콜합니다"가 거짓이 됩니다`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('non-monotone row boundaries occur only in suited-A rows and in the BB limp-raise offsuit rows', () => {
    // 줄 대표 패: 페어 줄 AA, 수티드/오프수트 줄은 그 줄의 첫 패(AKs, KQs, …, 32s / AKo, …, 32o) — 74차트 × 25줄 = 1850.
    const reps: HandName[] = ['AA'];
    for (let i = 0; i < RANKS.length - 1; i++) {
      reps.push(`${RANKS[i]}${RANKS[i + 1]}s`);
      reps.push(`${RANKS[i]}${RANKS[i + 1]}o`);
    }
    expect(reps.length).toBe(25);
    const nonMonotone: string[] = [];
    let rows = 0;
    for (const s of allScenarios().filter(hasChart)) {
      for (const rep of reps) {
        rows++;
        const r = rowMonotone({ kind: s.kind, hero: s.hero, villain: s.villain }, rep);
        if (!r.monotone) nonMonotone.push(`${scenarioKey(s)} ${r.label}`);
      }
    }
    expect(rows).toBe(1850);
    // 35줄 = 수티드 A 30줄(A5s · A4s 를 블로커 3벳 · 4벳 블러프로 쓰고 A9s~A6s 는 빼요 — 책 4 · 5장의 블로커) +
    // BB 의 림프 대응 오프수트 5줄(98o · 87o · 76o · 65o · 54o 줄: SB 의 림프에 양극화로 레이즈해 가장 약한 오프수트 93o~92o · 84o~82o ·
    // 74o~72o · 64o~62o · 53o~52o 를 블러프로 쓰고 중간은 체크 — 책이 아니라 공개 솔버 자료, BOOK_CHART_SPEC §5). 줄 문장은 단조롭지 않은 줄을
    // 따로 다뤄요(line.ts 의 P4 — '까지'를 쓰지 않음).
    const sAce = nonMonotone.filter((row) => row.endsWith('수티드 A'));
    const bbLimp = nonMonotone.filter((row) => !row.endsWith('수티드 A'));
    expect(sAce.length).toBe(30);
    expect(bbLimp).toEqual(['vs_limp:BB 오프수트 9', 'vs_limp:BB 오프수트 8', 'vs_limp:BB 오프수트 7', 'vs_limp:BB 오프수트 6', 'vs_limp:BB 오프수트 5']);
    expect(nonMonotone.length).toBe(35);
    for (const row of nonMonotone) expect(row.endsWith('수티드 A') || row.startsWith('vs_limp:BB 오프수트'), `${row} — "{seat}는 {줄}을 X까지 오픈합니다"가 거짓이 됩니다`).toBe(true);
    // 수티드 A 가 아닌 줄은 전부 단조이므로 '까지' 문장을 쓸 수 있습니다.
    expect(parseHandName('A5s').kind).toBe('suited');
  });

  it('SB differs from BTN in rfi primary only by limping (book 5장 2절: SB 만 림프를 섞어요)', () => {
    const sb = (hand: HandName) => prim({ kind: 'rfi', hero: 'SB' }, hand);
    const btn = (hand: HandName) => prim({ kind: 'rfi', hero: 'BTN' }, hand);
    const differs = ALL_HANDS.filter((hand) => sb(hand) !== btn(hand));
    // 바뀌면 rfiThesis 의 SB 절 규칙("단, SB에서는 {act}해요")과 'sbOnly' 꼴('UTG~BTN에서는 폴드하고, SB에서는 림프해요')을 다시 볼 것.
    // 71패, 전부 SB 림프: BTN 오픈 → SB 림프 40(약하지만 쳐지는 패 — 33 · 22, Q8s~Q2s · J8s~J4s · T8s~T6s 와 98s~53s 같은 약한 수티드,
    // K9o · K8o · Q9o~T9o · QTo · JTo · Q8o~T8o · A4o 같은 약한 오프수트),
    // BTN 폴드 → SB 림프 31(반값 할인으로만 이득인 패). SB 가 BTN 이 폴드하는 패를 레이즈하거나, BTN 이 여는 패를 폴드하는 일은 없어요.
    expect(differs.length).toBe(71);
    for (const hand of differs) expect(sb(hand), hand).toBe('limp');
    expect(differs.filter((h) => btn(h) === 'raise').length).toBe(40);
    expect(differs.filter((h) => btn(h) === 'fold').length).toBe(31);
    // SB 가 조금이라도 레이즈하는 패는 BTN 이 늘 레이즈해요 — 그래서 'X부터 오픈해요'의 SB 절은 림프와 함정 림프(AA · KK · QQ · JJ · AKo · AQo 일부)만 말하면 돼요.
    for (const hand of ALL_HANDS) {
      if ((getChartCells({ kind: 'rfi', hero: 'SB' })[hand]?.raise ?? 0) > 0) expect(raiseW('BTN', hand), hand).toBe(1);
    }
  });
});
