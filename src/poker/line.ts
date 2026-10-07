import { isReachable } from './atlas';
import { getChartCells, getChartDef } from './data';
import { classifyHand } from './explain';
import { gridHand, parseHandName } from './hands';
import { actWord, emWidth, josa, verb } from './ko';
import { AGGRESSION_ORDER, fullMix, restAction } from './range';
import { RANKS, type Action, type HandName, type Rank, type Scenario, type ScenarioKind } from './types';

/*
 * 줄 하나, 문장 하나 — docs/EXPLAIN_SPEC.md §3.
 *
 * 리빌 슬롯이 보여 주는 건 패가 아니라 "이 패가 속한 차트 줄"입니다. 문장은 (상황, 줄)의 속성이라
 * 같은 줄의 패는 전부 같은 문장을 받고 링만 움직입니다. 카드를 넘길 때마다 같은 덩어리를 한 번 더
 * 떠올리게 하는 것이 목적입니다.
 *
 * 문장은 "구조 먼저"입니다. 틀(frame)과 주장(claims)을 먼저 정하고 글자는 마지막에 렌더합니다.
 * tests/line.test.ts 가 1,089개 문장의 claims 를 차트에서 다시 계산해 대조하고,
 * tests/line.golden.test.ts 가 글자를 한 자도 안 틀리게 고정합니다(참고 구현 scripts/reference/line-gen.ts 와 같은 출력).
 */

export type MixItem = { action: Action; weight: number };

export type LineId = 'pair' | 'conn' | `s${Rank}` | `o${Rank}`;

export interface LineSlot {
  /** 13×13 그리드에서 이 칸 위치의 패. 커넥터 줄의 j=0 은 빈칸(null). */
  hand: HandName | null;
  /** 이 줄의 칸인가. false 면 유령 칸(다른 줄의 위치)이거나 빈칸입니다. */
  inLine: boolean;
  /** 스트립 라벨: 페어 'AA', 커넥터 'T9', 수티드·오프수트 줄은 킥커 랭크. 빈칸은 ''. */
  label: string;
}

export interface LineDef {
  id: LineId;
  /** '포켓페어' · '수티드 커넥터' · '수티드 K' · '오프수트 8' */
  label: string;
  /** 13칸 */
  slots: LineSlot[];
}

export type WeightWord = 'full' | '주로' | '절반만' | '반반' | '절반은';

export interface LineCell {
  hand: HandName;
  /** 13칸 중 위치 */
  slot: number;
  /** 1순위 액션(primaryAction 과 같은 동점 규칙: 공격적인 쪽) */
  p: Action;
  /** p 의 비중 */
  w: number;
  full: boolean;
  mixList: MixItem[];
  word: WeightWord;
}

export interface LineRun {
  action: Action;
  cells: LineCell[];
}

export type LineClaim =
  | { t: 'all'; action: Action } // 전부 a
  | { t: 'upto'; from: HandName | null; to: HandName; action: Action } // (from부터) to까지 a, to full, 다음 칸 full-a 아님
  | { t: 'only'; hands: HandName[]; action: Action } // p = a 인 칸 = 정확히 hands
  | { t: 'toEnd'; from: HandName; action: Action } // from부터 끝까지 p = a (full 은 frame 이 요구할 때만 — 아래 lineSentence 참고)
  | { t: 'weight'; hand: HandName; action: Action; word: WeightWord }
  | { t: 'minor'; hands: HandName[]; action: Action } // 모두 p = rest, a > 0 인 칸 = 정확히 hands
  | { t: 'rest'; except: HandName[]; action: Action }; // 나머지 전부 p = action

export type LineFrame = 'P0' | 'P0h' | 'P1' | 'P2' | 'P2c' | 'P2m' | 'P2h' | 'P3' | 'P3h' | 'P4';

export interface LineSentence {
  text: string;
  frame: LineFrame;
  claims: LineClaim[];
  /** 폭 폴백(§3.4): noLabel = 줄 이름을 뺌, cut = 둘째 절을 버림 */
  fallback: null | 'noLabel' | 'cut';
}

export type StripRole = 'cell' | 'unreachable' | 'ghost' | 'empty';

export interface StripSlot {
  role: StripRole;
  hand: HandName | null;
  label: string;
  /** 도달 가능한 줄 칸이면 fullMix — 배경은 UI 가 RangeGrid.cellBackground 로 칠합니다. 나머지는 null. */
  mix: MixItem[] | null;
}

