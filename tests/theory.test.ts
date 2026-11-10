import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../src/poker/data';
import { ALL_HANDS } from '../src/poker/hands';
import { isReachable } from '../src/poker/atlas';
import { fullMix, rangeShare } from '../src/poker/range';
import { heroInPosition } from '../src/poker/scenarios';
import { bannedHits } from '../src/poker/ko';
import { PRINCIPLES, type PrincipleId } from '../src/poker/theory/principles';
import { allSpotReasons, defendShare, spotReason } from '../src/poker/theory/spot';
import { priceOf, threebetRisk } from '../src/poker/theory/price';
import { familyOf, reasonKey } from '../src/poker/theory/keys';
import { fillSlots, handReason } from '../src/poker/theory/handReason';
import { HAND_REASONS } from '../src/poker/theory/handReasons.data';
import { CELL_DIFFS, cellDiff } from '../src/poker/theory/bookDiff';
import { equityVs } from '../scripts/equity-lib';
import type { Action, Scenario } from '../src/poker/types';

/*
 * 책 원리 층(docs/THEORY_SPEC.md) — 자리 이유가 차트에 대해 단정하는 말을 74개 차트에서 다시 계산하고,
 * 원리 카드 · 이 패 이유 · 책과 다른 점의 말투와 범위를 확인합니다.
 */

const scen = (d: (typeof ALL_CHART_DEFS)[number]): Scenario => ({ kind: d.kind, hero: d.hero, ...(d.villain ? { villain: d.villain } : {}) }) as Scenario;
const share = (s: Scenario, a: Action) => rangeShare(getChartCells(s), a);
const CHARTS = ALL_CHART_DEFS.map((d) => ({ id: d.id, s: scen(d) }));


/** 버튼 단어는 '폴드'예요. 이론 문장에서 '접어요 · 접고 · 접는' 같은 동사를 쓰지 않아요(THEORY_SPEC §1 말투). */
const FOLD_VERB = /접[어고는었을으아기]|접습/;

