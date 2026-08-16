/**
 * Inline SVG icons.
 *
 * Deliberately not SF Symbols glyphs: those live in a private-use range and
 * render as tofu whenever the font falls back. These always draw.
 */

const PATHS: Record<string, React.ReactNode> = {
  today: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  upcoming: (
    <>
      <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="2.4" />
      <path d="M5.2 1.8v2.6M10.8 1.8v2.6M2.4 6.6h11.2" />
    </>
  ),
  all: <path d="M2.6 4.5h10.8M2.6 8h10.8M2.6 11.5h10.8" />,
  done: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <path d="M5.2 8.2l2 2 3.6-4" />
    </>
  ),
  folder: <path d="M1.8 4.4a1.6 1.6 0 011.6-1.6h2.3l1.4 1.7h5.5a1.6 1.6 0 011.6 1.6v5.5a1.6 1.6 0 01-1.6 1.6H3.4a1.6 1.6 0 01-1.6-1.6z" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
    </>
  ),
  moon: <path d="M13.2 9.6A5.8 5.8 0 016.4 2.8a5.9 5.9 0 106.8 6.8z" />,
  auto: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <path d="M8 1.9v12.2a6.1 6.1 0 000-12.2z" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  close: <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />,
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.5 10.5l3 3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
