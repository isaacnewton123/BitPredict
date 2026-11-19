# Design System Guardrails (1win Analysis)

Quick-reference constraints derived from `DESIGN.md`.

## Color Discipline (Two-Signal System)

| Role              | Token        | Hex       | Usage                                                           |
| ----------------- | ------------ | --------- | --------------------------------------------------------------- |
| Primary Action    | `primary`    | `#00b24b` | Registration, primary confirm, place-bet, active rail indicator |
| Secondary Action  | `secondary`  | `#0075ff` | Log In, links, active tabs, badges, live/odds highlights        |
| On Accent         | `on-primary` | `#ffffff` | Text/icons placed on green or blue fills                        |
| Canvas (Level 0)  | `canvas`     | `#141415` | Page background, `top-nav`, `sidebar-rail`, `footer`            |
| Surface (Level 1) | `surface`    | `#2e3035` | Cards, tiles, panels, inputs, tertiary/ghost buttons            |
| Hairline          | `hairline`   | `#2d2f33` | 1px dividers and card/input borders                             |
| Text Ink          | `ink`        | `#f0f2f5` | Headings, wordmark, primary text                                |
| Text Muted        | `muted`      | `#9aa1b1` | Secondary labels, inactive icons, footer text                   |
| Text Faint        | `faint`      | `#53575f` | Placeholders, disabled labels                                   |
| Text Black        | `black`      | `#000000` | Maximum contrast on bright accent/promo surfaces                |

## Non-Negotiable Rules

1. **No Third Structural Accent**: Only green (`#00b24b`) and blue (`#0075ff`) are permitted as UI accents.
2. **Heavy-Weight Inter Only**: Use `Inter` at `600` (body, titles, UI, captions) and `800` (display `33px`, heading `20px`). Never use weight `400` or lighter.
3. **Flat Tonal Depth**: Separate containers using `canvas` (`#141415`) -> `surface` (`#2e3035`) + `1px solid #2d2f33` hairline. Reserve `rgba(0,0,0,0.4)` shadow strictly for floating overlays.
4. **Geometry**:
   - Buttons: `10px` (`rounded.lg`) or `12px` (`rounded.xl`) with `8px 12px` padding.
   - Inputs & odds chips: `8px` (`rounded.md`).
   - Tiles, promo cards, hero banners, panels: `16px` (`rounded.card`).
   - Pills & badges: `999px` (`rounded.full`).
5. **Full-Bleed Tiles**: `game-tile` artwork must fill edge-to-edge inside `16px` corners with `padding: 0`.
