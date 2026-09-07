/**
 * Server process diagnostics.
 *
 * Valheim exposes no metrics of its own, so everything here comes from the
 * operating system's view of the process. That keeps it honest: these are
 * facts about CPU and memory, not inferences about the game.
 *
 * CPU is deliberately a *sampled* figure. Windows reports cumulative CPU
 * seconds, so a single reading says how much work the process has done since
 * it started, which is not what anyone means by "CPU usage". Two readings and
 * the elapsed wall time between them give the rate.
 */

import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Parses the delimited line the probe prints. Returns null for anything else. */
export function parseSample(stdout) {
  const line = String(stdout ?? '').trim().split(/\r?\n/).find(l => l.includes('|'));
  if (!line) return null;

  const [cpu, memory, threads, startedAt] = line.split('|').map(v => Number(v.trim()));
  if (![cpu, memory, threads, startedAt].every(Number.isFinite)) return null;

  return { cpuSeconds: cpu, memoryBytes: memory, threads, startedAt, at: Date.now() };
}

/**
 * CPU as a percentage of one core's worth of time, normalised across cores so
 * 100% means "saturating the machine", not "saturating one core".
 */
export function cpuPercent(previous, current, cores = availableParallelism()) {
  if (!previous || !current) return null;
  const elapsedMs = current.at - previous.at;
  const cpuMs = (current.cpuSeconds - previous.cpuSeconds) * 1000;
  if (elapsedMs <= 0 || cpuMs < 0) return null;   // a restart resets the counter

  const percent = (cpuMs / elapsedMs / Math.max(1, cores)) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

async function defaultProbe(pid) {
  const { stdout } = await execFileAsync('powershell', [
    '-NoProfile', '-Command',
    `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
    `'{0}|{1}|{2}|{3}' -f $p.CPU, $p.WorkingSet64, $p.Threads.Count, ` +
    `([DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds())`
  ]);
  return stdout;
}

export function createDiagnostics({ probe = defaultProbe, cores = availableParallelism() } = {}) {
  let previous = null;
  let lastPid = null;

  async function sample(pid) {
    if (!pid) {
      previous = null;
      lastPid = null;
      return null;
    }
    if (pid !== lastPid) {
      previous = null;      // a different process: no rate to compute yet
      lastPid = pid;
    }

    let current;
    try {
      current = parseSample(await probe(pid));
    } catch {
      return null;          // the process went away between status and probe
    }
    if (!current) return null;

    const percent = cpuPercent(previous, current, cores);
    previous = current;

    return {
      cpuPercent: percent,
      memoryBytes: current.memoryBytes,
      memoryMB: Math.round(current.memoryBytes / (1024 * 1024)),
      threads: current.threads,
      startedAt: current.startedAt,
      uptimeSeconds: Math.floor((Date.now() - current.startedAt) / 1000),
      cores
    };
  }

  function reset() {
    previous = null;
    lastPid = null;
  }

  return { sample, reset };
}
