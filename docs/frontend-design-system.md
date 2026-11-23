# MedCore HMS Frontend Design System and Engineering Specification

> **Status:** specification only. Design tokens, colour values, typography and component standards have **not yet been proposed or approved**. Per Part 11.18 (Steps 4 to 6), the Frontend Engineer prepares them and the Team Lead and project owner approve them; the approved values are then added in the "Approved design tokens" section at the end of this file.
>
> **Source:** Parts 11 and 12 below are copied verbatim, without shortening, from the project owner's master development instruction (received 2026-11-16). Do not edit the specification text without the project owner's approval. Proposed deviations go to the Team Lead.
>
> **Scope decisions approved by the project owner (2026-11-16):** Privacy Policy page, Terms and Conditions page (flagged for legal review), custom 404 page and the Part 11 SEO and completeness items are in scope. A custom domain is optional during development and must not be purchased or made a dependency at this stage.
>
> **Product requirements** remain governed by the PRD (`docs/prd/`). This document adds visual, interaction and frontend quality requirements without changing the PRD's functional scope.

---

PART 11. COMPLETE FRONTEND ENGINEERING AND DESIGN SPECIFICATION

IMPORTANT:

This entire section is mandatory.

The Frontend Engineer must receive the complete specification.

Do not shorten it when creating the teammate’s instructions.

Do not replace it with a generic instruction such as “build a premium frontend.”

Preserve it in:

docs/frontend-design-system.md

The Frontend Engineer must follow it throughout development.

11.1 DESIGN PHILOSOPHY

Our objective is to create a premium, modern healthcare management platform.

The application must look like a professionally designed enterprise SaaS product, not a generic AI-generated or template-based dashboard.

The visual direction should combine:

* Premium healthcare SaaS aesthetics.
* Modern enterprise software.
* Minimal and sophisticated layouts.
* Excellent information hierarchy.
* Thoughtful use of whitespace.
* Consistent typography.
* Distinctive visual identity.
* Intuitive navigation.
* Carefully designed interactive elements.

Avoid generic dashboard templates and repetitive rectangular card grids.

Every screen must have a clear visual hierarchy and a purpose.

The design must communicate trust, professionalism, efficiency and reliability.

11.2 APPROVED COLOUR DIRECTION

Our preferred colour combination is:

SAGE GREEN + OFF-WHITE + TOMATO RED.

Use this as the initial design direction.

Develop a complete design token system containing:

* Primary colours.
* Secondary colours.
* Background colours.
* Surface colours.
* Text colours.
* Border colours.
* Accent colours.
* Hover states.
* Focus states.
* Disabled states.
* Success indicators.
* Warning indicators.
* Error indicators.
* Information indicators.

Choose actual accessible colour values and document them.

Use tomato red selectively for visual emphasis.

Do not use it indiscriminately for every button or notification.

Maintain sufficient contrast for readability and accessibility.

Do not introduce purple gradients or unrelated colour combinations.

11.3 VISUAL IDENTITY AND DESIGN SYSTEM

Create a consistent design system before implementing individual application screens.

Define:

* Typography and font hierarchy.
* Font sizes and weights.
* Spacing system.
* Border radius rules.
* Shadows and elevation.
* Button styles.
* Input styles.
* Form layouts.
* Navigation styles.
* Table styles.
* Modal styles.
* Dropdown styles.
* Notification styles.
* Status indicators.
* Iconography.
* Responsive breakpoints.

Use reusable components rather than independently styling every page.

Avoid excessive rounded, pill-shaped buttons.

Use professional, carefully proportioned components.

Do not use emoji icons.

Use a consistent professional icon library.

Do not mix unrelated icon styles.

Create reusable components that can be shared across the entire application.

11.4 DISTINCTIVE VISUAL EXPERIENCE

The application should have a recognisable visual identity.

Avoid the appearance of a generic template.

Explore suitable visual treatments such as:

