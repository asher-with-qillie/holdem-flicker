/**
 * 헷갈린다고 표시한 자리 (COACH_SPEC §6.8).
 *
 * 성향 축과 **일부러 섞지 않습니다**. 이 목록은 스와이프 자가평가(헷갈려요)에서 오고 성향 축은
 * 오답에서 오는데, 둘은 모집단이 다릅니다. 한 칸에 합치면 "내가 어렵다고 느낀 것"과 "실제로 틀린 것"이
 * 구별되지 않으므로 섹션 제목이 그 차이를 대신 말해 줍니다.
 */
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconNext } from '../../components/ui/icons';
import type { CoachDigest } from '../../state/coach/types';
import { launch } from '../../state/nav';
import { deckForKind, pct, spotLabel } from '../home/copy';

type Spot = CoachDigest['weakSpots'][number];

export function WeakSpotList({ spots }: { spots: Spot[] }): JSX.Element {
  const go = (s: Spot) => launch({ target: 'train', deck: deckForKind(s.kind), positions: [s.hero], autostart: true });
  return (
    <section className="coach-section" aria-label="헷갈린다고 표시한 자리">
      <header className="coach-sec">
        <h2 className="t-title-3">헷갈린다고 표시한 자리</h2>
      </header>
      <GlassPanel className="glass-flat" radius="lg" padding={12}>
        <ul className="coach-spots">
          {spots.map((s) => {
            const label = spotLabel(s.kind, s.hero);
            return (
              <li key={`${s.kind}:${s.hero}`}>
                <button type="button" className="coach-spot" onClick={() => go(s)} aria-label={`${label} 이 상황만 훈련`}>
                  <span className="coach-spot__name">{label}</span>
                  <span className="coach-spot__meta tnum">헷갈려요 {pct(s.unsureRate)}</span>
                  <IconNext size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      </GlassPanel>
    </section>
  );
}
