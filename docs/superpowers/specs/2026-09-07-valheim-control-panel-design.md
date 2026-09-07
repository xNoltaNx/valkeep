# Valheim Server Control Panel — Design

Date: 2026-09-07
Status: Approved, ready for implementation planning

## Purpose

A local web dashboard for running a Valheim dedicated server on a home
Windows PC, ready for the 1.0 release on Wednesday 2026-09-09. It
starts and stops the server, shows who is connected, streams the
server log, manages world backups, edits server settings, and installs
or updates the server binaries.

## Context and constraints

- The server runs on the user's own Windows 11 PC. Nothing is rented or
  managed by a third party.
- Access is LAN-only, used by the owner alone. There is no
  authentication, no port forwarding, and no tunnel. The panel listens
  on `0.0.0.0:8080` so it is reachable from other devices at home, and
  must never be exposed to the internet as designed. The Valheim server
  password is stored in plaintext in `config.json`, which is acceptable
  only under that LAN-only assumption.
- The panel is launched by double-clicking `start.bat`. It is not a
  Windows service and does not auto-start at login.
- Node v22.11.0 and npm 10.9.0 are installed. Python 3.11 is present
  but unused.
- As of this writing the machine has no Valheim dedicated server, no
  SteamCMD, and no existing worlds. The panel performs the initial
  install.
- Valheim has **no RCON or admin command channel**. Every fact about a
  running server — player count, names, world saves, the crossplay join
  code — is obtained by parsing the server's log output. This is the
  central constraint on the design.
- 1.0 ships two days after this document. It is expected to change log
  line formats and possibly launch flags.

### Verified against current documentation (2026-09-07)

- **Shutdown is Ctrl+C, not a window close.** Iron Gate's official
  guide states the server must be closed "by pressing CTRL+C in the
  Command-window", and warns that closing via the window's X may leave
  the server running in the background. This resolves the open question
  from the earlier draft: a graceful `taskkill` is *unlikely* to be
  sufficient, and a Ctrl+Break helper is the primary mechanism rather
  than a fallback.
- **Autosave default is 1800 seconds (30 minutes)**, set by
  `-saveinterval`. An earlier draft said 20 minutes; that was wrong.
- **Valheim has its own backup system** via `-backups` (default 4),
  `-backupshort` (7200s) and `-backuplong` (43200s). The panel's
  backups complement these rather than replace them.
- **The save format may change in 1.0.** A rewritten save system on the
  public test branch replaces the `.db`/`.fwl` pair with a folder of
  smaller file pieces. Iron Gate has not said whether it ships with
  1.0. This directly affects the backup design; see Backups.
- **1.0 enforces a strict version lock.** Server and client must run
  the identical build or players get "Incompatible Version". Clients
  auto-update on launch day, so an un-updated server is effectively
  offline. This makes the SteamCMD update path the single most
  important feature on Wednesday.
- **Crossplay uses the PlayFab backend** and in 1.0 spans PC, Xbox,
  PS5 and Switch 2. Steam and PlayFab backends produce different
  connection log lines, so patterns must cover both.
- Default save directory on Windows is
  `%USERPROFILE%/AppData/LocalLow/IronGate/Valheim`, with worlds under
  `worlds_local`. The log flag is `-logFile`, capital F.

## Approach

A Node + Express backend with a plain HTML/CSS/JS frontend. No build
step and no frontend framework. Express serves the page and a small
REST API; Server-Sent Events push log lines, status changes, and
install progress to the browser.

Two alternatives were considered and rejected. A React + Vite frontend
would add a build step and consume time better spent on process
lifecycle, for a single-page panel with one user. A pure PowerShell
implementation would avoid npm dependencies but `HttpListener` handles
streaming, JSON, and concurrency poorly, and Node is already installed.

The difficulty in this project is process lifecycle and log parsing,
not the view layer. The chosen approach puts the effort there.

## Layout

```
E:\ai-projects\valheim-server\
  start.bat            double-click entry point
  config.json          settings: server name, password, world, paths, ports, log patterns
  src/
    server.js          Express app: static files, REST routes, SSE stream
    process.js         spawn / stop / status / re-attach
    logtail.js         follows the logfile, emits new lines
    parser.js          log patterns -> events
    backups.js         snapshot / list / restore / prune
    steamcmd.js        install + update
    settings.js        reads config.json, builds launch args
  public/              index.html, app.js, style.css
  data/
    state.json         { pid, startedAt, world }
    backups/
    logs/server.log
```

