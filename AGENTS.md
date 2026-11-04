# Repository instructions

## CSS maintenance

- Before editing a stylesheet, search the repository for every existing rule and responsive override that targets the affected selector or property.
- Modify or consolidate the authoritative existing rule. Do not append a new "final override", temporary patch block, or duplicate selector at the end of a stylesheet just to win the cascade.
- When a change makes an older declaration or selector obsolete, remove it in the same change. Do not leave shadowed, contradictory, or dead CSS behind.
- Add a new selector only when the existing semantic selector cannot represent the requested behavior. Keep it beside the related component rules, not in an unrelated late override section.
- Do not use `!important` for first-party styles. If third-party or inline styles make it unavoidable, document the specific reason next to the declaration.
- Prefer existing component classes, layout primitives, and design tokens over route-specific duplication.
- Keep responsive behavior in the component's existing media-query section and verify that desktop and mobile rules do not contradict each other.
- After CSS changes, run the relevant build and inspect the affected route in a browser. Check computed styles, column sizes, overflow, and responsive layout as appropriate.
- In the handoff, state which existing rule was changed, which obsolete rule was removed, and why any unavoidable new selector was added.
