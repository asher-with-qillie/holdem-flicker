/**
 * 설정 (spec §5.9) — pushed from Home ⚙ / trainer setup ⋯.
 *
 * App.tsx owns the push container: it renders the `‹ 뒤로` header (openSettings(false)), the scroller and the
 * slide-in, so this screen renders only the large title and the grouped lists. Confirmations are Sheets, never
 * window.confirm. Panels are blur-free (`glass-flat`) so the screen stays inside the ≤ 3 blurred-surface budget.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { Chip } from '../components/ui/Chip';
import { ChipRow } from '../components/ui/ChipRow';
import { GlassPanel } from '../components/ui/GlassPanel';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Sheet } from '../components/ui/Sheet';
import { SpeedPicker } from '../components/ui/SpeedPicker';
import { Switch } from '../components/ui/Switch';
import { toast } from '../components/ui/Toast';
import { IconCheck, IconNext } from '../components/ui/icons';
import { ALL_CHART_DEFS, missingScenarios } from '../poker/data';
import { POSITIONS, SCENARIO_KINDS, type Pos, type ScenarioKind } from '../poker/types';
import { resetProgress } from '../state/progress';
import { applySpeedPreset, COACH_VERSION, resetSettings, REVEAL_SECONDS_RANGE, THINK_SECONDS_RANGE, useSettings, type Settings } from '../state/settings';
import { resetSrs } from '../state/srs';
import { resetStats, useStats } from '../state/stats';
import '../styles/settings.css';

type Goal = Settings['dailyGoal'];
type Size = Settings['sessionSize'];
const GOALS: readonly Goal[] = [10, 20, 40, 80];
const SIZES: readonly Size[] = [10, 20, 40];

/** Short deck-style labels (§5.9 wireframe); the long SCENARIO_LABEL_KO strings stay on the charts screen. */
const KIND_SHORT: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '올인 대응',
  cold_4bet: '콜드 4벳',
};

const MIN_HINT = '최소 1개는 남겨야 해요';

type ConfirmKind = 'records' | 'settings';
const CONFIRM: Record<ConfirmKind, { title: string; body: string; cta: string; tone: 'danger' | 'primary' }> = {
  records: {
    title: '학습 기록을 지울까요?',
    body: '카드 평가와 복습 일정, 연속 기록, 퀴즈 기록이 모두 사라져요. 되돌릴 수 없어요.',
    cta: '지우기',
    tone: 'danger',
  },
  settings: {
    title: '설정을 처음으로 되돌릴까요?',
    body: '포지션·상황·속도·목표가 기본값으로 돌아가요. 학습 기록은 그대로예요.',
    cta: '되돌리기',
    tone: 'primary',
  },
};

