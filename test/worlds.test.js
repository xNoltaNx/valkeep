import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorlds, worldNameFor } from '../src/worlds.js';

test('reduces current-format files to their world', () => {
  assert.equal(worldNameFor('Dedicated.db'), 'Dedicated');
  assert.equal(worldNameFor('Dedicated.fwl'), 'Dedicated');
  assert.equal(worldNameFor('Dedicated.fwl.old'), 'Dedicated');
});

test("reduces Valheim's own backups to their world", () => {
  assert.equal(worldNameFor('Dedicated_backup_auto-20260907133550.fwl'), 'Dedicated');
});

test('leaves a folder-style world name alone', () => {
  assert.equal(worldNameFor('Dedicated'), 'Dedicated');
});

function saveDir() {
  const dir = mkdtempSync(join(tmpdir(), 'vh-worlds-'));
  writeFileSync(join(dir, 'Midgard.db'), 'x');
  writeFileSync(join(dir, 'Midgard.fwl'), 'x');
  writeFileSync(join(dir, 'Midgard.fwl.old'), 'x');
  writeFileSync(join(dir, 'Midgard_backup_auto-20260907133550.fwl'), 'x');
  writeFileSync(join(dir, 'Asgard.fwl'), 'x');
  return dir;
}

test('lists every distinct world once', () => {
  const names = listWorlds(saveDir()).map(w => w.name).sort();
  assert.deepEqual(names, ['Asgard', 'Midgard']);
});

test('counts all files belonging to a world', () => {
  const midgard = listWorlds(saveDir()).find(w => w.name === 'Midgard');
  assert.equal(midgard.files, 4);
});

test('marks a world with a primary save file as playable', () => {
  for (const w of listWorlds(saveDir())) assert.equal(w.hasSave, true, w.name);
});

test('flags a backup-only leftover as not playable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-orphan-'));
  writeFileSync(join(dir, 'Ghost_backup_auto-20260101000000.fwl'), 'x');
  const ghost = listWorlds(dir).find(w => w.name === 'Ghost');
  assert.equal(ghost.hasSave, false, 'a world with only backups must not look playable');
});

test('detects a folder-style world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-folder-'));
  mkdirSync(join(dir, 'Vanaheim'));
  writeFileSync(join(dir, 'Vanaheim', 'meta.json'), '{}');
  const found = listWorlds(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Vanaheim');
  assert.equal(found[0].hasSave, true);
});

test('returns empty for a missing directory rather than throwing', () => {
  assert.deepEqual(listWorlds(join(tmpdir(), 'nope-not-here-3f9')), []);
});

test('returns empty for an unset directory', () => {
  assert.deepEqual(listWorlds(''), []);
  assert.deepEqual(listWorlds(undefined), []);
});

test('sorts most recently modified first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-order-'));
  writeFileSync(join(dir, 'Older.fwl'), 'x');
  await new Promise(r => setTimeout(r, 20));
  writeFileSync(join(dir, 'Newer.fwl'), 'x');
  assert.equal(listWorlds(dir)[0].name, 'Newer');
});