* Subtle layered backgrounds.
* Carefully composed healthcare-related imagery.
* Sophisticated typography.
* Asymmetric layouts where appropriate.
* Refined shadows.
* Subtle depth and elevation.
* Thoughtful section transitions.
* Custom-designed dashboard visualisations.
* Professionally styled data tables.

Background imagery may be used in appropriate locations, particularly public-facing pages and authentication screens.

However:

* Never use generic AI-generated healthcare photographs.
* Never use fake hospital photographs.
* Never use irrelevant stock imagery.
* Never compromise readability with background images.
* Use genuine, appropriately licensed imagery or original CSS/SVG illustrations.
* Do not place decorative images behind sensitive clinical information.

Do not force background photographs into authenticated dashboard screens where they would reduce usability.

11.5 ANIMATION AND INTERACTION

The application must feel interactive and polished.

Every genuinely interactive element should have an appropriate hover, focus, active or transition state.

Implement subtle micro-interactions for:

* Buttons.
* Navigation items.
* Sidebar interactions.
* Dropdowns.
* Cards that are genuinely clickable.
* Tables and selectable rows.
* Tabs.
* Modals.
* Form controls.
* Tooltips.
* Notifications.

Use tasteful animation techniques such as:

* Smooth transitions.
* Subtle elevation changes.
* Gentle shadow transitions.
* Carefully controlled entrance animations.
* Loading skeletons.
* Progress indicators.
* Small background animations where appropriate.
* Smooth navigation transitions.

Create a distinctive visual interaction or animation for suitable high-visibility sections.

Animations must be purposeful, not decorative noise.

Avoid:

* Excessive scroll-triggered animations.
* Cursor-following animations.
* Custom animated cursors.
* Constantly moving backgrounds.
* Distracting effects.
* Unnecessary parallax.
* Animations that interfere with clinical workflows.

Respect reduced-motion preferences.

Animations must never delay access to important information or actions.

11.6 LAYOUT AND NAVIGATION

Design the application according to the actual user roles and modules defined in the PRD.

Implement:

* Consistent application navigation.
* Role-appropriate sidebars.
* Clear page headers.
* Breadcrumbs where useful.
* Responsive navigation.
* Mobile menu.
* Proper dashboard layouts.
* Well-organised forms.
* Readable data tables.
* Search and filtering interfaces.
* Pagination where required.

Do not expose navigation options that a user cannot access.

Avoid unused navigation links and placeholder pages.

Make the logo clickable and ensure it navigates to the appropriate home/dashboard destination.

Ensure navigation is consistent across all modules.

11.7 USER EXPERIENCE

Every feature must have proper interaction states.

Implement:

* Loading states.
* Empty states.
* Success messages.
* Error messages.
* Form validation.
* Confirmation dialogs.
* Useful error explanations.
* Appropriate retry actions.
* Disabled states.
* Search feedback.
* Submission feedback.
* Network error handling.

Do not leave placeholder text or non-functional buttons.

Every button must perform its intended action.

Every form must have proper validation and feedback.

Never simulate successful operations when the backend has not confirmed success.

Do not display fake data as real hospital information.

Use clearly identified development fixtures only when necessary.

11.8 SECURITY AND PRIVACY

Security is essential because this application handles sensitive hospital and patient information.

Follow the authentication and authorisation architecture specified in the PRD.

Frontend responsibilities include:

* Protected application routes.
* Appropriate session handling.
* Role-based navigation and UI permissions.
* Safe handling of authentication errors.
* Secure API communication.
* Avoiding unnecessary exposure of patient information.
* Avoiding sensitive information in browser logs.
* Avoiding secrets in frontend environment variables.
* Safe rendering of user-provided content.
* Appropriate handling of expired sessions.
* Secure logout behaviour.

IMPORTANT:

Frontend permission checks are not a substitute for backend authorisation.

The backend must independently enforce authentication, permissions and hospital-level tenant isolation.

Never rely on hiding a button or menu item as a security mechanism.

Never expose database credentials, private API keys or server secrets through client-side code.

