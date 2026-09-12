import { POSITIONS, POS_INDEX, type Pos, type Scenario } from '../poker/types';
import { heroInPosition } from '../poker/scenarios';
import '../styles/table.css';

/**
 * Linear position strip (replaces the oval table): the six seats in preflop order,
 * the hero highlighted, action tags under each seat, and a one-line caption such as
 * "앞 3명 폴드 · 뒤 1명 남음". Same props as before so screens need no changes.
 */

type Role = 'hero' | 'villain' | 'folded' | 'waiting';
type Tag = '오픈' | '3벳' | '4벳' | '올인' | '폴드' | '대기' | '나';

interface Seat {
  pos: Pos;
  role: Role;
  tags: Tag[];
}

const TAG_CLASS: Record<Tag, string> = {
  오픈: 'pstrip__tag--raise',
  '3벳': 'pstrip__tag--threebet',
  '4벳': 'pstrip__tag--fourbet',
  올인: 'pstrip__tag--allin',
  폴드: 'pstrip__tag--fold',
  대기: 'pstrip__tag--wait',
  나: 'pstrip__tag--hero',
};

export function seatsFor(s: Scenario): Seat[] {
  const hero = s.hero;
  const v = s.villain;
  const hi = POS_INDEX[hero];
  const opener = s.extras?.opener;
  const threeBettor = s.extras?.threeBettor;
  return POSITIONS.map((pos): Seat => {
    const i = POS_INDEX[pos];
    if (pos === hero) {
      const tags: Tag[] = s.kind === 'vs_3bet' ? ['오픈'] : s.kind === 'vs_4bet' ? ['3벳'] : s.kind === 'vs_5bet' ? ['오픈', '4벳'] : [];
      return { pos, role: 'hero', tags };
    }
    if (v && pos === v) {
      const tags: Tag[] = s.kind === 'vs_open' ? ['오픈'] : s.kind === 'vs_3bet' ? ['3벳'] : s.kind === 'vs_4bet' ? ['오픈', '4벳'] : ['3벳', '올인'];
      return { pos, role: 'villain', tags };
    }
    if (s.kind === 'cold_4bet') {
      if (pos === opener) return { pos, role: 'villain', tags: ['오픈'] };
      if (pos === threeBettor) return { pos, role: 'villain', tags: ['3벳'] };
    }
    const everyoneActed = s.kind === 'vs_3bet' || s.kind === 'vs_4bet' || s.kind === 'vs_5bet';
    if (i < hi || everyoneActed) return { pos, role: 'folded', tags: ['폴드'] };
    return { pos, role: 'waiting', tags: ['대기'] };
  });
}

export function captionFor(s: Scenario): string {
  const seats = seatsFor(s);
  const hi = POS_INDEX[s.hero];
  const foldedBefore = seats.filter((x) => x.role === 'folded' && POS_INDEX[x.pos] < hi).length;
  const waiting = seats.filter((x) => x.role === 'waiting');
  const waitingText = waiting.length ? `뒤 ${waiting.length}명 남음 (${waiting.map((x) => x.pos).join('·')})` : '뒤에 아무도 없음';
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return `${foldedBefore ? `앞 ${foldedBefore}명 폴드` : '앞에 아무도 없음'} · ${waitingText}`;
    case 'vs_open':
      return `${v} 오픈${foldedBefore ? ` · 사이 ${foldedBefore}명 폴드` : ''} · ${waitingText}`;
    case 'vs_3bet':
      return `내 오픈 → ${v} 3벳 · 나머지 폴드 · 헤즈업`;
    case 'vs_4bet':
      return `${v} 오픈 → 내 3벳 → ${v} 4벳 · 헤즈업`;
    case 'vs_5bet':
      return `내 오픈 → ${v} 3벳 → 내 4벳 → ${v} 올인`;
    case 'cold_4bet':
      return `${s.extras?.opener ?? '앞'} 오픈 → ${s.extras?.threeBettor ?? '앞'} 3벳 · ${waitingText}`;
  }
}

function postflopHint(s: Scenario): string | null {
  const v = s.villain ?? (s.kind === 'cold_4bet' ? s.extras?.threeBettor : undefined);
  if (!v) return s.kind === 'rfi' && s.hero === 'SB' ? '플랍 이후 아웃오브포지션' : null;
  return heroInPosition(s.hero, v) ? '플랍 이후 인포지션' : '플랍 이후 아웃오브포지션';
}

export function TableDiagram({ scenario, compact }: { scenario: Scenario; compact?: boolean }) {
  const seats = seatsFor(scenario);
  const hint = postflopHint(scenario);
  return (
    <div className={`pstrip${compact ? ' pstrip--compact' : ''}`} role="img" aria-label={captionFor(scenario)}>
      <div className="pstrip__row">
        {seats.map((seat) => (
          <div key={seat.pos} className={`pstrip__seat pstrip__seat--${seat.role}`}>
            <div className="pstrip__chip">
              {seat.pos}
              {seat.pos === 'BTN' && <span className="pstrip__dealer">D</span>}
            </div>
            <div className="pstrip__tags">
              {seat.role === 'hero' && <span className={`pstrip__tag ${TAG_CLASS['나']}`}>나</span>}
              {seat.tags.map((t) => (
                <span key={t} className={`pstrip__tag ${TAG_CLASS[t]}`}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="pstrip__caption">
        <span>{captionFor(scenario)}</span>
        {hint && <span className="pstrip__hint">{hint}</span>}
      </div>
    </div>
  );
}
