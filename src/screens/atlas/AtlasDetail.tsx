import { useCallback, useMemo, useState } from 'react';
import { ExplanationBody, MixChips } from '../../components/ExplanationSheet';
import { LineCapsule, LineStrip } from '../../components/LineStrip';
import { PlainText } from '../../components/Term';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconCheck } from '../../components/ui/icons';
import { compareAxis, compareCells, differingLevers, gateText, uniformLine, type AtlasCell, type HandAtlas } from '../../poker/atlas';
import { explainStep } from '../../poker/explain';
import { lineOf, lineSentence, stripView } from '../../poker/line';
import { stepFor, type Step } from '../../poker/trainer';
import { useSettings } from '../../state/settings';
import { useCellFlag } from '../charts/CellCard';
import { disclaimerFor } from '../charts/disclaimer';

/** 펼침 줄(차트 메모 › · 해설 전체 보기): 44px, 오른쪽 셰브런. */
function Disclosure({ label, open, onToggle }: { label: string; open: boolean; onToggle(): void }) {
  return (
    <button type="button" className="ui-explain__more-btn" aria-expanded={open} onClick={onToggle}>
      <span>{label}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

/**
 * 선택 칸 아래 블록 (docs/EXPLAIN_SPEC.md §5.3 조립 순서):
 *   ① 결론 한 문장(compareCells 첫 줄, 비교 상대가 없으면 uniformLine) ② 차이 레버 하나(differingLevers 첫 하나)
 *   ③ 답 캡슐 md + 줄 스트립 md + 줄 문장 — 트레이너 리빌과 글자까지 같습니다. 비교 칸의 줄 문장이 다르면
 *      두 번째 스트립과 문장을 아래에 쌓고, 스트립 왼쪽에 자리 칩을 행 라벨로 둡니다. 두 줄 사이에서 움직이는 경계가 배울 내용입니다.
 *   ④ 섞는 비율 칩 + 부분 정답 문장(비교 줄을 쌓으면 선택 칸 줄 항목 안, 문장 바로 아래) ⑤ 차트 메모 ›(접힘) ⑥ 림프 대응 차트면 DISCLAIMER(evidence 'human')
 *   ⑦ 해설 전체 보기 → ExplanationBody variant="atlas"(위에서 이미 보인 ①·③·⑥ 생략) + 헷갈려요
 * 미도달 칸이면 G 문장 한 줄뿐입니다. 비교 상대가 없으면(행·열이 전부 같은 답) 결론을 지어내지 않고,
 * 섹션 전체가 같은 답일 때만 "어느 자리에서나 …" 를 말합니다.
 */
/**
 * Per-cell UI state that outlives the component. The detail renders inside the tile section in one column and in the
 * right column in two, so a fold / rotation that switches the atlas between them remounts it — 해설 전체 보기 stays
 * open, and a cell already flagged 헷갈려요 is not rated twice. Scoped to one opening of the atlas sheet: the sheet
 * calls forgetKept() when it opens, so a cell met again later (after it was reviewed in training) starts fresh.
 */
const kept = new Map<string, boolean>();
export function forgetKept(): void {
  kept.clear();
}
function useKept(key: string, init = false): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [v, setV] = useState(() => kept.get(key) ?? init);
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) =>
      setV((prev) => {
        const val = typeof next === 'function' ? next(prev) : next;
        kept.delete(key);
        kept.set(key, val);
        while (kept.size > 96) kept.delete(kept.keys().next().value as string);
        return val;
      }),
    [key],
  );
  return [v, set];
}

