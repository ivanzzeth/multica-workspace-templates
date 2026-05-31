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
  source?: 'builtin' | 'user';
  entity_ref_count?: number;
  mode?: 'inline' | 'reference' | 'mixed';
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
  includes?: {
    entities?: Array<{ ref: string; hash?: string; overrides?: Record<string, any> }>;
  };
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
  visibility?: string;
  skills?: string[];
  custom_env_template?: Record<string, string>;
  custom_args?: string[];
}

export interface TemplateProject {
  title: string;
  description: string;
  status: string;
  resources?: {
    resource_type: string;
    resource_ref: Record<string, any>;
  }[];
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

export interface EntitySummary {
  ref: string;
  type: 'skill' | 'agent' | 'autopilot';
  namespace: string;
  name: string;
  version: string;
  description: string;
  source: string;
  size: number;
  imported_at: string;
  deps_info?: string;
  tags?: string[];
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

  const exportPreview = useCallback(async (workspaceId: string, options?: any) => {
    const res = await fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, options }),
    });
    const data = await res.json();
    return data.template as TemplateDetail;
  }, []);

  const exportApply = useCallback(async (workspaceId: string, name: string, options?: any) => {
    const res = await fetch('/api/export/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name, options }),
    });
    const data = await res.json();
    return data as { saved_to: string; version: string; entities_saved?: number; mode?: string };
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

  // ── Entities ──

  const fetchEntities = useCallback(async (filter?: Record<string, string>) => {
    const params = new URLSearchParams(filter || {});
    const res = await fetch(`/api/entities?${params}`);
    const data = await res.json();
    return data.entities as EntitySummary[];
  }, []);

  const fetchEntity = useCallback(async (type: string, name: string, version?: string, namespace?: string) => {
    const params = new URLSearchParams();
    if (version) params.set('version', version);
    if (namespace) params.set('namespace', namespace);
    const qs = params.toString();
    const res = await fetch(`/api/entities/${encodeURIComponent(type)}/${encodeURIComponent(name)}${qs ? '?' + qs : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data as { entity: any; ref: string };
  }, []);

  const validateEntity = useCallback(async (content?: string, filePath?: string) => {
    const res = await fetch('/api/entities/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, file_path: filePath }),
    });
    const data = await res.json();
    return data as { valid: boolean; entity_type?: string; issues: Array<{ severity: string; field?: string; message: string }> };
  }, []);

  const importEntity = useCallback(async (content?: string, filePath?: string) => {
    const res = await fetch('/api/entities/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, file_path: filePath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data as { ok: boolean; entry: any };
  }, []);

  const forkEntity = useCallback(async (ref: string, bump?: string) => {
    const res = await fetch(`/api/entities/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, bump: bump || 'patch' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || JSON.stringify(data));
    return data as { ok: boolean; entry: any };
  }, []);

  const extractEntities = useCallback(async (templateName: string, agents?: string[], skills?: string[], autopilots?: string[]) => {
    const res = await fetch(`/api/templates/${encodeURIComponent(templateName)}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents, skills, autopilots }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || JSON.stringify(data));
    return data as { ok: boolean; extracted: string[] };
  }, []);

  const deleteEntity = useCallback(async (type: string, name: string, version: string, namespace?: string) => {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    const res = await fetch(`/api/entities/${encodeURIComponent(type)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}${params}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
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
    fetchEntities,
    fetchEntity,
    validateEntity,
    importEntity,
    forkEntity,
    extractEntities,
    deleteEntity,
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
