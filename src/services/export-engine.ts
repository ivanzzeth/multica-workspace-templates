import type { Template, TemplateAgent, TemplateAutopilot, TemplateAutopilotTrigger } from '../types/template.js';
import type { MulticaAutopilotDetail } from '../types/multica.js';
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

  async preview(workspaceId: string): Promise<Template> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    return this.buildTemplate('Exported', state, triggersMap);
  }

  async apply(workspaceId: string, name: string): Promise<{ saved_to: string; version: string }> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const version = this.nextVersion(name);
    const template = this.buildTemplate(name, state, triggersMap, version);
    const saved_to = this.writer.saveTemplate(template, `${name.toLowerCase().replace(/\s+/g, '-')}.yaml`);
    return { saved_to, version };
  }

  private nextVersion(name: string): string {
    if (!this.reader) return '1.0';
    // Try original name first, then kebab-case (matching saveTemplate filename logic)
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

  private buildTemplate(
    name: string,
    state: Awaited<ReturnType<WorkspaceScanner['scanWorkspace']>>,
    triggersMap: Map<string, TemplateAutopilotTrigger[]>,
    version?: string,
  ): Template {
    const runtimeProviderMap = new Map<string, string>();
    for (const r of state.runtimes) {
      runtimeProviderMap.set(r.id, r.provider);
    }

    const agents: TemplateAgent[] = state.agents.map((a) => ({
      name: a.name,
      description: a.description,
      instructions: a.instructions,
      model: a.model,
      runtime_provider: runtimeProviderMap.get(a.runtime_id) || 'unknown',
      custom_args: a.custom_args?.length ? a.custom_args : undefined,
      custom_env_template: this.sanitizeEnv(a.custom_env),
    }));

    const agentNameMap = new Map<string, string>();
    for (const a of state.agents) {
      agentNameMap.set(a.id, a.name);
    }

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

    return {
      version: version || '1.0',
      name,
      description: `Exported from Multica workspace`,
      agents,
      projects: state.projects.map((p) => ({
        title: p.title,
        description: p.description || '',
        status: p.status,
      })),
      labels: state.labels.map((l) => ({
        name: l.name,
        color: l.color,
      })),
      autopilots,
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
}
