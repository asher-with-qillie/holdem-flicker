export interface SwitchProps {
  checked: boolean;
  onChange(v: boolean): void;
  /** aria-label */
  label: string;
  disabled?: boolean;
}

/** 52×30 capsule switch, knob 24, on = --mint, 150 ms. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ui-switch${checked ? ' ui-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__knob" aria-hidden="true" />
    </button>
  );
}
