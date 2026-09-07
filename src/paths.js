import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const dataDir = () => join(ROOT, 'data');
export const backupsDir = () => join(dataDir(), 'backups');
export const logsDir = () => join(dataDir(), 'logs');
export const stateFile = () => join(dataDir(), 'state.json');
export const configFile = () => join(ROOT, 'config.json');
export const toolsDir = () => join(ROOT, 'tools');
