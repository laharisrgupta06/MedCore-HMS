# MedCore HMS — Design System

> **Status: PROPOSED, awaiting the project owner's approval.** No styled application screen may be built
> until the tokens below are approved (frontend-design-system.md §11.18, steps 5–6). Approval is recorded
> as a decision in [DECISIONS.md](DECISIONS.md); changes after approval need a new decision.

The full, mandatory frontend specification (Parts 11–12 of the master instruction, verbatim) is
[frontend-design-system.md](frontend-design-system.md). This document is the single source of truth for
the **tokens and component standards** that implement it. Approved direction: **Sage green + off-white + tomato red**.
Last updated 2026-11-16.

## 1. Principles

Premium, professional healthcare SaaS: calm, trustworthy, information-dense, fast. Clear hierarchy, generous
whitespace, purposeful layouts (not repetitive card grids). Tomato red is a selective accent for emphasis and
focus, never the default for every button or alert. Forbidden: purple gradients, glassmorphism, excessive
gradients, pill-shaped buttons everywhere, emoji icons, fake statistics or patient data, decorative animation,
placeholder links or buttons, em dashes in user-facing copy.

## 2. Colour tokens (proposed)

| Token | HEX | Use |
| --- | --- | --- |
| `sage-50` | #F3F6F2 | Tinted backgrounds, selected rows |
| `sage-100` | #E3EBE1 | Hover backgrounds, subtle fills |
| `sage-200` | #C8D7C4 | Dividers on tinted areas |
| `sage-300` | #A6BEA1 | Decorative lines, charts |
| `sage-400` | #84A47E | Charts, illustrations |
| `sage-500` | #688A62 | Icons on light backgrounds |
| `sage-600` | #52714D | **Primary**: primary buttons, active navigation |
| `sage-700` | #405A3D | Primary hover, links |
| `sage-800` | #2F432D | Text on sage tints, primary pressed |
| `sage-900` | #1F2D1E | Sidebar background (authenticated app) |
| `tomato-50` | #FDF0EC | Accent tint |
| `tomato-100` | #FADBD2 | Accent hover tint |
| `tomato-600` | #C8432B | **Accent**: key call to action per screen, focus ring |
| `tomato-700` | #A33622 | Accent hover, accent text |
| `bg` | #FAF8F3 | Page background (off-white) |
| `surface` | #FFFFFF | Panels, tables, dialogs |
| `surface-muted` | #F2EFE7 | Secondary panels, table headers |
| `border` | #E2DDD1 | Default hairline borders |
| `border-strong` | #8C8576 | Input borders, focus-adjacent outlines |
| `text-primary` | #1E2420 | Body and headings |
| `text-secondary` | #4A534C | Supporting text |
| `text-muted` | #6B736D | Hints, metadata |
| `text-disabled` | #9AA09B | Disabled controls only |
| `success` | #2E6B3F | Success text/icons (bg tint #E8F2EA) |
| `warning` | #8A5300 | Warnings (bg tint #FBF1E1) |
| `error` | #B42318 | Errors, destructive actions (bg tint #FCEBE9); deliberately deeper than tomato so errors are not confused with the accent |
| `info` | #23578F | Information (bg tint #E8F0F8) |

### Contrast (computed, WCAG 2.x)

| Pair | Ratio | Requirement |
| --- | --- | --- |
| text-primary on bg | 14.89 | AA text 4.5 |
| text-secondary on bg | 7.52 | AA |
| text-muted on bg / on surface | 4.60 / 4.89 | AA |
| white on sage-600 (primary button) | 5.49 | AA |
| white on sage-700 (primary hover) | 7.64 | AA |
| sage-700 link text on bg | 7.20 | AA |
| sage-800 on sage-50 (badges) | 9.83 | AA |
| white on tomato-600 (accent button) | 4.89 | AA |
| tomato-700 text on bg | 6.37 | AA |
| success / warning / error / info on bg | 6.01 / 5.96 / 6.19 / 6.99 | AA |
| border-strong on bg | 3.45 | Non-text 3:1 |
| tomato-600 focus ring on bg | 4.61 | Non-text 3:1 |
| text-disabled on surface | 2.67 | Exempt (disabled) |

## 3. Typography (proposed)

