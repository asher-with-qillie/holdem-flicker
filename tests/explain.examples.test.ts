import { describe, expect, it } from 'vitest';
import { explainStep, type Explanation } from '../src/poker/explain';
import { emWidth } from '../src/poker/ko';
import { stepFor } from '../src/poker/trainer';
import type { Action, Scenario, ScenarioKind } from '../src/poker/types';

/*
 * docs/EXPLAIN_SPEC.md 의 실제 칸 13개를 글자 그대로 고정합니다 — §3.6(캡슐 · 스트립 · 줄 문장 · 틀 · 폭)과
 * §4.3(형제 줄 · 섞는 비율 · 숫자 줄 · 레버 · 자리 칩 · 자리 문장 · 예시).
 * 템플릿이 바뀌면 여기서 먼저 보입니다. 스펙과 다른 곳은 그 칸 옆에 차트 사실과 함께 적었습니다.
 *
 * 리뷰 뒤 다시 고정(docs/EXPLAIN_SPEC.md §9). 바뀐 칸마다 어느 규칙 때문인지 적었습니다:
 *  [이름]   §3.4 이름 규칙 — 비중 0.5 이하인 칸은 비중어와 함께 이름을 대고, '전부'는 전부 full 일 때만.
 *  [자리]   §4.2-⑥ — '나머지는' → '나머지 자리에서는' + 다수의 비중어, 섞인 자리는 S-c 에서 따로 라벨, 림프 S-0.
 *  [부분]   §4.2-③ — 계속 · rest 반반은 '이 칸은 〈a1〉을 정답으로 쳐요.' ('반반이라 더 공격적인'은 두 계속 액션일 때만).
 */

/** §3.6 의 스트립 표기: · 유령, ┆ 도달 불가, _ 빈칸, ▌ 경계 막대, ( ) 링, a/b 섞인 칸(1·2순위). */
function stripNotation(e: Explanation, kind: ScenarioKind): string {
  const A: Record<Action, string> = { raise: kind === 'vs_limp' ? 'R' : 'O', call: 'C', threebet: '3', fourbet: '4', allin: 'J', fold: 'F', check: 'X' };
  const out: string[] = [];
  e.line.slots.forEach((slot, i) => {
    let t = slot.role === 'ghost' ? '·' : slot.role === 'unreachable' ? '┆' : slot.role === 'empty' ? '_' : slot.mix!.slice(0, 2).map((m) => A[m.action]).join('/');
    if (i === e.line.ring) t = `(${t})`;
    out.push(t);
    out.push(i === e.line.boundaryAfter ? '▌' : ' ');
  });
  return out.join('').trimEnd();
}

interface Case {
  s: Scenario;
  hand: string;
  title: string;
  capsule: string;
  strip: string;
  sentence: string;
  frame: string;
  em: number;
  sibling: string | null;
  mix: string | null;
  partial: string | null;
  numbers: string;
  lever: string | null;
  tiles: string;
  across: string;
  example: string | null;
  memo: boolean;
}

