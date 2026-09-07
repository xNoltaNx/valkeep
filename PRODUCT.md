# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node + Express backend serving a plain HTML/CSS/JS frontend. No build step, no
frontend framework, no bundler. One runtime dependency (`express`). Tests run on
the built-in `node:test` runner. Chosen in the design phase and recorded in
`docs/superpowers/specs/2026-09-07-valheim-control-panel-design.md`, on the
grounds that the difficulty in this project is process lifecycle and log
parsing, not the view layer.

## Users

One primary user: the person who hosts the Valheim server on their own Windows
PC for a small group of friends. They are technically capable but are not
looking to run commands — the point of the panel is that server operations stop
requiring a terminal.

Their situation is specific and worth designing for: they open this while the
game is running, often alt-tabbed out of Valheim mid-session, sometimes on a
phone from the couch on the same LAN, usually to answer one of three questions —
is it up, what is the join code, who is on — or to press one button and go back
to playing. Sessions with the panel are short and interruptive by nature.

Friends are beneficiaries but never operators. They never load the panel; they
receive the join code from the host through whatever chat they already use.

## Product Purpose

Install, run, monitor, back up, and update a Valheim dedicated server from a
browser on the local network, so that keeping the server healthy costs the host
seconds rather than a terminal session.

Success on 2026-09-09, the day Valheim 1.0 ships, is concrete: the host updates
the server and their friends get in without anyone editing a batch file, and no
world is lost doing it.

## Positioning

Most Valheim server panels are rented control panels wrapped around someone
else's hosting. This one runs on the host's own machine, which means it can do
two things a hosted panel structurally cannot: launch and signal the actual
process, and hold its own backups on the host's own disk, independent of any
provider's retention policy.

## Operating Context

- The panel runs on the same Windows PC as the game server, started by
  double-clicking `start.bat`. It is not a service and does not start at login.
- LAN only, no authentication, no port forwarding. Reachable from other devices
  in the house.
- Valheim has **no RCON or admin command channel**. Every live fact — player
  count, names, world saves, the crossplay join code — is read by parsing the
  server's log output. This is the defining constraint on what the panel can
  truthfully display.
- The crossplay join code changes on every restart. It is the single most
  requested piece of information and the reason the host opens the panel most
  often.
- Valheim 1.0 enforces a strict version lock. Clients auto-update on launch day,
  so a server on an older build is not degraded — it is unreachable by everyone.
- World generation on first boot takes about 65 seconds (measured). A slow start
  is normal, not a failure.

## Capabilities and Constraints

Confirmed and built:

- Start, stop, and restart the server; status survives a panel restart by
  re-attaching to the recorded process.
- Live log stream, plus parsed events: join code, player names, world saves.
- Backups: on a timer, before every stop, and on demand; list and restore, with
  a safety snapshot taken before any restore overwrites the current world.
- Install and update the server binaries via SteamCMD, with progress streamed.
- Edit server settings: name, world, password, port, public, crossplay, save
  interval, backup cadence, preset, and modifiers.

Constraints future work must preserve:

- Player count is best-effort, never authoritative. Two sources disagree by
  nature — the session line and connection bookkeeping — and the interface must
  not present a confident number it cannot stand behind.
- Log patterns live in `config.json` and are expected to need editing when the
  game patches. Nothing may hardcode them.
- Backups are format-agnostic. The `.db`/`.fwl` pair may be replaced by a folder
  of pieces in 1.0; nothing may assume file extensions.
- Stop takes a few seconds and must not be interrupted — that window is when the
  world is written.

Terminology, used exactly as Valheim uses it: **world** (not "save" or "map"),
**join code** (not "invite" or "room code"), **crossplay**, **dedicated server**.

## Brand Commitments

**Binding, set by the user on 2026-09-07:** the panel is themed to Valheim —
the game's own colours and art register. This is a pinned aesthetic and
overrides any generic direction, including a design roll.

What that pin does *not* license, and what future work must keep refusing:
generic fantasy pastiche. Valheim's real art direction is muted, low-poly,
foggy and restrained — not saturated, not ornate, not gold-filigree. Fake runic
display faces, parchment textures and dragon ornament are the pastiche rut, and
they are the opposite of the source.

All artwork is **authored original SVG**. Iron Gate's assets are their
copyrighted work and are never extracted, traced, or copied.

Explicitly **not** a commitment: the "dark slate with an ember accent" game
dashboard, which remains the category default this project refuses.

## Evidence on Hand

Real, in this repository:

- `docs/shutdown-probe.md` — measured results from three shutdown trials against
  a real server, including real log line formats.
- `test/fixtures/real-crossplay-startup.log` — 197 lines captured from a running
  crossplay server.
- A working backend, verified end to end: the API started a real server, surfaced
  join code 887782 in 11 seconds, backed up a 649 KB world, and stopped
  gracefully in 3.5 seconds with a confirmed world save.

Absences future work must not fabricate: there are no users besides the host, no
testimonials, no usage metrics, no uptime history, and no multi-server or
multi-tenant story. The connection and player-name log patterns are **unverified
against a real client** — no second machine has joined the server yet.

## Product Principles

1. **Answer the three questions instantly.** Is it up, what is the join code,
   who is on. Everything else is secondary and can cost a scroll.
2. **Never claim more certainty than the log supports.** Where the data is
   best-effort, the interface says so rather than rendering a confident number.
3. **The world is the irreplaceable thing.** Hours of play live in one file set.
   Every destructive path backs up first and says what it did.
4. **Built for the interruption.** The host is mid-game, alt-tabbed, in a hurry.
   The panel is read in seconds and acted on in one click.
5. **Patch day is a normal day.** The game will change out from under this. What
   changes must be configuration, not code.

## Accessibility & Inclusion

Body text at or above 4.5:1 contrast. Server state must never be carried by
color alone — running versus stopped is the most important fact on the page, and
red/green is the most common color-vision confusion.
