# School pilot baseline review

Date: 2026-11-09. Scope: school Overview, source review of Meal service, and live navigation/loading observations. Not a full Phase 1 audit of all roles or journeys.

## Evidence

Started the local Next.js development server and opened /school in an existing authenticated Chrome school session. The rendered overview showed 0 served, 0 pending, 6 missed, no deliveries awaiting receipt, and unavailable forecast for Pilot Primary School. These are observations of that session, not fixtures or expected production totals. No meal, delivery, pupil or configuration mutations were initiated by this review.

Overview viewport checks measured document width equal to viewport width at 768, 1024, 1440 and landscape-width 812. The first attempted 375px window resize was clamped to 500px, so it is not evidence for 375px. Subsequent explicit mobile emulation achieved 375×812. After an extended loading interval, the authenticated Overview rendered with document width 375px and no page-level horizontal overflow. Its primary hero action started approximately 624px below the viewport top; the hero occupied approximately 294px vertically.

Navigation to /school/service?date=2026-11-08 returned HTTP 200, but successive snapshots and a screenshot remained at “Loading…”. Subsequent visits to Overview and historical Meal service eventually rendered authenticated content. The cause and duration are unresolved; this does not establish a permanent navigation failure. The historical screen retained 2026-11-08, exposed Open tap reader with that query date, and displayed the existing current-day override warning below the summary panels. No 3G timing claim is made from a development server.

Screenshot saving through the browser connector was denied for the workspace paths. No baseline PNGs were persisted. Inline screenshots showed the 375px loading state and later the authenticated Overview. Therefore this review does not satisfy the roadmap's persisted before-screenshot deliverable. Generated direction boards are separate, persisted preview artifacts, not baseline screenshots.

## Prioritised findings

| Priority | Finding / evidence | Consequence | Proposed response |
|---|---|---|---|
| P2 investigation | Authenticated route navigation remained at Loading in successive snapshots; Overview eventually recovered | May delay service access; scope/cause/duration not established | Reproduce session lifecycle and inspect connection/auth failures before accepting pilot |
| P2 observed | School name appears in forecast content, while shell/header repeat School workspace and School operations | Staff cannot identify school immediately from the header | Put authorised school identity beside page/date context |
| P2 source | Meal-service summary hero and pending/missed panels precede override controls | Rushed staff must pass reporting content to reach their work | Use a compact summary and put actions/form first |
| P2 source + observed hrefs | Service action inherits selected historical date; NFC and overrides record today | Viewing date can be mistaken for recording date | Explain current-day recording before action and provide Today link |
| P2 source | Shared semantic aliases cover only part of the palette; utility classes retain green/cream names | A palette-only substitution could leave inconsistent states and consumers | Coordinate semantic role migration and retain aliases |
| P3 observed | Current-day Serve meals links use both explicit date and no date | Duplicated actions offer inconsistent-looking destinations | Resolve both from the same intended date context; don't change backend service semantics |
| P2 observed | Fixed Serve meals shortcut overlaps the missed-count panel in the initial 375px screenshot | Important counts can be covered despite bottom page padding | Restrict persistent action placement to a reserved service toolbar or otherwise prevent overlap; verify keyboard focus clearance |

School identity and task-first ordering are confirmed opportunities. Ambient glare, user completion time and large-roster usability remain hypotheses until measured. Existing labelled controls, keyboard skip link, role-aware navigation, focused subscriptions and separate operations-tools page are strengths to preserve.

## Coverage limits and remaining work

No aggregate audit score: screen-reader, full keyboard, contrast-state, authenticated 375px/enlarged-text, performance and all-role coverage are incomplete. No compliance claim is warranted. Full critique/deterministic detector workflow was not run; this is an evidence-limited baseline review.

Next implementation scope is specified in SCHOOL_PILOT_BRIEF.md. UI UX Pro Max UX, Next.js and chart searches were run. Applicable guidance: keep fixed controls clear of content/focus; support wrapping and keyboard access; use existing date links; distinguish route loading from Convex subscription loading; do not fabricate forecast intervals or add charts without supporting data.
