import { useState } from 'react';
import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import { ActionBadge } from './ActionBadge';
import { PlainText } from './Term';
import { CapsuleButton } from './ui/CapsuleButton';
import { Sheet } from './ui/Sheet';
import '../styles/explain.css';

const MORE_KEY = 'hf.explain.more';
function readMore(): boolean {
  try {
    return sessionStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeMore(v: boolean) {
  try {
    sessionStorage.setItem(MORE_KEY, v ? '1' : '0');
  } catch {
    /* private mode etc. */
  }
}

/**
 * Easy-first Korean explanation body (docs/PLAIN_KO_STYLE.md):
 *   결론 (badge + one-liner) → 왜 그럴까요? → 예를 들면 → 플랍이 열리면? (non-fold only) → 더 자세히 (collapsed; remembered per session).
 * All prose goes through `PlainText` so glossary terms are tappable. The hold overlay and the chart cell sheet reuse it.
 */
export function ExplanationBody({ step, explanation }: { step: Step; explanation: Explanation }) {
  const e = explanation;
  const easy = e.easy;
  const [more, setMore] = useState(readMore);
  const toggle = () => {
    const v = !more;
    setMore(v);
    writeMore(v);
  };
  return (
    <div className="ui-explain">
      <div className="ui-explain__top">
        <span className="ui-explain__hand tnum">
          {step.scenario.hero} · {step.hand}
        </span>
      </div>
      <div className="ui-explain__lead">
        <ActionBadge action={step.answer} kind={step.scenario.kind} size="md" />
        <p className="ui-explain__one">
          <PlainText text={easy.oneLiner} />
        </p>
      </div>

      <h3 className="ui-explain__h">왜 그럴까요?</h3>
      <ul>
        {easy.why.map((w, i) => (
          <li key={i}>
            <PlainText text={w} />
          </li>
        ))}
      </ul>

      <h3 className="ui-explain__h">예를 들면</h3>
      <ul className="ui-explain__ex">
        {easy.example.map((x, i) => (
          <li key={i}>
            <PlainText text={x} />
          </li>
        ))}
      </ul>

      {easy.flop && (
        <>
          <h3 className="ui-explain__h">플랍이 열리면?</h3>
          <ul>
            {easy.flop.map((f, i) => (
              <li key={i}>
                <PlainText text={f} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="ui-explain__more">
        <button type="button" className="ui-explain__more-btn" aria-expanded={more} aria-controls="explain-more" onClick={toggle}>
          <span>더 자세히</span>
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
            <h3>손패 설명</h3>
            <p>
              <PlainText text={e.handProfile} />
            </p>
            <h3>자세한 이유</h3>
            <ul>
              {e.reasoning.map((r, i) => (
                <li key={i}>
                  <PlainText text={r} />
                </li>
              ))}
            </ul>
            <h3>범위</h3>
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
                <ul>
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
                <ul>
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
