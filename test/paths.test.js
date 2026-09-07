import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, basename } from 'node:path';
import { ROOT, dataDir, backupsDir, logsDir, stateFile, configFile, toolsDir } from '../src/paths.js';

test('every path is absolute', () => {
  for (const p of [ROOT, dataDir(), backupsDir(), logsDir(), stateFile(), configFile(), toolsDir()]) {
    assert.ok(isAbsolute(p), `${p} should be absolute`);
  }
});

test('paths have the expected names', () => {
  assert.equal(basename(dataDir()), 'data');
  assert.equal(basename(backupsDir()), 'backups');
  assert.equal(basename(logsDir()), 'logs');
  assert.equal(basename(stateFile()), 'state.json');
  assert.equal(basename(configFile()), 'config.json');
  assert.equal(basename(toolsDir()), 'tools');
});

test('data-relative paths live under the data dir', () => {
  for (const p of [backupsDir(), logsDir(), stateFile()]) {
    assert.ok(p.startsWith(dataDir()), `${p} should be under ${dataDir()}`);
  }
});