Do not store sensitive patient information in browser storage without explicit architectural approval.

11.9 RESPONSIVENESS AND MOBILE OPTIMISATION

Every page must be responsive.

Test the application on:

* Desktop.
* Laptop.
* Tablet.
* Mobile.

Mandatory requirements:

* Remove horizontal scrolling.
* Fix mobile overflow.
* Implement a functional mobile menu.
* Ensure responsive navigation.
* Make tables usable on smaller screens.
* Ensure forms fit mobile screens.
* Ensure modals remain accessible.
* Ensure buttons are appropriately sized.
* Maintain readable typography.
* Prevent overlapping elements.
* Ensure all important functionality remains accessible.

Do not simply shrink the desktop interface to fit mobile.

Design appropriate responsive layouts.

11.10 SEO AND WEBSITE COMPLETENESS

For all relevant public-facing pages:

* Add a favicon.
* Add appropriate page titles.
* Add meta descriptions.
* Fix broken links.
* Fix footer links.
* Add a custom 404 page.
* Fix the copyright year.
* Make the logo clickable.
* Make phone numbers clickable using tel: links.
* Make email addresses clickable using mailto: links.
* Compress and optimise images.
* Remove placeholder content.
* Remove unused navigation.
* Verify every button works.

For the complete application:

* Add a Privacy Policy page.
* Add a Terms and Conditions page.

Their contents must reflect the actual application, its data handling and applicable requirements.

Do not invent legal claims or make unsupported compliance certifications.

Flag content requiring legal review.

11.11 STRICT NO-GENERIC-DESIGN RULES

The following are prohibited:

* Purple gradients.
* Generic AI-generated dashboard layouts.
* Pill-shaped buttons everywhere.
* Fake customer counters.
* Fake reviews and testimonials.
* Fake hospital statistics.
* Fake metrics.
* Fake patient data presented as real.
* Vague hero text.
* Generic AI-generated marketing copy.
* AI-generated healthcare photographs.
* Emoji icons.
* Excessive gradients.
* Unnecessary glassmorphism.
* Cursor animations.
* Over-the-top scrolling animations.
* Decorative elements without a purpose.
* Placeholder content.
* Broken links.
* Non-functional buttons.
* Repetitive rectangular card grids.

Do not use em dashes in user-facing website copy.

All written content must be specific, meaningful and relevant to MedCore HMS.

11.12 FRONTEND ARCHITECTURE

Follow the approved monorepo architecture and existing project conventions.

Use:

* Next.js 15.
* React 19.
* TypeScript.
* The styling framework approved in the implementation roadmap.
* Reusable React components.
* Consistent design tokens.
* Appropriate state management.
* Proper API integration.
* Appropriate form validation.
* Accessible UI components.

Do not independently introduce an additional framework or major dependency without approval.

Keep components maintainable and avoid unnecessarily large files.

Separate presentation, business logic and API communication appropriately.

11.13 API INTEGRATION

Coordinate directly with the Backend Engineer.

The Backend Engineer owns backend API implementation.

You own frontend API integration.

Before implementing API-dependent functionality:

1. Obtain the approved API contract.
2. Understand request and response structures.
3. Confirm authentication requirements.
4. Confirm error response formats.
5. Confirm pagination and filtering behaviour.
6. Confirm role and permission requirements.

Use the shared OpenAPI specification where available.

Do not invent API endpoints.

Do not create mock API behaviour as a replacement for actual integration.

If the backend is not ready, work only against approved interfaces and clearly identified development fixtures.

Notify the Backend Engineer and Team Lead when integration issues arise.

11.14 FRONTEND TESTING

Every meaningful frontend feature must be tested.

Use the approved testing stack.

Include:

* Component tests.
* Interaction tests.
* Form validation tests.
* Navigation tests.
* Responsive layout checks.
* Accessibility checks.
* Authentication-related UI tests.
* API integration tests.
* Error-state tests.
* End-to-end tests using Playwright where appropriate.

