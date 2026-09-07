import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTail } from '../src/logtail.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const tmpFile = name => join(mkdtempSync(join(tmpdir(), 'tail-')), name);
const TICK = 40;

test('emits lines appended after start', async () => {
  const file = tmpFile('a.log');
  writeFileSync(file, 'history\n');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 3);
  appendFileSync(file, 'second\nthird\n');
  await wait(TICK * 5);
  tail.stop();
  assert.deepEqual(seen, ['second', 'third'], 'history must not be replayed');
});

test('reads from the start when asked', async () => {
  const file = tmpFile('start.log');
  writeFileSync(file, 'one\ntwo\n');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK, fromStart: true });
  await wait(TICK * 4);
  tail.stop();
  assert.deepEqual(seen, ['one', 'two']);
});

test('does not emit a partial line until it is terminated', async () => {
  const file = tmpFile('b.log');
  writeFileSync(file, '');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 3);
  appendFileSync(file, 'incomp');
  await wait(TICK * 4);
  assert.deepEqual(seen, [], 'a fragment is not a line');
  appendFileSync(file, 'lete\n');
  await wait(TICK * 4);
  tail.stop();
  assert.deepEqual(seen, ['incomplete']);
});

test('tolerates a file that does not exist yet', async () => {
  const file = tmpFile('later.log');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 3);
  writeFileSync(file, 'appeared\n');
  await wait(TICK * 5);
  tail.stop();
  assert.deepEqual(seen, ['appeared']);
});

test('recovers when the file is truncated', async () => {
  const file = tmpFile('c.log');
  writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 3);
  writeFileSync(file, 'fresh\n');
  await wait(TICK * 5);
  tail.stop();
  assert.ok(seen.includes('fresh'), `expected a post-truncation line, saw ${JSON.stringify(seen)}`);
});

test('handles CRLF line endings', async () => {
  const file = tmpFile('crlf.log');
  writeFileSync(file, '');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 3);
  appendFileSync(file, 'windows\r\nlines\r\n');
  await wait(TICK * 5);
  tail.stop();
  assert.deepEqual(seen, ['windows', 'lines'], 'carriage returns must be stripped');
});

test('stop() halts emission', async () => {
  const file = tmpFile('d.log');
  writeFileSync(file, '');
  const seen = [];
  const tail = createTail(file, l => seen.push(l), { intervalMs: TICK });
  await wait(TICK * 2);
  tail.stop();
  appendFileSync(file, 'ignored\n');
  await wait(TICK * 5);
  assert.deepEqual(seen, []);
});

test('stop() is safe to call twice', async () => {
  const file = tmpFile('e.log');
  writeFileSync(file, '');
  const tail = createTail(file, () => {}, { intervalMs: TICK });
  tail.stop();
  assert.doesNotThrow(() => tail.stop());
});
