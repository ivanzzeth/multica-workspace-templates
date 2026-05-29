/**
 * ExportEngine — exports workspace configurations as templates.
 *
 * Supports three export modes:
 *   inline:    v1-compatible monolithic YAML (all inline, no entity refs)
 *   reference: v2 manifest with entity refs only
 *   mixed:     v2 manifest with BOTH inline definitions AND entity refs (default)
 */

import type {
  TemplateV2, TemplateAgent, TemplateAutopilot, TemplateAutopilotTrigger,
  TemplateSkill, TemplateSkillFile, ExportOptions, ExportOptionsV2, EntityRefEntry,
} from '../types/template.js';
import type { MulticaAutopilotDetail, MulticaSkillDetail } from '../types/multica.js';
import type { SkillEntity, AgentEntity, AutopilotEntity } from '../types/entity.js';
import { TemplateReader } from './template-reader.js';
import { WorkspaceScanner } from './workspace-scanner.js';
import { TemplateWriter } from './template-writer.js';
import { EntityRegistry } from './entity-registry.js';
import { EntityValidator } from './entity-validator.js';
import * as cli from './cli.js';

type WorkspaceState = Awaited<ReturnType<WorkspaceScanner['scanWorkspace']>>;

export class ExportEngine {
  private registry: EntityRegistry;

  constructor(
    private scanner: WorkspaceScanner,
    private writer: TemplateWriter,
    private reader?: TemplateReader,
    workspaceId?: string,
    registry?: EntityRegistry,
  ) {
    this.registry = registry || new EntityRegistry();
  }

