import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODIFIERS, TOGGLES, PRESETS, validateGameplay, activeModifiers } from '../src/gameplay.js';
import { buildArgs } from '../src/settings.js';

const base = () => ({
  serverExe: 'C:\\vh\\valheim_server.exe',
  saveDir: 'C:\\saves',
  server: {
    name: 'My Server', world: 'Dedicated', password: 'hunter22',
    port: 2456, public: false, crossplay: true,
    preset: '', modifiers: {}, setkeys: []
  }
});

test('exposes the five documented modifier categories', () => {
  assert.deepEqual(
    Object.keys(MODIFIERS).sort(),
    ['combat', 'deathpenalty', 'portals', 'raids', 'resources']
  );
});

test('exposes the four documented toggles', () => {
  assert.deepEqual(
    Object.keys(TOGGLES).sort(),
    ['nobuildcost', 'nomap', 'passivemobs', 'playerevents']
  );
});

test('exposes the seven documented presets', () => {
  assert.equal(Object.keys(PRESETS).length, 7);
  for (const key of ['normal', 'casual', 'easy', 'hard', 'hardcore', 'immersive', 'hammer']) {
    assert.ok(PRESETS[key], `missing preset ${key}`);
    assert.ok(PRESETS[key].summary.length > 10, `${key} needs a real summary`);
  }
});

test('every modifier offers normal as an option', () => {
  for (const [key, spec] of Object.entries(MODIFIERS)) {
    assert.ok(spec.values.includes('normal'), `${key} must offer normal`);
  }
});

test('accepts valid modifiers', () => {
  assert.deepEqual(
    validateGameplay({ preset: 'hard', modifiers: { combat: 'veryhard' }, setkeys: ['nomap'] }),
    []
  );
});

test('rejects an unknown preset', () => {
  assert.ok(validateGameplay({ preset: 'nightmare' }).some(e => /preset/i.test(e)));
});

test('rejects an unknown modifier key', () => {
  assert.ok(validateGameplay({ modifiers: { gravity: 'low' } }).some(e => /gravity/.test(e)));
});

test('rejects an invalid value for a known modifier', () => {
  assert.ok(validateGameplay({ modifiers: { combat: 'impossible' } }).some(e => /Combat/.test(e)));
});

test('rejects an unknown toggle', () => {
  assert.ok(validateGameplay({ setkeys: ['godmode'] }).some(e => /godmode/.test(e)));
});

test('preset matching is case-insensitive', () => {
  assert.deepEqual(validateGameplay({ preset: 'Hardcore' }), []);
});

test('activeModifiers drops normal, since normal is expressed by omission', () => {
  const active = activeModifiers({ combat: 'hard', resources: 'normal', raids: 'none' });
  assert.deepEqual(active.map(([k]) => k).sort(), ['combat', 'raids']);
});

test('activeModifiers drops empty values', () => {
  assert.deepEqual(activeModifiers({ combat: '', portals: undefined }), []);
});

test('buildArgs emits only non-normal modifiers', () => {
  const cfg = base();
  cfg.server.modifiers = { combat: 'hard', resources: 'normal', portals: 'casual' };
  const joined = buildArgs(cfg).join(' ');
  assert.ok(joined.includes('-modifier combat hard'));
  assert.ok(joined.includes('-modifier portals casual'));
  assert.ok(!joined.includes('resources'), 'a normal modifier must not be passed');
});

test('buildArgs emits the preset and every toggle', () => {
  const cfg = base();
  cfg.server.preset = 'hammer';
  cfg.server.setkeys = ['nobuildcost', 'nomap'];
  const joined = buildArgs(cfg).join(' ');
  assert.ok(joined.includes('-preset hammer'));
  assert.ok(joined.includes('-setkey nobuildcost'));
  assert.ok(joined.includes('-setkey nomap'));
});

test('an invalid modifier blocks a start via the shared validator', async () => {
  const { validate } = await import('../src/settings.js');
  const cfg = base();
  cfg.server.modifiers = { combat: 'nope' };
  assert.ok(validate(cfg).length > 0, 'validate must surface gameplay errors');
});
