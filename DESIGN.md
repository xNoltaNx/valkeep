# Design

<!-- impeccable:design-schema 1 -->

## The world

**A Scandinavian transit departure board.**

Not a dashboard that borrows a transit palette — the board itself, with its
logic intact. A departure board exists to answer, from across a room, in under
two seconds: is the service running, where does it leave from, how many, and is
anything disrupted. That is the whole job of this panel, stated by a different
industry that solved it decades ago.

The reference is specific: Stockholm SL and the Nordic station-hall boards —
deep signage blue, white signage type, amber for live values, a strict ruled
row grid, and disruption notices that interrupt the grid rather than tint it.

Chosen by roll from a seven-candidate derivation (ship's log, homelab rack
faceplate, weather warning board, transit signage, Swedish modernist print,
runestone carving, field specimen sheet). Iron Gate is a Stockholm studio, so
the Swedishness is real rather than decorative — but nothing here is Norse
costume. There are no runes, no parchment, no axes.

**Anti-reference:** the dark-slate-with-ember-accent game dashboard. That is the
category default this direction exists to refuse. Also refused: the
hacker-terminal green-on-black, which the oscilloscope challenger would have
pulled toward and which breaks the contrast floor.

## Why it fits the product

| Departure board element | Panel element |
|---|---|
| Service running / cancelled | Server up / down — stated in words, not color |
| Platform number | **Join code** — the biggest thing on the board |
| Departure roster | Players connected |
| Delay notice | Warnings: backup skipped, update needed, slow first boot |
| Timetable footnote | Player count qualified as best-effort |
| Ruled row grid | Backups, settings, log — one grid, no cards |

The board metaphor also carries the honesty principle. A real board says
"beräknad" (estimated) when it does not know. This one says when the player
count is inferred rather than reported.

## Light or dark

**Dark**, chosen from the use scene rather than category habit: the host is
alt-tabbed out of a full-screen dark game, often at night, and a white page is
a flashbang. Station boards are emissive dark for the same reason — read at a
glance in varied light.

## Palette

Deep signage blue as the ground, not neutral slate. The blue is what separates
this from the rut.

| Token | Value | Use |
|---|---|---|
| `--board` | `#0a1628` | Board ground |
| `--board-raised` | `#122238` | Row bands, panels |
| `--rule` | `#1f3550` | Hairline rules between rows |
| `--signage` | `#f2f5f8` | Primary text, signage white |
| `--signage-dim` | `#9fb2c9` | Secondary text — tinted from the blue, never gray |
| `--amber` | `#ffb02e` | Live values: join code, uptime, counts |
| `--running` | `#4ade80` | Running state, always paired with the word |
| `--stopped` | `#f87171` | Stopped state, always paired with the word |
| `--notice` | `#ff8a3d` | Disruption band |

Contrast: `--signage` on `--board` is ~15:1; `--signage-dim` on `--board` is
~7:1; `--amber` on `--board` is ~9:1. All clear 4.5:1.

**State is never color alone.** Running and stopped are set as words in a
status plate, with a filled versus hollow indicator. Colour is the third signal,
not the first.

## Type

Self-hosted, in `public/fonts/`. No system display face.

- **Archivo** — the board voice. Heavy grotesk with a large x-height, the
  closest open face to Nordic signage lettering. Used for status plates, section
  headings, and buttons, in caps with tight tracking.
- **Martian Mono** — data only, and legitimately: join code, uptime, player
  counts, timestamps, log lines. Tabular figures so numbers do not shimmer as
  they tick. Monospace here is measurement, not costume.

Scale steps: 11px labels · 13px body · 15px row text · 22px section · 44px board
status · 64px join code. Tracking floor -0.04em on display sizes.

## Composition

One ruled grid, top to bottom. No cards, no nested containers.

1. **Board head** — service name, status plate, join code. The only place with
   visual weight; it answers the three questions and is legible from a couch.
2. **Action rail** — one row of controls, horizontal, drawn icons plus caps
   labels.
3. **Sections** — Departures (players), Backups, Console, Settings. Each is a
   ruled table on the same grid, headed by a caps rule label.

Disruption notices interrupt the grid full-width above the section they concern,
in the notice colour, with the problem and its recovery.

## Icons

Authored SVG sprite in `public/icons.svg`, eight glyphs: start, stop, restart,
backup, restore, download, update, settings. One 1.75px stroke, 24px grid,
square cap, no fill. **No emoji and no unicode glyphs anywhere in the UI.**

## Motion

One authored moment: the status plate does a flip-board character roll when the
server changes state, 320ms, exponential ease-out. Nothing else animates.
`prefers-reduced-motion` snaps the plate instead of rolling it.

## Responsive

The board head stacks and the join code stays largest at every width. Section
tables scroll inside their own container; the page body never scrolls
horizontally. Touch targets 44px on the action rail.
