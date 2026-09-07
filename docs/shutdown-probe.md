# Shutdown probe results

Date: 2026-09-07
Server build: pre-1.0 (installed via SteamCMD app 896660 on 2026-09-07)
Platform: Windows 11 Pro 26200, Node v22.11.0

## Question

Can the panel shut the server down cleanly enough that Valheim writes the
world? Iron Gate documents shutdown as "CTRL+C in the Command-window", and the
spec assumed a Ctrl+Break helper would be required.

## Result: graceful `taskkill` is sufficient. No Ctrl+Break helper needed.

Three consecutive trials, all clean:

| Trial | Crossplay | Method | `World saved` | Process exited | World written |
|---|---|---|---|---|---|
| 1 | off | `taskkill /PID` | yes (1) | yes, <12s | `ProbeWorld.db` created, 324 KB |
| 2 | off | `taskkill /PID` | yes (1) | yes, <12s | yes |
| 3 | on | `taskkill /PID` | yes (1) | yes, <12s | yes |

In trial 1 the world had never been saved — only `ProbeWorld.fwl` existed and
`ProbeWorld.db` did not. After graceful `taskkill`, `ProbeWorld.db` appeared at
324 KB. That is direct evidence the save was triggered by the shutdown, not a
pre-existing autosave.

`taskkill /F` was never needed and must remain the timeout-only path.

## The Ctrl+Break approach failed, and why

`scripts/send-ctrl-break.ps1` returned exit 2:

```
AttachConsole failed for PID 67668 (win32 error 6)
```

Win32 error 6 is `ERROR_INVALID_HANDLE` — the target has no console to attach
to. The cause is the spawn method, not the script: Node's `detached: true` on
Windows makes libuv pass `DETACHED_PROCESS`, which explicitly denies the child
a console and prevents one being assigned later.

So detaching and console-signalling are mutually exclusive under this spawn
method. Since graceful `taskkill` works, the conflict is moot and the simpler
mechanism wins. `send-ctrl-break.ps1` was deleted rather than kept as dead
code; this document is the record of why it is not there.

Had `taskkill` failed, the fallback would have been to spawn via
`Start-Process -PassThru` (which gives a console app its own console while
still surviving panel restart) and attach to that.

## Confirmed log formats

Captured verbatim from the probe logs. Fixtures in `test/fixtures/` are built
from these, not from memory.

```
09/07/2026 13:39:44: World saved ( 14.5236ms )
09/07/2026 13:40:25: Session "ProbeTest" registered with join code 167812
09/07/2026 13:40:24: New session server "ProbeTest" that has join code , now 0 player(s)
09/07/2026 13:40:27: Session "ProbeTest" with join code 167812 and IP 203.0.113.10:2456 is active with 0 player(s)
09/07/2026 13:35:53: Game server connected
```

Validated against `config.example.json`: the `worldSaved` and `joinCode`
patterns match real output exactly.

## Correction to the spec: the heartbeat is not periodic

The spec claimed `is active with N player(s)` is a periodic heartbeat and is
therefore an authoritative player count that beats socket bookkeeping. **That
is not supported by the probe.** Over a ~3 minute crossplay run the line
appeared exactly once, 3 seconds after session registration. It fires on
session state change, not on a timer.

Two count-bearing shapes exist, and both must be parsed:

- `... is active with <n> player(s)` — on session activation
- `New session server "<name>" that has join code <code>, now <n> player(s)` — on session creation

Whether either re-fires on player join/leave could not be verified without a
second machine to connect from. Therefore the parser maintains **both** a
heartbeat count and connection-derived bookkeeping, preferring whichever was
updated most recently, rather than trusting the heartbeat alone.

The connection patterns (`handshake`, `connected`, `disconnected`, `character`)
produced no hits, because no player joined. They remain unverified against a
real client and are the most likely thing to need adjustment on Wednesday.

## Correction to the plan: world file naming

Valheim writes sibling files the plan's matching rule would have missed:

```
ProbeWorld.db
ProbeWorld.fwl
ProbeWorld.fwl.old
ProbeWorld_backup_auto-20260907133550.fwl
```

`ProbeWorld_backup_auto-*` uses an **underscore**, so a rule matching only
`world` or `world.` skips Valheim's own rolling backups. The rule is widened to
also accept `<world>_backup_`, which still excludes a different world whose name
merely starts with the same string (world `Probe` does not match
`ProbeWorld.db`).

## Confirmed environment facts

- Save directory: `C:/Users/player/AppData/LocalLow/IronGate/Valheim/worlds_local`
- World generation on first boot took **65 seconds**; the panel must not treat a
  slow first start as a failure.
- `tasklist /FI "PID eq N" /FO CSV /NH` returns
  `"valheim_server.exe","67668","Console","1","1,096,096 K"`, matching the
  format `process.js` parses.
- SteamCMD exits after self-updating on first run and must be invoked a second
  time to install the app.
