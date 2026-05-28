import { Router } from 'express';
import * as cli from '../services/cli.js';
import { TemplateReader } from '../services/template-reader.js';
import { TemplateWriter } from '../services/template-writer.js';
import { WorkspaceScanner } from '../services/workspace-scanner.js';
import { ImportEngine } from '../services/import-engine.js';
import { ExportEngine } from '../services/export-engine.js';
import { ServerStore } from '../services/server-store.js';
import { SecretStore } from '../services/secret-store.js';
import type { ImportOptions, ExportOptions } from '../types/template.js';

export async function createApiRouter() {
  const router = Router();

  const reader = new TemplateReader();
  const writer = new TemplateWriter();
  const scanner = new WorkspaceScanner();
  const importer = new ImportEngine(reader, scanner);
  const exporter = new ExportEngine(scanner, writer, reader);
  const servers = new ServerStore();
  servers.seed();
  const secrets = new SecretStore();

  // ── Secrets ──

  router.get('/secrets', (_req, res) => {
    try {
      res.json({ secrets: secrets.list() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/secrets', (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        res.status(400).json({ error: 'key and value are required' });
        return;
      }
      secrets.set(key, value);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/secrets/:key', (req, res) => {
    try {
      const ok = secrets.delete(req.params.key);
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
      res.json({ resolved: secrets.resolve(env) });
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
      const result = await exporter.apply(workspace_id, name, options as ExportOptions);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
