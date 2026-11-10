/*
 * 원리 카드 — 해설의 '왜'가 기대는 책의 원리. docs/THEORY_SPEC.md §3.
 *
 * 출처: 사용자가 준 『Modern Poker Theory』(Michael Acevedo) 학습 노트. 카드 본문은 노트의 해당 절을
 * 앱의 말투(해요체)와 자리 이름(LJ → UTG, BN → BTN)으로 옮긴 것이고, 책에 없는 인과는 넣지 않았습니다.
 * 위치 표기는 '책 장 · 원서 절 제목(노트 절 번호)'입니다. 원서는 절에 번호가 없어서, 노트 번호를 같이 적습니다.
 *
 * 숫자(numbers)는 책의 공식을 책의 베팅 크기(price.ts — 노트 5장 1절)로 계산한 값입니다.
 */
import { josa } from '../ko';
import type { Scenario } from '../types';
import { bb, fourbetSize, limpFacts, pct, priceOf, threebetRisk, threebetSize } from './price';

export type PrincipleId =
  | 'seats-behind'
  | 'steal-breakeven'
  | 'hand-strength'
  | 'early-high-cards'
  | 'raise-or-fold'
  | 'sb-first-in'
  | 'sb-limp'
  | 'bb-price'
  | 'bb-vs-opener'
  | 'sb-3bet-or-fold'
  | 'squeeze-risk'
  | 'btn-call'
  | 'tighter-after-raise'
  | 'polar-linear'
  | 'blockers'
  | 'bluff-equity'
  | 'vs3bet-position'
  | 'threebet-shape'
  | 'offsuit-3bet-pot'
  | 'fourbet-polar'
  | 'vs-4bet'
  | 'vs-5bet'
  | 'fivebet-bluff'
  | 'cold-4bet'
  | 'realization'
  | 'domination'
  | 'board-coverage'
  | 'mixing'
  | 'vs-limper'
  | 'free-check'
  | 'blind-vs-blind'
  | 'mdf-alpha';

export interface Principle {
  id: PrincipleId;
  /** 칩에 쓰는 짧은 이름(≤ 10자) */
  chip: string;
  /** 카드 본문: 해요체 2~3문장. 책의 이유만 씁니다. */
  body: string;
  /** 책 위치 */
  ref: string;
  /** 이 상황에 맞춘 숫자 한 줄(없으면 null) */
  numbers?: (s: Scenario) => string | null;
}

const SEATS_BEHIND: Record<string, number> = { UTG: 5, HJ: 4, CO: 3, BTN: 2, SB: 1 };