const CASES: Case[] = [
  {
    s: { kind: 'rfi', hero: 'SB' },
    hand: '85o',
    title: 'SB 오픈 · 85o',
    capsule: '폴드',
    // 스펙 표기 `· · · · · · · │ F F (F) F F F` 의 '│'는 범례에 없는 구분선이라 뺐습니다(유령 7칸 + 줄 칸 6칸 = 13).
    strip: '· · · · · · · F F (F) F F F',
    sentence: 'SB는 오프수트 8을 전부 폴드해요.',
    frame: 'P0',
    em: 15.3,
    sibling: '수티드 8은 85s까지 오픈해요.',
    mix: null,
    partial: null,
    numbers: 'UTG 18% · HJ 21% · CO 29% · BTN 46% · SB 46%',
    lever: 'SB는 뒤에 BB 한 명만 남아 46%를 오픈해요.',
    tiles: 'UTG 폴드 · HJ 폴드 · CO 폴드 · BTN 폴드 · SB 폴드',
    across: '85o는 어느 자리에서도 오픈하지 않아요.',
    example: null,
    memo: false,
  },
  {
    s: { kind: 'rfi', hero: 'UTG' },
    hand: 'KJo',
    title: 'UTG 오픈 · KJo',
    capsule: '절반만 오픈',
    strip: '· · O (O/F)▌F F F F F F F F F',
    sentence: 'UTG는 오프수트 K를 KQo만 오픈하고, KJo는 절반만 오픈해요.',
    frame: 'P2m',
    em: 27.7,
    sibling: '수티드 K는 K9s까지 오픈해요.',
    mix: '오픈 50% · 폴드 50%',
    partial: '이 칸은 오픈을 정답으로 쳐요. 폴드도 부분 정답이에요.', // [부분]
    numbers: 'UTG 18% · HJ 21% · CO 29% · BTN 46% · SB 46%',
    lever: 'UTG는 뒤에 5명이 남아 18%만 오픈해요.',
    tiles: 'UTG 절반만 오픈 · HJ 오픈 · CO 오픈 · BTN 오픈 · SB 오픈',
    across: 'KJo는 UTG에서 절반만, HJ부터는 항상 오픈해요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_3bet', hero: 'CO', villain: 'BTN' },
    hand: 'A5s',
    title: 'CO 3벳 대응 · A5s',
    capsule: '4벳',
    strip: '· 4 C C C C/F F F F (4) 4 F F',
    // [이름] A9s(콜 75 · 폴드 25)가 'ATs까지 콜' 뒤에서 나머지(폴드)로 읽혔습니다 — '까지'를 주로 칸까지 넣습니다.
    sentence: 'CO는 BTN 3벳에 수티드 A를 AKs·A5s·A4s만 4벳하고, A9s까지 콜해요.',
    frame: 'P4',
    em: 31.6,
    // [이름] AJo(콜 50 · 폴드 50)를 부릅니다 — 세 항목이라 칸 나열 꼴.
    sibling: '오프수트 A 중 AKo는 4벳, AQo는 콜, AJo는 절반만 콜해요.',
    mix: null,
    partial: null,
    numbers: 'BTN 3벳 8% → 내 콜 9% · 4벳 3%',
    lever: 'CO는 BTN보다 포지션이 없어요.',
    tiles: 'UTG 주로 4벳 · HJ 주로 4벳 · CO 4벳',
    across: 'A5s는 BTN 3벳에 UTG·HJ에서 주로, CO에서 항상 4벳해요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_open', hero: 'BB', villain: 'CO' },
    hand: '22',
    title: 'BB 오픈 대응 · 22',
    capsule: '콜',
    strip: '3 3 3 3 3 3/C C C C C C C (C)',
    // [이름] run 사이의 99(3벳 50 · 콜 50)를 부릅니다 — 칸 나열 꼴(틀은 그대로 P3).
    sentence: 'BB는 CO 오픈에 포켓페어 중 TT까지는 3벳, 99는 3벳·콜 반반, 88부터는 전부 콜해요.',
    frame: 'P3',
    em: 38,
    sibling: null,
    mix: null,
    partial: null,
    numbers: 'CO 오픈 29% → 내 콜 37% · 3벳 9%',
    lever: 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.',
    tiles: 'BTN 콜 · SB 폴드 · BB 콜',
    across: '22는 CO 오픈에 SB에서만 폴드해요.',
    example: '내 2♠2♦ → 플랍에서 셋이 될 확률 12%예요.',
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'BTN', villain: 'HJ' },
    hand: '76s',
    title: 'BTN 오픈 대응 · 76s',
    capsule: '콜',
    strip: '_ · · · · C C C (C) C C/F▌F F',
    sentence: 'BTN은 HJ 오픈에 수티드 커넥터를 65s까지 콜하고, 54s는 절반만 콜해요.',
    frame: 'P2m',
    em: 32.9,
    sibling: null,
    mix: null,
    partial: null,
    numbers: 'HJ 오픈 21% → 내 콜 12% · 3벳 6%',
    lever: 'BTN은 HJ보다 포지션이 있어요.',
    tiles: 'CO 주로 콜 · BTN 콜 · SB 폴드 · BB 주로 콜',
    across: '76s는 HJ 오픈에 SB에서만 폴드해요.',
    example: null,
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'SB', villain: 'UTG' },
    hand: 'KTs',
    title: 'SB 오픈 대응 · KTs',
    capsule: '폴드',
    strip: '· · 3 3/F▌(F) F F F F F F F F',
    sentence: 'SB는 UTG 오픈에 수티드 K를 KQs만 3벳하고, KJs는 절반만 3벳해요.',
    frame: 'P2m',
    em: 30.7,
    sibling: '오프수트 K 중 KQo는 절반만 3벳하고, 나머지는 폴드해요.',
    mix: null,
    partial: null,
    numbers: 'UTG 오픈 18% → 내 3벳 8% · 콜 1%',
    lever: 'SB는 콜을 거의 안 하고, 3벳 아니면 폴드해요.',
    tiles: 'HJ 콜 · CO 콜 · BTN 콜 · SB 폴드 · BB 콜',
    across: 'KTs는 UTG 오픈에 SB에서만 폴드해요.',
    example: '내 K♠10♠ vs 상대 A♦K♦ → K를 맞춰도 킥커에서 밀려요.',
    memo: false,
  },
  {
    s: { kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' },
    hand: 'QQ',
    title: 'HJ 4벳 대응 · QQ',
    capsule: '주로 콜',
    strip: 'J J (C/J) C/F ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆',
    sentence: 'HJ는 UTG 4벳에 포켓페어 중 KK까지는 올인하고, QQ는 주로, JJ는 절반만 콜해요.',
    frame: 'P3h',
    em: 36.4,
    sibling: null,
    mix: '콜 75% · 올인 25%',
    partial: null, // 25 < 40
    numbers: 'UTG 4벳 2% → 내 올인 2% · 콜 1%',
    lever: 'HJ는 UTG보다 포지션이 있어요.',
    tiles: 'HJ 주로 콜 · CO 주로 콜 · BTN 주로 콜 · SB 올인·콜 반반 · BB 올인·콜 반반',
    across: 'QQ는 UTG 4벳에 SB·BB에서는 올인과 콜을 반반 섞고, 나머지 자리에서는 주로 콜해요.', // [자리]
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_5bet', hero: 'CO', villain: 'BTN' },
    hand: 'QQ',
    title: 'CO 올인 대응 · QQ',
    capsule: '주로 콜',
    strip: 'C C (C/F) ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆',
    sentence: 'CO는 BTN 올인에 포켓페어를 KK까지 콜하고, QQ는 주로 콜해요.',
    frame: 'P2m',
    em: 28.4,
    sibling: null,
    mix: '콜 75% · 폴드 25%',
    partial: null,
    numbers: 'BTN 올인 2% → 내 콜 2%',
    lever: null,
    tiles: 'UTG 폴드 · HJ 절반만 콜 · CO 주로 콜',
    // [자리] 'UTG에서만 폴드'는 HJ(콜 50 · 폴드 50)를 콜로 덮었습니다.
    across: 'QQ는 BTN 올인에 UTG에서 폴드, HJ에서 절반만 콜, CO에서 콜이에요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } },
    hand: 'QQ',
    title: 'CO 콜드 4벳 · QQ',
    capsule: '4벳·콜 반반',
    strip: '4 4 (4/C)▌F/C F F F F F F F F F',
    sentence: 'CO는 앞에서 3벳이 나오면 포켓페어를 KK까지 4벳하고, QQ는 4벳과 콜을 반반 섞어요.',
    frame: 'P2m',
    em: 38.3,
    sibling: null,
    mix: '4벳 50% · 콜 50%',
    partial: '반반이라 더 공격적인 4벳을 정답으로 쳐요. 콜도 부분 정답이에요.',
    numbers: '내 4벳 2% · 콜 1%',
    lever: null,
    tiles: 'CO 4벳·콜 반반 · BTN 4벳·콜 반반 · SB 4벳·콜 반반 · BB 4벳·콜 반반',
    across: 'QQ는 앞에서 3벳이 나오면 어느 자리에서나 4벳과 콜을 반반 섞어요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_limp', hero: 'BB', extras: { limper: 'HJ' } },
    hand: '55',
    title: 'BB 림프 대응 · 55',
    capsule: '체크',
    strip: 'R R R R R R R R R▌(X) X X X',
    sentence: 'BB는 림프에 포켓페어를 66까지 레이즈하고, 55부터는 체크해요.',
    frame: 'P2c',
    em: 29.0,
    sibling: null,
    mix: null,
    partial: null,
    numbers: '내 레이즈 12% · 나머지 체크',
    lever: 'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.',
    tiles: 'HJ 폴드 · CO 레이즈 · BTN 절반만 레이즈 · SB 레이즈 · BB 체크',
    // [자리] 'CO~SB에서 레이즈'가 BTN(레이즈 50 · 폴드 50)을 덮었습니다.
    across: '55는 림프에 HJ에서 폴드, CO·SB에서 레이즈, BTN에서 절반만 레이즈, BB에서 체크예요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_limp', hero: 'BTN', extras: { limper: 'HJ' } },
    hand: 'ATo',
    title: 'BTN 림프 대응 · ATo',
    capsule: '절반만 레이즈',
    strip: '· R R R (R/F) R/F▌F F F F F F F',
    sentence: 'BTN은 림프에 오프수트 A를 AJo까지 레이즈하고, ATo·A9o는 절반만 레이즈해요.',
    frame: 'P2m',
    em: 36.1,
    // [이름] 'A4s까지'가 A7s·A6s(레이즈 50 · 폴드 50)를 덮었습니다 — '나머지 전부' 꼴.
    sibling: '수티드 A는 레이즈하고, A7s·A6s·A3s·A2s는 절반만 레이즈해요.',
    mix: '레이즈 50% · 폴드 50%',
    partial: '이 칸은 레이즈를 정답으로 쳐요. 폴드도 부분 정답이에요.', // [부분]
    numbers: '내 레이즈 17%',
    lever: null,
    tiles: 'HJ 폴드 · CO 폴드 · BTN 절반만 레이즈 · SB 폴드 · BB 체크',
    across: 'ATo는 림프에 BTN에서 절반만 레이즈하고, 나머지 자리에서는 폴드나 체크예요.', // [자리]
    example: '내 A♠10♦ vs 상대 A♦K♠ → A를 맞춰도 킥커에서 밀려요.',
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'BB', villain: 'BTN' },
    hand: '54s',
    title: 'BB 오픈 대응 · 54s',
    capsule: '3벳·콜 반반',
    strip: '_ · · · · C/3 C/3 C/3 C/3 3/C (3/C) C C/F',
    // [이름] 65s·54s 는 3벳·콜 반반이고 32s 는 콜 50 · 폴드 50 — '65s·54s만 3벳'과 '나머지는 전부 콜'이 둘 다 과장이었습니다.
    sentence: 'BB는 BTN 오픈에 수티드 커넥터를 콜하고, 65s·54s는 3벳·콜 반반, 32s는 절반만 콜해요.',
    frame: 'P4',
    em: 39.8,
    sibling: null,
    mix: '3벳 50% · 콜 50%',
    partial: '반반이라 더 공격적인 3벳을 정답으로 쳐요. 콜도 부분 정답이에요.',
    numbers: 'BTN 오픈 46% → 내 콜 48% · 3벳 13%',
    lever: 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.',
    tiles: 'SB 폴드 · BB 3벳·콜 반반',
    across: '54s는 BTN 오픈에 SB에서 폴드, BB에서 3벳·콜 반반이에요.',
    example: null,
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'SB', villain: 'UTG' },
    hand: 'QJs',
    title: 'SB 오픈 대응 · QJs',
    capsule: '주로 폴드',
    strip: '· · · (F/3) F F F F F F F F F',
    sentence: 'SB는 UTG 오픈에 수티드 Q를 QJs만 가끔 3벳하고, 나머지는 폴드해요.',
    frame: 'P0h',
    em: 31.3,
    sibling: '오프수트 Q는 전부 폴드해요.',
    mix: '폴드 75% · 3벳 25%',
    partial: null,
    numbers: 'UTG 오픈 18% → 내 3벳 8% · 콜 1%',
    lever: 'SB는 콜을 거의 안 하고, 3벳 아니면 폴드해요.',
    tiles: 'HJ 콜 · CO 콜 · BTN 콜 · SB 주로 폴드 · BB 주로 콜',
    across: 'QJs는 UTG 오픈에 SB에서는 주로 폴드하고, 나머지 자리에서는 콜해요.', // [자리]
    example: null,
    memo: true,
  },
];

