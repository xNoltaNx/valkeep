import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createParser } from '../src/parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const patterns = JSON.parse(
  readFileSync(join(here, '..', 'config.example.json'), 'utf8')
).logPatterns;

const lines = name =>
  readFileSync(join(here, 'fixtures', name), 'utf8').split(/\r?\n/).filter(Boolean);

function feedAll(file = 'sample.log') {
  const parser = createParser(patterns);
  const events = [];
  for (const line of lines(file)) events.push(...parser.feed(line));
  return { parser, events };
}

test('extracts the join code', () => {
  const { events } = feedAll();
  assert.equal(events.find(e => e.type === 'joinCode').code, '860226');
});

test('extracts a player name from a character line', () => {
  const { events } = feedAll();
  assert.equal(events.find(e => e.type === 'character').name, 'Sigrun');
});

test('a death ZDOID line does not produce a join event', () => {
  const p = createParser(patterns);
  const events = p.feed('09/07/2026 10:05:00: Got character ZDOID from Sigrun : 0:0');
  assert.ok(
    !events.some(e => e.type === 'connected'),
    'a character line must never be reported as a connection'
  );
  assert.equal(events[0].type, 'character');
  assert.equal(events[0].zdo, '0');
});

test('distinguishes spawn from death by the zdo field', () => {
  const p = createParser(patterns);
  assert.equal(p.feed('Got character ZDOID from Sigrun : 12345:1')[0].isDeath, false);
  assert.equal(p.feed('Got character ZDOID from Sigrun : 0:0')[0].isDeath, true);
});

test('a death does not remove the player from the name list', () => {
  const p = createParser(patterns);
  p.feed('Got character ZDOID from Sigrun : 12345:1');
  p.feed('Got character ZDOID from Sigrun : 0:0');
  assert.deepEqual(p.snapshot().players, ['Sigrun']);
});

test('reports connect and disconnect events', () => {
  const { events } = feedAll();
  assert.ok(events.some(e => e.type === 'connected' && e.id === '76561198012345678'));
  assert.ok(events.some(e => e.type === 'disconnected' && e.id === '76561198012345678'));
});

test('tracks open sockets across connect and disconnect', () => {
  const p = createParser(patterns);
  p.feed('Got connection SteamID 111');
  p.feed('Got connection SteamID 222');
  assert.equal(p.snapshot().openSockets, 2);
  p.feed('Closing socket 111');
  assert.equal(p.snapshot().openSockets, 1);
});

test('prefers the session count when it is the most recent signal', () => {
  const { parser } = feedAll();
  const snap = parser.snapshot();
  assert.equal(snap.playerCount, 0);
  assert.equal(snap.playerCountSource, 'session');
});

test('falls back to connection bookkeeping when it is more recent', () => {
  const p = createParser(patterns);
  p.feed('Session "S" with join code 111111 and IP 1.2.3.4:2456 is active with 0 player(s)');
  p.feed('Got connection SteamID 999');
  const snap = p.snapshot();
  assert.equal(snap.playerCount, 1);
  assert.equal(snap.playerCountSource, 'connections');
});

test('uses connection bookkeeping when no session line has been seen', () => {
  const p = createParser(patterns);
  p.feed('Got connection SteamID 999');
  assert.equal(p.snapshot().playerCountSource, 'connections');
});

test('records the last world save', () => {
  const { parser } = feedAll();
  assert.ok(parser.snapshot().lastSaveAt !== null);
});

test('unmatched lines produce no events', () => {
  const p = createParser(patterns);
  assert.deepEqual(p.feed('09/07/2026 10:00:01: Zonesystem Start 1'), []);
});

test('a malformed pattern does not throw and does not disable the others', () => {
  const p = createParser({ broken: '([unclosed', worldSaved: 'World saved' });
  assert.doesNotThrow(() => p.feed('anything at all'));
  assert.equal(p.feed('World saved ( 1ms )')[0].type, 'worldSaved');
});

// Regression fixtures taken verbatim from a real server, not from memory.
// See docs/shutdown-probe.md.

test('parses the real world-save line', () => {
  const p = createParser(patterns);
  const e = p.feed('09/07/2026 13:39:44: World saved ( 14.5236ms )');
  assert.equal(e[0].type, 'worldSaved');
  assert.equal(e[0].ms, '14.5236');
});

test('parses the real join-code registration line', () => {
  const p = createParser(patterns);
  const e = p.feed('09/07/2026 13:40:25: Session "ProbeTest" registered with join code 167812');
  assert.equal(e[0].code, '167812');
  assert.equal(p.snapshot().joinCode, '167812');
});

test('parses the real session-activation line', () => {
  const p = createParser(patterns);
  p.feed('09/07/2026 13:40:27: Session "ProbeTest" with join code 167812 and IP 203.0.113.10:2456 is active with 0 player(s)');
  const snap = p.snapshot();
  assert.equal(snap.joinCode, '167812');
  assert.equal(snap.playerCount, 0);
});

test('parses the real session-creation line, whose join code is still empty', () => {
  const p = createParser(patterns);
  const e = p.feed('09/07/2026 13:40:24: New session server "ProbeTest" that has join code , now 0 player(s)');
  assert.equal(e[0].type, 'sessionNew');
  assert.equal(e[0].players, '0');
  // An empty code must not overwrite a real one recorded earlier.
  assert.equal(p.snapshot().joinCode, null);
});

test('an empty join code never clobbers a known one', () => {
  const p = createParser(patterns);
  p.feed('Session "S" registered with join code 167812');
  p.feed('New session server "S" that has join code , now 0 player(s)');
  assert.equal(p.snapshot().joinCode, '167812');
});

test('runs over a full real server log without throwing', () => {
  const p = createParser(patterns);
  assert.doesNotThrow(() => {
    for (const line of lines('real-crossplay-startup.log')) p.feed(line);
  });
  assert.equal(p.snapshot().joinCode, '167812');
});

test('captures the public address the server reports for itself', () => {
  const p = createParser(patterns);
  p.feed('This is the serverIP used to register the server: 203.0.113.10:2456');
  assert.equal(p.snapshot().publicAddress, '203.0.113.10:2456');
});

test('public address is null until the server reports one', () => {
  assert.equal(createParser(patterns).snapshot().publicAddress, null);
});
