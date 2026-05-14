import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MulticaConfig {
  server_url: string;
  app_url: string;
  workspace_id: string;
  token: string;
}

export function loadConfig(): MulticaConfig {
  const configPath = join(process.env.HOME || process.env.USERPROFILE || '', '.multica', 'config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}
