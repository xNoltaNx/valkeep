import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSample, cpuPercent, createDiagnostics } from '../src/diagnostics.js';

// The exact shape the probe printed for a real running server on 2026-09-07.
const REAL = '7.546875|1155645440|120|1788821562620';

test('parses a real probe line', () => {
  const s = parseSample(REAL);
  assert.equal(s.cpuSeconds, 7.546875);
  assert.equal(s.memoryBytes, 1155645440);
  assert.equal(s.threads, 120);
  assert.equal(s.startedAt, 1788821562620);
});

test('ignores surrounding noise from PowerShell', () => {
  assert.ok(parseSample(`\r\n${REAL}\r\n`));
});

test('returns null for an error message rather than throwing', () => {
  assert.equal(parseSample('Get-Process : Cannot find a process with the process identifier 999999.'), null);
});

test('returns null for empty or missing output', () => {
  assert.equal(parseSample(''), null);
  assert.equal(parseSample(undefined), null);
});

test('returns null when a field is not a number', () => {
  assert.equal(parseSample('abc|123|4|5'), null);
});

test('computes CPU as a rate across two samples', () => {
  // 0.8 CPU-seconds over 2 wall seconds on 4 cores = 10%.
  const prev = { cpuSeconds: 10, at: 1000 };
  const next = { cpuSeconds: 10.8, at: 3000 };
  assert.equal(cpuPercent(prev, next, 4), 10);
});

test('normalises across cores rather than reporting per-core', () => {
  const prev = { cpuSeconds: 0, at: 0 };
  const next = { cpuSeconds: 1, at: 1000 };
  assert.equal(cpuPercent(prev, next, 1), 100);
  assert.equal(cpuPercent(prev, next, 32), 3.1);
});

test('a single sample yields no percentage, because a rate needs two', () => {
  assert.equal(cpuPercent(null, { cpuSeconds: 5, at: 1000 }), null);
});

test('a counter that went backwards yields null rather than a negative', () => {
  const prev = { cpuSeconds: 50, at: 1000 };
  const next = { cpuSeconds: 1, at: 3000 };
  assert.equal(cpuPercent(prev, next, 4), null);
});

test('clamps to 100 rather than reporting impossible usage', () => {
  const prev = { cpuSeconds: 0, at: 0 };
  const next = { cpuSeconds: 100, at: 1000 };
  assert.equal(cpuPercent(prev, next, 2), 100);
});

test('zero elapsed time yields null instead of dividing by zero', () => {
  assert.equal(cpuPercent({ cpuSeconds: 1, at: 500 }, { cpuSeconds: 2, at: 500 }, 4), null);
});

test('first sample reports memory and uptime but no CPU percentage', async () => {
  const d = createDiagnostics({ probe: async () => REAL, cores: 4 });
  const s = await d.sample(4242);
  assert.equal(s.cpuPercent, null, 'a rate needs a previous sample');
  assert.equal(s.memoryMB, 1102);
  assert.equal(s.threads, 120);
  assert.ok(s.uptimeSeconds > 0, 'uptime comes from the real process start time');
});

test('second sample reports a CPU percentage', async () => {
  let cpu = 10;
  const d = createDiagnostics({
    probe: async () => `${cpu}|1000000|10|${Date.now() - 5000}`,
    cores: 4
  });
  await d.sample(4242);
  await new Promise(r => setTimeout(r, 40));
  cpu = 10.02;
  const s = await d.sample(4242);
  assert.ok(s.cpuPercent !== null && s.cpuPercent >= 0);
});

test('a changed pid discards the previous rate', async () => {
  const d = createDiagnostics({ probe: async () => REAL, cores: 4 });
  await d.sample(1);
  const s = await d.sample(2);
  assert.equal(s.cpuPercent, null, 'a different process shares no history');
});

test('a probe that throws yields null rather than breaking the panel', async () => {
  const d = createDiagnostics({ probe: async () => { throw new Error('gone'); } });
  assert.equal(await d.sample(4242), null);
});

test('no pid yields null', async () => {
  const d = createDiagnostics({ probe: async () => REAL });
  assert.equal(await d.sample(null), null);
});

test('uptime is derived from the OS, so an adopted server is not unknown', async () => {
  const startedAt = Date.now() - 90_000;
  const d = createDiagnostics({ probe: async () => `1|1000|5|${startedAt}`, cores: 4 });
  const s = await d.sample(4242);
  assert.ok(s.uptimeSeconds >= 89 && s.uptimeSeconds <= 92, `got ${s.uptimeSeconds}`);
});