Do not mark components complete merely because they render.

Verify their actual behaviour.

11.15 PRE-LAUNCH QUALITY GATE

MedCore HMS must not be considered launch-ready until all applicable requirements are verified.

Mandatory launch checks:

1. Custom domain connected.
2. Favicon installed.
3. Privacy Policy page available.
4. Terms and Conditions page available.
5. No unwanted platform branding or Made with AI tags.
6. No placeholder content.
7. No broken links.
8. No broken buttons.
9. No horizontal scrolling.
10. All pages mobile optimised.
11. All forms have proper validation.
12. Success and error messages work.
13. All navigation links work.
14. Images are optimised.
15. Page titles and meta descriptions are configured.
16. Footer links are verified.
17. Custom 404 page works.
18. Copyright year is correct.
19. Security checks are completed.
20. All critical tests pass.

Do not claim that the application is launch-ready if any mandatory requirement remains incomplete.

Report outstanding items clearly.

11.16 DOCUMENTATION

Create and maintain:

docs/frontend-design-system.md

This document must contain:

* Approved colour palette.
* Exact colour values.
* Typography.
* Design tokens.
* Component standards.
* Layout guidelines.
* Animation guidelines.
* Responsive design rules.
* Accessibility requirements.
* Image usage rules.
* Frontend security requirements.
* Implementation conventions.

Also maintain a frontend implementation checklist.

11.17 TEAM COLLABORATION

The Frontend Engineer is not the overall project architect.

It must:

* Follow the Team Lead’s approved architecture.
* Respect exclusive file ownership.
* Avoid modifying database migrations.
* Avoid modifying backend implementation files.
* Communicate with the Backend Engineer for API contracts.
* Communicate with the Database Engineer for data requirements.
* Communicate with QA for testing.
* Communicate with the Team Lead for architectural decisions and approvals.

Notify relevant teammates when deliverables are ready.

Report blockers instead of making unsupported assumptions.

Do not independently expand the PRD.

11.18 FRONTEND EXECUTION APPROACH

The Frontend Engineer must not immediately generate the entire frontend.

Proceed systematically:

STEP 1: Read the PRD and approved roadmap.

STEP 2: Understand every frontend-related requirement and user role.

STEP 3: Inspect the existing frontend structure.

STEP 4: Prepare the design system and proposed visual direction.

STEP 5: Present the design tokens, component architecture and layout strategy to the Team Lead.

STEP 6: Obtain design approval.

STEP 7: Implement shared components and layouts.

STEP 8: Implement individual modules according to the approved roadmap.

STEP 9: Integrate backend APIs.

STEP 10: Perform testing, responsive checks, accessibility checks and visual QA.

STEP 11: Resolve all identified issues.

STEP 12: Report completion and remaining launch requirements.

The final result must be a cohesive, premium, functional healthcare management application.

Prioritise correctness, usability, consistency, security and visual quality equally.

⸻

PART 12. FRONTEND SPECIFICATION PRESERVATION AND TEAM HANDOFF

The complete Part 11 specification must be preserved.

Before creating the Frontend Engineer teammate:

1. Create docs/frontend-design-system.md.
2. Include the entire frontend specification.
3. Do not omit any mandatory section.
4. Add the approved design tokens once they have been reviewed.
5. Ensure the Frontend Engineer can access the document.
6. Explicitly instruct the Frontend Engineer to read it completely.
7. Include its requirements in the teammate’s task description.

The Frontend Engineer must not receive only a short summary.

The Frontend Engineer must follow the specification throughout development.

Any proposed deviation must be communicated to the Team Lead for approval.

⸻


---

## Approved design tokens

Approved by the project owner on 2026-11-16 (DEC-033). The approved tokens and component standards are
the ones in [DESIGN.md](DESIGN.md); that file is the single source of truth for token values.

## Frontend implementation checklist

To be maintained by the Frontend Engineer as required by Part 11.16, starting from the Part 11.15 pre-launch quality gate.
