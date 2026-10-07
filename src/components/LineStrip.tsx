import type { CSSProperties } from 'react';
import type { LineDef, LineSentence, MixItem, StripView } from '../poker/line';
import type { Action } from '../poker/types';
import { cellBackground } from './RangeGrid';
import '../styles/linestrip.css';

/**
 * 줄 스트립(docs/EXPLAIN_SPEC.md §3.2). 이 패가 속한 차트 줄 13칸을 13×13 그리드에서 그대로 잘라 와 한 줄로 눕힙니다.
 * 리빌·퀴즈(sm, 21×22 · 297px)와 해설 시트·자리별 보기(md, 23×28 · 323px)가 같은 컴포넌트를 씁니다.
 *
 *   줄 칸(도달)    RangeGrid 와 같은 배경(cellBackground) · 라벨
 *   줄 칸(미도달)  배경 없이 점선 · 흐린 라벨 — "이 상황까지 올 수 없는 패"
 *   유령 칸        다른 줄의 위치. 실선 테두리만, 라벨 없음 — 다른 줄의 색을 칠하면 그 줄로 잘못 읽힙니다
 *   빈칸           커넥터 줄의 맨 앞(아무것도 그리지 않음)
 *   링             이 패. 크기는 그대로, 민트 외곽선만
 *   경계 막대      마지막 계속 칸의 ::after — 레이아웃을 밀지 않습니다
 *
 * 그림 전체가 하나의 이미지(role="img")이고 이름은 줄 문장입니다. 색을 못 읽어도 캡슐 · 문장 · 링이 같은 정보를 글로 전합니다.
 * 칸은 최대 크기로 그리고, 자리가 모자라면(자리별 보기 비교 줄) 13칸이 같이 줄어듭니다.
 */
export function LineStrip({ view, size = 'sm', label, className }: { view: StripView & { def?: LineDef; sentence?: LineSentence | null }; size?: 'sm' | 'md'; label?: string | null; className?: string }) {
  const name = label ?? view.sentence?.text ?? (view.def ? `이 줄 · ${view.def.label}` : undefined);
  return (
    <div className={`lstrip lstrip--${size}${className ? ` ${className}` : ''}`} role="img" aria-label={name}>
      {view.slots.map((slot, i) => {
        const ring = i === view.ring;
        const edge = view.boundaryAfter === i;
        if (slot.role === 'empty') return <span key={i} className="lstrip__cell lstrip__cell--empty" aria-hidden="true" />;
        if (slot.role === 'ghost') return <span key={i} className="lstrip__cell lstrip__cell--ghost" aria-hidden="true" />;
        if (slot.role === 'unreachable') {
          return (
            <span key={i} className={`lstrip__cell lstrip__cell--gated${ring ? ' lstrip__cell--ring' : ''}`} aria-hidden="true">
              {slot.label}
            </span>
          );
        }
        const background = slot.mix ? cellBackground(slot.mix) : undefined;
        const mixed = !!slot.mix && slot.mix.filter((m) => m.weight > 0.0005).length > 1;
        const tone = background === undefined ? 'fold' : mixed ? 'mixed' : 'solid';
        const cls = ['lstrip__cell', `lstrip__cell--${tone}`, ring && 'lstrip__cell--ring', edge && 'lstrip__cell--edge'].filter(Boolean).join(' ');
        return (
          <span key={i} className={cls} style={background ? { background } : undefined} aria-hidden="true">
            {slot.label}
          </span>
        );
      })}
    </div>
  );
}

const ACT_VAR = (a: Action) => `var(--act-${a})`;

/**
 * 답 캡슐(§3.1-A, §3.5). 라벨은 capsuleLabel(`절반만 오픈`, `3벳·콜 반반` …), 색은 1순위 액션.
 * 섞인 칸이고 '섞는 비율 보기'가 켜져 있으면 캡슐 안쪽 아래에 3px 분할 막대(숫자 없음, 레이아웃 변화 없음).
 * sm 32px(리빌·퀴즈, 짧은 화면 28) · md 36px(해설 시트·자리별 보기).
 */
export function LineCapsule({ capsule, size = 'sm', showSplit, className }: { capsule: { label: string; action: Action; split: MixItem[] | null }; size?: 'sm' | 'md'; showSplit: boolean; className?: string }) {
  const style = { '--tint': ACT_VAR(capsule.action) } as CSSProperties;
  const split = showSplit && capsule.split ? cellBackground(capsule.split) : undefined;
  return (
    <span className={`lcap lcap--${size} lcap--${capsule.action} glass-tint glass-flat t-headline${split ? ' lcap--split' : ''}${className ? ` ${className}` : ''}`} style={style}>
      {capsule.label}
      {split && <i className="lcap__split" style={{ background: split }} aria-hidden="true" />}
    </span>
  );
}
