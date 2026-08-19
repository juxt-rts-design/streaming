import type { ReactNode } from 'react';

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconLive({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="13" rx="2" />
      <path d="M10 9.5v5l4.5-2.5L10 9.5z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSport({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c2.5 3 2.5 15 0 18M3 12h18" />
    </Svg>
  );
}

export function IconCinema({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16v10H4z" />
      <path d="M8 7v10M12 7v10M16 7v10" />
    </Svg>
  );
}

export function IconKids({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c.6-3 2.8-5 6-5s5.4 2 6 5" />
    </Svg>
  );
}

export function IconInfo({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function IconMusic({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4.5 4.5" />
    </Svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 7l10 10M17 7L7 17" />
    </Svg>
  );
}

export type NavIconName = 'live' | 'sport' | 'cinema' | 'kids' | 'info' | 'music' | 'search';

const NAV_ICON_MAP = {
  live: IconLive,
  sport: IconSport,
  cinema: IconCinema,
  kids: IconKids,
  info: IconInfo,
  music: IconMusic,
  search: IconSearch,
} as const;

export function NavIcon({ name, className = 'h-5 w-5' }: { name: NavIconName; className?: string }) {
  const Icon = NAV_ICON_MAP[name];
  return <Icon className={className} />;
}

export function NavIconBox({ name, active = false }: { name: NavIconName; active?: boolean }) {
  return (
    <span
      className={[
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
        active
          ? 'border-juxt-primary/45 bg-juxt-primary/18 text-juxt-primary'
          : 'border-juxt-primary/15 bg-juxt-primary/8 text-juxt-primary',
      ].join(' ')}
    >
      <NavIcon name={name} className="h-[18px] w-[18px]" />
    </span>
  );
}