Each module has one purpose and a narrow interface. `parser.js` and
`settings.js` are pure functions over data and are tested directly.
`backups.js` touches only the filesystem. `process.js` is the only
module that spawns or kills anything.

## Process lifecycle

**Start.** `settings.js` builds the argument list from `config.json`.
The full supported surface, all exposed in Settings:

| Flag | Purpose |
|---|---|
| `-name` | server name in the browser list |
| `-port` | default 2456; also uses port+1 |
| `-world` | world name; created if absent |
| `-password` | min 5 chars, must differ from server name |
| `-public 1\|0` | listed in the browser, or direct-join only |
| `-crossplay` | PlayFab backend; PC/Xbox/PS5/Switch 2 |
| `-savedir` | save location override |
| `-logFile` | log path (capital F) |
| `-saveinterval` | autosave seconds, default 1800 |
| `-backups`, `-backupshort`, `-backuplong` | built-in backup retention and cadence |
| `-instanceid` | needed only for multiple servers on one port |
| `-preset` | Normal, Casual, Easy, Hard, Hardcore, Immersive, Hammer |
| `-modifier`, `-setkey` | combat, death penalty, resources, raids, portals, nomap etc. |

`settings.js` validates the password rule (5+ characters, not equal to
the server name) before allowing a start, since violating it is a
silent startup failure.

`process.js` spawns `valheim_server.exe` detached with
`stdio: 'ignore'`, calls `unref()`, and writes `{ pid, startedAt, world }`
to `data/state.json`.

Detaching is deliberate. The game server survives a panel restart or
crash, so the panel can be stopped and restarted without disconnecting
players. The cost is that the panel cannot capture stdout directly and
must tail the logfile instead, adding roughly a second of latency to
displayed log lines. This is the correct trade for a server other
people are playing on.

**Re-attach.** On boot the panel reads `state.json` and verifies the
recorded PID is both alive **and** actually `valheim_server.exe`, via
`tasklist`. The image-name check is required, not optional: Windows
recycles PIDs, and without it the panel could report a stopped server
as running, or offer to kill an unrelated process.

**Stop.** Valheim writes the world only on a clean shutdown, and with
no RCON there is no way to command a save. Iron Gate's documented
shutdown is Ctrl+C in the server's console window, so the panel must
deliver a real console control event — not a window close, and not a
plain kill. Stop is therefore a sequence:

1. Take a backup unconditionally.
2. Send Ctrl+Break to the server's process group.
3. Watch the log for the world-save confirmation.
4. Force-kill (`taskkill /F`) only after a 60 second timeout.

Delivering step 2 from Node is the one genuinely awkward piece of this
project. A detached child does not share our console, so
`GenerateConsoleCtrlEvent` cannot simply be called against it. The
approach is a small helper process that attaches to the server's
console (`AttachConsole(pid)`) and raises `CTRL_BREAK_EVENT` for that
group. `-batchmode -nographics` still allocates a console on Windows,
which is what makes this viable.

**This is the first implementation task, before any other code**, since
it is the one failure that could cost a world, and since a negative
result changes the design rather than just the code. If Ctrl+Break
cannot be delivered, the fallback is to stop detaching — spawn the
server with an inherited console so the panel owns the process group —
and accept that restarting the panel then disconnects players. That is
a worse trade, but a recoverable one, and it is better to discover it
Sunday than Wednesday.

Two independent safety nets exist regardless: the unconditional
pre-stop backup, and Valheim's own autosave every 1800 seconds plus its
built-in rolling backups.

**Restart** is stop followed by start, sharing both code paths.

## Log parsing

All patterns live in `config.json` under `logPatterns`, as named
regexes with capture groups. `parser.js` runs them against incoming
lines and emits events. When 1.0 changes a log line, the fix is a
config edit, not a code change. This is the primary mitigation for the
patch landing two days out.

| Event | Meaning |
|---|---|
| `Got handshake from client <id>` | a client is connecting (Steam backend) |
| `Got connection SteamID <id>` | a client connected (Steam backend) |
| `Closing socket <id>` | a client disconnected |
| `Got character ZDOID from <name> : <id>:<n>` | a character spawned **or died** |
| `World saved ( <n>ms )` | shutdown confirmation and backup timing |
| `Session "<name>" registered with join code <code>` | the crossplay join code |
| `Session "<name>" with join code <code> and IP <ip>:<port> is active with <n> player(s)` | periodic status heartbeat |

