/**
 * Per-world settings profiles.
 *
 * A world is not just a save file; it is a whole setup. The friends who play
 * on it know it by a particular server name and password, and it was probably
 * created with particular modifiers. Keeping one flat settings block meant
 * switching worlds silently carried the previous world's name and password
 * across, so friends would be given a password that no longer matched the
 * world they were joining.
 *
 * Every save records the current settings against the current world, and
 * selecting a world brings its own settings back.
 */

/** The settings that belong to a world rather than to the machine. */
export const PROFILE_KEYS = [
  'name', 'password', 'port', 'public', 'crossplay',
  'saveinterval', 'preset', 'modifiers', 'setkeys'
];

export function profileFrom(server = {}) {
  const profile = {};
  for (const key of PROFILE_KEYS) {
    if (server[key] !== undefined) profile[key] = server[key];
  }
  return profile;
}

export function rememberProfile(config, world, server) {
  if (!world) return config.worldProfiles ?? {};
  return { ...(config.worldProfiles ?? {}), [world]: profileFrom(server) };
}

/**
 * Applies a world's remembered settings over the current ones. Unknown worlds
 * keep the current settings, which is what you want when creating a new world:
 * the setup you just typed carries into it.
 */
export function applyProfile(server, profile) {
  if (!profile) return { ...server };
  const next = { ...server };
  for (const key of PROFILE_KEYS) {
    if (profile[key] !== undefined) next[key] = profile[key];
  }
  return next;
}

export function profileFor(config, world) {
  return (config.worldProfiles ?? {})[world] ?? null;
}
