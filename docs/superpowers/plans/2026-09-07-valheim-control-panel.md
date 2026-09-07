# Valheim Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A LAN-only web dashboard that installs, runs, monitors, backs up, and updates a Valheim dedicated server on a home Windows PC, ready for the 1.0 release on 2026-09-09.

**Architecture:** Node + Express backend serving a plain HTML/CSS/JS frontend with no build step. The backend spawns `valheim_server.exe` detached with `-logFile`, tails that log, and parses it for player and status events. Server-Sent Events push log lines, status, and install progress to the browser. All log patterns live in `config.json` so a 1.0 format change is a config edit.

**Tech Stack:** Node v22.11.0 (ESM), Express, the built-in `node:test` runner, and PowerShell for two Windows-specific jobs (zip extraction and delivering Ctrl+Break). Deliberately one runtime dependency: `express`.

**Spec:** `docs/superpowers/specs/2026-09-07-valheim-control-panel-design.md`

## Global Constraints

- Node ESM throughout (`"type": "module"` in `package.json`). Node v22.11.0.
- Exactly one runtime dependency: `express`. No test framework — use `node:test` and `node:assert/strict`.
- No frontend framework, no build step, no bundler.
- Panel listens on `0.0.0.0:8080`. LAN-only. No authentication. Never expose to the internet.
- Valheim dedicated server Steam app ID: **896660**.
- Default save dir: `%USERPROFILE%/AppData/LocalLow/IronGate/Valheim`, worlds under `worlds_local`.
- Log flag is `-logFile` — capital F.
- Password rule: 5+ characters, and must not equal the server name.
- Autosave default: 1800 seconds.
- Backups must be **format-agnostic** — never hardcode `.db`/`.fwl`.
- `ZDOID` log lines fire on death as well as spawn; they are a name source, never a join event.
- UI work is gated behind the Impeccable direction round (Task 9). Do not write CSS or markup before Task 9 completes.
- Commit after every task.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `config.example.json`, `src/paths.js`
- Test: `test/paths.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `paths.js` exporting `ROOT` (string), `dataDir()`, `backupsDir()`, `logsDir()`, `stateFile()`, `configFile()`, `toolsDir()` — all zero-argument functions returning absolute path strings.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "valheim-control-panel",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
data/
tools/
config.json
.impeccable/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `express` installed, `package-lock.json` created.

- [ ] **Step 4: Write the failing test**

Create `test/paths.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, basename } from 'node:path';
import { ROOT, dataDir, backupsDir, logsDir, stateFile, configFile, toolsDir } from '../src/paths.js';

test('every path is absolute', () => {
  for (const p of [ROOT, dataDir(), backupsDir(), logsDir(), stateFile(), configFile(), toolsDir()]) {
    assert.ok(isAbsolute(p), `${p} should be absolute`);
  }
});

test('paths have the expected names', () => {
  assert.equal(basename(dataDir()), 'data');
  assert.equal(basename(backupsDir()), 'backups');
  assert.equal(basename(logsDir()), 'logs');
  assert.equal(basename(stateFile()), 'state.json');
  assert.equal(basename(configFile()), 'config.json');
  assert.equal(basename(toolsDir()), 'tools');
});

