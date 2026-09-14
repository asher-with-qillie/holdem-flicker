/**
 * 용어 밑줄 장부(TermScope)의 회귀 테스트.
 *
 * 왜 있는가: 예전 구현은 `TermScope` 가 렌더 중에 `new Set()` 을 만들고 `PlainText` 가 자기 렌더
 * 중에 그 Set 을 `add` 해서 "이 본문에서 처음 나온 용어만 밑줄" 을 정했습니다. 렌더가 부수효과를
 * 갖는 구조라, React 가 같은 렌더를 두 번 부르면(StrictMode 개발 모드, 중단된 동시 렌더의 재실행)
 * 두 번째 패스에서 모든 용어가 '이미 본 것'이 되어 **밑줄이 전부 사라졌습니다**.
 * 실측: 개발 서버에서 차트 시트의 눌러지는 용어가 0개, 프로덕션 빌드에서는 3~6개.
 *
 * 이 테스트가 재는 것은 "정답이 맞는가" 보다 **"같은 입력이면 몇 번을 돌려도 같은가"** 입니다.
 * 특히 `renderBody()` 는 StrictMode 의 마운트를 그대로 흉내 냅니다 — 컴포넌트마다 렌더 함수를
 * 연달아 두 번 부르고, **두 번째 패스의 결과만** 화면에 남습니다. 고치는 도중에 주인을
 * `useRef` 토큰으로 잡은 판본이 이 테스트를 통과하고도 화면에서는 그대로 0개였는데, 그 판본의
 * 테스트가 주인을 손으로 고정해 줘서 진짜 상황을 흉내 내지 못했기 때문입니다. 주인은 이제
 * 렌더 입력(글귀)에서 나오므로 흉내와 실제가 같습니다.
 *
 * DOM 이 필요 없도록 순수 함수(resolveTerms)로 뽑아 두었기 때문에 기존 node 환경에서 그대로 돕니다.
 */
import { describe, expect, it } from 'vitest';
import { resolveTerms, type Piece, type TermScopeState } from '../src/components/Term';
import { GLOSSARY_WORDS } from '../src/poker/glossary';

const newScope = (): TermScopeState => ({ key: 'test', owners: new Map() });

/** 밑줄이 그어진(= 눌러지는) 조각만. */
const underlined = (pieces: Piece[]): string[] => pieces.filter((p) => p.entry).map((p) => p.text);

/**
 * StrictMode 의 마운트 흉내: 본문 하나의 PlainText 들을 문서 순서대로 돌리되, 각각을 연달아 두 번
 * 렌더하고 **두 번째 결과**를 남깁니다. 실제 화면에 남는 것이 두 번째 패스이기 때문입니다.
 */
function renderBody(texts: string[], scope: TermScopeState, passes = 2): string[][] {
  return texts.map((t) => {
    let last: Piece[] = [];
    for (let i = 0; i < passes; i++) last = resolveTerms(t, scope);
    return underlined(last);
  });
}

// 용어집에서 실제로 존재하는 단어를 골라 씁니다 — 하드코딩한 단어가 용어집에서 빠지면
// 테스트가 "통과"하면서 아무것도 재지 않게 되므로, 먼저 존재부터 확인합니다.
const TERM = '킥커';
const TERM2 = '레인지';

