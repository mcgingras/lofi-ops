# Retro look references

Research notes for the "Retro strength" setting and general look polish in Lo-Fi Ops. Each game
section lists concrete techniques with where the observation came from. Tags:

- **[Obs]** seen directly in a Steam store screenshot (1920x1080 JPEG, viewed full size and
  pixel-cropped in the browser) or stated on an official / wiki page.
- **[Meas]** measured from screenshot pixels with a small canvas script (run-length of flat colour
  blocks gives the upscale factor, so internal lines = 1080 / block size; mean RGB and a
  5-bin luminance histogram give grade and exposure). JPEG noise makes these approximate.
- **[Dev]** stated by the developer (interview, store page, settings menu text).
- **[Inf]** my inference, not confirmed.

Steam screenshots were taken from the store API (`store.steampowered.com/api/appdetails?appids=ID`)
and opened at `shared.akamai.steamstatic.com/store_item_assets/steam/apps/ID/ss_<hash>.1920x1080.jpg`.
Hashes below are shortened to the first 6 characters.

---

## Crow Country (SFB Games, 2024, Unity)

Sources: Steam app 1996010 (screenshots ss_68a24d living room, ss_2ea75b corridor fight,
ss_aaf254 park entrance, ss_5eb786 arcade, ss_70a23e car park); Source Gaming interview with
Adam Vian (sourcegaming.info/2024/05/07/interview-sfb-games-crow-country/); Wikipedia;
Aftermath review (aftermath.site/crow-country-review-indie-survival-horror-game-lowfi/);
CrowCountryResolutionFix mod README (github.com/makotech222/CrowCountryResolutionFix);
PCGamingWiki (pcgamingwiki.com/wiki/Crow_Country).

- **Internal resolution: 240 lines.** [Meas] Every screenshot (8 checked) has flat blocks of 4-5
  px (runs cluster at 4, 5, 9, 13-14, 18), i.e. 4.5x upscale of 1080 = 240 lines (about 427x240).
  Upscale is nearest (hard block edges). [Obs] The resolution-fix mod exposes an "internal
  resolution multiplier" and a toggle for the game's CRT/PSX post filters, so the low-res target
  and the filter are separate stages. PCGamingWiki: output is letterboxed to 16:9.
- **Dither: none visible.** [Obs] Pixel crops of dark gradients (ss_70a23e top left) show smooth
  value changes block to block, no regular 2x2 or 4x4 pattern. The softness comes from a CRT-ish
  filter instead: reviews describe a yellowish smear and grain over the image (Aftermath calls it
  a lo-fi CRT haze).
- **Lighting: real-time, not unlit.** [Obs] Characters cast soft shadows on the floor
  (ss_2ea75b), lamps make warm pools of light (ss_68a24d), and most of the frame is in darkness.
  [Meas] 72-98% of sampled pixels fall in the darkest fifth of luminance in interior shots.
- **Colour grade: one dominant hue per area.** [Meas] Living room mean RGB (49,22,3), car park
  (55,39,8), park entrance (51,40,10): saturated amber/olive with blue almost absent. The arcade
  (ss_5eb786) flips to magenta/violet, mean (81,34,84). [Obs] Within an area, props share the
  grade; only pickups and signs break it (red "PRIVATE PROPERTY" sign, white car).
- **Fog / sky.** [Obs] Interiors float in pure black (the camera looks down, no sky; Vian
  describes an isometric-style view "floating in a black space", after FFVII). Outdoors
  (ss_aaf254) the far end of the plaza fades into a flat olive haze close to the floor colour,
  and the night sky is black, so fog colour = ambient darkness and nothing reads as a seam.
- **Models and texels.** [Obs] Chunky low-poly characters against denser, more detailed
  environments, a deliberate FFVII contrast per Vian. Texture detail is roughly 1 texel per game
  pixel at the default camera distance: brick and tile lines are 1 block wide, signs are readable
  at 240p because their lettering is big. [Inf] Texel density is held consistent across props.
- **UI.** [Obs] HUD (ammo boxes, "Handgun" label, button glyphs) is drawn at native resolution,
  crisp and anti-aliased, over the 240p world.