describe('EXPLAIN_SPEC 의 실제 칸 13개 (§3.6 · §4.3)', () => {
  for (const c of CASES) {
    it(c.title, () => {
      const e = explainStep(stepFor(c.s, c.hand));
      const kind = c.s.kind;
      // ① 리빌(§3.6)
      expect(e.title).toBe(c.title);
      expect(e.capsule.label).toBe(c.capsule);
      expect(stripNotation(e, kind)).toBe(c.strip);
      expect(e.line.sentence?.text).toBe(c.sentence);
      expect(e.line.sentence?.frame).toBe(c.frame);
      expect(Number(emWidth(c.sentence).toFixed(1))).toBe(c.em);
      // ②~⑦ 시트(§4.3)
      expect(e.sibling?.text ?? null).toBe(c.sibling);
      expect(e.mix ? e.mix.chips.map((x) => `${{ raise: kind === 'vs_limp' ? '레이즈' : '오픈', call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크' }[x.action]} ${x.pct}%`).join(' · ') : null).toBe(c.mix);
      expect(e.mix?.partial ?? null).toBe(c.partial);
      expect(e.seat.numbers).toBe(c.numbers);
      expect(e.seat.lever).toBe(c.lever);
      expect(e.across.cells.map((x) => `${x.scenario.hero} ${x.reachable ? tileLabel(x.mixList, kind, x.scenario.hero) : '—'}`).join(' · ')).toBe(c.tiles);
      expect(e.across.line.text).toBe(c.across);
      expect(e.more.example).toBe(c.example);
      expect(!!e.more.memo).toBe(c.memo);
      expect(e.disclaimer !== null).toBe(kind === 'vs_limp');
    });
  }

  it('§3.6 같은 줄, 다른 칸: KTo 로 오답이면 한 칸 밖(경계 = KJo), KTs(SB vs UTG)도 한 칸 밖', () => {
    const kto = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'KTo'));
    expect(kto.line.sentence!.text).toBe('UTG는 오프수트 K를 KQo만 오픈하고, KJo는 절반만 오픈해요.');
    expect(kto.nearMiss).toBe('한 칸 밖');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs')).nearMiss).toBe('한 칸 밖');
  });
});

/** 타일 라벨(§4.2-⑥): 1순위 액션, 100% 미만이면 비중어. 반반은 캡슐과 같은 'a·b 반반'. */
function tileLabel(mix: Array<{ action: Action; weight: number }>, kind: ScenarioKind, hero: string): string {
  const w = (a: Action) => ({ raise: kind === 'vs_limp' ? '레이즈' : '오픈', call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크' })[a];
  const [m0, m1] = mix;
  if (m0.weight >= 0.999) return w(m0.action);
  if (m0.weight >= 0.6) return `주로 ${w(m0.action)}`;
  const rest = kind === 'vs_limp' && hero === 'BB' ? 'check' : 'fold';
  if (m1 && Math.abs(m1.weight - m0.weight) < 0.01 && m1.action !== rest) return `${w(m0.action)}·${w(m1.action)} 반반`;
  return `${m0.action === rest ? '절반은' : '절반만'} ${w(m0.action)}`;
}
