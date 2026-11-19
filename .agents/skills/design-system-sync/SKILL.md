---
name: design-system-sync
description: Enforce and synchronize UI code with DESIGN.md tokens (colors, heavy-weight Inter typography, flat dark surface ladder, border radii, and spacing). Use this skill whenever building frontend pages/components, styling CSS/Tailwind, modifying DESIGN.md, or auditing UI consistency.
---

# Design System Sync & Enforcer

Keep frontend stylesheets, Tailwind presets, and UI components strictly aligned with the single source of truth in `DESIGN.md`.

## Supporting Files

- `scripts/design-sync.js`: Zero-dependency Node.js compiler and UI auditor.
- `resources/design-rules.md`: Quick-reference visual guardrails extracted from `DESIGN.md`.

## When to Use

- Whenever creating or modifying UI components, pages, layouts, or stylesheets.
- Whenever `DESIGN.md` is updated with new color, typography, radius, spacing, or component tokens.
- When the user asks to audit UI styling, generate CSS variables, or build a Tailwind theme from `DESIGN.md`.

## Workflows

### 1. Build Design Tokens from `DESIGN.md`

Before writing new UI code (or after editing `DESIGN.md`), compile the tokens into project artifacts:

```bash
node .agents/skills/design-system-sync/scripts/design-sync.js build DESIGN.md src/styles
```

This generates:

- `src/styles/design-tokens.css` (CSS Custom Properties + `.ds-*` component primitives)
- `src/styles/tailwind.design-preset.js` (Tailwind CSS preset ready to import in `tailwind.config.js`)
- `src/styles/design-tokens.json` (Resolved JSON token map)

### 2. Build UI Components Strictly Using Tokens

Consult `resources/design-rules.md` before styling:

- Never hardcode hex values outside `DESIGN.md`; always reference `var(--color-*)` or Tailwind palette tokens.
- Keep structural chrome strictly monochrome dark (`canvas` -> `surface` + `hairline`) with only two accent signals (`primary` green and `secondary` blue).
- Use `Inter` at weights `600` (semibold) and `800` (extrabold) only; never use regular weight (`400`) or light weights.
- Keep `game-tile` and media cards full-bleed inside `rounded.card` (`16px`) with zero internal padding.

### 3. Mandatory Post-Edit UI Audit

After modifying any frontend file, run the auditor to catch design drift:

```bash
node .agents/skills/design-system-sync/scripts/design-sync.js audit src DESIGN.md
```

Fix every reported `unauthorized-color`, `forbidden-font-weight`, and `heavy-shadow-warning` violation before finishing the task.

## Gotchas

- **Leaking artwork colors into UI chrome**: Vibrant purples, reds, or ambers belong strictly inside media/artwork thumbnails, never in structural buttons, borders, or backgrounds.
- **Forgetting Tailwind preset wiring**: After running `build`, ensure `tailwind.config.js` includes `presets: [require('./src/styles/tailwind.design-preset.js')]`.
- **Overusing drop shadows**: Only floating overlays (modals, dropdowns, docked betslip) should use `var(--shadow-floating)`; standard cards rely on surface contrast and `1px solid var(--color-hairline)`.
