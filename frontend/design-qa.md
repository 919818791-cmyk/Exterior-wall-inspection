# Homepage full-screen scroll QA

final result: passed

## Source and implementation truth

- Source URL: `https://seed.bytedance.com/zh/seedance2_0`
- Source desktop visual: `.design-qa/source-desktop-00-top.png`
- Source desktop next-panel visual: `.design-qa/source-desktop-02-settled.png`
- Source mobile visual: `.design-qa/source-mobile-390x844-top.png`
- Implementation desktop visual: `.design-qa/implementation-desktop-1440x900-top.png`
- Implementation desktop next-panel visual: `.design-qa/implementation-desktop-1440x900-after-one-gesture.png`
- Revised desktop detection grid: `.design-qa/implementation-desktop-ai-grid-2x2.png`
- Final desktop detection grid without subtitle: `.design-qa/implementation-desktop-detection-no-subtitle.png`
- Revised compact desktop detection grid: `.design-qa/implementation-desktop-ai-grid-2x2-1280x720.png`
- Final desktop top navigation state: `.design-qa/implementation-desktop-top-navigation-visible.png`
- Revised natural-height footer: `.design-qa/implementation-desktop-footer-natural-height.png`
- Implementation mobile visual: `.design-qa/implementation-mobile-00-top.png`
- Final mobile hero position: `.design-qa/implementation-mobile-hero-lower-settled.png`
- Final mobile hero typography: `.design-qa/implementation-mobile-hero-larger-copy.png`
- Final mobile hero buttons: `.design-qa/implementation-mobile-hero-larger-buttons.png`
- Final mobile detection stack: `.design-qa/implementation-mobile-cards-stacked.png`
- Final mobile core-feature stack: `.design-qa/implementation-mobile-core-cards-stacked.png`
- Full-view desktop comparison: `.design-qa/comparison-desktop-source-left-implementation-right.png`
- Next-panel comparison: `.design-qa/comparison-desktop-next-panel-source-left-implementation-right.png`
- Full-view mobile comparison: `.design-qa/comparison-mobile-source-left-implementation-right.png`

## Viewports and normalization

- Desktop source and implementation: 1440 × 900 CSS pixels, device scale factor 1, 1440 × 900 PNG output.
- Mobile source and implementation: 390 × 844 CSS pixels inside identical 0.8-scale QA frames, device scale factor 1, normalized 312 × 675 PNG output.
- State: homepage first panel at rest, then the first completed downward wheel gesture showing the next full-screen panel.
- Focused-region comparison was not needed because the requested target was module-level scroll behavior and navigation visibility; both are unambiguous in the matched full-view captures. Product imagery and copy are intentionally project-specific rather than copied from the reference.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Navigation: the homepage header is visible over the hero at scroll position 0, hides after moving into the next module, and reappears when returning to the top.
- Full-screen rhythm: the hero, detection, and core-feature modules measure exactly one viewport high. The final contact module is intentionally content-height again: 400 px on desktop and 671 px at the tested mobile viewport.
- Detection grid: desktop uses a true 2 × 2 layout. After removing the subtitle, cards measure approximately 648 × 331 px at 1440 × 900, gaining about 41 px of image height per card with no clipping.
- Detection subtitle: the subtitle block is absent at desktop and mobile widths. At 390 px, the image ratio increases to 16:11 and each 327 px-wide image renders approximately 225 px high.
- Wheel behavior: one intentional downward or upward gesture lands on exactly the adjacent panel. Three rapid wheel events were also tested as one gesture and stopped at the first adjacent panel rather than skipping ahead.
- Keyboard behavior: Arrow Up/Down, Page Up/Down, Space, Home, and End use the same panel navigation model. Reduced-motion mode uses immediate movement rather than animation.
- Narrow-screen behavior: at 860 px and below, the page uses natural document scrolling. Detection cards form a four-item vertical stack and core-feature cards form a three-item vertical stack; no horizontal card scroller remains.
- Mobile hero: the content block stays left-aligned and is anchored near the bottom of the first viewport. At 390 × 844 it spans approximately y=543–743 after animation.
- Mobile hero typography: at 390 px wide, the title renders at 34.32 px with a 37.07 px line height, and the description renders at 17 px with a 28.9 px line height. Both remain readable over the video without clipping.
- Mobile hero actions: at 390 px wide, both buttons render at 48 px high with 15 px labels; widths are approximately 171 px and 113 px with a 10 px gap, fitting on one row without clipping.

## Required fidelity surfaces

- Fonts and typography: the existing HarmonyOS Sans family, hierarchy, weights, line heights, and Chinese wrapping are preserved. No clipped or truncated headings were found at the tested desktop or mobile sizes.
- Spacing and layout rhythm: desktop primary modules align to viewport boundaries and the final contact section resumes normal document height. Narrow screens switch to natural document flow with centered single-column stacks and a bottom-weighted hero.
- Colors and visual tokens: the existing blue, white, dark-hero, and contact-footer tokens are unchanged. The new scroll treatment introduces no competing color surface.
- Image quality and asset fidelity: existing project video, defect imagery, and organization logos remain unchanged and render sharply. No placeholder, inline SVG, or generated replacement asset was introduced.
- Copy and content: all product-specific homepage copy and calls to action are unchanged. The reference site's copy was not copied.

## Interaction and runtime checks

- Tested: mouse wheel down/up, rapid wheel-event burst, Page Up, desktop first-to-last module sequence, return from the natural-height footer, final 2 × 2 desktop card sizing, top-only homepage navigation visibility, 390 px mobile stacking, 820 px narrow-screen stacking, bottom-weighted mobile hero, and mobile footer sizing.
- Console: no application error reproduced in a fresh local page load; the existing React Router v7 future-flag warning remains non-blocking.
- Build: `npm run build` passed after the final changes.

## Comparison history

- First implementation pass established four viewport-height panels and hid the homepage navigation.
- Interaction hardening then extended the wheel lock through the end of an inertial gesture. Post-fix evidence confirmed three rapid wheel events stop at scroll position 900 on a 900 px viewport.
- The final contact section was restored to content height, and the detection grid was enlarged to two columns by two rows. Post-fix evidence confirms the footer occupies 400 px on desktop and scrolling upward returns to the immediately preceding full-screen module.
- The final navigation adjustment restores the header over the top hero only. Post-fix evidence confirms hidden navigation at scroll position 900 and visible navigation again at scroll position 0.
- The responsive pass replaces narrow-screen horizontal carousels and full-panel snapping with natural vertical document flow. Post-fix evidence confirms one-column grids at both 390 px and 820 px, with all cards readable in sequence.
- Final matched desktop and mobile captures found no remaining P0/P1/P2 visual or interaction issues.

## Follow-up polish

- No P3 item is required for the requested behavior.