/** LineStrip 의 props. slots 13개, 이 패의 링, 경계 막대. */
export interface StripView {
  slots: StripSlot[];
  /** 이 패의 slot */
  ring: number;
  boundaryAfter: number | null;
}

/* ------------------------------------------------------------------ */
/* 줄 정의                                                               */
/* ------------------------------------------------------------------ */

const lineCache = new Map<HandName, LineDef>();

/**
 * 패 → 줄(§3.2). 페어는 대각선, classifyHand 가 suited_connector(T9s~32s)인 패는 커넥터 대각선,
 * 그 밖의 수티드는 높은 카드 행, 오프수트는 높은 카드 열을 가로로 눕힌 것. 같은 패는 모든 상황에서 같은 줄입니다.
 */
export function lineOf(hand: HandName): LineDef {
  const cached = lineCache.get(hand);
  if (cached) return cached;
  const info = parseHandName(hand);
  let def: LineDef;
  if (info.kind === 'pair') {
    def = { id: 'pair', label: '포켓페어', slots: RANKS.map((_, i) => ({ hand: gridHand(i, i), inLine: true, label: gridHand(i, i) })) };
  } else if (classifyHand(hand) === 'suited_connector') {
    // j=0 은 빈칸, j≥1 은 대각선 바로 위 칸. AKs·KQs·QJs·JTs 는 유령 칸 — "AKs도 커넥터"로 읽히지 않게.
    const slots: LineSlot[] = [{ hand: null, inLine: false, label: '' }];
    for (let i = 0; i < 12; i++) {
      const h = gridHand(i, i + 1);
      slots.push({ hand: h, inLine: i >= 4, label: h.slice(0, 2) });
    }
    def = { id: 'conn', label: '수티드 커넥터', slots };
  } else {
    const hi = RANKS.indexOf(info.high);
    const suited = info.kind === 'suited';
    def = {
      id: `${suited ? 's' : 'o'}${info.high}`,
      label: `${suited ? '수티드' : '오프수트'} ${info.high}`,
      slots: RANKS.map((r, j) => ({ hand: suited ? gridHand(hi, j) : gridHand(j, hi), inLine: j > hi, label: r })),
    };
  }
  lineCache.set(hand, def);
  return def;
}

/* ------------------------------------------------------------------ */
/* 칸 · run · 비중어                                                     */
/* ------------------------------------------------------------------ */

const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);
const restOf = (s: Scenario): Action => restAction(getChartDef(s));

/**
 * 비중어(§2.2). full(≥0.999) · 주로(1순위 ≥ 0.6) · 반반(1·2순위 동점이고 2순위가 rest 아님) ·
 * 절반만(그 밖이고 1순위가 계속하는 액션) · 절반은(그 밖이고 1순위가 rest).
 */
export function weightWord(mixList: MixItem[], rest: Action): WeightWord {
  const w = mixList[0]?.weight ?? 1;
  if (w >= 0.999) return 'full';
  if (w >= 0.6) return '주로';
  const s2 = mixList[1];
  if (s2 && Math.abs(s2.weight - w) < 0.01 && s2.action !== rest) return '반반';
  return (mixList[0]?.action ?? 'fold') === rest ? '절반은' : '절반만';
}

/** 캡슐 라벨(§3.5). 색은 1순위 액션, 글자는 비중어 + 버튼 단어. */
export function capsuleLabel(mixList: MixItem[], rest: Action, kind: ScenarioKind): string {
  const a = mixList[0]?.action ?? 'fold';
  const act = actWord(a, kind);
  switch (weightWord(mixList, rest)) {
    case 'full':
      return act;
    case '주로':
      return `주로 ${act}`;
    case '절반만':
      return `절반만 ${act}`;
    case '반반':
      return `${act}·${actWord(mixList[1].action, kind)} 반반`;
    case '절반은':
      return `절반은 ${act}`;
  }
}

/** 줄 칸 중 도달 가능한 칸만, 스트립 순서(위 킥커 → 아래)로. */
export function lineCells(s: Scenario, line: LineDef): LineCell[] {
  const cells = getChartCells(s);
  const rest = restOf(s);
  const out: LineCell[] = [];
  line.slots.forEach((slot, i) => {
    if (!slot.inLine || !slot.hand || !isReachable(s, slot.hand).ok) return;
    const mixList = fullMix(cells[slot.hand]);
    const p = mixList[0]?.action ?? 'fold';
    const w = mixList[0]?.weight ?? 1;
    out.push({ hand: slot.hand, slot: i, p, w, full: w >= 0.999, mixList, word: weightWord(mixList, rest) });
  });
  return out;
}

