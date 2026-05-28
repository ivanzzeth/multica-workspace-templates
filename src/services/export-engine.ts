import type { Template, TemplateAgent, TemplateAutopilot, TemplateAutopilotTrigger, TemplateSkill, TemplateSkillFile, ExportOptions } from '../types/template.js';
import type { MulticaAutopilotDetail, MulticaSkillDetail } from '../types/multica.js';
import { TemplateReader } from './template-reader.js';
import { WorkspaceScanner } from './workspace-scanner.js';
import { TemplateWriter } from './template-writer.js';
import * as cli from './cli.js';

export class ExportEngine {
  constructor(
    private scanner: WorkspaceScanner,
    private writer: TemplateWriter,
    private reader?: TemplateReader,
    private workspaceId?: string,
  ) {}

  async preview(workspaceId: string, opts?: ExportOptions): Promise<Template> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const skillsDetail = opts?.skills !== false ? await this.fetchSkillDetails(state) : undefined;
    return this.buildTemplate('Exported', state, triggersMap, skillsDetail, '1.0', opts);
  }

  async apply(workspaceId: string, name: string, opts?: ExportOptions): Promise<{ saved_to: string; version: string }> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const skillsDetail = opts?.skills !== false ? await this.fetchSkillDetails(state) : undefined;
    const version = this.nextVersion(name);
    const template = this.buildTemplate(name, state, triggersMap, skillsDetail, version, opts);
    const saved_to = this.writer.saveTemplate(template, `${name.toLowerCase().replace(/\s+/g, '-')}.yaml`);
    return { saved_to, version };
  }

  private nextVersion(name: string): string {
    if (!this.reader) return '1.0';
    const candidates = [name, name.toLowerCase().replace(/\s+/g, '-')];
    for (const candidate of candidates) {
      try {
        const existing = this.reader.readTemplate(candidate);
        const v = existing.version || '1.0';
        const parts = v.split('.');
        const major = parseInt(parts[0], 10) || 1;
        const minor = parseInt(parts[1], 10) || 0;
        if (minor === 99) return `${major + 1}.0`;
        return `${major}.${minor + 1}`;
      } catch {
        continue;
      }
    }
    return '1.0';
  }

  private async fetchTriggers(
    autopilotIds: string[],
    workspaceId: string,
  ): Promise<Map<string, TemplateAutopilotTrigger[]>> {
    const map = new Map<string, TemplateAutopilotTrigger[]>();
    for (const id of autopilotIds) {
      try {
        const detail: MulticaAutopilotDetail = await cli.getAutopilotDetail(id, workspaceId);
        const triggers = detail.triggers
          .filter((t) => t.enabled && t.kind === 'schedule')
          .map((t) => ({
            cron: t.cron_expression,
            timezone: t.timezone,
            ...(t.label ? { label: t.label } : {}),
          }));
        if (triggers.length > 0) {
          map.set(id, triggers);
        }
      } catch {
        // Silently skip triggers for autopilots we can't read
      }
    }
    return map;
  }

  private async fetchSkillDetails(
    state: Awaited<ReturnType<WorkspaceScanner['scanWorkspace']>>,
  ): Promise<Map<string, MulticaSkillDetail>> {
    const referencedIds = new Set<string>();
    for (const agent of state.agents) {
      if (agent.skills?.length) {
        for (const s of agent.skills) {
          referencedIds.add(s.id);
        }
      }
    }
    if (referencedIds.size === 0) return new Map();

    const map = new Map<string, MulticaSkillDetail>();
    const wsId = state.agents[0]?.workspace_id || '';
    for (const id of referencedIds) {
      try {
        const detail = await cli.getSkill(id, wsId);
        map.set(id, detail);
      } catch {
        // Silently skip skills we can't read
      }
    }
    return map;
  }

  private buildTemplate(
    name: string,
    state: Awaited<ReturnType<WorkspaceScanner['scanWorkspace']>>,
    triggersMap: Map<string, TemplateAutopilotTrigger[]>,
    skillsDetail?: Map<string, MulticaSkillDetail>,
    version?: string,
    opts?: ExportOptions,
  ): Template {
    const runtimeProviderMap = new Map<string, string>();
    for (const r of state.runtimes) {
      runtimeProviderMap.set(r.id, r.provider);
    }

    // Build template skill definitions (with files) from fetched details
    const templateSkills: TemplateSkill[] = [];
    const skillIdForDetail = new Map<string, string>();
    if (skillsDetail) {
      for (const [id, detail] of skillsDetail) {
        skillIdForDetail.set(id, detail.name);
        // Skills may have files[] or a single content field
        const files: TemplateSkillFile[] | undefined = (detail.files?.length
          ? detail.files.map((f) => ({ path: f.path, content: f.content }))
          : detail.content
            ? [{ path: 'SKILL.md', content: detail.content }]
            : undefined);
        templateSkills.push({
          name: detail.name,
          description: detail.description,
          config: Object.keys(detail.config || {}).length > 0 ? detail.config : undefined,
          ...(files ? { files } : {}),
        });
      }
    }

    const agentNameMap = new Map<string, string>();
    for (const a of state.agents) {
      agentNameMap.set(a.id, a.name);
    }

    const agents: TemplateAgent[] = state.agents.map((a) => {
      const agentSkillNames = a.skills?.map((s) => s.name).filter(Boolean);
      return {
        name: a.name,
        description: a.description,
        instructions: a.instructions,
        model: a.model,
        runtime_provider: runtimeProviderMap.get(a.runtime_id) || 'unknown',
        ...(a.visibility ? { visibility: a.visibility } : {}),
        custom_args: a.custom_args?.length ? a.custom_args : undefined,
        custom_env_template: this.sanitizeEnv(a.custom_env),
        ...(agentSkillNames?.length ? { skills: agentSkillNames } : {}),
        ...(a.max_concurrent_tasks !== 6 ? { max_concurrent_tasks: a.max_concurrent_tasks } : {}),
        ...(a.runtime_config && Object.keys(a.runtime_config).length > 0 ? { runtime_config: a.runtime_config } : {}),
        ...(a.mcp_config ? { mcp_config: this.sanitizeMcpConfig(a.mcp_config) } : {}),
      };
    });

    const autopilots: TemplateAutopilot[] = state.autopilots.map((ap) => {
      const triggers = triggersMap.get(ap.id);
      return {
        title: ap.title,
        description: ap.description,
        agent_ref: agentNameMap.get(ap.assignee_id) || 'unknown',
        mode: ap.execution_mode as 'run_only' | 'create_issue',
        ...(triggers ? { triggers } : {}),
      };
    });

    const include = opts || { agents: true, autopilots: true, skills: true, projects: false, labels: false };

    return {
      version: version || '1.0',
      name,
      description: `Exported from Multica workspace`,
      agents: include.agents !== false ? agents : [],
      ...(include.skills !== false && templateSkills.length > 0 ? { skills: templateSkills } : {}),
      projects: include.projects === true
        ? state.projects.map((p) => {
            const resources = state.projectResources.get(p.id);
            return {
              title: p.title,
              description: p.description || '',
              status: p.status,
              ...(resources?.length
                ? { resources: resources.map((r) => ({ resource_type: r.resource_type, resource_ref: r.resource_ref })) }
                : {}),
            };
          })
        : [],
      labels: include.labels === true
        ? state.labels.map((l) => ({
            name: l.name,
            color: l.color,
          }))
        : [],
      autopilots: include.autopilots !== false ? autopilots : [],
      runtime_mapping: {
        claude: { display_name: 'Claude' },
        cursor: { display_name: 'Cursor' },
        codex: { display_name: 'Codex' },
        opencode: { display_name: 'Opencode' },
        openclaw: { display_name: 'Openclaw' },
        hermes: { display_name: 'Hermes' },
      },
    };
  }

  private sanitizeEnv(env: Record<string, string>): Record<string, string> | undefined {
    if (!env || Object.keys(env).length === 0) return undefined;
    const sanitized: Record<string, string> = {};
    for (const key of Object.keys(env)) {
      sanitized[key] = `\${${key}}`;
    }
    return sanitized;
  }

  private sanitizeMcpConfig(config: Record<string, any>): Record<string, string> | null {
    if (!config || Object.keys(config).length === 0) return null;
    const sanitized: Record<string, string> = {};
    for (const key of Object.keys(config)) {
      sanitized[key] = `\${${key}}`;
    }
    return sanitized;
  }
}
