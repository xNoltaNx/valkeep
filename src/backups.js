/**
 * World backups.
 *
 * Deliberately format-agnostic. The obvious implementation - copy the .db and
 * .fwl pair - is a trap: a rewritten save system on the public test branch
 * replaces that pair with a folder of pieces, and Iron Gate has not said
 * whether it ships with 1.0. A module hardcoded to two extensions could start
 * silently backing up nothing on patch day, which is the worst failure mode a
 * backup can have. So a world is "every entry matching the world name",
 * whether file or directory, and an empty capture is a loud error.
 */

import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { backupsDir } from './paths.js';

const META = 'backup.json';

/**
 * Matches, for world "Dedicated":
 *   Dedicated                                  (folder-style save)
 *   Dedicated.db, Dedicated.fwl                (current format)
 *   Dedicated.fwl.old                          (Valheim's rolling copy)
 *   Dedicated_backup_auto-20260907133550.fwl   (Valheim's own backups)
 *
 * Does not match a different world that merely starts with the same string:
 * world "Probe" does not capture "ProbeWorld.db".
 */
export function findWorldEntries(saveDir, worldName) {
  if (!saveDir || !worldName || !existsSync(saveDir)) return [];
  let names;
  try {
    names = readdirSync(saveDir);
  } catch {
    return [];
  }
  return names
    .filter(n =>
      n === worldName ||
      n.startsWith(`${worldName}.`) ||
      n.startsWith(`${worldName}_backup_`))
    .map(n => join(saveDir, n));
}

function entrySize(path) {
  const st = statSync(path);
  if (st.isFile()) return st.size;
  return readdirSync(path).reduce((sum, n) => sum + entrySize(join(path, n)), 0);
}

function countFiles(path) {
  const st = statSync(path);
  if (st.isFile()) return 1;
  return readdirSync(path).reduce((sum, n) => sum + countFiles(join(path, n)), 0);
}

export async function createBackup({ saveDir, worldName, label = '' }) {
  const entries = findWorldEntries(saveDir, worldName);
  if (entries.length === 0) {
    throw new Error(
      `Backup captured nothing for world "${worldName}" in ${saveDir}. ` +
      `The save format may have changed. Refusing to record an empty backup.`
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = label ? `${stamp}_${label}` : stamp;
  const dest = join(backupsDir(), id);
  mkdirSync(dest, { recursive: true });

  for (const entry of entries) {
    const name = entry.split(/[\\/]/).pop();
    cpSync(entry, join(dest, name), { recursive: true });
  }

  const fileCount = readdirSync(dest).reduce(
    (sum, n) => sum + countFiles(join(dest, n)), 0
  );
  // Verify rather than assume. A backup that captured nothing must fail loudly.
  if (fileCount === 0) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error('Backup verification failed: nothing was copied.');
  }

  const meta = {
    id,
    worldName,
    label,
    createdAt: Date.now(),
    entryCount: entries.length,
    fileCount,
    sizeBytes: readdirSync(dest).reduce((s, n) => s + entrySize(join(dest, n)), 0)
  };
  writeFileSync(join(dest, META), JSON.stringify(meta, null, 2), 'utf8');
  return { ...meta, path: dest };
}

export function listBackups() {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir())
    .map(id => {
      try {
        return JSON.parse(readFileSync(join(backupsDir(), id, META), 'utf8'));
      } catch {
        return null;   // a partially written or hand-deleted backup
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreBackup(id, { saveDir, worldName }) {
  const src = join(backupsDir(), id);
  if (!existsSync(src)) throw new Error(`No such backup: ${id}`);

  // Snapshot the current world first, so a misclicked restore is recoverable.
  let safetyBackupId = null;
  try {
    safetyBackupId = (await createBackup({ saveDir, worldName, label: 'pre-restore' })).id;
  } catch {
    // Nothing to protect - restoring into an empty save dir is legitimate.
  }

  mkdirSync(saveDir, { recursive: true });
  for (const existing of findWorldEntries(saveDir, worldName)) {
    rmSync(existing, { recursive: true, force: true });
  }
  for (const name of readdirSync(src)) {
    if (name === META) continue;
    cpSync(join(src, name), join(saveDir, name), { recursive: true });
  }
  return { safetyBackupId };
}

export function pruneBackups(retention) {
  if (!Number.isFinite(retention) || retention <= 0) return [];
  const doomed = listBackups().slice(retention);
  for (const b of doomed) {
    rmSync(join(backupsDir(), b.id), { recursive: true, force: true });
  }
  return doomed.map(b => b.id);
}
