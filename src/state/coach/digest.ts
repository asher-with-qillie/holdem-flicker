/**
 * 코치 다이제스트 — 저장소에 흩어진 재료를 `CoachDigest` 한 덩어리로 모읍니다. COACH_SPEC §3.
 *
 * 코치 모듈 중 localStorage 를 읽는 곳은 여기 하나뿐입니다. 축(axes.ts)·패턴(patterns.ts)·
 * 문구(copy.ts)를 순수 함수로 남겨 두려고 입출력을 이 파일로 몰았습니다 — 그래야 그쪽 테스트가
 * 저장소를 꾸미지 않고 재료만 넘겨서 돌고, 세 AI 경로가 같은 입력 하나만 보게 됩니다.
 *
 * import 만으로는 저장소도 시계도 건드리지 않습니다(테스트가 plain node 에서 돕니다). 읽기는 전부
 * `buildDigest()` 안에서 일어나고, 저장소가 없거나 깨져 있으면 그냥 빈 다이제스트가 나옵니다 —
 * 코치 탭은 콜드 스타트 화면(SPEC §7)이 따로 있어서 예외를 던질 이유가 없습니다.
 */
import { useMemo } from 'react';

import { classifyHand } from '../../poker/explain';
import { heroInPosition } from '../../poker/scenarios';
import { ACTIONS, POSITIONS, SCENARIO_KINDS, type Action, type Pos, type ScenarioKind } from '../../poker/types';
import { allCards, useSrs, weakSpots, stepForKey, type SrsCard, type WeakSpot } from '../srs';
import { useStats, type Mistake, type Stats } from '../stats';
import { computeAxes } from './axes';
import { findPatterns } from './patterns';
import type { CoachDigest, CoachMistake, SeenRow } from './types';

/** stats.ts 와 같은 키. 저장소를 직접 읽는 이유는 아래 `readStats` 주석에 있습니다. */
const STATS_KEY = 'holdem-flicker.stats.v1';
const DAY = 86_400_000;

/** 화면 목록과 프롬프트가 같이 쓰는 최근 실수 개수. */
const RECENT_LIMIT = 20;
/** 칭찬 한 줄을 뽑을 최소 퀴즈 시도 수. 이보다 적으면 정답률이 우연입니다. */
const GOOD_MIN_ATTEMPTS = 15;
/** grade.ts 가 '부분 정답'으로 쳐 주는 무게. 이 무게의 다른 액션이 있으면 '틀렸다'의 뜻이 흐려집니다. */
const PARTIAL_WEIGHT = 0.4;
const WEAK_SPOT_LIMIT = 3;

const EMPTY_STATS: Stats = { byKind: {}, streak: 0, bestStreak: 0, mistakes: [], total: 0, totalCorrect: 0 };

const ACTION_SET = new Set<string>(ACTIONS);
const KIND_SET = new Set<string>(SCENARIO_KINDS);

/* ------------------------------------------------------------------------------------------------
 * 저장소 읽기
 * ---------------------------------------------------------------------------------------------- */

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** 한 건이라도 모양이 어긋나면 그 건만 버립니다 — 옛 판 데이터 하나 때문에 탭 전체가 비면 안 됩니다. */
function readMistake(v: unknown): Mistake | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const { scenarioId, hand, answer, chosen } = r;
  if (typeof scenarioId !== 'string' || typeof hand !== 'string') return null;
  if (typeof answer !== 'string' || !ACTION_SET.has(answer)) return null;
  if (typeof chosen !== 'string' || !ACTION_SET.has(chosen)) return null;
  return {
    at: num(r.at),
    scenarioId,
    title: typeof r.title === 'string' ? r.title : '',
    hand,
    answer: answer as Action,
    chosen: chosen as Action,
    // 훈련 탭 실수를 나중에 붙였습니다. src 가 없는 옛 기록은 전부 퀴즈에서 나온 것입니다.
    src: r.src === 'train' ? 'train' : 'quiz',
  };
}

/**
 * stats.ts 는 현재 값을 모듈 안에 들고 있지만 훅 밖으로는 내보내지 않습니다. 그래서 저장소를 직접
 * 읽습니다 — `commit()` 이 저장소에 먼저 쓰고 구독자에게 알리므로, 훅이 깨어날 때 저장소는 이미
 * 같은 것을 담고 있습니다.
 */
