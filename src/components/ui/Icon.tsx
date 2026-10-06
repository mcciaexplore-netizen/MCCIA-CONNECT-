const PATHS = {
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  ticket: 'M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V6z',
  users: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1',
  'user-group': 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2 20v-.5A5.5 5.5 0 017.5 14h3a5.5 5.5 0 015.5 5.5V20 M16 4.3a3.5 3.5 0 010 6.4 M18.5 14.3a5.5 5.5 0 013.5 5.2V20',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9L7 7 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  logout: 'M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  video: 'M3 7h11v10H3z M14 10l7-3v10l-7-3',
  location: 'M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2',
  check: 'M12 21a9 9 0 100-18 9 9 0 000 18z M8 12l3 3 5-6',
  refresh: 'M20 11a8 8 0 00-14-4L4 9 M4 4v5h5 M4 13a8 8 0 0014 4l2-2 M20 20v-5h-5',
  'user-x': 'M10 12a4 4 0 100-8 4 4 0 000 8z M3 21v-1a6 6 0 016-6h2 M16 16l5 5 M21 16l-5 5',
  'bar-chart': 'M5 20V10 M12 20V4 M19 20v-7',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  alert: 'M12 3l10 18H2L12 3z M12 10v5 M12 18v.5',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-[18px] w-[18px]'}>
      <path d={PATHS[name]} />
    </svg>
  );
}