function fmtSec(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}초`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ---------------------------------------------------------------- list primitives */

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="st-group" aria-labelledby={id}>
      <h2 className="st-group__cap" id={id}>
        {title}
      </h2>
      <GlassPanel radius="md" padding={12} className="st-panel glass-flat">
        {children}
      </GlassPanel>
    </section>
  );
}

function Row({ label, hint, hintTone, stack, className, children }: { label: string; hint?: string; hintTone?: 'mint'; stack?: boolean; className?: string; children?: ReactNode }) {
  return (
    <div className={`st-row${stack ? ' st-row--stack' : ''}${className ? ` ${className}` : ''}`}>
      <div className="st-row__text">
        <span className="st-row__label">{label}</span>
        {hint && <span className={`st-row__hint${hintTone ? ` st-row__hint--${hintTone}` : ''}`}>{hint}</span>}
      </div>
      {children !== undefined && <div className="st-row__ctl">{children}</div>}
    </div>
  );
}

function ActionRow({ label, hint, hintTone, danger, onClick }: { label: string; hint?: string; hintTone?: 'mint'; danger?: boolean; onClick(): void }) {
  return (
    <button type="button" className={`st-row st-row--btn${danger ? ' st-row--danger' : ''}`} onClick={onClick}>
      <span className="st-row__text">
        <span className="st-row__label">{label}</span>
        {hint && <span className={`st-row__hint${hintTone ? ` st-row__hint--${hintTone}` : ''}`}>{hint}</span>}
      </span>
      <span className="st-row__trail">
        <IconNext size={20} />
      </span>
    </button>
  );
}

function RangeRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="st-row st-row--stack st-row--range">
      <div className="st-row__head">
        <span className="st-row__label">{label}</span>
        <output className="st-row__out tnum" aria-live="polite">
          {format(value)}
        </output>
      </div>
      <input
        type="range"
        className="st-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="st-row__hint">{hint}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- screen */

export function SettingsScreen(): JSX.Element {
  const [s, update] = useSettings();
  const stats = useStats();
  const reduced = usePrefersReducedMotion();
  const [advOpen, setAdvOpen] = useState(() => s.speedPreset === 'custom');
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [minHint, setMinHint] = useState<'positions' | 'kinds' | null>(null);
  // keeps the last sheet content mounted through its 220 ms exit
  const shownConfirm = useRef<ConfirmKind>('records');
  if (confirm) shownConfirm.current = confirm;

  const data = useMemo(() => ({ charts: ALL_CHART_DEFS.length, missing: missingScenarios().length }), []);

  useEffect(() => {
    if (!minHint) return;
    const t = window.setTimeout(() => setMinHint(null), 1800);
    return () => window.clearTimeout(t);
  }, [minHint]);

  const togglePos = (p: Pos) => {
    const on = s.positions.includes(p);
    const next = POSITIONS.filter((x) => (x === p ? !on : s.positions.includes(x)));
    if (next.length === 0) {
      setMinHint('positions');
      return;
    }
    // the trainer's position subset must stay inside settings.positions
    const lastPositions = s.lastPositions ? s.lastPositions.filter((x) => next.includes(x)) : null;
    update({ positions: next, lastPositions: lastPositions && lastPositions.length ? lastPositions : null });
  };

  const toggleKind = (k: ScenarioKind) => {
    const on = s.kinds.includes(k);
    const next = SCENARIO_KINDS.filter((x) => (x === k ? !on : s.kinds.includes(x)));
    if (next.length === 0) {
      setMinHint('kinds');
      return;
    }
    update({ kinds: next });
  };

  const replayCoach = () => {
    update({ coachSeen: 0 });
    toast('다음 세션에서 보여드려요', 'mint');
  };

  const runConfirm = () => {
    const kind = confirm;
    setConfirm(null);
    if (kind === 'records') {
      resetSrs();
      resetProgress();
      resetStats();
      toast('학습 기록을 지웠어요');
    } else if (kind === 'settings') {
      resetSettings();
      setAdvOpen(false);
      toast('설정을 되돌렸어요');
    }
  };

  const c = CONFIRM[shownConfirm.current];

  return (
    <div className="screen st">
      <h1 className="t-title-l st-title">설정</h1>

      <Group id="st-train" title="훈련">
        <Row label="하루 목표">
          <div className="st-seg st-seg--4">
            <SegmentedControl options={GOALS.map((g) => ({ value: String(g), label: String(g) }))} value={String(s.dailyGoal)} onChange={(v) => update({ dailyGoal: Number(v) as Goal })} ariaLabel="하루 목표 (장)" />
          </div>
        </Row>
        <Row label="세션 크기 기본">
          <div className="st-seg st-seg--3">
            <SegmentedControl options={SIZES.map((n) => ({ value: String(n), label: String(n) }))} value={String(s.sessionSize)} onChange={(v) => update({ sessionSize: Number(v) as Size })} ariaLabel="세션 크기 (장)" />
          </div>
        </Row>
        <div className="st-row st-row--stack st-speed">
          <span className="st-row__label">기본 속도</span>
          <SpeedPicker value={s.speedPreset} onChange={applySpeedPreset} exposure={s.exposureMode} onExposureChange={(v) => update({ exposureMode: v })} />
        </div>
        <Row label="직접 넘기기" hint="노출·순간기억 모드에서 답을 본 뒤 탭해서 넘겨요">
          <Switch checked={!s.autoAdvance} onChange={(v) => update({ autoAdvance: !v })} label="직접 넘기기 (자동 진행 끄기)" />
        </Row>
        <Row label="혼합 빈도 표시" hint="예: 3벳 75% · 콜 25%">
          <Switch checked={s.showMixFrequencies} onChange={(v) => update({ showMixFrequencies: v })} label="혼합 빈도 표시" />
        </Row>
        <RangeRow
          label="플레이 가능 핸드 비율"
          hint="높을수록 뻔한 폴드 대신 경계선 핸드가 자주 나와요"
          value={Math.round(s.interestingBias * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ interestingBias: v / 100 })}
        />
      </Group>

      <Group id="st-range" title="범위">
        <Row label="포지션" hint="내 자리(히어로)로 나올 포지션" stack className="st-pos">
          <ChipRow wrap ariaLabel="훈련할 포지션">
            {POSITIONS.map((p) => (
              <Chip key={p} size={36} selected={s.positions.includes(p)} onClick={() => togglePos(p)}>
                {p}
              </Chip>
            ))}
          </ChipRow>
          <p className={`st-minhint${minHint === 'positions' ? ' st-minhint--on' : ''}`} role="status" aria-live="polite">
            {minHint === 'positions' ? MIN_HINT : ''}
          </p>
        </Row>
        <Row label="상황" stack className="st-kinds">
          <ChipRow wrap ariaLabel="훈련할 상황 종류">
            {SCENARIO_KINDS.map((k) => {
              const on = s.kinds.includes(k);
              return (
                <Chip key={k} size={36} selected={on} onClick={() => toggleKind(k)} className="st-kind">
                  <span className="st-kind__in">
                    {on && <IconCheck size={14} strokeWidth={3} />}
                    {KIND_SHORT[k]}
                  </span>
                </Chip>
              );
            })}
          </ChipRow>
          <p className={`st-minhint${minHint === 'kinds' ? ' st-minhint--on' : ''}`} role="status" aria-live="polite">
            {minHint === 'kinds' ? MIN_HINT : ''}
          </p>
        </Row>
      </Group>

      <section className="st-group">
        <button type="button" className="st-disclosure" aria-expanded={advOpen} aria-controls="st-adv-panel" onClick={() => setAdvOpen((o) => !o)}>
          <span className="st-group__cap">고급</span>
          <span className="st-disclosure__val">{s.speedPreset === 'custom' ? `생각 ${fmtSec(s.thinkSeconds)} · 답 ${fmtSec(s.revealSeconds)}` : '직접 시간 조절'}</span>
          <IconNext size={18} className={`st-disclosure__chev${advOpen ? ' st-disclosure__chev--open' : ''}`} />
        </button>
        {advOpen && (
          <GlassPanel id="st-adv-panel" radius="md" padding={12} className="st-panel glass-flat">
            <RangeRow label="생각 시간" value={s.thinkSeconds} min={THINK_SECONDS_RANGE.min} max={THINK_SECONDS_RANGE.max} step={0.5} format={fmtSec} onChange={(v) => update({ thinkSeconds: Math.round(v * 10) / 10, speedPreset: 'custom' })} />
            <RangeRow label="답 표시 시간" value={s.revealSeconds} min={REVEAL_SECONDS_RANGE.min} max={REVEAL_SECONDS_RANGE.max} step={0.5} format={fmtSec} onChange={(v) => update({ revealSeconds: Math.round(v * 10) / 10, speedPreset: 'custom' })} />
            <p className="st-foot">조절하면 기본 속도가 ‘사용자’로 바뀌어요</p>
          </GlassPanel>
        )}
      </section>

      <Group id="st-device" title="기기">
        <Row label="진동 (Android)" hint="iOS에서는 지원되지 않아요">
          <Switch checked={s.haptics} onChange={(v) => update({ haptics: v })} label="진동" />
        </Row>
        <Row label="움직임 줄이기" hint={reduced ? '지금 켜져 있어요' : '지금 꺼져 있어요'}>
          <span className="st-row__value">시스템 설정 따름</span>
        </Row>
      </Group>

      <Group id="st-data" title="데이터">
        <Row label={`차트 ${data.charts}개 · 준비 중 ${data.missing}개`} hint="100bb 6-max 캐시 기준 근사치예요" />
        <ActionRow label="사용법 다시 보기" hint={s.coachSeen < COACH_VERSION ? '다음 세션에서 보여드려요' : '꾹 누르기 · 버튼 선택 · 세션 안내'} hintTone={s.coachSeen < COACH_VERSION ? 'mint' : undefined} onClick={replayCoach} />
        <ActionRow label="학습 기록 초기화" hint={stats.total > 0 ? `카드 평가 · 연속 · 퀴즈 ${stats.total}문제` : '카드 평가 · 연속 · 퀴즈 기록'} danger onClick={() => setConfirm('records')} />
        <ActionRow label="설정 초기화" hint="모든 설정을 기본값으로" onClick={() => setConfirm('settings')} />
      </Group>

      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={c.title}
        footer={
          <>
            <CapsuleButton tone="ghost" size="lg" className="st-confirm__btn" onClick={() => setConfirm(null)}>
              취소
            </CapsuleButton>
            <CapsuleButton tone={c.tone} size="lg" className="st-confirm__btn" onClick={runConfirm}>
              {c.cta}
            </CapsuleButton>
          </>
        }
      >
        <p className="st-confirm__body">{c.body}</p>
      </Sheet>
    </div>
  );
}
