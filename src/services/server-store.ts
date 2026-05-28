import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.js';

export interface ServerProfile {
  id: string;
  name: string;
  server_url: string;
  app_url: string;
  token: string;
  workspace_id: string;
  is_default: boolean;
  secrets?: Record<string, string>;
}

export type ServerProfileInput = Omit<ServerProfile, 'id' | 'is_default' | 'app_url' | 'workspace_id'> & {
  app_url?: string;
  workspace_id?: string;
};

const serversPath = join(process.env.HOME || process.env.USERPROFILE || '', '.multica', 'servers.json');

function ensureDir() {
  const dir = join(process.env.HOME || process.env.USERPROFILE || '', '.multica');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readServers(): ServerProfile[] {
  ensureDir();
  if (!existsSync(serversPath)) return [];
  return JSON.parse(readFileSync(serversPath, 'utf-8'));
}

function writeServers(servers: ServerProfile[]) {
  ensureDir();
  writeFileSync(serversPath, JSON.stringify(servers, null, 2));
}

export class ServerStore {
  seed() {
    const servers = this.list();
    if (servers.length > 0) return; // already seeded

    try {
      const config = loadConfig();
      if (config.server_url && config.token) {
        const hostname = new URL(config.server_url).hostname;
        this.add({
          name: hostname === 'localhost' ? 'Local' : hostname,
          server_url: config.server_url,
          app_url: config.app_url,
          token: config.token,
          workspace_id: config.workspace_id,
        });
      }
    } catch {
      // No existing config to seed
    }
  }

  list(): ServerProfile[] {
    return readServers();
  }

  get(id: string): ServerProfile | null {
    const servers = this.list();
    return servers.find((s) => s.id === id) || null;
  }

  getCurrent(): ServerProfile | null {
    try {
      const config = loadConfig();
      const servers = this.list();
      return servers.find((s) => s.server_url === config.server_url) || null;
    } catch {
      return null;
    }
  }

  updateSecrets(serverId: string, key: string, value: string) {
    const servers = this.list();
    const s = servers.find((s) => s.id === serverId);
    if (!s) return;
    if (!s.secrets) s.secrets = {};
    s.secrets[key] = value;
    writeServers(servers);
  }

  deleteSecret(serverId: string, key: string): boolean {
    const servers = this.list();
    const s = servers.find((s) => s.id === serverId);
    if (!s?.secrets || !(key in s.secrets)) return false;
    delete s.secrets[key];
    if (Object.keys(s.secrets).length === 0) delete s.secrets;
    writeServers(servers);
    return true;
  }

  add(input: ServerProfileInput): ServerProfile {
    const servers = this.list();

    // Deduplicate by server_url
    const existing = servers.find((s) => s.server_url === input.server_url);
    if (existing) {
      existing.name = input.name || existing.name;
      existing.token = input.token || existing.token;
      if (input.app_url) existing.app_url = input.app_url;
      if (input.workspace_id) existing.workspace_id = input.workspace_id;
      writeServers(servers);
      return existing;
    }

    const profile: ServerProfile = {
      id: randomUUID(),
      name: input.name,
      server_url: input.server_url,
      app_url: input.app_url || input.server_url.replace(':8081', ':3002'),
      token: input.token,
      workspace_id: input.workspace_id || '',
      is_default: servers.length === 0,
    };

    servers.push(profile);
    writeServers(servers);

    // If this is the first server, auto-switch to it
    if (servers.length === 1) {
      this.switchTo(profile.id);
    }

    return profile;
  }

  remove(id: string): boolean {
    const servers = this.list();
    const idx = servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;

    const wasDefault = servers[idx].is_default;
    servers.splice(idx, 1);

    // If we removed the default, pick a new one
    if (wasDefault && servers.length > 0) {
      servers[0].is_default = true;
    }

    writeServers(servers);
    return true;
  }

  setDefault(id: string): ServerProfile | null {
    const servers = this.list();
    const target = servers.find((s) => s.id === id);
    if (!target) return null;

    for (const s of servers) s.is_default = false;
    target.is_default = true;
    writeServers(servers);
    return target;
  }

  switchTo(id: string): ServerProfile | null {
    const servers = this.list();
    const target = servers.find((s) => s.id === id);
    if (!target) return null;

    // Mark as default
    for (const s of servers) s.is_default = false;
    target.is_default = true;
    writeServers(servers);

    // Update active config.json so multica CLI uses this server
    const configPath = join(process.env.HOME || process.env.USERPROFILE || '', '.multica', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.server_url = target.server_url;
    config.app_url = target.app_url;
    config.token = target.token;
    // Clear workspace_id when switching servers — the new server likely has different workspaces
    config.workspace_id = target.workspace_id || '';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    return target;
  }
}