Three findings from the research change how this is parsed:

**`ZDOID` is not a join event.** It fires on death as well as spawn —
the trailing `:<n>` component distinguishes the two. Matching the
phrase alone produces a spurious "player joined" every time somebody
dies, which in Valheim is often. Names are taken from this line, but
the join/leave lifecycle is not.

**Player count has an authoritative source.** The periodic session
heartbeat reports `is active with <n> player(s)` directly. That figure
is used for the count, rather than deriving it from socket open/close
bookkeeping that drifts over a long session. Names still come from
`ZDOID`, so the display is an authoritative count plus a best-effort
name list — and when the two disagree, the UI shows the count and marks
unnamed slots rather than silently picking one.

**Both backends must be covered.** With `-crossplay` the server runs on
PlayFab rather than Steam and emits different connection lines. Console
players are identified as `[Platform]_[UserID]` rather than SteamID64,
which also applies to `adminlist.txt` entries.

The join code changes on every restart and is what friends actually ask
for, so it is displayed prominently in the status header.

## API

All routes are local and unauthenticated.

```
GET  /api/status                  state, pid, uptime, players[], joinCode
GET  /api/stream                  SSE: log lines, status ticks, install progress
POST /api/server/start
POST /api/server/stop
POST /api/server/restart
GET  /api/config
PUT  /api/config
GET  /api/backups
POST /api/backups                 backup now
POST /api/backups/:id/restore
GET  /api/backups/:id/download
POST /api/install                 SteamCMD install or update
```

## Backups

**Backups are format-agnostic by design.** The obvious implementation —
copy the world's `.db` and `.fwl` pair — is a trap, because a rewritten
save system on the public test branch replaces that pair with a folder
of smaller pieces, and Iron Gate has not said whether it ships with
1.0. A backup module hardcoded to two file extensions could therefore
start silently backing up nothing on Wednesday, which is the worst
possible failure mode for a backup.

Instead, `backups.js` treats a world as *every filesystem entry in the
save directory whose name matches the world*, whether those are files
or directories, and archives them together into one timestamped zip. On
the current format that captures the `.db`/`.fwl` pair; on the new
format it captures the folder. Restore reverses it symmetrically.

A verification step follows every backup: assert the archive is
non-empty and contains at least one entry. A backup that silently
captured nothing must surface as a loud failure in the UI, not a green
checkmark.

Backups are taken on a timer, before every stop, and on demand, subject
to a retention cap so they do not fill the disk. These are separate
from and additional to Valheim's own `-backups` rolling backups.

Restore refuses to run while the server is up, and snapshots the
current world before overwriting it, so a misclicked restore is itself
recoverable.

## Install and update

`steamcmd.js` downloads and extracts SteamCMD to `tools/steamcmd` on
first run, then runs:

```
steamcmd +force_install_dir <path> +login anonymous +app_update 896660 validate +quit
```

App 896660 is the Valheim dedicated server. Install and update are the
same command, which is why one module covers both. Its stdout streams
to the browser over the existing SSE channel so a large 1.0 download is
visible rather than hidden behind a spinner. The route refuses to run
while the server is up.

**This is the most important feature on Wednesday.** 1.0 enforces a
strict version lock: server and client must run an identical build or
players get "Incompatible Version", and clients auto-update on launch
day. An un-updated server is not degraded, it is unreachable by
everyone. So the panel displays the installed build alongside the
status, and the update flow is: backup, stop, update, start — in that
order, as one button, so the world is protected before anything is
overwritten.

## Interface

One page, without deep nesting: a status header, a row of action
buttons, then Console, Backups, and Settings sections below.

The status header carries the visual weight, because "is it up, what is
the join code, who is on" is nearly the whole reason to open the page.

Stop, restart, restore, and update all confirm before acting.

### Visual design

UI work is done under the Impeccable design system, installed at
`.claude/skills/impeccable/` with its design-detector hook wired into
`.claude/settings.local.json` (PostToolUse on Edit/Write/MultiEdit, and
a deep pass on Stop).

**This is a new visual world, not a styling pass, and it is gated
before UI code.** Impeccable's new-work flow requires, in order:

1. `PRODUCT.md` — product truth — via its `init` flow.
2. A **direction round**: derive seven concrete visual systems from the
   audience's real world, then run
   `concept-seed.mjs --scope direction --mode operate`, which assigns
   the direction and deals challengers. The skill states this step has
   "no substitute and no skip condition"; writing artifact code before
   the roll is a contract violation. The roll exists precisely to stop
   every run converging on the category default.
