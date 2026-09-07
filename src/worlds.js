/**
 * Discovers worlds already on disk.
 *
 * The world field used to be free text, which made a typo silently generate a
 * brand-new empty world - the old one still on disk, but the player spawning
 * into unfamiliar terrain. Listing what exists removes that trap.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reduces a save-directory entry to the world it belongs to.
 *   Dedicated.db                              -> Dedicated
 *   Dedicated.fwl.old                         -> Dedicated
 *   Dedicated_backup_auto-20260907133550.fwl  -> Dedicated
 *   Dedicated            (folder-style save)  -> Dedicated
 */
export function worldNameFor(entry) {
  const base = entry.split('.')[0];
  const cut = base.indexOf('_backup_');
  return cut === -1 ? base : base.slice(0, cut);
}

export function listWorlds(saveDir) {
  if (!saveDir || !existsSync(saveDir)) return [];

  let entries;
  try {
    entries = readdirSync(saveDir);
  } catch {
    return [];
  }

  const worlds = new Map();
  for (const entry of entries) {
    const name = worldNameFor(entry);
    if (!name) continue;

    if (!worlds.has(name)) {
      worlds.set(name, { name, files: 0, hasSave: false, modifiedAt: 0 });
    }
    const world = worlds.get(name);
    world.files += 1;

    // A world is playable if it has a primary artifact: a .db/.fwl under the
    // current format, or a directory under the rewritten one. Backup-only
    // leftovers are listed but flagged, never silently offered as a world.
    const isBackup = entry.includes('_backup_') || entry.endsWith('.old');
    let isDir = false;
    let mtime = 0;
    try {
      const st = statSync(join(saveDir, entry));
      isDir = st.isDirectory();
      mtime = st.mtimeMs;
    } catch {
      continue;
    }
    if (isDir || (!isBackup && /\.(db|fwl)$/i.test(entry))) world.hasSave = true;
    if (mtime > world.modifiedAt) world.modifiedAt = mtime;
  }

  return [...worlds.values()].sort((a, b) => b.modifiedAt - a.modifiedAt);
}