export function AtlasDetail({ atlas, cell, compare }: { atlas: HandAtlas; cell: AtlasCell; compare: AtlasCell | null }) {
  const { hand } = atlas;
  const kind = cell.scenario.kind;
  const [settings] = useSettings();
  const keyBase = `${hand}|${cell.key}`;
  const [expanded, setExpanded] = useKept(`${keyBase}|expanded`);
  const [memoOpen, setMemoOpen] = useKept(`${keyBase}|memo`);
  const [keptFlag, setKeptFlag] = useKept(`${keyBase}|flagged`);

  const step: Step | null = useMemo(() => {
    try {
      return stepFor(cell.scenario, hand);
    } catch {
      return null;
    }
  }, [cell, hand]);
  const [chartFlagged, chartFlag] = useCellFlag(step);
  const explanation = useMemo(() => (step ? explainStep(step) : null), [step]);

  // 비교 칸의 줄(같은 패라 줄은 같고, 자리가 달라 문장·경계가 다를 수 있음). 문장이 같으면 쌓지 않습니다.
  const second = useMemo(() => {
    if (!compare || !compare.reachable || !explanation || compare.scenario.kind !== kind) return null;
    const sentence = lineSentence(compare.scenario, lineOf(hand));
    if (!sentence || sentence.text === explanation.line.sentence?.text) return null;
    return { view: { ...stripView(compare.scenario, hand), sentence }, cell: compare };
  }, [compare, explanation, hand, kind]);

  if (!cell.reachable) {
    return (
      <GlassPanel variant="clear" radius="md" padding={12} className="atlas__detail glass-flat" role="status">
        <p className="t-callout">
          <PlainText text={gateText(cell) ?? '이 상황은 안 생겨요.'} />
        </p>
      </GlassPanel>
    );
  }

  // 차트를 단정하는 문장은 전부 atlas.ts 가 만듭니다 — 여기서 글자를 조립하면 속성 테스트가 못 봅니다.
  const conclusion = compare ? (compareCells(cell, compare)[0] ?? null) : uniformLine(atlas.sections[kind]);
  const lever = compare ? (differingLevers(cell, compare)[0] ?? null) : null;
  const human = cell.evidence === 'human' || compare?.evidence === 'human';
  // 행 라벨: 두 칸이 다른 축의 자리(hero 축이면 내 자리, villain 축이면 상대 자리).
  const axis = second ? compareAxis(cell.scenario, second.cell.scenario) : 'none';
  const rowLabel = (c: AtlasCell) => (axis === 'villain' ? (c.scenario.villain ?? c.scenario.hero) : c.scenario.hero);

  // ④ 섞는 비율 칩 + 부분 정답 문장은 선택 칸의 것입니다. 비교 줄을 쌓을 때는 선택 칸 줄 항목 안(문장 바로 아래)에 둬야
  //    비교 자리의 비율로 읽히지 않습니다.
  const mix =
    explanation?.mix && (settings.showMixFrequencies || explanation.mix.partial) ? (
      <div className="atlas__mix">
        {settings.showMixFrequencies && <MixChips chips={explanation.mix.chips} kind={kind} />}
        {explanation.mix.partial && (
          <p className="t-subhead ink-2">
            <PlainText text={explanation.mix.partial} />
          </p>
        )}
      </div>
    ) : null;

  // the chart's flag store too: a cell flagged in the chart sheet opens here as done, and one flagged here shows done
  // back in the chart — the chart channel rates a cell once per visit
  const flagged = keptFlag || chartFlagged;
  const flag = () => {
    if (flagged || !step) return;
    chartFlag();
    setKeptFlag(true);
  };

  return (
    <GlassPanel variant="clear" radius="md" padding={12} className="atlas__detail glass-flat">
      {conclusion && (
        <p className="atlas__concl t-callout">
          <PlainText text={conclusion.text} />
        </p>
      )}
      {lever && (
        <p className="atlas__lever t-subhead ink-2">
          <PlainText text={lever.text} />
        </p>
      )}

      {explanation && (
        <div className="atlas__line">
          <LineCapsule capsule={explanation.capsule} size="md" showSplit={settings.showMixFrequencies} />
          <p className="atlas__caption t-caption">이 줄 · {explanation.line.def.label}</p>
          {second ? (
            <>
              <div className="atlas__lineitem">
                <div className="atlas__linerow">
                  <span className="atlas__linechip atlas__linechip--sel t-caption">{rowLabel(cell)}</span>
                  <LineStrip view={explanation.line} size="md" />
                </div>
                {explanation.line.sentence && (
                  <p className="atlas__sentence t-callout">
                    <PlainText text={explanation.line.sentence.text} />
                  </p>
                )}
                {mix}
              </div>
              <div className="atlas__lineitem">
                <div className="atlas__linerow">
                  <span className="atlas__linechip atlas__linechip--cmp t-caption">{rowLabel(second.cell)}</span>
                  <LineStrip view={second.view} size="md" />
                </div>
                <p className="atlas__sentence t-callout">
                  <PlainText text={second.view.sentence.text} />
                </p>
              </div>
            </>
          ) : (
            <>
              <LineStrip view={explanation.line} size="md" />
              {explanation.line.sentence && (
                <p className="atlas__sentence t-callout">
                  <PlainText text={explanation.line.sentence.text} />
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!second && mix}

      {cell.note && (
        <div className="atlas__more">
          <Disclosure label="차트 메모" open={memoOpen} onToggle={() => setMemoOpen((v) => !v)} />
          {memoOpen && (
            <p className="atlas__note t-footnote ink-2">
              <PlainText text={cell.note} />
            </p>
          )}
        </div>
      )}
      {/* 림프 대응 차트(evidence 'human')의 면책 — BB 칸은 'SB가 림프하고 BB 차례'라 다른 문장입니다(disclaimerFor). */}
      {human && <p className="atlas__disclaimer t-footnote ink-3">{disclaimerFor(cell.evidence === 'human' ? cell.scenario : compare!.scenario)}</p>}

      {step && explanation && (
        <div className="atlas__more">
          <Disclosure label="해설 전체 보기" open={expanded} onToggle={() => setExpanded((v) => !v)} />
          {expanded && (
            <div className="atlas__more-body">
              <ExplanationBody step={step} explanation={explanation} variant="atlas" />
              {flagged ? (
                <p className="charts-sheet__done t-callout" role="status">
                  <IconCheck />
                  헷갈려요로 표시했어요
                </p>
              ) : (
                <CapsuleButton tone="unsure" size="md" block onClick={flag}>
                  이 패 헷갈려요로 표시
                </CapsuleButton>
              )}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