describe('TermScope 장부', () => {
  it('테스트가 쓰는 용어가 실제로 용어집에 있다', () => {
    expect(GLOSSARY_WORDS).toContain(TERM);
    expect(GLOSSARY_WORDS).toContain(TERM2);
  });

  it('StrictMode 처럼 두 번 렌더해도 밑줄이 남는다 (옛 구현이 0개가 되던 지점)', () => {
    const scope = newScope();
    const [a, b] = renderBody([`${TERM}가 중요합니다.`, `${TERM2}를 좁힙니다.`], scope);
    expect(a).toEqual([TERM]); // 옛 구현: [] — 두 번째 패스에서 밑줄이 사라짐
    expect(b).toEqual([TERM2]);
  });

  it('패스를 몇 번 돌리든 결과가 흔들리지 않는다', () => {
    for (const passes of [1, 2, 3, 5]) {
      const scope = newScope();
      expect(renderBody([`${TERM}가 중요합니다.`], scope, passes)).toEqual([[TERM]]);
    }
  });

  it('같은 글귀를 다시 렌더하면 앞서 낸 답이 그대로 나온다', () => {
    const scope = newScope();
    const text = `${TERM}가 중요합니다.`;
    const first = resolveTerms(text, scope);
    const second = resolveTerms(text, scope);
    expect(second).toEqual(first);
    expect(underlined(second)).toEqual([TERM]);
  });

  it('한 본문 안에서는 먼저 나온 글귀만 밑줄을 갖는다', () => {
    const scope = newScope();
    expect(renderBody([`${TERM}를 봅니다.`, `${TERM}를 또 봅니다.`], scope)).toEqual([[TERM], []]);
  });

  it('진 글귀가 다시 렌더돼도 계속 지고, 이긴 글귀는 계속 이긴다 (밑줄이 깜빡이지 않는다)', () => {
    const scope = newScope();
    const win = `${TERM}를 봅니다.`;
    const lose = `${TERM}를 또 봅니다.`;
    renderBody([win, lose], scope);
    for (let i = 0; i < 3; i++) {
      expect(underlined(resolveTerms(lose, scope))).toEqual([]);
      expect(underlined(resolveTerms(win, scope))).toEqual([TERM]);
    }
  });

  it('한 문자열 안에 같은 용어가 두 번 나오면 처음 것만 밑줄', () => {
    const scope = newScope();
    expect(underlined(resolveTerms(`${TERM}와 ${TERM}.`, scope))).toEqual([TERM]);
  });

  it('서로 다른 용어는 각각 한 번씩 밑줄을 받는다', () => {
    const scope = newScope();
    expect(underlined(resolveTerms(`${TERM}와 ${TERM2}.`, scope)).sort()).toEqual([TERM, TERM2].sort());
  });

  it('괄호 안에 풀이가 붙은 등장은 밑줄 없이 그 본문의 밑줄을 써 버린다', () => {
    const scope = newScope();
    // 괄호 꼴은 그 자리에서 뜻을 말해 주므로 밑줄을 긋지 않고, 뒤에 나오는 같은 용어도 긋지 않습니다.
    expect(
      renderBody([`${TERM}(같은 패일 때 승부를 가르는 옆 카드)가 중요합니다.`, `${TERM}를 또 봅니다.`], scope),
    ).toEqual([[], []]);
  });

  it('장부를 새로 만들면 다시 밑줄을 받는다 (다음 핸드의 해설)', () => {
    const text = `${TERM}가 중요합니다.`;
    renderBody([text], newScope());
    expect(renderBody([text], newScope())).toEqual([[TERM]]);
  });

  it('장부가 없으면(TermScope 밖) 등장마다 밑줄을 받는다', () => {
    expect(underlined(resolveTerms(`${TERM}를 봅니다.`, null))).toEqual([TERM]);
    expect(underlined(resolveTerms(`${TERM}를 봅니다.`, null))).toEqual([TERM]);
  });

  it('용어가 없는 글은 조각을 쪼개지 않는다', () => {
    const scope = newScope();
    const pieces = resolveTerms('여기에는 아무 용어도 없습니다.', scope);
    expect(underlined(pieces)).toEqual([]);
    expect(pieces.map((p) => p.text).join('')).toBe('여기에는 아무 용어도 없습니다.');
  });

  it('조각을 이어 붙이면 원문이 그대로 나온다', () => {
    const scope = newScope();
    const text = `${TERM}와 ${TERM2}를 같이 봅니다.`;
    expect(
      resolveTerms(text, scope)
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });

  it('알려진 한계: 완전히 같은 글귀가 두 번 있으면 둘 다 밑줄을 받는다', () => {
    const scope = newScope();
    const same = `${TERM}를 봅니다.`;
    // 렌더 입력만으로는 둘을 구분할 수 없습니다. 하나 더 그어지는 쪽이 전부 사라지는 쪽보다 낫습니다.
    expect(renderBody([same, same], scope)).toEqual([[TERM], [TERM]]);
  });
});
