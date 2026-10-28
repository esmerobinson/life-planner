# Visual language (Esmeworld)

The source for art direction, per `CLAUDE.md`. Status of each line: **said** = Esme's words; **extracted** = sampled from her reference images, not invented, awaiting her confirmation; **placeholder** = not decided, deliberately ugly.

## Said (2026-10-27)
- Animal Crossing feel, cute, cosy. Notion's clean layout underneath.
- Loves the NookPhone app grid (rounded-square tiles, one flat colour each, chunky icon).
- Likes the colours, the rounded panels and the icons in the references.
- Likes the Animal Crossing-styled Notion dashboards on Pinterest (village header, calendar and checklist panels, character tiles).
- Progress is shown as bars. Completion gets confetti and stars. Dark mode wanted, simple.

## Extracted palette (from reference screenshots, 2026-10-27)
**NookPhone tile colours** (sampled from the Nookipedia NookPhone page):
Camera purple `#b693ec`, Nook Miles blue `#9eb4e6`, Critterpedia gold `#ecca7d`, DIY terracotta `#d59770`, Nook Shopping yellow `#e8dd6e`, Island Designer brown `#90825b`, Custom Designs pink `#e6aeaf`, Map mint `#a3d5c2`, Happy Home red `#bf6564`, Room Sketch yellow `#e2cd5b`, Chat Log lime `#cedb6e`, Passport green `#98c293`, Best Friends orange `#e39876`, Call Resident sky `#a6ced6`, Rescue coral `#df7e6f`, Island Life 101 violet `#9285c5`.
**Wiki page background:** periwinkle `#e2e8ff`.
**Village-dashboard pins (Pinterest):** forest green `#3a412f` (header), deep olive `#51553d`, sage `#a09f88`, cream `#e9e3d6`, warm paper `#e3ddcd`, pale stone `#d4d1c3`.

## Role assignments made without Esme's approval (2026-10-28)
Unused values from the sampled palette above, given jobs by the implementers. Esme may veto any of them.
- **Sidebar tile colours** for the three added areas: Tech projects Chat Log lime `#cedb6e`, Production DIY terracotta `#d59770`, Admin Island Designer brown `#90825b`.
- **App icon** (`hub/public/icons/`: 192, 512, maskable 512, 180 apple-touch): Esme's chosen artwork (house outline with her photo, Home-tile blue background, cream behind her), chosen 2026-10-28. Background blue is the existing Home tile colour Nook Miles blue `#9eb4e6`.
- **Icon accents** in `docs/design/icons/tech.svg` (Passport green `#98c293` leaf), `production.svg` (Critterpedia gold `#ecca7d` bar, forest green `#3a412f` stripes) and `admin.svg` (Rescue coral `#df7e6f` paperclip). The drawings themselves are unreviewed first attempts in the style of the approved set.

## Not decided (placeholders, must look obviously wrong)
- **Type:** system font until Esme chooses.
- **Easing and timing:** linear, with default durations, until Esme chooses.
- **Mascot / mole popup art, icon artwork, confetti and star shapes:** magenta boxes. Animal Crossing artwork is not bundled; Esme supplies or approves any assets.
- **Web manifest and page `theme_color` / `background_color`:** deliberately omitted until Esme chooses.
- **Light vs dark values** beyond the above: not defined.

## Rule
Do not choose colour, easing, type, composition or timing outside this file. If it is not here, ask.
