import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ServerStore } from './server-store.js';

const secretsPath = join(process.env.HOME || process.env.USERPROFILE || '', '.multica', 'secrets.json');

function ensureDir() {
  const dir = join(process.env.HOME || process.env.USERPROFILE || '', '.multica');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readGlobalSecrets(): Record<string, string> {
  ensureDir();
  if (!existsSync(secretsPath)) return {};
  return JSON.parse(readFileSync(secretsPath, 'utf-8'));
}

function writeGlobalSecrets(secrets: Record<string, string>) {
  ensureDir();
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
}

export class SecretStore {
  private servers: ServerStore;

  constructor(servers: ServerStore) {
    this.servers = servers;
  }

  /** Global secrets */

  listGlobal(): Record<string, string> {
    return readGlobalSecrets();
  }

  setGlobal(key: string, value: string) {
    const secrets = readGlobalSecrets();
    secrets[key] = value;
    writeGlobalSecrets(secrets);
  }

  deleteGlobal(key: string): boolean {
    const secrets = readGlobalSecrets();
    if (!(key in secrets)) return false;
    delete secrets[key];
    writeGlobalSecrets(secrets);
    return true;
  }

  /** Server-specific secrets */

  listServer(serverId: string): Record<string, string> {
    const s = this.servers.get(serverId);
    return s?.secrets ? { ...s.secrets } : {};
  }

  setServer(serverId: string, key: string, value: string) {
    this.servers.updateSecrets(serverId, key, value);
  }

  deleteServer(serverId: string, key: string): boolean {
    return this.servers.deleteSecret(serverId, key);
  }

  /**
   * Resolve template vars with fallback chain:
   * server secrets → global secrets → keep template placeholder.
   * Returns a map of varName → resolved value for all matched keys.
   */
  resolve(templateEnv?: Record<string, string>, serverId?: string): Record<string, string> {
    if (!templateEnv || Object.keys(templateEnv).length === 0) return {};

    const globalSecrets = readGlobalSecrets();
    const serverSecrets = serverId ? this.listServer(serverId) : {};

    const resolved: Record<string, string> = {};
    for (const key of Object.keys(templateEnv)) {
      // Server-specific takes priority, then global
      if (serverSecrets[key]) {
        resolved[key] = serverSecrets[key];
      } else if (globalSecrets[key]) {
        resolved[key] = globalSecrets[key];
      }
    }
    return resolved;
  }

  /**
   * Get all effective secrets for a server context (merged: global + server overrides).
   */
  effectiveSecrets(serverId?: string): Record<string, string> {
    const globalSecrets = readGlobalSecrets();
    if (!serverId) return { ...globalSecrets };

    const serverSecrets = this.listServer(serverId);
    return { ...globalSecrets, ...serverSecrets };
  }
}

