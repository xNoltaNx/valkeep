/**
 * Valheim's three access lists.
 *
 * These are plain text files in the base save directory, one Platform User ID
 * per line, and the game ships them with a `//` comment header. That header is
 * preserved on every write: it is the only in-file documentation the operator
 * has, and clobbering someone's own comments would be rude.
 *
 * This is the whole of per-player control that a dedicated server exposes.
 * Inventory, skills and position live in the player's own character file on
 * their own PC and are not visible here - see README.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LISTS = {
  admin: {
    file: 'adminlist.txt',
    label: 'Admin',
    help: 'Opens the in-game console (F5): kick, ban, spawn, no-clip.'
  },
  banned: {
    file: 'bannedlist.txt',
    label: 'Banned',
    help: 'Blocked from the server.'
  },
  permitted: {
    file: 'permittedlist.txt',
    label: 'Allowed',
    help: 'While anyone is on this list, everyone not on it is blocked.'
  }
};

const isComment = line => line.trim().startsWith('//');
const isBlank = line => line.trim() === '';

export function listPath(saveDir, list) {
  const spec = LISTS[list];
  if (!spec) throw new Error(`Unknown access list: ${list}`);
  return join(saveDir, spec.file);
}

/** The IDs on a list, with the file's comment lines kept separately. */
export function readList(saveDir, list) {
  const path = listPath(saveDir, list);
  if (!existsSync(path)) return { ids: [], comments: [] };

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ids: [], comments: [] };
  }

  const lines = text.split(/\r?\n/);
  return {
    ids: lines.filter(l => !isComment(l) && !isBlank(l)).map(l => l.trim()),
    comments: lines.filter(isComment)
  };
}

export function readAll(saveDir) {
  return Object.fromEntries(
    Object.keys(LISTS).map(list => [list, readList(saveDir, list).ids])
  );
}

function writeList(saveDir, list, ids, comments) {
  const body = [...comments, ...ids].join('\n');
  writeFileSync(listPath(saveDir, list), body + '\n', 'utf8');
}

/**
 * Platform User IDs are `[Platform]_[UserID]` for console players, or a bare
 * SteamID64 on a Steam-only server. Both are validated loosely on purpose:
 * new platforms will appear and rejecting an unfamiliar prefix would lock the
 * operator out of adding a legitimate player.
 */
export function isValidId(id) {
  return typeof id === 'string'
    && id.trim().length > 0
    && id.length <= 128
    && !id.includes('\n')
    && !id.includes('\r')
    && !id.trim().startsWith('//');
}

export function setMembership(saveDir, list, id, member) {
  if (!LISTS[list]) throw new Error(`Unknown access list: ${list}`);
  if (!isValidId(id)) throw new Error(`"${id}" is not a usable player ID.`);

  const clean = id.trim();
  const { ids, comments } = readList(saveDir, list);
  const present = ids.includes(clean);

  if (member && !present) ids.push(clean);
  if (!member && present) {
    for (let i = ids.length - 1; i >= 0; i--) if (ids[i] === clean) ids.splice(i, 1);
  }

  const header = comments.length
    ? comments
    : [`// List ${list} players ID  ONE per line`];

  writeList(saveDir, list, ids, header);
  return { list, id: clean, member };
}
