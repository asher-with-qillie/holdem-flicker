import { useMemo, useState } from 'react';
import { ActionBadge } from '../../components/ActionBadge';
import { ExplanationBody } from '../../components/ExplanationSheet';
import { PlainText } from '../../components/Term';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { toast } from '../../components/ui/Toast';
import { IconCheck } from '../../components/ui/icons';
import { compareCells, gateText, seatSummary, uniformLine, type AtlasCell, type HandAtlas } from '../../poker/atlas';
import { explainStep } from '../../poker/explain';
import { stepFor, type Step } from '../../poker/trainer';
import { vibrate } from '../../state/settings';
import { rate } from '../../state/srs';
import { DISCLAIMER } from '../charts/disclaimer';

/**
 * 선택 칸 아래 블록 (docs/ATLAS_SPEC.md §5.3 조립 순서):
 *   ① (rfi 면) seatSummary ② compareCells 결론 ③ 차이 레버·줄 경계 ④ 혼합 칩 ⑤ 그 칸의 oneLiner ⑥ 차트 메모
 *   ⑦ 사람 작성 차트면 DISCLAIMER ⑧ 해설 전체 보기(인라인 ExplanationBody + 헷갈려요) — 새 시트를 띄우지 않습니다.
 * 미도달 칸이면 G 문장 한 줄뿐입니다. 비교 상대가 없으면(행·열이 전부 같은 답) 결론을 지어내지 않고,
 * 섹션 전체가 같은 답일 때만 "어느 자리에서든 …" 을 말합니다.
 */
export function AtlasDetail({ atlas, cell, compare }: { atlas: HandAtlas; cell: AtlasCell; compare: AtlasCell | null }) {
  const { hand } = atlas;
  const kind = cell.scenario.kind;
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const step: Step | null = useMemo(() => {
    try {
      return stepFor(cell.scenario, hand);
    } catch {
      return null;
    }
  }, [cell, hand]);
  const explanation = useMemo(() => (step ? explainStep(step) : null), [step]);

  if (!cell.reachable) {
    return (
      <GlassPanel variant="clear" radius="md" padding={12} className="atlas__detail glass-flat" role="status">
        <p className="t-callout">
          <PlainText text={gateText(cell) ?? '이 상황은 생기지 않습니다.'} />
        </p>
      </GlassPanel>
    );
  }

  const lines = compare ? compareCells(cell, compare) : [];
  // 차트를 단정하는 문장은 전부 atlas.ts 가 만듭니다 — 여기서 글자를 조립하면 속성 테스트가 못 봅니다.
  const fallback = compare ? null : (uniformLine(atlas.sections[kind])?.text ?? null);
  const human = cell.evidence === 'human' || compare?.evidence === 'human';

  const flag = () => {
    if (flagged || !step) return;
    rate(step, 'unsure', 'chart');
    setFlagged(true);
    vibrate([18, 30, 18]);
    toast('헷갈려요로 표시했어요 · 다음 세션에 먼저 나와요', 'amber');
  };

  return (
    <GlassPanel variant="clear" radius="md" padding={12} className="atlas__detail glass-flat">
      {kind === 'rfi' && (
        <p className="atlas__summary t-footnote ink-2">
          <PlainText text={seatSummary(atlas, cell.scenario.hero).text} />
        </p>
      )}
      {lines.length > 0 ? (
        lines.map((l, i) => (
          <p key={i} className={i === 0 ? 'atlas__concl t-callout' : 'atlas__lever t-subhead ink-2'}>
            <PlainText text={l.text} />
          </p>
        ))
      ) : fallback ? (
        <p className="atlas__concl t-callout">
          <PlainText text={fallback} />
        </p>
      ) : null}

      <div className="atlas__mix" aria-label="혼합 비중">
        {cell.mixList.map((m) => (
          <span key={m.action} className="atlas__mix-item">
            <ActionBadge action={m.action} kind={kind} size="sm" short />
            {cell.mixList.length > 1 && <span className="t-caption tnum ink-2">{Math.round(m.weight * 100)}%</span>}
          </span>
        ))}
      </div>

      {explanation && (
        <p className="atlas__one t-callout">
          <PlainText text={explanation.easy.oneLiner} />
        </p>
      )}
      {cell.note && (
        <p className="atlas__note t-footnote ink-2">
          <b>차트 메모</b>
          <PlainText text={cell.note} />
        </p>
      )}
      {human && <p className="atlas__disclaimer t-footnote ink-3">{DISCLAIMER.vs_limp}</p>}

      {step && explanation && (
        <div className="atlas__more">
          <button type="button" className="ui-explain__more-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            <span>해설 전체 보기</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {expanded && (
            <div className="atlas__more-body">
              <ExplanationBody step={step} explanation={explanation} />
              {flagged ? (
                <p className="charts-sheet__done t-callout" role="status">
                  <IconCheck />
                  헷갈려요로 표시했어요
                </p>
              ) : (
                <CapsuleButton tone="unsure" size="md" block onClick={flag}>
                  이 핸드 헷갈려요로 표시
                </CapsuleButton>
              )}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
