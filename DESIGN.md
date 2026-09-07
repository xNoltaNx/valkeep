# Design

<!-- impeccable:design-schema 1 -->

## The world

**A carved runestone.**

The user pinned Valheim as the brief, and a pinned brief beats the roll. What
remains a decision is the *register* — which of the many things "Valheim" could
mean this becomes. The answer is stone carving, taken as a real craft rather
than as fantasy set dressing.

On an actual Viking-age runestone the inscription runs inside a **serpent
band**: a carved ribbon that winds around the face of the stone, its body
holding the text, its head and tail meeting at the base. This is a genuine
structural device, not ornament — the band organises the surface. It gives the
page a header ornament with real logic behind it, and it is the single art
element that carries the world.

The letterforms follow the same principle. Type is set in **Cinzel**, drawn from
classical inscriptional capitals — letters designed to be *cut into stone*. Not
a fake-runic novelty face. Real carved-letter practice, honestly applied.

Everything on the page is either cut into the stone or raised from it. Rules are
carved channels — a dark line above a light one — never borders.

**Replaces:** the Scandinavian transit departure board (v1). Its structural
logic survives, because that logic was sound and this is an Operate surface:
status plate, oversized join code, one ruled grid, no cards. Only the material
world is replaced.

**Anti-reference, and the thing this must keep refusing:** fantasy pastiche.
Dragon ornament, gold filigree, torn parchment, blackletter, fake runes as a
display font. Valheim's actual art direction is muted, foggy, low-poly and
restrained; the pastiche version is the opposite of the source, and reaching for
it would be failing the brief while appearing to serve it.

## Palette

Weathered stone and bone, with the game's biomes doing the colour work.

| Token | Value | Use | Contrast on stone |
|---|---|---|---|
| `--stone` | `#14120f` | Ground — warm near-black, not neutral | — |
| `--stone-raised` | `#1e1b16` | Raised panels | — |
| `--carve-dark` | `#0a0908` | The cut shadow of a carved channel | — |
| `--carve-lit` | `#3a342a` | The lit lower edge of a channel | — |
| `--bone` | `#e8e0d0` | Primary text | 14.25:1 |
| `--bone-dim` | `#a89e88` | Secondary text — warm, never gray | 7.04:1 |
| `--bronze` | `#d0a758` | Live values: join code, uptime, counts | 8.33:1 |
| `--moss` | `#8fbc5a` | Running (Meadows) | 8.47:1 |
| `--blood` | `#e0645a` | Stopped | 4.9:1 |
| `--frost` | `#a8cee0` | Deep North accent — 1.0's headline biome | 11.19:1 |
| `--ember` | `#e0742f` | Warnings (Ashlands) | 5.97:1 |

The biomes are a real, product-specific colour system rather than an invented
one — Meadows green, Deep North frost, Ashlands ember. Section markers carry a
biome tint so the page has variety without a second palette.

Gold is **dull bronze**, not bright yellow. That restraint is the difference
between Valheim and pastiche.

**State is never colour alone.** Running and stopped are set as words in a
carved plate, with a filled versus hollow mark. Colour is the third signal.

## Type

Self-hosted in `public/fonts/`. 108 KB total, works offline.

- **Cinzel** — display. Inscriptional Roman capitals, letters made to be cut
  into stone. Used for the service name, status plate, and section markers, in
  caps with open tracking, as inscription is set.
- **Alegreya Sans** — body. A warm humanist sans; a cold neo-grotesk would fight
  the stone.
- **IBM Plex Mono** — data only, and legitimately so: join code, uptime, counts,
  timestamps, log lines. Tabular figures so numbers do not shimmer as they tick.

Scale: 11px markers · 13.5px body · 15px row text · 22px section · 40px status ·
64px join code. Tracking opens rather than tightens on display sizes, because
carved capitals are spaced apart, not crowded.

## Materials

**The carved channel** is the page's one structural device, used for every rule
and every inset field:

```
border-top: 1px solid var(--carve-dark);
border-bottom: 1px solid var(--carve-lit);
```

Dark above, lit below — the way a cut in stone catches light from above. It
replaces every plain border and is why the page reads as carved rather than
drawn.

**Stone grain** is a single tiled SVG turbulence at very low opacity over the
ground. One texture, not a photograph.

**Fog.** Valheim's signature is atmospheric depth — distance fades. The board
ground carries a slow vertical gradient, lighter at the top, so the page has
depth without a shadow anywhere.

## Art

Authored original SVG in `public/art.svg`. No traced or extracted game assets.

- **Serpent band** — the header ornament. A winding ribbon with a carved inner
  channel, head and tail meeting, drawn in the runestone convention. Sits above
  the service name, full width, and is the page's one decorative moment.
- **Biome marks** — eight small carved glyphs, one per biome, used as section
  markers.
- **Icon set** — eight controls, one 1.75px stroke on a 24px grid.

No emoji, no unicode glyphs, anywhere.

## Composition

Unchanged from v1, because it works and this is an Operate surface:

1. **Stone head** — serpent band, service name, status plate, join code.
2. **Connection** — how friends actually get in, stated plainly.
3. **Action rail** — one row of carved controls.
4. **Sections** — Connected, Backups, Console, World & Settings, Gameplay.

## Motion

One authored moment: the status plate rolls when the server changes state,
320ms, exponential ease-out. Nothing else animates. `prefers-reduced-motion`
snaps instead.

## Responsive

The stone head stacks; the join code stays largest at every width. Section
tables scroll inside their own container; the body never scrolls horizontally.
Touch targets 44px on the rail.
