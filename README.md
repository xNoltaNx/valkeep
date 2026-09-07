# Valheim Server Board

A LAN-only control panel for a Valheim dedicated server running on a home
Windows PC. Start, stop, monitor, back up, and update the server from a browser.

![The board](docs/live-desktop.png)

## Running it

Double-click **`start.bat`**. It installs dependencies on first run, starts the
panel, and opens <http://localhost:8080>.

From another device on the same network, use this PC's LAN address, for example
`http://192.168.1.20:8080`.

## First-time setup

1. Start the panel.
2. Open **Settings**, set the server name, world, and a password (at least 5
   characters, and not the same as the server name), then save.
3. Press **Update server**. This downloads SteamCMD and installs the dedicated
   server — several minutes and a few GB.
4. Press **Start**. First boot on a brand-new world takes about a minute while
   the world generates. That is normal.
5. The **join code** appears in the header once the crossplay session registers.
   Send it to your friends. It changes every restart.

## Security

**This panel has no authentication and is meant for your LAN only.** Anyone who
can reach port 8080 can stop your server and overwrite your world. Do not
forward this port, and do not run it on a public network. Your server password
is stored in plain text in `config.json` for the same reason.

`npm audit` reports moderate advisories in `qs`, reachable transitively through
Express 4. Both are request-parsing denial-of-service issues, exploitable only
by someone who can already send HTTP to the panel — which, under the LAN-only
threat model above, is someone already inside your network. Fixing them requires
migrating to Express 5. Worth doing eventually; not worth doing the week of a
launch.

## Backups

Backups live in `data/backups/`, each a timestamped folder holding a complete
copy of the world's files plus a `backup.json` describing it.

They are taken automatically every 30 minutes while the server runs, before
every stop and restart, and whenever you press **Back up now**. The oldest are
pruned past `backupRetention` in `config.json`.

Backups are **format-agnostic on purpose.** Rather than copying `.db` and `.fwl`
by name, the panel copies every entry matching the world name, file or folder.
Valheim 1.0 may replace the file pair with a folder of pieces; a backup module
hardcoded to two extensions would have quietly started saving nothing on patch
day. Every backup is verified non-empty and fails loudly if it captured nothing.

**Restore** requires the server to be stopped, and snapshots the current world
before overwriting it — so a misclicked restore is itself recoverable.

## Update day (Valheim 1.0, 9 September 2026)

Valheim enforces a strict version lock: the server and every player must run the
identical build. Clients auto-update on launch day, so an un-updated server is
not slow — it is unreachable by everyone.

**Update first, before anything else.** Press **Update server** while the server
is stopped. The panel backs up, updates, and you start it again. The installed
build id is shown in the header next to the world name.

### If the log stops making sense after the patch

Player names or the join code disappearing from the header means Iron Gate
changed a log line. This does not require a code change:

1. Open `config.json` and find `logPatterns`.
2. Open `data/logs/server.log` and find the line that changed.
3. Edit the regex to match. Named capture groups carry the values —
   `(?<name>…)`, `(?<code>…)`, `(?<players>…)`.
4. Restart the panel.

The patterns for world saves and the join code are verified against a real
server. The connection and player-name patterns are **not** — no second machine
has ever joined this server — so they are the most likely to need adjusting.

## Configuration

`config.json` is created from `config.example.json` on first run.

| Key | Meaning |
|---|---|
| `panelPort` | Port the panel listens on (default 8080) |
| `serverExe` | Full path to `valheim_server.exe` |
| `installDir` | Where SteamCMD installs the server |
| `saveDir` | Valheim's **base** save directory; worlds live in `worlds_local` inside it |
| `server.*` | Launch settings — name, world, password, port, public, crossplay, save interval, backup cadence, preset, modifiers |
| `backupIntervalMinutes` | How often to snapshot while running |
| `backupRetention` | How many backups to keep |
| `logPatterns` | Regexes mapping log lines to events |

## How it works

The panel spawns `valheim_server.exe` **detached**, with `-logFile`, and records
the PID. Detached means the game server survives a panel restart — you can
restart or crash the panel without disconnecting anyone. The trade-off is that
the panel cannot read the server's stdout directly, so it tails the log file
instead.

Shutdown uses a graceful `taskkill`, which was verified against a real server to
reliably trigger a world save. `taskkill /F` is used only after a 60-second
timeout, and loses unsaved progress. See `docs/shutdown-probe.md` for the
measurements.

Status checks verify both that the recorded PID is alive **and** that it is
actually `valheim_server.exe`, because Windows recycles PIDs.

## Development

```bash
npm install
npm test        # 94 tests, node:test
npm start
```

| Module | Responsibility |
|---|---|
| `src/server.js` | Express app, REST routes, SSE |
| `src/process.js` | Spawn, stop, status, re-attach |
| `src/parser.js` | Log lines to events |
| `src/logtail.js` | Follows the log file |
| `src/backups.js` | Snapshot, restore, prune |
| `src/steamcmd.js` | Install and update |
| `src/settings.js` | Config validation, launch arguments |
| `src/hub.js` | SSE fan-out |

Design documents: `PRODUCT.md` (product truth), `DESIGN.md` (the visual world),
`docs/superpowers/specs/` (the design spec), `docs/superpowers/plans/` (the
implementation plan).
