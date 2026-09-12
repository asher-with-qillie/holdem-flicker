import type { SVGProps } from 'react';

/** 24px stroke icons (stroke 2, round caps). `<Icon name="home" />` or the named components. */
export type IconName = 'home' | 'cards' | 'quiz' | 'grid' | 'gear' | 'pause' | 'play' | 'close' | 'back' | 'prev' | 'next' | 'more' | 'flame' | 'check' | 'question';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  cards: (
    <>
      <rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-8 8.5 12.5)" />
      <rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15.5 11.5)" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  pause: <path d="M9 5v14M15 5v14" strokeWidth="2.6" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  flame: <path d="M12 2.5c.6 3.6 4.8 5.6 4.8 10.2A4.8 4.8 0 0 1 12 17.5a4.8 4.8 0 0 1-4.8-4.8c0-2.1 1-3.6 2.1-4.7 0 1.6.9 2.6 1.9 2.9C10.6 8.6 10.5 5.6 12 2.5z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
};

export function Icon({ name, size = 24, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}

type Named = Omit<IconProps, 'name'>;
export const IconHome = (p: Named) => <Icon name="home" {...p} />;
export const IconCards = (p: Named) => <Icon name="cards" {...p} />;
export const IconQuiz = (p: Named) => <Icon name="quiz" {...p} />;
export const IconGrid = (p: Named) => <Icon name="grid" {...p} />;
export const IconGear = (p: Named) => <Icon name="gear" {...p} />;
export const IconPause = (p: Named) => <Icon name="pause" {...p} />;
export const IconPlay = (p: Named) => <Icon name="play" {...p} />;
export const IconClose = (p: Named) => <Icon name="close" {...p} />;
export const IconBack = (p: Named) => <Icon name="back" {...p} />;
export const IconPrev = (p: Named) => <Icon name="prev" {...p} />;
export const IconNext = (p: Named) => <Icon name="next" {...p} />;
export const IconMore = (p: Named) => <Icon name="more" {...p} />;
export const IconFlame = (p: Named) => <Icon name="flame" {...p} />;
export const IconCheck = (p: Named) => <Icon name="check" {...p} />;
export const IconQuestion = (p: Named) => <Icon name="question" {...p} />;

export const ICON_NAMES: readonly IconName[] = ['home', 'cards', 'quiz', 'grid', 'gear', 'pause', 'play', 'close', 'back', 'prev', 'next', 'more', 'flame', 'check', 'question'];
