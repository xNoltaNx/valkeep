/**
 * Follows a log file and emits complete lines.
 *
 * Polling rather than fs.watch: the server writes from another process, watch
 * events on Windows are unreliable across processes, and a 1s poll is well
 * inside the latency budget for a dashboard.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export function createTail(path, onLine, { intervalMs = 1000, fromStart = false } = {}) {
  // If the file already exists we skip its history and stream only new
  // activity. If it does not exist yet, everything it will contain is new -
  // which is the normal case, since the panel starts the server and the
  // server then creates the log.
  let offset = fromStart || !existsSync(path) ? 0 : null;
  let carry = '';
  let stopped = false;

  function poll() {
    if (stopped) return;
    try {
      if (!existsSync(path)) return;
      const size = statSync(path).size;

      if (offset === null) offset = size;   // skip existing history, once
      if (size < offset) {
        offset = 0;      // truncated or rotated
        carry = '';
      }
      if (size === offset) return;

      const fd = openSync(path, 'r');
      try {
        const length = size - offset;
        const buf = Buffer.alloc(length);
        const read = readSync(fd, buf, 0, length, offset);
        offset += read;
        carry += buf.subarray(0, read).toString('utf8');
      } finally {
        closeSync(fd);
      }

      const parts = carry.split(/\r?\n/);
      carry = parts.pop();          // trailing fragment, not yet a line
      for (const line of parts) {
        if (stopped) return;
        if (line.length > 0) onLine(line);
      }
    } catch {
      // A transient read error must not kill the loop; the next tick retries.
    }
  }

  const timer = setInterval(poll, intervalMs);
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
