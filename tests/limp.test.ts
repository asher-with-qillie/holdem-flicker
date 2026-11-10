/**
 * 림프(SB 첫 진입) 기반 — 끝에서 끝까지.
 *
 * 실제 rfi:SB 차트는 아직 림프가 없습니다(차트는 책에 맞춰 따로 다시 만듭니다). 그래서 이 파일만 `vi.mock` 으로
 * rfi:SB 를 시험용 차트(tests/fixtures/sbLimpChart.ts — 레이즈 24% · 림프 38%)로 갈아 끼우고, 림프가 지나가는 길을
 * 전부 밟아 봅니다: 액션 순서 · 캡슐과 줄 문장 · 채점 · 해설 시트 · 자리별 보기(도달) · 트레이너 · SRS 왕복 · 코치 축.
 * 'BB 림프 대응 = SB 가 림프했고 BB 차례'와 책의 베팅 크기도 여기서 확인합니다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memStorage } = vi.hoisted(() => {
  const map = new Map<string, string>();
  const memStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, configurable: true, writable: true });
  return { memStorage };
});

vi.mock('../src/poker/data/rfi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/poker/data/rfi')>();
  const { SB_LIMP_CHART } = await import('./fixtures/sbLimpChart');
  return { RFI_CHARTS: mod.RFI_CHARTS.map((d) => (d.id === 'rfi:SB' ? SB_LIMP_CHART : d)) };
});

import { readFileSync } from 'node:fs';
import { gateText, handAtlas, isReachable, rfiThesis, sbOpenLine, sectionDigest } from '../src/poker/atlas';
import { getChartCells } from '../src/poker/data';
import { explainStep, heroIsIP } from '../src/poker/explain';
import { ALL_HANDS } from '../src/poker/hands';
import { actWord, bannedHits, emWidth, josa, splitOf, splitPhrase, verb } from '../src/poker/ko';
import { capsuleLabel, lineOf, lineSentence, LINE_MAX_EM } from '../src/poker/line';
import { priceFacts } from '../src/poker/priceFacts';
import { AGGRESSION_ORDER, buildChart, fullMix, primaryAction, rangeShare } from '../src/poker/range';
import { limperOf, scenarioSituation, scenarioTitle } from '../src/poker/scenarios';
import { bucketOf, reasonKey } from '../src/poker/theory/keys';
import { PRINCIPLES } from '../src/poker/theory/principles';
import { fourbetSize, limpFacts, priceOf, threebetSize } from '../src/poker/theory/price';
import { spotReason } from '../src/poker/theory/spot';
import { buildSteps, cellDealWeight, pruneSteps, stepFor, type SessionOptions } from '../src/poker/trainer';
import { ACTIONS, ACTION_SHORT_KO, scenarioActions, type Action, type ChartDef, type Pos, type Scenario } from '../src/poker/types';
import { gradeAnswer } from '../src/screens/quiz/grade';
import { DISCLAIMER, DISCLAIMER_BB_LIMP, disclaimerFor } from '../src/screens/charts/disclaimer';
import { computeAxes } from '../src/state/coach/axes';
import { PATTERN_RULES } from '../src/state/coach/patterns';
import type { CoachMistake, SeenRow } from '../src/state/coach/types';
import { cellBackground } from '../src/components/RangeGrid';
import { captionFor, seatsFor } from '../src/components/TableDiagram';
import { SB_LIMP_CHART } from './fixtures/sbLimpChart';

const SB: Scenario = { kind: 'rfi', hero: 'SB' };
const cells = () => getChartCells(SB);
const pct = (x: number) => Math.round(x * 100);

describe('림프 액션 — 순서 · 이름 · 저장 형식', () => {
  it('ACTIONS 는 check 뒤에 limp 를 붙였을 뿐이다(저장 인덱스 0~6 그대로, limp = 7)', () => {
    expect([...ACTIONS]).toEqual(['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin', 'check', 'limp']);
  });

  it('SB 첫 진입만 림프 버튼이 있고, 공격성 오름차순이다', () => {
    expect(scenarioActions('rfi', 'SB')).toEqual(['fold', 'limp', 'raise']);
    for (const hero of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) expect(scenarioActions('rfi', hero)).toEqual(['fold', 'raise']);
    expect(scenarioActions('vs_limp', 'BB')).toEqual(['check', 'raise']);
    expect(scenarioActions('vs_limp', 'BTN')).toEqual(['fold', 'raise']);
    for (const kind of ['vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'] as const) {
      for (const hero of ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Pos[]) expect(scenarioActions(kind, hero)).not.toContain('limp');
    }
    const acts = scenarioActions('rfi', 'SB');
    const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);
    for (let i = 1; i < acts.length; i++) expect(agg(acts[i])).toBeGreaterThan(agg(acts[i - 1]));
  });

  it('림프는 수동적인 진입: 폴드 · 체크 다음, 콜 · 레이즈 앞', () => {
    const at = (a: Action) => AGGRESSION_ORDER.indexOf(a);
    expect(at('fold')).toBeLessThan(at('limp'));
    expect(at('check')).toBeLessThan(at('limp'));
    expect(at('limp')).toBeLessThan(at('call'));
    expect(at('limp')).toBeLessThan(at('raise'));
    expect([...AGGRESSION_ORDER].sort()).toEqual([...ACTIONS].sort());
    // 동점은 더 공격적인 쪽: 레이즈 50 · 림프 50 → 레이즈, 림프 50 · 폴드 50 → 림프
    expect(primaryAction({ raise: 0.5, limp: 0.5 })).toBe('raise');
    expect(primaryAction({ limp: 0.5 })).toBe('limp');
    expect(primaryAction({ raise: 0.25, limp: 0.5 })).toBe('limp');
  });

  it('이름과 조사: 림프 — 받침이 없어 림프는 · 림프를 · 림프로 · 림프와', () => {
    expect(ACTION_SHORT_KO.limp).toBe('림프');
    expect(actWord('limp', 'rfi')).toBe('림프');
    expect(verb('limp', 'rfi', '해요')).toBe('림프해요');
    expect(josa('림프', '은/는')).toBe('림프는');
    expect(josa('림프', '을/를')).toBe('림프를');
    expect(josa('림프', '으로/로')).toBe('림프로');
    expect(josa('림프', '과/와')).toBe('림프와');
    expect(josa('림프', '이에요/예요')).toBe('림프예요');
  });

  it('차트 표기에 limp 를 쓸 수 있고 buildChart 가 비중으로 만든다', () => {
    const def: ChartDef = { id: 'rfi:SB', kind: 'rfi', hero: 'SB', actions: { raise: 'AA:0.75', limp: 'AA:0.25, 22' } };
    const c = buildChart(def);
    expect(c.AA).toEqual({ raise: 0.75, limp: 0.25 });
    expect(fullMix(c['22'])).toEqual([{ action: 'limp', weight: 1 }]);
    expect(() => buildChart({ ...def, actions: { raise: 'AA', limp: 'AA' } })).toThrow();
  });

  it('모든 액션에 색 토큰(--act-*)이 있고, 칸 배경이 림프 조각을 그린다', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    for (const a of ACTIONS) expect(css, a).toMatch(new RegExp(`--act-${a}:\\s*#[0-9A-Fa-f]{6}`));
    expect(cellBackground([{ action: 'limp', weight: 1 }])).toBe('var(--act-limp)');
    expect(cellBackground(fullMix({ raise: 0.5, limp: 0.25 }))).toBe(
      'linear-gradient(90deg, var(--act-raise) 0.00% 50.00%, var(--act-limp) 50.00% 75.00%, var(--rg-fold) 75.00% 100.00%)',
    );
  });
});

describe('시험용 rfi:SB — 캡슐 · 줄 문장 · 채점', () => {
  it('시험 차트는 책의 모양(레이즈 약 24% · 림프 약 38%)이다', () => {
    expect(pct(rangeShare(cells(), 'raise'))).toBe(24);
    expect(pct(rangeShare(cells(), 'limp'))).toBe(38);
    expect(getChartCells(SB)).toEqual(buildChart(SB_LIMP_CHART));
  });

  it('캡슐: 주로 오픈 · 오픈·림프 반반 · 림프 · 절반만 림프 · 세 액션', () => {
    const cap = (h: string) => capsuleLabel(fullMix(cells()[h]), 'fold', 'rfi');
    expect(cap('AA')).toBe('주로 오픈');
    expect(cap('88')).toBe('오픈·림프 반반');
    expect(cap('55')).toBe('림프');
    expect(cap('K3o')).toBe('절반만 림프');
    const split = splitOf(fullMix(cells().K7o));
    expect(split).toEqual(['raise', 'limp', 'fold']);
    expect(splitPhrase(split!, 'rfi', 'solo')).toBe('절반은 오픈하고, 나머지를 림프와 폴드로 나눠요');
  });

  it('줄 문장이 레이즈 · 림프 · 폴드 세 액션을 이름으로 말한다', () => {
    const say = (h: string) => lineSentence(SB, lineOf(h))!.text;
    expect(say('55')).toBe('SB는 포켓페어 중 99까지는 오픈, 88~66은 오픈·림프 반반, 55부터는 전부 림프해요.');
    expect(say('KTs')).toBe('SB는 수티드 K를 KJs까지 오픈하고, KTs부터 K2s까지는 오픈과 림프를 반반 섞어요.');
    expect(say('J4s')).toBe('SB는 수티드 J 중 JTs부터 J8s까지는 오픈과 림프를 반반 섞고, J2s까지는 림프해요.');
    expect(say('T8o')).toBe('SB는 오프수트 T 중 T9o는 오픈과 림프를 반반 섞고, T8o는 절반만 림프해요.');
    expect(say('72o')).toBe('SB는 오프수트 7을 전부 폴드해요.');
    // 줄마다: claims 가 있고, 말투 금지 표현이 없고, 림프 칸이 있는 줄은 '림프'를 말합니다.
    const seen = new Set<string>();
    for (const h of ALL_HANDS) {
      const line = lineOf(h);
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      const r = lineSentence(SB, line)!;
      expect(r.claims.length, r.text).toBeGreaterThan(0);
      expect(bannedHits(r.text), r.text).toEqual([]);
      const limps = line.slots.some((x) => x.inLine && x.hand && (cells()[x.hand]?.limp ?? 0) >= 0.5);
      if (limps) expect(r.text, line.id).toContain('림프');
      // 칸 다섯 묶음짜리(오프수트 K)를 뺀 줄은 리빌 한도 안
      if (line.id !== 'oK') expect(emWidth(r.text), r.text).toBeLessThanOrEqual(LINE_MAX_EM);
    }
  });

  it('채점: 림프가 정답 · 부분 정답 · 오답이 되는 칸', () => {
    const g = (h: string, a: Action) => gradeAnswer(stepFor(SB, h), a);
    expect(stepFor(SB, '55').answer).toBe('limp');
    expect(g('55', 'limp')).toBe('correct');
    expect(g('55', 'raise')).toBe('wrong');
    expect(g('55', 'fold')).toBe('wrong');
    expect(stepFor(SB, '88').answer).toBe('raise'); // 동점 → 더 공격적인 레이즈
    expect(g('88', 'limp')).toBe('partial');
    expect(stepFor(SB, 'K3o').answer).toBe('limp');
    expect(g('K3o', 'fold')).toBe('partial');
    expect(g('AA', 'limp')).toBe('wrong'); // 25% 는 부분 정답 문턱(40%) 아래
    expect(g('JJ', 'limp')).toBe('wrong');
  });
});

describe('시험용 rfi:SB — 해설 시트 · 자리 이유', () => {
  it("숫자 줄은 SB 의 레이즈와 림프를 따로: '… · SB 레이즈 24% · 림프 38%'", () => {
    for (const hero of ['UTG', 'SB'] as Pos[]) {
      const e = explainStep(stepFor({ kind: 'rfi', hero }, 'AKo'));
      expect(e.seat.numbers).toMatch(/^UTG \d+% · HJ \d+% · CO \d+% · BTN \d+% · SB 레이즈 24% · 림프 38%$/);
      expect(e.seat.ladder!.find((x) => x.pos === 'SB')).toEqual({ pos: 'SB', pct: 24, limp: 38, me: hero === 'SB' });
    }
    expect(explainStep(stepFor(SB, '55')).seat.lever).toBe('SB는 포지션이 없어 레이즈 24%에 림프 38%를 섞어요.');
  });

  it('자리 이유: 레이즈와 림프를 따로 말하고, 책(림프 약 38% · 레이즈 약 24%)과 같으면 다른 점을 말하지 않는다', () => {
    const r = spotReason(SB);
    expect(r.lines.join(' ')).toContain('림프(38%)');
    expect(r.lines.join(' ')).toContain('레이즈(24%)');
    expect(r.principles).toEqual(['sb-first-in', 'sb-limp', 'seats-behind']);
    expect(r.bookDiff).toBeNull();
    for (const t of r.lines) expect(bannedHits(t, 'style'), t).toEqual([]);
    // SB 의 아이솔레이트: SB 가 '처음 들어가는' 폭은 레이즈 + 림프(62%)라, 레이즈 폭(24%)과 견줄 때는 '처음 레이즈할 때'예요.
    expect(spotReason({ kind: 'vs_limp', hero: 'SB' }).lines[1]).toMatch(/^누가 먼저 들어온 만큼 처음 레이즈할 때\(24%\)보다 좁게, \d+%만 레이즈해요\.$/);
    expect(spotReason({ kind: 'vs_limp', hero: 'BTN' }).lines[1]).toMatch(/처음 들어갈 때\(\d+%\)/);
  });

  it('부분 정답 · 예시 · 이 패 이유 키가 림프를 안다', () => {
    expect(explainStep(stepFor(SB, '88')).mix!.partial).toBe('오픈과 림프는 가치가 비슷해요. 채점은 더 공격적인 오픈이 정답이에요.');
    expect(explainStep(stepFor(SB, 'K3o')).mix!.partial).toBe('림프와 폴드는 가치가 비슷해요. 채점은 림프가 정답이에요.');
    // 셋 확률 예시: 림프로 플랍을 보러 들어가는 작은 페어
    expect(explainStep(stepFor(SB, '55')).more.example).toBe('내 5♠5♦ → 플랍에서 셋이 될 확률은 약 12%예요.');
    expect(bucketOf(cells()['55'])).toBe('limp');
    expect(bucketOf(cells()['88'])).toBe('mix:raise+limp');
    expect(reasonKey(SB, '55', cells()['55'])).toBe('rfi|SB|pair_small|limp');
  });

  it('PRINCIPLES 의 SB 림프 카드는 SB 첫 진입과 BB 림프 대응에만 숫자를 단다', () => {
    const n = PRINCIPLES['sb-limp'].numbers!;
    expect(n(SB)).toBe('SB가 림프하면 팟은 2bb가 되고, BB가 3.5bb로 레이즈하면 SB는 2.5bb를 더 내고 콜해야 해서 필요 승률이 약 36%예요.');
    expect(n({ kind: 'vs_limp', hero: 'BB' })).toBe(n(SB));
    expect(n({ kind: 'rfi', hero: 'BTN' })).toBeNull();
    expect(n({ kind: 'vs_limp', hero: 'BTN' })).toBeNull();
  });
});

describe('시험용 rfi:SB — 자리별 보기 · 도달', () => {
  it('림프는 3벳 대응에 닿지 않는다: 3벳 대응 · 5벳 대응은 레이즈로 오픈했을 때만', () => {
    for (const villain of ['BB'] as Pos[]) {
      const r = isReachable({ kind: 'vs_3bet', hero: 'SB', villain }, '55');
      expect(r.ok).toBe(false);
      expect(r.gate).toEqual({ kind: 'rfi', needed: 'raise', weight: 0 });
      expect(isReachable({ kind: 'vs_5bet', hero: 'SB', villain }, '55').ok).toBe(false);
      // 레이즈가 1순위(동점 포함)면 닿습니다
      expect(isReachable({ kind: 'vs_3bet', hero: 'SB', villain }, '88').ok).toBe(true);
      expect(isReachable({ kind: 'vs_3bet', hero: 'SB', villain }, 'AA').ok).toBe(true);
    }
    const cell = handAtlas('55').sections.vs_3bet.cells.find((c) => c.scenario.hero === 'SB')!;
    expect(cell.reachable).toBe(false);
    expect(gateText(cell)).toBe('SB에서는 오픈 대신 림프하니 이 상황은 안 생겨요.');
    // 림프를 아예 안 하는 72o 는 예전 문장 그대로
    expect(gateText(handAtlas('72o').sections.vs_3bet.cells.find((c) => c.scenario.hero === 'SB')!)).toBe('SB에서 오픈하지 않으니 이 상황은 안 생겨요.');
  });

  it("rfi 결론과 다이제스트: '단, SB에서는 림프해요' · SB 에서만 림프 · 림프 개수", () => {
    expect(rfiThesis(handAtlas('55'))[0].text).toBe('55는 UTG~BTN에서 오픈해요. 단, SB에서는 림프해요.');
    expect(rfiThesis(handAtlas('AA'))[0].text).toBe('AA는 UTG~BTN에서 오픈해요. 단, SB에서는 주로 오픈해요.');
    expect(rfiThesis(handAtlas('K3o'))[0].text).toBe('K3o는 UTG~BTN에서는 폴드하고, SB에서는 절반만 림프해요.');
    expect(rfiThesis(handAtlas('Q3s'))[0].text).toBe('Q3s는 BTN부터 오픈해요. 단, SB에서는 림프해요.');
    // SB 의 오픈 50 · 림프 50 을 BTN 의 오픈 50 · 폴드 50 과 '절반만 오픈'으로 묶으면 SB 의 나머지 절반이 폴드로 읽혀요 — 따로 말합니다.
    expect(rfiThesis(handAtlas('Q8o'))[0].text).toBe('Q8o는 BTN에서 절반만 오픈하고, 다른 자리에서는 폴드해요. 단, SB에서는 오픈과 림프를 반반 섞어요.');
    // SB 에서도 1순위가 폴드인 칸(폴드 75 · 림프 25): '주로 폴드해요'로 끝내면 림프가 사라져요.
    expect(rfiThesis(handAtlas('97o'))[0].text).toBe('97o는 UTG~BTN에서는 폴드하고, SB에서도 주로 폴드하되 림프를 25% 섞어요.');
    expect(rfiThesis(handAtlas('97o'))[0].nums).toEqual([25]);
    expect(sectionDigest(handAtlas('55').sections.rfi).text).toBe('오픈 4곳 · 림프 1곳');
    expect(sectionDigest(handAtlas('AA').sections.rfi).text).toBe('오픈 5곳 · 그중 1곳은 림프 25% 섞음');
    const sb = handAtlas('55').rfi.seats.find((s) => s.pos === 'SB')!;
    expect([sb.share, sb.limpShare, sb.limp, sb.primary]).toEqual([24, 38, 1, 'limp']);
    expect(sbOpenLine()).toBe('SB는 포지션이 없어 레이즈는 24%로 좁히고, 반값으로 림프를 38% 섞어요.');
  });
});

describe('시험용 rfi:SB — 트레이너', () => {
  const opts: SessionOptions = { positions: ['SB'], kinds: ['rfi', 'vs_3bet', 'vs_5bet'], interestingBias: 0.6 };
  const rng = () => 0;

  it('림프한 패는 3벳 대응으로 잇지 않고, 레이즈한 패는 잇는다', () => {
    const limp = buildSteps('SB', '55', opts, rng);
    expect(limp.map((s) => `${s.scenario.kind}:${s.answer}`)).toEqual(['rfi:limp']);
    const raise = buildSteps('SB', 'JJ', opts, rng);
    expect(raise[0].answer).toBe('raise');
    expect(raise[1].scenario.kind).toBe('vs_3bet');
    // 림프는 '안 들어가는' 답이 아니라서 정리(pruneSteps)가 빼지 않습니다.
    expect(pruneSteps(limp)).toHaveLength(1);
  });

  it('딜 가중치: 안쪽 림프 칸은 1(외울 칸), 림프와 레이즈의 경계는 3', () => {
    // J4s: 위 Q4s · 아래 T4s · 왼쪽 J5s · 오른쪽 J3s 가 전부 림프
    expect(primaryAction(cells().J4s)).toBe('limp');
    expect(cellDealWeight(cells(), 3, 10)).toBe(1);
    // 55: 위 66 은 레이즈·림프 반반(1순위 레이즈) → 경계
    expect(cellDealWeight(cells(), 9, 9)).toBe(3);
  });
});

describe('SRS — 저장 형식', () => {
  const KEY = 'holdem-flicker.srs.v1';
  beforeEach(() => {
    memStorage.clear();
    vi.resetModules();
  });

  it('림프가 생기기 전에 저장한 카드가 같은 액션으로 읽힌다(인덱스 0~6)', async () => {
    const now = 1_700_000_000_000;
    const OLD = ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin', 'check'] as const;
    const HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88'];
    const c: Record<string, number[]> = {};
    OLD.forEach((_, i) => {
      // [state, ease, intervalDays, due, reps, lapses, exposures, quizWrong, quizWrongAt, lastWrongAction, lastRating, lastSeen, answer, quizSeen, pickSeen]
      c[`vs_open:BTN:CO|${HANDS[i]}`] = [2, 2.5, 3, now, 2, 0, 3, 1, now, (i + 1) % 7, 1, now, i, 2, 1];
    });
    memStorage.setItem(KEY, JSON.stringify({ v: 1, c }));
    const srs = await import('../src/state/srs');
    OLD.forEach((a, i) => {
      const card = srs.getCard(`vs_open:BTN:CO|${HANDS[i]}`)!;
      expect(card.answer, a).toBe(a);
      expect(card.lastWrongAction, a).toBe(OLD[(i + 1) % 7]);
    });
  });

  it('림프가 정답인 카드와 림프를 고른 실수가 저장 → 불러오기를 견딘다(인덱스 7)', async () => {
    const srs = await import('../src/state/srs');
    srs.rate(stepFor(SB, '55'), 'unsure', 'quiz', { chosen: 'fold' });
    srs.rate(stepFor(SB, 'JJ'), 'unsure', 'quiz', { chosen: 'limp' });
    srs.flushSrs();
    const raw = JSON.parse(memStorage.getItem(KEY)!) as { c: Record<string, number[]> };
    expect(raw.c['rfi:SB|55'][12]).toBe(7);
    expect(raw.c['rfi:SB|JJ'][9]).toBe(7);
    vi.resetModules();
    const fresh = await import('../src/state/srs');
    expect(fresh.getCard('rfi:SB|55')?.answer).toBe('limp');
    expect(fresh.getCard('rfi:SB|55')?.lastWrongAction).toBe('fold');
    expect(fresh.getCard('rfi:SB|JJ')?.answer).toBe('raise');
    expect(fresh.getCard('rfi:SB|JJ')?.lastWrongAction).toBe('limp');
    expect(fresh.stepForKey('rfi:SB|55')?.answer).toBe('limp');
  });
});

describe('코치 — 림프는 레이즈가 아닌 자발적 진입', () => {
  const mk = (n: number, answer: Action, chosen: Action, hand = (i: number) => ALL_HANDS[i]): CoachMistake[] =>
    Array.from({ length: n }, (_, i) => ({ hand: hand(i), handClass: 'junk', kind: 'rfi', hero: 'SB', ip: false, answer, chosen, daysAgo: 1, src: 'quiz', key: `rfi:SB|${hand(i)}` }));
  const axis = (ms: CoachMistake[], seen: SeenRow[] = []) => computeAxes(ms, seen);

  it('공격 축: rfi:SB 는 답이 셋이라 부호 검정에 들어온다(오답 둘 중 공격적인 쪽 +1)', () => {
    const t = (answer: Action, chosen: Action) => axis(mk(12, answer, chosen)).find((v) => v.id === 'aggression')!;
    expect(t('raise', 'limp').tRaw).toBe(1); // 정답 레이즈 — 림프(오답 중 공격적인 쪽)
    expect(t('raise', 'fold').tRaw).toBe(-1);
    expect(t('limp', 'raise').tRaw).toBe(1);
    expect(t('limp', 'fold').tRaw).toBe(-1);
    expect(t('fold', 'raise').tRaw).toBe(1);
    expect(t('fold', 'limp').tRaw).toBe(-1);
    expect(t('raise', 'limp').sample).toBe(12);
    // 다른 자리의 rfi 는 여전히 답이 둘이라 빠집니다.
    const utg = mk(12, 'raise', 'fold').map((m) => ({ ...m, hero: 'UTG' as Pos }));
    expect(axis(utg).find((v) => v.id === 'aggression')!.sample).toBe(0);
  });

  it('진입 축: 림프는 폴드가 아니다 — 폴드할 패를 림프하면 루즈, 림프할 패를 폴드하면 타이트', () => {
    const seen: SeenRow[] = [
      { kind: 'rfi', hero: 'SB', answer: 'fold', weight: 50 },
      { kind: 'rfi', hero: 'SB', answer: 'limp', weight: 50 },
    ];
    const entry = (ms: CoachMistake[]) => axis(ms, seen).find((v) => v.id === 'entry')!;
    expect(entry(mk(20, 'fold', 'limp')).tRaw).toBe(1);
    expect(entry(mk(20, 'limp', 'fold')).tRaw).toBe(-1);
    // 림프 ↔ 레이즈는 둘 다 들어간 것 — 폴드-정답이 아닌 실수로만 셉니다(타이트 쪽 분모).
    expect(entry(mk(20, 'limp', 'raise')).tRaw).toBe(-1);
  });

  it("패턴: '센 패를 너무 얌전하게'는 SB 의 림프를 잡지 않는다(책의 함정 림프) — 콜은 그대로 잡는다", () => {
    const rule = PATTERN_RULES.find((r) => r.id === 'premium_underplay')!;
    const [limpAA] = mk(1, 'raise', 'limp', () => 'AA').map((m) => ({ ...m, handClass: 'premium_pair' as const }));
    expect(rule.match(limpAA)).toBe(false);
    expect(rule.match({ ...limpAA, kind: 'vs_3bet', villain: 'BB', answer: 'fourbet', chosen: 'call' })).toBe(true);
  });
});

describe("BB 림프 대응 = 'SB 가 림프했고 BB 차례'", () => {
  const BB: Scenario = { kind: 'vs_limp', hero: 'BB' };

  it('상황 문구 · 제목 · 테이블 · 포지션 · 면책', () => {
    expect(limperOf(BB)).toBe('SB');
    expect(limperOf({ kind: 'vs_limp', hero: 'CO' })).toBeUndefined();
    expect(limperOf({ kind: 'vs_limp', hero: 'CO', extras: { limper: 'HJ' } })).toBe('HJ');
    expect(scenarioSituation(BB)).toBe('SB가 림프했어요. BB는 체크 아니면 레이즈예요.');
    expect(scenarioTitle(BB)).toBe('BB · SB 림프에 대응');
    const seats = seatsFor(BB);
    expect(seats.find((x) => x.pos === 'SB')).toEqual({ pos: 'SB', role: 'villain', tags: ['림프'] });
    expect(seats.filter((x) => x.role === 'folded').map((x) => x.pos)).toEqual(['UTG', 'HJ', 'CO', 'BTN']);
    expect(captionFor(BB)).toBe('SB 림프 · 뒤에 아무도 없음');
    expect(heroIsIP(BB)).toBe(true);
    expect(heroIsIP({ kind: 'vs_limp', hero: 'SB', extras: { limper: 'BTN' } })).toBe(false);
    expect(disclaimerFor(BB)).toBe(DISCLAIMER_BB_LIMP);
    expect(disclaimerFor({ kind: 'vs_limp', hero: 'BTN' })).toBe(DISCLAIMER.vs_limp);
    expect(explainStep(stepFor(BB, '55')).disclaimer).toBe(DISCLAIMER_BB_LIMP);
  });

  it('트레이너는 BB 에게 언제나 SB 를 림퍼로 둔다', () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const opts: SessionOptions = { positions: ['BB'], kinds: ['vs_limp'], interestingBias: 0.6 };
    for (let i = 0; i < 50; i++) {
      const steps = buildSteps('BB', ALL_HANDS[i * 3], opts, rng);
      expect(steps).toHaveLength(1);
      expect(steps[0].scenario.extras?.limper).toBe('SB');
    }
    // HJ~SB 는 앞자리의 한 명(약한 플레이어)
    const co = buildSteps('CO', 'AKo', { ...opts, positions: ['CO'] }, () => 0.99);
    expect(['UTG', 'HJ']).toContain(co[0].scenario.extras?.limper);
  });

  it('자리 이유: SB 의 림프를 말하고(3.5bb 레이즈), 약한 림퍼 아이솔레이트 카드는 쓰지 않는다', () => {
    const r = spotReason(BB);
    expect(r.lines[0]).toBe('SB가 림프하면 BB는 체크만 해도 돈을 더 내지 않고 플랍을 봐요.');
    expect(r.lines[1]).toContain('3.5bb로 레이즈해요');
    expect(r.principles).toEqual(['free-check', 'sb-limp']);
    expect(spotReason({ kind: 'vs_limp', hero: 'BTN' }).principles).toContain('vs-limper');
  });
});

describe('책의 베팅 크기 (노트 5장 1절)', () => {
  it('3벳 IP 8.5 · OOP 10 · SB 레이즈에 BB 9 · 4벳 23 · SB 의 BB 상대 4벳 24 · 림프에 BB 레이즈 3.5', () => {
    expect(threebetSize('UTG', 'CO')).toBe(8.5);
    expect(threebetSize('CO', 'BTN')).toBe(8.5);
    expect(threebetSize('UTG', 'BB')).toBe(10);
    expect(threebetSize('BTN', 'SB')).toBe(10);
    expect(threebetSize('SB', 'BB')).toBe(9);
    expect(fourbetSize('UTG', 'BTN')).toBe(23);
    expect(fourbetSize('SB', 'BB')).toBe(24);
    expect(limpFacts()).toEqual({ complete: 0.5, potAfterLimp: 2, raiseTo: 3.5, toCallRaise: 2.5, potAfterCall: 7, need: 2.5 / 7 });
  });

  it('priceFacts 는 price.ts 의 크기를 그대로 읽는다', () => {
    expect(priceFacts({ kind: 'vs_open', hero: 'BB', villain: 'UTG' })?.toCall).toBe('1.5bb');
    expect(priceFacts({ kind: 'vs_open', hero: 'BB', villain: 'SB' })?.toCall).toBe('2bb');
    expect(priceFacts({ kind: 'vs_3bet', hero: 'UTG', villain: 'CO' })?.toCall).toBe('6bb');
    expect(priceFacts({ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' })?.toCall).toBe('7.5bb');
    expect(priceFacts({ kind: 'vs_3bet', hero: 'SB', villain: 'BB' })?.toCall).toBe('6bb');
    expect(priceFacts({ kind: 'vs_limp', hero: 'BB' })).toBeNull();
    expect(priceOf({ kind: 'vs_4bet', hero: 'BB', villain: 'SB' })).toEqual({ toCall: 15, potAfter: 48, need: 15 / 48 });
    expect(PRINCIPLES['vs-4bet'].numbers!({ kind: 'vs_4bet', hero: 'BB', villain: 'SB' })).toBe('4벳 24bb에 콜하려면 15bb를 더 내고, 필요 승률은 약 31%예요.');
    expect(PRINCIPLES['vs-4bet'].numbers!({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' })).toBe('4벳 23bb에 콜하려면 14.5bb를 더 내고, 필요 승률은 약 31%예요.');
  });
});
