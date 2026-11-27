const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const PAGE_CLASS =
  "dashboard-page mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-5 md:gap-8 md:p-10";
export const NARROW_PAGE_CLASS =
  "mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-5";
export const TITLE_CLASS =
  "dashboard-title text-3xl font-semibold tracking-tight text-primary md:text-4xl";
export const SECTION_TITLE_CLASS = "text-lg font-semibold text-primary";
// Tap-to-expand section header; pair with <details>, heading stays inline beside the marker.
export const DISCLOSURE_SUMMARY_CLASS =
  "min-h-11 cursor-pointer py-2 [&>h2]:inline";
export const PANEL_CLASS =
  "dashboard-panel flex flex-col gap-3 rounded-panel border border-primary/15 bg-surface p-5 md:p-6";
export const STAT_CLASS =
  "dashboard-stat flex min-w-0 flex-col gap-3 rounded-panel border border-primary/15 bg-surface p-5 md:p-6";
export const ROW_CLASS =
  "flex flex-wrap items-center gap-3 rounded-control bg-surface px-3 py-2";
export const MUTED_CLASS = "text-sm text-muted";
export const ALERT_CLASS =
  "rounded-control border-2 border-warning bg-warning-surface px-3 py-2 text-sm font-medium text-foreground";
export const ERROR_CLASS = "text-sm font-medium text-error";
export const ACTIVE_DOT_CLASS = "size-3.5 shrink-0 rounded-full bg-success";
export const INACTIVE_DOT_CLASS = "size-3.5 shrink-0 rounded-full bg-border";
export const CODE_CLASS =
  "rounded-control bg-primary px-3 py-2 font-sans text-2xl tracking-widest text-on-primary";
export const LINK_CLASS = `underline hover:text-primary ${FOCUS}`;

export const BUTTON_CLASS = `inline-flex w-fit max-w-full min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-2 font-medium text-on-primary hover:bg-transparent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const SECONDARY_BUTTON_CLASS = `inline-flex w-fit max-w-full min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-primary bg-transparent px-5 py-2 font-medium text-primary hover:bg-primary hover:text-on-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const ACCENT_BUTTON_CLASS = `inline-flex w-fit max-w-full min-h-11 cursor-pointer items-center justify-center rounded-control border-2 border-accent bg-accent px-5 py-2 font-medium text-foreground hover:bg-transparent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const SMALL_BUTTON_CLASS = `inline-flex w-fit max-w-full min-h-11 cursor-pointer items-center rounded-control border-2 border-primary bg-primary px-3 py-1 text-sm font-medium text-on-primary hover:bg-transparent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const INPUT_CLASS = `min-h-11 rounded-control border-2 border-primary bg-surface px-3 py-2 text-foreground focus:border-primary ${FOCUS}`;
export const DATE_CLASS = `min-h-11 rounded-control border-2 border-primary bg-surface px-2 py-1 text-base font-normal text-foreground focus:border-primary ${FOCUS}`;
