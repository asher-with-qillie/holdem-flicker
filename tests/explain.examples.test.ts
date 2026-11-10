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
 *
 * 줄 문장의 모호함 고치기(docs/THEORY_SPEC.md §5) 뒤 다시 고정:
 *  [§5c] 비중어 바로 뒤의 '나머지는' → '그 아래 칸은'(줄 문장) · '다른 자리에서는'(자리 문장).
 *  [§5d] 'KQo만 오픈하고, KJo는 절반만 오픈해요'의 자기모순 → '늘 오픈하는 건 KQo까지이고, …'.
 *  [§5g] 'X에서만 폴드해요'는 다른 자리가 무엇을 하는지까지.
 *  [§5h] 예시는 결정과 맞을 때만(THEORY_SPEC §6.4) — 지배 예시는 폴드·섞기 칸, 셋 확률은 콜·오픈·체크 칸.
 *
 * 감사(audit-static) 반영 뒤 다시 고정:
 *  [무차별] 부분 정답 문장 — 두 액션의 가치가 비슷하다는 것(책 2장 4절)을 먼저, '정답'은 채점이라고(40자 안).
 *  [레버]   SB 오픈은 'BB만 남아도 포지션이 없어 BTN만큼' · SB 오픈 대응은 '대부분' · HJ · CO · BTN 오픈 대응은 스퀴즈 위험.
 *  [콜드]   콜드 상황의 앞머리 '오픈과 3벳 뒤에'(책 5장 3절 — 앞의 오픈까지).
 *  [섞음]   P0h 의 '가끔' → 섞는 비중('3벳을 25% 섞고').
 *  [셋]     셋이 될 확률은 '약 12%'(11.8% — 용어집과 같은 말).
 *
 * 74개 차트를 책(MPT 5장)에 맞춰 다시 만든 뒤 다시 고정 — [책]:
 *  - 칸이 스펙에서 맡은 점을 그대로 가르치면 문자열만 새 출력으로 바꿨습니다(KJo · A5s · 22 · KTs). 문자열마다 차트에서 다시 확인했습니다.
 *  - 그 점이 그 칸에서 사라졌으면(섞던 칸이 순수해짐, 줄 모양이 바뀜) 같은 점을 가르치는 칸으로 옮기고 docs/EXPLAIN_SPEC.md
 *    §3.6 · §4.3 도 함께 고쳤습니다: SB 오픈 85o → 75o(P0), BTN←HJ 76s → BB←UTG 87s(커넥터 P2m), HJ←UTG QQ → BTN←HJ AKo
 *    (P3h · 주로), CO 콜드 QQ → JJ(콜드는 콜이 없음 · 주로 꼬리), BB 림프 55 → 44(체크 · P2c), BTN 림프 ATo → Q8o(절반만 레이즈),
 *    BB←BTN 54s → BB←CO 54s(P4 커넥터 · 반반), SB←UTG QJs → HJ←BTN 3벳 KQo(P0h). vs_5bet 15개 차트에는 섞는 칸이 없어
 *    QQ 를 남기고, 가르치는 점을 §5(a)(칸 이름) · P1 로 바꿨습니다.
 *  - [레버] SB 오픈은 '포지션이 없어 레이즈 24%에 림프 38%를 섞어요', SB 오픈 대응은 '콜 없이 3벳 아니면 폴드'(콜 0%).
 *  - 메모 유무(memo · example)는 이 판의 차트 메모 기준입니다. 메모를 고쳐 쓰는 단계에서 칸에 메모가 생기거나 없어지면
 *    example 도 함께 바뀝니다(메모가 있으면 예시 없음, §4.2-⑦).
 */

