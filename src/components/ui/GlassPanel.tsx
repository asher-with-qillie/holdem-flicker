import { createElement, type CSSProperties, type HTMLAttributes } from 'react';

export interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  variant?: 'regular' | 'strong' | 'tint' | 'clear'; // default 'regular'
  tint?: string; // CSS color for variant 'tint' (default var(--mint))
  radius?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'capsule'; // default 'lg'
  padding?: 0 | 12 | 16 | 20; // default 16
  interactive?: boolean; // adds .glass-press
  as?: 'div' | 'section' | 'nav' | 'header' | 'button'; // default 'div'
}

const VARIANT_CLASS = { regular: 'glass', strong: 'glass-strong', tint: 'glass-tint', clear: 'glass-clear' } as const;

/** Translucent surface using the .glass* recipes from global.css. Radius/padding follow the concentric rule (§2.1). */
export function GlassPanel({ variant = 'regular', tint, radius = 'lg', padding = 16, interactive, as = 'div', className, style, children, ...rest }: GlassPanelProps): JSX.Element {
  const cls = ['ui-panel', VARIANT_CLASS[variant], `ui-r-${radius}`, `ui-p-${padding}`, interactive ? 'glass-press' : '', className ?? ''].filter(Boolean).join(' ');
  const merged: CSSProperties | undefined = tint ? ({ ...style, '--tint': tint } as CSSProperties) : style;
  const props: Record<string, unknown> = { className: cls, style: merged, ...rest };
  if (as === 'button' && !('type' in rest)) props.type = 'button';
  return createElement(as, props, children);
}