- **Why it looks tidy.** [Inf] Clean geometry with no wobble (no visible vertex snap or affine
  warp in stills), restricted hue per room, darkness used as the "fog", 240p with a soft filter
  rather than dither noise.

## ULTRAKILL (New Blood / Arsi "Hakita" Patala, Unity)

Sources: ULTRAKILL wiki settings page (ultrakill.wiki.gg/wiki/Settings); Steam discussion with
Hakita's reply (steamcommunity.com/app/1229490/discussions/1/3044983510167265625); Steam app 1229490
screenshots ss_8c743b (outdoor courtyard), ss_bc7a00 (orange pyramid level), ss_7a5692 (white hall),
ss_d058f8 (orange corridor), ss_2f2213 (green sewer).

**PSX settings section** [Obs, wiki], with defaults:

| Option | Type / range | Default |
|---|---|---|
| Downscaling | dropdown: Off, 720p down to 36p ("Absurd") | Off |
| Dithering | slider 0-500% ("amount of dithering used to blend color distribution") | 100% |
| Texture Warping | slider 0-100% (affine) | 0% |
| Vertex Warping | None, Light, Medium, Heavy, Very Heavy, Modern Art | None |
| Color Compression | None, Light, Medium, Heavy, Very Heavy, Indie Art Game ("range of colors available") | Medium |
| Custom Color Palette | toggle, plus a Color Palette Texture picker | Off |
| Gamma | 0.0-2.0 | 1.0 |

- [Dev] Hakita: for the "PC" look, disable everything in the PSX section except Color
  Compression. The intro setup lets players choose a style, and the defaults ship with warping
  off. So the developer's own baseline is: full resolution, colour compression on, dither on, no
  wobble. Warping is a novelty dial, not the core look.
- **Texture filtering: nearest, low-res textures at native resolution.** [Meas] Store shots have
  native-res geometry edges (runs of 2-6 px, no block pattern), but [Obs] texels are 6-12 screen
  px at 1080p (ss_bc7a00 stairs crop). Edges of geometry are 1-px aliased while texture texels
  are large: the retro read comes from texture size, not from render resolution.
- **Palette.** [Obs] Textures have few tones each (the stair wood shows about 5 values), with
  visible banding consistent with Color Compression on Medium.
- **Per-level grade + painted sky + matched horizon.** [Obs] The pyramid level (ss_bc7a00) is
  almost monochrome orange: the painted sky gradient, sun glow and the ground haze are the same
  orange, so the horizon dissolves. The white hall (ss_7a5692) is white/grey with red accents
  only. The corridor (ss_d058f8) is one orange-brown with dark trim lines. [Meas] Pyramid shot
  mean RGB (123,85,23), saturation 0.73; white hall saturation 0.07.
- **Enemy readability.** [Obs] Enemies are more detailed and textured than the level and use a
  contrasting hue (olive-green husks against the orange corridor). Effects (shield bubbles,
  explosions) are low-res pixelated sprites over native-res geometry.
- **UI.** [Obs] Style meter and HUD at native resolution, bold flat colours.

## Signalis (rose-engine, 2022, Unity)

Sources: Steam app 1262350 screenshots ss_a26036 (infirmary), ss_9d6023, ss_dc8778, ss_4ec0c1;
Indie Graze interview with Alex Zwerger (indiegraze.com/?p=989, now 404; text quoted in search
results); Wikipedia (en.wikipedia.org/wiki/Signalis).

- **640x360 fixed internal resolution.** [Dev] The team keeps everything at 640x360 and renders
  3D models at that resolution before upscaling, so models match the sprite detail. [Meas]
  Store shots show flat 3 px blocks (runs at 3, 6, 9, 12) = 360 lines, confirming it.
- **Clean, flat colour, no dither.** [Obs] Pixel crop of ss_a26036 shows flat colour fields,
  single-pixel rivets, 1-px dark seams around wall panels, and no dither pattern anywhere.
- **Texel density ~1:1 with the internal pixel.** [Obs] Rivets, labels and panel lines are each
  one game pixel; textures are authored for the 360p grid, not downsampled photos.
