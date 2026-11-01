import { KIND_LABEL_KO } from '../poker/explain';
import type { Pos, ScenarioKind } from '../poker/types';
import { counts } from '../state/srs';
import { GlassPanel } from './ui/GlassPanel';

/**
 * 상황별로 외운 정도 — 상황 하나에 막대 하나(외웠어요 · 배우는 중, 나머지는 새 카드). 홈의 타일과 같은 기준(`srs.counts`)으로
 * 고른 상황 × 자리만 셉니다. 넓은 화면(land · tall · wide)의 홈과 훈련 셋업에서 남는 칸을 채웁니다:
 * 차트가 얼마나 머리에 들어왔는지가 상황마다 한눈에 보여서, 어느 차트를 더 돌릴지 바로 고를 수 있습니다.
 */
export function KindProgress({ kinds, positions, className }: { kinds: readonly ScenarioKind[]; positions?: readonly Pos[]; className?: string }) {
  const rows = kinds
    .map((k) => {
      const c = counts([k], positions ? [...positions] : undefined);
      return { k, ...c, total: c.learned + c.learning + c.fresh };
    })
    .filter((r) => r.total > 0);
  if (!rows.length) return null;
  const pct = (n: number, t: number) => `${(n / t) * 100}%`;
  return (
    <GlassPanel variant="clear" radius="md" padding={12} className={`kindprog${className ? ` ${className}` : ''}`}>
      <p className="kindprog__h t-footnote">상황별로 외운 정도</p>
      <ul className="kindprog__list">
        {rows.map((r) => (
          <li key={r.k} className="kindprog__row" aria-label={`${KIND_LABEL_KO[r.k]} · 외웠어요 ${r.learned} · 배우는 중 ${r.learning} · 새 카드 ${r.fresh}`}>
            <span className="kindprog__name t-footnote">{KIND_LABEL_KO[r.k]}</span>
            <span className="kindprog__bar" aria-hidden="true">
              <i style={{ width: pct(r.learned, r.total), background: 'var(--mint)' }} />
              <i style={{ width: pct(r.learning, r.total), background: 'var(--amber)' }} />
            </span>
            <span className="kindprog__num t-caption tnum" aria-hidden="true">
              {r.learned}/{r.total}
            </span>
          </li>
        ))}
      </ul>
      <p className="kindprog__legend t-caption" aria-hidden="true">
        <span>
          <i style={{ background: 'var(--mint)' }} /> 외웠어요
        </span>
        <span>
          <i style={{ background: 'var(--amber)' }} /> 배우는 중
        </span>
        <span>
          <i /> 새 카드
        </span>
      </p>
    </GlassPanel>
  );
}