  async preview(workspaceId: string, opts?: ExportOptionsV2): Promise<TemplateV2> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const skillsDetail = opts?.skills !== false ? await this.fetchSkillDetails(state) : undefined;
    return this.buildTemplateV2('Exported', state, triggersMap, skillsDetail, opts);
  }

  async apply(
    workspaceId: string,
    name: string,
    opts?: ExportOptionsV2,
  ): Promise<{ saved_to: string; version: string; entities_saved: number; mode: string }> {
    const state = await this.scanner.scanWorkspace(workspaceId);
    const triggersMap = await this.fetchTriggers(state.autopilots.map((a) => a.id), workspaceId);
    const skillsDetail = opts?.skills !== false ? await this.fetchSkillDetails(state) : undefined;
    const version = this.nextVersion(name, opts);

    const template = this.buildTemplateV2(name, state, triggersMap, skillsDetail, opts);
    const filename = `${name.toLowerCase().replace(/\s+/g, '-')}.yaml`;
    const saved_to = this.writer.saveTemplateV2(template, filename);

    let entitiesSaved = 0;
    if (opts?.mode === 'reference' || opts?.mode === 'mixed') {
      entitiesSaved = await this.saveEntities(state, skillsDetail, triggersMap, opts);
    }

    return { saved_to, version, entities_saved: entitiesSaved, mode: opts?.mode || 'inline' };
  }

  // ── Template Building ──

  private buildTemplateV2(
    name: string,
    state: WorkspaceState,
    triggersMap: Map<string, TemplateAutopilotTrigger[]>,
    skillsDetail: Map<string, MulticaSkillDetail> | undefined,
    opts?: ExportOptionsV2,
  ): TemplateV2 {
    const mode = opts?.mode || 'mixed';
    const rtProvider = new Map<string, string>();
    for (const r of state.runtimes) rtProvider.set(r.id, r.provider);

    const agentNameMap = new Map<string, string>();
    for (const a of state.agents) agentNameMap.set(a.id, a.name);

    const agentMode = opts?.agent_mode || {};
    const skillMode = opts?.skill_mode || {};
    const apMode = opts?.autopilot_mode || {};

    const inlineAgents: TemplateAgent[] = [];
    const entityRefs: EntityRefEntry[] = [];

    for (const agent of state.agents) {
      const am = agentMode[agent.name] || (mode === 'reference' ? 'entity' : 'inline');
      if (am === 'inline') {
        inlineAgents.push(this.inlineAgent(agent, rtProvider));
      } else {
        entityRefs.push({ ref: `agent/${agent.name}@${this.nextEntVersion('agent', agent.name)}` });
      }
    }

    const inlineSkills: TemplateSkill[] = [];
    if (skillsDetail) {
      for (const detail of skillsDetail.values()) {
        const sm = skillMode[detail.name] || (mode === 'reference' ? 'entity' : 'inline');
        if (sm === 'inline') {
          inlineSkills.push(this.inlineSkill(detail));
        } else {
          entityRefs.push({ ref: `skill/${detail.name}@${this.nextEntVersion('skill', detail.name)}` });
        }
      }
    }

    const inlineAPs: TemplateAutopilot[] = [];
    for (const ap of state.autopilots) {
      const am = apMode[ap.title] || (mode === 'reference' ? 'entity' : 'inline');
      if (am === 'inline') {
        inlineAPs.push(this.inlineAutopilot(ap, triggersMap, agentNameMap));
      } else {
        entityRefs.push({ ref: `autopilot/${ap.title.toLowerCase().replace(/\s+/g, '-')}@${this.nextEntVersion('autopilot', ap.title)}` });
      }
    }

    const incA = opts?.agents !== false;
    const incS = opts?.skills !== false;
    const incAP = opts?.autopilots !== false;
    const incP = opts?.projects === true;
    const incL = opts?.labels === true;

    return {
      schema_version: '2.0',
      name,
      description: mode === 'inline' ? 'Exported from Multica workspace' : `Exported from Multica workspace (${mode} mode)`,
      metadata: { tags: mode === 'reference' ? ['entity-refs'] : mode === 'mixed' ? ['mixed'] : [] },
      agents: incA ? inlineAgents : [],
      skills: incS ? inlineSkills : [],
      autopilots: incAP ? inlineAPs : [],
      projects: incP ? state.projects.map((p: any) => {
        const res = state.projectResources.get(p.id);
        return { title: p.title, description: p.description || '', status: p.status, ...(res?.length ? { resources: res.map((r: any) => ({ resource_type: r.resource_type, resource_ref: r.resource_ref })) } : {}) };
      }) : [],
      labels: incL ? state.labels.map((l: any) => ({ name: l.name, color: l.color })) : [],
      runtime_mapping: { claude: { display_name: 'Claude' }, cursor: { display_name: 'Cursor' }, codex: { display_name: 'Codex' }, opencode: { display_name: 'Opencode' }, openclaw: { display_name: 'Openclaw' }, hermes: { display_name: 'Hermes' } },
      includes: entityRefs.length > 0 ? { entities: entityRefs } : undefined,
    };
  }

  // ── Entity Extraction ──

  private async saveEntities(
    state: WorkspaceState,
    skillsDetail: Map<string, MulticaSkillDetail> | undefined,
    triggersMap: Map<string, TemplateAutopilotTrigger[]>,
    opts?: ExportOptionsV2,
  ): Promise<number> {
    let saved = 0;
    const mode = opts?.mode || 'mixed';
    const rtProvider = new Map<string, string>();
    for (const r of state.runtimes) rtProvider.set(r.id, r.provider);
    const agentNameMap = new Map<string, string>();
    for (const a of state.agents) agentNameMap.set(a.id, a.name);

    const agentMode = opts?.agent_mode || {};
    const skillMode = opts?.skill_mode || {};
    const apMode = opts?.autopilot_mode || {};

    for (const agent of state.agents) {
      if ((agentMode[agent.name] || (mode === 'reference' ? 'entity' : 'inline')) !== 'entity') continue;
      const a: AgentEntity = {
        entity: 'agent', schema_version: '1.0', name: agent.name,
        version: this.nextEntVersion('agent', agent.name),
        description: agent.description, instructions: agent.instructions,
        model: agent.model, runtime_provider: rtProvider.get(agent.runtime_id) || 'unknown',
        visibility: agent.visibility || 'private',
        custom_args: agent.custom_args?.length ? agent.custom_args : undefined,
        custom_env_template: this.sanitizeEnv(agent.custom_env),
        skills: agent.skills?.length ? Object.fromEntries(agent.skills.map((s: any) => [s.name, '^1.0.0'])) : undefined,
        max_concurrent_tasks: agent.max_concurrent_tasks !== 6 ? agent.max_concurrent_tasks : undefined,
        runtime_config: Object.keys(agent.runtime_config || {}).length > 0 ? agent.runtime_config : undefined,
        mcp_config: agent.mcp_config ? this.sanitizeMcpConfig(agent.mcp_config) : null,
      };
      this.registry.save(a); saved++;
    }

    if (skillsDetail) {
      for (const detail of skillsDetail.values()) {
        if ((skillMode[detail.name] || (mode === 'reference' ? 'entity' : 'inline')) !== 'entity') continue;
        const files = detail.files?.length ? detail.files.map((f: any) => ({ path: f.path, content: f.content })) : detail.content ? [{ path: 'SKILL.md', content: detail.content }] : [];
        const s: SkillEntity = {
          entity: 'skill', schema_version: '1.0', name: detail.name,
          version: this.nextEntVersion('skill', detail.name),
          description: detail.description,
          config: Object.keys(detail.config || {}).length > 0 ? detail.config : undefined,
          files: files.length > 0 ? files : undefined,
        };
        this.registry.save(s); saved++;
      }
    }

    for (const ap of state.autopilots) {
      if ((apMode[ap.title] || (mode === 'reference' ? 'entity' : 'inline')) !== 'entity') continue;
      const apAgentName = agentNameMap.get(ap.assignee_id) || 'unknown';
      const triggers = triggersMap.get(ap.id);
      const apE: AutopilotEntity = {
        entity: 'autopilot', schema_version: '1.0',
        name: ap.title.toLowerCase().replace(/\s+/g, '-'),
        version: this.nextEntVersion('autopilot', ap.title),
        title: ap.title, description: ap.description,
        mode: ap.execution_mode as 'run_only' | 'create_issue',
        agent_ref: `agent/${apAgentName}@^1.0.0`, triggers,
      };
      this.registry.save(apE); saved++;
    }
    return saved;
  }

  // ── Inline builders ──

  private inlineAgent(a: any, rpm: Map<string, string>): TemplateAgent {
    return {
      name: a.name, description: a.description, instructions: a.instructions,
      model: a.model, runtime_provider: rpm.get(a.runtime_id) || 'unknown',
      visibility: a.visibility, custom_args: a.custom_args?.length ? a.custom_args : undefined,
      custom_env_template: this.sanitizeEnv(a.custom_env),
      skills: a.skills?.map((s: any) => s.name).filter(Boolean),
      max_concurrent_tasks: a.max_concurrent_tasks !== 6 ? a.max_concurrent_tasks : undefined,
      runtime_config: Object.keys(a.runtime_config || {}).length > 0 ? a.runtime_config : undefined,
      mcp_config: a.mcp_config ? this.sanitizeMcpConfig(a.mcp_config) : null,
    };
  }

  private inlineSkill(d: MulticaSkillDetail): TemplateSkill {
    const files: TemplateSkillFile[] | undefined = d.files?.length
      ? d.files.map((f: any) => ({ path: f.path, content: f.content }))
      : d.content ? [{ path: 'SKILL.md', content: d.content }] : undefined;
    return { name: d.name, description: d.description, config: Object.keys(d.config || {}).length > 0 ? d.config : undefined, ...(files ? { files } : {}) };
  }

  private inlineAutopilot(ap: any, tm: Map<string, TemplateAutopilotTrigger[]>, nm: Map<string, string>): TemplateAutopilot {
    const triggers = tm.get(ap.id);
    return { title: ap.title, description: ap.description, agent_ref: nm.get(ap.assignee_id) || 'unknown', mode: ap.execution_mode as 'run_only' | 'create_issue', ...(triggers ? { triggers } : {}) };
  }

  // ── Helpers ──

  private nextVersion(name: string, opts?: ExportOptionsV2): string {
    if (!this.reader) return '1.0';
    const candidates = [name, name.toLowerCase().replace(/\s+/g, '-')];
    for (const c of candidates) {
      try {
        const existing = this.reader.readTemplate(c);
        const v = ('version' in existing ? (existing as any).version : undefined) || existing.schema_version || '1.0';
        const [maj, min] = v.split('.').map(Number);
        return min === 99 ? `${(maj || 1) + 1}.0` : `${maj || 1}.${(min || 0) + 1}`;
      } catch { continue; }
    }
    return '1.0';
  }

  private nextEntVersion(type: string, name: string): string {
    try {
      const versions = this.registry.listVersions({ type: type as any, name } as any);
      if (versions.length > 0) {
        const [maj, min] = versions[versions.length - 1].split('.');
        return `${maj}.${(parseInt(min || '0', 10)) + 1}.0`;
      }
    } catch {}
    return '1.0.0';
  }

  private async fetchTriggers(ids: string[], wsId: string): Promise<Map<string, TemplateAutopilotTrigger[]>> {
    const m = new Map<string, TemplateAutopilotTrigger[]>();
    for (const id of ids) {
      try {
        const d: MulticaAutopilotDetail = await cli.getAutopilotDetail(id, wsId);
        const ts = d.triggers.filter((t: any) => t.enabled && t.kind === 'schedule').map((t: any) => ({ cron: t.cron_expression, timezone: t.timezone, ...(t.label ? { label: t.label } : {}) }));
        if (ts.length > 0) m.set(id, ts);
      } catch {}
    }
    return m;
  }

  private async fetchSkillDetails(state: WorkspaceState): Promise<Map<string, MulticaSkillDetail>> {
    const ids = new Set<string>();
    for (const a of state.agents) { for (const s of a.skills || []) ids.add(s.id); }
    if (ids.size === 0) return new Map();
    const m = new Map<string, MulticaSkillDetail>();
    const wsId = state.agents[0]?.workspace_id || '';
    for (const id of ids) { try { m.set(id, await cli.getSkill(id, wsId)); } catch {} }
    return m;
  }

  private sanitizeEnv(e: Record<string, string>): Record<string, string> | undefined {
    if (!e || Object.keys(e).length === 0) return undefined;
    const s: Record<string, string> = {};
    for (const k of Object.keys(e)) s[k] = `\${${k}}`;
    return s;
  }

  private sanitizeMcpConfig(c: Record<string, any>): Record<string, string> | null {
    if (!c || Object.keys(c).length === 0) return null;
    const s: Record<string, string> = {};
    for (const k of Object.keys(c)) s[k] = `\${${k}}`;
    return s;
  }
}
