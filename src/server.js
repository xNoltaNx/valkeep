/**
 * The control panel HTTP server.
 *
 * LAN-only and unauthenticated by design. Never expose this to the internet:
 * every route below can start, stop, or overwrite the world with no credential.
 */

import express from 'express';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, backupsDir, configFile, logsDir } from './paths.js';
import { loadConfig, saveConfig, validate, worldsDir } from './settings.js';
import { createParser } from './parser.js';
import { createTail } from './logtail.js';
import { createHub } from './hub.js';
import * as proc from './process.js';
import * as backups from './backups.js';
import { installOrUpdate, isInstalled, readInstalledBuild } from './steamcmd.js';
import { listWorlds } from './worlds.js';
import { MODIFIERS, TOGGLES, PRESETS } from './gameplay.js';
import { LISTS, readAll, setMembership } from './access.js';
import { createRoster } from './roster.js';
import { createDiagnostics } from './diagnostics.js';
import { rememberProfile } from './profiles.js';

if (!existsSync(configFile())) {
  copyFileSync(join(ROOT, 'config.example.json'), configFile());
  console.log('Created config.json from the example. Edit it in Settings.');
}
mkdirSync(backupsDir(), { recursive: true });
mkdirSync(logsDir(), { recursive: true });

let config = loadConfig();
const hub = createHub();
const parser = createParser(config.logPatterns);
const roster = createRoster();
const diagnostics = createDiagnostics();
let lastDiagnostics = null;

// Keep the last slice of log in memory so a browser opening mid-session sees
// context rather than an empty console.
const recentLines = [];
const RECENT_MAX = 500;

createTail(join(logsDir(), 'server.log'), line => {
  recentLines.push(line);
  if (recentLines.length > RECENT_MAX) recentLines.shift();

  const events = parser.feed(line);
  hub.broadcast('log', { line });
  if (events.length) {
    roster.apply(events);
    hub.broadcast('events', events);
    hub.broadcast('players', { changed: true });
  }
}, { intervalMs: 1000 });

/*
 * The tailer starts at the end of an existing log, which is right for streaming
 * but means a panel restarted while the server is up would know nothing about
 * the session in progress - no join code until the game happened to print one
 * again. Replaying the log the server has already written recovers it.
 */
async function recoverSession() {
  const status = await proc.status();
  if (!status.running) return;
  try {
    const text = readFileSync(join(logsDir(), 'server.log'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line) roster.apply(parser.feed(line));
    }
    const snap = parser.snapshot();
    if (snap.joinCode) console.log(`Recovered the running session: join code ${snap.joinCode}`);
  } catch {
    // No log yet, or unreadable. Streaming will fill in from here.
  }
}

const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function currentStatus() {
  const s = await proc.status();
  const snap = parser.snapshot();

  // A join code, player list and public address describe the server that is
  // running now. If nothing is running, there is nothing to describe, and a
  // leftover code is one the host would send to friends in good faith.
  const session = s.running ? snap : {
    ...snap, joinCode: null, publicAddress: null,
    players: [], playerCount: 0, openSockets: 0
  };

  return {
    ...s,
    ...session,
    world: config.server.world,
    serverName: config.server.name,
    crossplay: !!config.server.crossplay,
    port: config.server.port,
    installed: isInstalled(config.installDir),
    ...readInstalledBuild(config.installDir || ''),
    connection: connectionFacts(s),
    diagnostics: lastDiagnostics,
    // The OS knows when the process really started, so an adopted server no
    // longer has to report its uptime as unknown.
    uptimeSeconds: lastDiagnostics?.uptimeSeconds ?? s.uptimeSeconds
  };
}

/**
 * How friends actually get in. Everything here is read from the server's own
 * log or config - nothing is probed, guessed, or sent to a third party.
 */
