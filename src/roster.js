/**
 * Who has played on this server.
 *
 * Valheim has no player API, so this is assembled from log lines. Two separate
 * lines carry the two halves of a player's identity:
 *
 *   Got connection SteamID 76561198...      -> the platform ID
 *   Got character ZDOID from Sigrun : 12345:1 -> the display name
 *
 * They arrive in that order, a moment apart, with nothing linking them. So the
 * pairing here is a heuristic: a character name is attached to the most recent
 * connection that does not have a name yet. That is right in the ordinary case
 * and can mis-pair when two people join in the same instant, which is why every
 * record carries `nameConfidence` and the UI says so rather than presenting the
 * pairing as fact.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataDir } from './paths.js';
import { dirname, join } from 'node:path';

const FILE = () => join(dataDir(), 'players.json');

export function createRoster({ load = true, file = null } = {}) {
  // The path is injectable so tests never write to the operator's real roster.
  // An earlier version persisted to the live file from the suite, which put a
  // fabricated player into real data.
  const path = file ?? FILE();

  /** id -> { id, name, nameConfidence, firstSeen, lastSeen, sessions } */
  let players = new Map();
  let online = new Set();
  let awaitingName = [];   // connection ids that have not been named yet

  if (load) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      players = new Map(saved.map(p => [p.id, p]));
    } catch {
      // No roster yet, or an unreadable one. Starting empty is correct.
    }
  }

  function persist() {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify([...players.values()], null, 2), 'utf8');
    } catch {
      // The roster is a convenience; failing to save it must not break the panel.
    }
  }

  function connected(id) {
    if (!id) return;
    const now = Date.now();
    const existing = players.get(id);
    if (existing) {
      existing.lastSeen = now;
      existing.sessions = (existing.sessions ?? 0) + 1;
    } else {
      players.set(id, {
        id, name: null, nameConfidence: 'none',
        firstSeen: now, lastSeen: now, sessions: 1
      });
    }
    online.add(id);
    awaitingName.push(id);
    persist();
  }

  function named(name) {
    if (!name) return;
    const id = awaitingName.shift();
    if (!id) {
      // A character spawned with no unnamed connection pending - a respawn, or
      // a name seen after a panel restart. Nothing to attach it to.
      return;
    }
    const player = players.get(id);
    if (!player) return;
    player.name = name;
    player.nameConfidence = 'inferred';
    player.lastSeen = Date.now();
    persist();
  }

  function disconnected(id) {
    if (!id) return;
    online.delete(id);
    awaitingName = awaitingName.filter(pending => pending !== id);
    const player = players.get(id);
    if (player) {
      player.lastSeen = Date.now();
      persist();
    }
  }

  /** The server reporting zero players is the one authoritative "nobody is on". */
  function allOffline() {
    online.clear();
    awaitingName = [];
  }

  function apply(events) {
    for (const event of events) {
      // On crossplay there is no "Got connection SteamID" line at all. The
      // Platform ID line is the only place a real player id appears, and it is
      // the id the access lists use, so it is the preferred identity.
      if (event.type === 'platformId') connected(event.id);
      else if (event.type === 'connected') connected(event.id);
      else if (event.type === 'character' && !event.isDeath) named(event.name);
      else if (event.type === 'disconnected') disconnected(event.id);
      else if ((event.type === 'heartbeat' || event.type === 'nowPlayers')
        && Number(event.players) === 0) allOffline();
    }
  }

  function list() {
    return [...players.values()]
      .map(p => ({ ...p, online: online.has(p.id) }))
      .sort((a, b) => (b.online - a.online) || (b.lastSeen - a.lastSeen));
  }

  function forget(id) {
    const had = players.delete(id);
    online.delete(id);
    if (had) persist();
    return had;
  }

  return { apply, connected, named, disconnected, allOffline, list, forget };
}