/** 1순위가 같은 칸이 이어진 구간. */
export function lineRuns(cells: LineCell[]): LineRun[] {
  const out: LineRun[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && last.action === c.p) last.cells.push(c);
    else out.push({ action: c.p, cells: [c] });
  }
  return out;
}

/**
 * 1순위 공격성이 위에서 아래로 줄어들기만 하는가. 계속 비중만 보는 옛 rowBoundary.monotone 은
 * 1순위가 번갈아 나오는 9개 줄(수티드 A 의 3벳/콜 교대 등)을 단조로 잘못 봤습니다.
 */
export function isMonotone(cells: LineCell[]): boolean {
  return cells.every((c, i) => i === 0 || agg(c.p) <= agg(cells[i - 1].p));
}

/* ------------------------------------------------------------------ */
/* 문장                                                                  */
/* ------------------------------------------------------------------ */

/** 주어 S(§3.4). 대응 상황에는 내 자리를 반드시 넣습니다 — 같은 상대·같은 줄이라도 SB 와 BB 의 답이 다릅니다. */
function subject(s: Scenario): string {
  const H = josa(s.hero, '은/는');
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return H;
    case 'vs_open':
      return `${H} ${v} 오픈에`;
    case 'vs_3bet':
      return `${H} ${v} 3벳에`;
    case 'vs_4bet':
      return `${H} ${v} 4벳에`;
    case 'vs_5bet':
      return `${H} ${v} 올인에`;
    case 'cold_4bet':
      return `${H} 앞에서 3벳이 나오면`;
    case 'vs_limp':
      return `${H} 림프에`;
  }
}

/** 패 목록: 줄 순서로 연속 3칸 이상이면 X~Y, 2칸은 X·Y, 묶음 사이는 ·. */
function handList(hands: HandName[], order: HandName[]): string {
  const idx = hands.map((h) => order.indexOf(h));
  const groups: HandName[][] = [];
  let cur: HandName[] = [];
  idx.forEach((i, k) => {
    if (k > 0 && i === idx[k - 1] + 1) cur.push(hands[k]);
    else {
      if (cur.length) groups.push(cur);
      cur = [hands[k]];
    }
  });
  if (cur.length) groups.push(cur);
  return groups.map((g) => (g.length >= 3 ? `${g[0]}~${g[g.length - 1]}` : g.join('·'))).join('·');
}

/** 두세 칸을 부르는 주제어: 'KJo는' · 'ATo·A9o는' · 'A3s부터 A2s까지는'. */
function who(T: LineCell[]): string {
  if (T.length === 1) return josa(T[0].hand, '은/는');
  if (T.length === 2) return `${T[0].hand}·${josa(T[1].hand, '은/는')}`;
  return `${T[0].hand}부터 ${T[T.length - 1].hand}까지는`;
}

interface Built {
  text: string;
  frame: LineFrame;
  claims: LineClaim[];
}

