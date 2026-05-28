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
  custom_env_template?: Record<string, string>;
  custom_args?: string[];
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

export interface ServerProfile {
  id: string;
  name: string;
  server_url: string;
  app_url: string;
  token: string;
  workspace_id: string;
  is_default: boolean;
}

export interface ExportOptions {
  agents: boolean;
  autopilots: boolean;
  skills: boolean;
  projects: boolean;
  labels: boolean;
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
      env_vars?: Record<string, string>;
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

  type ProgressCallback = (evt: {
    phase: string;
    current: number;
    total: number;
    item: string;
    action: string;
    errors: string[];
  }) => void;

  const applyImport = useCallback(
    async (
      opts: {
        template_name: string;
        workspace_id: string;
        runtime_map: { agent_name: string; runtime_provider: string; runtime_id: string; runtime_name: string }[];
        mode: string;
        env_vars?: Record<string, string>;
      },
      onProgress?: ProgressCallback,
    ): Promise<ImportResult> => {
      const res = await fetch('/api/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      // Read NDJSON stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalResult: ImportResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.done) {
              finalResult = json.result;
            } else if (json.error) {
              throw new Error(json.error);
            } else if (onProgress) {
              onProgress(json);
            }
          } catch (e: any) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (!finalResult) throw new Error('No result received');
      return finalResult;
    },
    [],
  );

  const exportPreview = useCallback(async (workspaceId: string, options?: ExportOptions) => {
    const res = await fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, options }),
    });
    const data = await res.json();
    return data.template as TemplateDetail;
  }, []);

  const exportApply = useCallback(async (workspaceId: string, name: string, options?: ExportOptions) => {
    const res = await fetch('/api/export/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name, options }),
    });
    const data = await res.json();
    return data as { saved_to: string; version: string };
  }, []);

  // ── Servers ──

  const fetchServers = useCallback(async () => {
    const res = await fetch('/api/servers');
    const data = await res.json();
    return data as { servers: ServerProfile[]; current: ServerProfile | null };
  }, []);

  const addServer = useCallback(async (input: {
    name: string;
    server_url: string;
    app_url?: string;
    token: string;
    workspace_id?: string;
  }) => {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (res.ok) return data.server as ServerProfile;
    throw new Error(data.error);
  }, []);

  const removeServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  }, []);

  const switchServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/servers/${encodeURIComponent(id)}/switch`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.server as ServerProfile;
  }, []);

  // ── Secrets ──

  const fetchSecrets = useCallback(async (serverId?: string) => {
    const url = serverId ? `/api/secrets?server=${encodeURIComponent(serverId)}` : '/api/secrets';
    const res = await fetch(url);
    const data = await res.json();
    return data as { secrets: Record<string, string>; server?: Record<string, string>; global?: Record<string, string> };
  }, []);

  const setSecret = useCallback(async (key: string, value: string, serverId?: string) => {
    const res = await fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, server_id: serverId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  }, []);

  const deleteSecret = useCallback(async (key: string, serverId?: string) => {
    const url = serverId
      ? `/api/secrets/${encodeURIComponent(key)}?server=${encodeURIComponent(serverId)}`
      : `/api/secrets/${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  }, []);

  const resolveSecrets = useCallback(async (env: Record<string, string>, serverId?: string) => {
    const res = await fetch('/api/secrets/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, server_id: serverId }),
    });
    const data = await res.json();
    return data.resolved as Record<string, string>;
  }, []);

  const saveSecretsToServer = useCallback(async (serverId: string, env: Record<string, string>) => {
    const res = await fetch('/api/secrets/save-to-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId, env }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data as { ok: boolean; saved: number };
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
    fetchServers,
    addServer,
    removeServer,
    switchServer,
    fetchSecrets,
    setSecret,
    deleteSecret,
    resolveSecrets,
    saveSecretsToServer,
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