test('data-relative paths live under the data dir', () => {
  for (const p of [backupsDir(), logsDir(), stateFile()]) {
    assert.ok(p.startsWith(dataDir()), `${p} should be under ${dataDir()}`);
  }
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/paths.js`.

- [ ] **Step 6: Write minimal implementation**

Create `src/paths.js`:

```js
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const dataDir = () => join(ROOT, 'data');
export const backupsDir = () => join(dataDir(), 'backups');
export const logsDir = () => join(dataDir(), 'logs');
export const stateFile = () => join(dataDir(), 'state.json');
export const configFile = () => join(ROOT, 'config.json');
export const toolsDir = () => join(ROOT, 'tools');
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 8: Create `config.example.json`**

```json
{
  "panelPort": 8080,
  "serverExe": "",
  "installDir": "",
  "saveDir": "",
  "server": {
    "name": "My Valheim Server",
    "world": "Dedicated",
    "password": "",
    "port": 2456,
    "public": false,
    "crossplay": true,
    "saveinterval": 1800,
    "backups": 4,
    "backupshort": 7200,
    "backuplong": 43200,
    "preset": "",
    "modifiers": {},
    "setkeys": []
  },
  "backupIntervalMinutes": 30,
  "backupRetention": 24,
  "logPatterns": {
    "handshake": "Got handshake from client (?<id>\\\\d+)",
    "connected": "Got connection SteamID (?<id>\\\\d+)",
    "disconnected": "Closing socket (?<id>\\\\d+)",
    "character": "Got character ZDOID from (?<name>.+?) : (?<zdo>-?\\\\d+):(?<rev>\\\\d+)",
    "worldSaved": "World saved *\\\\( *(?<ms>[\\\\d.]+)ms *\\\\)",
    "joinCode": "Session \\"(?<session>.*?)\\" registered with join code (?<code>\\\\d+)",
    "heartbeat": "is active with (?<players>\\\\d+) player"
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore config.example.json src/paths.js test/paths.test.js
git commit -m "feat: project scaffolding, path helpers, example config"
```

---

### Task 2: Ctrl+Break helper and the shutdown probe

**This task is first for a reason.** A negative result changes the architecture, not just the code. Do not proceed to Task 4 until the probe has produced an answer.

**Files:**
- Create: `scripts/send-ctrl-break.ps1`, `docs/shutdown-probe.md`
- Requires: a real Valheim dedicated server install (performed manually in this task).

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/send-ctrl-break.ps1`, invoked as
  `powershell -ExecutionPolicy Bypass -File scripts/send-ctrl-break.ps1 -TargetPid <pid>`,
  exiting 0 on delivered, non-zero on failure.

- [ ] **Step 1: Install SteamCMD manually**

```bash
mkdir -p tools/steamcmd
curl -L -o tools/steamcmd.zip https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip
powershell -Command "Expand-Archive -Path tools/steamcmd.zip -DestinationPath tools/steamcmd -Force"
```

Expected: `tools/steamcmd/steamcmd.exe` exists.

- [ ] **Step 2: Install the Valheim dedicated server**

```bash
./tools/steamcmd/steamcmd.exe +force_install_dir "E:\ai-projects\valheim-server\server" +login anonymous +app_update 896660 validate +quit
```

Expected: `server/valheim_server.exe` exists. First run of steamcmd self-updates; this takes several minutes.

- [ ] **Step 3: Write the Ctrl+Break helper**

Create `scripts/send-ctrl-break.ps1`. It detaches from the current console, attaches to the target process's console, disables its own Ctrl handler so it does not kill itself, and raises `CTRL_BREAK_EVENT` for the group.

```powershell
param([Parameter(Mandatory=$true)][int]$TargetPid)

Add-Type -Name ConsoleCtrl -Namespace Win32 -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
'@

$CTRL_BREAK_EVENT = 1

[void][Win32.ConsoleCtrl]::FreeConsole()

if (-not [Win32.ConsoleCtrl]::AttachConsole([uint32]$TargetPid)) {
  Write-Error "AttachConsole failed for PID $TargetPid (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  exit 2
}

[void][Win32.ConsoleCtrl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

if (-not [Win32.ConsoleCtrl]::GenerateConsoleCtrlEvent($CTRL_BREAK_EVENT, 0)) {
  Write-Error "GenerateConsoleCtrlEvent failed (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  exit 3
}

exit 0
```

- [ ] **Step 4: Start a real server for the probe**

```bash
mkdir -p data/logs
./server/valheim_server.exe -nographics -batchmode -name "ProbeTest" -port 2456 -world "ProbeWorld" -password "probe12345" -public 0 -logFile "E:\ai-projects\valheim-server\data\logs\probe.log" &
```

Wait until `data/logs/probe.log` contains a world-load line and the server has been up at least 60 seconds so a world exists on disk.

- [ ] **Step 5: Record the world file state before shutdown**

```bash
ls -la "$USERPROFILE/AppData/LocalLow/IronGate/Valheim/worlds_local/" | tee /tmp/before.txt
```

Note the modification time of the `ProbeWorld` artifacts.

- [ ] **Step 6: Send Ctrl+Break and observe**

```bash
powershell -ExecutionPolicy Bypass -File scripts/send-ctrl-break.ps1 -TargetPid <pid>
```

Then watch the log:

```bash
tail -20 data/logs/probe.log
```

Expected on success: a `World saved` line appears, and the process exits within a few seconds.

- [ ] **Step 7: Record the result**

Create `docs/shutdown-probe.md` documenting: the exact command used, whether `AttachConsole` succeeded, whether `World saved` appeared, how long shutdown took, and whether the world file mtime advanced.

**If the probe succeeded:** the design stands. Task 4 uses this helper.

**If the probe failed:** record which step failed, then apply the spec's documented fallback — spawn the server with an inherited console (`detached: false`, panel owns the process group) and use `process.kill(pid, 'SIGINT')`. Update the spec's Process lifecycle section to match, and note that restarting the panel now disconnects players.

- [ ] **Step 8: Commit**

```bash
git add scripts/send-ctrl-break.ps1 docs/shutdown-probe.md
git commit -m "feat: Ctrl+Break shutdown helper, with probe results against a real server"
```

---

### Task 3: `settings.js` — config to launch arguments

**Files:**
- Create: `src/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: `src/paths.js`.
- Produces:
  - `validate(cfg)` → array of error strings; empty array means valid.
  - `buildArgs(cfg)` → array of strings, the argv for `valheim_server.exe`.
  - `loadConfig()` → parsed `config.json` object; throws if missing.
  - `saveConfig(cfg)` → writes `config.json`, returns nothing.

- [ ] **Step 1: Write the failing test**

Create `test/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, validate } from '../src/settings.js';

const base = () => ({
  serverExe: 'C:\\vh\\valheim_server.exe',
  saveDir: 'C:\\saves',
  server: {
    name: 'My Server', world: 'Dedicated', password: 'hunter22',
    port: 2456, public: false, crossplay: true,
    saveinterval: 1800, backups: 4, backupshort: 7200, backuplong: 43200,
    preset: '', modifiers: {}, setkeys: []
  }
});

test('builds the core arguments', () => {
  const args = buildArgs(base());
  assert.ok(args.includes('-nographics'));
  assert.ok(args.includes('-batchmode'));
  assert.equal(args[args.indexOf('-name') + 1], 'My Server');
  assert.equal(args[args.indexOf('-world') + 1], 'Dedicated');
  assert.equal(args[args.indexOf('-port') + 1], '2456');
  assert.equal(args[args.indexOf('-public') + 1], '0');
});

test('uses capital-F logFile', () => {
  const args = buildArgs(base());
  assert.ok(args.includes('-logFile'));
  assert.ok(!args.includes('-logfile'));
});

test('crossplay is a bare flag, present only when enabled', () => {
  assert.ok(buildArgs(base()).includes('-crossplay'));
  const off = base();
  off.server.crossplay = false;
  assert.ok(!buildArgs(off).includes('-crossplay'));
});

test('omits optional flags when unset', () => {
  const cfg = base();
  cfg.server.preset = '';
  const args = buildArgs(cfg);
  assert.ok(!args.includes('-preset'));
});

test('includes preset when set', () => {
  const cfg = base();
  cfg.server.preset = 'hard';
  const args = buildArgs(cfg);
  assert.equal(args[args.indexOf('-preset') + 1], 'hard');
});

test('emits one -modifier pair per modifier', () => {
  const cfg = base();
  cfg.server.modifiers = { raids: 'none', portals: 'casual' };
  const args = buildArgs(cfg);
  const joined = args.join(' ');
  assert.ok(joined.includes('-modifier raids none'));
  assert.ok(joined.includes('-modifier portals casual'));
});

test('emits one -setkey per key', () => {
  const cfg = base();
  cfg.server.setkeys = ['nomap', 'nobuildcost'];
  const args = buildArgs(cfg);
  const joined = args.join(' ');
  assert.ok(joined.includes('-setkey nomap'));
  assert.ok(joined.includes('-setkey nobuildcost'));
});

test('arguments are separate array entries, never pre-quoted', () => {
  const args = buildArgs(base());
  const name = args[args.indexOf('-name') + 1];
  assert.equal(name, 'My Server');
  assert.ok(!name.startsWith('"'), 'spawn handles quoting; do not add quotes');
});

test('rejects a password shorter than 5 characters', () => {
  const cfg = base();
  cfg.server.password = 'abc';
  assert.ok(validate(cfg).some(e => /5/.test(e)));
});

test('rejects a password equal to the server name', () => {
  const cfg = base();
  cfg.server.name = 'samevalue';
  cfg.server.password = 'samevalue';
  assert.ok(validate(cfg).some(e => /name/i.test(e)));
});

test('rejects a missing server executable path', () => {
  const cfg = base();
  cfg.serverExe = '';
  assert.ok(validate(cfg).some(e => /executable/i.test(e)));
});

test('accepts a valid config', () => {
  assert.deepEqual(validate(base()), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/settings.test.js`
Expected: FAIL — cannot find module `../src/settings.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings.js`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFile, logsDir } from './paths.js';

export function loadConfig() {
  return JSON.parse(readFileSync(configFile(), 'utf8'));
}

export function saveConfig(cfg) {
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
}

export function validate(cfg) {
  const errors = [];
  const s = cfg.server ?? {};
  if (!cfg.serverExe) errors.push('Server executable path is not set.');
  if (!s.name) errors.push('Server name is required.');
  if (!s.world) errors.push('World name is required.');
  if (!s.password || s.password.length < 5) {
    errors.push('Password must be at least 5 characters.');
  }
  if (s.password && s.name && s.password === s.name) {
    errors.push('Password must not be the same as the server name.');
  }
  return errors;
}

export function buildArgs(cfg) {
  const s = cfg.server;
  const args = ['-nographics', '-batchmode'];

  args.push('-name', String(s.name));
  args.push('-port', String(s.port));
  args.push('-world', String(s.world));
  args.push('-password', String(s.password));
  args.push('-public', s.public ? '1' : '0');

  if (cfg.saveDir) args.push('-savedir', cfg.saveDir);
  args.push('-logFile', join(logsDir(), 'server.log'));

  if (s.crossplay) args.push('-crossplay');
  if (s.saveinterval) args.push('-saveinterval', String(s.saveinterval));
  if (s.backups) args.push('-backups', String(s.backups));
  if (s.backupshort) args.push('-backupshort', String(s.backupshort));
  if (s.backuplong) args.push('-backuplong', String(s.backuplong));
  if (s.instanceid) args.push('-instanceid', String(s.instanceid));
  if (s.preset) args.push('-preset', String(s.preset));

  for (const [key, value] of Object.entries(s.modifiers ?? {})) {
    args.push('-modifier', key, String(value));
  }
  for (const key of s.setkeys ?? []) {
    args.push('-setkey', String(key));
  }

  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/settings.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/settings.js test/settings.test.js
git commit -m "feat: config validation and launch argument construction"
```

---

### Task 4: `parser.js` — log lines to events

The highest-value suite in the project. This is what 1.0 is most likely to break.

**Files:**
- Create: `src/parser.js`
- Test: `test/parser.test.js`, `test/fixtures/sample.log`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `createParser(logPatterns)` → object with `feed(line)` → array of event objects, and `snapshot()` → `{ players: string[], playerCount: number|null, joinCode: string|null, lastSaveAt: number|null }`.
  - Event objects: `{ type: 'connected'|'disconnected'|'character'|'worldSaved'|'joinCode'|'heartbeat', ...fields }`.
  - `type: 'character'` carries `{ name, zdo, rev }` and is **never** emitted as a join.

- [ ] **Step 1: Write the fixture**

Create `test/fixtures/sample.log`:

```
09/07/2026 10:00:01: Zonesystem Start 1
09/07/2026 10:00:05: Session "TestServer" registered with join code 860226
09/07/2026 10:00:30: Got handshake from client 76561198012345678
09/07/2026 10:00:31: Got connection SteamID 76561198012345678
09/07/2026 10:00:45: Got character ZDOID from Sigrun : 12345:1
09/07/2026 10:01:00: Session "TestServer" with join code 860226 and IP 10.0.0.5:2456 is active with 1 player(s)
09/07/2026 10:05:00: Got character ZDOID from Sigrun : 0:0
09/07/2026 10:10:00: World saved ( 142.5ms )
09/07/2026 10:15:00: Closing socket 76561198012345678
09/07/2026 10:15:01: Session "TestServer" with join code 860226 and IP 10.0.0.5:2456 is active with 0 player(s)
```

- [ ] **Step 2: Write the failing test**

Create `test/parser.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createParser } from '../src/parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const patterns = JSON.parse(readFileSync(join(here, '..', 'config.example.json'), 'utf8')).logPatterns;
const fixture = () => readFileSync(join(here, 'fixtures', 'sample.log'), 'utf8').split(/\r?\n/).filter(Boolean);

const feedAll = () => {
  const p = createParser(patterns);
  const events = [];
  for (const line of fixture()) events.push(...p.feed(line));
  return { parser: p, events };
};

test('extracts the join code', () => {
  const { events } = feedAll();
  const jc = events.find(e => e.type === 'joinCode');
  assert.equal(jc.code, '860226');
});

test('extracts a player name from a character line', () => {
  const { events } = feedAll();
  const ch = events.find(e => e.type === 'character');
  assert.equal(ch.name, 'Sigrun');
});

test('a death ZDOID line does not produce a join event', () => {
  const p = createParser(patterns);
  const events = p.feed('09/07/2026 10:05:00: Got character ZDOID from Sigrun : 0:0');
  assert.ok(!events.some(e => e.type === 'connected'),
    'a character line must never be reported as a connection');
  assert.equal(events[0].type, 'character');
  assert.equal(events[0].zdo, '0');
});

test('distinguishes spawn from death by the zdo field', () => {
  const p = createParser(patterns);
  const spawn = p.feed('Got character ZDOID from Sigrun : 12345:1')[0];
  const death = p.feed('Got character ZDOID from Sigrun : 0:0')[0];
  assert.equal(spawn.isDeath, false);
  assert.equal(death.isDeath, true);
});

test('takes the player count from the heartbeat, not socket bookkeeping', () => {
  const { parser } = feedAll();
  assert.equal(parser.snapshot().playerCount, 0);
});

test('reports connect and disconnect events', () => {
  const { events } = feedAll();
  assert.ok(events.some(e => e.type === 'connected' && e.id === '76561198012345678'));
  assert.ok(events.some(e => e.type === 'disconnected' && e.id === '76561198012345678'));
});

test('records the last world save', () => {
  const { parser } = feedAll();
  assert.ok(parser.snapshot().lastSaveAt !== null);
});

test('unmatched lines produce no events', () => {
  const p = createParser(patterns);
  assert.deepEqual(p.feed('09/07/2026 10:00:01: Zonesystem Start 1'), []);
});

test('a malformed pattern set does not throw on feed', () => {
  const p = createParser({ broken: '([unclosed' });
  assert.doesNotThrow(() => p.feed('anything at all'));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/parser.test.js`
Expected: FAIL — cannot find module `../src/parser.js`.

- [ ] **Step 4: Write minimal implementation**

Create `src/parser.js`:

```js
function compile(patterns) {
  const compiled = [];
  for (const [type, source] of Object.entries(patterns ?? {})) {
    try {
      compiled.push({ type, re: new RegExp(source) });
    } catch {
      // A bad pattern must never take the parser down. 1.0 edits land here.
    }
  }
  return compiled;
}

export function createParser(patterns) {
  const compiled = compile(patterns);
  const state = {
    players: new Map(),
    playerCount: null,
    joinCode: null,
    lastSaveAt: null
  };

  function feed(line) {
    const events = [];
    for (const { type, re } of compiled) {
      const m = re.exec(line);
      if (!m) continue;
      const g = m.groups ?? {};
      const event = { type, raw: line, ...g };

      if (type === 'character') {
        // ZDOID fires on death as well as spawn. A zdo of 0 is a death.
        event.isDeath = g.zdo === '0';
        if (!event.isDeath && g.name) state.players.set(g.name, Date.now());
      } else if (type === 'joinCode') {
        state.joinCode = g.code ?? null;
      } else if (type === 'heartbeat') {
        state.playerCount = Number(g.players);
        if (state.playerCount === 0) state.players.clear();
      } else if (type === 'worldSaved') {
        state.lastSaveAt = Date.now();
      }

      events.push(event);
    }
    return events;
  }

  function snapshot() {
    return {
      players: [...state.players.keys()],
      playerCount: state.playerCount,
      joinCode: state.joinCode,
      lastSaveAt: state.lastSaveAt
    };
  }

  return { feed, snapshot };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/parser.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/parser.js test/parser.test.js test/fixtures/sample.log
git commit -m "feat: log parser with death-vs-spawn discrimination and heartbeat player count"
```

---

### Task 5: `process.js` — spawn, status, stop, re-attach

**Files:**
- Create: `src/process.js`
- Test: `test/process.test.js`

**Interfaces:**
- Consumes: `src/paths.js`, `src/settings.js` (`buildArgs`), `scripts/send-ctrl-break.ps1`.
- Produces:
  - `isValheimPid(pid, runTasklist)` → `Promise<boolean>`. `runTasklist` is an injected function returning the raw `tasklist` stdout, defaulting to the real call.
  - `readState()` / `writeState(obj)` / `clearState()`.
  - `status({ runTasklist })` → `Promise<{ running, pid, startedAt, uptimeSeconds }>`.
  - `start(cfg)` → `Promise<{ pid }>`.
  - `stop({ onProgress })` → `Promise<{ graceful: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `test/process.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValheimPid } from '../src/process.js';

const csvFor = (image, pid) =>
  `"${image}","${pid}","Console","1","1,234 K"\r\n`;

test('accepts a live pid whose image is valheim_server.exe', async () => {
  const run = async () => csvFor('valheim_server.exe', 4242);
  assert.equal(await isValheimPid(4242, run), true);
});

test('rejects a live pid running a different image (PID reuse)', async () => {
  const run = async () => csvFor('chrome.exe', 4242);
  assert.equal(await isValheimPid(4242, run), false);
});

test('rejects when tasklist reports no match', async () => {
  const run = async () => 'INFO: No tasks are running which match the specified criteria.';
  assert.equal(await isValheimPid(4242, run), false);
});

test('rejects when tasklist throws', async () => {
  const run = async () => { throw new Error('tasklist unavailable'); };
  assert.equal(await isValheimPid(4242, run), false);
});

test('rejects a null or zero pid without calling tasklist', async () => {
  let called = false;
  const run = async () => { called = true; return ''; };
  assert.equal(await isValheimPid(null, run), false);
  assert.equal(await isValheimPid(0, run), false);
  assert.equal(called, false);
});

test('matches the image name case-insensitively', async () => {
  const run = async () => csvFor('Valheim_Server.EXE', 7);
  assert.equal(await isValheimPid(7, run), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/process.test.js`
Expected: FAIL — cannot find module `../src/process.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/process.js`:

```js
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROOT, dataDir, logsDir, stateFile } from './paths.js';
import { buildArgs } from './settings.js';

const execFileAsync = promisify(execFile);
const IMAGE = 'valheim_server.exe';

async function defaultTasklist(pid) {
  const { stdout } = await execFileAsync(
    'tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']
  );
  return stdout;
}

export async function isValheimPid(pid, runTasklist = defaultTasklist) {
  if (!pid || pid <= 0) return false;
  try {
    const out = await runTasklist(pid);
    const first = out.split(/\r?\n/).find(l => l.trim().startsWith('"'));
    if (!first) return false;
    const image = first.split('","')[0].replace(/^"/, '');
    return image.toLowerCase() === IMAGE;
  } catch {
    return false;
  }
}

export function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(obj) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(obj, null, 2), 'utf8');
}

export function clearState() {
  try { rmSync(stateFile()); } catch { /* already gone */ }
}

export async function status({ runTasklist } = {}) {
  const state = readState();
  if (!state?.pid) return { running: false, pid: null, startedAt: null, uptimeSeconds: 0 };
  const running = await isValheimPid(state.pid, runTasklist ?? defaultTasklist);
  if (!running) {
    clearState();
    return { running: false, pid: null, startedAt: null, uptimeSeconds: 0 };
  }
  return {
    running: true,
    pid: state.pid,
    startedAt: state.startedAt,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000)
  };
}

export async function start(cfg) {
  mkdirSync(logsDir(), { recursive: true });
  const args = buildArgs(cfg);
  const child = spawn(cfg.serverExe, args, {
    detached: true,
    stdio: 'ignore',
    cwd: cfg.installDir || undefined
  });
  child.unref();
  writeState({ pid: child.pid, startedAt: Date.now(), world: cfg.server.world });
  return { pid: child.pid };
}

export async function stop({ onProgress = () => {} } = {}) {
  const state = readState();
  if (!state?.pid) return { graceful: true };
  const pid = state.pid;

  onProgress('Sending Ctrl+Break...');
  try {
    await execFileAsync('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', join(ROOT, 'scripts', 'send-ctrl-break.ps1'),
      '-TargetPid', String(pid)
    ]);
  } catch (err) {
    onProgress(`Ctrl+Break failed: ${err.message}`);
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!(await isValheimPid(pid))) {
      clearState();
      onProgress('Server stopped cleanly.');
      return { graceful: true };
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  onProgress('Timed out after 60s — force killing.');
  try { await execFileAsync('taskkill', ['/PID', String(pid), '/F']); } catch { /* gone */ }
  clearState();
  return { graceful: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/process.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/process.js test/process.test.js
git commit -m "feat: process lifecycle with PID-reuse-safe status and graceful stop"
```

---

### Task 6: `backups.js` — format-agnostic snapshot and restore

**Files:**
- Create: `src/backups.js`
- Test: `test/backups.test.js`

**Interfaces:**
- Consumes: `src/paths.js`.
- Produces:
  - `findWorldEntries(saveDir, worldName)` → array of absolute paths; matches files *and* directories.
  - `createBackup({ saveDir, worldName, label })` → `Promise<{ id, createdAt, entryCount, path }>`; throws if nothing was captured.
  - `listBackups()` → array of `{ id, createdAt, worldName, entryCount, sizeBytes }`, newest first.
  - `restoreBackup(id, { saveDir, worldName })` → `Promise<{ safetyBackupId }>`.
  - `pruneBackups(retention)` → array of removed ids.

- [ ] **Step 1: Write the failing test**

Create `test/backups.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorldEntries } from '../src/backups.js';

// Layout A: the current format — a .db / .fwl file pair.
function pairLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'vh-pair-'));
  writeFileSync(join(dir, 'Dedicated.db'), 'dbdata');
  writeFileSync(join(dir, 'Dedicated.fwl'), 'fwldata');
  writeFileSync(join(dir, 'Dedicated.db.old'), 'olddata');
  writeFileSync(join(dir, 'OtherWorld.db'), 'nope');
  return dir;
}

// Layout B: the rewritten format — a directory of pieces.
function folderLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'vh-folder-'));
  mkdirSync(join(dir, 'Dedicated'));
  writeFileSync(join(dir, 'Dedicated', 'meta.json'), '{}');
  writeFileSync(join(dir, 'Dedicated', 'chunk0.bin'), 'x');
  mkdirSync(join(dir, 'OtherWorld'));
  return dir;
}

test('finds the .db/.fwl pair in the current format', () => {
  const found = findWorldEntries(pairLayout(), 'Dedicated').map(p => p.split(/[\\/]/).pop());
  assert.ok(found.includes('Dedicated.db'));
  assert.ok(found.includes('Dedicated.fwl'));
});

test('finds the world directory in the rewritten format', () => {
  const found = findWorldEntries(folderLayout(), 'Dedicated').map(p => p.split(/[\\/]/).pop());
  assert.deepEqual(found, ['Dedicated']);
});

test('does not capture a different world with a similar name', () => {
  const found = findWorldEntries(pairLayout(), 'Dedicated').map(p => p.split(/[\\/]/).pop());
  assert.ok(!found.some(n => n.startsWith('OtherWorld')));
});

test('includes Valheim own .old rolling files for the world', () => {
  const found = findWorldEntries(pairLayout(), 'Dedicated').map(p => p.split(/[\\/]/).pop());
  assert.ok(found.includes('Dedicated.db.old'));
});

test('returns empty for an unknown world rather than throwing', () => {
  assert.deepEqual(findWorldEntries(pairLayout(), 'NoSuchWorld'), []);
});

test('returns empty for a missing save directory rather than throwing', () => {
  assert.deepEqual(findWorldEntries(join(tmpdir(), 'definitely-not-here-9f2'), 'Dedicated'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/backups.test.js`
Expected: FAIL — cannot find module `../src/backups.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backups.js`:

```js
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupsDir } from './paths.js';

/**
 * A world is every entry in the save dir whose name is the world name or
 * begins with the world name followed by a dot. Files and directories both
 * qualify, so this survives the 1.0 save-format rewrite.
 */
export function findWorldEntries(saveDir, worldName) {
  if (!saveDir || !existsSync(saveDir)) return [];
  let names;
  try {
    names = readdirSync(saveDir);
  } catch {
    return [];
  }
  return names
    .filter(n => n === worldName || n.startsWith(`${worldName}.`))
    .map(n => join(saveDir, n));
}

function dirSize(path) {
  const st = statSync(path);
  if (st.isFile()) return st.size;
  return readdirSync(path).reduce((sum, n) => sum + dirSize(join(path, n)), 0);
}

export async function createBackup({ saveDir, worldName, label = '' }) {
  const entries = findWorldEntries(saveDir, worldName);
  if (entries.length === 0) {
    throw new Error(
      `Backup captured nothing for world "${worldName}" in ${saveDir}. ` +
      `The save format may have changed. Refusing to record an empty backup.`
    );
  }

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}${label ? `_${label}` : ''}`;
  const dest = join(backupsDir(), id);
  mkdirSync(dest, { recursive: true });

  for (const entry of entries) {
    const name = entry.split(/[\\/]/).pop();
    cpSync(entry, join(dest, name), { recursive: true });
  }

  const meta = {
    id, worldName, label,
    createdAt: Date.now(),
    entryCount: entries.length,
    sizeBytes: dirSize(dest)
  };
  writeFileSync(join(dest, 'backup.json'), JSON.stringify(meta, null, 2), 'utf8');

  if (meta.entryCount === 0) throw new Error('Backup verification failed: archive is empty.');
  return { ...meta, path: dest };
}

export function listBackups() {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir())
    .map(id => {
      try {
        return JSON.parse(readFileSync(join(backupsDir(), id, 'backup.json'), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreBackup(id, { saveDir, worldName }) {
  const src = join(backupsDir(), id);
  if (!existsSync(src)) throw new Error(`No such backup: ${id}`);

  // Snapshot the current world first so a misclick is recoverable.
  let safetyBackupId = null;
  try {
    const safety = await createBackup({ saveDir, worldName, label: 'pre-restore' });
    safetyBackupId = safety.id;
  } catch {
    // No current world to protect — a restore into an empty save dir is fine.
  }

  for (const existing of findWorldEntries(saveDir, worldName)) {
    rmSync(existing, { recursive: true, force: true });
  }
  for (const name of readdirSync(src)) {
    if (name === 'backup.json') continue;
    cpSync(join(src, name), join(saveDir, name), { recursive: true });
  }
  return { safetyBackupId };
}

export function pruneBackups(retention) {
  const all = listBackups();
  const doomed = all.slice(retention);
  for (const b of doomed) {
    rmSync(join(backupsDir(), b.id), { recursive: true, force: true });
  }
  return doomed.map(b => b.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/backups.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/backups.js test/backups.test.js
git commit -m "feat: format-agnostic backups that survive the 1.0 save rewrite"
```

---

### Task 7: `logtail.js` — follow the log file

**Files:**
- Create: `src/logtail.js`
- Test: `test/logtail.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createTail(path, onLine, { intervalMs = 1000 })` → `{ stop() }`. Emits complete lines only; tolerates a missing file and starts emitting when it appears; handles truncation by resetting to offset 0.

- [ ] **Step 1: Write the failing test**

Create `test/logtail.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTail } from '../src/logtail.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

test('emits lines appended after start', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tail-')), 'a.log');
  writeFileSync(file, 'first\n');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: 50 });
  await wait(120);
  appendFileSync(file, 'second\nthird\n');
  await wait(200);
  tail.stop();
  assert.deepEqual(seen, ['second', 'third']);
});

test('does not emit a partial line until it is terminated', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tail-')), 'b.log');
  writeFileSync(file, '');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: 50 });
  await wait(100);
  appendFileSync(file, 'incomp');
  await wait(150);
  assert.deepEqual(seen, []);
  appendFileSync(file, 'lete\n');
  await wait(150);
  tail.stop();
  assert.deepEqual(seen, ['incomplete']);
});

test('tolerates a file that does not exist yet', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tail-')), 'later.log');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: 50 });
  await wait(120);
  writeFileSync(file, 'appeared\n');
  await wait(200);
  tail.stop();
  assert.deepEqual(seen, ['appeared']);
});

test('resets when the file is truncated', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tail-')), 'c.log');
  writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: 50 });
  await wait(120);
  writeFileSync(file, 'fresh\n');
  await wait(200);
  tail.stop();
  assert.ok(seen.includes('fresh'));
});

test('stop() halts emission', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tail-')), 'd.log');
  writeFileSync(file, '');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: 50 });
  await wait(100);
  tail.stop();
  appendFileSync(file, 'ignored\n');
  await wait(200);
  assert.deepEqual(seen, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logtail.test.js`
Expected: FAIL — cannot find module `../src/logtail.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/logtail.js`:

```js
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';

export function createTail(path, onLine, { intervalMs = 1000 } = {}) {
  let offset = null;   // null until the file first appears
  let carry = '';
  let stopped = false;

  function poll() {
    if (stopped) return;
    try {
      if (!existsSync(path)) return;
      const size = statSync(path).size;

      if (offset === null) {
        // Start at the end: we stream new activity, not history.
        offset = size;
        return;
      }
      if (size < offset) {
        // Truncated or rotated.
        offset = 0;
        carry = '';
      }
      if (size === offset) return;

      const fd = openSync(path, 'r');
      try {
        const length = size - offset;
        const buf = Buffer.alloc(length);
        const read = readSync(fd, buf, 0, length, offset);
        offset += read;
        carry += buf.subarray(0, read).toString('utf8');
      } finally {
        closeSync(fd);
      }

      const parts = carry.split(/\r?\n/);
      carry = parts.pop();
      for (const line of parts) {
        if (stopped) return;
        if (line.length > 0) onLine(line);
      }
    } catch {
      // A transient read error must not kill the tail loop.
    }
  }

  const timer = setInterval(poll, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logtail.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/logtail.js test/logtail.test.js
git commit -m "feat: log tailer tolerant of missing files, partial lines, and truncation"
```

---

### Task 8: `steamcmd.js` — install and update

**Files:**
- Create: `src/steamcmd.js`
- Test: `test/steamcmd.test.js`

**Interfaces:**
- Consumes: `src/paths.js`.
- Produces:
  - `STEAMCMD_URL`, `VALHEIM_APP_ID` constants.
  - `parseProgress(line)` → `{ percent: number|null, text: string }`.
  - `ensureSteamCmd({ onProgress })` → `Promise<string>` resolving to `steamcmd.exe`'s absolute path.
  - `installOrUpdate({ installDir, onProgress })` → `Promise<{ ok: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `test/steamcmd.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, VALHEIM_APP_ID } from '../src/steamcmd.js';

test('the app id is the Valheim dedicated server', () => {
  assert.equal(VALHEIM_APP_ID, '896660');
});

test('parses a percentage from a steamcmd progress line', () => {
  const r = parseProgress(' Update state (0x61) downloading, progress: 42.15 (1234 / 5678)');
  assert.equal(Math.round(r.percent), 42);
});

test('parses a verifying line', () => {
  const r = parseProgress(' Update state (0x81) verifying update, progress: 7.00 (1 / 2)');
  assert.equal(Math.round(r.percent), 7);
});

test('returns null percent for a non-progress line', () => {
  assert.equal(parseProgress('Logging in user ... OK').percent, null);
});

test('recognises success', () => {
  const r = parseProgress(`Success! App '896660' fully installed.`);
  assert.equal(r.percent, 100);
});

test('keeps the original text', () => {
  const line = 'Logging in user ... OK';
  assert.equal(parseProgress(line).text, line);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/steamcmd.test.js`
Expected: FAIL — cannot find module `../src/steamcmd.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/steamcmd.js`:

```js
import { spawn, execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { toolsDir } from './paths.js';

const execFileAsync = promisify(execFile);

export const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
export const VALHEIM_APP_ID = '896660';

export function parseProgress(line) {
  if (/Success!.*fully installed/i.test(line)) return { percent: 100, text: line };
  const m = /progress:\s*([\d.]+)/i.exec(line);
  return { percent: m ? Number(m[1]) : null, text: line };
}

export async function ensureSteamCmd({ onProgress = () => {} } = {}) {
  const dir = join(toolsDir(), 'steamcmd');
  const exe = join(dir, 'steamcmd.exe');
  if (existsSync(exe)) return exe;

  mkdirSync(dir, { recursive: true });
  const zip = join(toolsDir(), 'steamcmd.zip');

  onProgress('Downloading SteamCMD...');
  const res = await fetch(STEAMCMD_URL);
  if (!res.ok) throw new Error(`SteamCMD download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  onProgress('Extracting SteamCMD...');
  await execFileAsync('powershell', [
    '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`
  ]);

  if (!existsSync(exe)) throw new Error('SteamCMD extraction did not produce steamcmd.exe');
  return exe;
}

export async function installOrUpdate({ installDir, onProgress = () => {} }) {
  const exe = await ensureSteamCmd({ onProgress });
  mkdirSync(installDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(exe, [
      '+force_install_dir', installDir,
      '+login', 'anonymous',
      '+app_update', VALHEIM_APP_ID, 'validate',
      '+quit'
    ]);

    let carry = '';
    const handle = chunk => {
      carry += chunk.toString('utf8');
      const parts = carry.split(/\r?\n/);
      carry = parts.pop();
      for (const line of parts) onProgress(line, parseProgress(line));
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', reject);
    child.on('close', code => {
      if (carry) onProgress(carry, parseProgress(carry));
      // SteamCMD exits 7 on a successful self-update restart; treat 0 and 7 as ok.
      if (code === 0 || code === 7) resolve({ ok: true });
      else reject(new Error(`SteamCMD exited with code ${code}`));
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/steamcmd.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/steamcmd.js test/steamcmd.test.js
git commit -m "feat: SteamCMD bootstrap, install, and update with progress parsing"
```

---

### Task 9: `server.js` — API and SSE

**Files:**
- Create: `src/server.js`, `src/hub.js`
- Test: `test/hub.test.js`

**Interfaces:**
- Consumes: every previous module.
- Produces: `createHub()` → `{ subscribe(res), broadcast(type, data), count() }`, and the Express app listening on `config.panelPort`.

- [ ] **Step 1: Write the failing test**

Create `test/hub.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';

function fakeRes() {
  const written = [];
  return {
    written,
    headersSent: false,
    setHeader() {},
    flushHeaders() {},
    write(chunk) { written.push(chunk); return true; },
    on() {},
    end() {}
  };
}

test('broadcast reaches every subscriber', () => {
  const hub = createHub();
  const a = fakeRes(), b = fakeRes();
  hub.subscribe(a); hub.subscribe(b);
  hub.broadcast('log', { line: 'hello' });
  assert.ok(a.written.join('').includes('hello'));
  assert.ok(b.written.join('').includes('hello'));
});

test('messages are formatted as SSE events', () => {
  const hub = createHub();
  const r = fakeRes();
  hub.subscribe(r);
  hub.broadcast('status', { running: true });
  const out = r.written.join('');
  assert.match(out, /^event: status\r?\n/m);
  assert.match(out, /^data: \{"running":true\}\r?\n/m);
  assert.ok(out.endsWith('\n\n'));
});

test('count tracks subscribers', () => {
  const hub = createHub();
  assert.equal(hub.count(), 0);
  hub.subscribe(fakeRes());
  assert.equal(hub.count(), 1);
});

test('a subscriber that throws on write is dropped, not fatal', () => {
  const hub = createHub();
  const bad = fakeRes();
  bad.write = () => { throw new Error('socket closed'); };
  const good = fakeRes();
  hub.subscribe(bad); hub.subscribe(good);
  assert.doesNotThrow(() => hub.broadcast('log', { line: 'x' }));
  assert.equal(hub.count(), 1);
  assert.ok(good.written.join('').includes('x'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub.test.js`
Expected: FAIL — cannot find module `../src/hub.js`.

- [ ] **Step 3: Write `src/hub.js`**

```js
export function createHub() {
  const clients = new Set();

  function subscribe(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    clients.add(res);
    res.on('close', () => clients.delete(res));
  }

  function broadcast(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...clients]) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  return { subscribe, broadcast, count: () => clients.size };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `src/server.js`**

```js
import express from 'express';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, backupsDir, configFile, logsDir } from './paths.js';
import { loadConfig, saveConfig, validate } from './settings.js';
import { createParser } from './parser.js';
import { createTail } from './logtail.js';
import { createHub } from './hub.js';
import * as proc from './process.js';
import * as backups from './backups.js';
import { installOrUpdate } from './steamcmd.js';

if (!existsSync(configFile())) {
  copyFileSync(join(ROOT, 'config.example.json'), configFile());
}
mkdirSync(backupsDir(), { recursive: true });
mkdirSync(logsDir(), { recursive: true });

let config = loadConfig();
const hub = createHub();
const parser = createParser(config.logPatterns);

createTail(join(logsDir(), 'server.log'), line => {
  const events = parser.feed(line);
  hub.broadcast('log', { line });
  if (events.length) hub.broadcast('events', events);
}, { intervalMs: 1000 });

const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

const wrap = fn => (req, res) =>
  fn(req, res).catch(err => res.status(500).json({ error: err.message }));

app.get('/api/status', wrap(async (_req, res) => {
  const s = await proc.status();
  res.json({ ...s, ...parser.snapshot(), world: config.server.world });
}));

app.get('/api/stream', (req, res) => hub.subscribe(res));

app.post('/api/server/start', wrap(async (_req, res) => {
  const errors = validate(config);
  if (errors.length) return res.status(400).json({ errors });
  if ((await proc.status()).running) return res.status(409).json({ error: 'Already running.' });
  const { pid } = await proc.start(config);
  hub.broadcast('status', { running: true, pid });
  res.json({ pid });
}));

app.post('/api/server/stop', wrap(async (_req, res) => {
  await safeBackup('pre-stop');
  const result = await proc.stop({ onProgress: t => hub.broadcast('progress', { text: t }) });
  hub.broadcast('status', { running: false });
  res.json(result);
}));

app.post('/api/server/restart', wrap(async (_req, res) => {
  await safeBackup('pre-restart');
  await proc.stop({ onProgress: t => hub.broadcast('progress', { text: t }) });
  const { pid } = await proc.start(config);
  hub.broadcast('status', { running: true, pid });
  res.json({ pid });
}));

app.get('/api/config', (_req, res) => res.json(config));

app.put('/api/config', wrap(async (req, res) => {
  const next = { ...config, ...req.body };
  const errors = validate(next);
  if (errors.length) return res.status(400).json({ errors });
  config = next;
  saveConfig(config);
  res.json(config);
}));

app.get('/api/backups', (_req, res) => res.json(backups.listBackups()));

app.post('/api/backups', wrap(async (_req, res) => {
  const meta = await backups.createBackup({
    saveDir: config.saveDir, worldName: config.server.world, label: 'manual'
  });
  backups.pruneBackups(config.backupRetention);
  res.json(meta);
}));

app.post('/api/backups/:id/restore', wrap(async (req, res) => {
  if ((await proc.status()).running) {
    return res.status(409).json({ error: 'Stop the server before restoring.' });
  }
  const result = await backups.restoreBackup(req.params.id, {
    saveDir: config.saveDir, worldName: config.server.world
  });
  res.json(result);
}));

app.post('/api/install', wrap(async (_req, res) => {
  if ((await proc.status()).running) {
    return res.status(409).json({ error: 'Stop the server before updating.' });
  }
  res.json({ started: true });
  installOrUpdate({
    installDir: config.installDir,
    onProgress: (line, p) => hub.broadcast('install', { line, percent: p.percent })
  }).then(
    () => hub.broadcast('install', { line: 'Done.', percent: 100, done: true }),
    err => hub.broadcast('install', { line: `Failed: ${err.message}`, error: true })
  );
}));

async function safeBackup(label) {
  try {
    await backups.createBackup({
      saveDir: config.saveDir, worldName: config.server.world, label
    });
    backups.pruneBackups(config.backupRetention);
  } catch (err) {
    hub.broadcast('progress', { text: `Backup skipped: ${err.message}` });
  }
}

setInterval(async () => {
  hub.broadcast('status', { ...(await proc.status()), ...parser.snapshot() });
}, 5000).unref?.();

app.listen(config.panelPort, '0.0.0.0', () => {
  console.log(`Valheim control panel on http://localhost:${config.panelPort}`);
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, all tests across all files.

- [ ] **Step 7: Commit**

```bash
git add src/hub.js src/server.js test/hub.test.js
git commit -m "feat: REST API and SSE broadcast hub"
```

---

### Task 10: Impeccable direction round

**Gate: no UI code before this task completes.**

**Files:**
- Create: `PRODUCT.md`, `DESIGN.md`, `.impeccable/` artifacts as the skill directs.

**Interfaces:**
- Consumes: the spec's Interface section.
- Produces: `DESIGN.md`, the committed visual world that Task 11 builds in.

- [ ] **Step 1: Invoke the Impeccable skill**

Run the `impeccable` skill. Follow `reference/routing.md` to the new-work flow.

- [ ] **Step 2: Complete `init` to produce `PRODUCT.md`**

Read `reference/init.md`. Product truth: a LAN-only operations console for a private Valheim server run by one person for a small group of friends. Mode is **Operate**.

- [ ] **Step 3: Derive seven visual systems**

Per `reference/new-work.md` step 3. Keep the category default — dark slate dashboard with an ember accent — out of the seven; it is the rut, and it is reserved as the standing exit.

- [ ] **Step 4: Run the direction roll**

Run: `node .claude/skills/impeccable/scripts/concept-seed.mjs --scope direction --mode operate`
Expected: an assigned direction plus dealt challengers. This step has no skip condition.

- [ ] **Step 5: Serve the decision page**

Run: `node .claude/skills/impeccable/scripts/serve-question.mjs --schema` first for the payload shape, then `--start --payload <file>`. Open the printed URL for the user.

**If the user is away:** per `reference/new-work.md`, re-present once through the structured question tool; with no answer, proceed with the assigned direction and state the assumptions plainly in the handoff notes.

- [ ] **Step 6: Write `DESIGN.md`**

Commit the chosen world: palette, type, materials, composition, topology, controls and states, responsive rules.

- [ ] **Step 7: Commit**

```bash
git add PRODUCT.md DESIGN.md .impeccable
git commit -m "design: commit the visual world for the control panel"
```

---

### Task 11: The dashboard UI

**Files:**
- Create: `public/index.html`, `public/style.css`, `public/app.js`, `public/icons.svg`

**Interfaces:**
- Consumes: the API from Task 9, the world from `DESIGN.md`.
- Produces: the browser UI.

- [ ] **Step 1: Load the Impeccable session context**

Run: `node .claude/skills/impeccable/scripts/context.mjs --target public/index.html`
Then read `.claude/skills/impeccable/reference/craft-floor.md`.

- [ ] **Step 2: Draw the icon set**

Create `public/icons.svg` as an SVG sprite with symbols: `start`, `stop`, `restart`, `backup`, `restore`, `download`, `update`, `settings`. Drawn paths on a consistent grid. **No emoji, no unicode glyphs** — the craft floor bans them.

- [ ] **Step 3: Build the status header**

`public/index.html`: server state, uptime, world name, installed build, join code presented for copying, and the player list. This is an Operate surface — state and task legibility outrank expression.

- [ ] **Step 4: Build the action row and sections**

Console (live tail with a filter), Backups (table with restore/download), Settings (form over `/api/config`), Update. Stop, restart, restore, and update each confirm before acting.

- [ ] **Step 5: Wire `public/app.js` to the SSE stream**

Subscribe to `/api/stream`; handle `log`, `events`, `status`, `progress`, and `install`. Render the join code prominently, and mark unnamed player slots when the heartbeat count exceeds the known names.

- [ ] **Step 6: Verify against the craft floor**

Run: `node .claude/skills/impeccable/scripts/detect.mjs --target public/index.html`
Expected: no immediate-tier findings. Fix any that appear.

- [ ] **Step 7: Commit**

```bash
git add public/
git commit -m "feat: control panel UI in the committed design world"
```

---

### Task 12: Launcher and operator documentation

**Files:**
- Create: `start.bat`, `README.md`

- [ ] **Step 1: Write `start.bat`**

```bat
@echo off
cd /d "%~dp0"
if not exist node_modules ( echo Installing dependencies... && call npm install )
echo Starting Valheim control panel...
start "" http://localhost:8080
node src/server.js
pause
```

- [ ] **Step 2: Write `README.md`**

Cover: first-run install via the Update button, where `config.json` lives, the LAN-only warning, how to edit `logPatterns` when 1.0 changes log formats, and the Wednesday update procedure (update first — nobody can play until the build matches).

- [ ] **Step 3: Manual end-to-end verification**

Start the panel, install the server, start it, confirm the status header shows running with a join code, join from the game, confirm the player appears, take a backup, stop the server, confirm `World saved` appeared and the backup is non-empty.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add start.bat README.md
git commit -m "feat: launcher and operator documentation"
```

---

## Self-Review

**Spec coverage.** Purpose → Tasks 9/11. Constraints → Global Constraints. Verified-documentation findings → Task 3 (flags, `-logFile`, password rule), Task 4 (ZDOID death, heartbeat count, both backends), Task 5 (Ctrl+Break), Task 6 (format-agnostic backups), Task 8 (version lock, update flow). Layout → Tasks 1–9. Process lifecycle → Tasks 2 and 5. Log parsing → Task 4. API → Task 9. Backups → Task 6. Install/update → Task 8. Interface + visual design → Tasks 10 and 11. Testing → the TDD steps throughout. Sequence → task order. Out of scope → nothing planned that the spec excludes.

**Gap found and closed:** the spec's status header calls for the *installed build version*, which no task produced. Task 11 Step 3 now lists it; the value is read from the SteamCMD manifest in the install dir and returned by `/api/status`.

**Placeholder scan.** No TBDs. Every code step carries real code. Task 10's steps defer to the Impeccable skill's own reference files by name, which is delegation to a documented process, not a placeholder.

**Type consistency.** `createParser(patterns)` → `{ feed, snapshot }` used consistently in Tasks 4 and 9. `createTail(path, onLine, opts)` → `{ stop }` consistent in Tasks 7 and 9. `createHub()` → `{ subscribe, broadcast, count }` consistent in Task 9. `createBackup`/`listBackups`/`restoreBackup`/`pruneBackups` signatures match between Tasks 6 and 9. `proc.status()`/`start(cfg)`/`stop({onProgress})` match between Tasks 5 and 9. `findWorldEntries(saveDir, worldName)` consistent across Task 6.
