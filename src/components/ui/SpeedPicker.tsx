import { SPEED_PRESETS, SPEED_PRESET_ORDER, useSettings, type SpeedPreset } from '../../state/settings';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';

export type { SpeedPreset } from '../../state/settings';

export interface SpeedPickerProps {
  value: SpeedPreset;
  onChange(v: SpeedPreset): void;
  exposure: boolean;
  onExposureChange(v: boolean): void;
  showCustom?: boolean; // adds "사용자" segment only when settings.speedPreset === 'custom'
}

function fmtSec(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : Number(s.toFixed(2))}초`;
}

/** Preset segments + live caption ("생각 3.5초 · 답 2.5초") + 노출 모드 switch row. */
export function SpeedPicker({ value, onChange, exposure, onExposureChange, showCustom }: SpeedPickerProps): JSX.Element {
  // Only the 'custom' caption needs the seconds sliders; presets are pure.
  const [settings] = useSettings();
  const options: Array<{ value: SpeedPreset; label: string }> = SPEED_PRESET_ORDER.map((p) => ({ value: p, label: SPEED_PRESETS[p].label }));
  if (showCustom || value === 'custom') options.push({ value: 'custom', label: '사용자' });

  const timing =
    value === 'custom'
      ? { think: settings.thinkSeconds * 1000, reveal: settings.revealSeconds * 1000, expose: settings.revealSeconds * 1000 }
      : SPEED_PRESETS[value];
  const caption = exposure ? `노출 ${fmtSec(timing.expose)} · 생각 없이 바로 답` : `생각 ${fmtSec(timing.think)} · 답 ${fmtSec(timing.reveal)}`;

  return (
    <div className="ui-speed">
      <SegmentedControl options={options} value={value} onChange={onChange} size={48} ariaLabel="속도" />
      <p className="ui-speed__cap tnum" aria-live="polite">
        {caption}
      </p>
      <div className="ui-speed__row">
        <span className="ui-speed__text">
          <span className="ui-speed__label">노출 모드</span>
          <span className="ui-speed__hint">답을 처음부터 같이 봐요</span>
        </span>
        <Switch checked={exposure} onChange={onExposureChange} label="노출 모드" />
      </div>
    </div>
  );
}
