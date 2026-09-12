import { getChartCells, hasChart } from './data';
import { parseHandName, type HandInfo } from './hands';
import { foldWeight, rangeShare } from './range';
import { heroInPosition } from './scenarios';
import type { Step } from './trainer';
import { ACTION_LABEL_KO, type Action, type Pos, type Scenario, type ScenarioKind } from './types';

/* ------------------------------------------------------------------ */
/* Hand classes                                                        */
/* ------------------------------------------------------------------ */

export type HandClass =
  | 'premium_pair'
  | 'big_pair'
  | 'mid_pair'
  | 'small_pair'
  | 'ak'
  | 'big_ace'
  | 'suited_ace'
  | 'wheel_ace'
  | 'offsuit_ace'
  | 'suited_broadway'
  | 'offsuit_broadway'
  | 'suited_king'
  | 'suited_qj'
  | 'suited_connector'
  | 'suited_gapper'
  | 'offsuit_connector'
  | 'junk';

export const HAND_CLASS_KO: Record<HandClass, string> = {
  premium_pair: '프리미엄 포켓페어',
  big_pair: '빅 포켓페어',
  mid_pair: '미들 포켓페어',
  small_pair: '스몰 포켓페어',
  ak: '에이스킹',
  big_ace: '빅 에이스 브로드웨이',
  suited_ace: '수티드 에이스 (미들 킥커)',
  wheel_ace: '수티드 휠 에이스',
  offsuit_ace: '오프수트 에이스',
  suited_broadway: '수티드 브로드웨이',
  offsuit_broadway: '오프수트 브로드웨이',
  suited_king: '수티드 킹',
  suited_qj: '수티드 퀸/잭',
  suited_connector: '수티드 커넥터',
  suited_gapper: '수티드 갭퍼',
  offsuit_connector: '오프수트 커넥터',
  junk: '약한 핸드',
};

export function classifyHand(name: string): HandClass {
  const h = parseHandName(name);
  const { kind, highV, lowV, gap } = h;
  if (kind === 'pair') {
    if (highV >= 13) return 'premium_pair';
    if (highV >= 11) return 'big_pair';
    if (highV >= 8) return 'mid_pair';
    return 'small_pair';
  }
  if (highV === 14 && lowV === 13) return 'ak';
  if (highV === 14 && lowV >= 11) return 'big_ace';
  if (highV === 14 && kind === 'suited') return lowV <= 5 ? 'wheel_ace' : 'suited_ace';
  if (highV === 14) return 'offsuit_ace';
  if (highV >= 10 && lowV >= 10) return kind === 'suited' ? 'suited_broadway' : 'offsuit_broadway';
  if (kind === 'suited' && highV === 13) return 'suited_king';
  if (kind === 'suited' && (highV === 12 || highV === 11) && gap >= 2) return 'suited_qj';
  if (kind === 'suited' && gap === 0) return 'suited_connector';
  if (kind === 'suited' && gap <= 2) return 'suited_gapper';
  if (kind === 'offsuit' && gap === 0 && highV >= 8) return 'offsuit_connector';
  return 'junk';
}

/* ------------------------------------------------------------------ */
/* Output types                                                        */
/* ------------------------------------------------------------------ */

export interface PostflopPlan {
  potType: string;
  role: string;
  position: string;
  spr: string;
  checklist: string[];
  goodBoards: string;
  badBoards: string;
  plan: string[];
}

