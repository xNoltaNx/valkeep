import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_KEYS, profileFrom, rememberProfile, applyProfile, profileFor } from '../src/profiles.js';

const server = () => ({
  name: 'Midgard Crew', password: 'hunter22', port: 2456,
  public: false, crossplay: true, saveinterval: 1800,
  preset: 'hard', modifiers: { combat: 'hard' }, setkeys: ['nomap'],
  world: 'Midgard'
});

test('a profile carries the settings that belong to a world', () => {
  const p = profileFrom(server());
  assert.equal(p.name, 'Midgard Crew');
  assert.equal(p.password, 'hunter22');
  assert.equal(p.preset, 'hard');
  assert.deepEqual(p.modifiers, { combat: 'hard' });
});

test('a profile does not carry the world name itself', () => {
  assert.equal(profileFrom(server()).world, undefined,
    'the world is the key, not part of the value');
  assert.ok(!PROFILE_KEYS.includes('world'));
});

test('remembering stores the profile under the world', () => {
  const profiles = rememberProfile({}, 'Midgard', server());
  assert.equal(profiles.Midgard.name, 'Midgard Crew');
});

test('remembering keeps other worlds untouched', () => {
  const config = { worldProfiles: { Asgard: { name: 'Asgard Crew', password: 'aaaaa' } } };
  const profiles = rememberProfile(config, 'Midgard', server());
  assert.equal(profiles.Asgard.name, 'Asgard Crew');
  assert.equal(profiles.Midgard.name, 'Midgard Crew');
});

test('remembering with no world changes nothing', () => {
  const config = { worldProfiles: { Asgard: { name: 'Asgard Crew' } } };
  assert.deepEqual(rememberProfile(config, '', server()), { Asgard: { name: 'Asgard Crew' } });
});

test('applying a profile restores that world name and password', () => {
  const current = { name: 'Other', password: 'zzzzz', port: 2456, crossplay: true };
  const restored = applyProfile(current, { name: 'Asgard Crew', password: 'aaaaa' });
  assert.equal(restored.name, 'Asgard Crew');
  assert.equal(restored.password, 'aaaaa');
});

test('applying leaves settings the profile does not mention', () => {
  const current = { name: 'Other', password: 'zzzzz', port: 2456, crossplay: true };
  const restored = applyProfile(current, { name: 'Asgard Crew' });
  assert.equal(restored.port, 2456);
  assert.equal(restored.crossplay, true);
});

test('applying nothing keeps the current settings', () => {
  const current = server();
  assert.deepEqual(applyProfile(current, null), { ...current });
});

test('a new world inherits what you just typed', () => {
  // profileFor returns null for an unknown world, so applyProfile is a no-op
  // and the setup being typed carries into the world about to be created.
  const config = { worldProfiles: { Asgard: { name: 'Asgard Crew' } } };
  assert.equal(profileFor(config, 'BrandNew'), null);
  assert.equal(applyProfile(server(), profileFor(config, 'BrandNew')).name, 'Midgard Crew');
});

test('applying does not mutate the settings passed in', () => {
  const current = server();
  applyProfile(current, { name: 'Changed' });
  assert.equal(current.name, 'Midgard Crew');
});

test('profileFor reads back what was remembered', () => {
  const config = { worldProfiles: rememberProfile({}, 'Midgard', server()) };
  assert.equal(profileFor(config, 'Midgard').password, 'hunter22');
});

test('profileFor is null on a config that has never saved one', () => {
  assert.equal(profileFor({}, 'Midgard'), null);
});

test('a round trip through remember and apply preserves modifiers and toggles', () => {
  const config = { worldProfiles: rememberProfile({}, 'Midgard', server()) };
  const restored = applyProfile({ name: 'x', password: 'y' }, profileFor(config, 'Midgard'));
  assert.deepEqual(restored.modifiers, { combat: 'hard' });
  assert.deepEqual(restored.setkeys, ['nomap']);
  assert.equal(restored.preset, 'hard');
});
