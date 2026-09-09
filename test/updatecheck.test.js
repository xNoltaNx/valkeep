import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  compareBuilds, isStale, parseLatestBuild, summarise
} from '../src/updatecheck.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  readFileSync(join(here, 'fixtures', 'app_info_896660.vdf'), 'utf8');

/* ---------- parseLatestBuild ---------- */

// Taken verbatim from a real `app_info_print 896660` on 9 September 2026,
// not written from memory. The build below is Valheim 1.0.
test('reads the public branch build from real SteamCMD output', () => {
  const info = parseLatestBuild(fixture());
  assert.equal(info.buildid, '25185644');
});

test('reports when the public branch was last updated', () => {
  const info = parseLatestBuild(fixture());
  assert.equal(info.timeUpdated, 1788958500000);
});

// The real output carries seven build ids across seven branches. Taking the
// first one that appears would have been right by luck on this capture and
// wrong the moment Valve reorders the list.
test('ignores the build ids of every branch that is not public', () => {
  const text = `"896660"
{
  "depots"
  {
    "branches"
    {
      "default_old"
      {
        "buildid"  "111"
      }
      "public"
      {
        "buildid"  "999"
      }
    }
  }
}`;
  assert.equal(parseLatestBuild(text).buildid, '999');
});

test('is not fooled by a key named public outside the branches block', () => {
  const text = `"896660"
{
  "common"
  {
    "public"
    {
      "buildid"  "111"
    }
  }
  "depots"
  {
    "branches"
    {
      "public"
      {
        "buildid"  "999"
      }
    }
  }
}`;
  assert.equal(parseLatestBuild(text).buildid, '999');
});

test('tolerates carriage returns, because SteamCMD writes them on Windows', () => {
  const info = parseLatestBuild(fixture().replace(/\n/g, '\r\n'));
  assert.equal(info.buildid, '25185644');
});

test('returns null rather than throwing on output that is not app info', () => {
  assert.equal(parseLatestBuild('Connecting anonymously to Steam Public...OK'), null);
  assert.equal(parseLatestBuild(''), null);
  assert.equal(parseLatestBuild(null), null);
});

test('returns null when the public branch carries no build id', () => {
  const text = `"896660"
{
  "depots"
  {
    "branches"
    {
      "public"
      {
        "timeupdated"  "1788958500"
      }
    }
  }
}`;
  assert.equal(parseLatestBuild(text), null);
});

/* ---------- compareBuilds ---------- */

test('equal builds are current', () => {
  assert.equal(compareBuilds('25185644', '25185644').state, 'current');
});

test('a higher published build means the install is outdated', () => {
  assert.equal(compareBuilds('21981590', '25185644').state, 'outdated');
});

// Build ids are numbers written as strings. Comparing them as text would call
// build 9999999 newer than build 25185644, which is the whole feature backwards.
test('compares build ids as numbers, not as text', () => {
  assert.equal(compareBuilds('9999999', '25185644').state, 'outdated');
  assert.equal(compareBuilds('25185644', '9999999').state, 'current');
});

// Someone on a beta or an older pinned branch is not "outdated" in the sense
// this feature warns about, and a nag they cannot clear is worse than silence.
test('an install ahead of the public branch is not reported as outdated', () => {
  assert.equal(compareBuilds('25185644', '21981590').state, 'current');
});

test('an unknown build on either side is unknown, never current', () => {
  assert.equal(compareBuilds(null, '25185644').state, 'unknown');
  assert.equal(compareBuilds('25185644', null).state, 'unknown');
  assert.equal(compareBuilds(null, null).state, 'unknown');
  assert.equal(compareBuilds('', '').state, 'unknown');
});

test('a build id that is not a number is unknown, never current', () => {
  assert.equal(compareBuilds('nonsense', '25185644').state, 'unknown');
  assert.equal(compareBuilds('25185644', 'nonsense').state, 'unknown');
});

test('carries both builds through so the notice can name them', () => {
  const r = compareBuilds('21981590', '25185644');
  assert.equal(r.installed, '21981590');
  assert.equal(r.latest, '25185644');
});

/* ---------- isStale ---------- */

const HOUR = 3600 * 1000;

test('a check that never ran is stale', () => {
  assert.equal(isStale(null, 6 * HOUR, 0), true);
  assert.equal(isStale({ checkedAt: null }, 6 * HOUR, 0), true);
});

test('a recent check is not stale', () => {
  assert.equal(isStale({ checkedAt: 100 * HOUR }, 6 * HOUR, 101 * HOUR), false);
});

test('a check older than the interval is stale', () => {
  assert.equal(isStale({ checkedAt: 100 * HOUR }, 6 * HOUR, 107 * HOUR), true);
});

// A clock that jumps backwards must not freeze the check forever.
test('a check timed in the future is stale', () => {
  assert.equal(isStale({ checkedAt: 200 * HOUR }, 6 * HOUR, 100 * HOUR), true);
});

/* ---------- summarise ---------- */

test('summarises an outdated install for the status payload', () => {
  const s = summarise({
    installed: '21981590',
    cache: { buildid: '25185644', checkedAt: 42, timeUpdated: 7 }
  });
  assert.equal(s.updateState, 'outdated');
  assert.equal(s.latestBuild, '25185644');
  assert.equal(s.lastCheckedAt, 42);
});

test('summarises an unchecked install as unknown with no latest build', () => {
  const s = summarise({ installed: '21981590', cache: null });
  assert.equal(s.updateState, 'unknown');
  assert.equal(s.latestBuild, null);
  assert.equal(s.lastCheckedAt, null);
});

// The last check failing must not silently read as "you are up to date".
test('a failed check keeps the state unknown and reports the error', () => {
  const s = summarise({
    installed: '21981590',
    cache: { buildid: null, checkedAt: 42, error: 'Steam unreachable' }
  });
  assert.equal(s.updateState, 'unknown');
  assert.equal(s.updateCheckError, 'Steam unreachable');
});