- **Body and UI:** IBM Plex Sans (clinical clarity, tabular figures for vitals and money).
- **Page titles and public-page headings:** Source Serif 4 (distinctive, editorial, trustworthy).
- **Data and codes (MRN, ICD-10, batch numbers):** IBM Plex Mono.
- Loaded with `next/font` (self-hosted at build; no runtime third-party requests).

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `display` | 36 / 44 | 600 serif | Public hero, auth screen title |
| `h1` | 28 / 36 | 600 serif | Page title |
| `h2` | 22 / 30 | 600 | Section title |
| `h3` | 18 / 26 | 600 | Panel title |
| `body` | 15 / 24 | 400 | Default text |
| `body-sm` | 13 / 20 | 400 | Tables, metadata |
| `label` | 13 / 18 | 500 | Form labels, column headers |
| `caption` | 12 / 16 | 400 | Hints (never below 12) |

## 4. Spacing, radius, elevation, breakpoints (proposed)

- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: 4 (inputs, table cells, badges), 6 (buttons, menus), 10 (panels, dialogs). Full-round only for avatars and status dots; no pill buttons.
- Elevation: `shadow-1` 0 1px 2px rgba(30,36,32,0.06) (panels); `shadow-2` 0 4px 12px rgba(30,36,32,0.08) (menus, popovers); `shadow-3` 0 12px 32px rgba(30,36,32,0.12) (dialogs). No glow or coloured shadows.
- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536 (Tailwind defaults). Layout: mobile-first; sidebar collapses to a drawer below `lg`.

## 5. Components (standards)

| Component | Standard |
| --- | --- |
| Buttons | Height 36 (default) / 32 (compact) / 44 (touch on mobile); radius 6. Variants: primary (sage-600), accent (tomato-600, at most one per view), secondary (surface + border-strong), ghost, destructive (error). States: hover darker shade, active pressed, focus 2px tomato-600 ring with 2px offset, disabled text-disabled with no hover. Loading shows a spinner and keeps width |
| Inputs and forms | Height 36; border-strong; radius 4; label above, hint below, error text in `error` with icon; required marked in text; validation on blur and submit (React Hook Form + Zod) |
| Tables | Surface background, `surface-muted` header, `body-sm`, row hover `sage-50`, selectable rows with checkbox; sticky header; on small screens collapse to stacked rows with key fields, never horizontal page scroll |
| Panels | Surface, `border`, radius 10, `shadow-1`; used for grouping, not decoration |
| Dialogs | Radius 10, `shadow-3`, focus trap, Esc closes, destructive confirmation names the object being affected |
| Dropdowns and menus | Radix primitives via Shadcn, `shadow-2`, keyboard navigable |
| Navigation and sidebar | Sage-900 sidebar with sage-100 text and tomato-600 active indicator bar; only links the role can use; logo links to the role's home |
| Headers | Page title (`h1`), breadcrumbs where depth > 1, primary action at the right |
| Notifications | Toasts bottom-right (top on mobile), auto-dismiss 5 s except errors; inbox with unread count badge |
| Status indicators | Text label + icon + colour (never colour alone). Appointment states mapped to fixed tokens (to be listed with the appointment module) |
| Icons | Lucide (already installed), 16/20 px, stroke 1.75, one style throughout; no emoji |
| Empty, error, success, loading | Every list has an empty state with a next action; skeletons for loading; errors explain and offer retry |

## 6. Motion

Purposeful only: 150 ms for hover and focus, 200 ms for menus and toasts, 250 ms for dialogs, easing
`cubic-bezier(0.2, 0, 0, 1)`. Framer Motion for page and dialog transitions only. `prefers-reduced-motion`
disables non-essential motion (already in `globals.css`). Animation never delays access to information.

## 7. Accessibility

WCAG 2.2 AA target: contrast as above, visible focus on every interactive element, full keyboard operation,
labels for every control, `aria-live` for async results (as in the existing status component), semantic
landmarks, touch targets ≥ 44 px on mobile.

## 8. Imagery

Original CSS/SVG illustrations or properly licensed photography only on public and authentication pages;
no AI-generated or fake hospital imagery; never behind clinical data.

## 9. Implementation

Tokens become Tailwind 4 `@theme` variables in `apps/web/app/globals.css` and Shadcn CSS variables after
approval. The first styled screens are the Phase 1D authentication pages.
