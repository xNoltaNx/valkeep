import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoster } from '../src/roster.js';

// A temp file per roster keeps the suite off the operator's real players.json,
// in both directions: nothing is read from it and nothing is written to it.
const fresh = () => createRoster({
  load: false,
  file: join(mkdtempSync(join(tmpdir(), 'vh-roster-')), 'players.json')
});

const CONNECT = id => ({ type: 'connected', id });
const NAME = (name, zdo = '12345') => ({ type: 'character', name, zdo, isDeath: zdo === '0' });
const LEAVE = id => ({ type: 'disconnected', id });
const HEARTBEAT = players => ({ type: 'heartbeat', players: String(players) });

test('records a player from a connection', () => {
  const r = fresh();
  r.apply([CONNECT('111')]);
  const [p] = r.list();
  assert.equal(p.id, '111');
  assert.equal(p.online, true);
  assert.equal(p.sessions, 1);
});

test('pairs a character name with the pending connection', () => {
  const r = fresh();
  r.apply([CONNECT('111'), NAME('Sigrun')]);
  const [p] = r.list();
  assert.equal(p.name, 'Sigrun');
  assert.equal(p.nameConfidence, 'inferred', 'the pairing is a heuristic and must say so');
});

test('a death never renames anyone', () => {
  const r = fresh();
  r.apply([CONNECT('111'), NAME('Sigrun')]);
  r.apply([CONNECT('222'), NAME('Sigrun', '0')]);
  const byId = Object.fromEntries(r.list().map(p => [p.id, p]));
  assert.equal(byId['111'].name, 'Sigrun');
  assert.equal(byId['222'].name, null, 'a death line must not be consumed as a name');
});

test('a name with no pending connection is dropped rather than mis-assigned', () => {
  const r = fresh();
  r.apply([CONNECT('111'), NAME('Sigrun')]);
  r.apply([NAME('Ghost')]);   // a respawn, not a join
  const [p] = r.list();
  assert.equal(p.name, 'Sigrun', 'an existing player must not be renamed by a respawn');
  assert.equal(r.list().length, 1);
});

test('pairs two joins in order', () => {
  const r = fresh();
  r.apply([CONNECT('111'), CONNECT('222'), NAME('First'), NAME('Second')]);
  const byId = Object.fromEntries(r.list().map(p => [p.id, p]));
  assert.equal(byId['111'].name, 'First');
  assert.equal(byId['222'].name, 'Second');
});

test('marks a player offline on disconnect but keeps the record', () => {
  const r = fresh();
  r.apply([CONNECT('111'), NAME('Sigrun'), LEAVE('111')]);
  const [p] = r.list();
  assert.equal(p.online, false);
  assert.equal(p.name, 'Sigrun', 'history survives leaving');
});

test('counts repeat sessions rather than duplicating the player', () => {
  const r = fresh();
  r.apply([CONNECT('111'), LEAVE('111'), CONNECT('111')]);
  assert.equal(r.list().length, 1);
  assert.equal(r.list()[0].sessions, 2);
});

test('a zero-player heartbeat clears everyone online', () => {
  const r = fresh();
  r.apply([CONNECT('111'), CONNECT('222')]);
  assert.equal(r.list().filter(p => p.online).length, 2);
  r.apply([HEARTBEAT(0)]);
  assert.equal(r.list().filter(p => p.online).length, 0, 'the server said nobody is on');
});

test('a stale pending name does not attach after everyone left', () => {
  const r = fresh();
  r.apply([CONNECT('111')]);
  r.apply([HEARTBEAT(0)]);
  r.apply([NAME('Latecomer')]);
  assert.equal(r.list()[0].name, null);
});

test('online players sort before offline ones', () => {
  const r = fresh();
  r.apply([CONNECT('111'), LEAVE('111')]);
  r.apply([CONNECT('222')]);
  assert.equal(r.list()[0].id, '222');
});

test('ignores events with no id', () => {
  const r = fresh();
  assert.doesNotThrow(() => r.apply([CONNECT(undefined), LEAVE(undefined), NAME(undefined)]));
  assert.equal(r.list().length, 0);
});

test('forget removes a player', () => {
  const r = fresh();
  r.apply([CONNECT('111')]);
  assert.equal(r.forget('111'), true);
  assert.equal(r.list().length, 0);
  assert.equal(r.forget('111'), false);
});

test('records first and last seen', () => {
  const r = fresh();
  r.apply([CONNECT('111')]);
  const [p] = r.list();
  assert.ok(p.firstSeen > 0);
  assert.ok(p.lastSeen >= p.firstSeen);
});

// On crossplay there is no "Got connection SteamID" line, so the roster
// learned nothing about real players. Captured 2026-09-07.
const PLATFORM = id => ({ type: 'platformId', id, socket: 'playfab/D63284D33385051A' });

test('identifies a crossplay player by Platform User ID', () => {
  const r = fresh();
  r.apply([PLATFORM('Steam_76561190000000002'), NAME('Kettil', '-359821990')]);
  const [p] = r.list();
  assert.equal(p.id, 'Steam_76561190000000002');
  assert.equal(p.name, 'Kettil');
  assert.equal(p.online, true);
});

test('the recorded id is the one the access lists use', () => {
  const r = fresh();
  r.apply([PLATFORM('Steam_76561190000000002')]);
  assert.match(r.list()[0].id, /^[A-Za-z]+_\d+$/,
    'must be [Platform]_[UserID], not a playfab socket id');
});

test('a zero count from a real join line clears everyone', () => {
  const r = fresh();
  r.apply([PLATFORM('Steam_1'), NAME('Kettil')]);
  r.apply([{ type: 'nowPlayers', players: '0', code: '055286' }]);
  assert.equal(r.list().filter(p => p.online).length, 0);
});