export const PRINCIPLES: Record<PrincipleId, Principle> = {
  'seats-behind': {
    id: 'seats-behind',
    chip: '뒤에 남은 사람',
    body:
      '오픈할 수 있는 폭은 내 뒤에 몇 명이 남았는지, 그들이 플랍 이후 나보다 나중에 행동하는지가 정해요. 뒤에 사람이 많을수록 누군가 3벳할 확률이 커지고, 3벳을 받고 폴드하는 패가 많으면 상대는 아무 패로나 3벳해도 이득을 봐요. 그래서 앞자리는 3벳을 받아도 버틸 수 있는 만큼만 오픈해요.',
    ref: '책 5장 「자리별 처음 레이즈」·4장 「처음 들어오기」(노트 5장 2절, 4장 6절)',
    numbers: (s) => {
      const n = SEATS_BEHIND[s.hero];
      if (s.kind !== 'rfi' || !n) return null;
      // 6-max 에서는 UTG 도 약 30%라 스틸의 본전(약 38%)보다 낮아요. 그래서 이 숫자는 '방향'으로만 말해요 —
      // 책의 예(9명 테이블 UTG 44%)처럼 문턱을 넘는다고 읽히면 틀려요(교차 검토).
      const me = `${josa(s.hero, '은/는')} 약 ${pct(threebetRisk(n))}`;
      const btn = s.hero === 'BTN' ? '' : `, BTN은 약 ${pct(threebetRisk(SEATS_BEHIND.BTN))}`;
      return `뒤에 남은 사람이 저마다 7%씩 3벳하면 ${me}${btn} 확률로 3벳을 받아요(콜을 뺀 책의 단순 모형이라, 뒤에 사람이 많을수록 위험이 커진다는 방향만 보여 줘요).`;
    },
  },
  'steal-breakeven': {
    id: 'steal-breakeven',
    chip: '스틸의 본전',
    body:
      '3벳을 받으면 늘 폴드하는 패라도, 2.5bb로 오픈해 블라인드 1.5bb를 노릴 때 3벳이 약 38%보다 적게 나오면 이득이에요. 블라인드 둘만 남은 BTN은 이 문턱보다 3벳을 훨씬 덜 받아서 넓게 오픈할 수 있어요.',
    ref: '책 4장 「처음 들어오기」 3-bet을 당할 가능성(노트 4장 6절 변수 4)',
    numbers: () => '블라인드가 3벳할 확률을 f라 하면 (1 − f) × 1.5bb = f × 2.5bb에서 본전인 f는 약 38%라, 3벳이 이보다 적으면 3벳에 폴드할 패로도 오픈이 이득이에요.',
  },
  'hand-strength': {
    id: 'hand-strength',
    chip: '패의 네 가지 힘',
    body:
      '패 자체의 힘은 높은 카드, 포켓페어(숫자가 높을수록), 수티드, 연결성 네 가지에서 나와요. 좋은 패는 이 중 둘 이상을 갖춰요. 87s는 높은 카드가 없어도 수티드이면서 연결돼 있고, AKo는 수티드가 아니어도 높은 카드가 아주 강해요.',
    ref: '책 4장 「처음 들어오기」 절대적인 핸드 강도(노트 4장 6절 변수 1)',
    numbers: () => 'T9로 스트레이트가 되는 플랍은 4가지(너츠 3가지), T7은 2가지(너츠 1가지)예요.',
  },
  'early-high-cards': {
    id: 'early-high-cards',
    chip: '앞자리의 킥커',
    body:
      '앞자리일수록 뒤에 더 강한 패가 있을 확률이 높아서, 같은 카드를 맞혀도 킥커에서 지지 않을 높은 카드가 필요해요. 그래서 수티드 Q는 BTN에서 Q2s까지 오픈하지만 UTG에서는 Q9s까지만 오픈해요.',
    ref: '책 4장 「처음 들어오기」 절대적인 핸드 강도(노트 4장 6절)',
  },
  'raise-or-fold': {
    id: 'raise-or-fold',
    chip: '레이즈 아니면 폴드',
    body:
      'SB를 뺀 자리는 림프하지 않고 레이즈 아니면 폴드로 들어가요. 림프는 레이즈였다면 폴드했을 패에게 싼 플랍을 주고, 림프하는 패와 레이즈하는 패를 일찍 나눠 정보를 흘려요. 레이크가 있는 게임에서는 이런 얇은 이득이 쉽게 사라져요.',
    ref: '책 4장 「림프」·5장 「자리별 처음 레이즈」(노트 4장 7절, 5장 2절)',
  },
  'sb-first-in': {
    id: 'sb-first-in',
    chip: 'SB의 첫 진입',
    body:
      'SB는 이미 0.5bb를 내 반값으로 들어갈 수 있지만, 플랍 이후에는 늘 포지션이 없어요. 그래서 레이즈는 3bb로 크게 해서 BB가 싸게 따라와 포지션으로 에퀴티를 챙기지 못하게 해요. 책의 균형 전략은 이 할인 때문에 SB에서만 림프를 섞어요(림프 약 38% · 레이즈 약 24%).',
    ref: '책 5장 「권장 베팅 크기」·「자리별 처음 레이즈」(노트 5장 1~2절)',
    // BB 가 콜할 때의 필요 승률 = 콜 금액 ÷ 콜 뒤의 팟: 3bb 오픈이면 2 ÷ 6, 2.5bb 오픈이면 1.5 ÷ 5.
    numbers: (s) => (s.kind === 'rfi' && s.hero === 'SB' ? '3bb로 오픈하면 BB는 2bb를 더 내고 콜해야 해서 BB의 필요 승률이 약 33%예요(2.5bb로 오픈하면 약 30%).' : null),
  },
  'sb-limp': {
    id: 'sb-limp',
    chip: 'SB의 림프',
    body:
      'SB의 림프는 약한 패라는 뜻이 아니에요. 책의 균형 전략은 림프 범위에도 AA·KK·QQ·AK를 일부 섞어, BB가 3.5bb로 레이즈하면 다시 올리거나 AA는 콜로 숨겨요. 그래서 BB는 SB의 림프를 아무 패로나 공격하지 못하고, 공짜로 볼 수 있는 패는 체크해요.',
    ref: '책 5장 「자리별 처음 레이즈」 SB·4장 「림프」(노트 5장 2절, 4장 7절)',
    numbers: (s) => {
      if (!((s.kind === 'rfi' && s.hero === 'SB') || (s.kind === 'vs_limp' && s.hero === 'BB'))) return null;
      const f = limpFacts();
      return `SB가 림프하면 팟은 ${josa(bb(f.potAfterLimp), '이/가')} 되고, BB가 ${josa(bb(f.raiseTo), '으로/로')} 레이즈하면 SB는 ${josa(bb(f.toCallRaise), '을/를')} 더 내고 콜해야 해서 필요 승률이 약 ${pct(f.need)}예요.`;
    },
  },
  'bb-price': {
    id: 'bb-price',
    chip: 'BB의 가격',
    body:
      'BB는 이미 1bb를 냈으니 콜에 더 낼 돈이 적고, 그만큼 필요 승률이 낮아요. 모든 패를 폴드하면 100핸드에 100bb를 잃으니, 이득이 되는 패는 최대한 많이 지켜요. 다만 포지션이 없어 에퀴티를 다 실현하지 못하니 필요 승률보다 넉넉한 패가 필요해요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 BB(노트 5장 5절)',
    numbers: (s) => {
      const p = priceOf(s);
      if (!p || s.kind !== 'vs_open') return null;
      return `${bb(p.toCall)}를 더 내고 콜하면 팟은 ${bb(p.potAfter)} → 필요 승률 약 ${pct(p.need)}예요.`;
    },
  },
  'bb-vs-opener': {
    id: 'bb-vs-opener',
    chip: '상대의 오픈 폭',
    body:
      'BB가 지키는 폭은 상대의 오픈 범위가 정해요. UTG처럼 강한 범위에는 좁게, BTN처럼 넓은 범위에는 훨씬 넓게 지키고, SB에게는 플랍 이후 BB가 늘 나중에 행동하니 가장 넓게 지켜요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 BB(노트 5장 5절)',
  },
  'sb-3bet-or-fold': {
    id: 'sb-3bet-or-fold',
    chip: '3벳 아니면 폴드',
    body:
      'SB가 콜하면 뒤의 BB가 스퀴즈할 수 있고, BB가 콜만 해도 SB는 두 명을 상대로 포지션 없이 쳐야 해요. 에퀴티를 거의 실현하지 못하고 레이크까지 붙으니, 콜 대신 3벳 아니면 폴드로 대응해요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 SB(노트 5장 5절)',
    numbers: (s) => {
      const p = priceOf(s);
      if (!p || s.kind !== 'vs_open' || s.hero !== 'SB') return null;
      return `콜 가격만 보면 ${bb(p.toCall)}를 더 내고 필요 승률은 약 ${pct(p.need)}지만, 뒤에 BB가 남아 있고 포지션도 없어 에퀴티를 다 실현하지 못하니 실제로는 이보다 높은 승률이 필요해요.`;
    },
  },
  'squeeze-risk': {
    id: 'squeeze-risk',
    chip: '스퀴즈 위험',
    body:
      '뒤에 아직 사람이 남은 자리에서 콜하면 스퀴즈(오픈과 콜 뒤의 3벳)를 맞기 쉬워요. 콜한 사람은 강한 패였다면 3벳했을 테니 중간 패로 읽히고, 팟에 돈도 많아 스퀴즈가 잘 통하기 때문이에요. 그래서 책은 HJ·CO도 앞자리 오픈에 콜 없이 3벳 아니면 폴드로 대응해요.',
    ref: '책 1장 액션 용어·5장 「오픈 레이즈 대응」(노트 1장 3절, 5장 4~5절)',
  },
  'btn-call': {
    id: 'btn-call',
    chip: 'BTN의 콜',
    body:
      'BTN은 플랍 이후 늘 마지막에 행동해 콜로도 에퀴티를 잘 실현해요. 그래서 콜 범위를 둘 수 있고, 콜 범위가 있으니 3벳에는 최강 패와 블러프만 남아요. 콜 범위에 약한 패만 두면 "BTN이 콜하면 약하다"고 읽히니 강한 패도 조금 섞어요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 BN(노트 5장 5절)',
  },
  'tighter-after-raise': {
    id: 'tighter-after-raise',
    chip: '먼저 들어온 사람',
    body:
      '누가 먼저 레이즈했다면 그 사람 패는 평균보다 강하고, 림프한 사람의 패도 아무 패나는 아니에요. 그래서 같은 자리라도 처음 들어갈 때보다 더 좁게 치고, 앞자리에서 오픈한 상대일수록 범위가 강하니 더 좁아져요.',
    ref: '책 4장 「프리플랍 일반 원칙」 원칙 1(노트 4장 10절)',
  },
  'polar-linear': {
    id: 'polar-linear',
    chip: '양극화와 선형',
    body:
      '콜 범위가 있으면 좋은 패는 콜로 돌리니, 3벳에는 "콜하기 아까운 최강 패"와 "콜하기엔 약하지만 블러프로 좋은 패"만 남아 양극화돼요. 콜 범위가 없으면 3벳 아니면 폴드라서, 강한 패부터 차례로 3벳하는 선형이 돼요.',
    ref: '책 5장 「오픈 레이즈 대응 일반 원칙」(노트 5장 4절)',
  },
  blockers: {
    id: 'blockers',
    chip: '블로커',
    body:
      '내가 쥔 카드는 상대가 가질 수 없어요. A를 한 장 쥐면 상대의 AA는 6조합에서 3조합으로, AK는 16조합에서 12조합으로 줄어, 내 3벳이나 4벳에 버틸 조합이 줄어요. 그래서 블러프는 A나 K처럼 상대의 강한 패를 막는 카드로 골라요.',
    ref: '책 1장 콤비네이션과 블로커·5장 「오픈 레이즈 대응 일반 원칙」(노트 1장 5절, 5장 4절)',
  },
  'bluff-equity': {
    id: 'bluff-equity',
    chip: '블러프의 에퀴티',
    body:
      '상대 범위가 강할수록 내 블러프는 콜이나 다시 올림을 받기 쉬워서, 콜을 받아도 버틸 에퀴티가 있는 패로 블러프해요. 작은 수티드 A는 A 블로커에 플러시 가능성까지 있어 대표적인 3벳·4벳 블러프예요.',
    ref: '책 5장 「오픈 레이즈 대응 일반 원칙」(노트 5장 4절)',
  },
  'vs3bet-position': {
    id: 'vs3bet-position',
    chip: '3벳엔 포지션부터',
    body:
      '오픈했다가 3벳을 받으면 먼저 포지션을 봐요. 포지션이 있으면(블라인드의 3벳) 콜해도 에퀴티를 잘 실현해 더 넓게 지키고, 포지션이 없으면 콜한 뒤 내내 불리하니 지키는 폭을 줄이고 4벳이나 폴드로 정리해요.',
    ref: '책 5장 「3-bet 상대하기: 일반 원칙」(노트 5장 3절)',
    numbers: (s) => {
      const p = priceOf(s);
      if (!p || s.kind !== 'vs_3bet') return null;
      return `${s.villain}의 ${bb(threebetSize(s.hero, s.villain!))} 3벳에 콜하려면 ${bb(p.toCall)}를 더 내고, 필요 승률은 약 ${pct(p.need)}예요.`;
    },
  },
  'threebet-shape': {
    id: 'threebet-shape',
    chip: '상대 3벳의 모양',
    body:
      '상대 3벳이 최강 패와 블러프로 양극화돼 있으면 중간 패가 지배당할 일이 적어 콜이 늘고, 강한 패 위주(선형)면 중간 패가 자주 지배당해 폴드가 늘어요. 3벳이 작으면 더 많이, 크면 덜 지켜도 돼요.',
    ref: '책 5장 「3-bet 상대하기: 일반 원칙」(노트 5장 3절)',
  },
  'offsuit-3bet-pot': {
    id: 'offsuit-3bet-pot',
    chip: '3벳 팟의 오프수트',
    body:
      '3벳 팟은 이미 큰돈이 들어가 남은 스택이 얕아요. 오프수트 브로드웨이는 더 높은 브로드웨이에 지배당하기 쉬워서, 페어를 맞혀도 두 번째로 좋은 패로 큰돈을 잃기 쉬워요. 그래서 3벳에는 수티드 브로드웨이·수티드 커넥터·포켓페어로 콜하고, 오프수트 브로드웨이와 약한 A는 보통 폴드해요.',
    ref: '책 5장 「3-bet 상대하기: 일반 원칙」(노트 5장 3절)',
  },
  'fourbet-polar': {
    id: 'fourbet-polar',
    chip: '4벳은 양 끝으로',
    body:
      '4벳을 하면 상대가 올인(5벳)으로 받아칠 수 있어요. 그래서 4벳에는 올인에도 콜할 최강 패와, 블로커가 좋아 올인을 받으면 폴드해도 아깝지 않은 패만 넣어요. 중간 패는 "4벳했다가 올인에 폴드하는" 상황을 피해 4벳하지 않고, 오픈했다가 3벳을 받았다면 콜로 플랍을 봐요.',
    ref: '책 5장 「자리별 처음 레이즈」 SB·BN(노트 5장 2절)',
  },
  'vs-4bet': {
    id: 'vs-4bet',
    chip: '4벳을 받으면',
    body:
      '4벳 팟은 이미 팟이 커서, 콜하면 남은 스택이 팟의 두 배도 안 돼요. 콜한 패도 플랍에서 대부분 올인까지 가니 그만큼 강해야 해요. 책은 포지션이 있으면 대부분 콜하고, AA도 절반쯤은 콜로 숨긴다고 해요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 HJ·BB(노트 5장 5절)',
    numbers: (s) => {
      const p = priceOf(s);
      if (!p || s.kind !== 'vs_4bet') return null;
      return `4벳 ${bb(fourbetSize(s.villain!, s.hero))}에 콜하려면 ${bb(p.toCall)}를 더 내고, 필요 승률은 약 ${pct(p.need)}예요.`;
    },
  },
  'vs-5bet': {
    id: 'vs-5bet',
    chip: '올인에 콜하는 값',
    body:
      '올인(5벳)에 콜하려면 남은 스택을 거의 다 걸어야 해서 필요 승률이 높아요. 상대 올인 범위를 상대로 그만큼의 에퀴티가 있어야 콜해요. 책은 일반적으로 TT 이상과 AK가 콜하고(BN은 66 이상), 블러프로 4벳한 패는 폴드한다고 해요.',
    ref: '책 5장 「3-bet 상대하기: 일반 원칙」(노트 5장 3절)',
    numbers: (s) => {
      const p = priceOf(s);
      if (!p || s.kind !== 'vs_5bet') return null;
      return `${bb(p.toCall)}를 더 내고 팟 ${bb(p.potAfter)}를 다투니, 필요 승률은 약 ${pct(p.need)}예요.`;
    },
  },
  'fivebet-bluff': {
    id: 'fivebet-bluff',
    chip: '5벳 블러프',
    body:
      'A5s 같은 패로 하는 5벳 블러프는 CO·BTN 같은 뒷자리의 4벳을 상대할 때부터 나와요. 앞자리의 4벳 범위는 너무 강해서 블러프가 통하지 않아요.',
    ref: '책 5장 「오픈 레이즈 대응 범위」 SB(노트 5장 5절)',
  },
  'cold-4bet': {
    id: 'cold-4bet',
    chip: '콜드 4벳',
    body:
      '오픈과 3벳 사이에 끼어 있으면 4벳 아니면 폴드가 기본이에요. 콜하면 내 패 정보가 새고, 4벳이었다면 폴드했을 다른 사람들(오픈한 사람 포함)이 싸게 플랍을 볼 수 있어요. 책은 콜드 4벳을 상대가 타이트하면 약 3%, 넓으면 약 6%로 둬요.',
    ref: '책 5장 「3-bet 상대하기: 일반 원칙」(노트 5장 3절)',
  },
  realization: {
    id: 'realization',
    chip: '에퀴티 실현',
    body:
      '올인이 아니면 남은 베팅 때문에 에퀴티를 다 가져오지 못해요. 포지션이 있거나, 수티드이거나, 연결된 패는 실현을 잘하고, 포지션 없는 오프수트 하이카드는 잘 못해요. 그래서 에퀴티가 비슷해 보여도 A9o는 폴드하고 K2s는 콜하는 일이 생겨요.',
    ref: '책 1장 에퀴티 실현·5장 BB 방어(노트 1장 10절, 5장 5절)',
    numbers: () => '수티드 패는 같은 오프수트 패보다 에퀴티를 평균 16% 더 실현해요(책 1장).',
  },
  domination: {
    id: 'domination',
    chip: '지배',
    body:
      '같은 카드를 쥔 더 좋은 킥커에게 지는 상태를 지배당한다고 해요. 상대 범위가 강할수록(앞자리 오픈, 강한 3벳) 오프수트 하이카드는 지배당하기 쉬워서, 맞혀도 큰돈을 잃는 쪽이 돼요.',
    ref: '책 4장 절대적인 핸드 강도·5장 3-bet 상대하기(노트 4장 6절, 5장 3절)',
  },
  'board-coverage': {
    id: 'board-coverage',
    chip: '보드 커버리지',
    body:
      '어떤 플랍이 떠도 내 범위에 강한 패가 있어야 해요. 높은 카드로만 오픈하면 낮은 플랍에서 약하다고 읽혀 압박받으니, 앞자리에서도 작은 포켓페어와 수티드 커넥터를 섞어요.',
    ref: '책 5장 「자리별 처음 레이즈」 LJ(노트 5장 2절, 5절)',
    numbers: () => '포켓페어가 플랍에서 셋이 될 확률은 약 12%(8.5번에 1번)예요.',
  },
  mixing: {
    id: 'mixing',
    chip: '섞는 패',
    body:
      '차트에 "절반만"이나 "반반"으로 나오는 패는 두 선택의 가치가 거의 같은 경계선 패예요. 그래서 어느 쪽을 골라도 손해가 작고, 상대가 약점을 보이면 이런 패부터 넓히거나 좁혀요. 섞을 때는 마음대로 번갈아 고르지 말고 무작위로 정해요.',
    ref: '책 2장 무차별 원리·4장 「프리플랍 일반 원칙」(노트 2장 4절, 4장 10절)',
  },
  'vs-limper': {
    id: 'vs-limper',
    chip: '림퍼 상대',
    body:
      '지금 캐시게임에서 SB 말고 림프하는 사람은 약한 경우가 많아서, 레이즈로 아이솔레이트해 혼자 상대해요. 림퍼의 유형을 알면 폭을 바꿔요. 수동적이면 아주 넓게(뒤에 공격적인 사람이 있으면 평소 오픈 범위 정도로), 공격적이면 강한 패 위주로 좁혀요.',
    ref: '책 4장 「림프」(노트 4장 7절)',
  },
  'free-check': {
    id: 'free-check',
    chip: '공짜 플랍',
    body:
      'SB가 림프하면 BB는 체크만 해도 돈을 더 내지 않고 플랍을 봐요. 체크가 공짜일 때 폴드는 어떤 경우에도 체크보다 못한 \'엄격하게 지배되는 전략\'이라, 아무리 약한 패도 폴드하지 않고 체크해요.',
    ref: '책 10장 폴드·체크·콜·레이즈(노트 10장 4절)',
  },
  'blind-vs-blind': {
    id: 'blind-vs-blind',
    chip: '블라인드끼리',
    body:
      'SB가 레이즈하고 BB가 콜하면 플랍 이후 내내 BB가 나중에 행동해요. 그래서 BB는 SB에게 가장 넓게 지키고, SB는 BB의 3벳을 받으면 포지션이 없어 콜보다 4벳이나 폴드로 기울어요.',
    ref: '책 5장 「권장 베팅 크기」·BB 방어(노트 5장 1절, 5절)',
  },
  'mdf-alpha': {
    id: 'mdf-alpha',
    chip: '알파와 MDF',
    body:
      '블러프가 본전이 되려면 상대가 폴드해야 하는 비율이 알파(베팅 ÷ (베팅 + 팟))이고, 그 블러프가 이득을 못 보게 버텨야 하는 비율이 MDF(1 − 알파)예요. 3벳에 너무 많이 폴드하면 상대는 아무 패로나 3벳해서 이득을 봐요. MDF는 기준선이지 꼭 지켜야 하는 규칙은 아니에요.',
    ref: '책 2장 알파와 MDF·5장 「3-bet 상대하기」(노트 2장 6절, 5장 3절)',
    numbers: (s) => {
      if (s.kind !== 'vs_3bet') return null;
      const t = threebetSize(s.hero, s.villain!);
      const vIn = s.villain === 'SB' ? 0.5 : s.villain === 'BB' ? 1 : 0;
      const risk = t - vIn;
      // 3벳 전의 팟: 오픈 + 블라인드(오픈한 사람이 SB면 그 0.5bb는 오픈 3bb 안에 들어 있어요)
      const pot = s.hero === 'SB' ? 3 + 1 : 2.5 + 1.5;
      const alpha = risk / (risk + pot);
      return `${s.villain}의 3벳이 블러프라면 ${pct(alpha)}보다 많이 폴드해야 본전이라, 오픈한 패의 ${pct(1 - alpha)} 이상은 지키는 게 기준이에요.`;
    },
  },
};

export const principle = (id: PrincipleId) => PRINCIPLES[id];
