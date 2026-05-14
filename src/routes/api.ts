import { Router } from 'express';
import * as cli from '../services/cli.js';
import { TemplateReader } from '../services/template-reader.js';
import { TemplateWriter } from '../services/template-writer.js';
import { WorkspaceScanner } from '../services/workspace-scanner.js';
import { ImportEngine } from '../services/import-engine.js';
import { ExportEngine } from '../services/export-engine.js';
import type { ImportOptions } from '../types/template.js';

export async function createApiRouter() {
  const router = Router();

  const reader = new TemplateReader();
  const writer = new TemplateWriter();
  const scanner = new WorkspaceScanner();
  const importer = new ImportEngine(reader, scanner);
  const exporter = new ExportEngine(scanner, writer, reader);

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
      const result = await importer.apply(opts);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Export ──

  router.post('/export/preview', async (req, res) => {
    try {
      const { workspace_id } = req.body;
      if (!workspace_id) {
        res.status(400).json({ error: 'Missing workspace_id' });
        return;
      }
      const template = await exporter.preview(workspace_id);
      res.json({ template });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/export/apply', async (req, res) => {
    try {
      const { workspace_id, name } = req.body;
      if (!workspace_id || !name) {
        res.status(400).json({ error: 'Missing workspace_id or name' });
        return;
      }
      const result = await exporter.apply(workspace_id, name);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