function build(s: Scenario, line: LineDef, topic: boolean): Built | null {
  const kind = s.kind;
  const rest = restOf(s);
  const cs = lineCells(s, line);
  if (!cs.length) return null;
  const obj = josa(line.label, '을/를');
  // 형제 줄(§4.2-②)은 주어를 빼고 목적어를 주제어로: '수티드 8은', '오프수트 A는'.
  const S = topic ? '' : subject(s);
  const O = topic ? josa(line.label, '은/는') : obj;
  const Q = `${line.label} 중`;
  const V = (a: Action, end: '해요' | '하고') => verb(a, kind, end);
  const W = (c: LineCell) => c.word;
  const runs = lineRuns(cs);
  const cont = runs.filter((r) => r.action !== rest);
  const mono = isMonotone(cs);
  const restCells = cs.filter((c) => c.p === rest);
  const names = cs.map((c) => c.hand);
  const weightClaims = (T: LineCell[]): LineClaim[] => T.map((c) => ({ t: 'weight', hand: c.hand, action: c.p, word: c.word }));

  /** 섞인 칸들의 서술 〈T〉/〈T'〉(§3.4). end 가 '하고'면 'T′' 꼴. */
  const mixedDesc = (a: Action, T: LineCell[], end: '해요' | '하고'): string => {
    const ws = T.map(W);
    const uni = ws.every((x) => x === ws[0]);
    const tieEnd = end === '해요' ? '섞어요' : '섞고';
    if (uni && ws[0] === '반반') {
      return `${who(T)} ${josa(actWord(T[0].mixList[0].action, kind), '과/와')} ${josa(actWord(T[0].mixList[1].action, kind), '을/를')} 반반 ${tieEnd}`;
    }
    if (uni) return `${who(T)} ${ws[0]} ${V(a, end)}`;
    if (T.length <= 3 && !ws.includes('반반')) {
      const groups: Array<{ hs: HandName[]; w: WeightWord }> = [];
      T.forEach((c, i) => {
        const g = groups[groups.length - 1];
        if (g && g.w === ws[i]) g.hs.push(c.hand);
        else groups.push({ hs: [c.hand], w: ws[i] });
      });
      return `${groups.map((g) => `${g.hs.slice(0, -1).map((h) => `${h}·`).join('')}${josa(g.hs[g.hs.length - 1], '은/는')} ${g.w}`).join(', ')} ${V(a, end)}`;
    }
    // 'X부터는'은 줄 끝까지를 뜻합니다. 섞는 칸 뒤에 다른 칸(예: 순폴드 32s)이 남으면 'X·Y는'/'X부터 Y까지는'으로 끝 칸까지 이름을 댑니다.
    // 참고 구현은 항상 'X부터는'이라 vs_open BB:UTG·BB:HJ 커넥터 줄에서 100% 폴드인 32s까지 콜을 섞는다고 읽혔습니다.
    const toEnd = T[T.length - 1] === cs[cs.length - 1];
    return `${toEnd ? `${T[0].hand}부터는` : who(T)} ${josa(actWord(a, kind), '을/를')} ${tieEnd}`;
  };

  // P0 · P0h: 계속 run 없음
  if (!cont.length) {
    const minor = cs.filter((c) => c.mixList.some((m) => m.action !== rest && m.weight > 0.001));
    const acts = new Set(minor.map((c) => c.mixList.find((m) => m.action !== rest)!.action));
    if (minor.length && minor.length <= 3 && acts.size === 1) {
      const a = [...acts][0];
      const hs = minor.map((c) => c.hand);
      return {
        frame: 'P0h',
        text: `${S} ${O} ${handList(hs, names)}만 가끔 ${V(a, '하고')}, 나머지는 ${V(rest, '해요')}.`,
        claims: [{ t: 'minor', hands: hs, action: a }],
      };
    }
    return { frame: 'P0', text: `${S} ${O} 전부 ${V(rest, '해요')}.`, claims: [{ t: 'all', action: rest }] };
  }

  const parts = (r: LineRun) => {
    const li = r.cells.map((c) => c.full).lastIndexOf(true);
    return { lf: li >= 0 ? r.cells[li] : null, ff: r.cells.find((c) => c.full) ?? null, tail: li >= 0 ? r.cells.slice(li + 1) : r.cells };
  };
  // BB 림프 대응(rest = check): 계속 구간 뒤의 체크 칸을 이름으로 부릅니다.
  const checkTail = rest === 'check' && restCells.length ? `${restCells[0].hand}부터는 체크해요` : '';
  const checkClaims: LineClaim[] = checkTail ? [{ t: 'toEnd', from: restCells[0].hand, action: 'check' }] : [];
  const fromOf = (r: LineRun): HandName | null => (r.cells[0] === cs[0] ? null : r.cells[0].hand);

  if (mono && cont.length === 1) {
    const r = cont[0];
    const { lf, tail } = parts(r);
    if (lf) {
      if (!restCells.length && !tail.length) return { frame: 'P1', text: `${S} ${O} 전부 ${V(r.action, '해요')}.`, claims: [{ t: 'all', action: r.action }] };
      // '까지'는 full 칸에만 붙입니다. 첫 칸이면 '만'.
      const head = lf.hand === cs[0].hand ? `${lf.hand}만` : `${lf.hand}까지`;
      const upto: LineClaim = { t: 'upto', from: null, to: lf.hand, action: r.action };
      if (tail.length) return { frame: 'P2m', text: `${S} ${O} ${head} ${V(r.action, '하고')}, ${mixedDesc(r.action, tail, '해요')}.`, claims: [upto, ...weightClaims(tail)] };
      if (checkTail) return { frame: 'P2c', text: `${S} ${O} ${head} ${V(r.action, '하고')}, ${checkTail}.`, claims: [upto, ...checkClaims] };
      return { frame: 'P2', text: `${S} ${O} ${head} ${V(r.action, '해요')}.`, claims: [upto] };
    }
    const d = mixedDesc(r.action, tail, '하고');
    const claims: LineClaim[] = weightClaims(tail);
    if (restCells.length) claims.push({ t: 'rest', except: r.cells.map((c) => c.hand), action: rest });
    return {
      frame: 'P2h',
      text: restCells.length ? `${S} ${Q} ${d}, 나머지는 ${V(rest, '해요')}.` : `${S} ${Q} ${d.replace(/하고$/, '해요').replace(/섞고$/, '섞어요')}.`,
      claims,
    };
  }

  if (mono) {
    const [r1, r2] = cont;
    const p1 = parts(r1);
    const p2 = parts(r2);
    if (p1.lf && p2.lf) {
      const single1 = r1.cells.length === 1 && r1.cells[0].full;
      const h1 = single1 ? `${p1.lf.hand}만` : `${p1.lf.hand}까지`;
      const toEnd = !restCells.length && !p2.tail.length && r2.cells.every((c) => c.full) && cs[cs.length - 1] === r2.cells[r2.cells.length - 1];
      const h2 = toEnd ? `${p2.ff!.hand}부터는 전부` : `${p2.lf.hand}까지`;
      const claims: LineClaim[] = [
        { t: 'upto', from: fromOf(r1), to: p1.lf.hand, action: r1.action },
        toEnd ? { t: 'toEnd', from: p2.ff!.hand, action: r2.action } : { t: 'upto', from: fromOf(r2), to: p2.lf.hand, action: r2.action },
        ...checkClaims,
      ];
      return {
        frame: 'P3',
        text: checkTail
          ? `${S} ${O} ${h1} ${V(r1.action, '하고')}, ${h2} ${V(r2.action, '하고')}, ${checkTail}.`
          : `${S} ${O} ${h1} ${V(r1.action, '하고')}, ${h2} ${V(r2.action, '해요')}.`,
        claims,
      };
    }
    const desc = (r: LineRun, pr: ReturnType<typeof parts>, end: '해요' | '하고'): { text: string; claims: LineClaim[] } =>
      pr.lf
        ? {
            text: r.cells.length === 1 ? `${josa(pr.lf.hand, '은/는')} ${V(r.action, end)}` : `${pr.lf.hand}까지는 ${V(r.action, end)}`,
            claims: [{ t: 'upto', from: fromOf(r), to: pr.lf.hand, action: r.action }],
          }
        : { text: mixedDesc(r.action, r.cells, end), claims: weightClaims(r.cells) };
    const d1 = desc(r1, p1, '하고');
    const d2 = desc(r2, p2, '해요');
    return { frame: 'P3h', text: `${S} ${Q} ${d1.text}, ${d2.text}.`, claims: [...d1.claims, ...d2.claims] };
  }

  // P4: 단조롭지 않은 줄(수티드 A 휠 섬, BB 커넥터). 제일 공격적인 1순위 칸을 이름으로 부릅니다.
  const top = cs.reduce((m, c) => (agg(c.p) > agg(m) ? c.p : m), cs[0].p);
  const topHands = cs.filter((c) => c.p === top).map((c) => c.hand);
  const head = `${S} ${O} ${handList(topHands, names)}만 ${actWord(top, kind)}`;
  const onlyTop: LineClaim = { t: 'only', hands: topHands, action: top };
  const others = [...new Set(cs.filter((c) => c.p !== top && c.p !== rest).map((c) => c.p))];
  if (others.length !== 1) return { frame: 'P4', text: `${head}해요.`, claims: [onlyTop] };
  const c = others[0];
  if (!restCells.length) return { frame: 'P4', text: `${head}하고, 나머지는 전부 ${V(c, '해요')}.`, claims: [onlyTop, { t: 'rest', except: topHands, action: c }] };
  let li = -1;
  let first = -1;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].p !== top && cs[i].p !== c) break;
    if (cs[i].p === c && first < 0) first = i;
    if (cs[i].p === c && cs[i].full) li = i;
  }
  if (li >= 0) return { frame: 'P4', text: `${head}하고, ${cs[li].hand}까지 ${V(c, '해요')}.`, claims: [onlyTop, { t: 'upto', from: first === 0 ? null : cs[first].hand, to: cs[li].hand, action: c }] };
  const cHands = cs.filter((x) => x.p === c).map((x) => x.hand);
  return { frame: 'P4', text: `${head}하고, ${handList(cHands, names)}는 ${V(c, '해요')}.`, claims: [onlyTop, { t: 'only', hands: cHands, action: c }] };
}