- **Lighting: real-time hard shadows.** [Obs] The player's light and gunfire throw long, sharp
  shadows from IV stands and furniture; the rest of the room is dark olive. [Meas] Interior
  shots put 68-86% of pixels in the darkest luminance fifth; grades swing per area from khaki
  (mean 54,47,25) to cold blue (36,44,55).
- **Influences.** [Dev] PS1 survival horror plus paintings (Bracht, Boecklin) and Evangelion; a
  CRT filter is an option, not baked in.

## Mouthwashing (Wrong Organ, 2024, Unity)

Sources: Steam app 2475490 screenshots ss_d582f6 (red emergency), ss_ec922c (amber diner),
ss_bf9f8a (green cockpit); Wikipedia (en.wikipedia.org/wiki/Mouthwashing_(video_game)).

- **360-line internal resolution.** [Meas] Flat 3 px blocks (runs 3, 6, 9, 12).
- **Screen-space ordered dither, clearly visible in the darks.** [Obs] Crop of the dark seat in
  ss_bf9f8a shows a regular checker/Bayer dot grid at one game pixel per dot. The grid continues
  across surface boundaries, so it is applied to the final image, not in texture space. In
  bright areas it disappears into texture detail.
- **Near-monochrome room grades.** [Meas] Emergency shot mean (109,12,8), saturation 0.93;
  diner mean (81,34,16); cockpit mean (18,30,17) with green monitors as the only light. [Obs]
  Each room is effectively a duotone: black plus one hue, with a single accent (purple glitch,
  green subtitles).
- **Textures.** [Obs] Low-res photo-like and painted textures (fabric weave, posters) sampled
  nearest; characters have painted faces with strong value contrast so they read at 360p.
- **UI.** [Obs] Subtitles in a smooth serif font at native resolution, not pixelated.
- [Dev] Art lead Johanna Kasurinen credits Puppet Combo for the PS1 style (Wikipedia).

## DUSK (David Szymanski / New Blood, 2018, Unity)

Sources: Steam app 519860 screenshots ss_1ed571 (wall text), ss_b2668c (butcher corridor),
ss_c06144 (sewer); Kill Screen interview (killscreen.com/dusk-90s-style-shooter-mind-teenager/);
PCGamingWiki (pcgamingwiki.com/wiki/Dusk).

- [Dev] The hard part was getting Unity to stop improving the image; textures were made both
  lower-res and with smaller colour palettes, and the crunchier options are toggles so players
  choose how faithful to be. PCGamingWiki: the "Resolution" option sets the internal render
  resolution when fullscreen; no AA, no anisotropic filtering.
- **Lighting: dynamic coloured point lights + dark ambient.** [Obs] Complementary pairs:
  green-teal ambient against orange torch/lamp light (ss_b2668c, ss_c06144); red light on stone.
- **Fog: coloured, used to give corridors depth.** [Obs] ss_b2668c: the far end of the
  corridor fades into an orange haze lit by a lamp, while the near wall stays green.
- **Textures.** [Obs] Nearest-sampled, low-res photo-sourced stone, brick and wood with large
  visible texels (ss_1ed571 crate); limited palettes per texture.

## Bomb Rush Cyberfunk (Team Reptile, 2023)

Sources: Steam app 1353230 screenshots ss_88eb0d, ss_df565f, ss_044bea; Wikipedia.

- **Native resolution, clean.** [Meas] No block pattern; [Obs] crisp edges.
- **Flat cel lighting with heavy outlines.** [Obs] Two-tone shading (lit / shadow) on
  buildings, thick dark outlines on characters (Jet Set Radio lineage per Wikipedia).
- **Aerial perspective fog matched to the sky.** [Obs] Distant towers fade toward the teal sky
  colour; near objects are saturated. [Meas] Sky band colour (106,114,97)-(117,136,107) is close
  to the frame mean, so haze and sky are one family.
- **Palette discipline.** [Obs] Pastel city base with a few saturated accents (red rails,
  yellow graffiti, magenta signs). Big simple shapes at range, detail concentrated near the
  player.

