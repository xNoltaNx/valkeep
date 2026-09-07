/**
 * Server process lifecycle.
 *
 * The server is spawned detached so it survives a panel restart: stopping or
 * crashing the panel must never disconnect players. The cost is that we cannot
 * capture its stdout, which is why it is launched with -logFile and followed
 * by logtail.js instead.
 *
 * Shutdown uses graceful taskkill, verified against a real server three times
 * (see docs/shutdown-probe.md): it reliably triggers a world save. /F is the
 * timeout path only - it loses the world.
 */

import { spawn, execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { dataDir, logsDir, stateFile } from './paths.js';
import { buildArgs } from './settings.js';

const execFileAsync = promisify(execFile);
const IMAGE = 'valheim_server.exe';
const STOP_TIMEOUT_MS = 60_000;

async function defaultTasklist(pid) {
  const { stdout } = await execFileAsync(
    'tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']
  );
  return stdout;
}

async function defaultImageList() {
  const { stdout } = await execFileAsync(
    'tasklist', ['/FI', `IMAGENAME eq ${IMAGE}`, '/FO', 'CSV', '/NH']
  );
  return stdout;
}

/**
 * Every running Valheim server on this machine, whether or not we started it.
 *
 * Without this the panel only ever knew about its own recorded pid, so a
 * server left behind by a previous panel session was invisible: status said
 * "stopped" while players were connected, and Start would launch a second
 * server that instantly died on the already-bound port while reporting
 * success.
 */
export async function findServerPids(runImageList = defaultImageList) {
  try {
    const out = await runImageList();
    return out.split(/\r?\n/)
      .filter(l => l.trim().startsWith('"'))
      .map(l => l.split('","'))
      .filter(cols => cols[0].replace(/^"/, '').toLowerCase() === IMAGE)
      .map(cols => Number(cols[1]))
      .filter(Number.isFinite);
  } catch {
    return [];
  }
}

/**
 * True only when the pid is alive AND is actually the Valheim server.
 * Windows recycles pids; without the image check the panel could report a
 * stopped server as running, or offer to kill an unrelated process.
 */
export async function isValheimPid(pid, runTasklist = defaultTasklist) {
  if (!pid || pid <= 0) return false;
  try {
    const out = await runTasklist(pid);
    const row = out.split(/\r?\n/).find(l => l.trim().startsWith('"'));
    if (!row) return false;
    const image = row.split('","')[0].replace(/^"/, '');
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
  try {
    rmSync(stateFile());
  } catch {
    // already gone
  }
}

export async function status({ runTasklist, runImageList } = {}) {
  const state = readState();
  const stopped = { running: false, pid: null, startedAt: null, uptimeSeconds: 0, adopted: false };

  if (state?.pid && await isValheimPid(state.pid, runTasklist)) {
    return {
      running: true,
      pid: state.pid,
      startedAt: state.startedAt,
      world: state.world ?? null,
      adopted: !!state.adopted,
      uptimeSeconds: state.startedAt
        ? Math.floor((Date.now() - state.startedAt) / 1000)
        : 0
    };
  }

  if (state?.pid) clearState();   // stale state from a crash or external kill

  // Adopt a server we did not start: a leftover from a previous panel session
  // is still the real server, and pretending otherwise is worse than adopting.
  const found = await findServerPids(runImageList);
  if (found.length === 1) {
    const pid = found[0];
    writeState({ pid, startedAt: null, world: null, adopted: true });
    return { running: true, pid, startedAt: null, world: null, adopted: true, uptimeSeconds: 0 };
  }
  return stopped;
}

export async function start(cfg) {
  const already = await findServerPids();
  if (already.length > 0) {
    throw new Error(
      `A Valheim server is already running (pid ${already.join(', ')}). ` +
      `Stop it before starting another - a second server cannot bind the same port.`
    );
  }
  mkdirSync(logsDir(), { recursive: true });
  const child = spawn(cfg.serverExe, buildArgs(cfg), {
    detached: true,
    stdio: 'ignore',
    cwd: cfg.installDir || undefined
  });
  child.unref();
  writeState({ pid: child.pid, startedAt: Date.now(), world: cfg.server.world });
  return { pid: child.pid };
}

export async function stop({ onProgress = () => {}, runTasklist } = {}) {
  const state = readState();
  if (!state?.pid) return { graceful: true, wasRunning: false };
  const pid = state.pid;

  onProgress('Asking the server to shut down...');
  try {
    await execFileAsync('taskkill', ['/PID', String(pid)]);
  } catch (err) {
    onProgress(`Shutdown request failed: ${err.message}`);
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await isValheimPid(pid, runTasklist))) {
      clearState();
      onProgress('Server stopped cleanly and saved the world.');
      return { graceful: true, wasRunning: true };
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  onProgress('Timed out after 60s - force killing. The world may not be saved.');
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
  } catch {
    // already gone
  }
  clearState();
  return { graceful: false, wasRunning: true };
}
