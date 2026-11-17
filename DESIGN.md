# Design

## Overview

**Creative North Star: A readable service ledger.**

Tide and apricot was selected by the user on 2026-11-09. This records the implemented shared palette and school pilot. School staff need to read and operate the app quickly during meal service. Light resting surfaces are the current baseline; actual ambient-light performance still requires a device review.

**The Work First Rule.** Show context, priority, work and supporting evidence in that order. Keep the desktop sidebar and labelled mobile navigation. Other school pages provide a mobile-header service shortcut. Overview and Meal service use their in-content primary action; desktop navigation keeps Meal service reachable. No floating service shortcut covers content.

## Colors

Current source: app/globals.css. Primary teal (#155e63), mist background (#f1f6f4), surface/on-primary (#fafcfb), foreground (#1d2d31), muted (#52646a), apricot accent (#f1b38a), border (#788c8e), focus (#155e63), warning (#914414), warning surface (#fff0e5), error (#b91c1c).

Teal carries navigation and primary actions; mist is the resting background; pale surfaces separate work. Apricot adds warmth to accents. Warning bands use dark foreground text and a burnt-orange border, with explicit labels. Error red remains reserved for destructive/error states. Focus on teal uses apricot.

**The Selection Rule.** Tide is the selected palette. The shared primitives use semantic roles; legacy ink/green/cream/cream-light/amber/orange/white names remain aliases so existing workspace consumers inherit the same system during rollout.

## Typography

Rubik only, with Helvetica/Arial/sans-serif fallback. Body (16px in dashboards), controls (500 weight), headings (600 weight), minimum dense text (14px). Tabular numerals align comparable figures. Keep figure prominence without duplicating the served total. Use readable wrapping for long school and pupil names.

## Elevation

Flat surfaces, no drop shadows. Separate sections with background bands, spacing and restrained borders. Controls have gently curved corners (8px); panels (16–20px).

## Components

The shared Workspace supplies navigation, workspace switching, account controls and school service shortcut. DateLink/useUrlDate preserve date filters. Shared button/input/table/panel constants and Stat already exist and should be reused.

Buttons size to their labels and remain bounded by their container. School primary service actions are full-width only below (640px), then content-sized. Controls are at least (44px) high; fields have visible labels. Primary buttons use a solid fill and matching border (2px); hover and focus stay legible. Current transitions are (.3s ease), removed under reduced motion. Page gutter (20px), maximum content width (1280px), dashboard section spacing (24–48px).

Tables retain semantic headings and labelled mobile records. Form submissions need pending, success, duplicate and failure feedback. Route loading and client subscription loading are separate states. Reader queued taps remain distinct from accepted server records.

## Do's and Don'ts

- Use the selected Tide palette consistently across shared controls.
- Put service controls before supporting detail on the phone-first meal-service screen.
- Preserve date semantics, routes, permissions and reader storage/signing behaviour.
- Avoid clinical dashboards, decorative marketing inside service tasks, and identical card grids that obscure priority.
- Never adopt generated preview copy, invented navigation, new search capabilities or numeric examples as functional requirements.
- Never claim browser screenshots establish accessibility conformance or physical NFC reliability.
