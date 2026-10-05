import type { ReactNode } from 'react';

// Drawn by hand to share one weight and one grid. All decorative: the text beside an icon names it.

function Icon({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PlayIcon() {
  return (
    <Icon>
      <path d="M4 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon>
      <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />
    </Icon>
  );
}

export function RestartIcon() {
  return (
    <Icon>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 2v3.5H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function TrashIcon() {
  return (
    <Icon>
      <path
        d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function ClientIcon() {
  return (
    <Icon size={16}>
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      <path
        d="M11.2 4.8a4.5 4.5 0 0 1 0 6.4M4.8 11.2a4.5 4.5 0 0 1 0-6.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </Icon>
  );
}

export function ServiceIcon() {
  return (
    <Icon size={16}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6.5h6M5 9.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </Icon>
  );
}

/** The load line mark painted on a ship's side: a ring with a line through its centre. */
export function LoadMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M1.5 12h21" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
