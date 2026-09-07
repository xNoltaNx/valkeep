import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LISTS, readList, readAll, setMembership, isValidId, listPath } from '../src/access.js';

// The header Valheim actually ships in these files, captured from a real
// install on 2026-09-07.
const SHIPPED_HEADER = '// List admin players ID  ONE per line';

function saveDir({ withFiles = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vh-access-'));
  if (withFiles) {
    writeFileSync(join(dir, 'adminlist.txt'), SHIPPED_HEADER + '\n');
    writeFileSync(join(dir, 'bannedlist.txt'), '// List banned players ID  ONE per line\n');
    writeFileSync(join(dir, 'permittedlist.txt'), '// List permitted players ID ONE per line\n');
  }
  return dir;
}

test('names the three files Valheim actually reads', () => {
  assert.equal(LISTS.admin.file, 'adminlist.txt');
  assert.equal(LISTS.banned.file, 'bannedlist.txt');
  assert.equal(LISTS.permitted.file, 'permittedlist.txt');
});

test('an untouched list reads as empty, not as its comment', () => {
  const dir = saveDir();
  assert.deepEqual(readList(dir, 'admin').ids, []);
});

test('a missing file reads as empty rather than throwing', () => {
  assert.deepEqual(readList(saveDir({ withFiles: false }), 'admin').ids, []);
});

test('adds an ID', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '76561198012345678', true);
  assert.deepEqual(readList(dir, 'admin').ids, ['76561198012345678']);
});

test('preserves the shipped comment header on write', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '76561198012345678', true);
  const text = readFileSync(listPath(dir, 'admin'), 'utf8');
  assert.ok(text.includes(SHIPPED_HEADER), 'the operator-facing comment must survive');
});

test("preserves an operator's own added comments", () => {
  const dir = saveDir();
  writeFileSync(listPath(dir, 'admin'), `${SHIPPED_HEADER}\n// Sigrun said add Bjorn\n`);
  setMembership(dir, 'admin', '111', true);
  const text = readFileSync(listPath(dir, 'admin'), 'utf8');
  assert.ok(text.includes('// Sigrun said add Bjorn'));
});

test('removes an ID', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '111', true);
  setMembership(dir, 'admin', '222', true);
  setMembership(dir, 'admin', '111', false);
  assert.deepEqual(readList(dir, 'admin').ids, ['222']);
});

test('adding twice does not duplicate', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '111', true);
  setMembership(dir, 'admin', '111', true);
  assert.deepEqual(readList(dir, 'admin').ids, ['111']);
});

test('removing an absent ID is harmless', () => {
  const dir = saveDir();
  assert.doesNotThrow(() => setMembership(dir, 'admin', '999', false));
  assert.deepEqual(readList(dir, 'admin').ids, []);
});

test('handles console platform IDs', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', 'Xbox_2535467890123456', true);
  assert.deepEqual(readList(dir, 'admin').ids, ['Xbox_2535467890123456']);
});

test('creates the file when Valheim has not yet', () => {
  const dir = saveDir({ withFiles: false });
  setMembership(dir, 'banned', '111', true);
  assert.ok(existsSync(listPath(dir, 'banned')));
  assert.deepEqual(readList(dir, 'banned').ids, ['111']);
});

test('readAll reports all three lists at once', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '111', true);
  setMembership(dir, 'banned', '222', true);
  assert.deepEqual(readAll(dir), { admin: ['111'], banned: ['222'], permitted: [] });
});

test('rejects an unknown list', () => {
  assert.throws(() => setMembership(saveDir(), 'wizards', '111', true), /Unknown access list/);
});

test('rejects an ID that would forge a new line', () => {
  assert.equal(isValidId('111\n222'), false);
  assert.throws(() => setMembership(saveDir(), 'admin', '111\n222', true), /not a usable/);
});

test('rejects an ID that would forge a comment', () => {
  assert.equal(isValidId('// not an id'), false);
});

test('rejects an empty ID', () => {
  assert.equal(isValidId('   '), false);
  assert.equal(isValidId(''), false);
});

test('accepts both a bare SteamID64 and a platform-prefixed ID', () => {
  assert.equal(isValidId('76561198012345678'), true);
  assert.equal(isValidId('Xbox_2535467890123456'), true);
});

test('trims surrounding whitespace when storing', () => {
  const dir = saveDir();
  setMembership(dir, 'admin', '  111  ', true);
  assert.deepEqual(readList(dir, 'admin').ids, ['111']);
});
