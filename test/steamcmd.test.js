import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProgress, readInstalledBuild, isInstalled, VALHEIM_APP_ID, STEAMCMD_URL
} from '../src/steamcmd.js';

test('the app id is the Valheim dedicated server', () => {
  assert.equal(VALHEIM_APP_ID, '896660');
});

test('the download url is over https', () => {
  assert.ok(STEAMCMD_URL.startsWith('https://'));
});

test('parses a percentage from a downloading line', () => {
  const r = parseProgress(' Update state (0x61) downloading, progress: 42.15 (1234 / 5678)');
  assert.equal(Math.round(r.percent), 42);
});

test('parses a percentage from a verifying line', () => {
  const r = parseProgress(' Update state (0x81) verifying update, progress: 7.00 (1 / 2)');
  assert.equal(Math.round(r.percent), 7);
});

test('returns a null percent for a non-progress line', () => {
  assert.equal(parseProgress('Logging in user ... OK').percent, null);
});

test('recognises success as complete', () => {
  const r = parseProgress(`Success! App '896660' fully installed.`);
  assert.equal(r.percent, 100);
  assert.equal(r.done, true);
});

test('keeps the original text', () => {
  const line = 'Logging in user ... OK';
  assert.equal(parseProgress(line).text, line);
});

// The manifest fixture below is the real one written by the install on
// 2026-09-07, trimmed to the fields we read.
function installDirWithManifest(body) {
  const dir = mkdtempSync(join(tmpdir(), 'vh-install-'));
  mkdirSync(join(dir, 'steamapps'), { recursive: true });
  writeFileSync(join(dir, 'steamapps', `appmanifest_${VALHEIM_APP_ID}.acf`), body);
  return dir;
}

const REAL_MANIFEST = `"AppState"
{
	"appid"		"896660"
	"name"		"Valheim Dedicated Server"
	"LastUpdated"		"1788813331"
	"buildid"		"21981590"
}`;

test('reads the build id from a real app manifest', () => {
  const dir = installDirWithManifest(REAL_MANIFEST);
  assert.equal(readInstalledBuild(dir).buildid, '21981590');
});

test('converts LastUpdated from unix seconds to milliseconds', () => {
  const dir = installDirWithManifest(REAL_MANIFEST);
  assert.equal(readInstalledBuild(dir).lastUpdated, 1788813331 * 1000);
});

test('returns nulls rather than throwing when the manifest is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-nomanifest-'));
  assert.deepEqual(readInstalledBuild(dir), { buildid: null, lastUpdated: null });
});

test('returns nulls rather than throwing when the manifest is malformed', () => {
  const dir = installDirWithManifest('this is not an acf file at all');
  assert.deepEqual(readInstalledBuild(dir), { buildid: null, lastUpdated: null });
});

test('isInstalled is true only when the server exe is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-exe-'));
  assert.equal(isInstalled(dir), false);
  writeFileSync(join(dir, 'valheim_server.exe'), 'stub');
  assert.equal(isInstalled(dir), true);
});

test('isInstalled is false for an unset install dir', () => {
  assert.equal(isInstalled(''), false);
  assert.equal(isInstalled(undefined), false);
});
