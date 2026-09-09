import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ROOT, configFile, logsDir } from './paths.js';
import { activeModifiers, validateGameplay } from './gameplay.js';

/**
 * The three machine paths are the only settings the panel cannot ask for: they
 * have to be right before the panel can install anything, and there is nothing
 * useful to show in Settings until then. So derive them from where the panel
 * itself lives rather than making a new operator hand-edit config.json to find
 * out why nothing works. Anything already set is left alone.
 */
export function withDefaultPaths(cfg) {
  const installDir = cfg.installDir || join(ROOT, 'server');
  return {
    ...cfg,
    installDir,
    serverExe: cfg.serverExe || join(installDir, 'valheim_server.exe'),
    // Valheim's own default, which is where an existing single-player world
    // already is - so a world you have played is visible on first run.
    saveDir: cfg.saveDir || join(homedir(), 'AppData', 'LocalLow', 'IronGate', 'Valheim')
  };
}

export function loadConfig() {
  return withDefaultPaths(JSON.parse(readFileSync(configFile(), 'utf8')));
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
  // Both rules below are silent startup failures in Valheim if violated.
  if (!s.password || s.password.length < 5) {
    errors.push('Password must be at least 5 characters.');
  }
  // Valheim refuses to start if the password appears anywhere inside the
  // server name or the world name, not merely if it equals one of them - and
  // it refuses silently, with the process exiting seconds after launch. A
  // world called Midgard with the password "gard" is the shape that catches
  // people out. Compared case-insensitively: the game's own comparison may be
  // stricter than ours, and refusing a setup that would have worked is a
  // better failure than a server that quietly never comes up.
  const contains = (haystack, needle) =>
    String(haystack).toLowerCase().includes(String(needle).toLowerCase());
  if (s.password && s.name && contains(s.name, s.password)) {
    errors.push('Password must not appear in the server name.');
  }
  if (s.password && s.world && contains(s.world, s.password)) {
    errors.push('Password must not appear in the world name.');
  }
  errors.push(...validateGameplay(s));
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

  // A modifier set to "normal" is the game's default and is expressed by
  // omitting the flag, not by passing it.
  for (const [key, value] of activeModifiers(s.modifiers)) {
    args.push('-modifier', key, String(value));
  }
  for (const key of s.setkeys ?? []) {
    args.push('-setkey', String(key));
  }

  return args;
}

/**
 * Valheim's -savedir is the base directory; it creates worlds_local inside it.
 * Backups need the worlds directory itself, so derive it rather than making
 * the operator configure the same location twice and get it subtly wrong.
 */
export function worldsDir(cfg) {
  return join(cfg.saveDir, 'worlds_local');
}
