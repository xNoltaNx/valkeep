import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { buildArgs, validate, withDefaultPaths } from '../src/settings.js';
import { ROOT } from '../src/paths.js';

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

test('rejects a password contained in the server name', () => {
  const cfg = base();
  cfg.server.name = 'Midgard Nights';
  cfg.server.password = 'gard N';
  assert.ok(validate(cfg).some(e => /server name/i.test(e)));
});

test('rejects a password contained in the world name', () => {
  const cfg = base();
  cfg.server.world = 'Midgard';
  cfg.server.password = 'idgar';
  assert.ok(validate(cfg).some(e => /world name/i.test(e)));
});

test('the containment check ignores case, because the game may not', () => {
  const cfg = base();
  cfg.server.world = 'Midgard';
  cfg.server.password = 'IDGAR';
  assert.ok(validate(cfg).some(e => /world name/i.test(e)));
});

test('accepts a password that merely shares letters with the names', () => {
  const cfg = base();
  cfg.server.name = 'Midgard Nights';
  cfg.server.world = 'Midgard';
  cfg.server.password = 'dragim';
  assert.deepEqual(validate(cfg), []);
});

test('rejects a missing server executable path', () => {
  const cfg = base();
  cfg.serverExe = '';
  assert.ok(validate(cfg).some(e => /executable/i.test(e)));
});

test('accepts a valid config', () => {
  assert.deepEqual(validate(base()), []);
});

// A fresh clone ships config.example.json with the three machine paths empty,
// and the Settings screen does not expose them. Without defaults, a friend who
// clones the repo gets a panel that can neither install nor start anything and
// no way in the interface to say why. Derive them instead of demanding them.
test('fills the install directory, exe and save directory when unset', () => {
  const cfg = withDefaultPaths({ installDir: '', serverExe: '', saveDir: '' });
  assert.equal(cfg.installDir, join(ROOT, 'server'));
  assert.equal(cfg.serverExe, join(ROOT, 'server', 'valheim_server.exe'));
  assert.equal(cfg.saveDir, join(homedir(), 'AppData', 'LocalLow', 'IronGate', 'Valheim'));
});

test('the derived exe follows a custom install directory', () => {
  const cfg = withDefaultPaths({ installDir: 'D:\vh', serverExe: '', saveDir: '' });
  assert.equal(cfg.serverExe, join('D:\vh', 'valheim_server.exe'));
});

test('an operator-set path is never overwritten', () => {
  const cfg = withDefaultPaths({
    installDir: 'D:\vh', serverExe: 'D:\vh\other.exe', saveDir: 'E:\saves'
  });
  assert.equal(cfg.serverExe, 'D:\vh\other.exe');
  assert.equal(cfg.saveDir, 'E:\saves');
});

test('a config with no path keys at all still resolves', () => {
  const cfg = withDefaultPaths({ server: {} });
  assert.equal(cfg.installDir, join(ROOT, 'server'));
});
