import { Fragment, useState } from 'react';
import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import { ActionBadge } from './ActionBadge';
import { PlainText, TermScope } from './Term';
import { CapsuleButton } from './ui/CapsuleButton';
import { Sheet } from './ui/Sheet';
import '../styles/explain.css';

/** 카드(10♠, K♦ …)만 굵게 뽑아 예시 줄을 한눈에 읽히게 합니다. 나머지 글자는 용어집을 그대로 태웁니다. */
const CARD_RE = /(?:10|[2-9TJQKA])[♠♦]/g;
/** 카드 바로 뒤에 붙는 조사("K♦Q♠가", "A♠A♦를") — 카드와 떨어져 줄이 바뀌면 한국어로 읽히지 않습니다. */
const PARTICLE_RE = /^[가-힣]+/;

function ExampleLine({ text }: { text: string }) {
  const parts: Array<{ t: string; card: boolean; tail?: string }> = [];
  let last = 0;
  CARD_RE.lastIndex = 0;
  for (let m = CARD_RE.exec(text); m; m = CARD_RE.exec(text)) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), card: false });
    // 카드에 바로 이어지는 조사는 같은 nowrap 덩어리에 넣어 "K♦Q♠ / 가 이깁니다"를 막습니다.
    const rest = text.slice(m.index + m[0].length);
    const tail = PARTICLE_RE.exec(rest)?.[0] ?? '';
    parts.push({ t: m[0], card: true, tail });
    last = m.index + m[0].length + tail.length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), card: false });
  return (
    <>
      {parts.map((p, i) =>
        p.card ? (
          <span key={i} className="ui-explain__cardrun">
            <b className="ui-explain__card">{p.t}</b>
            {p.tail}
          </span>
        ) : (
          <Fragment key={i}>
            <PlainText text={p.t} />
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * 해설 본문 (docs/PLAIN_KO_STYLE.md §4):
 *   결론 (액션 뱃지 + 한 줄) → 왜? → 예시 → 플랍에서는 (폴드가 아닐 때) → 자세히 (항상 접힌 채로 시작)
 * 모든 문장은 `PlainText`를 거쳐 용어집 단어가 눌러지도록 합니다. 같은 용어는 한 본문에서 처음 한 번만 밑줄(`TermScope`).
 */
export function ExplanationBody({ step, explanation }: { step: Step; explanation: Explanation }) {
  const e = explanation;
  const easy = e.easy;
  const [more, setMore] = useState(false);
  // resetKey: 해설 객체가 바뀔 때만 용어 장부를 새로 만듭니다 (핸드가 바뀌면 밑줄이 다시 살아납니다).
  return (
    <TermScope resetKey={explanation}>
      <div className="ui-explain">
        <h3 className="ui-explain__h">결론</h3>
        <div className="ui-explain__lead">
          <ActionBadge action={step.answer} kind={step.scenario.kind} size="md" />
          <p className="ui-explain__one">
            <PlainText text={easy.oneLiner} />
          </p>
        </div>

        <h3 className="ui-explain__h">왜?</h3>
        <ul className="ui-explain__list">
          {easy.why.map((w, i) => (
            <li key={i}>
              <PlainText text={w} />
            </li>
          ))}
        </ul>

        <h3 className="ui-explain__h">예시</h3>
        <ul className="ui-explain__ex">
          {easy.example.map((x, i) => (
            <li key={i}>
              <ExampleLine text={x} />
            </li>
          ))}
        </ul>

        {easy.flop && (
          <>
            <h3 className="ui-explain__h">플랍에서는</h3>
            <ul className="ui-explain__list">
              {easy.flop.map((f, i) => (
                <li key={i}>
                  <ExampleLine text={f} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="ui-explain__more">
          <button type="button" className="ui-explain__more-btn" aria-expanded={more} aria-controls="explain-more" onClick={() => setMore((v) => !v)}>
            <span>자세히</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {more && (
            <div id="explain-more" className="ui-explain__more-body">
              <h3>상황</h3>
              <p className="ui-explain__dim">
                <PlainText text={e.situation} />
              </p>
              <h3>손패</h3>
              <p>
                <PlainText text={e.handProfile} />
              </p>
              <h3>자세한 이유</h3>
              <ul className="ui-explain__list">
                {e.reasoning.map((r, i) => (
                  <li key={i}>
                    <PlainText text={r} />
                  </li>
                ))}
              </ul>
              <h3>레인지</h3>
              <p className="ui-explain__dim">
                <PlainText text={e.rangeContext} />
              </p>
              {e.mixNote && (
                <>
                  <h3>혼합 빈도</h3>
                  <p>
                    <PlainText text={e.mixNote} />
                  </p>
                </>
              )}
              {e.chartNote && (
                <>
                  <h3>차트 메모</h3>
                  <p>
                    <PlainText text={e.chartNote} />
                  </p>
                </>
              )}
              {e.postflop && (
                <>
                  <h3>플랍 이후 계획 · {e.postflop.potType}</h3>
                  <p className="ui-explain__kv">
                    <PlainText text={`${e.postflop.role} · ${e.postflop.position}`} />
                  </p>
                  <p className="ui-explain__dim">
                    <PlainText text={e.postflop.spr} />
                  </p>
                  <ul className="ui-explain__list">
                    {e.postflop.checklist.map((c, i) => (
                      <li key={i}>
                        <PlainText text={c} />
                      </li>
                    ))}
                  </ul>
                  <h3>좋은 플랍 / 나쁜 플랍</h3>
                  <p>
                    👍 <PlainText text={e.postflop.goodBoards} />
                  </p>
                  <p>
                    👎 <PlainText text={e.postflop.badBoards} />
                  </p>
                  <h3>플레이 계획</h3>
                  <ul className="ui-explain__list">
                    {e.postflop.plan.map((c, i) => (
                      <li key={i}>
                        <PlainText text={c} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </TermScope>
  );
}

/** 해설 bottom sheet (detent half, scrollable) with a sticky 닫기 footer. */
export function ExplanationSheet({ step, explanation, onClose }: { step: Step; explanation: Explanation; onClose: () => void }) {
  return (
    <Sheet
      open
      onClose={onClose}
      detent="half"
      title={explanation.headline}
      footer={
        <CapsuleButton tone="neutral" size="lg" block onClick={onClose}>
          닫기
        </CapsuleButton>
      }
    >
      <ExplanationBody step={step} explanation={explanation} />
    </Sheet>
  );
}
