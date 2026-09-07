import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isValheimPid, readState, writeState, clearState, status } from '../src/process.js';

// Exactly the format a real tasklist emitted during the probe:
// "valheim_server.exe","67668","Console","1","1,096,096 K"
const csvFor = (image, pid) => `"${image}","${pid}","Console","1","1,096,096 K"\r\n`;
const NO_MATCH = 'INFO: No tasks are running which match the specified criteria.';

afterEach(() => clearState());

test('accepts a live pid whose image is valheim_server.exe', async () => {
  assert.equal(await isValheimPid(4242, async () => csvFor('valheim_server.exe', 4242)), true);
});

test('rejects a live pid running a different image (pid reuse)', async () => {
  assert.equal(await isValheimPid(4242, async () => csvFor('chrome.exe', 4242)), false);
});

test('rejects when tasklist reports no match', async () => {
  assert.equal(await isValheimPid(4242, async () => NO_MATCH), false);
});

test('rejects when tasklist throws', async () => {
  assert.equal(await isValheimPid(4242, async () => { throw new Error('unavailable'); }), false);
});

test('rejects a null, zero, or negative pid without calling tasklist', async () => {
  let called = false;
  const run = async () => { called = true; return ''; };
  assert.equal(await isValheimPid(null, run), false);
  assert.equal(await isValheimPid(0, run), false);
  assert.equal(await isValheimPid(-1, run), false);
  assert.equal(called, false, 'must not shell out for an obviously invalid pid');
});

test('matches the image name case-insensitively', async () => {
  assert.equal(await isValheimPid(7, async () => csvFor('Valheim_Server.EXE', 7)), true);
});

test('rejects empty tasklist output', async () => {
  assert.equal(await isValheimPid(7, async () => ''), false);
});

test('state round-trips', () => {
  writeState({ pid: 123, startedAt: 456, world: 'Dedicated' });
  assert.deepEqual(readState(), { pid: 123, startedAt: 456, world: 'Dedicated' });
});

test('readState returns null when there is no state file', () => {
  clearState();
  assert.equal(readState(), null);
});

test('clearState is safe to call twice', () => {
  writeState({ pid: 1, startedAt: 1 });
  clearState();
  assert.doesNotThrow(() => clearState());
});

test('status reports stopped when there is no state', async () => {
  clearState();
  // Stub the image list too: a test that consults the real machine is flaky.
  assert.deepEqual(await status({ runTasklist: async () => NO_MATCH, runImageList: async () => NO_MATCH }), {
    running: false, pid: null, startedAt: null, uptimeSeconds: 0, adopted: false
  });
});

test('status reports running and computes uptime', async () => {
  writeState({ pid: 4242, startedAt: Date.now() - 5000, world: 'Dedicated' });
  const s = await status({ runTasklist: async () => csvFor('valheim_server.exe', 4242) });
  assert.equal(s.running, true);
  assert.equal(s.pid, 4242);
  assert.equal(s.world, 'Dedicated');
  assert.ok(s.uptimeSeconds >= 4 && s.uptimeSeconds <= 7, `uptime was ${s.uptimeSeconds}`);
});

test('status clears stale state when the process is gone', async () => {
  writeState({ pid: 4242, startedAt: Date.now(), world: 'Dedicated' });
  const s = await status({ runTasklist: async () => NO_MATCH, runImageList: async () => NO_MATCH });
  assert.equal(s.running, false);
  assert.equal(readState(), null, 'stale state must be cleared, not left to mislead');
});

test('status treats a reused pid as stopped', async () => {
  writeState({ pid: 4242, startedAt: Date.now(), world: 'Dedicated' });
  const s = await status({ runTasklist: async () => csvFor('notepad.exe', 4242), runImageList: async () => NO_MATCH });
  assert.equal(s.running, false);
  assert.equal(readState(), null);
});

// An orphaned server - one left running by a previous panel session - used to
// be invisible: status said "stopped" while players were connected, and Start
// launched a second server that died instantly on the bound port.

const imageRows = (...pids) =>
  pids.map(p => `"valheim_server.exe","${p}","Console","1","1,161,052 K"`).join('\r\n') + '\r\n';

test('findServerPids reports every running server', async () => {
  const { findServerPids } = await import('../src/process.js');
  assert.deepEqual(await findServerPids(async () => imageRows(40812)), [40812]);
  assert.deepEqual(await findServerPids(async () => imageRows(1, 2)), [1, 2]);
});

test('findServerPids returns empty when none are running', async () => {
  const { findServerPids } = await import('../src/process.js');
  assert.deepEqual(await findServerPids(async () => NO_MATCH), []);
});

test('findServerPids survives tasklist throwing', async () => {
  const { findServerPids } = await import('../src/process.js');
  assert.deepEqual(await findServerPids(async () => { throw new Error('nope'); }), []);
});

test('findServerPids ignores rows for a different image', async () => {
  const { findServerPids } = await import('../src/process.js');
  const rows = '"notepad.exe","999","Console","1","1,000 K"\r\n';
  assert.deepEqual(await findServerPids(async () => rows), []);
});

test('status adopts an untracked server rather than reporting stopped', async () => {
  clearState();
  const s = await status({
    runTasklist: async () => NO_MATCH,
    runImageList: async () => imageRows(40812)
  });
  assert.equal(s.running, true, 'a live server must never be reported as stopped');
  assert.equal(s.pid, 40812);
  assert.equal(s.adopted, true);
  assert.equal(readState().pid, 40812, 'adoption must be recorded so stop can act on it');
});

test('status does not adopt when several servers are running', async () => {
  clearState();
  const s = await status({
    runTasklist: async () => NO_MATCH,
    runImageList: async () => imageRows(1, 2)
  });
  assert.equal(s.running, false, 'ambiguous ownership must not be guessed at');
});

test('an adopted server reports unknown uptime rather than a wrong one', async () => {
  clearState();
  await status({ runTasklist: async () => NO_MATCH, runImageList: async () => imageRows(40812) });
  const again = await status({
    runTasklist: async () => csvFor('valheim_server.exe', 40812),
    runImageList: async () => imageRows(40812)
  });
  assert.equal(again.running, true);
  assert.equal(again.uptimeSeconds, 0, 'we did not start it, so we cannot know its uptime');
});

test('status still prefers its own tracked pid over adoption', async () => {
  writeState({ pid: 555, startedAt: Date.now() - 3000, world: 'W' });
  const s = await status({
    runTasklist: async () => csvFor('valheim_server.exe', 555),
    runImageList: async () => imageRows(40812)
  });
  assert.equal(s.pid, 555);
  assert.equal(s.adopted, false);
});