3. A served decision page for the user to choose from.
4. `DESIGN.md` — the committed world.

Only then does UI code get written, with
`context.mjs --target <file>` run once per session and
`reference/craft-floor.md` read before editing.

**The earlier "dark, high-contrast, cold slate with an ember accent"
direction is explicitly demoted.** It was the category default chosen
by reflex — exactly the rut the roll is designed to avoid. It survives
only as Impeccable's *standing exit*: the convention played straight,
available if the user deliberately chooses it, never recommended.

This dashboard is an **Operate** surface. The governing constraint is
that expression may never obscure task, state, or familiar affordance.
Whatever world is chosen, the status header must remain readable at a
glance, and body text stays above 4.5:1 contrast.

The craft floor bans emoji or unicode standing in for a drawn icon set.
A game-server dashboard falls into that trap easily (⚔ for start, 💾
for backup), so a small drawn SVG icon set of roughly eight glyphs is
budgeted as real work rather than treated as an afterthought.

**Unattended fallback.** If the direction round is served while the
user is away, Impeccable's documented behaviour applies: re-present
once, and with no answer, proceed with the assigned direction and state
the assumptions plainly. The choice remains the user's to override.

## Testing

Test-driven for the pure logic, where mistakes are likely and cheap to
catch:

- **`parser.js`** — real log fixtures in, asserted events out. The
  highest-value suite, because it covers exactly what 1.0 is expected
  to break. Fixtures must include: a Steam-backend join, a
  PlayFab/crossplay join, a session heartbeat with a player count, a
  join-code registration, a world save, and — critically — **a death
  `ZDOID` line asserted *not* to produce a join event**.
- **`settings.js`** — config in, argument array out: quoting of names
  and passwords containing spaces, the 5-character password rule,
  the password-equals-name rejection, and flag omission when unset.
- **`backups.js`** — against a temp directory, with **two fixture
  layouts**: the current `.db`/`.fwl` pair and a folder-style world.
  Both must round-trip through backup and restore. Also covers the
  pre-restore safety snapshot, retention pruning, and the
  empty-archive failure being raised rather than swallowed.
- **`process.js`** — PID liveness and image-name verification, with
  `tasklist` output mocked, including the PID-reuse case where the PID
  is alive but the image name does not match.

Spawning the real server is deliberately not unit-tested. It is
verified by the manual shutdown probe described under Process
lifecycle, which happens first.

Because the design is now built against documented current behaviour
rather than assumption, the Wednesday adjustment should be confined to
`config.json` log patterns and, if the save format changed, confirming
the folder-style backup fixture matches reality.

## Sequence

- **Sunday (today):** install the server via SteamCMD, run the
  **Ctrl+Break shutdown probe** — a negative result changes the design,
  so it blocks everything else — then build `parser.js` and
  `settings.js` with tests.
- **Monday:** `backups.js` (both fixture layouts), `steamcmd.js`, and
  the API. Capture a real log from a running pre-1.0 server for parser
  fixtures. **In parallel, the Impeccable direction round** —
  `PRODUCT.md`, the seven-system derivation, the roll, and the served
  decision page. It runs alongside backend work because it needs the
  user for roughly ten minutes and blocks no backend task.
- **Tuesday:** `DESIGN.md`, the SVG icon set, and the UI built in the
  chosen world.
- **Wednesday:** run the update flow first, since nobody can play until
  the build matches. Then diff a fresh 1.0 log against the fixtures and
  re-point `logPatterns` at whatever changed.

## Sources

- [A Guide to Dedicated Servers — Iron Gate](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/)
  — flag list, Ctrl+C shutdown, save locations, save/backup intervals
- [Valheim 1.0: What Changes for Server Owners](https://www.gameserverkings.com/blog/valheim-1-0-what-changes-for-server-owners/)
  — version lock, save-format rewrite on the test branch, platform user IDs
- [valheim-server-docker discussion #519](https://github.com/community-valheim-tools/valheim-server-docker/discussions/519)
  — handshake / ZDOID / closing-socket parsing in practice
- [Crossplay join code log lines](https://steamcommunity.com/app/892970/discussions/1/3826414367723506713/)
  — session registration and heartbeat formats

## Out of scope

Remote access, authentication, multi-user roles, mod or BepInEx
management, multiple simultaneous server instances, and running as a
Windows service. Any of these can be added later; none are needed for
Wednesday.
