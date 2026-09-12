import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ALL_CHART_DEFS, missingScenarios } from '../poker/data';
import { allScenarios } from '../poker/scenarios';
import { POSITIONS, POS_LABEL_KO, SCENARIO_KINDS, SCENARIO_LABEL_KO, type Pos, type ScenarioKind } from '../poker/types';
import { resetSettings, useSettings, vibrate } from '../state/settings';
import { resetStats, useStats } from '../state/stats';
import '../styles/settings.css';

const KIND_HINT_KO: Record<ScenarioKind, string> = {
  rfi: '앞에서 모두 폴드했을 때 오픈할지, 폴드할지',
  vs_open: '앞 포지션이 오픈했을 때 콜·3벳·폴드',
  vs_3bet: '내 오픈에 뒤에서 3벳이 왔을 때 콜·4벳·폴드',
  vs_4bet: '내 3벳에 4벳이 돌아왔을 때 콜·올인·폴드',
  vs_5bet: '내 4벳에 올인이 왔을 때 콜할지, 폴드할지',
  cold_4bet: '앞에서 오픈과 3벳이 모두 나온 뒤 내 차례일 때',
};

const DISCLAIMER = '6-max 100bb 캐시 게임 기준의 근사 GTO 레인지입니다. 실제 솔버 출력은 레이크·사이징에 따라 달라집니다.';

/** "언더더건 (UTG / LJ)" → "언더더건" */
function posKo(p: Pos): string {
  return POS_LABEL_KO[p].replace(/\s*\(.*\)\s*$/, '');
}

