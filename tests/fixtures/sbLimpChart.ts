import { ALL_HANDS } from '../../src/poker/hands';
import { parseRange } from '../../src/poker/range';
import type { ChartDef } from '../../src/poker/types';

/**
 * 시험용 rfi:SB — 림프가 있는 SB 첫 진입(책 5장 2절의 모양: 레이즈 약 24% · 림프 약 38% · 폴드 약 38%).
 *
 * **실제 차트가 아닙니다.** 림프 기반(액션 · 채점 · 문장 · 시트 · 자리별 보기 · SRS · 코치)을 끝까지 돌려 보려고 테스트 안에서만
 * `vi.mock('../src/poker/data/rfi')` 로 갈아 끼웁니다. 실제 rfi:SB 는 차트를 책에 맞춰 다시 만들 때 바뀝니다.
 *
 * 들어가는 패(ENTRY)에서 레이즈(RAISE)를 뺀 나머지가 림프입니다. 일부러 넣은 칸:
 *  - 함정 림프: AA·KK·QQ·AKs·AKo 는 레이즈 75 · 림프 25(책: 림프 범위에 강한 패를 일부 섞음) → '주로 오픈'
 *  - 동점: KTs · 88 · A9o … 레이즈 50 · 림프 50 → 정답은 더 공격적인 레이즈('오픈·림프 반반')
 *  - 림프 50 · 폴드 50: K3o · K2o · Q4o · J6o · T8o → 정답은 림프('절반만 림프')
 *  - 세 액션: K7o 는 레이즈 50 · 림프 25 · 폴드 25
 *  - 순수 림프: 55~22 · Q4s~Q2s · 98o … / 순수 레이즈: JJ~99 · AQs · A5s · A4s · KQo …
 */
const RAISE = [
  'AA:0.75', 'KK:0.75', 'QQ:0.75', 'JJ', 'TT', '99', '88:0.5', '77:0.5', '66:0.5',
  'AKs:0.75', 'AQs', 'AJs', 'ATs', 'A9s:0.5', 'A8s-A6s:0.5', 'A5s', 'A4s', 'A3s:0.5', 'A2s:0.5',
  'KQs', 'KJs', 'KTs:0.5', 'K9s:0.5', 'K8s-K2s:0.5', 'QJs', 'QTs:0.5', 'Q9s:0.5', 'Q8s:0.5', 'Q7s-Q5s:0.5',
  'JTs:0.5', 'J9s:0.5', 'J8s:0.5', 'T9s:0.5', 'T8s:0.5', '98s:0.5', '97s:0.5', '87s:0.5', '86s:0.5', '76s:0.5', '65s:0.5', '54s:0.5',
  'AKo:0.75', 'AQo', 'AJo', 'ATo:0.5', 'A9o:0.5', 'A8o:0.5', 'A7o-A6o:0.5', 'A5o-A4o:0.5', 'A3o-A2o:0.5',
  'KQo', 'KJo:0.5', 'KTo:0.5', 'K9o:0.5', 'K8o:0.5', 'K7o:0.5', 'QJo:0.5', 'QTo:0.5', 'Q9o:0.5', 'Q8o:0.5', 'JTo:0.5', 'J9o:0.5', 'J8o:0.5', 'T9o:0.5',
].join(',');

const ENTRY = [
  '22+', 'A2s+', 'K2s+', 'Q2s+', 'J2s+', 'T2s+', '92s+', '82s+', '72s+', '62s+', '52s+', '42s+', '32s',
  'A2o+', 'K4o+', 'K7o:0.75', 'K3o-K2o:0.5', 'Q5o+', 'Q4o:0.5', 'J7o+', 'J6o:0.5', 'T9o', 'T8o:0.5', '98o',
].join(',');

/** ENTRY − RAISE 를 범위 문자열로('Q4s,Q3s,…,K3o:0.5,…'). */
function limpRange(): string {
  const r = parseRange(RAISE);
  const e = parseRange(ENTRY);
  const out: string[] = [];
  for (const h of ALL_HANDS) {
    const w = Math.round(((e[h] ?? 0) - (r[h] ?? 0)) * 100) / 100;
    if (w < 0) throw new Error(`${h}: raise > entry`);
    if (w > 0) out.push(w === 1 ? h : `${h}:${w}`);
  }
  return out.join(',');
}

export const SB_LIMP_CHART: ChartDef = {
  id: 'rfi:SB',
  kind: 'rfi',
  hero: 'SB',
  actions: { raise: RAISE, limp: limpRange() },
  summary: '시험용 SB 첫 진입이에요. 림프를 섞고, 강한 패와 블로커 패는 레이즈해요.',
};
