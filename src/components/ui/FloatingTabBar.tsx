import type { CSSProperties, ReactNode } from 'react';

export type TabId = 'home' | 'train' | 'quiz' | 'charts';

export interface FloatingTabBarProps {
  items: Array<{ id: TabId; label: string; icon: ReactNode }>;
  active: TabId;
  onChange(id: TabId): void;
  hidden?: boolean;
}

/** Floating glass capsule tab bar (§3.1): 64 high, inset 16, tinted pill glides to the active column. */
export function FloatingTabBar({ items, active, onChange, hidden }: FloatingTabBarProps): JSX.Element {
  const index = Math.max(0, items.findIndex((t) => t.id === active));
  const style = { '--n': items.length, '--i': index } as CSSProperties;
  return (
    <nav className={`ui-tabbar glass-strong${hidden ? ' ui-tabbar--hidden' : ''}`} aria-label="메뉴" aria-hidden={hidden || undefined} style={style}>
      <span className="ui-tabbar__pill glass-tint glass-flat" aria-hidden="true" />
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            className={`ui-tabbar__item${on ? ' ui-tabbar__item--active' : ''}`}
            onClick={() => onChange(t.id)}
            aria-current={on ? 'page' : undefined}
            tabIndex={hidden ? -1 : undefined}
          >
            <span className="ui-tabbar__icon">{t.icon}</span>
            <span className="ui-tabbar__label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
