import { Router } from 'express';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import * as cli from '../services/cli.js';
import { TemplateReader } from '../services/template-reader.js';
import { TemplateWriter } from '../services/template-writer.js';
import { WorkspaceScanner } from '../services/workspace-scanner.js';
import { ImportEngine } from '../services/import-engine.js';
import { ExportEngine } from '../services/export-engine.js';
import { ServerStore } from '../services/server-store.js';
import { SecretStore } from '../services/secret-store.js';
import { EntityRegistry } from '../services/entity-registry.js';
import { EntityValidator } from '../services/entity-validator.js';
import { parseEntityRef } from '../types/entity.js';
import type { ImportOptions, ExportOptions } from '../types/template.js';

export async function createApiRouter() {
  const router = Router();

  const reader = new TemplateReader();
  const writer = new TemplateWriter();
  const scanner = new WorkspaceScanner();
  const importer = new ImportEngine(reader, scanner);
  const exporter = new ExportEngine(scanner, writer, reader);
  const registry = new EntityRegistry();
  const validator = new EntityValidator();
  const servers = new ServerStore();
  servers.seed();
  const secrets = new SecretStore(servers);

  // ── Global Secrets ──

  router.get('/secrets', (req, res) => {
    try {
      const serverId = req.query.server as string | undefined;
      if (serverId) {
        const current = secrets.effectiveSecrets(serverId);
        const serverOnly = secrets.listServer(serverId);
        const globalOnly = secrets.listGlobal();
        res.json({ secrets: current, server: serverOnly, global: globalOnly });
      } else {
        res.json({ secrets: secrets.listGlobal() });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/secrets', (req, res) => {
    try {
      const { key, value, server_id } = req.body;
      if (!key || value === undefined) {
        res.status(400).json({ error: 'key and value are required' });
        return;
      }
      if (server_id) {
        secrets.setServer(server_id, key, value);
      } else {
        secrets.setGlobal(key, value);
      }
      res.json({ ok: true, server_id: server_id || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/secrets/:key', (req, res) => {
    try {
      const serverId = req.query.server as string | undefined;
      let ok: boolean;
      if (serverId) {
        ok = secrets.deleteServer(serverId, req.params.key);
      } else {
        ok = secrets.deleteGlobal(req.params.key);
      }
      if (!ok) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/secrets/resolve', (req, res) => {
    try {
      const env = req.body.env as Record<string, string>;
      const serverId = req.body.server_id as string | undefined;
      res.json({ resolved: secrets.resolve(env, serverId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mass save resolved env vars to a server's secrets
  router.post('/secrets/save-to-server', (req, res) => {
    try {
      const { server_id, env } = req.body as { server_id: string; env: Record<string, string> };
      if (!server_id || !env) {
        res.status(400).json({ error: 'server_id and env are required' });
        return;
      }
      let count = 0;
      for (const [key, value] of Object.entries(env)) {
        if (value && !value.startsWith('${')) {
          secrets.setServer(server_id, key, value);
          count++;
        }
      }
      res.json({ ok: true, saved: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Workspaces ──

  router.get('/workspaces', async (_req, res) => {
    try {
      const workspaces = await cli.listWorkspaces();
      const config = await cli.getWorkspaceConfig().catch(() => null);
      const currentId = config?.workspace_id || null;
      res.json({
        workspaces: workspaces.map((w) => ({
          ...w,
          is_current: w.id === currentId,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Templates ──

  router.get('/templates', (_req, res) => {
    try {
      const templates = reader.listTemplates();
      res.json({ templates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/templates/:name', (req, res) => {
    try {
      const template = reader.readTemplate(req.params.name);
      res.json({ template });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Extract entities from a template (inline → entity file)
  router.post('/templates/:name/extract', (req, res) => {
    try {
      const template = reader.readTemplate(req.params.name);
      const { agents, skills, autopilots } = req.body || {};

      // Normalize: arrays of names to extract
      const agentNames: string[] = agents || [];
      const skillNames: string[] = skills || [];
      const autopilotNames: string[] = autopilots || [];

      if (agentNames.length === 0 && skillNames.length === 0 && autopilotNames.length === 0) {
        res.status(400).json({ error: 'Specify at least one entity name to extract: agents, skills, or autopilots' });
        return;
      }

      const extracted: string[] = [];
      const templateSkills = template.skills || [];

      // Helper: extract a single skill from template if it exists
      function extractSkill(skillName: string): boolean {
        if (extracted.some((r) => r === `skill/${skillName}@1.0.0`)) return true;
        if (registry.exists(`skill/${skillName}@1.0.0`)) return true;
        const skill = templateSkills.find((s: any) => s.name === skillName);
        if (!skill) return false;
        try {
          registry.save({
            entity: 'skill', schema_version: '1.0', name: skill.name, version: '1.0.0',
            description: skill.description, config: skill.config,
            files: skill.files?.map((f: any) => ({ path: f.path, content: f.content })),
          });
          extracted.push(`skill/${skillName}@1.0.0`);
        } catch {}
        return true;
      }

      // Extract agents (auto-extract their referenced skills)
      for (const name of agentNames) {
        const agent = template.agents.find((a: any) => a.name === name);
        if (!agent) { res.status(404).json({ error: `Agent "${name}" not found in template` }); return; }
        if (agent.skills?.length) for (const sn of agent.skills as string[]) extractSkill(sn);
        registry.save({
          entity: 'agent', schema_version: '1.0', name: agent.name, version: '1.0.0',
          description: agent.description, instructions: agent.instructions,
          model: agent.model, runtime_provider: agent.runtime_provider,
          visibility: agent.visibility || 'private',
          custom_args: agent.custom_args?.length ? agent.custom_args : undefined,
          custom_env_template: agent.custom_env_template,
          skills: agent.skills?.length ? Object.fromEntries((agent.skills as string[]).map((s) => [s, '^1.0.0'])) : undefined,
        });
        extracted.push(`agent/${name}@1.0.0`);
      }

      // Extract skills
      for (const name of skillNames) extractSkill(name);

      // Extract autopilots (auto-extract their agent + agent's skills)
      for (const name of autopilotNames) {
        const ap = template.autopilots.find((a: any) => a.title === name);
        if (!ap) { res.status(404).json({ error: `Autopilot "${name}" not found in template` }); return; }
        const agentName = ap.agent_ref;
        const agent = template.agents.find((a: any) => a.name === agentName);
        if (agent && !extracted.some((r) => r.startsWith(`agent/${agentName}@`))) {
          if (agent.skills?.length) for (const sn of agent.skills as string[]) extractSkill(sn);
          registry.save({
            entity: 'agent', schema_version: '1.0', name: agent.name, version: '1.0.0',
            description: agent.description, instructions: agent.instructions,
            model: agent.model, runtime_provider: agent.runtime_provider,
            visibility: agent.visibility || 'private',
            skills: agent.skills?.length ? Object.fromEntries((agent.skills as string[]).map((s) => [s, '^1.0.0'])) : undefined,
          });
          extracted.push(`agent/${agentName}@1.0.0`);
        }
        registry.save({
          entity: 'autopilot', schema_version: '1.0',
          name: ap.title.toLowerCase().replace(/\s+/g, '-'), version: '1.0.0',
          title: ap.title, description: ap.description, mode: ap.mode,
          agent_ref: `agent/${ap.agent_ref}@^1.0.0`, triggers: ap.triggers,
        });
        extracted.push(`autopilot/${ap.title}@1.0.0`);
      }

      res.json({ ok: true, extracted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Runtimes ──

  router.get('/runtimes', async (req, res) => {
    try {
      const ws = req.query.ws as string;
      if (!ws) {
        res.status(400).json({ error: 'Missing ws (workspace_id) query parameter' });
        return;
      }
      const runtimes = await cli.listRuntimes(ws);
      res.json({ runtimes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Import ──

  router.post('/import/dry-run', async (req, res) => {
    try {
      const opts = req.body as ImportOptions;
      if (!opts.template_name || !opts.workspace_id) {
        res.status(400).json({ error: 'Missing template_name or workspace_id' });
        return;
      }
      const result = await importer.dryRun(opts);
      res.json({ dry_run: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/import/apply', async (req, res) => {
    try {
      const opts = req.body as ImportOptions;
      if (!opts.template_name || !opts.workspace_id || !opts.runtime_map) {
        res.status(400).json({ error: 'Missing template_name, workspace_id, or runtime_map' });
        return;
      }

      // Stream NDJSON progress events
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');

      const result = await importer.apply(opts, (evt) => {
        res.write(JSON.stringify(evt) + '\n');
      });

      // Write final result
      res.write(JSON.stringify({ done: true, result }) + '\n');
      res.end();
    } catch (err: any) {
      // If headers not sent yet, send JSON error
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(JSON.stringify({ error: err.message }) + '\n');
        res.end();
      }
    }
  });

  // ── Servers ──

  router.get('/servers', (_req, res) => {
    try {
      res.json({ servers: servers.list(), current: servers.getCurrent() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/servers', (req, res) => {
    try {
      const { name, server_url, app_url, token, workspace_id } = req.body;
      if (!server_url || !token) {
        res.status(400).json({ error: 'server_url and token are required' });
        return;
      }
      const profile = servers.add({ name, server_url, app_url, token, workspace_id });
      res.json({ server: profile });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/servers/:id', (req, res) => {
    try {
      const ok = servers.remove(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/servers/:id/switch', (req, res) => {
    try {
      const profile = servers.switchTo(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json({ server: profile, switched: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/servers/:id/default', (req, res) => {
    try {
      const profile = servers.setDefault(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json({ server: profile });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Fork an entity (bump version + save as copy)
  router.post('/entities/fork', (req, res) => {
    try {
      const { ref, bump } = req.body;
      if (!ref) { res.status(400).json({ error: 'Missing ref' }); return; }
      const entry = registry.fork(ref, bump || 'patch');
      res.json({ ok: true, entry });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Export ──

  router.post('/export/preview', async (req, res) => {
    try {
      const { workspace_id, options } = req.body;
      if (!workspace_id) {
        res.status(400).json({ error: 'Missing workspace_id' });
        return;
      }
      const template = await exporter.preview(workspace_id, options as ExportOptions);
      res.json({ template });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/export/apply', async (req, res) => {
    try {
      const { workspace_id, name, options } = req.body;
      if (!workspace_id || !name) {
        res.status(400).json({ error: 'Missing workspace_id or name' });
        return;
      }
      const exportOpts = options || {};
      // Accept both old ExportOptions and new ExportOptionsV2
      if (exportOpts.mode) {
        const result = await exporter.apply(workspace_id, name, exportOpts);
        res.json(result);
      } else {
        const result = await exporter.apply(workspace_id, name, exportOpts);
        res.json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Entity Browser ──

  router.get('/entities', (req, res) => {
    try {
      const filter: any = {};
      if (req.query.type) filter.type = req.query.type;
      if (req.query.namespace) filter.namespace = req.query.namespace;
      if (req.query.q) filter.name_contains = req.query.q;
      if (req.query.source) filter.source = req.query.source;
      const entities = registry.list(Object.keys(filter).length > 0 ? filter : undefined);
      res.json({ entities });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/entities/:type/:name', (req, res) => {
    try {
      const version = req.query.version as string | undefined;
      const namespace = (req.query.namespace as string) || 'multica';
      const refStr = `${namespace}/${req.params.type}/${req.params.name}` + (version ? `@${version}` : '');
      const ref = parseEntityRef(refStr);
      const entity = registry.loadByRef(ref);
      res.json({ entity, ref: refStr });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post('/entities/validate', (req, res) => {
    try {
      const { content, file_path } = req.body;
      let result;
      if (file_path) {
        result = validator.validateFile(file_path);
      } else if (content) {
        result = validator.validateString(content);
      } else {
        res.status(400).json({ error: 'Provide content or file_path' });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/entities/import', (req, res) => {
    try {
      const { content, file_path } = req.body;
      if (!content && !file_path) {
        res.status(400).json({ error: 'Provide content or file_path' });
        return;
      }

      // Validate first
      const vr = file_path ? validator.validateFile(file_path) : validator.validateString(content);
      if (!vr.valid) {
        res.status(400).json({ error: 'Entity validation failed', validation: vr });
        return;
      }

      // Parse and save
      const raw = file_path
        ? parseYaml(readFileSync(file_path, 'utf-8'), { maxAliasCount: 100 })
        : parseYaml(content, { maxAliasCount: 100 });

      // Normalize: ensure namespace is set
      if (!raw.namespace) raw.namespace = 'multica';

      const entry = registry.save(raw as import('../types/entity.js').Entity);
      res.json({ ok: true, entry });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/entities/:type/:name/:version', (req, res) => {
    try {
      const namespace = (req.query.namespace as string) || 'multica';
      const refStr = `${namespace}/${req.params.type}/${req.params.name}@${req.params.version}`;
      registry.delete(refStr);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