/** 리빌 줄 문장 한도(§2.5). */
export const LINE_MAX_EM = 42;

/**
 * (상황, 줄)의 문장(§3.4). 줄에 도달 칸이 없으면 null.
 * 폭 폴백(결정적): 42em 을 넘으면 (1) 줄 이름(〈O〉/〈Q〉)을 빼고, 그래도 넘으면 (2) 둘째 절을 버립니다.
 */
export function lineSentence(s: Scenario, line: LineDef, opts?: { topic?: boolean }): LineSentence | null {
  const b = build(s, line, !!opts?.topic);
  if (!b) return null;
  const text = b.text.replace(/^ /, '');
  if (emWidth(text) <= LINE_MAX_EM) return { text, frame: b.frame, claims: b.claims, fallback: null };
  const noLabel = text.replace(`${line.label} 중 `, '').replace(`${josa(line.label, '을/를')} `, '');
  if (emWidth(noLabel) <= LINE_MAX_EM) return { text: noLabel, frame: b.frame, claims: b.claims, fallback: 'noLabel' };
  const cut = `${text.slice(0, text.indexOf(', ')).replace(/하고$/, '해요').replace(/섞고$/, '섞어요')}.`;
  // 둘째 절이 맡던 주장은 버립니다 — 첫 절의 주장만 남깁니다(실측 0건이라 보수적으로 첫 claim 하나).
  return { text: cut, frame: b.frame, claims: b.claims.slice(0, 1), fallback: 'cut' };
}