## Hypercharge: Unboxed (Digital Cybercherries, UE4)

Sources: Steam app 523660 screenshots ss_34124d, ss_0bb7b7; Unreal Engine developer interview
(unrealengine.com/en-US/developer-interviews/armed-with-charm-hypercharge-unboxed-creates-a-compelling-co-op-shooter-experience).

- [Obs] Not technically retro: modern rendering with bloom, god rays and real-time shadows. The
  PS2-era feel comes from theme, toy proportions and saturated readable characters.
- [Dev] They lean on high-quality precomputed (baked) lighting plus volumetric fog for shading
  that stays cheap on low-end hardware, use carefully generated LODs and computed fade distances
  for static meshes, and build environments at 12x real scale so figures read as 6 inches tall.
- [Obs] Golden-hour grade: warm white sky, backgrounds hazed toward the sky colour, saturated
  green / orange characters in front. [Meas] Sky band (169,162,119)-(206,186,152), warm.

---

## Cross-game patterns

1. **One internal resolution, applied to everything in the world.** Crow Country 240,
   Signalis/Mouthwashing 360; ULTRAKILL and DUSK default to native and get the retro read from
   texture size and palette instead.
2. **HUD and text always native-res** (Crow Country, ULTRAKILL, Mouthwashing).
3. **Palette restriction matters more than wobble.** ULTRAKILL ships warping off and colour
   compression on; DUSK's core trick was small-palette textures; Signalis and Crow Country show
   no wobble in stills.
