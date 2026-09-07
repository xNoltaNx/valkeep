/**
 * The control panel HTTP server.
 *
 * LAN-only and unauthenticated by design. Never expose this to the internet:
 * every route below can start, stop, or overwrite the world with no credential.
 */

import express from 'express';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, backupsDir, configFile, logsDir } from './paths.js';
import { loadConfig, saveConfig, validate, worldsDir } from './settings.js';
import { createParser } from './parser.js';
import { createTail } from './logtail.js';
import { createHub } from './hub.js';
import * as proc from './process.js';
import * as backups from './backups.js';
import { installOrUpdate, isInstalled, readInstalledBuild } from './steamcmd.js';

if (!existsSync(configFile())) {
  copyFileSync(join(ROOT, 'config.example.json'), configFile());
  console.log('Created config.json from the example. Edit it in Settings.');
}
mkdirSync(backupsDir(), { recursive: true });
mkdirSync(logsDir(), { recursive: true });

let config = loadConfig();
const hub = createHub();
const parser = createParser(config.logPatterns);

// Keep the last slice of log in memory so a browser opening mid-session sees
// context rather than an empty console.
const recentLines = [];
const RECENT_MAX = 500;

createTail(join(logsDir(), 'server.log'), line => {
  recentLines.push(line);
  if (recentLines.length > RECENT_MAX) recentLines.shift();

  const events = parser.feed(line);
  hub.broadcast('log', { line });
  if (events.length) hub.broadcast('events', events);
}, { intervalMs: 1000 });

const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function currentStatus() {
  const s = await proc.status();
  return {
    ...s,
    ...parser.snapshot(),
    world: config.server.world,
    serverName: config.server.name,
    crossplay: !!config.server.crossplay,
    port: config.server.port,
    installed: isInstalled(config.installDir),
    ...readInstalledBuild(config.installDir || '')
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
  hub.broadcast('status', await currentStatus());
  res.json(result);
}));

app.post('/api/server/restart', wrap(async (_req, res) => {
  await safeBackup('pre-restart');
  await proc.stop({ onProgress: text => hub.broadcast('progress', { text }) });
  const { pid } = await proc.start(config);
  hub.broadcast('status', await currentStatus());
  res.json({ pid });
}));

app.get('/api/config', (_req, res) => res.json(config));

app.put('/api/config', wrap(async (req, res) => {
  const next = { ...config, ...req.body, server: { ...config.server, ...(req.body.server ?? {}) } };
  const errors = validate(next);
  if (errors.length) return res.status(400).json({ errors });
  config = next;
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

// Status heartbeat to the browser.
const statusTimer = setInterval(async () => {
  hub.broadcast('status', await currentStatus());
}, 5000);
statusTimer.unref?.();

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