describe('가격(price.ts)', () => {
  it('책 1장의 필요 승률 = 콜 금액 ÷ 콜 뒤의 팟을 앱 크기로 계산해요', () => {
    const p = (s: Scenario) => Math.round(priceOf(s)!.need * 1000) / 10;
    expect(p({ kind: 'vs_open', hero: 'BB', villain: 'UTG' })).toBe(27.3); // 1.5 ÷ 5.5
    expect(p({ kind: 'vs_open', hero: 'BB', villain: 'SB' })).toBe(33.3); // 2 ÷ 6
    expect(p({ kind: 'vs_open', hero: 'BTN', villain: 'CO' })).toBe(38.5); // 2.5 ÷ 6.5
    // 책 5장 1절의 크기: 3벳 IP 8.5bb · OOP 10bb · SB 레이즈에 BB 3벳 9bb · 4벳 23bb(SB 의 BB 상대 4벳 24bb) · 5벳 100bb.
    expect(p({ kind: 'vs_3bet', hero: 'UTG', villain: 'HJ' })).toBe(32.4); // 6 ÷ 18.5
    expect(p({ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' })).toBe(36.6); // 7.5 ÷ 20.5
    expect(p({ kind: 'vs_3bet', hero: 'SB', villain: 'BB' })).toBe(33.3); // 6 ÷ 18
    expect(p({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' })).toBe(30.5); // 14.5 ÷ 47.5
    expect(p({ kind: 'vs_4bet', hero: 'BB', villain: 'SB' })).toBe(31.3); // (24 − 9) ÷ (24 + 9 + 15)
    expect(p({ kind: 'vs_5bet', hero: 'UTG', villain: 'HJ' })).toBe(38.2); // 77 ÷ 201.5
    expect(p({ kind: 'vs_5bet', hero: 'SB', villain: 'BB' })).toBe(38); // 76 ÷ 200
  });
  it('책 4장 3벳 위험의 단순 모형(한 명당 7%)', () => {
    expect(Math.round(threebetRisk(2) * 1000) / 10).toBe(13.5); // 책의 BN
    expect(Math.round(threebetRisk(8) * 100)).toBe(44); // 책의 9인 UTG
  });
});

describe('자리 이유(spot.ts) — 차트에 대해 단정하는 말', () => {
  it('74개 차트 전부에 한두 문장과 원리 칩이 있고, 말투가 맞아요', () => {
    for (const { id, s } of CHARTS) {
      const r = spotReason(s);
      expect(r.lines.length, id).toBeGreaterThanOrEqual(1);
      expect(r.lines.length, id).toBeLessThanOrEqual(2);
      expect(r.principles.length, id).toBeGreaterThan(0);
      for (const p of r.principles) expect(PRINCIPLES[p], `${id} ${p}`).toBeDefined();
      for (const t of [...r.lines, r.numbers ?? '', r.bookDiff ?? '']) expect(bannedHits(t, 'style'), `${id}: ${t}`).toEqual([]);
      for (const t of [...r.lines, r.bookDiff ?? '']) expect(t, id).not.toMatch(FOLD_VERB);
    }
  });

  it('BB 림프 대응: "폴드 없이 중간 패는 체크하고, … 강한 패와 … 아주 약한 오프수트 패 일부는 레이즈" — SB 림프 범위에 대한 승률 순서로 확인해요', () => {
    // 차트를 책에 맞추면서 BB 의 SB 림프 대응은 양극화됐어요(책 4장 7절 '함정을 놓는 림퍼'에는 다시 올림을 버틸 패와 레이즈했다
    // 폴드해도 아깝지 않은 패로 레이즈 — 폭 약 40%는 공개 솔버 자료, docs/BOOK_CHART_SPEC.md §5). 예전 문장('강한 패에 A 블로커가 있는
    // A5s·A4s를 더한')은 A3s·A2s 를 체크하던 옛 차트의 것이라, 지금은 SB 림프 범위에 대한 승률 순서의 위 · 가운데 · 아래로 확인해요.
    const s: Scenario = { kind: 'vs_limp', hero: 'BB' };
    const cells = getChartCells(s);
    const text = spotReason(s).lines.join(' ');
    expect(text).toContain('폴드 없이 중간 패는 체크하고');
    expect(text).toContain('SB의 림프 범위를 상대로 강한 패'); // 아래 승률 순서(chart:rfi:SB:limp 상대)가 이 말의 근거예요
    expect(text).toContain(`합쳐 ${Math.round(share(s, 'raise') * 100)}%`);
    for (const h of ALL_HANDS) expect(fullMix(cells[h]).find((m) => m.action === 'fold'), h).toBeUndefined();
    const eq = ALL_HANDS.map((h) => ({ h, e: equityVs(h, 'chart:rfi:SB:limp', 1200, 7).eq, r: cells[h]?.raise ?? 0 })).sort((a, b) => b.e - a.e);
    const n = eq.length;
    // 위 4분의 1(강한 패)은 전부 레이즈, 50~75% 구간(중간 패)은 전부 체크
    for (const x of eq.slice(0, Math.floor(n / 4))) expect(x.r, `강한 패 ${x.h}`).toBe(1);
    for (const x of eq.slice(Math.floor(n / 2), Math.floor((n * 3) / 4))) expect(x.r, `중간 패 ${x.h}`).toBe(0);
    // 가운데보다 약한데 레이즈하는 패(블러프)는 전부 9 이하 오프수트이고 아래 4분의 1 안에 있어요
    const median = eq[Math.floor(n / 2)].e;
    const bottom = eq[Math.floor((n * 3) / 4)].e;
    const bluffs = eq.filter((x) => x.r > 0 && x.e < median);
    expect(bluffs.length).toBeGreaterThan(5);
    for (const x of bluffs) {
      expect(x.h, x.h).toMatch(/^[2-9][2-9]o$/);
      expect(x.e, x.h).toBeLessThan(bottom);
    }
    // '아주 약한 오프수트 패 일부': 아래 4분의 1의 9 이하 오프수트 중 체크하는 패도 있어서(54o 등) '일부'예요
    const weakOff = eq.filter((x) => x.e < bottom && /^[2-9][2-9]o$/.test(x.h));
    expect(weakOff.some((x) => x.r === 0)).toBe(true);
    expect(text).toContain('아주 약한 오프수트 패 일부');
  });

  it('합계와 괄호 속 두 부분이 더해서 맞아요 (따로 반올림하지 않아요)', () => {
    let n = 0;
    for (const { id, s } of CHARTS) {
      const t = spotReason(s).lines.join(' ');
      const m =
        t.match(/(\d+)%를 지키는데 콜\((\d+)%\)이 올인\((\d+)%\)/) ??
        t.match(/(\d+)%를 지키며 올인\((\d+)%\)과 콜\((\d+)%\)/) ??
        t.match(/(\d+)%를 지키는데, 콜\((\d+)%\)이 4벳\((\d+)%\)/) ??
        // vs_open BB: 'BB는 46%를 지키고(콜 32% · 3벳 14%)' — 예전에는 pct(합계)로 따로 반올림해 BB vs HJ · BTN 에서 더해지지 않았어요
        t.match(/(\d+)%를 지(?:켜요|키고)\(콜 (\d+)% · 3벳 (\d+)%\)/);
      if (!m) continue;
      n++;
      expect(Number(m[2]) + Number(m[3]), `${id}: ${m[0]}`).toBe(Number(m[1]));
    }
    expect(n).toBe(15 + 8 + 5); // vs_4bet 15 · vs_3bet IP 8 · vs_open BB 5
  });

  it('"콜 없이" — HJ·CO·SB의 오픈 대응과 콜드 4벳은 콜이 0이에요', () => {
    // 책 5장 3·4·5절: HJ · CO · SB 는 앞자리 오픈에(SB 는 BTN 에게도) 콜 없이 3벳 아니면 폴드, 콜드 상황은 4벳 아니면 폴드.
    // 차트가 책을 따르면서 '콜은 거의 하지 않고(콜 < 2%)'가 '콜 없이(콜 = 0)'로 바뀌었어요.
    let n = 0;
    for (const { id, s } of CHARTS) {
      if (!spotReason(s).lines.join(' ').includes('콜 없이')) continue;
      n++;
      expect(share(s, 'call'), id).toBe(0);
    }
    expect(n).toBe(3 + 4 + 4); // HJ·CO 오픈 대응 3 · SB 오픈 대응 4 · 콜드 4벳 4
  });

  it('"콜이 4벳보다 많아요" — 포지션이 있는 3벳 대응', () => {
    for (const { id, s } of CHARTS) {
      if (s.kind !== 'vs_3bet' || !heroInPosition(s.hero, s.villain!)) continue;
      expect(spotReason(s).lines.join(' '), id).toContain('콜(');
      expect(share(s, 'call'), id).toBeGreaterThan(share(s, 'fourbet'));
    }
  });

  it('"콜을 줄이고 4벳을 늘려 … (BB의 3벳에는 …)" — 포지션이 없으면 BB의 3벳보다 4벳이 많고 콜이 적어요', () => {
    // 옛 문장 '오픈한 패의 X%만 지키고 (BB의 3벳에는 Y%)'는 포지션이 없으면 덜 지킨다는 뜻이었어요. 책(5장 3절)은 포지션이 없으면
    // 4벳을 늘린다고 하고(HJ: CO 의 3벳에 약 22%, BB 의 3벳에 약 10%), 새 차트는 그대로 4벳을 늘리고 콜을 줄여요 — 그 결과 지키는
    // 폭 자체는 BB 의 3벳보다 오히려 조금 넓어요(UTG vs HJ 48% · vs BB 47%). 그래서 문장도 폭이 아니라 4벳과 콜의 나눔을 말해요.
    let n = 0;
    for (const { id, s } of CHARTS) {
      if (s.kind !== 'vs_3bet' || heroInPosition(s.hero, s.villain!) || s.hero === 'SB') continue;
      n++;
      const ip: Scenario = { kind: 'vs_3bet', hero: s.hero, villain: 'BB' };
      const t = spotReason(s).lines.join(' ');
      expect(t, id).toContain('콜을 줄이고 4벳을 늘려');
      expect(share(s, 'fourbet'), id).toBeGreaterThan(share(ip, 'fourbet'));
      expect(share(s, 'call'), id).toBeLessThan(share(ip, 'call'));
      // 문장 속 네 숫자는 오픈한 패(RFI 레이즈) 중 비율을 각각 반올림한 값이에요
      const open = share({ kind: 'rfi', hero: s.hero }, 'raise');
      const r = (x: Scenario, a: Action) => Math.round((share(x, a) / open) * 100);
      const m = t.match(/오픈한 패 중 4벳 (\d+)% · 콜 (\d+)%로 지켜요\(BB의 3벳에는 4벳 (\d+)% · 콜 (\d+)%\)/);
      expect(m, id).not.toBeNull();
      expect(m!.slice(1).map(Number), id).toEqual([r(s, 'fourbet'), r(s, 'call'), r(ip, 'fourbet'), r(ip, 'call')]);
    }
    expect(n).toBe(6);
  });

  it('"처음 들어갈 때보다 좁게" · "평소 오픈 범위 그대로" — HJ·CO의 오픈 대응은 RFI 폭보다 좁고, 림프 대응은 RFI 범위 그대로예요', () => {
    // 림프 대응은 옛 차트에서 RFI 보다 좁았어요. 책 4장 7절은 림퍼를 아이솔레이트할 때 뒤에 공격적인 사람이 있으면 평소 오픈 범위
    // 수준으로 하라고 하고, 새 차트는 HJ · CO · BTN 에서 RFI 의 레이즈 칸과 똑같이 레이즈해요. SB 는 첫 진입에 림프가 있어서 레이즈
    // 범위와 견주는데, 림프에 섞던 트랩 패를 늘 레이즈하고 낮은 수티드 K 를 빼서 칸은 다르지만 폭은 거의 같아요(24% · 24%).
    for (const { id, s } of CHARTS) {
      const rfi: Scenario = { kind: 'rfi', hero: s.hero };
      if (s.kind === 'vs_open' && (s.hero === 'HJ' || s.hero === 'CO')) expect(defendShare(s)!, id).toBeLessThan(share(rfi, 'raise'));
      if (s.kind !== 'vs_limp' || s.hero === 'BB') continue;
      const t = spotReason(s).lines.join(' ');
      if (s.hero === 'SB') {
        expect(t, id).toContain('평소 레이즈 범위 수준');
        expect(Math.abs(share(s, 'raise') - share(rfi, 'raise')), id).toBeLessThanOrEqual(0.02);
      } else {
        expect(t, id).toContain('평소 오픈 범위 그대로');
        for (const h of ALL_HANDS) expect(getChartCells(s)[h]?.raise ?? 0, `${id} ${h}`).toBe(getChartCells(rfi)[h]?.raise ?? 0);
      }
    }
  });

  it('"상대 범위가 넓을수록 BB도 넓게" · "BB가 가장 넓게" — BB 방어 폭은 상대 RFI 폭과 순서가 같고, SB 상대가 최대예요', () => {
    const openers = ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const;
    const rfi = openers.map((v) => share({ kind: 'rfi', hero: v }, 'raise'));
    const bb = openers.map((v) => defendShare({ kind: 'vs_open', hero: 'BB', villain: v })!);
    for (let i = 1; i < openers.length; i++) {
      if (rfi[i] > rfi[i - 1]) expect(bb[i], openers[i]).toBeGreaterThan(bb[i - 1]);
    }
    expect(Math.max(...bb)).toBe(bb[4]);
  });

  it('책과 다른 점의 사실도 차트와 맞아요', () => {
    // 차트를 책(MPT 5장)에 맞춰 다시 만들어서 상황 단위의 '책과 다른 점'은 모두 사라졌어요(옛 문장: BTN 46% · SB 림프 없음 ·
    // HJ·CO·BTN 의 콜 · BB vs BTN 블러프 3벳 · OOP 4벳 · AA 늘 올인 · 5벳 콜 좁음 · 콜드 4벳 약 2%). spot.ts 는 책이 숫자를 밝힌 곳마다
    // 차트와 견주는 장치를 그대로 두고, 아래는 그 장치가 null 을 내는 근거와 그 자리를 대신한 문장의 사실이에요.
    for (const { id, reason } of allSpotReasons()) expect(reason.bookDiff, id).toBeNull();
    // rfi: 책 5장 2절의 폭(UTG 17 · HJ 21 · CO 28 · BTN 43, SB 림프 38 · 레이즈 24) 안(±2%p)
    for (const [h, w] of [['UTG', 0.17], ['HJ', 0.21], ['CO', 0.28], ['BTN', 0.43]] as const) expect(Math.abs(share({ kind: 'rfi', hero: h }, 'raise') - w), h).toBeLessThanOrEqual(0.02);
    const sb: Scenario = { kind: 'rfi', hero: 'SB' };
    expect(Math.abs(share(sb, 'limp') - 0.38)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share(sb, 'raise') - 0.24)).toBeLessThanOrEqual(0.02);
    // rfi SB: "림프에도 AA·KK·QQ·JJ·AKo·AQo를 일부 섞어" — 이름으로 든 패는 레이즈와 림프를 함께 섞고, 책이 든 AA·KK·QQ·AK 가 들어 있어요
    const named = spotReason(sb).lines.join(' ').match(/림프에도 ([^ ]+?)[을를] 일부 섞어/)![1].split('·');
    expect(named.slice(0, 3)).toEqual(['AA', 'KK', 'QQ']);
    expect(named.some((h) => h.startsWith('AK'))).toBe(true);
    for (const h of ALL_HANDS) {
      const c = getChartCells(sb)[h] ?? {};
      expect(named.includes(h), h).toBe((c.raise ?? 0) > 0 && (c.limp ?? 0) > 0);
    }
    // vs_open BTN: "상대가 넓게 오픈할수록 3벳은 늘리고 콜은 줄여요"(책 5장 5절 — 옛 차트는 콜이 늘었어요)
    const btn = (['UTG', 'HJ', 'CO'] as const).map((v): Scenario => ({ kind: 'vs_open', hero: 'BTN', villain: v }));
    expect(share(btn[0], 'call')).toBeGreaterThan(share(btn[1], 'call'));
    expect(share(btn[1], 'call')).toBeGreaterThan(share(btn[2], 'call'));
    expect(share(btn[0], 'threebet')).toBeLessThan(share(btn[1], 'threebet'));
    expect(share(btn[1], 'threebet')).toBeLessThan(share(btn[2], 'threebet'));
    // vs_4bet: "AA도 {비중어} 콜로 숨겨요" — 비중어가 AA 의 콜 비중과 맞고, 포지션이 있으면 책처럼 절반은 콜이고 콜이 올인보다 많아요
    const WORD: Record<string, (w: number) => boolean> = { 늘: (w) => w === 1, 주로: (w) => w >= 0.6, 절반은: (w) => w === 0.5, 가끔: (w) => w > 0 && w <= 0.25 };
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'vs_4bet')) {
      const w = getChartCells(s).AA?.call ?? 0;
      const m = spotReason(s).lines.join(' ').match(/AA도 (늘|주로|절반은|가끔) 콜로 숨겨요/);
      expect(m, id).not.toBeNull();
      expect(WORD[m![1]](w), `${id}: ${m![0]} (AA 콜 ${w})`).toBe(true);
      if (heroInPosition(s.hero, s.villain!)) {
        expect(w, id).toBeGreaterThanOrEqual(0.5);
        expect(share(s, 'call'), id).toBeGreaterThan(share(s, 'allin'));
      }
    }
    // cold_4bet: 책 5장 3절의 약 3~6% 안(±1%p)
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'cold_4bet')) {
      expect(share(s, 'fourbet'), id).toBeGreaterThanOrEqual(0.02);
      expect(share(s, 'fourbet'), id).toBeLessThanOrEqual(0.07);
    }
    // vs_5bet: "블러프로 4벳한 패는 폴드해요" — 작은 수티드 A 는 5벳에 늘 폴드
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'vs_5bet')) {
      for (const h of ['A5s', 'A4s', 'A3s', 'A2s']) {
        if (!isReachable(s, h).ok) continue;
        expect(fullMix(getChartCells(s)[h])[0].action, `${id} ${h}`).toBe('fold');
      }
    }
  });

  it('칸 단위 책과 다른 점은 그 칸의 실제 답을 말해요', () => {
    // 책이 이름으로 든 칸(노트 5장 2·5절)은 이제 차트가 책을 따라요 — 그래서 CELL_DIFFS 에서 지웠고, 여기서 그 사실을 확인해요.
    const bbUtg: Scenario = { kind: 'vs_open', hero: 'BB', villain: 'UTG' };
    const btn: Scenario = { kind: 'rfi', hero: 'BTN' };
    expect(fullMix(getChartCells(bbUtg).A9o)[0]).toEqual({ action: 'fold', weight: 1 }); // 책: A9o | LJ | 폴드
    expect(fullMix(getChartCells(bbUtg).K2s)[0]).toEqual({ action: 'call', weight: 1 }); // 책: K2s | LJ | 콜
    expect(fullMix(getChartCells({ kind: 'vs_open', hero: 'BB', villain: 'CO' }).K8o)[0].action).toBe('fold'); // 책: K8o | CO | 접는 경우가 많음
    // 책이 예로 든 BN 범위(A4o+ · K8o+)의 아래 끝: A3o · A2o · K7o 는 오픈하지 않아요
    for (const h of ['A3o', 'A2o', 'K7o']) expect(fullMix(getChartCells(btn)[h])[0], h).toEqual({ action: 'fold', weight: 1 });
    for (const [id, h] of [['vs_open:BB:UTG', 'A9o'], ['vs_open:BB:UTG', 'K2s'], ['vs_open:BB:CO', 'K8o'], ['rfi:BTN', 'A3o'], ['rfi:BTN', 'A2o'], ['rfi:BTN', 'K7o']])
      expect(cellDiff(id, h), `${id} ${h}`).toBeNull();
    // 남은 항목이 생기면: 칸 키는 실제 차트의 도달 가능한 칸이고, 문장이 그 패를 이름으로 들고, 비중어가 그 칸의 비중과 맞아요
    const ACT: Record<string, Action> = { 폴드: 'fold', 콜: 'call', '3벳': 'threebet', '4벳': 'fourbet', 오픈: 'raise', 올인: 'allin', 레이즈: 'raise', 체크: 'check', 림프: 'limp' };
    for (const [k, t] of Object.entries(CELL_DIFFS)) {
      const hand = k.split(':').pop()!;
      const chart = CHARTS.find((c) => k === `${c.id}:${hand}`);
      expect(chart, k).toBeDefined();
      expect(isReachable(chart!.s, hand).ok, k).toBe(true);
      expect(t, k).toContain(hand);
      expect(t, k).toMatch(/^책/);
      expect(bannedHits(t, 'style'), t).toEqual([]);
      const m = t.match(new RegExp(`이 차트는 ${hand}(?:도|를|을) (늘 |주로 |절반만 |가끔 )?(폴드|콜|3벳|4벳|오픈|올인|레이즈|체크|림프)해요`));
      expect(m, `${k}: 칸의 답을 '이 차트는 ${hand}를 … 해요'로 말해요`).not.toBeNull();
      const w = fullMix(getChartCells(chart!.s)[hand]).find((x) => x.action === ACT[m![2]])?.weight ?? 0;
      const word = (m![1] ?? '늘 ').trim();
      expect(word === '절반만' ? w === 0.5 : word === '주로' ? w >= 0.6 : word === '가끔' ? w > 0 && w <= 0.25 : w === 1, `${k}: ${m![0]} (실제 ${w})`).toBe(true);
    }
  });
});