export interface Explanation {
  headline: string;
  situation: string;
  handProfile: string;
  reasoning: string[];
  rangeContext: string;
  mixNote?: string;
  chartNote?: string;
  postflop?: PostflopPlan;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const pct = (x: number) => `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;

function villainRangeShare(s: Scenario): number | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_open': {
      if (!v) return null;
      const sc: Scenario = { kind: 'rfi', hero: v };
      return hasChart(sc) ? rangeShare(getChartCells(sc), 'raise') : null;
    }
    case 'vs_3bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_open', hero: v, villain: s.hero };
      return hasChart(sc) ? rangeShare(getChartCells(sc), 'threebet') : null;
    }
    case 'vs_4bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_3bet', hero: v, villain: s.hero };
      return hasChart(sc) ? rangeShare(getChartCells(sc), 'fourbet') : null;
    }
    case 'vs_5bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_4bet', hero: v, villain: s.hero };
      return hasChart(sc) ? rangeShare(getChartCells(sc), 'allin') : null;
    }
    default:
      return null;
  }
}

function heroActionShare(step: Step, action: Action): number {
  return rangeShare(step.cells, action);
}

function potOddsText(kind: ScenarioKind, hero: Pos, villain?: Pos): string {
  switch (kind) {
    case 'vs_open':
      if (hero === 'BB') return 'BB는 이미 1bb를 넣었으므로 1.5bb를 더 내고 약 5.5bb 팟을 봅니다(필요 승률 약 27%). 가장 싸게 플랍을 보는 자리입니다.';
      if (hero === 'SB') return 'SB는 2bb를 더 내고 약 6bb 팟을 보지만 플랍 이후 항상 아웃오브포지션입니다. 콜보다 3벳-or-폴드가 선호됩니다.';
      return '2.5bb를 내고 약 6.5bb 팟(필요 승률 약 38%)을 봅니다. 뒤에 남은 플레이어의 스퀴즈 위험도 감안해야 합니다.';
    case 'vs_3bet':
      return villain === 'SB' || villain === 'BB'
        ? '블라인드의 3벳(약 10~11bb)에 8bb 정도를 더 내고 약 24bb 팟을 봅니다(필요 승률 약 30%). 포지션이 있어 넓게 방어할 수 있습니다.'
        : '인포지션 3벳(약 7.5bb)에 5bb를 더 내고 약 17bb 팟을 봅니다(필요 승률 약 30%). 하지만 플랍 이후 아웃오브포지션이라 실현 가능한 에퀴티가 줄어듭니다.';
    case 'vs_4bet':
      return '4벳(약 22~25bb)에 대해 콜하면 SPR이 1.5 전후인 4벳 팟이 됩니다. 필요 승률은 약 27%지만, 남은 스택이 적어 플랍에서 사실상 커밋됩니다.';
    case 'vs_5bet':
      return '올인 콜의 필요 승률은 약 40~45%입니다. 상대의 5벳 레인지(KK+ 위주)에 대해 이 승률이 나오는 핸드만 콜합니다.';
    case 'cold_4bet':
      return '앞에 오픈과 3벳이 모두 있어 두 레인지를 동시에 상대합니다. 콜은 스퀴즈/4벳 위험이 커서 거의 없고, 4벳 또는 폴드로 양분됩니다.';
    default:
      return '';
  }
}

function seatText(p: Pos): string {
  return p;
}

/* ------------------------------------------------------------------ */
/* Hand profile                                                        */
/* ------------------------------------------------------------------ */

function handProfile(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  switch (cls) {
    case 'premium_pair':
      return `${n}은(는) 프리플랍 최강 핸드입니다. 어떤 레인지를 상대로도 승률 80% 이상이며, 목표는 팟을 최대한 키우는 것입니다.`;
    case 'big_pair':
      return `${n}은(는) 빅 포켓페어로 대부분의 레인지에 크게 앞서지만, AA·KK에는 크게 뒤집니다. 플랍에 오버카드(A/K)가 떨어지면 가치가 급감합니다.`;
    case 'mid_pair':
      return `${n}은(는) 미들 포켓페어입니다. 오버페어가 되는 보드가 많지 않아 셋을 노리는 가치와 쇼다운 가치를 함께 가집니다. 큰 팟에서는 대개 블러프캐처가 됩니다.`;
    case 'small_pair':
      return `${n}은(는) 스몰 포켓페어입니다. 플랍에서 셋(약 12%)을 맞추는 임플라이드 오즈가 핵심이고, 셋이 아니면 거의 항상 언더페어입니다.`;
    case 'ak':
      return `${n}은(는) 가장 강한 언페어드 핸드입니다. 모든 언페어드 핸드를 도미네이트하고 KK·QQ 상대로도 45% 전후 승률입니다. 프리플랍에서 팟을 키우기 좋고 A/K 하이 보드에서 탑페어 탑키커를 만듭니다.`;
    case 'big_ace':
      return `${n}은(는) 빅 에이스 브로드웨이입니다. 약한 에이스를 도미네이트하지만 AK·AQ에는 도미네이트당하므로 상대 레인지가 타이트할수록 가치가 떨어집니다.${info.kind === 'suited' ? ' 수티드라 넛 플러시 가능성이 더해집니다.' : ''}`;
    case 'suited_ace':
      return `${n}은(는) 수티드 에이스입니다. 넛 플러시 드로우와 에이스 블로커(상대 AA/AK 조합 감소)를 가지며, 탑페어를 맞춰도 킥커가 약해 큰 팟보다 작은 팟에 적합합니다.`;
    case 'wheel_ace':
      return `${n}은(는) 수티드 휠 에이스입니다. 넛 플러시·휠 스트레이트 가능성과 에이스 블로커 때문에 솔버가 가장 선호하는 3벳/4벳 블러프 재료입니다. 탑페어 가치는 낮습니다.`;
    case 'offsuit_ace':
      return `${n}은(는) 오프수트 에이스입니다. 플러시 가능성이 없고 킥커가 약해 도미네이션 위험이 큽니다. 늦은 포지션의 넓은 레인지 상대로만 가치가 있습니다.`;
    case 'suited_broadway':
      return `${n}은(는) 수티드 브로드웨이입니다. 탑페어·스트레이트·플러시를 고르게 만들며 플레이어빌리티가 좋아 콜 레인지의 핵심입니다.`;
    case 'offsuit_broadway':
      return `${n}은(는) 오프수트 브로드웨이입니다. 탑페어를 자주 만들지만 도미네이트당하기 쉽고 플러시가 없어, 타이트한 레인지 상대로는 콜보다 폴드/3벳 양극화가 선호됩니다.`;
    case 'suited_king':
      return `${n}은(는) 수티드 킹입니다. 킹 하이 플러시와 킹 블로커를 가지지만 킥커가 약해 탑페어로 큰 팟을 만들기는 어렵습니다.`;
    case 'suited_qj':
      return `${n}은(는) 약한 수티드 퀸/잭입니다. 플러시·백도어 가능성으로 늦은 포지션에서 오픈하거나 넓은 레인지를 방어할 때만 사용합니다.`;
    case 'suited_connector':
      return `${n}은(는) 수티드 커넥터입니다. 스트레이트·플러시 등 넛 가능성이 있어 임플라이드 오즈가 좋고, 낮은 보드에서 콜러 레인지의 우위를 만들어 줍니다.`;
    case 'suited_gapper':
      return `${n}은(는) 수티드 갭퍼입니다. 커넥터보다 스트레이트 가능성이 적지만 플러시·백도어로 플레이어빌리티가 있어 포지션이 있을 때 가치가 있습니다.`;
    case 'offsuit_connector':
      return `${n}은(는) 오프수트 커넥터입니다. 스트레이트 가능성은 있지만 플러시가 없고 페어를 맞춰도 약해, 아주 넓은 레인지 상황에서만 플레이합니다.`;
    case 'junk':
      return `${n}은(는) 프리플랍 가치가 낮은 핸드입니다. 하이카드·플러시·스트레이트 가능성이 모두 부족해 대부분의 상황에서 폴드입니다.`;
  }
}

/* ------------------------------------------------------------------ */
/* Reasoning per scenario / action                                     */
/* ------------------------------------------------------------------ */

const AGGRESSIVE: Record<HandClass, string> = {
  premium_pair: '최강 핸드로 밸류를 극대화합니다. 상대가 콜·리레이즈로 팟을 키워 줄수록 이득입니다.',
  big_pair: '레인지 대부분에 앞서므로 밸류로 공격합니다. 다만 상대가 더 강한 리레이즈를 하면 AA/KK를 의식해 감속할 준비를 합니다.',
  mid_pair: '상대의 넓은 레인지에 앞서면서 폴드 에퀴티도 얻습니다. 리레이즈를 당하면 대부분 폴드 또는 콜로 셋을 노립니다.',
  small_pair: '폴드 에퀴티와 셋 가치를 함께 노립니다. 리레이즈를 당하면 폴드가 기본입니다.',
  ak: '밸류와 폴드 에퀴티를 모두 가지는 최고의 공격 핸드입니다. 리레이즈를 당해도 에퀴티가 충분합니다.',
  big_ace: '상대의 약한 에이스·브로드웨이를 도미네이트하며 밸류를 얻습니다. AK·빅페어의 리레이즈에는 물러납니다.',
  suited_ace: '에이스 블로커로 상대의 최강 조합을 줄이고, 폴드 에퀴티를 얻는 세미 블러프성 공격입니다. 콜을 받아도 넛 플러시 가능성이 있습니다.',
  wheel_ace: '에이스 블로커와 넛 가능성을 가진 전형적인 블러프 레이즈입니다. 콜하면 도미네이트당하기 쉬워 폴드보다 공격이 낫습니다.',
  offsuit_ace: '에이스 블로커를 이용한 폴드 에퀴티 위주의 공격입니다. 리레이즈를 당하면 즉시 폴드합니다.',
  suited_broadway: '밸류와 플레이어빌리티를 함께 갖춰 공격에 적합합니다. 콜을 받아도 플랍 이후 플레이하기 좋습니다.',
  offsuit_broadway: '콜하면 도미네이션 위험이 크므로 폴드 에퀴티를 얻는 공격이 더 낫습니다(양극화). 리레이즈에는 폴드합니다.',
  suited_king: '킹 블로커와 플러시 가능성을 가진 세미 블러프 공격입니다.',
  suited_qj: '블로커와 플러시 가능성을 이용한 낮은 빈도의 블러프입니다.',
  suited_connector: '넓은 레인지 상대로 폴드 에퀴티를 얻고, 콜을 받아도 넛 가능성으로 균형 잡힌 레인지를 만듭니다.',
  suited_gapper: '폴드 에퀴티 위주의 블러프이며 콜을 받으면 플러시·스트레이트 가능성으로 플레이합니다.',
  offsuit_connector: '넓은 레인지 상황에서 폴드 에퀴티를 노리는 공격입니다.',
  junk: '넓은 레인지 상황에서만 폴드 에퀴티를 노립니다.',
};

const CALL: Record<HandClass, string> = {
  premium_pair: '리레이즈 대신 콜로 상대의 블러프를 살려 두는(트랩) 전략입니다. 상대 레인지가 양극화되어 있을 때 유효합니다.',
  big_pair: '리레이즈하면 AA/KK만 남고 약한 핸드를 폴드시키므로, 콜로 팟을 통제하며 상대의 약한 부분을 유지시킵니다.',
  mid_pair: '오버카드가 자주 떨어지므로 팟을 키우기보다 콜로 셋 가치와 쇼다운 가치를 함께 가져갑니다.',
  small_pair: '셋마이닝입니다. 상대의 스택이 깊고(임플라이드 오즈) 뒤에서 스퀴즈 위험이 낮을 때 콜합니다.',
  ak: '상대 레인지가 매우 강해 리레이즈하면 더 강한 핸드만 남을 때, 콜로 에퀴티를 실현합니다.',
  big_ace: '리레이즈하면 도미네이트하는 핸드가 폴드하고 도미네이트당하는 핸드만 남으므로 콜이 더 좋습니다.',
  suited_ace: '넛 플러시 가능성과 에이스 하이 쇼다운 가치로 콜해 플랍을 봅니다. 3벳은 약한 킥커 때문에 밸류가 부족합니다.',
  wheel_ace: '넛 플러시·휠 스트레이트 가능성으로 임플라이드 오즈가 충분해 콜합니다.',
  offsuit_ace: '넓은 레인지 상대로만 콜합니다. 에이스가 떨어지면 킥커 문제로 큰 팟을 피합니다.',
  suited_broadway: '플레이어빌리티가 좋고 상대의 브로드웨이에 도미네이트당할 위험이 적어 콜 레인지의 핵심입니다.',
  offsuit_broadway: '탑페어를 자주 만들어 콜하지만, 리버스 임플라이드 오즈 때문에 큰 팟은 피합니다.',
  suited_king: '킹 하이 플러시와 백도어 가능성으로 싼 가격에 플랍을 봅니다.',
  suited_qj: '플러시·백도어 가능성으로 넓은 레인지 상대에서만 콜합니다.',
  suited_connector: '넛 스트레이트·플러시로 상대의 강한 핸드에서 큰 팟을 이길 수 있는 임플라이드 오즈 콜입니다.',
  suited_gapper: '넛 가능성과 백도어를 가진 임플라이드 오즈 콜입니다.',
  offsuit_connector: '싼 가격에 스트레이트 가능성을 노리는 콜입니다.',
  junk: '가격이 매우 쌀 때만 콜합니다.',
};

const FOLD: Record<HandClass, string> = {
  premium_pair: '',
  big_pair: '상대의 레인지가 AA·KK 위주로 극도로 좁아 승률이 부족합니다.',
  mid_pair: '상대 레인지에는 오버페어가 많고, 셋을 맞춰도 충분한 임플라이드 오즈를 얻기 어렵습니다.',
  small_pair: '셋을 맞출 확률(약 12%) 대비 받을 수 있는 금액이 부족하고, 셋이 아니면 이길 수 없습니다.',
  ak: '상대의 레인지가 KK+ 위주라 AK조차 승률이 부족합니다.',
  big_ace: 'AK·AQ·빅페어에 도미네이트당하는 리버스 임플라이드 오즈가 커서 콜의 기대값이 음수입니다.',
  suited_ace: '이 자리에서는 약한 킥커 때문에 밸류가 부족하고 콜의 임플라이드 오즈도 충분하지 않습니다.',
  wheel_ace: '블러프 레이즈 빈도가 이미 충분하고, 콜하기에는 탑페어 가치가 너무 낮습니다.',
  offsuit_ace: '플러시가 없고 킥커가 약해 도미네이션 위험이 큽니다. 이 자리에서는 폴드입니다.',
  suited_broadway: '상대 레인지가 타이트해 브로드웨이 핸드가 도미네이트당하기 쉽습니다.',
  offsuit_broadway: '탑페어를 맞춰도 킥커에서 지는 경우가 많고 플러시가 없어 이 자리에서는 폴드입니다.',
  suited_king: '킥커가 약해 탑페어 가치가 낮고, 이 자리의 레인지에는 들어가지 않습니다.',
  suited_qj: '하이카드 가치가 부족하고 플러시만으로는 이 자리의 가격을 감당하지 못합니다.',
  suited_connector: '이 자리에서는 스트레이트·플러시 가능성만으로는 상대 레인지의 강함을 이기지 못합니다.',
  suited_gapper: '갭이 있어 스트레이트 가능성이 낮고 하이카드 가치도 부족합니다.',
  offsuit_connector: '플러시가 없고 하이카드 가치가 낮아 폴드입니다.',
  junk: '하이카드·플러시·스트레이트 가능성이 모두 부족한 핸드는 위치와 무관하게 폴드합니다.',
};

function reasoning(step: Step, cls: HandClass): string[] {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const out: string[] = [];
  const share = villainRangeShare(s);

  // Scenario-level principle
  switch (s.kind) {
    case 'rfi':
      out.push(
        hero === 'SB'
          ? 'SB는 BB 한 명만 남아 넓게(약 46%) 오픈하지만, 플랍 이후 항상 아웃오브포지션이므로 3bb로 크게 오픈해 BB의 콜을 억제합니다.'
          : hero === 'BTN'
            ? 'BTN은 항상 포지션을 가지고 블라인드 두 명만 상대하므로 가장 넓게(약 45%) 오픈합니다.'
            : `${hero}는 뒤에 ${5 - ['UTG', 'HJ', 'CO', 'BTN', 'SB'].indexOf(hero)}명이 남아 있어 그만큼 오픈 레인지를 좁힙니다. 뒤에 남은 사람이 많을수록 3벳을 당하거나 포지션을 잃을 확률이 큽니다.`,
      );
      break;
    case 'vs_open':
      out.push(
        `${v}의 오픈 레인지는 약 ${share == null ? '?' : pct(share)}입니다. ${['UTG', 'HJ'].includes(v!) ? '이른 포지션의 타이트한 레인지라 브로드웨이·미들 에이스는 도미네이트당하기 쉬워 방어 레인지를 좁힙니다.' : '늦은 포지션의 넓은 레인지이므로 더 넓게 방어하고 3벳 빈도도 높입니다.'}`,
      );
      if (hero === 'BB') out.push('BB는 이미 1bb를 낸 데다 클로징 액션(뒤에 아무도 없음)이라 가장 넓게 콜합니다. 3벳은 밸류와 블러프(수티드 휠 에이스, 수티드 커넥터)로 양극화합니다.');
      else if (hero === 'SB') out.push('SB는 콜하면 BB의 스퀴즈와 아웃오브포지션 문제가 겹치므로 3벳-or-폴드 위주로 대응합니다.');
      else out.push(`${hero}는 포지션이 있지만 뒤에 ${positionsLeft(hero)}명이 남아 있어 콜 레인지는 스퀴즈에 견딜 수 있는 핸드로 제한됩니다.`);
      out.push(potOddsText('vs_open', hero, v));
      break;
    case 'vs_3bet':
      out.push(
        `${v}의 3벳 레인지는 약 ${share == null ? '?' : pct(share)}로 ${['SB', 'BB'].includes(v!) ? '블라인드의 양극화된(밸류 + 블러프) 레인지' : '인포지션의 리니어한(강한 핸드 위주) 레인지'}입니다. ${heroInPosition(hero, v!) ? '내가 포지션을 가지므로 콜로 에퀴티를 실현하기 쉽습니다.' : '내가 아웃오브포지션이라 콜 레인지를 좁히고 4벳/폴드 비중을 높입니다.'}`,
      );
      out.push(potOddsText('vs_3bet', hero, v));
      break;
    case 'vs_4bet':
      out.push(`${v}의 4벳 레인지는 약 ${share == null ? '?' : pct(share)}로 QQ+/AK 밸류와 A5s류 블러프로 구성됩니다. 내 3벳 레인지에서 KK+는 올인, QQ/AK/AQs 정도만 콜하고 나머지는 폴드합니다.`);
      out.push(potOddsText('vs_4bet', hero, v));
      break;
    case 'vs_5bet':
      out.push(`${v}의 5벳 올인 레인지는 약 ${share == null ? '?' : pct(share)}로 사실상 KK+와 소수의 AK/QQ입니다. 내 4벳 블러프(A5s 등)는 당연히 폴드하고, 밸류 4벳 중에서도 KK+ 정도만 콜합니다.`);
      out.push(potOddsText('vs_5bet', hero, v));
      break;
    case 'cold_4bet':
      out.push(potOddsText('cold_4bet', hero));
      out.push('콜드 4벳 레인지는 KK+ 밸류와 A5s 같은 소수의 블러프로 극도로 좁습니다. 콜은 QQ/AK 같은 핸드로만 가끔 하며, 나머지는 모두 폴드입니다.');
      break;
  }

  // Hand-level rationale goes first: it is the one-line reason shown under the revealed answer.
  const isAggressive = answer === 'raise' || answer === 'threebet' || answer === 'fourbet' || answer === 'allin';
  if (isAggressive) out.unshift(AGGRESSIVE[cls]);
  else if (answer === 'call') out.unshift(CALL[cls]);
  else out.unshift(FOLD[cls] || '이 자리에서는 폴드가 기대값이 가장 높습니다.');

  // Position-specific extra
  if (answer === 'call' && (hero === 'SB' || (s.kind === 'vs_3bet' && !heroInPosition(hero, v!)))) {
    out.push('아웃오브포지션 콜이므로 플랍 이후 체크-콜/체크-레이즈 계획이 필요합니다. 에퀴티 실현이 어려운 만큼 강한 핸드 위주로만 콜합니다.');
  }
  return out;
}

function positionsLeft(hero: Pos): number {
  return { UTG: 5, HJ: 4, CO: 3, BTN: 2, SB: 1, BB: 0 }[hero];
}

/* ------------------------------------------------------------------ */
/* Range context                                                       */
/* ------------------------------------------------------------------ */

function rangeContext(step: Step): string {
  const { answer, scenario: s } = step;
  if (answer === 'fold') {
    const total = rangeShare(step.cells);
    return `이 상황에서 ${s.hero}가 계속 플레이하는 레인지는 전체의 약 ${pct(total)}이고, 이 핸드는 그 밖에 있습니다.`;
  }
  const share = heroActionShare(step, answer);
  const total = rangeShare(step.cells);
  return `${ACTION_LABEL_KO[answer]} 레인지는 전체 핸드의 약 ${pct(share)} (계속 플레이 합계 약 ${pct(total)})이며, 이 핸드는 그 안에 있습니다.`;
}

function mixNote(step: Step): string | undefined {
  const list = step.mixList;
  if (list.length <= 1) return undefined;
  const parts = list.map((m) => `${ACTION_LABEL_KO[m.action]} ${Math.round(m.weight * 100)}%`).join(' / ');
  const fold = foldWeight(step.mix);
  const tip = fold > 0 && fold < 1 ? '경계 핸드입니다. 상대가 타이트하면 폴드 쪽, 루즈하면 플레이 쪽으로 기울이세요.' : '혼합 전략 핸드입니다. 암기용 답은 가장 높은 빈도의 액션입니다.';
  return `솔버 빈도: ${parts}. ${tip}`;
}

/* ------------------------------------------------------------------ */
/* Postflop plan                                                       */
/* ------------------------------------------------------------------ */

type PotType = 'srp' | '3bp' | '4bp';

function potTypeAfter(step: Step): { pot: PotType; aggressor: boolean } | null {
  const { scenario: s, answer } = step;
  switch (s.kind) {
    case 'rfi':
      return answer === 'raise' ? { pot: 'srp', aggressor: true } : null;
    case 'vs_open':
      return answer === 'call' ? { pot: 'srp', aggressor: false } : answer === 'threebet' ? { pot: '3bp', aggressor: true } : null;
    case 'vs_3bet':
      return answer === 'call' ? { pot: '3bp', aggressor: false } : answer === 'fourbet' ? { pot: '4bp', aggressor: true } : null;
    case 'vs_4bet':
      return answer === 'call' ? { pot: '4bp', aggressor: false } : null; // allin: no postflop decision
    case 'vs_5bet':
      return null;
    case 'cold_4bet':
      return answer === 'call' ? { pot: '3bp', aggressor: false } : answer === 'fourbet' ? { pot: '4bp', aggressor: true } : null;
  }
}

const POT_LABEL: Record<PotType, string> = { srp: '싱글 레이즈 팟 (SRP)', '3bp': '3벳 팟', '4bp': '4벳 팟' };
const SPR_TEXT: Record<PotType, string> = {
  srp: 'SPR 약 10~18 (깊음): 원페어로 스택을 다 넣지 않습니다. 셋·투페어·강한 드로우가 스택 플레이 핸드입니다.',
  '3bp': 'SPR 약 3~5 (중간): 오버페어·탑페어 탑키커는 대체로 커밋 가능하고, 약한 탑페어는 두 스트리트 정도가 상한입니다.',
  '4bp': 'SPR 약 1~1.5 (얕음): 오버페어·탑페어·강한 드로우면 올인이 기본입니다. 플랍에서 사실상 마지막 결정을 내립니다.',
};

function postflopPlan(step: Step, cls: HandClass): PostflopPlan | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const { scenario: s } = step;
  const hero = s.hero;
  // Position: vs whom? rfi → assume BB (or a later caller) → hero IP unless SB.
  const villain: Pos = s.kind === 'rfi' ? (hero === 'SB' ? 'BB' : 'BB') : s.villain ?? 'BB';
  const ip = s.kind === 'rfi' ? hero !== 'SB' : heroInPosition(hero, villain);
  const info = parseHandName(step.hand);

  const checklist: string[] = [
    `레인지 우위: 이 보드가 ${pt.aggressor ? '프리플랍 어그레서(나)' : '프리플랍 어그레서(상대)'}의 레인지에 유리한가? A/K 하이·브로드웨이 보드는 레이저 레인지, 낮은 커넥티드 보드(예: 8♠7♦6♠)는 콜러 레인지에 유리합니다.`,
    '넛 우위: 셋·투페어·스트레이트 같은 최강 핸드를 누가 더 많이 가지는가? 넛 우위가 있는 쪽이 큰 사이즈로 공격할 수 있습니다.',
    `내 핸드의 상태: 메이드 핸드(오버페어/탑페어/셋)인지, 드로우(플러시·스트레이트·백도어)인지, 에어(오버카드·블로커만)인지 분류하세요.`,
    SPR_TEXT[pt.pot],
    '보드 텍스처: 드라이(레인보우·연결 없음)면 작은 사이즈(팟의 25~33%)로 자주 벳, 웻(플러시·스트레이트 드로우 많음)이면 큰 사이즈(팟의 60~75%)로 좁게 벳합니다.',
    `포지션: 나는 ${ip ? '인포지션' : '아웃오브포지션'}입니다. ${ip ? '상대의 체크를 받으면 벳/체크백을 선택할 수 있어 에퀴티 실현이 쉽습니다.' : '체크 비중을 높이고 체크-콜/체크-레이즈 레인지를 준비합니다.'}`,
    '상대의 성향: 도넉벳·체크레이즈·콜 빈도가 GTO보다 높거나 낮은가? 익스플로잇 포인트를 찾습니다.',
  ];

  let good = '';
  let bad = '';
  const plan: string[] = [];
  const suitedNote = info.kind === 'suited' ? ' 같은 무늬가 두 장 깔리면 플러시 드로우, 한 장이면 백도어 플러시로 계속 갈 근거가 됩니다.' : '';

  switch (cls) {
    case 'premium_pair':
    case 'big_pair':
      good = `내 페어보다 낮은 카드만 있는 보드(오버페어). ${cls === 'big_pair' ? 'A/K가 없는' : '거의 모든'} 보드에서 밸류 벳.`;
      bad = cls === 'big_pair' ? 'A 또는 K가 떨어진 보드(QQ/JJ는 언더페어가 됨), 4연결·모노톤 보드.' : '4연결 스트레이트·모노톤 보드, 상대가 체크레이즈로 셋을 나타낼 때.';
      plan.push(pt.pot === '4bp' ? '오버페어면 플랍에서 벳/올인. 오버카드 한 장 정도는 무시하고 커밋합니다.' : '오버페어면 세 스트리트 밸류 계획(드라이 보드 작은 사이즈, 웻 보드 큰 사이즈).');
      plan.push(cls === 'big_pair' ? '오버카드가 떨어지면 팟 컨트롤: 한 번 벳 후 체크, 큰 레이즈에는 폴드도 고려.' : '체크레이즈를 당해도 대부분 콜/리레이즈. 4연결 보드에서만 감속.');
      break;
    case 'mid_pair':
    case 'small_pair':
      good = '셋을 맞춘 보드(약 12%). 또는 낮은 보드에서 오버페어가 될 때(미들 페어).';
      bad = '오버카드가 2장 이상 깔린 보드에서 상대의 벳을 받을 때.';
      plan.push('셋이면 웻 보드에서는 바로 레이즈/벳으로 팟을 키우고, 드라이 보드에서는 한 스트리트 슬로우플레이도 가능합니다.');
      plan.push(cls === 'small_pair' ? '셋이 아니면 벳에 대해 폴드가 기본입니다. 상대가 체크하면 값싼 블러프캐치/쇼다운을 노립니다.' : '오버페어면 두 스트리트 밸류, 언더페어면 작은 벳만 콜하는 블러프캐처 역할.');
      if (pt.pot === '3bp' || pt.pot === '4bp') plan.push('3벳/4벳 팟에서는 상대의 오버페어 비중이 높습니다. 셋 아니면 큰 벳에는 접습니다.');
      break;
    case 'ak':
    case 'big_ace':
      good = `A 또는 ${info.low} 하이 보드(탑페어 탑키커/굿키커). 드라이한 A 하이 보드는 최상.`;
      bad = '낮은 커넥티드 보드(예: 8-7-6, 6-5-4)에서 저항을 받을 때. 스트레이트·플러시가 완성된 보드.';
      plan.push(pt.aggressor ? '어그레서로서 A/K/Q 하이 드라이 보드는 작은 사이즈로 넓게 c-bet. 탑페어를 맞추면 세 스트리트 밸류.' : '콜러로서 탑페어를 맞추면 두~세 스트리트 콜/레이즈. 놓치면 백도어 여부로 한 번 정도만 플로트.');
      plan.push(`놓쳤을 때: 오버카드 두 장은 6아웃이 있으므로 드라이 보드에서는 한 번 c-bet, 웻 낮은 보드에서는 체크/포기.${suitedNote}`);
      if (pt.pot === '4bp') plan.push('4벳 팟에서는 A/K가 하나만 깔려도 대개 올인 커밋합니다.');
      break;
    case 'suited_ace':
    case 'wheel_ace':
      good = '같은 무늬 2장(넛 플러시 드로우), 휠 카드(2·3·4·5)로 스트레이트 드로우, A 하이 드라이 보드.';
      bad = 'A를 맞췄지만 상대가 큰 저항(레이즈)을 보일 때(킥커 문제), 낮은 페어드 보드.';
      plan.push('넛 플러시 드로우/콤보 드로우는 세미 블러프로 벳/레이즈해 폴드 에퀴티와 아웃을 함께 씁니다.');
      plan.push('탑페어(A)는 킥커가 약하므로 두 스트리트 이내로 팟을 통제하고, 큰 리레이즈에는 폴드도 고려합니다.');
      plan.push('완전히 놓친 보드에서 어그레서라면 에이스 블로커로 한 번 c-bet 후 저항받으면 포기합니다.');
      break;
    case 'offsuit_ace':
      good = 'A 하이 드라이 보드에서 상대가 체크할 때.';
      bad = '탑페어를 맞췄는데 큰 벳/레이즈를 받을 때(도미네이션), 놓친 보드 전부.';
      plan.push('탑페어는 한 스트리트 밸류 후 팟 컨트롤. 놓치면 백도어가 없어 거의 포기합니다.');
      break;
    case 'suited_broadway':
    case 'offsuit_broadway':
      good = '탑페어 + 굿 킥커, 오픈엔드 스트레이트 드로우, 브로드웨이 보드(T-J-Q-K).';
      bad = 'A 하이 보드에서 저항받을 때, 낮은 커넥티드 보드.';
      plan.push('탑페어면 두 스트리트 밸류가 기본이고 세 번째 스트리트는 상대 레인지에 따라 결정합니다.');
      plan.push(`스트레이트 드로우(8아웃)/거트샷+오버카드는 어그레서면 세미 블러프 벳, 콜러면 콜 후 턴 평가.${suitedNote}`);
      if (cls === 'offsuit_broadway') plan.push('플러시가 없으므로 놓친 보드에서 플로트는 최소화합니다.');
      break;
    case 'suited_king':
    case 'suited_qj':
      good = '같은 무늬 2장(플러시 드로우), K/Q/J 하이 드라이 보드(탑페어).';
      bad = '탑페어를 맞췄지만 킥커가 약한 상태에서 큰 액션을 받을 때, A 하이 보드.';
      plan.push('플러시 드로우는 세미 블러프 또는 콜로 플레이하되, 넛이 아닌 플러시(K/Q 하이)는 큰 팟에서 주의합니다.');
      plan.push('탑페어 약한 킥커는 한~두 스트리트 밸류 후 팟 컨트롤.');
      break;
    case 'suited_connector':
    case 'suited_gapper':
    case 'offsuit_connector':
      good = '오픈엔드 스트레이트 드로우, 플러시 드로우, 낮은 커넥티드 보드(투페어·스트레이트·셋 가능성). 콜러 레인지가 우위인 보드.';
      bad = 'A/K 하이 드라이 보드(어그레서 레인지 우위)에서 아무것도 없을 때.';
      plan.push('강한 드로우(8아웃+)는 레이즈/벳 세미 블러프로 폴드 에퀴티를 더합니다. 약한 드로우(거트샷)는 가격이 맞을 때만 콜.');
      plan.push('백도어(플러시+스트레이트)가 겹치면 플랍 한 번은 플로트/벳해 볼 근거가 됩니다. 아무것도 없으면 즉시 포기.');
      plan.push('미들 페어·바텀 페어는 작은 벳에 한 번 콜하는 블러프캐처 이상은 아닙니다.');
      break;
    case 'junk':
      good = '투페어·트립스 등 강하게 맞은 보드.';
      bad = '대부분의 보드.';
      plan.push('강하게 맞지 않으면 포기합니다. 블러프는 블로커가 있을 때만 최소 빈도로.');
      break;
  }
  if (pt.aggressor && pt.pot === '3bp') plan.push('3벳 팟의 어그레서: 레인지 우위 보드(A/K 하이, 브로드웨이)에서는 작은 사이즈로 매우 넓게 c-bet, 낮은 커넥티드 보드에서는 체크 비중을 높입니다.');
  if (!pt.aggressor && pt.pot === 'srp' && hero === 'BB') plan.push('BB 콜러: 낮은 보드에서 도넉벳/체크레이즈 레인지를 가지되, 어그레서의 작은 c-bet에는 넓게 방어합니다(폴드 빈도 ≤ 50%).');

  return {
    potType: POT_LABEL[pt.pot],
    role: pt.aggressor ? '프리플랍 어그레서' : '프리플랍 콜러',
    position: ip ? '인포지션 (IP)' : '아웃오브포지션 (OOP)',
    spr: SPR_TEXT[pt.pot],
    checklist,
    goodBoards: good,
    badBoards: bad,
    plan,
  };
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export function explainStep(step: Step): Explanation {
  const info = parseHandName(step.hand);
  const cls = classifyHand(step.hand);
  const { scenario: s, answer } = step;
  const heroLabel = seatText(s.hero);
  const headline = `${heroLabel} · ${step.hand} → ${ACTION_LABEL_KO[answer]}`;
  const situation = situationText(s);
  return {
    headline,
    situation,
    handProfile: `${HAND_CLASS_KO[cls]}: ${handProfile(info, cls)}`,
    reasoning: reasoning(step, cls),
    rangeContext: rangeContext(step),
    mixNote: mixNote(step),
    chartNote: step.chart.notes?.[step.hand],
    postflop: postflopPlan(step, cls),
  };
}

function situationText(s: Scenario): string {
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return `${s.hero}까지 모두 폴드했습니다. 오픈 레이즈할지 폴드할지 결정합니다.`;
    case 'vs_open':
      return `${v}가 2.5bb${v === 'SB' ? '(3bb)' : ''}로 오픈했고 그 사이는 모두 폴드했습니다. ${s.hero}에서 폴드/콜/3벳을 결정합니다.`;
    case 'vs_3bet':
      return `${s.hero}에서 오픈했는데 ${v}가 3벳했습니다(나머지는 폴드). 폴드/콜/4벳을 결정합니다.`;
    case 'vs_4bet':
      return `${v}의 오픈에 ${s.hero}에서 3벳했는데 ${v}가 4벳했습니다. 폴드/콜/5벳 올인을 결정합니다.`;
    case 'vs_5bet':
      return `${s.hero} 오픈 → ${v} 3벳 → 내 4벳 → ${v}의 5벳 올인. 콜/폴드를 결정합니다.`;
    case 'cold_4bet':
      return `${s.extras?.opener ?? '앞'} 오픈, ${s.extras?.threeBettor ?? '앞'} 3벳 뒤에 ${s.hero}에서 첫 액션입니다. 폴드/콜/콜드 4벳을 결정합니다.`;
  }
}