function readStats(): Stats {
  try {
    const raw = storage()?.getItem(STATS_KEY);
    if (!raw) return EMPTY_STATS;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATS;

    const byKind: Stats['byKind'] = {};
    const rawByKind = parsed.byKind;
    if (rawByKind && typeof rawByKind === 'object') {
      for (const [kind, v] of Object.entries(rawByKind as Record<string, unknown>)) {
        if (!KIND_SET.has(kind) || !v || typeof v !== 'object') continue;
        const cell = v as Record<string, unknown>;
        byKind[kind as ScenarioKind] = { attempts: num(cell.attempts), correct: num(cell.correct) };
      }
    }

    const mistakes: Mistake[] = [];
    if (Array.isArray(parsed.mistakes)) {
      for (const entry of parsed.mistakes) {
        const m = readMistake(entry);
        if (m) mistakes.push(m);
      }
    }

    return {
      byKind,
      streak: num(parsed.streak),
      bestStreak: num(parsed.bestStreak),
      mistakes,
      total: num(parsed.total),
      totalCorrect: num(parsed.totalCorrect),
    };
  } catch {
    return EMPTY_STATS;
  }
}

function readCards(): SrsCard[] {
  try {
    return allCards();
  } catch {
    return [];
  }
}

function readWeakSpots(): WeakSpot[] {
  try {
    return weakSpots(WEAK_SPOT_LIMIT);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * pure() — 부분 정답이 가능한 문제 빼기
 * ---------------------------------------------------------------------------------------------- */

/** 카드키 하나에서 축·패턴이 필요로 하는 것 전부. */
interface KeyInfo {
  /** 정답 말고 무게 0.4 이상인 액션이 또 있으면 false. */
  pure: boolean;
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
  /** 차트가 말하는 정답. `seen` 의 기준선은 이 값으로 셉니다. */
  answer: Action;
}

/**
 * 차트는 앱이 도는 동안 바뀌지 않으므로 모듈 수준에 메모합니다. `stepForKey` 는 차트를 펼쳐
 * 믹스를 만드는 일이라 실수 300건 × 카드 수천 장을 매번 다시 돌리면 탭 진입이 눈에 띄게 늦습니다.
 */
const KEY_INFO = new Map<string, KeyInfo | null>();

function infoFor(key: string): KeyInfo | null {
  const hit = KEY_INFO.get(key);
  if (hit !== undefined) return hit;
  const step = stepForKey(key);
  let info: KeyInfo | null = null;
  if (step) {
    info = {
      pure: !step.mixList.some((x) => x.action !== step.answer && x.weight >= PARTIAL_WEIGHT),
      kind: step.scenario.kind,
      hero: step.scenario.hero,
      answer: step.answer,
    };
    if (step.scenario.villain) info.villain = step.scenario.villain;
  }
  KEY_INFO.set(key, info);
  return info;
}

/* ------------------------------------------------------------------------------------------------
 * 지문
 * ---------------------------------------------------------------------------------------------- */

function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 재료의 지문. AI 응답 캐시 키이자 규칙 코치의 메모 키라서 **같은 재료면 반드시 같은 값**이어야
 * 합니다. `now` 를 섞지 않는 이유가 그것입니다 — 섞으면 탭을 열 때마다 캐시가 빗나가고, L2 경로는
 * 그때마다 사용자 돈을 씁니다.
 *
 * 개수와 최근 시각만으로도 대개 충분하지만 실수 한 줄씩을 전부 접어 넣었습니다. 개수가 그대로인 채
 * 내용만 바뀌는 경우(같은 문제를 다시 틀려 밀려나는 경우)에 지문이 안 바뀌면 조언이 옛날 것으로
 * 굳습니다. 300건을 접는 비용은 무시할 만합니다. 암호학적일 필요는 없어서 FNV-1a 두 벌입니다.
 */
function fingerprint(parts: readonly string[]): string {
  const s = parts.join('');
  return `${fnv1a(s, 2166136261).toString(36)}.${fnv1a(s, 40389).toString(36)}`;
}

/* ------------------------------------------------------------------------------------------------
 * 집계
 * ---------------------------------------------------------------------------------------------- */

interface Agg {
  trials: number;
  foldTrials: number;
  mistakes: number;
}

function bucket<K>(map: Map<K, Agg>, k: K): Agg {
  let a = map.get(k);
  if (!a) map.set(k, (a = { trials: 0, foldTrials: 0, mistakes: 0 }));
  return a;
}

function rowsOf<K>(order: readonly K[], map: Map<K, Agg>): Array<{ key: K; trials: number; mistakes: number; foldAnswerShare: number }> {
  const out: Array<{ key: K; trials: number; mistakes: number; foldAnswerShare: number }> = [];
  for (const key of order) {
    const a = map.get(key);
    if (!a || (a.trials === 0 && a.mistakes === 0)) continue;
    out.push({ key, trials: a.trials, mistakes: a.mistakes, foldAnswerShare: a.trials > 0 ? a.foldTrials / a.trials : 0 });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * buildDigest
 * ---------------------------------------------------------------------------------------------- */

/**
 * 저장소를 한 번 훑어 다이제스트를 만듭니다. `now` 는 `daysAgo` 계산에만 쓰이고 `hash` 에는
 * 들어가지 않습니다.
 */
export function buildDigest(now: number = Date.now()): CoachDigest {
  const stats = readStats();
  const cards = readCards();

  const byKind = new Map<ScenarioKind, Agg>();
  const byHero = new Map<Pos, Agg>();

  // seen — 내가 실제로 답을 낸 문제들. 성향 축의 기준선이자 패턴의 기대 비중 분모입니다.
  const seen: SeenRow[] = [];
  let trials = 0;
  for (const c of cards) {
    const weight = num(c.quizSeen) + num(c.pickSeen);
    if (weight <= 0) continue;
    const info = infoFor(c.key);
    if (!info || !info.pure) continue;
    seen.push({ kind: info.kind, hero: info.hero, answer: info.answer, weight });
    trials += weight;
    const isFold = info.answer === 'fold';
    for (const a of [bucket(byKind, info.kind), bucket(byHero, info.hero)]) {
      a.trials += weight;
      if (isFold) a.foldTrials += weight;
    }
  }

  // M — 분석 집합. 최신순으로 세워 두면 `recentMistakes` 가 앞에서 스무 개만 잘라 쓰면 됩니다.
  const stored = [...stats.mistakes].sort((a, b) => b.at - a.at);
  const mistakes: CoachMistake[] = [];
  let trainCount = 0;
  for (const m of stored) {
    const key = `${m.scenarioId}|${m.hand}`;
    const info = infoFor(key);
    if (!info || !info.pure) continue;
    const src = m.src ?? 'quiz';
    const cm: CoachMistake = {
      hand: m.hand,
      handClass: classifyHand(m.hand),
      kind: info.kind,
      hero: info.hero,
      ip: info.villain ? heroInPosition(info.hero, info.villain) : false,
      answer: m.answer,
      chosen: m.chosen,
      // 미래 시각이 적힌 기록(시계를 되돌린 기기)은 0일 전으로 봅니다.
      daysAgo: Math.max(0, Math.round((now - m.at) / DAY)),
      src,
      key,
    };
    if (info.villain) cm.villain = info.villain;
    mistakes.push(cm);
    if (src === 'train') trainCount += 1;
    bucket(byKind, info.kind).mistakes += 1;
    bucket(byHero, info.hero).mistakes += 1;
  }

  // 칭찬 한 줄. 퀴즈 정답률이므로 seen 이 아니라 stats.byKind 의 attempts/correct 를 씁니다.
  let good: CoachDigest['good'] = null;
  for (const kind of SCENARIO_KINDS) {
    const k = stats.byKind[kind];
    if (!k || k.attempts < GOOD_MIN_ATTEMPTS) continue;
    const acc = k.correct / k.attempts;
    if (!good || acc > good.acc || (acc === good.acc && k.attempts > good.trials)) {
      good = { kind, trials: k.attempts, acc };
    }
  }

  const material: string[] = [
    'v1',
    String(trials),
    String(stats.mistakes.length),
    String(mistakes.length),
    String(stats.total),
    String(stats.totalCorrect),
    String(cards.length),
  ];
  for (const m of stored) material.push(`${m.at}|${m.scenarioId}|${m.hand}|${m.answer}|${m.chosen}|${m.src ?? 'quiz'}`);

  return {
    v: 1,
    at: now,
    hash: fingerprint(material),
    volume: {
      quizTotal: stats.total,
      quizCorrect: stats.totalCorrect,
      trials,
      mistakesStored: stats.mistakes.length,
      mistakesUsed: mistakes.length,
      trainShare: mistakes.length > 0 ? trainCount / mistakes.length : 0,
      srsCards: cards.length,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
    },
    byKind: rowsOf(SCENARIO_KINDS, byKind).map((r) => ({ kind: r.key, trials: r.trials, mistakes: r.mistakes, foldAnswerShare: r.foldAnswerShare })),
    byHero: rowsOf(POSITIONS, byHero).map((r) => ({ hero: r.key, trials: r.trials, mistakes: r.mistakes, foldAnswerShare: r.foldAnswerShare })),
    axes: computeAxes(mistakes, seen),
    patterns: findPatterns(mistakes, seen, now),
    good,
    weakSpots: readWeakSpots(),
    recentMistakes: mistakes.slice(0, RECENT_LIMIT),
  };
}

/**
 * srs·stats 가 바뀔 때마다 다시 계산합니다. 두 값은 '바뀌었다'는 신호로만 쓰고 재료는
 * `buildDigest` 가 저장소에서 직접 읽습니다 — 두 저장소가 각자 알리는 타이밍이 달라도 한 번에
 * 같은 시점을 보게 하려는 것입니다. `useSyncExternalStore` 를 쓰지 않은 이유는 다이제스트가
 * 매번 새 객체라 스냅샷이 안정적이지 않기 때문입니다.
 */
export function useCoachDigest(): CoachDigest {
  const stats = useStats();
  const srsVersion = useSrs();
  return useMemo(() => buildDigest(), [stats, srsVersion]);
}