/** §3.6 의 스트립 표기: · 유령, ┆ 도달 불가, _ 빈칸, ▌ 경계 막대, ( ) 링, a/b 섞인 칸(1·2순위). */
function stripNotation(e: Explanation, kind: ScenarioKind): string {
  const A: Record<Action, string> = { raise: kind === 'vs_limp' ? 'R' : 'O', call: 'C', threebet: '3', fourbet: '4', allin: 'J', fold: 'F', check: 'X', limp: 'L' };
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
    hand: '75o',
    title: 'SB 오픈 · 75o',
    capsule: '폴드',
    // [책] 옛 85o 의 줄(오프수트 8)은 SB 가 87o 를 림프해 P0 이 아니게 됐습니다('87o만 림프해요', P2). 전부 폴드인 줄(P0)은
    // SB 의 오프수트 7 이 이어받습니다. 스펙 표기의 '│'는 범례에 없는 구분선이라 뺐습니다(유령 8칸 + 줄 칸 5칸 = 13).
    strip: '· · · · · · · · F (F) F F F',
    sentence: 'SB는 오프수트 7을 전부 폴드해요.',
    frame: 'P0',
    em: 15.3,
    sibling: '수티드 7은 73s까지 림프해요.', // [책] SB 는 레이즈 · 림프 · 폴드 세 가지(책 5장 2절) — 76s~73s 는 림프, 72s 는 폴드.
    mix: null,
    partial: null,
    // [책] SB 칸은 레이즈와 림프를 따로 댑니다(책 5장 2절: 림프 약 38% · 레이즈 약 24%).
    numbers: 'UTG 17% · HJ 21% · CO 28% · BTN 43% · SB 레이즈 24% · 림프 38%',
    // [책] 숫자는 책 5장 2절(레이즈 약 24% · 림프 약 38%). 책이 드는 림프의 이유는 '포지션이 없어서'가 아니라 반값 할인입니다
    // (포지션이 없는 어려운 자리지만 할인이 있어 SB 에서만 림프가 의미 있음) — 레버 문구는 생성기(sheet.ts seatLever)의 것을 고정합니다.
    lever: 'SB는 포지션이 없어 레이즈 24%에 림프 38%를 섞어요.',
    tiles: 'UTG 폴드 · HJ 폴드 · CO 폴드 · BTN 폴드 · SB 폴드',
    across: '75o는 어느 자리에서도 오픈하지 않아요.',
    example: null,
    memo: false,
  },
  {
    s: { kind: 'rfi', hero: 'UTG' },
    hand: 'KJo',
    title: 'UTG 오픈 · KJo',
    capsule: '절반만 오픈',
    strip: '· · O (O/F)▌F F F F F F F F F',
    sentence: 'UTG는 오프수트 K 중 늘 오픈하는 건 KQo까지이고, KJo는 절반만 오픈해요.', // [§5d]
    frame: 'P2m',
    em: 33.6,
    sibling: '수티드 K는 K9s까지 오픈해요.',
    mix: '오픈 50% · 폴드 50%',
    partial: '오픈과 폴드는 가치가 비슷해요. 채점은 오픈이 정답이에요.', // [부분] [무차별]
    numbers: 'UTG 17% · HJ 21% · CO 28% · BTN 43% · SB 레이즈 24% · 림프 38%', // [책] 책의 RFI 폭 17 · 21 · 28 · 43
    lever: 'UTG는 뒤에 5명이 남아 17%만 오픈해요.',
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
    strip: '· 4 4/C C C C/F 4/F F F (4) 4 4 4',
    // [책] 포지션 없이 3벳을 받으면 콜하면 플랍 이후 내내 불리해 4벳을 늘립니다(책 5장 3절) — 이 차트에서는 휠 A(A5s~A2s)가
    // 전부 4벳, A8s 는 4벳 50 · 폴드 50, AQs 는 4벳·콜 반반. 섞인 칸 둘의 이름까지 대면 42em 을 넘어, 주어의 상대 액션을 뺀
    // noCtx 꼴('CO에서 …')이 됩니다(상대는 리빌 바로 위 상황 줄이 말합니다).
    // [이름] A9s(콜 75 · 폴드 25)는 이름 없이 'A9s까지는 콜'이 덮습니다 — 0.6 이상이라 덮어도 되는 비중(§3.4).
    sentence: 'CO에서 AKs·A5s~A2s는 4벳, A8s는 절반만 4벳, AQs는 4벳·콜 반반, A9s까지는 콜해요.',
    frame: 'P4',
    em: 38.9,
    // [이름] AQo(4벳·콜 반반) · AJo(4벳 50 · 폴드 50)를 부릅니다 — 세 항목이라 칸 나열 꼴.
    sibling: '오프수트 A 중 AKo는 4벳, AQo는 4벳·콜 반반, AJo는 절반만 4벳해요.',
    mix: null,
    partial: null,
    numbers: 'BTN 3벳 12% → 내 콜 7% · 4벳 6%',
    lever: 'CO는 BTN보다 포지션이 없어요.',
    tiles: 'UTG 4벳 · HJ 4벳 · CO 4벳',
    across: 'A5s는 BTN 3벳에 어느 자리에서나 4벳해요.',
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
    numbers: 'CO 오픈 28% → 내 콜 29% · 3벳 9%',
    lever: 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.',
    tiles: 'BTN 절반만 콜 · SB 폴드 · BB 콜',
    // [책] 책 5장 5절: CO처럼 넓게 열수록 블라인드의 스퀴즈가 늘어 BTN 의 콜 범위는 줄어듭니다. 이 차트에서는 BTN 이 CO 오픈에
    // 33 · 22 를 절반만 콜해(어느 패인지는 책이 아니라 차트) 'SB에서만 폴드' 꼴(§5g)이 아니라 S-c 칸 나열이 됩니다 — 절반만 콜하는
    // BTN 을 콜로 덮지 않습니다.
    across: '22는 CO 오픈에 BTN에서 절반만 콜, SB에서 폴드, BB에서 콜이에요.',
    example: '내 2♠2♦ → 플랍에서 셋이 될 확률은 약 12%예요.', // [셋] [§5h] 콜하는 작은 페어 — 셋 확률이 이 결정의 이유예요(THEORY_SPEC §1-2).
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'BB', villain: 'UTG' },
    hand: '87s',
    title: 'BB 오픈 대응 · 87s',
    capsule: '콜',
    // [책] 옛 칸 BTN ← HJ 76s 는 BTN 이 이제 오픈에 콜을 5~7%만 하고 3벳을 양극화해(책 5장 5절) P4 줄이 됐습니다
    // ('T9s는 콜, 98s는 3벳·콜 반반, 54s까지는 3벳'). 수티드 커넥터 줄의 P2m(빈칸 · 유령 4칸 + 경계 막대)은 BB ← UTG 가
    // 이어받습니다. 76s~54s(콜 75 · 3벳 25)는 이름 없이 '54s까지 콜'이 덮습니다(§9: '까지'는 full · 주로 칸까지).
    strip: '_ · · · · C C (C) C/3 C/3 C/3 C/F▌F',
    sentence: 'BB는 UTG 오픈에 수티드 커넥터를 54s까지 콜하고, 43s는 절반만 콜해요.',
    frame: 'P2m',
    em: 32.9,
    sibling: null,
    mix: null,
    partial: null,
    numbers: 'UTG 오픈 17% → 내 콜 23% · 3벳 6%',
    lever: 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.',
    tiles: 'HJ 폴드 · CO 폴드 · BTN 3벳·콜 반반 · SB 폴드 · BB 콜',
    across: '87s는 UTG 오픈에 HJ·CO·SB에서 폴드, BTN에서 3벳·콜 반반, BB에서 콜이에요.', // [자리] 반반인 BTN 은 캡슐 라벨로
    example: null, // 수티드 커넥터에는 예시 모양이 없습니다(exampleShape).
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'SB', villain: 'UTG' },
    hand: 'KTs',
    title: 'SB 오픈 대응 · KTs',
    capsule: '폴드',
    strip: '· · 3 3/F▌(F) F F F F F F F F',
    sentence: 'SB는 UTG 오픈에 수티드 K 중 늘 3벳하는 건 KQs까지이고, KJs는 절반만 3벳해요.', // [§5d]
    frame: 'P2m',
    em: 36.6,
    // [책] SB 는 콜 없이 강한 패부터 선형으로 3벳해(책 5장 4절 — 이 차트는 7%) KQo 도 3벳하지 않습니다 — 옛 'KQo는 절반만 3벳하고,
    // 그 아래 칸은 폴드해요'([§5c])가 줄 전체 폴드로.
    sibling: '오프수트 K는 전부 폴드해요.',
    mix: null,
    partial: null,
    numbers: 'UTG 오픈 17% → 내 3벳 7%', // [책] 콜 0% 라 숫자 줄에서 빠집니다(0인 액션은 뺌, §4.2-④).
    lever: 'SB는 콜 없이 3벳 아니면 폴드해요.', // [책] 책 5장 5절 '앞자리의 오픈에는 콜 없이 3-bet 아니면 폴드' — 콜 비중이 정확히 0
    tiles: 'HJ 폴드 · CO 폴드 · BTN 콜 · SB 폴드 · BB 콜',
    across: 'KTs는 UTG 오픈에 BTN·BB에서만 콜해요.', // [책] HJ · CO 도 콜 없이 3벳 아니면 폴드 — 콜하는 자리는 BTN · BB 뿐(S-b)
    example: '내 K♠10♠ vs 상대 A♦K♦ → K를 맞춰도 킥커에서 밀려요.', // 폴드 칸이라 지배 예시가 남습니다.
    memo: false,
  },
  {
    s: { kind: 'vs_4bet', hero: 'BTN', villain: 'HJ' },
    hand: 'AKo',
    title: 'BTN 4벳 대응 · AKo',
    capsule: '주로 올인',
    // [책] 옛 칸 HJ ← UTG QQ(콜 75 · 올인 25)는 콜 100% 가 됐습니다(책 5장 5절: 포지션이 있으면 KK보다 약한 페어는 대부분 콜).
    // 'P3h · 주로 칸 · 2순위 25% 라 부분 정답 없음 · 점선 칸'은 BTN ← HJ 의 AKo(올인 75 · 콜 25)가 이어받습니다.
    strip: '· (J/C) C/F▌F ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆',
    sentence: 'BTN은 HJ 4벳에 오프수트 A 중 AKo는 주로 올인하고, AQo는 절반만 콜해요.',
    frame: 'P3h',
    em: 33.7,
    sibling: '수티드 A 중 AKs는 주로 올인하고, AJs까지는 콜해요.',
    mix: '올인 75% · 콜 25%',
    partial: null, // 25 < 40
    numbers: 'HJ 4벳 5% → 내 콜 3% · 올인 2%',
    lever: 'BTN은 HJ보다 포지션이 있어요.',
    tiles: 'CO 주로 올인 · BTN 주로 올인 · SB 주로 올인 · BB 주로 올인',
    across: 'AKo는 HJ 4벳에 어느 자리에서나 주로 올인해요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'vs_5bet', hero: 'CO', villain: 'BTN' },
    hand: 'QQ',
    title: 'CO 올인 대응 · QQ',
    capsule: '콜',
    // [책] 올인(5벳)에는 TT 이상과 AK 만 콜하고(책 5장 3절), vs_5bet 15개 차트에 섞는 칸이 하나도 없습니다. 옛 'QQ는 주로 콜'
    // (콜 75 · 폴드 25)이 콜 100% 가 돼, 이 칸은 이제 §5(a) — 도달 칸이 줄의 일부뿐이면 줄 이름 대신 칸 이름으로
    // ('AA~TT을', 99 아래는 CO 가 4벳하지 않아 점선) — 와 P1 을 보여 줍니다. '주로 · P2m 꼬리'는 9번(콜드 JJ)이 이어받습니다.
    strip: 'C C (C) C C ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆',
    sentence: 'CO는 BTN 올인에 AA~TT을 콜해요.',
    frame: 'P1',
    em: 15.2,
    sibling: null,
    mix: null,
    partial: null,
    numbers: 'BTN 올인 2% → 내 콜 3%',
    lever: null,
    tiles: 'UTG 콜 · HJ 콜 · CO 콜',
    across: 'QQ는 BTN 올인에 어느 자리에서나 콜해요.',
    example: null,
    memo: true,
  },
  {
    s: { kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } },
    hand: 'JJ',
    title: 'CO 콜드 4벳 · JJ',
    capsule: '주로 4벳',
    // [책] 오픈과 3벳 사이에서는 4벳 아니면 폴드라(책 5장 3절) 콜드 4벳 차트에 콜이 없고, 옛 QQ(4벳·콜 반반)가 4벳 100% 가
    // 됐습니다. 두 계속 액션의 반반('더 공격적인 …')은 12번이 보여 주고, 여기서는 JJ(4벳 75 · 폴드 25)가 P2m 꼬리의 주로 칸
    // (옛 8번 'QQ는 주로 콜'의 모양)과 부분 정답 없음(25 < 40)을 보여 줍니다.
    strip: '4 4 4 (4/F)▌F F F F F F F F F',
    sentence: 'CO는 오픈과 3벳 뒤에 포켓페어를 QQ까지 4벳하고, JJ는 주로 4벳해요.', // [콜드]
    frame: 'P2m',
    em: 31.7,
    sibling: null,
    mix: '4벳 75% · 폴드 25%',
    partial: null, // 25 < 40
    numbers: '내 4벳 3%', // [책] 콜 0% 라 빠집니다.
    lever: null,
    tiles: 'CO 주로 4벳 · BTN 4벳 · SB 4벳 · BB 4벳',
    across: 'JJ는 오픈과 3벳 뒤에 CO에서 주로, BTN~BB에서 항상 4벳해요.', // [콜드] S-a 비중어가 다른 꼴('주로 · 항상')
    example: null,
    memo: true,
  },
  {
    // 림퍼는 언제나 SB 입니다(scenarios.limperOf — BB 차트는 'SB 가 림프했고 BB 차례').
    s: { kind: 'vs_limp', hero: 'BB', extras: { limper: 'SB' } },
    hand: '44',
    title: 'BB 림프 대응 · 44',
    capsule: '체크',
    // [책] BB 는 SB 의 림프에 55 이상을 레이즈해(BOOK_CHART_SPEC §5 — 책이 칸을 주지 않는 곳이라 공개 솔버 자료로 채움) 옛 55(체크)가
    // 레이즈가 됐습니다. 체크 칸 · P2c · 공짜 플랍 레버는 바로 아래 44 가 이어받습니다.
    strip: 'R R R R R R R R R R▌(X) X X',
    sentence: 'BB는 림프에 포켓페어를 55까지 레이즈하고, 44부터는 체크해요.',
    frame: 'P2c',
    em: 29.0,
    sibling: null,
    mix: null,
    partial: null,
    numbers: '내 레이즈 40% · 나머지 체크',
    lever: 'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.',
    tiles: 'HJ 레이즈 · CO 레이즈 · BTN 레이즈 · SB 레이즈 · BB 체크',
    // [책] HJ · CO · BTN 은 림퍼를 평소 오픈 범위만큼 아이솔레이트하고(책 4장 7절: 뒤에 공격적인 사람이 있으면 평소 오픈 범위
    // 수준으로) SB 도 44 를 레이즈합니다 — 레이즈하는 넷을 묶고 BB 의 체크를 따로.
    across: '44는 림프에 HJ~SB에서 레이즈하고, BB에서는 체크해요.',
    example: '내 4♠4♦ → 플랍에서 셋이 될 확률은 약 12%예요.', // [셋] [§5h] 체크로 플랍을 보는 작은 페어 — 셋 확률이 이유예요.
    memo: false,
  },
  {
    s: { kind: 'vs_limp', hero: 'BTN', extras: { limper: 'HJ' } },
    hand: 'Q8o',
    title: 'BTN 림프 대응 · Q8o',
    capsule: '절반만 레이즈',
    // [책] HJ · CO · BTN 은 림퍼를 평소 오픈 범위만큼 아이솔레이트해(책 4장 7절 — 이 차트는 BTN 오픈과 칸까지 같음) 옛 ATo(레이즈 50 · 폴드 50)가 레이즈 100% 가
    // 됐습니다. '절반만 레이즈 · 부분 정답 · S-b′ 자리 문장'은 BTN 오픈과 같은 50% 칸인 Q8o 가 이어받습니다.
    strip: '· · · R R R (R/F)▌F F F F F F',
    sentence: 'BTN은 림프에 오프수트 Q를 Q9o까지 레이즈하고, Q8o는 절반만 레이즈해요.',
    frame: 'P2m',
    em: 34,
    sibling: '수티드 Q는 전부 레이즈해요.',
    mix: '레이즈 50% · 폴드 50%',
    partial: '레이즈와 폴드는 가치가 비슷해요. 채점은 레이즈가 정답이에요.', // [부분] [무차별]
    numbers: '내 레이즈 43%',
    lever: null,
    tiles: 'HJ 폴드 · CO 폴드 · BTN 절반만 레이즈 · SB 폴드 · BB 체크',
    across: 'Q8o는 림프에 BTN에서 절반만 레이즈하고, 다른 자리에서는 폴드나 체크예요.', // [자리] [§5c]
    example: null, // Q8o 에는 예시 모양이 없습니다(exampleShape — 킥커 대결 계열이 아님). 메모도 없어 ⑦ 은 숨김.
    memo: false,
  },
  {
    s: { kind: 'vs_open', hero: 'BB', villain: 'CO' },
    hand: '54s',
    title: 'BB 오픈 대응 · 54s',
    capsule: '3벳·콜 반반',
    // [책] BB 는 BTN 상대로 선형으로 3벳해(책 5장 5절: BN 을 상대로 선형, SB 를 상대로 양극화 — 4절이 짚은 예외) 옛 BB ← BTN
    // 커넥터 줄이 '43s까지 콜'(P2)이 됐습니다. '단조롭지 않은 커넥터 줄(P4) · 3벳·콜 반반 · 더 공격적인 3벳'은 BB ← CO 가
    // 이어받습니다 — 87s~54s 를 블러프 쪽 3벳과 콜로 반반, 그 위아래 98s 까지 · 43s 는 콜.
    strip: '_ · · · · C C 3/C 3/C 3/C (3/C) C F',
    sentence: 'BB는 CO 오픈에 수티드 커넥터 중 98s까지는 콜, 87s~54s는 3벳·콜 반반, 43s는 콜해요.',
    frame: 'P4',
    em: 39.3,
    sibling: null,
    mix: '3벳 50% · 콜 50%',
    partial: '3벳과 콜은 가치가 비슷해요. 채점은 더 공격적인 3벳이 정답이에요.', // [무차별]
    numbers: 'CO 오픈 28% → 내 콜 29% · 3벳 9%',
    lever: 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.',
    tiles: 'BTN 3벳 · SB 폴드 · BB 3벳·콜 반반',
    across: '54s는 CO 오픈에 BTN에서 3벳, SB에서 폴드, BB에서 3벳·콜 반반이에요.',
    example: null,
    memo: false,
  },
  {
    s: { kind: 'vs_3bet', hero: 'HJ', villain: 'BTN' },
    hand: 'KQo',
    title: 'HJ 3벳 대응 · KQo',
    capsule: '주로 폴드',
    // [책] SB 가 오픈에 콜 없이 선형으로 3벳해(책 5장 4절) 옛 칸 SB ← UTG QJs(폴드 75 · 3벳 25)가 폴드 100% 가 됐고,
    // vs_open 에는 P0h 줄이 하나도 남지 않았습니다. 'P0h · 주로 폴드 · 섞는 비중([섞음])'은 HJ ← BTN 3벳의 KQo
    // (폴드 75 · 4벳 25)가 이어받습니다. 나머지 칸은 '그 아래 칸은' 대신 이름으로 댑니다(KJo·KTo).
    strip: '· · (F/4) F F ┆ ┆ ┆ ┆ ┆ ┆ ┆ ┆',
    sentence: 'HJ는 BTN 3벳에 오프수트 K 중 KQo만 4벳을 25% 섞고, KJo·KTo는 폴드해요.', // [섞음]
    frame: 'P0h',
    em: 33.9,
    sibling: '수티드 K는 KTs까지 콜해요.', // KQs(콜 75 · 4벳 25)는 '까지'가 덮습니다.
    mix: '폴드 75% · 4벳 25%',
    partial: null,
    numbers: 'BTN 3벳 9% → 내 콜 6% · 4벳 5%',
    lever: 'HJ는 BTN보다 포지션이 없어요.',
    tiles: 'UTG 주로 폴드 · HJ 주로 폴드 · CO 절반만 4벳',
    across: 'KQo는 BTN 3벳에 CO에서는 절반만 4벳하고, 다른 자리에서는 주로 폴드해요.', // [자리] S-b — 소수의 비중어와 다수의 비중어를 함께
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
      expect(e.mix ? e.mix.chips.map((x) => `${{ raise: kind === 'vs_limp' ? '레이즈' : '오픈', call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크', limp: '림프' }[x.action]} ${x.pct}%`).join(' · ') : null).toBe(c.mix);
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
    expect(kto.line.sentence!.text).toBe('UTG는 오프수트 K 중 늘 오픈하는 건 KQo까지이고, KJo는 절반만 오픈해요.');
    expect(kto.nearMiss).toBe('한 칸 밖');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs')).nearMiss).toBe('한 칸 밖');
  });
});

/** 타일 라벨(§4.2-⑥): 1순위 액션, 100% 미만이면 비중어. 반반은 캡슐과 같은 'a·b 반반'. */
function tileLabel(mix: Array<{ action: Action; weight: number }>, kind: ScenarioKind, hero: string): string {
  const w = (a: Action) => ({ raise: kind === 'vs_limp' ? '레이즈' : '오픈', call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크', limp: '림프' })[a];
  const [m0, m1] = mix;
  if (m0.weight >= 0.999) return w(m0.action);
  if (m0.weight >= 0.6) return `주로 ${w(m0.action)}`;
  const rest = kind === 'vs_limp' && hero === 'BB' ? 'check' : 'fold';
  if (m1 && Math.abs(m1.weight - m0.weight) < 0.01 && m1.action !== rest) return `${w(m0.action)}·${w(m1.action)} 반반`;
  return `${m0.action === rest ? '절반은' : '절반만'} ${w(m0.action)}`;
}