/* ------------------------------------------------------------------ */
/* 스트립                                                                */
/* ------------------------------------------------------------------ */

/**
 * 경계 막대가 붙는 slot(§3.2). 단조 줄이고, 계속하는 칸(p ≠ rest)이 하나 이상 있고,
 * 마지막 계속 칸이 도달 가능한 마지막 줄 칸이 아닐 때만. 단조롭지 않은 줄(P4)에는 막대가 없습니다.
 */
export function boundaryAfter(s: Scenario, line: LineDef): number | null {
  const cs = lineCells(s, line);
  if (!cs.length || !isMonotone(cs)) return null;
  const rest = restOf(s);
  let last = -1;
  cs.forEach((c, i) => {
    if (c.p !== rest) last = i;
  });
  if (last < 0 || last === cs.length - 1) return null;
  return cs[last].slot;
}

/**
 * 경계까지의 거리 꼬리표(§3.1). 단조 줄에서만: 경계 바로 다음 도달 칸이면 '한 칸 밖',
 * 경계 칸(마지막 계속 칸) 자신이면 '마지막 칸'. 오답·부분 정답일 때만 보일지는 UI 가 정합니다.
 */
export function nearMiss(s: Scenario, hand: HandName): '한 칸 밖' | '마지막 칸' | null {
  const line = lineOf(hand);
  const b = boundaryAfter(s, line);
  if (b === null) return null;
  const cs = lineCells(s, line);
  const i = cs.findIndex((c) => c.hand === hand);
  if (i < 0) return null;
  if (cs[i].slot === b) return '마지막 칸';
  if (i > 0 && cs[i - 1].slot === b) return '한 칸 밖';
  return null;
}

/** LineStrip 한 줄의 그리기 재료. 배경색은 UI 가 mix 로 칠합니다(엔진은 React·CSS 를 모릅니다). */
export function stripView(s: Scenario, hand: HandName): StripView {
  const line = lineOf(hand);
  const reach = new Map(lineCells(s, line).map((c) => [c.slot, c] as const));
  const slots: StripSlot[] = line.slots.map((slot, i) => {
    if (!slot.hand) return { role: 'empty', hand: null, label: '', mix: null };
    if (!slot.inLine) return { role: 'ghost', hand: slot.hand, label: slot.label, mix: null };
    const c = reach.get(i);
    return c ? { role: 'cell', hand: slot.hand, label: slot.label, mix: c.mixList } : { role: 'unreachable', hand: slot.hand, label: slot.label, mix: null };
  });
  return { slots, ring: line.slots.findIndex((x) => x.hand === hand), boundaryAfter: boundaryAfter(s, line) };
}