function connectionFacts(status) {
  const snap = parser.snapshot();
  if (!status.running) {
    return { reachable: false, method: config.server.crossplay ? 'joincode' : 'direct', detail: 'Server is stopped.' };
  }
  if (config.server.crossplay) {
    return snap.joinCode
      ? {
        reachable: true,
        method: 'joincode',
        detail: 'Registered with the crossplay relay. Friends join with the code - no port forwarding needed.',
        publicAddress: snap.publicAddress ?? null
      }
      : {
        reachable: false,
        method: 'joincode',
        detail: 'Waiting for the crossplay session to register.'
      };
  }
  return {
    reachable: null,
    method: 'direct',
    detail: 'Crossplay is off, so friends connect by IP. That needs UDP ' +
      `${config.server.port}-${config.server.port + 1} forwarded to this PC.`,
    publicAddress: snap.publicAddress ?? null
  };
}

app.get('/api/status', wrap(async (_req, res) => res.json(await currentStatus())));

app.get('/api/log', (_req, res) => res.json({ lines: recentLines }));

app.get('/api/stream', (req, res) => {
  hub.subscribe(res);
  currentStatus().then(s => hub.broadcast('status', s), () => {});
});

app.post('/api/server/start', wrap(async (_req, res) => {
  const errors = validate(config);
  if (errors.length) return res.status(400).json({ errors });
  if (!isInstalled(config.installDir)) {
    return res.status(409).json({ error: 'Server is not installed yet. Run Update first.' });
  }
  if ((await proc.status()).running) {
    return res.status(409).json({ error: 'Server is already running.' });
  }

  parser.resetSession();
  const { pid } = await proc.start(config);
  hub.broadcast('progress', { text: 'Starting. First boot on a new world can take a minute.' });
  hub.broadcast('status', await currentStatus());
  res.json({ pid });
}));

app.post('/api/server/stop', wrap(async (_req, res) => {
  if (!(await proc.status()).running) {
    return res.status(409).json({ error: 'Server is not running.' });
  }
  await safeBackup('pre-stop');
  const result = await proc.stop({ onProgress: text => hub.broadcast('progress', { text }) });
  parser.resetSession();
  hub.broadcast('status', await currentStatus());
  res.json(result);
}));

app.post('/api/server/restart', wrap(async (_req, res) => {
  await safeBackup('pre-restart');
  await proc.stop({ onProgress: text => hub.broadcast('progress', { text }) });
  parser.resetSession();
  const { pid } = await proc.start(config);
  hub.broadcast('status', await currentStatus());
  res.json({ pid });
}));

app.get('/api/players', (_req, res) => {
  const lists = readAll(config.saveDir);
  res.json({
    players: roster.list(),
    lists,
    definitions: LISTS,
    // An allow-list that is not empty silently blocks everyone else, which is
    // the single most surprising behaviour in this whole feature.
    allowListActive: lists.permitted.length > 0
  });
});

