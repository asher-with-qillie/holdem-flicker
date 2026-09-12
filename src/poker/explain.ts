import { getChartCells, hasChart } from './data';
import { ALL_HANDS, parseHandName, type HandInfo } from './hands';
import { foldWeight, fullMix, rangeShare } from './range';
import { heroInPosition } from './scenarios';
import type { Step } from './trainer';
import { ACTION_SHORT_KO, POS_INDEX, type Action, type ChartCells, type Pos, type Scenario, type ScenarioKind } from './types';

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
  if (highV === 14 && lowV >= 10) return 'big_ace';
  if (highV === 14 && kind === 'suited') return lowV <= 5 ? 'wheel_ace' : 'suited_ace';
  if (highV === 14) return 'offsuit_ace';
  if (highV >= 10 && lowV >= 10) return kind === 'suited' ? 'suited_broadway' : 'offsuit_broadway';
  if (kind === 'suited' && highV === 13) return 'suited_king';
  if (kind === 'suited' && (highV === 12 || highV === 11) && gap >= 2) return 'suited_qj';
  if (kind === 'suited' && gap === 0) return 'suited_connector';
  if (kind === 'suited' && gap <= 2) return 'suited_gapper';
  if (kind === 'offsuit' && gap === 0 && highV >= 6) return 'offsuit_connector';
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
/* Korean helpers                                                      */
/* ------------------------------------------------------------------ */

