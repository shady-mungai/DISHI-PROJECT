@AGENTS.md

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Developer notes

`developer-notes.md` (gitignored) is the developer's personal task list. Whenever
work leaves something for the developer to do by hand — a terminal command to
run, a setting to flip back, a manual step before go-live, a follow-up task —
append it there as a checkbox item with the exact command and the date. Do not
put these in commit messages, code comments, or chat only.

## Front-end design

Every front-end change (pages, components, layout, colour, type, motion,
charts) goes through the `ui-ux-pro-max` skill first: run its UX/stack
searches (`--domain ux`, `--stack nextjs`, `--domain chart`) and its
pre-delivery checklist. **Do not adopt the skill's generated palette or font
pairing** — brand tokens below are fixed; the skill supplies UX rules,
accessibility checks and implementation guidance only.

### Brand tokens (derived from food4education.org, 2026-09-21)

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#1f1b1b` | Body text, links, default foreground |
| `--color-green` | `#24631e` | Primary: buttons, headings on cream, nav |
| `--color-cream` | `#e4e4c5` | Page/section background, text on green |
| `--color-cream-light` | `#f2f2e2` | Cards and panels on cream |
| `--color-amber` | `#ffad00` | Accent/CTA on green or black; headings on green |
| `--color-orange` | `#ff8300` | Alerts, section titles on black, emphasis |
| `--color-white` | `#ffffff` | Base page background |

Verified pairs (≥4.5:1): ink/cream, ink/amber, cream/green, green/cream,
green/amber. Amber-on-green is 3.6:1 — headings ≥24px only, never body text.
No red in the brand: use `--color-orange` for warnings and a plain
`#b91c1c` only for destructive/error states.

### Typography

- One family: **Rubik** (Google Fonts, variable 300–900). Weights: 400 body,
  500 UI/buttons/leads, 600 headings. Fallback `Helvetica, Arial, sans-serif`.
- Body 18px / line-height 1.5; dashboard tables and dense panels may drop to
  16px, never below 14px. Display headings scale 42→89px fluidly; H3 18px.
- Leads/eyebrows: 500 weight, uppercase, 24px.

### Shape, spacing, motion

- Radius: 8px buttons and inputs, 16–20px cards and panels, 50% avatars.
- Buttons: 2px solid border in the fill colour, 500 weight, padding 18×40px
  (compact 5×24px in toolbars); hover inverts to transparent fill + green text.
- Inputs 64px tall, 20px padding on marketing surfaces; 44px minimum on dashboards.
- Gutter 20px; page max 1280px; section spacing 100–200px (dashboards: 24–48px).
- Transitions `all .3s ease`; respect `prefers-reduced-motion`.
- Flat, no drop shadows; separation by background band (cream / green / amber /
  black), not by elevation. Underlined links, not coloured.

### Principles

1. **Warm and grounded, not clinical** — cream, not white, as the resting
   background; green carries authority; amber and orange carry energy.
2. **One typeface, big type** — hierarchy by size and weight in Rubik alone.
3. **Colour bands, not cards** — a full-width tinted section is the unit of
   layout; cards live inside bands and stay flat.
4. **Numbers are the hero** — stats are set at display size (the site leads
   with "650,000 kids a day"); dashboards inherit this: the key figure first,
   exceptions ranked before totals.
5. **Plain-spoken copy** — short declaratives ("Hungry kids can't learn.");
   button labels are verbs.
6. Dashboards keep the tokens but tighten scale: 16px body, 24–48px section
   spacing, 44px touch targets, one-handed service-window screens (NFR-704).
