# Retro strength (graphics setting) and look polish

Settings → **Graphics** → **Retro strength**: one control for how retro the game looks, with an
**Advanced** toggle that exposes every knob. Research behind it: `docs/art/retro-references.md`.

## Presets

| Knob | Off (modern lo-fi) | Subtle | Classic (default) | Full PS1 |
|---|---|---|---|---|
| Internal resolution | 720 lines | 480 | 360 | 240 |
| Palette depth | full colour | 32 colours / texture | 16 colours / texture | 16 colours + 15-bit framebuffer |
| Dither | none | crosshatch 50% | crosshatch 75% | Bayer 85% (texture and screen) |
| Vertex snap | off | off | off | 1 internal pixel |
| Affine texture warp | 0 | 0 | 0 | 70% |
| Fog distance | map value (x1) | x1 | x1 | x0.65 |
| Texture filter | smooth (trilinear) | pixel + mips | pixel + mips | pixel + mips |

Classic is exactly the look approved before this setting existed (plus the all-preset polish
below). Full PS1 keeps mipmaps: without them every distant photo at 240 lines turns into
sparkling noise, which reads as broken rather than retro (Advanced → Texture filter → Pixel has it). Fog is never pushed *further*
than the map value (Off would otherwise see further than everyone else); Full PS1 only pulls it in.

## Knobs (all apply live, no reload)

- **Render res**: the low-res target (`renderer.ts` `resize`). The vertex snap grid follows it.
- **Palette**: `full | 32 | 16 | 15bit`, ordered from most to fewest colours. `full`/`32`/`16` set the
  texture developer's palette size (relative to each recipe's own size, so the 8-colour "small"
  recipes become 16 at `32`); `15bit` keeps 16-colour textures and quantises the final image to
  5 bits per channel with the ordered dither, like the PS1 framebuffer (ULTRAKILL's "colour
  compression").
- **Dither** type (`pattern` = the 4x4 crosshatch from Color Quantizer's "Pattern (PS)", `bayer`,
  `none`) and **strength** (0..1): baked into textures by the developer, and used for the screen
  dither when the palette is `15bit`. The strength slider applies on release because it re-develops.
- **Vertex snap** (0..3 internal pixels; viewmodel exempt), **Texture warp** (0..1 affine blend),
  **Fog distance** (x0.4..x2 on the map's fog start/end): shader uniforms, instant.
- **Texture filter**: `pixel` (nearest, no mips: PS1 shimmer), `pixel-mip` (Classic), `smooth`
  (trilinear). Re-uploads textures, no re-developing.
- **Textures**: Photo (developed photos) or Drawn (the lo-fi canvases), the old "Look" toggle.

Changing palette or dither re-develops photos in the background (on-screen textures first; the old
texture stays bound until its replacement lands). Each variant is cached in IndexedDB separately,
so switching back is a cache read. A full re-develop of every texture takes tens of seconds on a
cold cache; the current map's textures land first.

Editing a knob turns the preset label into **Custom**; setting it back to a preset's values shows
that preset again.

## Persistence

Flat keys on `Settings` (`settings.ts`, localStorage `lofi.settings`): `retro`, `res`, `palette`,
`ditherType`, `ditherStrength`, `vertexSnap`, `affineWarp`, `fogScale`, `texFilter`. A stored preset
id follows the preset's current definition; stored Custom knobs are validated and clamped
(`migrateRetro`). Settings saved before this feature had `snap`/`affine`/`dither` booleans: they
map onto the knobs (snap → 1 px, affine → 100%, dither → 15-bit + Bayer).

## Polish (all presets)

- **Fog-matched horizon**: the sky dome fades to the fog colour around the horizon
  (`uHorizon`, elevation -0.03..0.2), so the world dissolves into the sky instead of meeting it at
  a seam (Crow Country, ULTRAKILL, BRC).
- **Backdrop haze**: unfogged backdrop materials (Nuketown mountains, Firing Range hills) take up to
  `uHaze` of the fog colour by distance (aerial perspective) instead of standing out as dark
  cut-outs.
- **Smooth skies**: sky recipes develop at full colour from the unposterised drawing (the 16-level
  posterise and the texture crosshatch read as stair-stepped bands and a magnified screen door).
- **Map grade** (new default Grade, `render/grade.ts`): per time of day, derived from the preset's
  fog and sun colours: shadows lifted towards the fog colour, highlights tinted slightly by the sun,
  and only strongly saturated colours reined in (lime grass, orange dirt). `OVERRIDES` tunes single
  map/time pairs. Grade → Natural is the old ungraded image.

## Files

- `src/client/render/retro.ts`: presets, knob ranges, Custom detection, migration, knob → developer
  and post-pass options (pure, tested in `tests/retro-settings.client.test.ts`).
- `src/client/render/grade.ts`: map grade and haze per time preset.
- `src/client/render/textures.ts` / `developer.ts`: develop variants, live re-develop, filters.
- `src/client/render/shader.ts`: fog scale, haze, sky horizon, viewmodel snap exemption.
- `src/client/render/renderer.ts`: post pass (map grade, 15-bit + dither type/strength).
- `src/client/features/frontend/settings-screen.ts`: the Graphics tab UI.
