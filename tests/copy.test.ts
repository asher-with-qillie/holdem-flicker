import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS } from '../src/poker/data';
import { GLOSS } from '../src/poker/explain';
import { GLOSSARY, glossaryLookup } from '../src/poker/glossary';
import { bannedHits } from '../src/poker/ko';
import { allScenarios, scenarioTitle, scenarioSituation } from '../src/poker/scenarios';
import type { Scenario } from '../src/poker/types';

/*
 * 학습자가 읽는 '사람이 쓴 짧은 글'의 말투 — docs/EXPLAIN_SPEC.md §2.1 · §2.6.
 * 생성 문장(줄 · 시트 · 자리)은 line/sheet 테스트가 보고, 여기서는 그 밖의 글을 봅니다.
 *   · 용어집 팝오버 풀이(GLOSSARY.def)
 *   · 차트 요약 74개(chart.summary — 차트 탭과 해설의 차트에 나옵니다)
 *   · 상황 제목(scenarioTitle)과 상황 문구(scenarioSituation), 74개 스팟 전부
 * 차트 메모(notes)는 tests/sheet.test.ts 가 봅니다.
 */

/** 문장 나누기: 마침표·물음표 뒤 공백. sheet.test.ts 와 같은 규칙입니다. */
const sentences = (text: string) => text.split(/(?<=[.?])\s+/).filter((x) => x.trim());

/** 해요체 문장 끝: `…요.` / `…요?`, 마지막 문장은 마침표 없이 `…요` 로 끝나도 됩니다(팝오버 풀이). */
const HAEYO_END = /요[.?]?$/;

/**
 * BANNED 예외는 **차트 메모 안의 내용**에만 있습니다(tests/sheet.test.ts `MEMO_CONTENT`).
 *   '필요 승률' · '팟 오즈' · 'SPR' — 메모 10개가 괄호 풀이나 승률 숫자와 함께 쓰는 이론 용어이고,
 *   §8 이 메모 내용을 고치지 못하게 막아 둡니다(§9 구현 메모).
 * 이 파일이 보는 글(요약 · 용어 풀이 · 상황 문구)에는 예외가 **없습니다**. 요약의 '필요 승률 약 38~40%'는
 * '이길 확률이 38~40%' 로 고쳤습니다. 아래 집합이 비어 있는 게 그 약속입니다.
 */
const COPY_EXEMPT = new Set<string>();

const banned = (text: string) => bannedHits(text).filter((h) => !COPY_EXEMPT.has(h));

const SPOTS: Scenario[] = allScenarios();

describe('copy: 용어집 팝오버 (§2.1 해요체)', () => {
  it('풀이 전부 BANNED 에 걸리지 않는다', () => {
    const bad = GLOSSARY.flatMap((g) => (banned(g.def).length ? [`${g.term}: ${g.def} ← ${banned(g.def).join(', ')}`] : []));
    expect(bad).toEqual([]);
  });

  it('앞머리는 명사구 풀이, 덧붙인 문장은 해요체로 끝난다', () => {
    const bad: string[] = [];
    for (const g of GLOSSARY) {
      const [head, ...rest] = g.def.split(/\.\s+/);
      // 명사구 풀이: 서술어로 끝나지 않습니다('…는 것', '…효과', '…드로우').
      if (!head || /(다|요)$/.test(head)) bad.push(`${g.term} 머리: ${head}`);
      for (const x of rest) if (!HAEYO_END.test(x)) bad.push(`${g.term}: ${x}`);
    }
    expect(bad).toEqual([]);
  });

  it('explain.ts GLOSS 와 겹치는 용어는 풀이 머리가 글자까지 같다 (두 풀이가 따로 놀지 않게)', () => {
    for (const [term, def] of GLOSS) {
      const g = glossaryLookup(term);
      expect(g, term).toBeDefined();
      expect(g!.def.split(/\.\s+/)[0], term).toBe(def);
    }
  });
});

describe('copy: 차트 요약 74개 (§2.1 · §2.6, 예외 없음)', () => {
  const SUMMARIES = ALL_CHART_DEFS.map((d) => ({ where: d.id, text: d.summary ?? '' }));

  it('74개 차트에 요약이 하나씩 있다', () => {
    expect(SUMMARIES.length).toBe(74);
    expect(SUMMARIES.filter((s) => !s.text.trim()).map((s) => s.where)).toEqual([]);
  });

  it('전부 BANNED 에 걸리지 않는다 (메모 예외 셋도 여기서는 금지)', () => {
    const bad = SUMMARIES.flatMap(({ where, text }) => (banned(text).length ? [`${where}: ${text} ← ${banned(text).join(', ')}`] : []));
    expect(bad).toEqual([]);
  });

  it('모든 문장이 해요체로 끝난다', () => {
    const bad = SUMMARIES.flatMap(({ where, text }) => sentences(text).filter((x) => !/요[.?]$/.test(x)).map((x) => `${where}: ${x}`));
    expect(bad).toEqual([]);
  });
});

describe('copy: 상황 제목 · 상황 문구 (74개 스팟)', () => {
  it('74개 스팟', () => {
    expect(SPOTS.length).toBe(74);
  });

  it('제목은 명사구이고 BANNED · 명령형 · 합니다체가 없다', () => {
    const bad: string[] = [];
    for (const s of SPOTS) {
      const t = scenarioTitle(s);
      if (banned(t).length || /(세요|니다|요)$/.test(t)) bad.push(t);
    }
    expect(bad).toEqual([]);
  });

  it('콜드 4벳 제목은 상황 문구와 같은 말이고, 자리 이름(extras)이 붙어도 그대로다', () => {
    expect(scenarioTitle({ kind: 'cold_4bet', hero: 'CO' })).toBe('CO · 앞에서 오픈과 3벳');
    expect(scenarioTitle({ kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } })).toBe('CO · 앞에서 오픈과 3벳');
    expect(scenarioSituation({ kind: 'cold_4bet', hero: 'CO' })).toBe('앞에서 오픈과 3벳이 나왔어요. CO, 내 차례예요.');
  });

  it('상황 문구는 BANNED 가 없고, 문장마다 해요체로 끝난다 (\'→\' 액션 줄은 명사형 허용)', () => {
    const bad: string[] = [];
    for (const s of SPOTS) {
      const t = scenarioSituation(s);
      if (banned(t).length) bad.push(`${t} ← ${banned(t).join(', ')}`);
      for (const x of sentences(t)) {
        if (/요[.?]$/.test(x)) continue;
        if (x.includes('→') && !/(니다|세요)/.test(x)) continue;
        bad.push(x);
      }
    }
    expect(bad).toEqual([]);
  });
});