4. **Dither is optional and, when used, screen-space** (Mouthwashing, ULTRAKILL's slider).
   The two "cleanest" looks (Signalis, Crow Country) use no visible dither at all.
5. **Per-area dominant hue.** Every game holds one hue family per room/level and spends accent
   colour on interactables and enemies.
6. **Fog = horizon = darkness.** Fog colour always matches what is behind the geometry: sky
   horizon (ULTRAKILL, BRC, Hypercharge) or black (Crow Country, Signalis interiors).
7. **Texel density tied to the pixel grid**: about one texel per internal pixel at typical
   viewing distance (Signalis, Crow Country), or uniformly chunky (ULTRAKILL).

## Takeaways for Lo-Fi Ops

Context from the current code (read only): `src/client/render/renderer.ts` renders at
240/360/480/720 lines and optionally quantises to 32 levels with a 4x4 Bayer screen dither; the
pixel HUD is drawn at the low resolution; `shader.ts` snaps vertices to `uSnap` (the renderer
sets it to half the internal resolution, i.e. a one-internal-pixel grid) and fades fog with `smoothstep(fogNear, fogFar, dist)`; textures are 16-colour with a
baked 4x4 pattern dither at 75%; maps define `fog`, `fogNear`, `fogFar` per time of day
(e.g. Rust day 12-74 m, night 8-58 m). Vertical FOV default 70 degrees.

1. **Derive fog colour from the sky horizon, never pick it separately.** At map load, sample the
   sky dome texture's horizon row (average of the 8-16 px band at elevation 0) and use it as
   `fog`, or author both from one value. Any mismatch reads as a grey wall in front of the sky.
   (ULTRAKILL ss_bc7a00, BRC ss_88eb0d, Crow Country ss_aaf254.)
2. **Fog is gameplay, so keep it identical across presets.** The Retro strength knob may change
   curve shape (e.g. linear vs smoothstep) but not `fogFar`, or "Off" becomes a wallhack. Cap
   fog density at about 0.85 so silhouettes at the longest sightline stay visible, and set
   `fogFar` to about 1.3x the longest sightline of each map. (Inference; Hypercharge's
   fade-distance tooling is the dev-side analogue.)
3. **One dominant hue per map/time-of-day, plus accents.** Give every time-of-day preset a
   grade: a hue, a saturation scale (0.6-0.85 for the environment) and a lifted-black colour
   (e.g. blacks at 4-8% of the fog colour, not pure 0). Leave player models, pickups and the
   objective ungraded or graded less so they pop. (Crow Country per-area grades, Mouthwashing
   duotones, ULTRAKILL enemies against level hue.)
4. **Colour reduction belongs on the final image, not only in textures.** Make the 15-bit
   framebuffer (32 levels per channel, 4x4 Bayer) the backbone of Subtle and above. It unifies
   textures, vertex light, fog and sky into one palette, which is what ULTRAKILL's default
   Color Compression does. (ULTRAKILL wiki and Hakita's reply.)
5. **Lower the baked texture dither.** A 4x4 pattern baked into photo textures at 75% sits in
   texture space, so it scales with distance, shears at grazing angles and aliases against the
   screen grid with nearest sampling: a likely cause of "sometimes it doesn't look great".
   Suggest 35-50% for Classic and 0% for Off, letting the screen dither handle gradients. Large
   flat surfaces (walls, ground) can drop texture dither entirely. (Inference; Mouthwashing and
   ULTRAKILL dither in screen space, Signalis and Crow Country do not dither.)
6. **Keep texel density consistent at ~24-32 texels per metre.** With 70 degrees of vertical FOV,
   one internal pixel at 10 m covers about 3.9 cm at 360 lines (5.8 cm at 240, 2.9 cm at 480),
   so 26 texels/m is 1:1 at 10 m in Classic. Flag materials outside 16-48 texels/m in the
   developer view. (Signalis 1:1 texels, Crow Country.)
7. **Keep the vertex snap grid tied to the internal resolution.** Snap in NDC to
   `internalRes / k` with k = 1 for Subtle/Classic (one internal pixel, wobble almost invisible
   but edges crawl in step with the pixel grid) and k = 2 for Full PS1. (The renderer already
   does this: `uSnap` follows the render target size.) A grid that did not follow the
   resolution would give 4-px jumps at 720 lines, which reads as a bug. Never snap the viewmodel. (PS1 hardware
   behaviour; ULTRAKILL ships it off by default.)
8. **Keep affine warp subtle, and subdivide.** Affine error grows with polygon screen size and
   depth range, so floors and long walls swim badly. Subdivide large quads to about 2 m (also
   gives baked vertex lighting more samples) and cap the warp at 0.25 in Classic; 1.0 only in
   Full PS1. Keep sky, viewmodel and HUD at 0. (ULTRAKILL Texture Warping default 0%.)
9. **Sky: low-res painted gradient, more colours than props.** Author sky domes at about
   256x128 to 512x256, sample nearest, give the horizon band 8-16 px of flat colour that equals
   the fog colour, and exempt the sky from 16-colour texture reduction (32+ colours, or let the
   screen dither do it) so gradients do not band into stripes. (ULTRAKILL ss_bc7a00 painted
   sky; Crow Country black void at night.)
10. **Draw the HUD at native resolution (or 2x internal) in all presets.** At 240 lines the
    current low-res HUD text becomes unreadable; every reference keeps HUD/text crisp. A pixel
    font scaled by an integer at native res keeps the style. (Crow Country, ULTRAKILL,
    Mouthwashing.)
11. **Use darkness as fog at night and indoors.** Night presets should use near-black fog
    (current Rust night 0.08,0.08,0.14 is right) and keep lamp pools bright (vertex light up to
    1.2-1.5x) so contrast, not distance, defines the space. (Crow Country, Signalis, DUSK.)
12. **Complementary light pairs per map.** Bake one warm key (lamps, sun) and one cool fill
    (ambient), e.g. orange 1.0,0.6,0.3 against teal 0.3,0.45,0.5, rather than neutral grey
    ambient. (DUSK green/orange corridors.)
13. **Give player models a readability floor.** Players and the viewmodel should never drop
    below about 0.35 brightness in the dynamic light term, and optionally get a one-pixel dark
    outline at internal resolution. (ULTRAKILL enemy contrast; Signalis 1-px seams; BRC
    outlines.)
14. **Optional "composite" softness only in Full PS1.** A 1-px horizontal blur or slight chroma
    bleed at internal resolution, applied before quantise, softens dither noise the way Crow
    Country's CRT filter does. Off in all other presets. (Crow Country reviews; Signalis CRT
    option.)

### Suggested preset values

| Knob | Off (Modern lo-fi) | Subtle | Classic (default) | Full PS1 |
|---|---|---|---|---|
| Internal resolution | 720 lines | 480 | 360 | 240 |
| Texture palette | 32 colours | 32 colours | 16 colours | 16 colours |
| Framebuffer depth | full (8-bit/channel) | 15-bit (32 levels) | 15-bit | 15-bit |
| Screen dither | off | 4x4 Bayer 50% | 4x4 Bayer 100% | 4x4 Bayer 100% |
| Baked texture dither | 0% | 35% | 50% | 75% (current) |
| Vertex snap | off | off | 1 internal px | 2 internal px |
| Affine warp | 0 | 0 | 0.25 (subdivided meshes) | 1.0 |
| Fog | map value | map value | map value | map value, linear curve |
| Texture filter | nearest + nearest mips | nearest + nearest mips | nearest + nearest mips | nearest, no mips |
| Composite softness | off | off | off | on |
| HUD | native | native | native | native, integer-scaled pixel font |

Reasoning:

- **Off** is ULTRAKILL's "PC settings" idea: crunchy textures and the map grade, nothing that
  moves or adds noise. 720 lines rather than full keeps texels chunky without needing new art.
- **Subtle** adds the unifying 15-bit pass at half dither strength. 480 lines gives about 1:1
  texels at 13 m with the current art. No geometry effects, so it is safe for competitive play.
- **Classic** matches the reference sweet spot: Signalis and Mouthwashing both run at 360
  lines. Snap at one internal pixel and a light warp give the PS1 feel without visible swimming.
  Texture dither drops to 50% because the screen dither now handles gradients.
- **Full PS1** matches Crow Country's 240 lines and real PS1 behaviour (no mipmaps, full affine,
  2-px snap). Fog stays at the map value (gameplay parity); only the curve changes. Expect
  shimmer on distant textures without mipmaps; that is authentic but should only exist in the
  opt-in preset.

