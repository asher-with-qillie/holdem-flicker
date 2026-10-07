import { describe, expect, it } from 'vitest';
import { ALL_HANDS } from '../src/poker/hands';
import { actWord, BANNED, emWidth, hasFinal, josa, verb } from '../src/poker/ko';
import { lineOf } from '../src/poker/line';
import { RANKS, type Action, type Pos } from '../src/poker/types';

/*
 * 조사 전수표 — docs/EXPLAIN_SPEC.md §2.4 · §7.2-13.
 * 조사는 소리 내어 읽는 마지막 음절로 정합니다. 표가 바뀌면 여기서 먼저 보입니다.
 */

/** 줄 이름에 쓰는 랭크 중 받침이 있는 것: T(십)·8(팔)·7(칠)·6(육)·3(삼). */
const RANK_FINAL = new Set(['T', '8', '7', '6', '3']);
/** 페어 중 받침이 있는 것: 88·77·66·33. TT 는 '티티'라 받침이 없습니다. */
const PAIR_FINAL = new Set(['88', '77', '66', '33']);

describe('ko: 조사 전수표 (§2.4)', () => {
  it('25개 줄 이름 × {을/를, 은/는, 중}', () => {
    const labels = new Set<string>();
    for (const h of ALL_HANDS) labels.add(lineOf(h).label);
    expect(labels.size).toBe(25);
    for (const label of labels) {
      const last = label[label.length - 1];
      const fin = /[가-힣]$/.test(label) ? false : RANK_FINAL.has(last); // 포켓페어 · 수티드 커넥터는 받침 없음
      expect(josa(label, '을/를'), label).toBe(`${label}${fin ? '을' : '를'}`);
      expect(josa(label, '은/는'), label).toBe(`${label}${fin ? '은' : '는'}`);
      // '중'은 조사가 아니라 그대로 붙습니다 — 받침과 무관.
      expect(`${label} 중`).toMatch(/ 중$/);
    }
    expect(josa('포켓페어', '을/를')).toBe('포켓페어를');
    expect(josa('수티드 커넥터', '을/를')).toBe('수티드 커넥터를');
    expect(josa('수티드 T', '을/를')).toBe('수티드 T을');
    expect(josa('오프수트 8', '을/를')).toBe('오프수트 8을');
    expect(josa('수티드 9', '을/를')).toBe('수티드 9를');
    expect(josa('오프수트 A', '은/는')).toBe('오프수트 A는');
    expect(josa('수티드 8', '은/는')).toBe('수티드 8은');
    for (const r of RANKS) expect(hasFinal(r), r).toBe(RANK_FINAL.has(r));
  });

  it('169개 패 × {은/는, 을/를}', () => {
    for (const h of ALL_HANDS) {
      const fin = PAIR_FINAL.has(h);
      expect(josa(h, '은/는'), h).toBe(`${h}${fin ? '은' : '는'}`);
      expect(josa(h, '을/를'), h).toBe(`${h}${fin ? '을' : '를'}`);
    }
    expect(josa('88', '은/는')).toBe('88은');
    expect(josa('TT', '은/는')).toBe('TT는');
    expect(josa('KTs', '을/를')).toBe('KTs를');
    expect(josa('ATo', '은/는')).toBe('ATo는');
  });

  it('6개 자리 × 4개 조사', () => {
    const seats: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    for (const p of seats) {
      const fin = p === 'BTN';
      expect(josa(p, '이/가')).toBe(`${p}${fin ? '이' : '가'}`);
      expect(josa(p, '은/는')).toBe(`${p}${fin ? '은' : '는'}`);
      expect(josa(p, '을/를')).toBe(`${p}${fin ? '을' : '를'}`);
      expect(josa(p, '과/와')).toBe(`${p}${fin ? '과' : '와'}`);
    }
    expect(josa('BTN', '은/는')).toBe('BTN은');
  });

  it('8개 액션 × {과/와, 을/를, 이에요/예요}', () => {
    const table: Array<[string, boolean]> = [
      ['콜', true],
      ['3벳', true],
      ['4벳', true],
      ['오픈', true],
      ['올인', true],
      ['레이즈', false],
      ['체크', false],
      ['폴드', false],
    ];
    for (const [w, fin] of table) {
      expect(josa(w, '과/와'), w).toBe(`${w}${fin ? '과' : '와'}`);
      expect(josa(w, '을/를'), w).toBe(`${w}${fin ? '을' : '를'}`);
      expect(josa(w, '이에요/예요'), w).toBe(`${w}${fin ? '이에요' : '예요'}`);
    }
    expect(josa('콜', '과/와')).toBe('콜과');
    expect(josa('레이즈', '을/를')).toBe('레이즈를');
  });

  it('숫자 뒤: 곳·명은 받침, %·bb 는 받침 없음', () => {
    expect(josa('46%', '이에요/예요')).toBe('46%예요');
    expect(josa('6곳', '이에요/예요')).toBe('6곳이에요');
    expect(josa('5명', '이/가')).toBe('5명이');
    expect(josa('1.5bb', '을/를')).toBe('1.5bb를');
    expect(josa('10', '을/를')).toBe('10을'); // 카드 그림의 10(십)
    expect(josa('폴드나 체크', '이에요/예요')).toBe('폴드나 체크예요');
    expect(josa('3벳·콜 반반', '이에요/예요')).toBe('3벳·콜 반반이에요');
    expect(josa('BTN', '이나/나')).toBe('BTN이나');
    expect(josa('CO', '이나/나')).toBe('CO나');
  });
});

describe('ko: 동사 · 폭 · 금지 표현', () => {
  it('동사 = 버튼 단어 + 해요/하고 (§2.2)', () => {
    const acts: Action[] = ['raise', 'call', 'threebet', 'fourbet', 'allin', 'fold', 'check'];
    expect(acts.map((a) => verb(a, 'rfi', '해요'))).toEqual(['오픈해요', '콜해요', '3벳해요', '4벳해요', '올인해요', '폴드해요', '체크해요']);
    expect(verb('raise', 'vs_limp', '하고')).toBe('레이즈하고');
    expect(actWord('raise', 'vs_limp')).toBe('레이즈');
    expect(actWord('allin', 'vs_4bet')).toBe('올인');
    expect(actWord('call', 'vs_5bet')).toBe('콜');
    expect(actWord('fourbet', 'cold_4bet')).toBe('4벳');
  });

  it('emWidth: 한글 1 · 라틴/숫자 0.6 · 그 밖 0.3', () => {
    expect(emWidth('폴드')).toBe(2);
    expect(emWidth('KQo')).toBeCloseTo(1.8);
    expect(emWidth('. ')).toBeCloseTo(0.6);
    expect(emWidth('SB는 오프수트 8을 전부 폴드해요.')).toBeCloseTo(15.3);
  });

  it('BANNED 는 §2.6 의 실제 문구를 잡고, 해요체 문장은 통과시킨다', () => {
    const bad = ['폴드하세요.', '오픈합니다.', '당신 차례입니다', '앞섭니다', '팟 오즈', 'SPR', '5.1%', '좋아요!', '👍', '열어요', '접어요', '오픈을 맞으면', '전체의 약 18%'];
    for (const t of bad) expect(BANNED.some((re) => re.test(t)), t).toBe(true);
    const good = ['UTG는 오프수트 K를 KQo만 오픈하고, KJo는 절반만 오픈해요.', 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.', '내 A♠10♦ vs 상대 A♦K♠ → A를 맞춰도 킥커에서 밀려요.'];
    for (const t of good) expect(BANNED.filter((re) => re.test(t)).map(String), t).toEqual([]);
  });
});
