import { josa } from './ko';
import { POSITIONS, POS_INDEX, type Pos, type Scenario, type ScenarioKind } from './types';

/** 자리 이름 + 주격 조사(BTN이 · CO가). 규칙은 ko.ts 한 곳에 있습니다. */
export function seatSubject(p: Pos): string {
  return josa(p, '이/가');
}

export function scenarioId(kind: ScenarioKind, hero: Pos, villain?: Pos): string {
  return villain ? `${kind}:${hero}:${villain}` : `${kind}:${hero}`;
}

export function scenarioKey(s: Scenario): string {
  return scenarioId(s.kind, s.hero, s.villain);
}

export function positionsBefore(p: Pos): Pos[] {
  return POSITIONS.filter((q) => POS_INDEX[q] < POS_INDEX[p]);
}

export function positionsAfter(p: Pos): Pos[] {
  return POSITIONS.filter((q) => POS_INDEX[q] > POS_INDEX[p]);
}

/** Every (kind, hero, villain) combination that must have a chart. */
export function allScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const hero of POSITIONS) {
    if (hero !== 'BB') out.push({ kind: 'rfi', hero });
    for (const villain of positionsBefore(hero)) {
      out.push({ kind: 'vs_open', hero, villain });
      out.push({ kind: 'vs_4bet', hero, villain });
    }
    for (const villain of positionsAfter(hero)) {
      out.push({ kind: 'vs_3bet', hero, villain });
      out.push({ kind: 'vs_5bet', hero, villain });
    }
    if (POS_INDEX[hero] >= 2) out.push({ kind: 'cold_4bet', hero });
    // 림프는 앞자리가 한 명이라도 있어야 가능합니다(UTG 제외). 차트는 hero 만으로 갈립니다 —
    // 어느 자리에서 림프했는지로 레인지를 나누는 출처가 없습니다.
    if (POS_INDEX[hero] >= 1) out.push({ kind: 'vs_limp', hero });
  }
  return out;
}

/** Human-readable Korean title for a scenario, e.g. "BTN · CO 오픈에 대응". */
export function scenarioTitle(s: Scenario): string {
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return `${s.hero} · 앞에서 모두 폴드`;
    case 'vs_open':
      return `${s.hero} · ${v} 오픈에 대응`;
    case 'vs_3bet':
      return `${s.hero} 오픈 → ${v} 3벳`;
    case 'vs_4bet':
      return `${v} 오픈 → ${s.hero} 3벳 → ${v} 4벳`;
    case 'vs_5bet':
      return `${s.hero} 오픈 → ${v} 3벳 → ${s.hero} 4벳 → ${v} 올인`;
    case 'cold_4bet':
      // 차트가 두 상대를 구분하지 않으므로 자리 이름(extras)은 쓰지 않습니다 — 상황 문구와 같은 말.
      return `${s.hero} · 앞에서 오픈과 3벳`;
    case 'vs_limp': {
      const l = s.extras?.limper;
      return l ? `${s.hero} · ${l} 림프에 대응` : `${s.hero} · 림프에 대응`;
    }
  }
}

/**
 * 트레이너 무대의 상황 한 줄(해요체 — docs/EXPLAIN_SPEC.md §5.4). 학습자는 '당신'이 아니라 '내'로 부릅니다.
 * 자리 조사는 ko.ts 가 고릅니다(BTN이·BTN은).
 */
export function scenarioSituation(s: Scenario): string {
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return `앞에서 모두 폴드했어요. ${s.hero}, 내 차례예요.`;
    case 'vs_open':
      return `${josa(v ?? '앞', '이/가')} 오픈했어요. ${s.hero}, 내 차례예요.`;
    case 'vs_3bet':
      return `${s.hero}에서 오픈했는데 ${josa(v ?? '뒤', '이/가')} 3벳했어요. 다시 내 차례예요.`;
    case 'vs_4bet':
      return `${v} 오픈에 ${s.hero}에서 3벳했더니 ${josa(v ?? '앞', '이/가')} 4벳했어요.`;
    case 'vs_5bet':
      return `${s.hero} 오픈 → ${v} 3벳 → 내 4벳 → ${v} 올인. 콜할까요?`;
    case 'cold_4bet':
      // 차트가 두 상대를 구분하지 않으므로 자리 이름(extras)은 쓰지 않습니다.
      return `앞에서 오픈과 3벳이 나왔어요. ${s.hero}, 내 차례예요.`;
    case 'vs_limp': {
      const l = s.extras?.limper;
      const who = l ? josa(l, '이/가') : '앞에서 한 명이';
      // 빅블라인드는 폴드가 없다는 걸 상황 문구에서 먼저 말해 줍니다 — 버튼만 보고 헷갈리지 않게.
      if (s.hero === 'BB') return `${who} 림프했어요. BB는 체크 아니면 레이즈예요.`;
      return `${who} 림프했어요. ${s.hero}, 내 차례예요.`;
    }
  }
}

/** Is hero in position (acts last postflop) against villain? Blinds are always OOP vs non-blinds. */
export function heroInPosition(hero: Pos, villain: Pos): boolean {
  // Postflop order: SB, BB, UTG, HJ, CO, BTN. Later acts = in position.
  const postflop: Pos[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
  return postflop.indexOf(hero) > postflop.indexOf(villain);
}
