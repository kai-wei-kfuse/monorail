import type { ReactElement } from 'react';

// 16×16 网格上的直角图标（UI风格规范 §4），取自参考实现的 sprite。
const S = { fill: 'none', stroke: 'currentColor' } as const;
const PATHS = {
  play: <path fill="currentColor" d="M4.5 2.6v10.8L13.2 8z" />,
  pause: <path fill="currentColor" d="M3.8 3h3v10h-3zM9.2 3h3v10h-3z" />,
  check: <path {...S} strokeWidth="1.8" d="M2.8 8.4 6.4 12l6.8-7.6" />,
  shrink: <path {...S} strokeWidth="1.7" d="M2.5 13.5 6.8 9.2M7 13.2V9H2.8M13.5 2.5 9.2 6.8M9 2.8V7h4.2" />,
  expand: <path {...S} strokeWidth="1.7" d="M6.8 9.2 2.5 13.5M2.5 9.3v4.2h4.2M9.2 6.8l4.3-4.3M9.3 2.5h4.2v4.2" />,
  swap: <path {...S} strokeWidth="1.7" d="M2 5.5h10.5M9.8 2.7l2.8 2.8-2.8 2.8M14 10.5H3.5M6.2 7.7l-2.8 2.8 2.8 2.8" />,
  plus: <path {...S} strokeWidth="1.7" d="M8 2.5v11M2.5 8h11" />,
  x: <path {...S} strokeWidth="1.6" d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  chev: <path {...S} strokeWidth="1.8" d="M3.5 10.2 8 5.7l4.5 4.5" />,
  min: <path {...S} strokeWidth="1.2" d="M2.5 8.5h11" />,
  max: <path {...S} strokeWidth="1.2" d="M3.1 3.1h9.8v9.8H3.1z" />,
  restore: <path {...S} strokeWidth="1.2" d="M5.6 3.1h7.3v7.3M3.1 5.6h7.3v7.3H3.1z" />,
  pin: <path {...S} strokeWidth="1.4" strokeLinejoin="round" d="M5.5 1.8h5l-.8 4.4 2.5 2.4v1.2H3.8V8.6l2.5-2.4zM8 9.8v4.6" />,
  folder: <path fill="currentColor" d="M1.5 3h5l1.6 1.6h6.4V13h-13z" />,
  wc: <path fill="currentColor" d="M3 1.5h4.2v6.8H3zM2 8.6h12v1.5H2zM3 10.6h10c-.2 1.8-1.5 3-3.3 3.3l.5 1.6H5.6l.5-1.8C4.4 13.3 3.2 12.2 3 10.6z" />,
  stretch: <><circle cx="8" cy="2.7" r="1.7" fill="currentColor" /><path {...S} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M3.6 2.8 8 6.6l4.4-3.8M8 6.6v3.9M8 10.5 5.6 14.8M8 10.5l2.4 4.3" /></>,
  parcel: <path fill="currentColor" fillRule="evenodd" d="M1.5 3.2h13v2.6h-13zM2.3 6.6h11.4v7.9H2.3zM6.9 3.2h2.2v6.1H6.9zM9.9 11h2.5v2.1H9.9z" />,
  meal: <><path fill="currentColor" d="M1.5 8h13c0 3.1-2.3 5.4-5.2 5.9v1.3H6.7v-1.3C3.8 13.4 1.5 11.1 1.5 8zM3.8 7.2C4.3 5.4 6 4.2 8 4.2s3.7 1.2 4.2 3z" /><path {...S} strokeWidth="1.2" strokeLinecap="round" d="M9.4 6.4 13.6 1.2M11 6.6l3.9-3.9" /></>,
  break: <><path fill="currentColor" d="M1.8 6.2h9.7v4.2c0 2.5-2 4.6-4.6 4.6h-.5c-2.6 0-4.6-2.1-4.6-4.6z" /><path {...S} strokeWidth="1.5" d="M11.5 7.8h1.2a1.9 1.9 0 0 1 0 3.8h-1.5" /><path {...S} strokeWidth="1.2" strokeLinecap="round" d="M4.8 1.2c-.8 1 .8 1.9 0 3.1M8.4 1.2c-.8 1 .8 1.9 0 3.1" /></>,
  sleep: <path fill="currentColor" d="M9.6 1.6A6.6 6.6 0 1 0 14.4 10 5.4 5.4 0 0 1 9.6 1.6z" />,
  logo: <><path style={{ fill: 'var(--yellow)' }} d="M.6 2h14.8L8 15.2z" /><path {...S} stroke="#161616" strokeWidth="1.15" d="M3.2 4.9c1.6-.8 3.1.7 4.8 0s2.9-.6 4.8-.1M5.2 8.1c1-.5 2 .5 3 0s1.8-.3 2.7 0" /></>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** 两个 ▼ 叠在一起，用在竖排标签条上（viewBox 10×14）。 */
export function Tri2({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 10 14" aria-hidden="true"><path fill="currentColor" d="M0 0h10L5 5.6zM0 7h10l-5 5.6z" /></svg>;
}

export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return <svg className={className} viewBox="0 0 16 16" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{PATHS[name]}</svg>;
}
