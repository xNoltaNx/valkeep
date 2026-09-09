/**
 * Is the installed dedicated server behind the one Steam is publishing?
 *
 * Valheim locks server and client to the identical build, so an un-updated
 * server is not slow - it is unreachable by everyone whose client already
 * auto-updated. The operator finds out when a friend cannot join, which is the
 * worst possible time. This module lets the panel say so first.
 *
 * The latest build comes from the SteamCMD already vendored in tools/, asked
 * with `app_info_print`, so the only party the panel talks to is Valve - the
 * same source the install itself comes from. Nothing is sent to a third-party
 * API, in keeping with the rest of the panel.
 *
 * Every function here is total: bad input yields "unknown", never a throw and
 * never a false "up to date". A wrong all-clear on patch day is the one
 * outcome worse than showing nothing at all.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir, toolsDir } from './paths.js';
import { VALHEIM_APP_ID } from './steamcmd.js';

/** How long a successful check stays fresh. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** SteamCMD is talking to the network; it must never hang the panel. */
export const CHECK_TIMEOUT_MS = 120 * 1000;

export const cacheFile = () => join(dataDir(), 'updatecheck.json');

/**
 * Pulls the public branch's build id out of `app_info_print` output.
 *
 * The real output carries a build id for every branch Iron Gate keeps - seven
 * of them at 1.0, including several "last stable build before X" pins. Taking
 * the first match would be right only by the accident of Valve's ordering, so
 * this tracks the key path and accepts a build id only inside
 * `branches` -> `public`.
 *
 * A hand-rolled scan rather than a full VDF parser: the format here is one
 * quoted token per line plus braces, and a real parser would be more code to
 * be wrong in for no gain.
 */
export function parseLatestBuild(text) {
  if (typeof text !== 'string' || text === '') return null;

  const stack = [];
  let pendingKey = null;
  let buildid = null;
  let timeUpdated = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    if (line === '{') {
      // The key seen just above this brace names the block being opened.
      stack.push(pendingKey ?? '');
      pendingKey = null;
      continue;
    }
    if (line === '}') {
      stack.pop();
      pendingKey = null;
      continue;
    }

    const pair = /^"([^"]*)"\s+"([^"]*)"$/.exec(line);
    if (pair) {
      const inPublicBranch =
        stack.length >= 2 &&
        stack[stack.length - 1] === 'public' &&
        stack[stack.length - 2] === 'branches';
      if (inPublicBranch) {
        if (pair[1] === 'buildid') buildid = pair[2];
        if (pair[1] === 'timeupdated') timeUpdated = Number(pair[2]) * 1000;
      }
      pendingKey = null;
      continue;
    }

    const key = /^"([^"]*)"$/.exec(line);
    pendingKey = key ? key[1] : null;
  }

  if (!buildid) return null;
  return { buildid, timeUpdated: Number.isFinite(timeUpdated) ? timeUpdated : null };
}

/**
 * Build ids are increasing integers written as strings, so they are compared
 * numerically - as text, build 9999999 would sort above build 25185644 and the
 * warning would fire exactly backwards.
 *
 * Only a strictly newer published build counts as outdated. An install ahead
 * of the public branch is someone on a beta or a pinned branch, and nagging
 * them with a notice they cannot clear would be worse than silence.
 */
export function compareBuilds(installed, latest) {
  const a = Number(installed);
  const b = Number(latest);
  const known =
    installed != null && latest != null &&
    String(installed) !== '' && String(latest) !== '' &&
    Number.isFinite(a) && Number.isFinite(b);

  return {
    state: !known ? 'unknown' : b > a ? 'outdated' : 'current',
    installed: installed ?? null,
    latest: latest ?? null
  };
}

/**
 * A check is stale when it has never run, when it has aged past the interval,
 * or when it claims to have run in the future - a clock moved backwards must
 * not freeze the check forever.
 */
export function isStale(cache, maxAgeMs = CHECK_INTERVAL_MS, now = Date.now()) {
  const at = cache?.checkedAt;
  if (!at || !Number.isFinite(at)) return true;
  if (at > now) return true;
  return now - at >= maxAgeMs;
}

/** The fields the dashboard needs, derived from the installed build and cache. */
export function summarise({ installed, cache }) {
  const { state } = compareBuilds(installed, cache?.buildid ?? null);
  return {
    updateState: state,
    latestBuild: cache?.buildid ?? null,
    latestBuildAt: cache?.timeUpdated ?? null,
    lastCheckedAt: cache?.checkedAt ?? null,
    updateCheckError: cache?.error ?? null
  };
}

export function readCache(file = cacheFile()) {
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    return cache && typeof cache === 'object' ? cache : null;
  } catch {
    // No check has run yet, or the file is unreadable. Both mean "unknown".
    return null;
  }
}

export function writeCache(cache, file = cacheFile()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // The cache is an optimisation. Failing to save it must not break a check.
  }
}

/**
 * Asks Steam what the public branch is on, without touching the install.
 *
 * `app_info_update 1` forces a refresh: SteamCMD will otherwise answer from a
 * local cache that can be days old, which would make the panel confidently
 * report yesterday's build as current.
 *
 * Note for the caller: SteamCMD must not run twice against the same install
 * directory at once, so this must never overlap an install or update.
 */
export function fetchLatestBuild({
  exe = join(toolsDir(), 'steamcmd', 'steamcmd.exe'),
  timeoutMs = CHECK_TIMEOUT_MS
} = {}) {
  return new Promise(resolve => {
    if (!existsSync(exe)) {
      resolve({ buildid: null, error: 'SteamCMD is not installed yet.' });
      return;
    }

    let child;
    try {
      child = spawn(exe, [
        '+login', 'anonymous',
        '+app_info_update', '1',
        '+app_info_print', VALHEIM_APP_ID,
        '+quit'
      ]);
    } catch (err) {
      resolve({ buildid: null, error: String(err?.message ?? err) });
      return;
    }

    let out = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ buildid: null, error: 'Timed out asking Steam for the latest build.' });
    }, timeoutMs);

    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { out += d.toString('utf8'); });
    child.on('error', err => finish({ buildid: null, error: String(err?.message ?? err) }));
    child.on('close', () => {
      const info = parseLatestBuild(out);
      finish(info
        ? { buildid: info.buildid, timeUpdated: info.timeUpdated, error: null }
        : { buildid: null, error: 'Could not read the build id from SteamCMD.' });
    });
  });
}

/** Runs a check and records the result, whether it succeeded or not. */
export async function runCheck({ file = cacheFile(), ...options } = {}) {
  const result = await fetchLatestBuild(options);
  const cache = { ...result, checkedAt: Date.now() };
  writeCache(cache, file);
  return cache;
}
