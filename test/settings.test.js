import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, validate } from '../src/settings.js';

const base = () => ({
  serverExe: 'C:\\vh\\valheim_server.exe',
  saveDir: 'C:\\saves',
  server: {
    name: 'My Server', world: 'Dedicated', password: 'hunter22',
    port: 2456, public: false, crossplay: true,
    saveinterval: 1800, backups: 4, backupshort: 7200, backuplong: 43200,
    preset: '', modifiers: {}, setkeys: []
  }
});

test('builds the core arguments', () => {
  const args = buildArgs(base());
  assert.ok(args.includes('-nographics'));
  assert.ok(args.includes('-batchmode'));
  assert.equal(args[args.indexOf('-name') + 1], 'My Server');
  assert.equal(args[args.indexOf('-world') + 1], 'Dedicated');
  assert.equal(args[args.indexOf('-port') + 1], '2456');
  assert.equal(args[args.indexOf('-public') + 1], '0');
});

test('uses capital-F logFile', () => {
  const args = buildArgs(base());
  assert.ok(args.includes('-logFile'));
  assert.ok(!args.includes('-logfile'));
});

test('crossplay is a bare flag, present only when enabled', () => {
  assert.ok(buildArgs(base()).includes('-crossplay'));
  const off = base();
  off.server.crossplay = false;
  assert.ok(!buildArgs(off).includes('-crossplay'));
});

test('omits optional flags when unset', () => {
  const cfg = base();
  cfg.server.preset = '';
  assert.ok(!buildArgs(cfg).includes('-preset'));
});

test('includes preset when set', () => {
  const cfg = base();
  cfg.server.preset = 'hard';
  const args = buildArgs(cfg);
  assert.equal(args[args.indexOf('-preset') + 1], 'hard');
});

test('emits one -modifier pair per modifier', () => {
  const cfg = base();
  cfg.server.modifiers = { raids: 'none', portals: 'casual' };
  const joined = buildArgs(cfg).join(' ');
  assert.ok(joined.includes('-modifier raids none'));
  assert.ok(joined.includes('-modifier portals casual'));
});

test('emits one -setkey per key', () => {
  const cfg = base();
  cfg.server.setkeys = ['nomap', 'nobuildcost'];
  const joined = buildArgs(cfg).join(' ');
  assert.ok(joined.includes('-setkey nomap'));
  assert.ok(joined.includes('-setkey nobuildcost'));
});

test('arguments are separate array entries, never pre-quoted', () => {
  const args = buildArgs(base());
  const name = args[args.indexOf('-name') + 1];
  assert.equal(name, 'My Server');
  assert.ok(!name.startsWith('"'), 'spawn handles quoting; do not add quotes');
});

test('rejects a password shorter than 5 characters', () => {
  const cfg = base();
  cfg.server.password = 'abc';
  assert.ok(validate(cfg).some(e => /5/.test(e)));
});

test('rejects a password equal to the server name', () => {
  const cfg = base();
  cfg.server.name = 'samevalue';
  cfg.server.password = 'samevalue';
  assert.ok(validate(cfg).some(e => /name/i.test(e)));
});

test('rejects a missing server executable path', () => {
  const cfg = base();
  cfg.serverExe = '';
  assert.ok(validate(cfg).some(e => /executable/i.test(e)));
});

test('accepts a valid config', () => {
  assert.deepEqual(validate(base()), []);
});
