const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";

export const PAGE_CLASS = "mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-5 md:p-8";
export const NARROW_PAGE_CLASS = "mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-5";
export const TITLE_CLASS = "text-2xl font-semibold text-green";
export const SECTION_TITLE_CLASS = "text-lg font-semibold text-green";
export const PANEL_CLASS = "flex flex-col gap-3 rounded-panel bg-cream-light p-4";
export const STAT_CLASS = "flex flex-col gap-1 rounded-panel bg-cream-light p-4";
export const ROW_CLASS = "flex flex-wrap items-center gap-3 rounded-control bg-cream-light px-3 py-2";
export const MUTED_CLASS = "text-sm text-ink/60";
export const ALERT_CLASS = "rounded-control border-2 border-orange bg-amber/20 px-3 py-2 text-sm font-medium text-ink";
export const ERROR_CLASS = "text-sm font-medium text-error";
export const CODE_CLASS = "rounded-control bg-green px-3 py-2 font-mono text-2xl tracking-widest text-cream";
export const LINK_CLASS = `underline hover:text-green ${FOCUS}`;

export const BUTTON_CLASS = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-green bg-green px-5 py-2 font-medium text-cream hover:bg-transparent hover:text-green disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const SECONDARY_BUTTON_CLASS = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-green bg-transparent px-5 py-2 font-medium text-green hover:bg-green hover:text-cream disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const ACCENT_BUTTON_CLASS = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-amber bg-amber px-5 py-2 font-medium text-ink hover:bg-transparent hover:text-green disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const SMALL_BUTTON_CLASS = `inline-flex min-h-9 cursor-pointer items-center rounded-control border-2 border-green bg-green px-3 py-1 text-sm font-medium text-cream hover:bg-transparent hover:text-green disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const INPUT_CLASS = `min-h-11 rounded-control border-2 border-green/40 bg-white px-3 py-2 text-ink focus:border-green ${FOCUS}`;
export const DATE_CLASS = `min-h-11 rounded-control border-2 border-green/40 bg-white px-2 py-1 text-base font-normal text-ink focus:border-green ${FOCUS}`;
