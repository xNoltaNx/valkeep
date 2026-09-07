/**
 * Server-Sent Events fan-out.
 *
 * One dead browser tab must never break the broadcast for the others, so a
 * write failure drops that client rather than propagating.
 */

export function createHub() {
  const clients = new Set();

  function subscribe(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    clients.add(res);
    res.on('close', () => clients.delete(res));
  }

  function broadcast(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...clients]) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  return { subscribe, broadcast, count: () => clients.size };
}
