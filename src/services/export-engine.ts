import type { Template, TemplateAgent, TemplateAutopilot, TemplateAutopilotTrigger } from '../types/template.js';
import type { MulticaAutopilotDetail } from '../types/multica.js';
import { WorkspaceScanner } from './workspace-scanner.js';
import { TemplateWriter } from './template-writer.js';
import * as cli from './cli.js';

export class ExportEngine {
  constructor(
    private scanner: WorkspaceScanner,
    private writer: TemplateWriter,
    private workspaceId?: string,
  ) {}

  async preview(workspaceId: string): Promise<Template> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    return this.buildTemplate('Exported', state, triggersMap);
  }

  async apply(workspaceId: string, name: string): Promise<string> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const template = this.buildTemplate(name, state, triggersMap);
    return this.writer.saveTemplate(template, `${name.toLowerCase().replace(/\s+/g, '-')}.yaml`);
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
      version: '1.0',
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
