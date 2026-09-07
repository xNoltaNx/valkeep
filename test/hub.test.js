import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';

function fakeRes() {
  const written = [];
  const handlers = {};
  return {
    written,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    write(chunk) { written.push(chunk); return true; },
    on(event, fn) { handlers[event] = fn; },
    fire(event) { handlers[event]?.(); },
    text() { return written.join(''); }
  };
}

test('broadcast reaches every subscriber', () => {
  const hub = createHub();
  const a = fakeRes(), b = fakeRes();
  hub.subscribe(a);
  hub.subscribe(b);
  hub.broadcast('log', { line: 'hello' });
  assert.ok(a.text().includes('hello'));
  assert.ok(b.text().includes('hello'));
});

test('messages are formatted as SSE events', () => {
  const hub = createHub();
  const r = fakeRes();
  hub.subscribe(r);
  hub.broadcast('status', { running: true });
  const out = r.text();
  assert.ok(out.startsWith('event: status\n'));
  assert.ok(out.includes('data: {"running":true}\n'));
  assert.ok(out.endsWith('\n\n'), 'an SSE frame ends with a blank line');
});

test('sets the streaming headers', () => {
  const hub = createHub();
  const r = fakeRes();
  hub.subscribe(r);
  assert.equal(r.headers['Content-Type'], 'text/event-stream');
  assert.equal(r.headers['Cache-Control'], 'no-cache');
});

test('count tracks subscribers', () => {
  const hub = createHub();
  assert.equal(hub.count(), 0);
  hub.subscribe(fakeRes());
  assert.equal(hub.count(), 1);
});

test('a closed connection is removed', () => {
  const hub = createHub();
  const r = fakeRes();
  hub.subscribe(r);
  r.fire('close');
  assert.equal(hub.count(), 0);
});

test('a subscriber that throws on write is dropped, not fatal', () => {
  const hub = createHub();
  const bad = fakeRes();
  bad.write = () => { throw new Error('socket closed'); };
  const good = fakeRes();
  hub.subscribe(bad);
  hub.subscribe(good);

  assert.doesNotThrow(() => hub.broadcast('log', { line: 'x' }));
  assert.equal(hub.count(), 1, 'the broken client is dropped');
  assert.ok(good.text().includes('x'), 'the healthy client still receives');
});

test('payloads containing newlines stay on one data line', () => {
  const hub = createHub();
  const r = fakeRes();
  hub.subscribe(r);
  hub.broadcast('log', { line: 'a\nb' });
  const dataLines = r.text().split('\n').filter(l => l.startsWith('data: '));
  assert.equal(dataLines.length, 1, 'JSON encoding must escape the newline');
});

test('broadcasting with no subscribers is harmless', () => {
  const hub = createHub();
  assert.doesNotThrow(() => hub.broadcast('log', { line: 'nobody listening' }));
});
