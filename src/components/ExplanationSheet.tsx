import { Fragment, useState, type CSSProperties } from 'react';
import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import type { Action, ScenarioKind } from '../poker/types';
import { useSettings } from '../state/settings';
import { AtlasTile } from '../screens/atlas/SeatStrip';
import { actionLabel } from './ActionBadge';
import { LineCapsule, LineStrip } from './LineStrip';
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
    // 카드에 바로 이어지는 조사는 같은 nowrap 덩어리에 넣어 "K♦Q♠ / 를 맞춰도"를 막습니다.
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

/** 섞는 비율 칩 "콜 75% · 3벳 25%" (정수 %, 엔진 mixBlock 값 그대로). 해설 시트 ③과 자리별 보기 상세가 같이 씁니다. */
export function MixChips({ chips, kind }: { chips: Array<{ action: Action; pct: number }>; kind: ScenarioKind }) {
  return (
    <span className="mixchips" aria-label="섞는 비율">
      {chips.map(({ action, pct }) => (
        <span key={action} className="mixchips__chip fill tnum">
          <i style={{ background: `var(--act-${action})` }} aria-hidden="true" />
          {actionLabel(action, kind, true)} {pct}%
        </span>
      ))}
    </span>
  );
}

/** ④ 숫자 줄. rfi 는 자리 사다리이고 내 자리를 굵게, 나머지 상황은 엔진 문자열 그대로(명사형). */
function SeatNumbers({ seat }: { seat: Explanation['seat'] }) {
  if (!seat.ladder) return <p className="ui-explain__nums tnum">{seat.numbers}</p>;
  return (
    <p className="ui-explain__nums tnum">
      {seat.ladder.map((x, i) => (
        <Fragment key={x.pos}>
          {i > 0 && ' · '}
          {x.me ? (
            <b>
              {x.pos} {x.pct}%
            </b>
          ) : (
            `${x.pos} ${x.pct}%`
          )}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * 해설 본문 (docs/EXPLAIN_SPEC.md §4.1). 위에서부터:
 *   ① 줄 블록 — 답 캡슐(md), `이 줄 · 오프수트 K`, 줄 스트립(md), 줄 문장(리빌과 글자까지 같음)
 *   ② 형제 줄 문장 ③ 섞는 비율 칩 + 부분 정답 문장
 *   ④ 자리 — 숫자 줄(rfi 는 사다리, 내 자리 굵게) ⑤ 레버 한 문장
 *   ⑥ 이 패, 다른 자리에서는 › — 자리 타일 한 줄(지금 칸에 링) + 자리 문장. 블록 전체가 버튼(onAcross)
 *   ⑦ 자세히(접힘) — 차트 메모, 메모가 없을 때만 예시 한 줄. 둘 다 없으면 줄째로 숨김
 *   ⑧ 림프 대응이면 면책 문구
 * 모든 문장은 `PlainText`를 거쳐 용어집 단어가 눌러지도록 합니다. 같은 용어는 한 본문에서 처음 한 번만 밑줄(`TermScope`).
 *
 * `onAcross` — 자리별 보기(HandAtlas) 입구. 호출자가 자기 시트를 닫고 `openAtlas()` 를 부릅니다(시트는 한 장만).
 * prop 이 없으면 ⑥을 버튼이 아니라 정적 블록으로 그립니다 — 길게 누르는 held 시트(pointer-events none)에는 주지 않습니다.
 *
 * `variant="atlas"` — 자리별 보기 상세 안에서 펼칠 때. 상세가 이미 ①(캡슐 · 스트립 · 문장), ③(칩 · 부분 정답),
 * 차트 면책을 보여 주므로 그 셋과 ⑥(지금 보고 있는 그 화면)을 빼고 그립니다.
 */
export function ExplanationBody({ step, explanation, onAcross, variant = 'sheet' }: { step: Step; explanation: Explanation; onAcross?: () => void; variant?: 'sheet' | 'atlas' }) {
  const e = explanation;
  const kind = step.scenario.kind;
  const [settings] = useSettings();
  const [more, setMore] = useState(false);
  const full = variant === 'sheet';
  // 자리별 보기 상세는 차트 메모를 이미 '차트 메모 ›'로 보여 주므로, 그 안에서는 메모를 다시 싣지 않습니다.
  const memo = full ? e.more.memo : null;
  const example = e.more.memo ? null : e.more.example;
  const hasMore = !!(memo || example);
  const marks = { selected: step.scenario };

  const across = (
    <>
      <span className="ui-explain__h ui-explain__across-h">
        이 패, 다른 자리에서는{onAcross && <span aria-hidden="true"> ›</span>}
      </span>
      <span className="ui-explain__tiles" style={{ '--n': e.across.cells.length } as CSSProperties}>
        {e.across.cells.map((c) => (
          <span key={c.key} className="ui-explain__tile">
            <span className="ui-explain__tile-seat t-caption">{c.scenario.hero}</span>
            <AtlasTile cell={c} kind={kind} marks={marks} compact />
          </span>
        ))}
      </span>
      {e.across.line.text && (
        <span className="ui-explain__seatline">
          <PlainText text={e.across.line.text} />
        </span>
      )}
    </>
  );

  // resetKey: 해설 객체가 바뀔 때만 용어 장부를 새로 만듭니다 (핸드가 바뀌면 밑줄이 다시 살아납니다).
  return (
    <TermScope resetKey={explanation}>
      <div className={`ui-explain ui-explain--${variant}`}>
        {full && (
          <section className="ui-explain__line" aria-label="이 줄">
            <LineCapsule capsule={e.capsule} size="md" showSplit={settings.showMixFrequencies} />
            <p className="ui-explain__caption t-caption">이 줄 · {e.line.def.label}</p>
            <LineStrip view={e.line} size="md" />
            {e.line.sentence && (
              <p className="ui-explain__sentence">
                <PlainText text={e.line.sentence.text} />
              </p>
            )}
            {e.sibling && (
              <p className="ui-explain__sibling">
                <PlainText text={e.sibling.text} />
              </p>
            )}
            {e.mix && (settings.showMixFrequencies || e.mix.partial) && (
              <div className="ui-explain__mix">
                {settings.showMixFrequencies && <MixChips chips={e.mix.chips} kind={kind} />}
                {e.mix.partial && (
                  <p className="ui-explain__partial">
                    <PlainText text={e.mix.partial} />
                  </p>
                )}
              </div>
            )}
          </section>
        )}
        {!full && e.sibling && (
          <p className="ui-explain__sibling">
            <PlainText text={e.sibling.text} />
          </p>
        )}

        <section className="ui-explain__seat">
          <h3 className="ui-explain__h">
            자리 <small>전체 패 기준</small>
          </h3>
          <SeatNumbers seat={e.seat} />
          {e.seat.lever && (
            <p className="ui-explain__lever">
              <PlainText text={e.seat.lever} />
            </p>
          )}
        </section>

        {full &&
          (onAcross ? (
            <button type="button" className="ui-explain__across" onClick={onAcross} aria-label={`이 패, 다른 자리에서는 · ${e.across.line.text}`}>
              {across}
            </button>
          ) : (
            <div className="ui-explain__across ui-explain__across--static">{across}</div>
          ))}

        {hasMore && (
          <div className="ui-explain__more">
            <button type="button" className="ui-explain__more-btn" aria-expanded={more} aria-controls="explain-more" onClick={() => setMore((v) => !v)}>
              <span>자세히</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {more && (
              <div id="explain-more" className="ui-explain__more-body">
                {memo && (
                  <p>
                    <b className="ui-explain__label">차트 메모</b>
                    <PlainText text={memo} />
                  </p>
                )}
                {example && (
                  <p>
                    <b className="ui-explain__label">예시</b>
                    <ExampleLine text={example} />
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {full && e.disclaimer && <p className="ui-explain__disclaimer t-footnote">{e.disclaimer}</p>}
      </div>
    </TermScope>
  );
}

/** 해설 bottom sheet (detent half, scrollable) with a sticky 닫기 footer. 제목은 `〈자리〉 〈상황〉 · 〈패〉`(답은 캡슐이 말함). */
export function ExplanationSheet({ step, explanation, onClose, onAcross }: { step: Step; explanation: Explanation; onClose: () => void; onAcross?: () => void }) {
  return (
    <Sheet
      open
      onClose={onClose}
      detent="half"
      title={explanation.title}
      footer={
        <CapsuleButton tone="neutral" size="lg" block onClick={onClose}>
          닫기
        </CapsuleButton>
      }
    >
      <ExplanationBody step={step} explanation={explanation} onAcross={onAcross} />
    </Sheet>
  );
}
