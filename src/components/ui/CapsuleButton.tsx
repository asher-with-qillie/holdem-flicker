import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export interface CapsuleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'neutral' | 'ghost' | 'know' | 'unsure' | 'danger' | 'tint';
  //      primary = .glass-tint.glass-solid mint (one per screen); neutral = .glass; ghost = transparent + 1px border;
  //      know = .glass-tint mint; unsure = .glass-tint amber; danger = .glass-tint coral; tint = .glass-tint with `tint`
  tint?: string;
  size?: 'md' | 'lg' | 'xl'; // default 'lg' (min-height md 44, lg 52, xl 56)
  block?: boolean; // width 100%
  icon?: ReactNode; // leading, 20px
  trailing?: ReactNode; // e.g. "· 약 2분" in --ink-2
}

const TONE: Record<NonNullable<CapsuleButtonProps['tone']>, { cls: string; tint?: string }> = {
  primary: { cls: 'glass-tint glass-solid', tint: 'var(--mint)' },
  neutral: { cls: 'glass glass-flat' },
  ghost: { cls: '' },
  know: { cls: 'glass-tint glass-flat', tint: 'var(--mint)' },
  unsure: { cls: 'glass-tint glass-flat', tint: 'var(--amber)' },
  danger: { cls: 'glass-tint glass-flat', tint: 'var(--coral)' },
  tint: { cls: 'glass-tint glass-flat' },
};

/** Capsule button. Glass tones are blur-free (buttons sit on the ground); `primary` is the solid mint fill (one per screen). */
export function CapsuleButton({ tone = 'neutral', tint, size = 'lg', block, icon, trailing, className, style, children, type = 'button', ...rest }: CapsuleButtonProps): JSX.Element {
  const t = TONE[tone];
  const color = tint ?? t.tint;
  const cls = ['ui-btn', `ui-btn--${tone}`, `ui-btn--${size}`, t.cls, 'glass-press', block ? 'ui-btn--block' : '', className ?? ''].filter(Boolean).join(' ');
  const merged: CSSProperties | undefined = color ? ({ ...style, '--tint': color } as CSSProperties) : style;
  return (
    <button type={type} className={cls} style={merged} {...rest}>
      {icon && <span className="ui-btn__icon">{icon}</span>}
      <span className="ui-btn__label">{children}</span>
      {trailing && <span className="ui-btn__trailing">{trailing}</span>}
    </button>
  );
}