function fmtSeconds(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}초`;
}

/** Toggle `item` in `list`, keeping the canonical `order`. */
function toggleIn<T>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const set = new Set(list);
  if (set.has(item)) set.delete(item);
  else set.add(item);
  return order.filter((x) => set.has(x));
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function SwitchRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row srow" onClick={() => onChange(!on)}>
      <span className="srow__text">
        <span className="row__label">{label}</span>
        {hint && <span className="row__hint">{hint}</span>}
      </span>
      <span className={`switch${on ? ' switch--on' : ''}`} aria-hidden="true" />
    </button>
  );
}

function Slider({
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
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="slider">
      <div className="slider__head">
        <span className="row__label">{label}</span>
        <output className="slider__value" aria-live="polite">
          {format(value)}
        </output>
      </div>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="slider__scale" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {hint && <p className="row__hint">{hint}</p>}
    </div>
  );
}

export function SettingsScreen() {
  const [s, update] = useSettings();
  const stats = useStats();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  const data = useMemo(() => {
    const missing = missingScenarios();
    const all = allScenarios();
    const missingByKind: Record<ScenarioKind, number> = { rfi: 0, vs_open: 0, vs_3bet: 0, vs_4bet: 0, vs_5bet: 0, cold_4bet: 0 };
    const totalByKind: Record<ScenarioKind, number> = { ...missingByKind };
    for (const sc of missing) missingByKind[sc.kind] += 1;
    for (const sc of all) totalByKind[sc.kind] += 1;
    return { charts: ALL_CHART_DEFS.length, missing: missing.length, total: all.length, missingByKind, totalByKind };
  }, []);

  const togglePos = (p: Pos) => {
    const next = toggleIn(s.positions, p, POSITIONS);
    if (next.length === 0) {
      vibrate([20, 30, 20]);
      setNotice('포지션은 최소 1개 이상 선택해야 합니다');
      return;
    }
    update({ positions: next });
  };

  const toggleKind = (k: ScenarioKind) => {
    const next = toggleIn(s.kinds, k, SCENARIO_KINDS);
    if (next.length === 0) {
      vibrate([20, 30, 20]);
      setNotice('상황 종류는 최소 1개 이상 선택해야 합니다');
      return;
    }
    update({ kinds: next });
  };

  const onResetStats = () => {
    if (!window.confirm('퀴즈 기록을 모두 지울까요?\n정답률, 연속 정답, 최근 실수 목록이 삭제됩니다.')) return;
    resetStats();
    vibrate(12);
    setNotice('기록을 초기화했습니다');
  };

  const onResetSettings = () => {
    if (!window.confirm('모든 설정을 기본값으로 되돌릴까요?')) return;
    resetSettings();
    vibrate(12);
    setNotice('설정을 기본값으로 되돌렸습니다');
  };

  return (
    <div className="screen settings">
      <div>
        <h1 className="screen__title">설정</h1>
        <p className="screen__sub">훈련과 퀴즈에 바로 적용됩니다.</p>
      </div>

      <section className="panel" aria-labelledby="st-pos">
        <h2 className="panel__title" id="st-pos">
          <span>포지션</span>
          <span className="panel__count">
            {s.positions.length}/{POSITIONS.length} 선택
          </span>
        </h2>
        <div className="poschips" role="group" aria-label="훈련할 포지션">
          {POSITIONS.map((p) => {
            const on = s.positions.includes(p);
            return (
              <button key={p} type="button" className={`chip poschip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => togglePos(p)}>
                <span className="poschip__pos">{p}</span>
                <span className="poschip__ko">{posKo(p)}</span>
              </button>
            );
          })}
        </div>
        <p className="panel__foot">선택한 포지션이 내 자리(히어로)가 됩니다. 최소 1개 이상 선택하세요.</p>
      </section>

      <section className="panel" aria-labelledby="st-kind">
        <h2 className="panel__title" id="st-kind">
          <span>상황 종류</span>
          <span className="panel__count">
            {s.kinds.length}/{SCENARIO_KINDS.length} 선택
          </span>
        </h2>
        <div className="kindchips" role="group" aria-label="훈련할 상황 종류">
          {SCENARIO_KINDS.map((k) => {
            const on = s.kinds.includes(k);
            const ready = data.totalByKind[k] - data.missingByKind[k];
            const tag = ready === 0 ? '준비 중' : ready < data.totalByKind[k] ? `${ready}/${data.totalByKind[k]}` : null;
            return (
              <button key={k} type="button" className={`chip kchip${on ? ' chip--on kchip--on' : ''}`} aria-pressed={on} onClick={() => toggleKind(k)}>
                <span className="kchip__check">
                  <CheckIcon />
                </span>
                <span className="kchip__text">
                  <span className="kchip__head">
                    <span className="kchip__label">{SCENARIO_LABEL_KO[k]}</span>
                    {tag && <span className="kchip__tag">{tag}</span>}
                  </span>
                  <span className="kchip__hint">{KIND_HINT_KO[k]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel" aria-labelledby="st-timer">
        <h2 className="panel__title" id="st-timer">
          타이머
        </h2>
        <Slider label="생각 시간" value={s.thinkSeconds} min={1} max={10} step={0.5} format={fmtSeconds} onChange={(v) => update({ thinkSeconds: v })} />
        <Slider
          label="정답 표시"
          hint="정답이 보인 뒤 다음 단계로 넘어가기까지의 시간"
          value={s.revealSeconds}
          min={1}
          max={8}
          step={0.5}
          format={fmtSeconds}
          onChange={(v) => update({ revealSeconds: v })}
        />
        <SwitchRow label="자동 진행" hint="끄면 정답을 본 뒤 '다음'을 눌러야 넘어갑니다" on={s.autoAdvance} onChange={(v) => update({ autoAdvance: v })} />
      </section>

      <section className="panel" aria-labelledby="st-opt">
        <h2 className="panel__title" id="st-opt">
          옵션
        </h2>
        <Slider
          label="플레이 가능 핸드 비율"
          hint="높을수록 뻔한 폴드 핸드가 덜 나오고, 경계선 핸드가 더 자주 나옵니다"
          value={Math.round(s.interestingBias * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ interestingBias: v / 100 })}
        />
        <SwitchRow label="혼합 빈도 표시" hint="정답에 혼합 비율을 함께 표시 (예: 3벳 75% · 콜 25%)" on={s.showMixFrequencies} onChange={(v) => update({ showMixFrequencies: v })} />
        <SwitchRow label="진동" hint="정답 공개·오답 시 짧게 진동합니다" on={s.haptics} onChange={(v) => update({ haptics: v })} />
      </section>

      <section className="panel" aria-labelledby="st-data">
        <h2 className="panel__title" id="st-data">
          데이터
        </h2>
        <div className="datarows">
          <div className="datarow">
            <span>총 차트 수</span>
            <span className="datarow__value">{data.charts}개</span>
          </div>
          <div className="datarow">
            <span>준비 중 차트 수</span>
            <span className={`datarow__value ${data.missing === 0 ? 'datarow__value--ok' : 'datarow__value--warn'}`}>
              {data.missing === 0 ? '없음' : `${data.missing}개`}
              <span className="datarow__total"> / {data.total}</span>
            </span>
          </div>
        </div>
        <p className="disclaimer">{DISCLAIMER}</p>
      </section>

      <section className="panel" aria-labelledby="st-reset">
        <h2 className="panel__title" id="st-reset">
          초기화
        </h2>
        <div className="resets">
          <button type="button" className="btn btn--block btn--danger" onClick={onResetStats}>
            기록 초기화{stats.total > 0 ? ` (${stats.total}문제)` : ''}
          </button>
          <button type="button" className="btn btn--block" onClick={onResetSettings}>
            설정 초기화
          </button>
        </div>
      </section>

      <p className="settings__notice" role="status" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
