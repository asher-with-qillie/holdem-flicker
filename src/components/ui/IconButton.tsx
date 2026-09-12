import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** aria-label, required */
  label: string;
  size?: 44 | 40;
  tone?: 'glass' | 'ghost' | 'accent';
  active?: boolean;
}

/** Circular glass icon button (44×44 default, icon 22px), blur-free (small control). `active` renders the mint tint and aria-pressed. */
export function IconButton({ icon, label, size = 44, tone = 'glass', active, className, type = 'button', ...rest }: IconButtonProps): JSX.Element {
  const tinted = tone === 'accent' || active;
  const cls = ['ui-ibtn', `ui-ibtn--${size}`, `ui-ibtn--${tone}`, tinted ? 'glass-tint glass-flat ui-ibtn--tinted' : tone === 'glass' ? 'glass glass-flat' : '', 'glass-press', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active} {...rest}>
      {icon}
    </button>
  );
}
