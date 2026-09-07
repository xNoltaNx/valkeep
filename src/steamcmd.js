/**
 * SteamCMD bootstrap, install, and update.
 *
 * Install and update are the same command, which is why one module covers
 * both. This is the most important code path on 1.0 launch day: Valheim hard
 * locks versions, clients auto-update, and an un-updated server is not
 * degraded but unreachable by everyone.
 */

import { spawn, execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { toolsDir } from './paths.js';

const execFileAsync = promisify(execFile);

export const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
export const VALHEIM_APP_ID = '896660';

export function parseProgress(line) {
  if (/Success!.*fully installed/i.test(line)) return { percent: 100, text: line, done: true };
  const m = /progress:\s*([\d.]+)/i.exec(line);
  return { percent: m ? Number(m[1]) : null, text: line, done: false };
}

/**
 * Reads the installed build id from Steam's app manifest, so the panel can
 * show what is installed and warn when it no longer matches what clients run.
 */
export function readInstalledBuild(installDir) {
  const manifest = join(installDir, 'steamapps', `appmanifest_${VALHEIM_APP_ID}.acf`);
  try {
    const text = readFileSync(manifest, 'utf8');
    const buildid = /"buildid"\s*"(\d+)"/.exec(text)?.[1] ?? null;
    const updated = /"LastUpdated"\s*"(\d+)"/.exec(text)?.[1] ?? null;
    return { buildid, lastUpdated: updated ? Number(updated) * 1000 : null };
  } catch {
    return { buildid: null, lastUpdated: null };
  }
}

export function isInstalled(installDir) {
  return !!installDir && existsSync(join(installDir, 'valheim_server.exe'));
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
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`
  ]);

  if (!existsSync(exe)) throw new Error('SteamCMD extraction did not produce steamcmd.exe');
  return exe;
}

function runSteamCmd(exe, installDir, onProgress) {
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
      // SteamCMD redraws progress with \r, so split on it too or the whole
      // download arrives as one enormous line at the end.
      const parts = carry.split(/\r\n|\r|\n/);
      carry = parts.pop();
      for (const line of parts) {
        if (line.trim()) onProgress(line, parseProgress(line));
      }
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', reject);
    child.on('close', code => {
      if (carry.trim()) onProgress(carry, parseProgress(carry));
      resolve({ code });
    });
  });
}

export async function installOrUpdate({ installDir, onProgress = () => {} }) {
  if (!installDir) throw new Error('Install directory is not configured.');
  const exe = await ensureSteamCmd({ onProgress });
  mkdirSync(installDir, { recursive: true });

  // On its very first run SteamCMD self-updates and exits without doing the
  // work it was asked to do. Observed during the real install on 2026-09-07.
  // A second invocation is required, so always verify by result, not exit code.
  let last = await runSteamCmd(exe, installDir, onProgress);
  if (!isInstalled(installDir)) {
    onProgress('SteamCMD self-updated on first run; running the install again...');
    last = await runSteamCmd(exe, installDir, onProgress);
  }

  if (!isInstalled(installDir)) {
    throw new Error(
      `SteamCMD finished (exit ${last.code}) but valheim_server.exe is not in ${installDir}.`
    );
  }
  return { ok: true, ...readInstalledBuild(installDir) };
}
