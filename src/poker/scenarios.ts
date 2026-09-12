import { POSITIONS, POS_INDEX, type Pos, type Scenario, type ScenarioKind } from './types';

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
  }
  return out;
}

/** Human-readable Korean title for a scenario, e.g. "BTN · CO 오픈에 대응". */
export function scenarioTitle(s: Scenario): string {
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return `${s.hero} · 앞에 아무도 없음 (오픈?)`;
    case 'vs_open':
      return `${s.hero} · ${v} 오픈에 대응`;
    case 'vs_3bet':
      return `${s.hero} 오픈 → ${v} 3벳`;
    case 'vs_4bet':
      return `${v} 오픈 → ${s.hero} 3벳 → ${v} 4벳`;
    case 'vs_5bet':
      return `${s.hero} 오픈 → ${v} 3벳 → ${s.hero} 4벳 → ${v} 올인`;
    case 'cold_4bet': {
      const o = s.extras?.opener ?? '앞';
      const t = s.extras?.threeBettor ?? '앞';
      return `${o} 오픈 → ${t} 3벳 → ${s.hero} 차례`;
    }
  }
}

/** Short one-line situation description in Korean (used on the trainer stage). */
export function scenarioSituation(s: Scenario): string {
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return s.hero === 'SB' ? '앞에서 모두 폴드. SB인 당신 차례입니다.' : `앞에서 모두 폴드. ${s.hero}인 당신 차례입니다.`;
    case 'vs_open':
      return `${v}가 오픈 레이즈. ${s.hero}인 당신 차례입니다.`;
    case 'vs_3bet':
      return `${s.hero}에서 오픈했는데 ${v}가 3벳. 다시 당신 차례입니다.`;
    case 'vs_4bet':
      return `${v} 오픈에 ${s.hero}에서 3벳했는데 ${v}가 4벳. 당신 차례입니다.`;
    case 'vs_5bet':
      return `${s.hero} 오픈 → ${v} 3벳 → 당신 4벳 → ${v}가 올인. 콜할까요?`;
    case 'cold_4bet': {
      const o = s.extras?.opener ?? '앞';
      const t = s.extras?.threeBettor ?? '앞';
      return `${o} 오픈, ${t} 3벳. 아직 아무 액션도 하지 않은 ${s.hero}인 당신 차례입니다.`;
    }
  }
}

/** Is hero in position (acts last postflop) against villain? Blinds are always OOP vs non-blinds. */
export function heroInPosition(hero: Pos, villain: Pos): boolean {
  // Postflop order: SB, BB, UTG, HJ, CO, BTN. Later acts = in position.
  const postflop: Pos[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
  return postflop.indexOf(hero) > postflop.indexOf(villain);
}
