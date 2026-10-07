import { getChartCells, getChartDef, hasChart } from '../../src/poker/data';
import { allScenarios, scenarioKey } from '../../src/poker/scenarios';
import { ALL_HANDS, gridHand, parseHandName } from '../../src/poker/hands';
import { fullMix, restAction, AGGRESSION_ORDER, rangeShare } from '../../src/poker/range';
import { isReachable } from '../../src/poker/atlas';
import { classifyHand } from '../../src/poker/explain';
import { RANKS, type Action, type Scenario, type Pos } from '../../src/poker/types';
import { writeFileSync } from 'node:fs';

export interface Slot { hand: string | null; inLine: boolean }
export interface LineDef { id: string; label: string; obj: string; slots: Slot[] }
const rankP = (r: string) => `${r}${'T8763'.includes(r) ? '을' : '를'}`;
const handP = (h: string, p: '는'|'를') => { const c = h.length===2 && '8763'.includes(h[0]); return c ? `${h}${p==='는'?'은':'을'}` : `${h}${p}`; };
const seatP = (p: Pos, x: '는'|'가') => p==='BTN' ? `${p}${x==='는'?'은':'이'}` : `${p}${x}`;
export function lineOf(hand: string): LineDef {
  const info = parseHandName(hand);
  if (info.kind === 'pair') return { id: 'pair', label: '포켓페어', obj: '포켓페어를', slots: RANKS.map((_, i) => ({ hand: gridHand(i, i), inLine: true })) };
  if (classifyHand(hand) === 'suited_connector') {
    const slots: Slot[] = [{ hand: null, inLine: false }];
    for (let i = 0; i < 12; i++) slots.push({ hand: gridHand(i, i + 1), inLine: i >= 4 });
    return { id: 'conn', label: '수티드 커넥터', obj: '수티드 커넥터를', slots };
  }
  const hi = RANKS.indexOf(info.high);
  if (info.kind === 'suited') return { id: `s${info.high}`, label: `수티드 ${info.high}`, obj: `수티드 ${rankP(info.high)}`, slots: RANKS.map((_, j) => ({ hand: gridHand(hi, j), inLine: j > hi })) };
  return { id: `o${info.high}`, label: `오프수트 ${info.high}`, obj: `오프수트 ${rankP(info.high)}`, slots: RANKS.map((_, i) => ({ hand: gridHand(i, hi), inLine: i > hi })) };
}
const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);
const VERB: Record<Action, string> = { fold: '폴드', check: '체크', call: '콜', raise: '오픈', threebet: '3벳', fourbet: '4벳', allin: '올인' };
const verb = (a: Action, s: Scenario) => (a === 'raise' && s.kind === 'vs_limp' ? '레이즈' : VERB[a]);
export function subject(s: Scenario): string {
  const H = seatP(s.hero, '는'); const v = s.villain;
  switch (s.kind) {
    case 'rfi': return H;
    case 'vs_open': return `${H} ${v} 오픈에`;
    case 'vs_3bet': return `${H} ${v} 3벳에`;
    case 'vs_4bet': return `${H} ${v} 4벳에`;
    case 'vs_5bet': return `${H} ${v} 올인에`;
    case 'cold_4bet': return `${H} 앞에서 3벳이 나오면`;
    case 'vs_limp': return `${H} 림프에`;
  }
}
export interface Cell { hand: string; p: Action; w: number; full: boolean; mix: {action:Action;weight:number}[] }
export function weightWord(c: Cell, rest: Action): string {
  if (c.full) return '';
  if (c.w >= 0.6) return '주로';
  const s2 = c.mix[1];
  if (s2 && Math.abs(s2.weight - c.w) < 0.01 && s2.action !== rest) return 'tie';
  return c.p === rest ? '절반은' : '절반만';
}
export function cellsOf(s: Scenario, L: LineDef): Cell[] {
  const cells = getChartCells(s);
  return L.slots.filter(x => x.inLine && x.hand && isReachable(s, x.hand).ok).map(x => {
    const mix = fullMix(cells[x.hand!]); const p = mix[0]?.action ?? 'fold'; const w = mix[0]?.weight ?? 1;
    return { hand: x.hand!, p, w, full: w >= 0.999, mix };
  });
}
function list(hs: string[], all: string[]): string {
  // compress consecutive (in line order) runs >=3 into X~Y
  const idx = hs.map(h => all.indexOf(h));
  const groups: string[][] = []; let cur: string[] = [];
  idx.forEach((i, k) => { if (k>0 && i === idx[k-1]+1) cur.push(hs[k]); else { if (cur.length) groups.push(cur); cur=[hs[k]]; } });
  if (cur.length) groups.push(cur);
  return groups.map(g => g.length >= 3 ? `${g[0]}~${g[g.length-1]}` : g.join('·')).join('·');
}
interface Run { a: Action; cells: Cell[] }
export function runsOf(cs: Cell[]): Run[] { const out: Run[] = []; for (const c of cs) { const l = out[out.length-1]; if (l && l.a === c.p) l.cells.push(c); else out.push({ a: c.p, cells: [c] }); } return out; }
const actObj = (w: string) => `${w}${/[즈크드]$/.test(w) ? '를' : '을'}`;
const actWith = (w: string) => `${w}${/[즈크드]$/.test(w) ? '와' : '과'}`;
function lineSentence0(s: Scenario, L: LineDef, topic = false): { text: string; frame: string } | null {
  const rest = restAction(getChartDef(s));
  const cs = cellsOf(s, L); if (!cs.length) return null;
  const S = topic ? '' : subject(s); const O = topic ? L.obj.replace(/를$/, '는').replace(/을$/, '은') : L.obj; const Q = `${L.label} 중`; const V = (a: Action) => verb(a, s);
  const runs = runsOf(cs);
  const cont = runs.filter(r => r.a !== rest);
  const mono = cs.every((c, i) => i === 0 || agg(c.p) <= agg(cs[i-1].p));
  const restCells = cs.filter(c => c.p === rest);
  const names = cs.map(c => c.hand);
  const W = (c: Cell) => weightWord(c, rest);
  // mixed-cell description; returns [subjectPart, verbStem] e.g. ['KJo는 절반만', '오픈'] or tie
  const mixedDesc = (a: Action, T: Cell[], end: '해요' | '하고'): string => {
    const ws = T.map(W);
    const uni = ws.every(x => x === ws[0]);
    const tieEnd = end === '해요' ? '섞어요' : '섞고';
    if (uni && ws[0] === 'tie') {
      const who = T.length === 1 ? handP(T[0].hand, '는') : T.length === 2 ? `${T[0].hand}·${handP(T[1].hand, '는')}` : `${T[0].hand}부터 ${T[T.length-1].hand}까지는`;
      return `${who} ${actWith(V(T[0].mix[0].action))} ${actObj(V(T[0].mix[1].action))} 반반 ${tieEnd}`;
    }
    if (uni) {
      const who = T.length === 1 ? handP(T[0].hand, '는') : T.length === 2 ? `${T[0].hand}·${handP(T[1].hand, '는')}` : `${T[0].hand}부터 ${T[T.length-1].hand}까지는`;
      return `${who} ${ws[0]} ${V(a)}${end}`;
    }
    if (T.length <= 3 && !ws.includes('tie')) {
      const groups: { hs: string[]; w: string }[] = [];
      T.forEach((c, i) => { const g = groups[groups.length - 1]; if (g && g.w === ws[i]) g.hs.push(c.hand); else groups.push({ hs: [c.hand], w: ws[i] }); });
      return `${groups.map(g => `${g.hs.slice(0, -1).map(h => h + '·').join('')}${handP(g.hs[g.hs.length - 1], '는')} ${g.w}`).join(', ')} ${V(a)}${end}`;
    }
    return `${T[0].hand}부터는 ${actObj(V(a))} ${tieEnd}`;
  };
  if (!cont.length) {
    const minor = cs.filter(c => c.mix.some(m => m.action !== rest && m.weight > 0.001));
    const acts = new Set(minor.map(c => c.mix.find(m => m.action !== rest)!.action));
    if (minor.length && minor.length <= 3 && acts.size === 1)
      return { frame: 'P0h', text: `${S} ${O} ${list(minor.map(c => c.hand), names)}만 가끔 ${V([...acts][0])}하고, 나머지는 ${V(rest)}해요.` };
    return { frame: 'P0', text: `${S} ${O} 전부 ${V(rest)}해요.` };
  }
  const parts = (r: Run) => {
    const li = r.cells.map(c => c.full).lastIndexOf(true);
    return { lf: li >= 0 ? r.cells[li] : null, ff: r.cells.find(c => c.full) ?? null, tail: li >= 0 ? r.cells.slice(li + 1) : r.cells };
  };
  const checkTail = rest === 'check' && restCells.length ? `${restCells[0].hand}부터는 체크해요` : '';
  if (mono && cont.length === 1) {
    const r = cont[0]; const { lf, tail } = parts(r);
    if (lf) {
      if (!restCells.length && !tail.length) return { frame: 'P1', text: `${S} ${O} 전부 ${V(r.a)}해요.` };
      const head = lf.hand === cs[0].hand ? `${lf.hand}만` : `${lf.hand}까지`;
      if (tail.length) return { frame: 'P2m', text: `${S} ${O} ${head} ${V(r.a)}하고, ${mixedDesc(r.a, tail, '해요')}.` };
      if (checkTail) return { frame: 'P2c', text: `${S} ${O} ${head} ${V(r.a)}하고, ${checkTail}.` };
      return { frame: 'P2', text: `${S} ${O} ${head} ${V(r.a)}해요.` };
    }
    const d = mixedDesc(r.a, tail, '하고');
    return { frame: 'P2h', text: restCells.length ? `${S} ${Q} ${d}, 나머지는 ${V(rest)}해요.` : `${S} ${Q} ${d.replace(/하고$/, '해요').replace(/섞고$/, '섞어요')}.` };
  }
  if (mono) {
    const [r1, r2] = cont; const p1 = parts(r1), p2 = parts(r2);
    if (p1.lf && p2.lf) {
      const single1 = r1.cells.length === 1 && r1.cells[0].full;
      const h1 = single1 ? `${p1.lf.hand}만` : `${p1.lf.hand}까지`;
      const toEnd = !restCells.length && !p2.tail.length && r2.cells.every(c => c.full) && cs[cs.length-1] === r2.cells[r2.cells.length-1];
      const h2 = toEnd ? `${p2.ff!.hand}부터는 전부` : `${p2.lf.hand}까지`;
      return { frame: 'P3', text: checkTail ? `${S} ${O} ${h1} ${V(r1.a)}하고, ${h2} ${V(r2.a)}하고, ${checkTail}.` : `${S} ${O} ${h1} ${V(r1.a)}하고, ${h2} ${V(r2.a)}해요.` };
    }
    const desc = (r: Run, pr: ReturnType<typeof parts>, end: '해요' | '하고') =>
      pr.lf ? (r.cells.length === 1 ? `${handP(pr.lf.hand, '는')} ${V(r.a)}${end}` : `${pr.lf.hand}까지는 ${V(r.a)}${end}`) : mixedDesc(r.a, r.cells, end);
    return { frame: 'P3h', text: `${S} ${Q} ${desc(r1, p1, '하고')}, ${desc(r2, p2, '해요')}.` };
  }
  const top = cs.reduce((m, c) => (agg(c.p) > agg(m) ? c.p : m), cs[0].p);
  const set = list(cs.filter(c => c.p === top).map(c => c.hand), names);
  const others = [...new Set(cs.filter(c => c.p !== top && c.p !== rest).map(c => c.p))];
  const head = `${S} ${O} ${set}만 ${V(top)}`;
  if (others.length !== 1) return { frame: 'P4', text: `${head}해요.` };
  const c = others[0];
  if (!restCells.length) return { frame: 'P4', text: `${head}하고, 나머지는 전부 ${V(c)}해요.` };
  let li = -1;
  for (let i = 0; i < cs.length; i++) { if (cs[i].p !== top && cs[i].p !== c) break; if (cs[i].p === c && cs[i].full) li = i; }
  if (li >= 0) return { frame: 'P4', text: `${head}하고, ${cs[li].hand}까지 ${V(c)}해요.` };
  return { frame: 'P4', text: `${head}하고, ${list(cs.filter(x => x.p === c).map(x => x.hand), names)}는 ${V(c)}해요.` };
}
export function lineSentence(s: Scenario, L: LineDef, topic = false): { text: string; frame: string } | null {
  const r0 = lineSentence0(s, L, topic); const r = r0 && { ...r0, text: r0.text.replace(/^ /, '') }; if (!r) return r;
  if (emWidth(r.text) <= 42) return r;
  const t1 = r.text.replace(`${L.label} 중 `, '').replace(`${L.obj} `, '');
  if (emWidth(t1) <= 42) return { frame: r.frame + '-noL', text: t1 };
  const cut = r.text.slice(0, r.text.indexOf(', ')).replace(/하고$/, '해요').replace(/섞고$/, '섞어요') + '.';
  return { frame: r.frame + '-cut', text: cut };
}
export function emWidth(t: string): number { let w = 0; for (const ch of t) { if (/[가-힣]/.test(ch)) w += 1; else if (/[A-Za-z0-9]/.test(ch)) w += 0.6; else w += 0.3; } return w; }

if (process.argv[2] === 'dump') {
  const lines = new Map<string, LineDef>(); for (const h of ALL_HANDS) { const L = lineOf(h); lines.set(L.id, L); }
  const out: string[] = []; const frames = new Map<string, number>(); let maxW = 0; let over = 0; let nulls = 0;
  for (const s of allScenarios().filter(hasChart)) for (const L of lines.values()) {
    const r = lineSentence(s, L); if (!r) { nulls++; continue; }
    frames.set(r.frame, (frames.get(r.frame) ?? 0) + 1);
    const w = emWidth(r.text); maxW = Math.max(maxW, w); if (w > 42) over++;
    out.push(`${scenarioKey(s)}\t${L.id}\t${r.frame}\t${w.toFixed(1)}\t${r.text}`);
  }
  writeFileSync('all.tsv', out.join('\n'));
  console.log('lines', lines.size, 'sentences', out.length, 'null', nulls, frames, 'maxW', maxW, 'over42', over);
}
