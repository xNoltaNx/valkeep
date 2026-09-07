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
  // Both rules below are silent startup failures in Valheim if violated.
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

/**
 * Valheim's -savedir is the base directory; it creates worlds_local inside it.
 * Backups need the worlds directory itself, so derive it rather than making
 * the operator configure the same location twice and get it subtly wrong.
 */
export function worldsDir(cfg) {
  return join(cfg.saveDir, 'worlds_local');
}
