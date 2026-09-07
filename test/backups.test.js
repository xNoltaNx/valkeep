import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  findWorldEntries, createBackup, listBackups, restoreBackup, pruneBackups
} from '../src/backups.js';
import { backupsDir } from '../src/paths.js';

// Backups land in the real data/backups dir (gitignored). Track and remove
// whatever a test creates so the suite is repeatable.
const created = [];
const track = meta => { created.push(meta.id); return meta; };

afterEach(() => {
  while (created.length) {
    rmSync(join(backupsDir(), created.pop()), { recursive: true, force: true });
  }
});

// Layout A: the current format, including the sibling files a real server
// writes - captured from the probe, see docs/shutdown-probe.md.
function pairLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'vh-pair-'));
  writeFileSync(join(dir, 'Dedicated.db'), 'dbdata');
  writeFileSync(join(dir, 'Dedicated.fwl'), 'fwldata');
  writeFileSync(join(dir, 'Dedicated.fwl.old'), 'olddata');
  writeFileSync(join(dir, 'Dedicated_backup_auto-20260907133550.fwl'), 'autobak');
  writeFileSync(join(dir, 'OtherWorld.db'), 'nope');
  return dir;
}

// Layout B: the rewritten format - a directory of pieces.
function folderLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'vh-folder-'));
  mkdirSync(join(dir, 'Dedicated'));
  writeFileSync(join(dir, 'Dedicated', 'meta.json'), '{}');
  mkdirSync(join(dir, 'Dedicated', 'chunks'));
  writeFileSync(join(dir, 'Dedicated', 'chunks', 'c0.bin'), 'x');
  mkdirSync(join(dir, 'OtherWorld'));
  return dir;
}

// Wrap basename: map() passes the index as its `suffix` argument.
const names = paths => paths.map(p => basename(p)).sort();

test('finds the .db/.fwl pair in the current format', () => {
  const found = names(findWorldEntries(pairLayout(), 'Dedicated'));
  assert.ok(found.includes('Dedicated.db'));
  assert.ok(found.includes('Dedicated.fwl'));
});

test('finds the world directory in the rewritten format', () => {
  assert.deepEqual(names(findWorldEntries(folderLayout(), 'Dedicated')), ['Dedicated']);
});

test("captures Valheim's own underscore-separated auto backups", () => {
  const found = names(findWorldEntries(pairLayout(), 'Dedicated'));
  assert.ok(found.includes('Dedicated_backup_auto-20260907133550.fwl'));
});

test('captures rolling .old files', () => {
  const found = names(findWorldEntries(pairLayout(), 'Dedicated'));
  assert.ok(found.includes('Dedicated.fwl.old'));
});

test('does not capture a different world', () => {
  const found = names(findWorldEntries(pairLayout(), 'Dedicated'));
  assert.ok(!found.some(n => n.startsWith('OtherWorld')));
});

test('a shorter world name does not match a longer one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-prefix-'));
  writeFileSync(join(dir, 'ProbeWorld.db'), 'x');
  assert.deepEqual(findWorldEntries(dir, 'Probe'), []);
});

test('returns empty for an unknown world rather than throwing', () => {
  assert.deepEqual(findWorldEntries(pairLayout(), 'NoSuchWorld'), []);
});

test('returns empty for a missing save directory rather than throwing', () => {
  assert.deepEqual(findWorldEntries(join(tmpdir(), 'definitely-not-here-9f2'), 'Dedicated'), []);
});

test('round-trips the current format through backup and restore', async () => {
  const dir = pairLayout();
  const meta = track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label: 'ta' }));
  assert.equal(meta.entryCount, 4);

  writeFileSync(join(dir, 'Dedicated.db'), 'CORRUPTED');
  await restoreBackup(meta.id, { saveDir: dir, worldName: 'Dedicated' });
  assert.equal(readFileSync(join(dir, 'Dedicated.db'), 'utf8'), 'dbdata');
});

test('round-trips the rewritten format through backup and restore', async () => {
  const dir = folderLayout();
  const meta = track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label: 'tb' }));
  assert.equal(meta.entryCount, 1);
  assert.equal(meta.fileCount, 2, 'must recurse into the world folder');

  rmSync(join(dir, 'Dedicated'), { recursive: true, force: true });
  await restoreBackup(meta.id, { saveDir: dir, worldName: 'Dedicated' });
  assert.equal(readFileSync(join(dir, 'Dedicated', 'chunks', 'c0.bin'), 'utf8'), 'x');
});

test('refuses to record an empty backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-empty-'));
  await assert.rejects(
    () => createBackup({ saveDir: dir, worldName: 'Dedicated' }),
    /captured nothing/i
  );
});

test('an empty backup leaves nothing behind on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-empty2-'));
  const before = existsSync(backupsDir()) ? readdirSync(backupsDir()).length : 0;
  await assert.rejects(() => createBackup({ saveDir: dir, worldName: 'Dedicated' }));
  const after = existsSync(backupsDir()) ? readdirSync(backupsDir()).length : 0;
  assert.equal(after, before);
});

test('restore snapshots the current world first', async () => {
  const dir = pairLayout();
  const meta = track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label: 'tc' }));
  writeFileSync(join(dir, 'Dedicated.db'), 'LATER STATE');

  const { safetyBackupId } = await restoreBackup(meta.id, { saveDir: dir, worldName: 'Dedicated' });
  track({ id: safetyBackupId });
  assert.ok(safetyBackupId, 'a pre-restore snapshot must be taken');

  // The state that was overwritten is itself recoverable.
  await restoreBackup(safetyBackupId, { saveDir: dir, worldName: 'Dedicated' });
  assert.equal(readFileSync(join(dir, 'Dedicated.db'), 'utf8'), 'LATER STATE');
});

test('restore rejects an unknown id', async () => {
  await assert.rejects(
    () => restoreBackup('no-such-backup', { saveDir: tmpdir(), worldName: 'Dedicated' }),
    /No such backup/
  );
});

test('listBackups returns newest first', async () => {
  const dir = pairLayout();
  const a = track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label: 'old' }));
  await new Promise(r => setTimeout(r, 5));
  const b = track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label: 'new' }));

  const ids = listBackups().map(x => x.id);
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
});

test('pruneBackups keeps only the retention count', async () => {
  const dir = pairLayout();
  for (const label of ['p1', 'p2', 'p3']) {
    track(await createBackup({ saveDir: dir, worldName: 'Dedicated', label }));
    await new Promise(r => setTimeout(r, 5));
  }
  const total = listBackups().length;
  const removed = pruneBackups(total - 1);
  assert.equal(removed.length, 1);
  assert.equal(listBackups().length, total - 1);
});

test('pruneBackups is a no-op for a nonsense retention', () => {
  assert.deepEqual(pruneBackups(0), []);
  assert.deepEqual(pruneBackups(-1), []);
});
