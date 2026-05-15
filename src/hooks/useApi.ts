import { useState, useEffect, useCallback } from 'react';

// ── Types ──

export interface Workspace {
  id: string;
  name: string;
  is_current: boolean;
}

export interface TemplateSummary {
  name: string;
  version: string;
  description: string;
  agent_count: number;
  project_count: number;
  label_count: number;
  autopilot_count: number;
  skill_count: number;
}

export interface TemplateDetail {
  version: string;
  name: string;
  description: string;
  agents: TemplateAgent[];
  projects: TemplateProject[];
  labels: TemplateLabel[];
  autopilots: TemplateAutopilot[];
  skills?: TemplateSkill[];
}

export interface TemplateSkill {
  name: string;
  description: string;
  config?: Record<string, any>;
  files?: TemplateSkillFile[];
}

export interface TemplateSkillFile {
  path: string;
  content: string;
}

export interface TemplateAgent {
  name: string;
  description: string;
  runtime_provider: string;
  model: string;
  skills?: string[];
}

export interface TemplateProject {
  title: string;
  description: string;
  status: string;
}

export interface TemplateLabel {
  name: string;
  color: string;
}

export interface TemplateAutopilot {
  title: string;
  description: string;
  agent_ref: string;
  mode: string;
  triggers?: TemplateAutopilotTrigger[];
}

export interface TemplateAutopilotTrigger {
  cron: string;
  timezone: string;
  label?: string;
}

export interface RuntimeInfo {
  id: string;
  name: string;
  provider: string;
  status: string;
}

export interface DryRunResult {
  agents: DryRunItem[];
  projects: DryRunItem[];
  labels: DryRunItem[];
  autopilots: DryRunItem[];
  skills: DryRunItem[];
}

export interface DryRunItem {
  name: string;
  action: 'create' | 'update' | 'skip';
  reason?: string;
}

export interface ImportResult {
  success: boolean;
  created: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  skipped: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  updated: { agents: number };
  errors: string[];
}

// ── API Hook ──

export function useApi() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);

  const fetchWorkspaces = useCallback(async () => {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    setWorkspaces(data.workspaces);
    return data.workspaces as Workspace[];
  }, []);

  const fetchTemplates = useCallback(async () => {
    const res = await fetch('/api/templates');
    const data = await res.json();
    setTemplates(data.templates);
    return data.templates as TemplateSummary[];
  }, []);

  const fetchTemplate = useCallback(async (name: string) => {
    const res = await fetch(`/api/templates/${encodeURIComponent(name)}`);
    const data = await res.json();
    return data.template as TemplateDetail;
  }, []);

  const fetchRuntimes = useCallback(async (wsId: string) => {
    const res = await fetch(`/api/runtimes?ws=${encodeURIComponent(wsId)}`);
    const data = await res.json();
    setRuntimes(data.runtimes);
    return data.runtimes as RuntimeInfo[];
  }, []);

  const dryRunImport = useCallback(
    async (opts: {
      template_name: string;
      workspace_id: string;
      runtime_map: { agent_name: string; runtime_provider: string; runtime_id: string; runtime_name: string }[];
      mode: string;
    }) => {
      const res = await fetch('/api/import/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      return data.dry_run as DryRunResult;
    },
    [],
  );

  const applyImport = useCallback(
    async (opts: {
      template_name: string;
      workspace_id: string;
      runtime_map: { agent_name: string; runtime_provider: string; runtime_id: string; runtime_name: string }[];
      mode: string;
    }) => {
      const res = await fetch('/api/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      return data.result as ImportResult;
    },
    [],
  );

  const exportPreview = useCallback(async (workspaceId: string) => {
    const res = await fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    const data = await res.json();
    return data.template as TemplateDetail;
  }, []);

  const exportApply = useCallback(async (workspaceId: string, name: string) => {
    const res = await fetch('/api/export/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name }),
    });
    const data = await res.json();
    return data as { saved_to: string; version: string };
  }, []);

  return {
    workspaces,
    templates,
    runtimes,
    fetchWorkspaces,
    fetchTemplates,
    fetchTemplate,
    fetchRuntimes,
    dryRunImport,
    applyImport,
    exportPreview,
    exportApply,
  };
}

export function agentActionColor(action: string): string {
  switch (action) {
    case 'create':
      return '#22c55e';
    case 'update':
      return '#eab308';
    case 'skip':
      return '#6b7280';
    default:
      return '#6b7280';
  }
}

export function agentActionLabel(action: string): string {
  switch (action) {
    case 'create':
      return 'Create';
    case 'update':
      return 'Update';
    case 'skip':
      return 'Skip';
    default:
      return '-';
  }
}
