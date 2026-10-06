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

export function LoadBalancerIcon() {
  return (
    <Icon size={16}>
      <path
        d="M2 8h4M6 8l4-4.5h3.5M6 8h7.5M6 8l4 4.5h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function RateLimiterIcon() {
  return (
    <Icon size={16}>
      <path
        d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5L2.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function CacheIcon() {
  return (
    <Icon size={16}>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </Icon>
  );
}

export function DatabaseIcon() {
  return (
    <Icon size={16}>
      <ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  );
}

/** A globe: copies of files, kept around the world. */
export function CdnIcon() {
  return (
    <Icon size={16}>
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.2 8h11.6M8 2.2c-2.4 2-2.4 9.6 0 11.6M8 2.2c2.4 2 2.4 9.6 0 11.6" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  );
}

/** A bucket. */
export function ObjectStoreIcon() {
  return (
    <Icon size={16}>
      <ellipse cx="8" cy="4" rx="5.3" ry="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.7 4 4.3 13c.2.8 1.8 1.3 3.7 1.3s3.5-.5 3.7-1.3L13.3 4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </Icon>
  );
}

/** A lambda, the letter a function is written with. */
export function FunctionIcon() {
  return (
    <Icon size={16}>
      <path d="M4 2.5h1.6c.8 0 1.3.4 1.6 1.2l3.2 9c.2.5.6.8 1.1.8h.5M7.4 6.5 4 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function QueueIcon() {
  return (
    <Icon size={16}>
      <rect x="1.5" y="5" width="3.5" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.25" y="5" width="3.5" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="5" width="3.5" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  );
}

export function WorkerIcon() {
  return (
    <Icon size={16}>
      <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </Icon>
  );
}

export function UndoIcon() {
  return (
    <Icon>
      <path d="M5.5 3 2.5 6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function RedoIcon() {
  return (
    <Icon>
      <path d="m10.5 3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function LockIcon() {
  return (
    <Icon size={12}>
      <path d="M4 7V5a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 7h10v7H3z" fill="currentColor" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="m3 8.5 3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function CrossIcon() {
  return (
    <Icon>
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Icon>
  );
}

/** Points the way a reader of the page's language reads on: it is mirrored where text runs right to left. */
export function ForwardIcon() {
  return (
    <span className="inline-flex rtl:-scale-x-100">
      <Icon>
        <path d="M2.5 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </Icon>
    </span>
  );
}

export function BackIcon() {
  return (
    <span className="inline-flex rtl:-scale-x-100">
      <Icon>
        <path d="M13.5 8h-10M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </Icon>
    </span>
  );
}

/** One of the three marks a level can earn. */
export function StarIcon({ earned, size = 16 }: { earned: boolean; size?: number }) {
  return (
    <Icon size={size}>
      <path
        d="m8 1.6 1.9 4 4.4.6-3.2 3 .8 4.4L8 11.5l-3.9 2.1.8-4.4-3.2-3 4.4-.6L8 1.6Z"
        fill={earned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function BoltIcon() {
  return (
    <Icon>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" fill="currentColor" />
    </Icon>
  );
}
