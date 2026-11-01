import type { CSSProperties } from 'react';
import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import { AtlasTile } from '../screens/atlas/SeatStrip';
import '../styles/explain.css';

/**
 * S — 이 패, 자리마다의 답(Duo spec §4 S, §7). 자리 이름(11px) 위, 30px 타일 한 줄 아래. 지금 칸에 민트 링.
 * 해설 본문 ⑥과 훈련·퀴즈의 ctx 칼럼이 같은 줄을 씁니다.
 *
 * `masked` — think 동안: 타일을 중립색 '?' 로 그립니다(행동 색 없음). 자리 이름과 지금 칸의 링은 남습니다.
 * `onPress` — 주면 줄 전체가 버튼(자리별 보기 입구 등). 해설 본문 ⑥처럼 바깥 블록이 이미 버튼이면 주지 마세요(버튼 중첩).
 */
export function SeatChips({ step, explanation, masked, onPress }: { step: Step; explanation: Explanation; masked?: boolean; onPress?: () => void }): JSX.Element {
  const cells = explanation.across.cells;
  const kind = step.scenario.kind;
  const marks = { selected: step.scenario };
  const style = { '--n': cells.length } as CSSProperties;
  const tiles = cells.map((c) => {
    const here = c.scenario.hero === step.scenario.hero && c.scenario.villain === step.scenario.villain;
    return (
      <span key={c.key} className="seatchips__tile">
        <span className="seatchips__seat">{c.scenario.hero}</span>
        {masked ? (
          <span className={`atlas__cell atlas__cell--compact seatchips__q${here ? ' atlas__cell--sel' : ''}`} aria-label={`${c.scenario.hero} · 가림`}>
            ?
          </span>
        ) : (
          <AtlasTile cell={c} kind={kind} marks={marks} compact />
        )}
      </span>
    );
  });
  if (onPress) {
    return (
      <button type="button" className="seatchips seatchips--btn" style={style} onClick={onPress} aria-label={masked ? '이 패, 자리별 답 (가림)' : '이 패, 자리별 답 · 자리별 보기'}>
        {tiles}
      </button>
    );
  }
  return (
    <span className="seatchips" style={style} role="group" aria-label={masked ? '이 패, 자리별 답 (가림)' : '이 패, 자리별 답'}>
      {tiles}
    </span>
  );
}