---

## What shipped (and where each change came from)

The presets above were a starting point; the shipped values (`src/client/render/retro.ts`,
`docs/features/retro.md`) keep **Classic exactly as approved** and put the stronger ideas in the
other presets, so the owner can compare before changing the default.

| Change | Presets | Reference |
|---|---|---|
| Sky dome fades to the fog colour at the horizon (`uHorizon`) | all | Takeaway 1, 9: ULTRAKILL, BRC, Crow Country fog matched to what is behind geometry |
| Distance haze on unfogged backdrops (mountains, hills) | all | Takeaway 1: aerial perspective in Crow Country outdoor shots, Hypercharge warm haze |
| Skies develop at full colour, no texture crosshatch | all | Takeaway 9: painted gradient skies, no banding |
| Map grade per time of day: lifted shadows towards fog, loud colours reined in, sun-tinted highlights | all (Grade: Map, default) | Takeaway 3: Crow Country one-hue-per-area grade, Mouthwashing |
| 15-bit framebuffer + ordered dither on the final image | Full PS1 (palette `15bit`) | Takeaway 4: ULTRAKILL colour compression, PS1 hardware, Mouthwashing screen dither |
| Vertex snap tied to internal resolution, viewmodel exempt, depth kept exact | Full PS1 | Takeaway 7: PS1 GTE; ULTRAKILL vertex warping |
| Affine warp as a 0-100% blend | Full PS1 (70%) | Takeaway 8: ULTRAKILL texture warping slider (0-100%) |
| Fog distance never pushed past the map value | all | Takeaway 2: fog is gameplay |
| 240 / 360 / 480 / 720 lines | PS1 / Classic / Subtle / Off | Crow Country 240, Signalis and Mouthwashing 360, ULTRAKILL downscaling options |
| Full PS1 keeps mipmaps | Full PS1 | Inference from testing: without mips 240-line photos sparkle (looks broken) |

Not adopted (yet), for the owner to decide: lowering Classic's baked texture dither (takeaway 5),
HUD at native resolution (takeaway 10), readability floor/outline for players (13), CRT softening
(14), and a strict shared per-map palette (textures already use per-texture adaptive palettes; the
map grade gives most of the cohesion at no developer cost).
