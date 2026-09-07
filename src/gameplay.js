/**
 * Valheim world modifiers.
 *
 * Values are validated against these allow-lists before a start, because an
 * invalid modifier is a silent startup failure - the same failure class as the
 * password rule. Better to refuse in the UI than to have the server quietly
 * not come up.
 */

export const MODIFIERS = {
  combat: {
    label: 'Combat',
    help: 'Enemy health, damage, and spawn rates.',
    values: ['veryeasy', 'easy', 'normal', 'hard', 'veryhard']
  },
  deathpenalty: {
    label: 'Death penalty',
    help: 'How much skill progress you lose when you die.',
    values: ['casual', 'veryeasy', 'easy', 'normal', 'hard', 'hardcore']
  },
  resources: {
    label: 'Resources',
    help: 'Yield from trees, rocks, and ore.',
    values: ['muchless', 'less', 'normal', 'more', 'muchmore', 'most']
  },
  raids: {
    label: 'Raids',
    help: 'How often events attack your base.',
    values: ['none', 'muchless', 'less', 'normal', 'more', 'muchmore']
  },
  portals: {
    label: 'Portals',
    help: 'What you may carry through a portal.',
    values: ['casual', 'normal', 'hard', 'veryhard']
  }
};

export const TOGGLES = {
  nobuildcost: { label: 'No build cost', help: 'Build without spending materials.' },
  playerevents: { label: 'Player events', help: 'Raids trigger from player progress.' },
  passivemobs: { label: 'Passive creatures', help: 'Creatures never attack first.' },
  nomap: { label: 'No map', help: 'No map or minimap. Navigate by landmark.' }
};

/**
 * Documented preset contents, shown in the UI as a reference only.
 * The game resolves presets itself; we pass -preset through rather than
 * expanding it here, because sources disagree on some values and the game
 * is the authority. Individual -modifier flags override the preset.
 */
export const PRESETS = {
  normal:    { label: 'Normal',    summary: 'The intended experience. Everything default.' },
  casual:    { label: 'Casual',    summary: 'Very easy combat, no death penalty, far more resources, no raids, unrestricted portals.' },
  easy:      { label: 'Easy',      summary: 'Easier combat and death penalty, more resources, fewer raids.' },
  hard:      { label: 'Hard',      summary: 'Tougher enemies, harsher death, fewer resources, more raids, restricted portals.' },
  hardcore:  { label: 'Hardcore',  summary: 'Very hard combat, hardcore death penalty, very restricted portals.' },
  immersive: { label: 'Immersive', summary: 'Hard combat and death, fewer resources, more raids, very restricted portals.' },
  hammer:    { label: 'Hammer',    summary: 'Built for building: no death penalty, far more resources, no raids.' }
};

export function validateGameplay(server = {}) {
  const errors = [];

  if (server.preset && !Object.hasOwn(PRESETS, String(server.preset).toLowerCase())) {
    errors.push(`Unknown preset "${server.preset}".`);
  }

  for (const [key, value] of Object.entries(server.modifiers ?? {})) {
    const spec = MODIFIERS[key];
    if (!spec) {
      errors.push(`Unknown modifier "${key}".`);
      continue;
    }
    if (!spec.values.includes(String(value))) {
      errors.push(`"${value}" is not a valid ${spec.label} value.`);
    }
  }

  for (const key of server.setkeys ?? []) {
    if (!Object.hasOwn(TOGGLES, key)) errors.push(`Unknown toggle "${key}".`);
  }

  return errors;
}

/**
 * "normal" is the game's default and is expressed by omitting the flag, so a
 * modifier explicitly set to normal is dropped rather than passed through.
 */
export function activeModifiers(modifiers = {}) {
  return Object.entries(modifiers).filter(([, v]) => v && v !== 'normal');
}
