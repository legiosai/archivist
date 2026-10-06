// A handful of line icons (24×24, stroke = currentColor), inline so the page needs nothing else.
const paths = {
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
  upload: <><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  library: <><rect x="3" y="4" width="4.5" height="16" rx="1" /><rect x="9.5" y="4" width="4.5" height="16" rx="1" /><path d="m15.6 5.4 3.4-.9 3.4 14.6-3.4.9z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  back: <path d="M15 5 8 12l7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="m10 16-4-4 4-4" /><path d="M6 12h10" /></>,
  shield: <><path d="M12 3 4.5 6v6c0 4.5 3.2 7.9 7.5 9 4.3-1.1 7.5-4.5 7.5-9V6z" /></>,
  wifi: <><path d="M2 8.5a15 15 0 0 1 20 0" /><path d="M5.5 12.2a10 10 0 0 1 13 0" /><path d="M9 15.8a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  sort: <><path d="M7 4v16" /><path d="m3 16 4 4 4-4" /><path d="M14 6h7" /><path d="M14 12h5" /><path d="M14 18h3" /></>,
  file: <><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5" /></>,
  captions: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6" /><path d="M17 10.2a2.4 2.4 0 1 0 0 3.6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="9.5" r="1.8" /><path d="m21 16-5.5-5.5L5 20" /></>,
  trash: <><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6 7l1 13h10l1-13" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
  folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  sliders: <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h4" /><path d="M12 17h8" /><circle cx="10" cy="17" r="2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  flame: <path d="M12 21c4 0 6.5-2.7 6.5-6.3 0-3.4-2.3-5.5-3.7-7.6-.5 1.7-1.4 2.8-2.5 3.3.2-2.7-.6-5.3-3-7.4.3 3.5-4.8 6-4.8 11.4C4.5 18.3 7.7 21 12 21z" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
  );
}

/** The bookmark mark of the brand. */
export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 13 15"><path d="M0 0h13v15l-6.5-3.7L0 15z" fill="#1b1306" /></svg>
    </span>
  );
}