const pct = (x: number) => `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;

/** Seat names read out loud: only BTN (비티엔) ends in a consonant. */
function seat(p: Pos, particle: '가' | '는' | '를' | '와'): string {
  if (p !== 'BTN') return `${p}${particle}`;
  const consonant: Record<typeof particle, string> = { 가: '이', 는: '은', 를: '을', 와: '과' };
  return `${p}${consonant[particle]}`;
}

const isBlind = (p?: Pos) => p === 'SB' || p === 'BB';
const seatsBetween = (a: Pos, b: Pos) => Math.max(0, Math.abs(POS_INDEX[a] - POS_INDEX[b]) - 1);
const seatsBehind = (hero: Pos) => 5 - POS_INDEX[hero];

/** Compact hand list for a chart action, e.g. "QQ+ · AKs · AKo · A5s(50%)". */
function summarizeRange(cells: ChartCells, action: Action, max = 9): string {
  const items: string[] = [];
  for (const h of ALL_HANDS) {
    const w = cells[h]?.[action] ?? 0;
    if (w <= 0) continue;
    items.push(w >= 1 ? h : `${h}(${Math.round(w * 100)}%)`);
  }
  if (!items.length) return '없음';
  return items.length > max ? `${items.slice(0, max).join(' · ')} 등 ${items.length}종` : items.join(' · ');
}

function villainChart(s: Scenario): { cells: ChartCells; action: Action } | null {
  const v = s.villain;
  if (!v) return null;
  switch (s.kind) {
    case 'vs_open': {
      const sc: Scenario = { kind: 'rfi', hero: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'raise' } : null;
    }
    case 'vs_3bet': {
      const sc: Scenario = { kind: 'vs_open', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'threebet' } : null;
    }
    case 'vs_4bet': {
      const sc: Scenario = { kind: 'vs_3bet', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'fourbet' } : null;
    }
    case 'vs_5bet': {
      const sc: Scenario = { kind: 'vs_4bet', hero: v, villain: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'allin' } : null;
    }
    default:
      return null;
  }
}

/** The range hero arrived with (opening range for vs_3bet, 3-bet range for vs_4bet, 4-bet range for vs_5bet). */
function previousRange(s: Scenario): { cells: ChartCells; action: Action; label: string } | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_3bet': {
      const sc: Scenario = { kind: 'rfi', hero: s.hero };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'raise', label: '오픈 레인지' } : null;
    }
    case 'vs_4bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_open', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'threebet', label: '3벳 레인지' } : null;
    }
    case 'vs_5bet': {
      if (!v) return null;
      const sc: Scenario = { kind: 'vs_3bet', hero: s.hero, villain: v };
      return hasChart(sc) ? { cells: getChartCells(sc), action: 'fourbet', label: '4벳 레인지' } : null;
    }
    default:
      return null;
  }
}

function heroIsIP(s: Scenario): boolean {
  if (s.kind === 'rfi') return s.hero !== 'SB'; // assume the BB (or a later caller) defends
  const v = s.villain ?? s.extras?.threeBettor;
  return v ? heroInPosition(s.hero, v) : s.hero !== 'SB';
}

/* ------------------------------------------------------------------ */
/* Hand profile                                                        */
/* ------------------------------------------------------------------ */

function dominators(info: HandInfo): string {
  if (info.lowV === 12) return 'AK·빅페어';
  if (info.lowV === 11) return 'AK·AQ·빅페어';
  return 'AK·AQ·AJ·빅페어';
}

function handProfile(info: HandInfo, cls: HandClass): string {
  const n = info.name;
  const suited = info.kind === 'suited';
  switch (cls) {
    case 'premium_pair':
      return n === 'AA'
        ? 'AA — 프리플랍 최강 핸드입니다. 어떤 핸드 상대로도 앞서며(KK 상대 약 82%), 목표는 팟을 최대한 키우는 것입니다.'
        : 'KK — 두 번째로 강한 핸드입니다. 넓은 레인지 상대 승률 80% 이상이지만 AA에는 크게 뒤집니다(약 18%). 그래도 프리플랍에서 접는 일은 거의 없습니다.';
    case 'big_pair':
      return `${n} — 빅 포켓페어입니다. 대부분의 레인지에 크게 앞서지만 AA·KK에는 크게 뒤지고, 플랍에 오버카드(A/K)가 떨어지면 가치가 급감합니다.`;
    case 'mid_pair':
      return `${n} — 미들 포켓페어입니다. 오버페어가 되는 보드가 많지 않아 셋 가치와 쇼다운 가치를 함께 가지며, 큰 팟에서는 대개 블러프캐처가 됩니다.`;
    case 'small_pair':
      return `${n} — 스몰 포켓페어입니다. 플랍에서 셋(약 12%)을 맞추는 임플라이드 오즈가 핵심이고, 셋이 아니면 거의 항상 언더페어입니다.`;
    case 'ak':
      return `${n} — 가장 강한 언페어드 핸드입니다. 모든 언페어드 핸드를 도미네이트하고 QQ 이하 페어 상대 45% 전후(코인플립)이지만 KK 상대 약 30%, AA 상대 약 10%입니다. A/K 하이 보드에서 탑페어 탑키커를 만듭니다.`;
    case 'big_ace':
      return `${n} — 빅 에이스 브로드웨이입니다. 약한 에이스를 도미네이트하지만 ${dominators(info)}에는 도미네이트당하므로 상대 레인지가 타이트할수록 가치가 떨어집니다.${suited ? ' 수티드라 넛 플러시 가능성이 더해집니다.' : ''}`;
    case 'suited_ace':
      return `${n} — 수티드 에이스입니다. 넛 플러시 드로우와 에이스 블로커(상대 AA/AK 조합 감소)를 가지며, 탑페어를 맞춰도 킥커가 약해 큰 팟보다 작은 팟에 적합합니다.`;
    case 'wheel_ace':
      return `${n} — 수티드 휠 에이스입니다. 넛 플러시·휠 스트레이트 가능성과 에이스 블로커 덕분에 솔버가 가장 선호하는 3벳/4벳 블러프 재료입니다. 탑페어 가치는 낮습니다.`;
    case 'offsuit_ace':
      return `${n} — 오프수트 에이스입니다. 플러시 가능성이 없고 킥커가 약해 도미네이션 위험이 큽니다. 늦은 포지션의 넓은 레인지 상대로만 가치가 있습니다.`;
    case 'suited_broadway':
      return `${n} — 수티드 브로드웨이입니다. 탑페어·스트레이트·플러시를 고르게 만들며 플레이어빌리티가 좋아 콜 레인지의 핵심입니다.`;
    case 'offsuit_broadway':
      return `${n} — 오프수트 브로드웨이입니다. 탑페어를 자주 만들지만 도미네이트당하기 쉽고 플러시가 없어, 타이트한 레인지 상대로는 콜보다 폴드/3벳 양극화가 선호됩니다.`;
    case 'suited_king':
      return `${n} — 수티드 킹입니다. 킹 하이 플러시와 킹 블로커를 가지지만 킥커가 약해 탑페어로 큰 팟을 만들기는 어렵습니다.`;
    case 'suited_qj':
      return `${n} — 약한 수티드 퀸/잭입니다. 플러시·백도어 가능성으로 늦은 포지션에서 오픈하거나 넓은 레인지를 방어할 때만 사용합니다.`;
    case 'suited_connector':
      return `${n} — 수티드 커넥터입니다. 스트레이트·플러시 등 넛 가능성이 있어 임플라이드 오즈가 좋고, 낮은 보드에서 콜러 레인지의 우위를 만들어 줍니다.`;
    case 'suited_gapper':
      return `${n} — 수티드 갭퍼입니다. 커넥터보다 스트레이트 가능성이 적지만 플러시·백도어로 플레이어빌리티가 있어 포지션이 있을 때 가치가 있습니다.`;
    case 'offsuit_connector':
      return `${n} — 오프수트 커넥터입니다. 스트레이트 가능성은 있지만 플러시가 없고 페어를 맞춰도 약해, 아주 넓은 레인지 상황(주로 BB 디펜스)에서만 플레이합니다.`;
    case 'junk':
      return suited
        ? `${n} — 프리플랍 가치가 낮은 수티드 핸드입니다. 플러시 가능성은 있지만 하이카드·스트레이트 가치가 부족해 가장 넓은 레인지 상황에서만 플레이합니다.`
        : `${n} — 프리플랍 가치가 낮은 핸드입니다. 하이카드·플러시·스트레이트 가능성이 모두 부족해 대부분의 상황에서 폴드입니다.`;
  }
}

/* ------------------------------------------------------------------ */
/* Hand-level rationale                                                */
/* ------------------------------------------------------------------ */

const OPEN: Record<HandClass, string> = {
  premium_pair: '최강 핸드로 오픈해 팟을 키웁니다. 3벳을 받으면 4벳으로 밸류를 더 뽑습니다.',
  big_pair: '대부분의 핸드에 앞서므로 밸류 오픈입니다. 3벳을 받아도 편하게 계속 플레이합니다.',
  mid_pair: '오픈 레인지의 안정적인 밸류 핸드입니다. 셋 가치와 쇼다운 가치를 함께 가집니다.',
  small_pair: '셋마이닝 가치가 있어 오픈합니다. 3벳을 받으면 대개 폴드하지만 깊은 스택·인포지션이면 콜도 가능합니다.',
  ak: '밸류와 플레이어빌리티를 모두 갖춘 최고의 오픈 핸드입니다. 3벳을 받으면 4벳 또는 콜로 계속 갑니다.',
  big_ace: '약한 에이스와 브로드웨이를 도미네이트하는 밸류 오픈입니다. 3벳에는 대개 콜로 대응합니다.',
  suited_ace: '넛 플러시 가능성과 에이스 블로커 덕분에 모든 포지션에서 오픈할 수 있습니다. 3벳을 받으면 대체로 폴드하거나 블러프 4벳 재료가 됩니다.',
  wheel_ace: '넛 플러시·휠 가능성과 에이스 블로커 때문에 오픈 레인지에 항상 들어갑니다. 3벳을 받으면 블러프 4벳 후보입니다.',
  offsuit_ace: '늦은 포지션에서는 블라인드를 훔치는 오픈입니다. 킥커가 약하므로 3벳을 받으면 폴드합니다.',
  suited_broadway: '탑페어·스트레이트·플러시를 고루 만드는 플레이어빌리티 좋은 오픈 핸드입니다.',
  offsuit_broadway: '탑페어를 자주 만들어 오픈하지만, 도미네이션 위험 때문에 이른 포지션에서는 빠집니다.',
  suited_king: '킹 하이 플러시와 백도어 가능성으로 늦은 포지션에서 오픈합니다. 3벳에는 대부분 폴드합니다.',
  suited_qj: '플러시·백도어 가능성으로 늦은 포지션에서만 오픈하는 하단 핸드입니다.',
  suited_connector: '넛 가능성으로 오픈 레인지의 균형을 잡아 주는 핸드입니다. 낮은 보드에서 강합니다.',
  suited_gapper: '플러시·스트레이트 가능성으로 늦은 포지션 오픈 레인지에 들어갑니다.',
  offsuit_connector: '아주 넓게 오픈하는 자리에서만 스틸 목적으로 오픈합니다.',
  junk: '아주 넓게 오픈하는 자리에서만 블라인드 스틸 목적으로 오픈합니다.',
};

const AGGRESSIVE: Record<HandClass, string> = {
  premium_pair: '최강 핸드로 밸류를 극대화합니다. 상대가 콜·리레이즈로 팟을 키워 줄수록 이득입니다.',
  big_pair: '레인지 대부분에 앞서므로 밸류로 공격합니다. 상대가 더 강하게 리레이즈하면 AA/KK를 의식해 감속할 준비를 합니다.',
  mid_pair: '상대의 넓은 레인지에 앞서면서 폴드 에퀴티도 얻습니다. 리레이즈를 당하면 대부분 폴드 또는 콜로 셋을 노립니다.',
  small_pair: '폴드 에퀴티와 셋 가치를 함께 노립니다. 리레이즈를 당하면 폴드가 기본입니다.',
  ak: '밸류와 폴드 에퀴티를 모두 가지는 최고의 공격 핸드입니다. 리레이즈를 당해도 에퀴티가 충분합니다.',
  big_ace: '상대의 약한 에이스·브로드웨이를 도미네이트하며 밸류를 얻습니다. AK·빅페어의 리레이즈에는 물러납니다.',
  suited_ace: '에이스 블로커로 상대의 최강 조합을 줄이고 폴드 에퀴티를 얻는 세미 블러프성 공격입니다. 콜을 받아도 넛 플러시 가능성이 있습니다.',
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
  suited_king: '킥커가 약해 탑페어 가치가 낮고, 이 자리에서는 레인지에 들어가지 않습니다.',
  suited_qj: '하이카드 가치가 부족하고 플러시만으로는 이 자리의 가격을 감당하지 못합니다.',
  suited_connector: '이 자리에서는 스트레이트·플러시 가능성만으로는 상대 레인지의 강함을 이기지 못합니다.',
  suited_gapper: '갭이 있어 스트레이트 가능성이 낮고 하이카드 가치도 부족합니다.',
  offsuit_connector: '플러시가 없고 하이카드 가치가 낮아 폴드입니다.',
  junk: '하이카드·플러시·스트레이트 가능성이 모두 부족한 핸드는 위치와 무관하게 폴드합니다.',
};

/** All-in nodes (vs_5bet, and 'allin' answers) need their own wording — there is no re-raise to talk about. */
function allInRationale(step: Step, cls: HandClass): string {
  const { answer, scenario: s } = step;
  if (s.kind === 'vs_5bet') {
    if (answer === 'call') {
      return cls === 'premium_pair'
        ? '올인 콜입니다. 상대의 5벳 레인지(KK+·AK 위주) 상대로도 크게 앞섭니다.'
        : cls === 'ak'
          ? '올인 콜입니다. A와 K 블로커가 상대의 AA·KK 조합을 절반으로 줄이고, AK끼리는 찹이 많아 필요 승률(약 38~40%)을 간신히 넘깁니다.'
          : '올인 콜입니다. 상대의 5벳 레인지에 QQ·AK가 충분히 섞여 있어 필요 승률(약 38~40%)을 넘깁니다.';
    }
    return cls === 'wheel_ace' || cls === 'suited_ace'
      ? '4벳 블러프였으므로 올인에는 접습니다. 블로커의 역할은 4벳에서 끝났습니다.'
      : cls === 'big_pair' || cls === 'ak'
        ? '상대의 5벳 레인지(KK+·AK 위주) 상대 승률이 필요 승률(약 38~40%)에 못 미쳐 폴드합니다. 4벳까지의 투자는 잊고 남은 결정만 봅니다.'
        : '5벳 올인 레인지 상대로 승률이 부족해 폴드합니다.';
  }
  // answer === 'allin' (5-bet jam) in vs_4bet
  switch (cls) {
    case 'premium_pair':
      return '5벳 올인입니다. 상대의 4벳 레인지(QQ+/AK + A5s류 블러프) 전체에 앞서므로 올인으로 밸류를 극대화하고 블러프의 폴드 에퀴티도 챙깁니다. 올인 후에는 더 이상 결정이 없습니다.';
    case 'big_pair':
    case 'ak':
      return '5벳 올인입니다. 콜하면 아웃오브포지션·낮은 SPR에서 플레이하기 어렵고, 올인하면 상대의 4벳 블러프(A5s류)를 폴드시키면서 AK·JJ 상대로는 앞서거나 코인플립입니다.';
    case 'wheel_ace':
    case 'suited_ace':
      return '5벳 블러프 올인입니다. 에이스 블로커로 상대의 AA·AK 조합을 줄여 폴드 에퀴티를 높이고, 콜을 받아도 약 30% 전후의 에퀴티가 남습니다. 넓은 4벳 레인지 상대로만 저빈도로 사용합니다.';
    default:
      return '5벳 올인으로 상대의 4벳 블러프를 폴드시키고 밸류 레인지와는 플립을 받습니다.';
  }
}

/* ------------------------------------------------------------------ */
/* Scenario-level reasoning                                            */
/* ------------------------------------------------------------------ */

function scenarioLines(step: Step): string[] {
  const { scenario: s, answer } = step;
  const hero = s.hero;
  const v = s.villain;
  const out: string[] = [];
  const vc = villainChart(s);
  const vShare = vc ? rangeShare(vc.cells, vc.action) : null;
  const ip = heroIsIP(s);

  switch (s.kind) {
    case 'rfi': {
      const openShare = rangeShare(step.cells, 'raise');
      if (hero === 'SB') out.push(`SB는 BB 한 명만 남아 넓게(약 ${pct(openShare)}) 오픈하지만, 플랍 이후 항상 아웃오브포지션이므로 3bb로 크게 오픈해 BB의 콜을 억제합니다.`);
      else if (hero === 'BTN') out.push(`BTN은 항상 포지션을 가지고 블라인드 두 명만 상대하므로 가장 넓게(약 ${pct(openShare)}) 오픈합니다.`);
      else out.push(`${seat(hero, '는')} 뒤에 ${seatsBehind(hero)}명이 남아 있어 오픈 레인지를 약 ${pct(openShare)}로 제한합니다. 뒤에 남은 사람이 많을수록 3벳을 당하거나 포지션을 잃을 확률이 큽니다.`);
      break;
    }
    case 'vs_open': {
      out.push(
        `${seat(v!, '는')} 약 ${vShare == null ? '?' : pct(vShare)}의 레인지로 오픈합니다. ${['UTG', 'HJ'].includes(v!) ? '이른 포지션의 타이트한 레인지라 브로드웨이·미들 에이스는 도미네이트당하기 쉬워 방어 레인지를 좁힙니다.' : '늦은 포지션의 넓은 레인지이므로 더 넓게 방어하고 3벳 빈도도 높입니다.'}`,
      );
      if (hero === 'BB') {
        out.push(
          v === 'SB'
            ? 'BB는 이미 1bb를 넣었으므로 2bb를 더 내고 약 6bb 팟을 봅니다(필요 승률 약 33%). SB 상대로는 플랍 이후 포지션까지 있어 가장 넓게 방어합니다.'
            : 'BB는 이미 1bb를 넣었으므로 1.5bb를 더 내고 약 5.5bb 팟을 봅니다(필요 승률 약 27%). 클로징 액션이라 스퀴즈 위험도 없어 가장 넓게 콜하고, 3벳은 밸류와 블러프(수티드 휠 에이스, 수티드 커넥터)로 양극화합니다.',
        );
      } else if (hero === 'SB') {
        out.push(
          answer === 'call'
            ? 'SB는 보통 3벳-or-폴드지만, 이 핸드는 예외적으로 콜합니다. 2bb를 더 내고 약 6bb 팟을 보되(필요 승률 약 33%) BB의 스퀴즈와 아웃오브포지션을 감수합니다.'
            : 'SB는 콜하면 BB의 스퀴즈와 아웃오브포지션 문제가 겹치므로 3벳-or-폴드 위주로 대응합니다.',
        );
      } else {
        out.push(`${seat(hero, '는')} 포지션이 있지만 뒤에 ${seatsBehind(hero)}명이 남아 있어 콜 레인지는 스퀴즈에 견딜 수 있는 핸드로 제한됩니다. 2.5bb를 내고 약 6.5bb 팟을 봅니다(필요 승률 약 38%).`);
      }
      break;
    }
    case 'vs_3bet': {
      out.push(
        `${seat(v!, '는')} 약 ${vShare == null ? '?' : pct(vShare)}의 ${isBlind(v) ? '양극화된(밸류 + 블러프) 레인지' : '리니어한(강한 핸드 위주) 레인지'}로 3벳합니다.`,
      );
      out.push(
        isBlind(v)
          ? `블라인드의 3벳(약 10~11bb)에 8bb 정도를 더 내고 약 22bb 팟을 봅니다(필요 승률 약 36%). ${ip ? '내가 포지션을 가지므로 콜로 에퀴티를 실현하기 쉽습니다.' : '내가 아웃오브포지션이라 콜 레인지를 좁히고 4벳/폴드 비중을 높입니다.'}`
          : `인포지션 3벳(약 7.5bb)에 5bb를 더 내고 약 16.5bb 팟을 봅니다(필요 승률 약 30%). 하지만 플랍 이후 아웃오브포지션이라 실현 가능한 에퀴티가 줄어듭니다.`,
      );
      break;
    }
    case 'vs_4bet': {
      out.push(`${seat(v!, '는')} 약 ${vShare == null ? '?' : pct(vShare)}로 4벳합니다: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내 3벳 레인지 중 올인: ${summarizeRange(step.cells, 'allin', 6)} / 콜: ${summarizeRange(step.cells, 'call', 6)}. 나머지는 폴드합니다.`);
      out.push('4벳(약 22~25bb)에 콜하면 SPR 1~1.5의 4벳 팟이 됩니다. 필요 승률은 약 30%지만 남은 스택이 적어 플랍에서 사실상 커밋됩니다.');
      break;
    }
    case 'vs_5bet': {
      out.push(`${seat(v!, '는')} 약 ${vShare == null ? '?' : pct(vShare)}로 5벳 올인합니다: ${vc ? summarizeRange(vc.cells, vc.action) : '?'}.`);
      out.push(`내 4벳 레인지 중 콜: ${summarizeRange(step.cells, 'call', 6)}. 4벳 블러프(A5s 등)는 당연히 폴드합니다.`);
      out.push('올인 콜의 필요 승률은 약 38~40%입니다(4벳 22~25bb 후 100bb 올인). 이미 넣은 4벳은 매몰 비용입니다.');
      break;
    }
    case 'cold_4bet': {
      out.push('앞에 오픈과 3벳이 모두 있어 두 레인지를 동시에 상대하고, 콜하면 오프너가 다시 4벳(스퀴즈)할 수 있습니다.');
      out.push(
        answer === 'call'
          ? '콜드 콜은 드문 예외입니다. 셋/강한 핸드로 3벳 팟을 보되 오프너의 4벳에는 접을 준비를 합니다.'
          : '콜드 4벳 레인지는 KK+ 밸류와 A5s 같은 소수의 블러프로 극도로 좁고, 콜은 QQ/AK류로만 가끔 하며 나머지는 모두 폴드입니다.',
      );
      break;
    }
  }
  return out;
}

function reasoning(step: Step, cls: HandClass): string[] {
  const { scenario: s, answer } = step;
  const lines = scenarioLines(step);
  const mixed = foldWeight(step.mix) > 0 && foldWeight(step.mix) < 1;
  const isAggressive = answer === 'raise' || answer === 'threebet' || answer === 'fourbet' || answer === 'allin';

  let handLine: string;
  if (s.kind === 'vs_5bet' || answer === 'allin') handLine = allInRationale(step, cls);
  else if (s.kind === 'rfi' && answer === 'raise') handLine = OPEN[cls];
  else if (isAggressive) handLine = AGGRESSIVE[cls];
  else if (answer === 'call') handLine = CALL[cls];
  else handLine = FOLD[cls] || '이 자리에서는 폴드가 기대값이 가장 높습니다.';

  if (answer === 'fold' && mixed) handLine = `기본은 폴드지만 일부 빈도로 계속 플레이합니다. ${handLine}`;
  else if (answer !== 'fold' && step.mixList.length >= 2) {
    const alt = step.mixList[1];
    if (alt && alt.action === 'fold' && mixed) handLine = `${handLine} 경계 핸드라 일부 빈도(${Math.round(alt.weight * 100)}%)로는 폴드합니다.`;
    else if (alt && alt.action !== 'fold') handLine = `${handLine} ${ACTION_SHORT_KO[alt.action]}도 ${Math.round(alt.weight * 100)}% 빈도로 섞습니다.`;
  }

  const out = [handLine, ...lines];

  const ip = heroIsIP(s);
  if (answer === 'call' && !ip && s.kind !== 'vs_5bet' && !(s.kind === 'vs_open' && s.hero === 'SB')) {
    out.push('아웃오브포지션 콜이므로 플랍 이후 체크-콜/체크-레이즈 계획이 필요합니다. 에퀴티 실현이 어려운 만큼 강한 핸드 위주로만 콜합니다.');
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Range context / mix note                                            */
/* ------------------------------------------------------------------ */

function rangeContext(step: Step): string {
  const { answer, scenario: s } = step;
  const prev = previousRange(s);
  const label = ACTION_SHORT_KO[answer];
  if (prev) {
    const prevShare = rangeShare(prev.cells, prev.action);
    const cont = rangeShare(step.cells);
    const contOfPrev = prevShare > 0 ? cont / prevShare : 0;
    if (answer === 'fold') return `${prev.label} 중 약 ${pct(contOfPrev)}만 계속 플레이하고, 이 핸드는 그 밖에 있습니다.`;
    const actShare = rangeShare(step.cells, answer);
    return `${prev.label} 중 약 ${pct(contOfPrev)}가 계속 플레이하며(${label} 약 ${pct(prevShare > 0 ? actShare / prevShare : 0)}), 이 핸드는 그 안에 있습니다.`;
  }
  const total = rangeShare(step.cells);
  if (answer === 'fold') return `이 상황에서 ${seat(s.hero, '가')} 계속 플레이하는 레인지는 전체 핸드의 약 ${pct(total)}이고, 이 핸드는 그 밖에 있습니다.`;
  const share = rangeShare(step.cells, answer);
  const extra = Math.abs(share - total) > 0.001 ? ` (계속 플레이 합계 약 ${pct(total)})` : '';
  return `${label} 레인지는 전체 핸드의 약 ${pct(share)}${extra}이며, 이 핸드는 그 안에 있습니다.`;
}

function mixNote(step: Step): string | undefined {
  const list = step.mixList;
  if (list.length <= 1) return undefined;
  const parts = list.map((m) => `${ACTION_SHORT_KO[m.action]} ${Math.round(m.weight * 100)}%`).join(' / ');
  const fold = foldWeight(step.mix);
  const tie = list.length >= 2 && Math.abs(list[0].weight - list[1].weight) < 1e-6;
  const tieNote = tie ? ' 빈도가 같으면 더 공격적인 액션을 답으로 삼습니다.' : ' 암기용 답은 가장 높은 빈도의 액션입니다.';
  let tip: string;
  if (step.scenario.kind === 'rfi') tip = '뒤에 3벳이 잦은 플레이어가 있으면 폴드 쪽, 타이트한 플레이어만 남았으면 오픈 쪽으로 기울이세요.';
  else if (fold > 0 && fold < 1) tip = '경계 핸드입니다. 상대가 타이트하면 폴드 쪽, 루즈하면 플레이 쪽으로 기울이세요.';
  else tip = '혼합 전략 핸드입니다. 상대가 4벳/5벳을 자주 하면 콜 쪽, 자주 접으면 공격 쪽으로 기울이세요.';
  return `솔버 빈도: ${parts}.${tieNote} ${tip}`;
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
  '3bp': 'SPR 약 4~6 (중간): 오버페어·탑페어 탑키커는 대체로 커밋 가능하고, 약한 탑페어는 두 스트리트 정도가 상한입니다.',
  '4bp': 'SPR 약 1~1.5 (얕음): 오버페어·탑페어·강한 드로우면 올인이 기본입니다. 플랍에서 사실상 마지막 결정을 내립니다.',
};

function postflopPlan(step: Step, cls: HandClass): PostflopPlan | undefined {
  const pt = potTypeAfter(step);
  if (!pt) return undefined;
  const { scenario: s } = step;
  const hero = s.hero;
  const ip = heroIsIP(s);
  const info = parseHandName(step.hand);
  const four = pt.pot === '4bp';
  const bet = pt.aggressor ? '벳' : '체크-레이즈/콜';

  const checklist: string[] = [
    `레인지 우위: 이 보드가 ${pt.aggressor ? '프리플랍 어그레서(나)' : '프리플랍 어그레서(상대)'}의 레인지에 유리한가? A/K 하이·브로드웨이 보드는 레이즈한 쪽, 낮은 커넥티드 보드(예: 8♠7♦6♠)는 콜한 쪽에 유리합니다.`,
    '넛 우위: 셋·투페어·스트레이트 같은 최강 핸드를 누가 더 많이 가지는가? 넛 우위가 있는 쪽이 큰 사이즈로 공격할 수 있습니다.',
    '내 핸드의 상태: 메이드 핸드(오버페어/탑페어/셋)인지, 드로우(플러시·스트레이트·백도어)인지, 에어(오버카드·블로커만)인지 분류하세요.',
    SPR_TEXT[pt.pot],
    '보드 텍스처: 드라이(레인보우·연결 없음)면 작은 사이즈(팟의 25~33%)로 자주, 웻(드로우 많음)이면 큰 사이즈(팟의 60~75%)로 좁게 벳합니다.',
    `포지션: 나는 ${ip ? '인포지션' : '아웃오브포지션'}입니다. ${ip ? '상대의 체크를 받으면 벳/체크백을 선택할 수 있어 에퀴티 실현이 쉽습니다.' : '체크 비중을 높이고 체크-콜/체크-레이즈 레인지를 준비합니다.'}`,
    '상대의 성향: 동크벳·체크레이즈·콜 빈도가 GTO보다 높거나 낮은가? 익스플로잇 포인트를 찾습니다.',
  ];

  let good = '';
  let bad = '';
  const plan: string[] = [];
  const suitedNote = info.kind === 'suited' ? ' 같은 무늬가 두 장 깔리면 플러시 드로우, 한 장이면 백도어 플러시로 계속 갈 근거가 됩니다.' : '';

  switch (cls) {
    case 'premium_pair':
    case 'big_pair':
      good = `내 페어보다 낮은 카드만 있는 보드(오버페어). ${cls === 'big_pair' ? 'A/K가 없는' : '거의 모든'} 보드에서 밸류 ${bet}.`;
      bad = cls === 'big_pair' ? 'A 또는 K가 떨어진 보드(QQ/JJ는 언더페어가 됨), 4연결·모노톤 보드.' : '4연결 스트레이트·모노톤 보드, 상대가 강한 저항으로 셋을 나타낼 때.';
      if (four) {
        plan.push('오버페어면 플랍에서 벳/올인. 오버카드 한 장 정도는 무시하고 커밋합니다.');
        plan.push(cls === 'big_pair' ? 'A·K 두 장이 모두 깔린 보드에서만 접고, 한 장이면 대부분 커밋합니다.' : '사실상 어떤 보드에서도 스택을 넣습니다.');
      } else {
        plan.push(pt.aggressor ? '오버페어면 세 스트리트 밸류 계획(드라이 보드 작은 사이즈, 웻 보드 큰 사이즈).' : '오버페어면 콜러로서 체크-레이즈 또는 두~세 스트리트 콜/레이즈로 밸류를 뽑습니다.');
        plan.push(cls === 'big_pair' ? '오버카드가 떨어지면 팟 컨트롤: 한 번 벳 후 체크, 큰 레이즈에는 폴드도 고려.' : '리레이즈를 당해도 대부분 콜/리레이즈. 4연결 보드에서만 감속.');
      }
      break;
    case 'mid_pair':
    case 'small_pair':
      good = '셋을 맞춘 보드(약 12%). 또는 낮은 보드에서 오버페어가 될 때(미들 페어).';
      bad = '오버카드가 2장 이상 깔린 보드에서 상대의 벳을 받을 때.';
      if (four) {
        plan.push('4벳 팟(SPR 약 1.5)에서는 오버페어면 올인 커밋, 오버카드 1장은 사이즈에 따라, 2장이면 폴드합니다.');
        plan.push('셋이면 어떤 보드에서든 스택을 넣습니다. 상대 레인지에는 오버페어가 많습니다.');
      } else {
        plan.push('셋이면 웻 보드에서는 바로 레이즈/벳으로 팟을 키우고, 드라이 보드에서는 한 스트리트 슬로우플레이도 가능합니다.');
        plan.push(cls === 'small_pair' ? '셋이 아니면 벳에 대해 폴드가 기본입니다. 상대가 체크하면 값싼 블러프캐치/쇼다운을 노립니다.' : '오버페어면 두 스트리트 밸류, 언더페어면 작은 벳만 콜하는 블러프캐처 역할.');
        if (pt.pot === '3bp') plan.push('3벳 팟에서는 상대의 오버페어 비중이 높습니다. 셋 아니면 큰 벳에는 접습니다.');
      }
      break;
    case 'ak':
    case 'big_ace':
      good = `A 또는 ${info.low} 하이 보드(탑페어 ${cls === 'ak' ? '탑키커' : '굿키커'}). 드라이한 A 하이 보드는 최상.`;
      bad = '낮은 커넥티드 보드(예: 8-7-6, 6-5-4)에서 저항을 받을 때. 스트레이트·플러시가 완성된 보드.';
      if (four) {
        plan.push(`4벳 팟에서는 A 또는 ${info.low}가 하나만 깔려도 대개 올인 커밋합니다.`);
        plan.push(pt.aggressor ? '놓친 보드에서도 오버카드 두 장이면 드라이 보드에서는 작은 벳/올인 압박이 가능합니다. 낮은 웻 보드에서는 체크.' : '놓친 보드에서는 상대의 작은 벳에 한 번 콜할 수 있지만 큰 벳에는 접습니다.');
      } else {
        plan.push(pt.aggressor ? '어그레서로서 A/K/Q 하이 드라이 보드는 작은 사이즈로 넓게 c-bet. 탑페어를 맞추면 세 스트리트 밸류.' : '콜러로서 탑페어를 맞추면 두~세 스트리트 콜/레이즈. 놓치면 백도어 여부로 한 번 정도만 플로트.');
        plan.push(pt.aggressor ? `놓쳤을 때: 오버카드 두 장은 6아웃이 있으므로 드라이 보드에서는 한 번 c-bet, 웻 낮은 보드에서는 체크/포기.${suitedNote}` : `놓쳤을 때: 상대의 작은 벳에는 백도어가 있을 때만 콜, 큰 벳에는 폴드.${suitedNote}`);
      }
      break;
    case 'suited_ace':
    case 'wheel_ace':
      good = '같은 무늬 2장(넛 플러시 드로우), 휠 카드(2·3·4·5)로 스트레이트 드로우, A 하이 드라이 보드.';
      bad = 'A를 맞췄지만 상대가 큰 저항(레이즈)을 보일 때(킥커 문제), 낮은 페어드 보드.';
      if (four) {
        plan.push('4벳 팟(SPR 약 1.5)에서는 A가 깔리거나 넛 플러시 드로우면 그대로 커밋합니다. 킥커 걱정보다 SPR이 우선입니다.');
        plan.push('완전히 놓친 보드에서 어그레서라면 에이스 블로커로 작은 벳 한 번, 저항받으면 포기합니다.');
      } else {
        plan.push('넛 플러시 드로우/콤보 드로우는 세미 블러프로 벳/레이즈해 폴드 에퀴티와 아웃을 함께 씁니다.');
        plan.push('탑페어(A)는 킥커가 약하므로 두 스트리트 이내로 팟을 통제하고, 큰 리레이즈에는 폴드도 고려합니다.');
        plan.push(pt.aggressor ? '완전히 놓친 보드에서는 에이스 블로커로 한 번 c-bet 후 저항받으면 포기합니다.' : '완전히 놓친 보드에서는 백도어가 없으면 포기합니다.');
      }
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
      if (four) {
        plan.push('4벳 팟에서는 탑페어나 8아웃 이상 드로우면 커밋, 아무것도 없으면 포기합니다.');
      } else {
        plan.push('탑페어면 두 스트리트 밸류가 기본이고 세 번째 스트리트는 상대 레인지에 따라 결정합니다.');
        plan.push(`스트레이트 드로우(8아웃)/거트샷+오버카드는 ${pt.aggressor ? '세미 블러프 벳' : '콜 후 턴 평가'}.${suitedNote}`);
        if (cls === 'offsuit_broadway') plan.push('플러시가 없으므로 놓친 보드에서 플로트는 최소화합니다.');
      }
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
      plan.push(`강한 드로우(8아웃+)는 ${pt.aggressor ? '벳' : '레이즈'} 세미 블러프로 폴드 에퀴티를 더합니다. 약한 드로우(거트샷)는 가격이 맞을 때만 콜.`);
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
  if (!pt.aggressor && pt.pot === 'srp' && hero === 'BB') plan.push('BB 콜러: 낮은 보드에서 동크벳/체크레이즈 레인지를 가지되, 어그레서의 작은 c-bet에는 넓게 방어합니다(폴드 빈도 ≤ 50%).');
  if (s.kind === 'cold_4bet' && !pt.aggressor) plan.push('콜드 콜 뒤에는 오프너가 아직 남아 있습니다. 오프너가 4벳하면 셋마이닝 가치가 사라지므로 접습니다.');

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
/* Situation text                                                      */
/* ------------------------------------------------------------------ */

function situationText(s: Scenario): string {
  const v = s.villain;
  const between = v ? seatsBetween(s.hero, v) : 0;
  const foldedBetween = between ? ` 사이 ${between}명은 폴드했습니다.` : '';
  switch (s.kind) {
    case 'rfi':
      return `${s.hero}까지 모두 폴드했습니다. 오픈 레이즈할지 폴드할지 결정합니다.`;
    case 'vs_open':
      return `${seat(v!, '가')} ${v === 'SB' ? '3bb' : '2.5bb'}로 오픈했습니다.${foldedBetween} ${s.hero}에서 폴드/콜/3벳을 결정합니다.`;
    case 'vs_3bet':
      return `내가 ${s.hero}에서 오픈했는데 ${seat(v!, '가')} 3벳했습니다(나머지는 폴드). 폴드/콜/4벳을 결정합니다.`;
    case 'vs_4bet':
      return `${seat(v!, '가')} 오픈, 내가 ${s.hero}에서 3벳, ${seat(v!, '가')} 다시 4벳했습니다. 폴드/콜/5벳 올인을 결정합니다.`;
    case 'vs_5bet':
      return `내(${s.hero}) 오픈 → ${v} 3벳 → 내 4벳 → ${v} 5벳 올인. 콜/폴드를 결정합니다.`;
    case 'cold_4bet':
      return `${s.extras?.opener ?? '앞'} 오픈, ${s.extras?.threeBettor ?? '앞'} 3벳 뒤에 ${s.hero}에서 첫 액션입니다. 폴드/콜/콜드 4벳을 결정합니다.`;
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export function explainStep(step: Step): Explanation {
  const info = parseHandName(step.hand);
  const cls = classifyHand(step.hand);
  const { scenario: s, answer } = step;
  const kindLabel: Record<ScenarioKind, string> = { rfi: '오픈', vs_open: '오픈 대응', vs_3bet: '3벳 대응', vs_4bet: '4벳 대응', vs_5bet: '올인 대응', cold_4bet: '콜드 4벳' };
  const headline = `${s.hero} ${kindLabel[s.kind]} · ${step.hand} → ${ACTION_SHORT_KO[answer]}`;
  return {
    headline,
    situation: situationText(s),
    handProfile: `${HAND_CLASS_KO[cls]} · ${handProfile(info, cls)}`,
    reasoning: reasoning(step, cls),
    rangeContext: rangeContext(step),
    mixNote: mixNote(step),
    chartNote: step.chart.notes?.[step.hand],
    postflop: postflopPlan(step, cls),
  };
}

export { fullMix };
