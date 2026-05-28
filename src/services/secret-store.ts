import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const secretsPath = join(process.env.HOME || process.env.USERPROFILE || '', '.multica', 'secrets.json');

function ensureDir() {
  const dir = join(process.env.HOME || process.env.USERPROFILE || '', '.multica');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readSecrets(): Record<string, string> {
  ensureDir();
  if (!existsSync(secretsPath)) return {};
  return JSON.parse(readFileSync(secretsPath, 'utf-8'));
}

function writeSecrets(secrets: Record<string, string>) {
  ensureDir();
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
}

export class SecretStore {
  list(): Record<string, string> {
    return readSecrets();
  }

  set(key: string, value: string) {
    const secrets = readSecrets();
    secrets[key] = value;
    writeSecrets(secrets);
  }

  delete(key: string): boolean {
    const secrets = readSecrets();
    if (!(key in secrets)) return false;
    delete secrets[key];
    writeSecrets(secrets);
    return true;
  }

  /** Resolve template vars against stored secrets. Returns a map of varName → value for matched keys. */
  resolve(templateEnv?: Record<string, string>): Record<string, string> {
    if (!templateEnv || Object.keys(templateEnv).length === 0) return {};
    const secrets = readSecrets();
    const resolved: Record<string, string> = {};
    for (const key of Object.keys(templateEnv)) {
      if (secrets[key]) {
        resolved[key] = secrets[key];
      }
    }
    return resolved;
  }
}
