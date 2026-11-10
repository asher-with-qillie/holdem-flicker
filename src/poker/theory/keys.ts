/*
 * 책(Modern Poker Theory) 원리로 해설을 붙이기 위한 분류 — docs/EXPLAIN_SPEC.md v4 §6.
 *
 * 패 가족(Family)은 책이 프리플랍 결정을 설명할 때 쓰는 묶음입니다(4장 '절대적인 핸드 강도'의 네 요소 —
 * 높은 카드 · 포켓페어 · 수티드 · 연결성 — 와 5장의 핸드 예). 버킷(Bucket)은 그 차트에서 이 패가 하는 일이고,
 * 자리 쪽(Side)은 책이 이유를 바꾸는 기준(뒤에 남은 사람, 포지션, BB·SB)입니다.
 * 이 셋을 묶은 키 하나에 '이 패 이유' 문장 하나가 붙습니다(handReason.ts).
 */
import { parseHandName } from '../hands';
import { fullMix } from '../range';
import { heroInPosition } from '../scenarios';
import type { Action, ActionMix, HandName, Scenario, ScenarioKind } from '../types';

export type Family =
  | 'pair_big' // AA KK QQ
  | 'pair_mid' // JJ–77
  | 'pair_small' // 66–22
  | 'ak' // AKs AKo
  | 'ace_s_big' // AQs AJs ATs
  | 'ace_s_mid' // A9s–A6s
  | 'ace_s_wheel' // A5s–A2s
  | 'ace_o_big' // AQo AJo ATo
  | 'ace_o_small' // A9o–A2o
  | 'bw_s' // KQs KJs KTs QJs QTs JTs
  | 'bw_o' // KQo KJo KTo QJo QTo JTo
  | 'kq_s' // K9s–K2s, Q9s–Q2s
  | 'conn_s' // 수티드, 높은 카드 J 이하, 사이 0~2칸 (J9s, T9s, 98s, 97s, 86s, 54s, 42s …)
  | 'weak_s' // 그 밖의 수티드 (J6s, T5s, 93s …)
  | 'off_mid' // 오프수트, 높은 카드 K~T 와 9 이하 (K9o, Q8o, T7o …) · 오프수트 커넥터·한 칸 갭 (98o, 86o …)
  | 'trash'; // 그 밖의 오프수트

export const FAMILY_KO: Record<Family, string> = {
  pair_big: '큰 포켓페어',
  pair_mid: '중간 포켓페어',
  pair_small: '작은 포켓페어',
  ak: 'AK',
  ace_s_big: '큰 수티드 A',
  ace_s_mid: '중간 수티드 A',
  ace_s_wheel: '작은 수티드 A',
  ace_o_big: '큰 오프수트 A',
  ace_o_small: '작은 오프수트 A',
  bw_s: '수티드 브로드웨이',
  bw_o: '오프수트 브로드웨이',
  kq_s: '수티드 K·Q',
  conn_s: '수티드 커넥터',
  weak_s: '약한 수티드',
  off_mid: '오프수트 하이카드',
  trash: '약한 오프수트',
};

export function familyOf(hand: HandName): Family {
  const h = parseHandName(hand);
  const { kind, highV: hi, lowV: lo, gap } = h;
  if (kind === 'pair') return hi >= 12 ? 'pair_big' : hi >= 7 ? 'pair_mid' : 'pair_small';
  if (hi === 14 && lo === 13) return 'ak';
  if (hi === 14) {
    if (kind === 'suited') return lo >= 10 ? 'ace_s_big' : lo >= 6 ? 'ace_s_mid' : 'ace_s_wheel';
    return lo >= 10 ? 'ace_o_big' : 'ace_o_small';
  }
  if (hi >= 10 && lo >= 10) return kind === 'suited' ? 'bw_s' : 'bw_o';
  if (kind === 'suited') {
    if (hi >= 12) return 'kq_s';
    if (gap <= 2) return 'conn_s';
    return 'weak_s';
  }
  if (hi >= 10) return 'off_mid';
  if (hi >= 6 && gap <= 1) return 'off_mid';
  return 'trash';
}

/**
 * 이 칸에서 이 패가 하는 일. 섞인 칸(1순위 < 60%)은 위 두 액션을 이름으로 붙입니다(mix:threebet+call · mix:limp+raise).
 * 'limp' 는 SB 첫 진입의 림프(rfi:SB) — 레이즈와 이유가 달라서(반값으로 플랍을 봄 · 림프 범위를 지키는 강한 패) 따로 둡니다.
 */
export type Bucket = 'fold' | 'check' | 'limp' | 'raise' | 'call' | 'agg' | `mix:${string}`;

const AGG: Action[] = ['threebet', 'fourbet', 'allin'];

export function bucketOf(mix: ActionMix | undefined): Bucket {
  const list = fullMix(mix);
  const top = list[0];
  if (!top) return 'fold';
  if (top.weight < 0.6 && list[1]) return `mix:${top.action}+${list[1].action}`;
  if (top.action === 'fold') return 'fold';
  if (top.action === 'check') return 'check';
  if (top.action === 'limp') return 'limp';
  if (top.action === 'call') return 'call';
  if (AGG.includes(top.action)) return 'agg';
  return 'raise';
}

/** 책이 이유를 바꾸는 자리 구분. */
export type Side = 'early' | 'CO' | 'BTN' | 'SB' | 'BB' | 'mid' | 'IP' | 'OOP' | 'any' | 'other';

export function sideOf(s: Scenario): Side {
  switch (s.kind) {
    case 'rfi':
      return s.hero === 'UTG' || s.hero === 'HJ' ? 'early' : (s.hero as Side);
    case 'vs_open':
      return s.hero === 'BB' || s.hero === 'SB' || s.hero === 'BTN' ? s.hero : 'mid';
    case 'vs_3bet':
    case 'vs_4bet':
    case 'vs_5bet':
      return heroInPosition(s.hero, s.villain!) ? 'IP' : 'OOP';
    case 'cold_4bet':
      return 'any';
    case 'vs_limp':
      return s.hero === 'BB' ? 'BB' : 'other';
  }
}

export type ReasonKey = `${ScenarioKind}|${Side}|${Family}|${Bucket}`;

export function reasonKey(s: Scenario, hand: HandName, mix: ActionMix | undefined): ReasonKey {
  return `${s.kind}|${sideOf(s)}|${familyOf(hand)}|${bucketOf(mix)}`;
}
