# School pilot: direction review

Date: 2026-11-09. Status: confirmed for implementation. User selected “Tide and apricot, use this” on 2026-11-09. The school pilot and shared palette are implemented; full rollout/acceptance remains incomplete.

## Feature summary and primary action

Refine /school and /school/service for school staff using a phone during a busy meal-service window. Establish school/date, expose urgent work, and make entering the reader or recording a staff override straightforward. Desktop reporting remains available and consistent.

The primary action on Overview is Serve meals. On Meal service, Open tap reader is the principal route; Record meal is the alternative for staff overrides.

## Direction comparisons

All three generated boards compare the same illustrative school, counts, service form, reconciliation table and network-error state. Generated using the built-in imagegen tool. These are visual probes, not working components.

| Direction | Layout hypothesis | Main tradeoff | Preview |
|---|---|---|---|
| Grove and maize | Quiet school/date header, warm ledger, prominent served figure, single-column service form | Closest to the established identity; summary-first placement still delays the action | [Grove](grove-and-maize.png) |
| Tide and apricot | Urgent work and action before compact service counts; broad work/planning bands | Strongest service-first order; cooler visual identity | [Tide](tide-and-apricot.png) |
| Indigo and clay | Ruled register and explicit task list | Clear structure; repeated task links and steps risk unnecessary length | [Indigo](indigo-and-clay.png) |

Selected direction: Tide and apricot, including its task-first information order. Keep the existing sidebar/mobile navigation pattern; the generated desktop top bar is not a routing requirement. The approved Tide board is the resolved visual reference, so no additional exploration was needed.

| Role | Grove | Tide | Indigo |
|---|---|---|---|
| Primary | #315445 | #155E63 | #424B76 |
| Background | #F6F4EC | #F1F6F4 | #F5F3F0 |
| Surface | #FDFCF7 | #FAFCFB | #FCFBF8 |
| Text | #202B25 | #1D2D31 | #252838 |
| Muted | #526158 | #52646A | #5E6275 |
| Accent | #DDAA3A | #F1B38A | #D7A98C |

Physical-scene hypothesis: a school staff member checking a phone while coordinating a daylight meal queue, needing fast recognition and forgiving touch targets. Phone-first and busy service are confirmed; daylight and ambient glare are assumptions to test on device. Use light surfaces with restrained accent coverage. Anchors: the existing Mlo workspace navigation, the documented Food4Education brand character, and a school service ledger. No external website audit was performed.

## Scope and layout

Produce a production-quality, interactive school pilot after brief confirmation, then review before expanding to other roles. This stage supplies visual previews and a written brief, not a separately maintained prototype app.

Overview order: school and selected date → urgent exception → Serve meals → one served/expected summary with pending/missed → delivery work → forecast. Meal service order: school/date → current-day explanation when viewing history → Open tap reader → staff override fields and action → supporting counts and override-rate evidence. Do not let a large marketing-style banner push the form down the page.

Retain 44px controls, visible labels, underlined links, flat surfaces, Rubik, readable tables, reduced motion and mobile content clearance. Keep existing routes, compatibility links and subscriptions.

## States and interaction

| State | Required behaviour |
|---|---|
| Loading | Keep context stable; distinguish auth loading from counts/delivery subscriptions; never display unknown values as zero |
| Empty | Explain whether expectations are absent, no meals recorded, no exceptions, or forecast unavailable |
| Historical | Show selected date; clearly state that reader and override actions record for today, and offer a return-to-today path |
| Pending | Disable repeat submission and show recording feedback |
| Success / duplicate | Announce recorded meal or already-served result, retaining the existing duplicate protection |
| Failure | Preserve entered values and explain recovery; don't imply unsent data was accepted |
| Reader offline | Keep existing queue/retry behaviour and separate queued from accepted records on the reader |
| Permission denied | Preserve existing gates and explain missing access or school assignment |
| Long names / enlarged text | Wrap content; maintain focus visibility and prevent page-level overflow |

Date selection, direct links, refresh and browser back must retain meaning. Do not mutate service records during visual review. Review desktop and 375px phone layouts, 768/1024/1440px, landscape and 200% text before rollout.

## Content and data constraints

Use existing data and distinguish expected, pending, missed and served. Forecast confidence labels do not supply numerical confidence intervals. No decorative charts, new endpoints or dependencies.

The boards use fictional 420 served, 74 pending and 6 missed out of 500 expected. They contain model errors that must not reach code:

- Reconciliation variance is confirmed minus served: 500 confirmed and 420 served means **+80**, not -80.
- Historical views do not enable historical meal recording. Replace generated edit-past-meals suggestions with: “Viewing [date]. New meal records are for today, [today].” Show this before recording controls.
- Remove duplicated served figures, extra repeated Serve meals links, invented destinations, icon-only actions and decorative shadows/gradients from the probes.
- Use the current child selector; generated search fields do not authorise a new search feature.
- Use dark text on accent fills. Validate real CSS pairs and states; image pixels are not contrast evidence.
- “Review missed meals” opens service context; it does not promise a missed-pupil list the current screen does not provide.

## Implementation reach

SchoolWorkspace and OverridePanel own school content/order and record feedback. Workspace owns identity/navigation/shortcut presentation. SchoolGate owns school identity/access context. globals.css, ui.ts and Stat own shared presentation. Audit DateLink/useUrlDate consumers before changing date behaviour. Existing tests/uiNavigation.test.ts and e2e/workspaces.spec.ts cover relevant navigation. Reader fixtures remain regression coverage; no reader storage, signing or ingest changes are planned.

Any shared token change reaches Supplier, County, Admin, authentication, deliveries and enrolment, so migrate semantic roles with legacy aliases and check those consumers. Do not change Convex contracts just to support the visual pilot. If school identity cannot be obtained from existing authorised queries, record that gap before expanding backend scope.

## Acceptance and open decisions

Tide selected and confirmed. DESIGN.md and AGENTS.md now record the chosen tokens. Shared aliases preserve existing consumers; detailed Supplier, County and Admin composition work remains a later phase. Carry existing navigation and data safeguards through the pilot.

References for implementation: Impeccable product, craft, layout, adapt, clarify and harden guidance; UI UX Pro Max UX/Next.js/chart searches and web pre-delivery checklist. Keep normal-text contrast at 4.5:1 and meaningful controls at 3:1; manually check keyboard, 200% text, reduced motion and status announcements.

Final evidence must separate live authenticated checks, fixtures, source inspection and hardware tests. Current baseline evidence and limitations are in SCHOOL_PILOT_AUDIT.md. No performance improvement or task-time reduction is claimed.