describe('원리 카드(principles.ts)', () => {
  it('32장, 본문 2~3문장 해요체, 책 위치가 있어요', () => {
    const ids = Object.keys(PRINCIPLES) as PrincipleId[];
    expect(ids.length).toBe(32); // 31장 + 'SB의 림프'(sb-limp)
    for (const id of ids) {
      const p = PRINCIPLES[id];
      expect(p.id).toBe(id);
      expect(p.chip.length, id).toBeLessThanOrEqual(12);
      const sentences = p.body.split(/(?<=요\.)\s+/).filter(Boolean);
      expect(sentences.length, `${id}: ${p.body}`).toBeGreaterThanOrEqual(2);
      expect(sentences.length, `${id}: ${p.body}`).toBeLessThanOrEqual(3);
      expect(bannedHits(p.body, 'style'), id).toEqual([]);
      expect(p.body, id).not.toMatch(FOLD_VERB);
      expect(p.ref, id).toMatch(/^책 \d+장/);
    }
  });
  it('숫자 줄은 해당 상황에서만 나와요', () => {
    const bbUtg: Scenario = { kind: 'vs_open', hero: 'BB', villain: 'UTG' };
    expect(PRINCIPLES['bb-price'].numbers!(bbUtg)).toBe('1.5bb를 더 내고 콜하면 팟은 5.5bb → 필요 승률 약 27%예요.');
    expect(PRINCIPLES['bb-price'].numbers!({ kind: 'rfi', hero: 'UTG' })).toBeNull();
    // BB 의 10bb 3벳: 위험 9bb ÷ (9 + 팟 4bb) = 알파 약 69%
    expect(PRINCIPLES['mdf-alpha'].numbers!({ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' })).toContain('69%');
  });
});

describe('이 패 이유(handReason.ts)', () => {
  it('자리표시와 조사를 채워요', () => {
    expect(fillSlots('{hand|은/는} {villain|의} 3벳에', { kind: 'vs_3bet', hero: 'UTG', villain: 'BTN' }, 'TT')).toContain('TT은');
    expect(fillSlots('{hero|이/가} {hand|을/를}', { kind: 'rfi', hero: 'BTN' }, 'A5s')).toBe('BTN이 A5s를');
  });

  it('패 가족은 책의 묶음을 따라요', () => {
    expect(familyOf('A5s')).toBe('ace_s_wheel');
    expect(familyOf('ATo')).toBe('ace_o_big');
    expect(familyOf('K9s')).toBe('kq_s');
    expect(familyOf('T9s')).toBe('conn_s');
    expect(familyOf('K8o')).toBe('off_mid');
    expect(familyOf('72o')).toBe('trash');
  });

  const entries = Object.entries(HAND_REASONS);
  it.runIf(entries.length > 0)('도달 가능한 모든 칸(6,263)에 이 패 이유가 있어요', () => {
    const missing: string[] = [];
    for (const { id, s } of CHARTS) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ALL_HANDS) {
        if (!isReachable(s, h).ok) continue;
        if (!handReason(s, h, cells[h])) missing.push(`${id} ${h} → ${reasonKey(s, h, cells[h])}`);
      }
    }
    expect(missing.slice(0, 20)).toEqual([]);
  });

  it.runIf(entries.length > 0)('책과 다른 점이 "이 차트는 {패} …해요"라고 하면 그 칸의 비중과 맞아요', () => {
    let matched = 0;
    const ACT: Record<string, string> = { 폴드: 'fold', 콜: 'call', '3벳': 'threebet', '4벳': 'fourbet', 오픈: 'raise', 올인: 'allin', 레이즈: 'raise', 체크: 'check' };
    const bad: string[] = [];
    for (const { id, s } of CHARTS) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ALL_HANDS) {
        if (!isReachable(s, h).ok) continue;
        const d = handReason(s, h, cells[h])?.bookDiff;
        if (!d) continue;
        // 'SB에서 늘 레이즈해요'(rfi:SB 의 AA·KK·QQ·AK — 책은 림프에도 섞음)는 그 칸에 림프가 조금이라도 있으면 거짓이에요.
        // 키(버킷 'raise')는 레이즈 75 · 림프 25 칸도 받으니, 차트를 책에 맞춰 림프를 섞으면 이 문장을 고쳐야 해요.
        if (/이 차트는 SB에서 늘 레이즈해요/.test(d)) {
          matched++;
          const w = cells[h]?.raise ?? 0;
          if (w < 1 - 1e-9) bad.push(`${id} ${h}: 'SB에서 늘 레이즈해요' (실제 레이즈 ${Math.round(w * 100)}%)`);
          continue;
        }
        const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = d.match(new RegExp(`이 차트는 (?:4벳한 )?${esc}[을를] (늘 |주로 |절반만 |가끔 )?(폴드|콜|3벳|4벳|오픈|올인|레이즈|체크)해요`));
        if (!m) continue;
        matched++;
        const w = fullMix(cells[h]).find((x) => x.action === ACT[m[2]])?.weight ?? 0;
        const word = (m[1] ?? '').trim();
        const ok = word === '절반만' ? Math.abs(w - 0.5) < 1e-6 : word === '주로' ? w >= 0.6 : word === '가끔' ? w > 0 && w <= 0.25 : w === 1;
        if (!ok) bad.push(`${id} ${h}: ${m[0]} (실제 ${Math.round(w * 100)}%)`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
    // 차트를 책(MPT 5장)에 맞춰 다시 만들면서 키 단위 책과 다른 점은 모두 사라졌어요(THEORY_SPEC §7) — 지금은 검사할 문장이 없어요.
    // 차트가 다시 책에서 벗어나 책과 다른 점을 적으면 이 줄을 고치고, 위 검사가 그 문장의 비중어를 칸마다 확인해요.
    expect(entries.filter(([, e]) => e.bookDiff).map(([k]) => k)).toEqual([]);
    expect(matched, '검사한 문장 수').toBe(0);
  });

  it.runIf(entries.length > 0)("{주로}는 칸마다 캡슐과 같은 비중어로: 1순위가 100% 아래면 '주로 ', 100% 면 없음", () => {
    let slotted = 0;
    for (const { id, s } of CHARTS) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ALL_HANDS) {
        if (!isReachable(s, h).ok) continue;
        const key = reasonKey(s, h, cells[h]);
        const raw = (HAND_REASONS as Record<string, { text: string } | undefined>)[key]?.text ?? '';
        if (!raw.includes('{주로}')) continue;
        slotted++;
        // 섞인 칸 키(1순위 < 60%)에는 쓰지 않아요 — '주로'는 60% 이상의 말이에요.
        expect(key.split('|')[3].startsWith('mix:'), key).toBe(false);
        const top = fullMix(cells[h])[0].weight;
        const text = handReason(s, h, cells[h])!.text;
        expect(text.includes('{'), `${id} ${h}`).toBe(false);
        expect(text.includes('주로 '), `${id} ${h} (1순위 ${Math.round(top * 100)}%): ${text}`).toBe(top < 0.999);
      }
    }
    expect(slotted, '{주로} 가 붙는 칸 수').toBeGreaterThan(100);
  });

  it.runIf(entries.length > 0)('문장은 한 문장 해요체, 80자 이하, 원리 카드가 있어요', () => {
    for (const [key, e] of entries) {
      expect(e.text.length, key).toBeLessThanOrEqual(80);
      expect(/[요]\.$|[요]$/.test(e.text.trim()), `${key}: ${e.text}`).toBe(true);
      expect(bannedHits(e.text, 'style'), `${key}: ${e.text}`).toEqual([]);
      expect(e.principles.length, key).toBeGreaterThan(0);
      for (const p of e.principles) expect(PRINCIPLES[p], `${key} ${p}`).toBeDefined();
      for (const m of e.text.matchAll(/\{([^}|]+)(?:\|([^}]+))?\}/g)) expect(['hand', 'hero', 'villain', '주로'], `${key}: ${m[0]}`).toContain(m[1]);
      if (e.bookDiff) expect(bannedHits(e.bookDiff, 'style'), key).toEqual([]);
      expect(`${e.text} ${e.bookDiff}`, key).not.toMatch(FOLD_VERB);
    }
  });
});