app.post('/api/players/access', wrap(async (req, res) => {
  const { id, list, member } = req.body ?? {};
  if (!LISTS[list]) return res.status(400).json({ error: 'Unknown access list.' });
  try {
    const result = setMembership(config.saveDir, list, String(id ?? ''), !!member);
    hub.broadcast('players', { changed: true });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.delete('/api/players/:id', (req, res) => {
  res.json({ forgotten: roster.forget(req.params.id) });
});

app.get('/api/worlds', (_req, res) => {
  const worlds = listWorlds(worldsDir(config));
  res.json({
    worlds,
    current: config.server.world,
    // Every remembered profile, not only the worlds already on disk: a world
    // you configured but have not generated yet must still restore its own
    // settings when you switch back to it.
    profiles: config.worldProfiles ?? {}
  });
});

app.get('/api/gameplay', (_req, res) => {
  res.json({ modifiers: MODIFIERS, toggles: TOGGLES, presets: PRESETS });
});

app.get('/api/config', (_req, res) => res.json(config));

app.put('/api/config', wrap(async (req, res) => {
  const next = { ...config, ...req.body, server: { ...config.server, ...(req.body.server ?? {}) } };
  const errors = validate(next);
  if (errors.length) return res.status(400).json({ errors });
  config = next;
  config.worldProfiles = rememberProfile(config, next.server.world, next.server);
  saveConfig(config);
  hub.broadcast('status', await currentStatus());
  res.json(config);
}));

app.get('/api/backups', (_req, res) => res.json(backups.listBackups()));

app.post('/api/backups', wrap(async (_req, res) => {
  const meta = await backups.createBackup({
    saveDir: worldsDir(config), worldName: config.server.world, label: 'manual'
  });
  backups.pruneBackups(config.backupRetention);
  hub.broadcast('backups', { changed: true });
  res.json(meta);
}));

app.post('/api/backups/:id/restore', wrap(async (req, res) => {
  if ((await proc.status()).running) {
    return res.status(409).json({ error: 'Stop the server before restoring a backup.' });
  }
  const result = await backups.restoreBackup(req.params.id, {
    saveDir: worldsDir(config), worldName: config.server.world
  });
  hub.broadcast('backups', { changed: true });
  res.json(result);
}));

app.post('/api/install', wrap(async (_req, res) => {
  if ((await proc.status()).running) {
    return res.status(409).json({ error: 'Stop the server before updating.' });
  }
  res.json({ started: true });

  // Runs past the response; progress arrives over SSE.
  installOrUpdate({
    installDir: config.installDir,
    onProgress: (line, p) => hub.broadcast('install', { line, percent: p?.percent ?? null })
  }).then(
    async result => {
      hub.broadcast('install', { line: 'Update complete.', percent: 100, done: true });
      hub.broadcast('status', await currentStatus());
      return result;
    },
    err => hub.broadcast('install', { line: `Failed: ${err.message}`, error: true })
  );
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function safeBackup(label) {
  try {
    const meta = await backups.createBackup({
      saveDir: worldsDir(config), worldName: config.server.world, label
    });
    backups.pruneBackups(config.backupRetention);
    hub.broadcast('progress', { text: `Backed up ${meta.fileCount} file(s) before continuing.` });
    hub.broadcast('backups', { changed: true });
  } catch (err) {
    // Never block a stop on a backup failure, but say so loudly.
    hub.broadcast('progress', { text: `Backup skipped: ${err.message}`, warning: true });
  }
}

// Periodic backup while the server is up.
const backupTimer = setInterval(async () => {
  if ((await proc.status()).running) await safeBackup('auto');
}, Math.max(1, config.backupIntervalMinutes ?? 30) * 60_000);
backupTimer.unref?.();

const diagnosticsTimer = setInterval(async () => {
  const s = await proc.status();
  if (!s.running) {
    if (lastDiagnostics) {
      lastDiagnostics = null;
      diagnostics.reset();
    }
    return;
  }
  const sample = await diagnostics.sample(s.pid);
  if (sample) {
    lastDiagnostics = sample;
    hub.broadcast('diagnostics', sample);
  }
}, 4000);
diagnosticsTimer.unref?.();

// Status heartbeat to the browser. Also notices a server that went away
// without us: a crash, or someone killing it outside the panel.
let wasRunning = null;
const statusTimer = setInterval(async () => {
  const status = await currentStatus();
  if (wasRunning && !status.running) parser.resetSession();
  wasRunning = status.running;
  hub.broadcast('status', status);
}, 5000);
statusTimer.unref?.();

recoverSession();

const server = app.listen(config.panelPort, '0.0.0.0', () => {
  console.log(`Valheim control panel: http://localhost:${config.panelPort}`);
  console.log('LAN only - do not expose this port to the internet.');
});

// A raw EADDRINUSE stack trace is useless to someone who double-clicked
// start.bat. Say what happened and what to do about it.
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
Port ${config.panelPort} is already in use.`);
    console.error('The panel is probably already running - open');
    console.error(`  http://localhost:${config.panelPort}`);
    console.error(`or change "panelPort" in config.json and start again.
`);
  } else {
    console.error(`
The panel could not start: ${err.message}
`);
  }
  process.exit(1);
});
