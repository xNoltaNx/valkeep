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

export async function status({ runTasklist } = {}) {
  const state = readState();
  const stopped = { running: false, pid: null, startedAt: null, uptimeSeconds: 0 };
  if (!state?.pid) return stopped;

  if (!(await isValheimPid(state.pid, runTasklist))) {
    clearState();   // stale state from a crash or an external kill
    return stopped;
  }
  return {
    running: true,
    pid: state.pid,
    startedAt: state.startedAt,
    world: state.world ?? null,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000)
  };
}

export async function start(cfg) {
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
