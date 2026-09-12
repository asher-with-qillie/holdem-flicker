const svgProps = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'currentColor', 'aria-hidden': true } as const;

export const PauseIcon = () => (
  <svg {...svgProps}>
    <rect x="6" y="5" width="4.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4.5" height="14" rx="1.2" />
  </svg>
);

export const PlayIcon = () => (
  <svg {...svgProps}>
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" />
  </svg>
);

export const PrevIcon = () => (
  <svg {...svgProps}>
    <path d="M16 5.2v13.6a1 1 0 0 1-1.5.86l-11-6.8a1 1 0 0 1 0-1.72l11-6.8A1 1 0 0 1 16 5.2z" />
  </svg>
);

export const NextIcon = () => (
  <svg {...svgProps}>
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" />
  </svg>
);

export const ShuffleIcon = () => (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 7h3.5c2 0 3.3 1 4.5 3 1.2 2 2.5 3 4.5 3H20" />
    <path d="M4 17h3.5c2 0 3.3-1 4.5-3 1.2-2 2.5-3 4.5-3H20" />
    <path d="m17 4 3 3-3 3M17 14l3 3-3 3" />
  </svg>
);
