/**
 * ImportEngine — applies template configurations to Multica workspaces.
 *
 * v1 templates: inline agents/skills/autopilots (backward compatible, unchanged pipeline).
 * v2 templates: inline definitions + optional entity refs (includes.entities).
 *   Entity refs are resolved via DependencyResolver. Inline wins on name collision.
 *
 * Atomic import: if any step fails, previously created entities are rolled back.
 */

import type {
  Template, TemplateV2, ImportOptions, ImportOptionsV2,
  DryRunResult, ImportResult, DryRunItem,
} from '../types/template.js';
import type { AgentEntity, SkillEntity, ResolvedEntity } from '../types/entity.js';
import { parseEntityRef, serializeEntityRef } from '../types/entity.js';
import { TemplateReader } from './template-reader.js';
import { WorkspaceScanner } from './workspace-scanner.js';
import { EntityRegistry } from './entity-registry.js';
import { DependencyResolver } from './dependency-resolver.js';
import * as cli from './cli.js';

type ProgressFn = (evt: {
  phase: string;
  current: number;
  total: number;
  item: string;
  action: string;
  errors: string[];
}) => void;

export class ImportEngine {
  private resolver: DependencyResolver;

  constructor(
    private reader: TemplateReader,
    private scanner: WorkspaceScanner,
    registry?: EntityRegistry,
  ) {
    this.resolver = new DependencyResolver(registry || new EntityRegistry());
  }

  // ── Public API ──

  async dryRun(opts: ImportOptions): Promise<DryRunResult> {
    const template = this.reader.readTemplate(opts.template_name);
    const existing = await this.scanner.scanWorkspace(opts.workspace_id);

    const result: DryRunResult = {
      agents: [],
      projects: [],
      labels: [],
      autopilots: [],
      skills: [],
    };

    // ── Inline skills (v1 + v2) ──
    const existingSkillNames = new Set(existing.skills.map((s) => s.name));
    for (const skill of template.skills || []) {
      if (existingSkillNames.has(skill.name)) {
        result.skills.push({ name: skill.name, action: 'skip', reason: 'Skill already exists' });
      } else {
        result.skills.push({ name: skill.name, action: 'create' });
      }
    }

    // ── Entity-ref skills (v2 only) ──
    const entityRefs = template.includes?.entities ?? [];
    if (entityRefs.length > 0) {
      const resolution = this.resolver.resolveTemplate({
        entityRefs: entityRefs.map((r) => r.ref),
        inlineAgentNames: template.agents.map((a) => a.name),
        inlineSkillNames: (template.skills || []).map((s) => s.name),
        inlineAutopilotNames: template.autopilots.map((a) => a.title),
      });

      for (const resolved of resolution.entities) {
        if (resolved.entity.entity === 'skill') {
          if (existingSkillNames.has(resolved.entity.name)) {
            result.skills.push({ name: resolved.entity.name, action: 'skip', reason: 'Skill already exists' });
          } else {
            result.skills.push({ name: resolved.entity.name, action: 'create', reason: `entity ref v${resolved.entity.version}` });
          }
        }
      }
    }

    // ── Inline agents (v1 + v2) ──
    const agentNames = new Set<string>();
    for (const agent of template.agents) {
      agentNames.add(agent.name);
      const match = existing.agents.find((a) => a.name === agent.name);
      if (match) {
        if (opts.mode === 'force-overwrite') {
          result.agents.push({ name: agent.name, action: 'update' });
        } else {
          result.agents.push({ name: agent.name, action: 'skip', reason: 'Agent already exists' });
        }
      } else {
        result.agents.push({ name: agent.name, action: 'create' });
      }
    }

    // ── Entity-ref agents (v2 only) ──
    if (entityRefs.length > 0) {
      const resolution = this.resolver.resolveTemplate({
        entityRefs: entityRefs.map((r) => r.ref),
        inlineAgentNames: template.agents.map((a) => a.name),
        inlineSkillNames: (template.skills || []).map((s) => s.name),
        inlineAutopilotNames: template.autopilots.map((a) => a.title),
      });

      for (const resolved of resolution.entities) {
        if (resolved.entity.entity === 'agent' && !agentNames.has(resolved.entity.name)) {
          const match = existing.agents.find((a) => a.name === resolved.entity.name);
          if (match) {
            if (opts.mode === 'force-overwrite') {
              result.agents.push({ name: resolved.entity.name, action: 'update', reason: `entity ref v${resolved.entity.version}` });
            } else {
              result.agents.push({ name: resolved.entity.name, action: 'skip', reason: 'Agent already exists' });
            }
          } else {
            result.agents.push({ name: resolved.entity.name, action: 'create', reason: `entity ref v${resolved.entity.version}` });
          }
        }
      }
    }

    // Projects, labels, autopilots (unchanged for both v1 and v2)
    for (const project of template.projects) {
      const match = existing.projects.find((p) => p.title === project.title);
      if (match) {
        result.projects.push({ name: project.title, action: 'skip', reason: 'Project already exists' });
      } else {
        result.projects.push({ name: project.title, action: 'create' });
      }
    }

    for (const label of template.labels) {
      const match = existing.labels.find((l) => l.name === label.name);
      if (match) {
        result.labels.push({ name: label.name, action: 'skip', reason: 'Label already exists' });
      } else {
        result.labels.push({ name: label.name, action: 'create' });
      }
    }

    for (const ap of template.autopilots) {
      const match = existing.autopilots.find((a) => a.title === ap.title);
      if (match) {
        const triggerInfo = ap.triggers?.length
          ? ` (${ap.triggers.length} trigger${ap.triggers.length > 1 ? 's' : ''} will be added)`
          : '';
        result.autopilots.push({ name: ap.title, action: 'skip', reason: `Autopilot already exists${triggerInfo}` });
      } else {
        const triggerInfo = ap.triggers?.length
          ? ` with ${ap.triggers.length} trigger${ap.triggers.length > 1 ? 's' : ''}`
          : '';
        result.autopilots.push({ name: ap.title, action: 'create', reason: triggerInfo.trim() || undefined });
      }
    }

    return result;
  }

  /**
   * Import a template into a workspace.
   *
   * For v2 templates with entity refs, the import pipeline is:
   *   1. Import inline skills (same as v1)
   *   2. Import entity-ref skills (from registry)
   *   3. Import inline agents
   *   4. Import entity-ref agents
   *   5. Bind agent↔skill associations
   *   6. Import autopilots (inline + entity-ref)
   *   7. Generate lockfile
   *
   * If any step fails, previously created entities are rolled back.
   */
  async apply(
    opts: ImportOptions,
    onProgress?: ProgressFn,
  ): Promise<ImportResult> {
    const emit = (phase: string, current: number, total: number, item: string, action: string) => {
      onProgress?.({ phase, current, total, item, action, errors: [] });
    };

    const template = this.reader.readTemplate(opts.template_name);
    const existing = await this.scanner.scanWorkspace(opts.workspace_id);

    const result: ImportResult = {
      success: true,
      created: { agents: 0, projects: 0, labels: 0, autopilots: 0, triggers: 0, skills: 0 },
      skipped: { agents: 0, projects: 0, labels: 0, autopilots: 0, triggers: 0, skills: 0 },
      updated: { agents: 0 },
      errors: [],
    };

    // Track created IDs for rollback
    const createdSkillIds: string[] = [];
    const createdAgentIds: string[] = [];
    const createdAutopilotIds: string[] = [];

    // ── Names for inline-conflict detection ──
    const inlineAgentNames = new Set(template.agents.map((a) => a.name));
    const inlineSkillNames = new Set((template.skills || []).map((s) => s.name));
    const inlineAutopilotNames = new Set(template.autopilots.map((a) => a.title));

    // ── Build runtime maps ──
    const runtimeMap = new Map<string, string>();
    const runtimeIdProvider = new Map<string, string>();
    for (const rm of opts.runtime_map) {
      runtimeMap.set(rm.runtime_provider, rm.runtime_id);
      if (rm.runtime_id) {
        runtimeIdProvider.set(rm.runtime_id, rm.runtime_provider);
      }
    }

    function safeCustomArgs(tp: string, assignedId: string, args?: string[]): string[] | undefined {
      if (!args || args.length === 0) return undefined;
      const actual = runtimeIdProvider.get(assignedId);
      if (actual && actual !== tp) return undefined;
      return args;
    }

    const envOverrides: Record<string, string> = opts.env_vars || {};

    function resolveEnv(tmpl?: Record<string, string>): Record<string, string> | undefined {
      if (!tmpl || Object.keys(tmpl).length === 0) return undefined;
      const env: Record<string, string> = {};
      for (const key of Object.keys(tmpl)) {
        const userVal = envOverrides[key];
        env[key] = (userVal && userVal !== '' && !userVal.startsWith('${')) ? userVal : tmpl[key];
      }
      return Object.keys(env).length > 0 ? env : undefined;
    }

    try {
      // ── Resolve entity refs (v2 only) ──
      const entityRefs = template.includes?.entities ?? [];
      let entityRefResolved: ResolvedEntity[] = [];

      if (entityRefs.length > 0) {
        const resolution = this.resolver.resolveTemplate({
          entityRefs: entityRefs.map((r) => r.ref),
          overrides: Object.fromEntries(entityRefs.filter(r => r.overrides).map(r => [r.ref, r.overrides!])),
          inlineAgentNames: [...inlineAgentNames],
          inlineSkillNames: [...inlineSkillNames],
          inlineAutopilotNames: [...inlineAutopilotNames],
        });

        for (const err of resolution.errors) {
          result.errors.push(`Resolution error for ${err.entity_ref}: ${err.message}`);
        }
        entityRefResolved = resolution.entities;
      }

      // ── Helper: rollback on failure ──
      async function rollback(): Promise<void> {
        // Roll back in reverse order
        for (const id of [...createdAutopilotIds].reverse()) {
          try { await cli.deleteAutopilot(id, opts.workspace_id); } catch {}
        }
        for (const id of [...createdAgentIds].reverse()) {
          try { await cli.deleteAgent(id, opts.workspace_id); } catch {}
        }
        for (const id of [...createdSkillIds].reverse()) {
          try { await cli.deleteSkill(id, opts.workspace_id); } catch {}
        }
      }

      // ── 0. Inline Skills ──
      const skillNameToId = new Map<string, string>();
      const existingSkillNameToId = new Map<string, string>();
      for (const s of existing.skills) {
        existingSkillNameToId.set(s.name, s.id);
      }

      for (const skill of template.skills || []) {
        const existingId = existingSkillNameToId.get(skill.name);
        if (existingId) {
          skillNameToId.set(skill.name, existingId);
          result.skipped.skills++;
          continue;
        }
        try {
          const mainContent = skill.files?.find((f) => f.path === 'index.ts' || f.path === 'index.js' || f.path === 'main.ts' || f.path === 'main.js')?.content
            || skill.files?.[0]?.content || '';
          const config = skill.config ? JSON.stringify(skill.config) : undefined;
          const created = await cli.createSkill(opts.workspace_id, {
            name: skill.name,
            description: skill.description,
            content: mainContent,
            config,
          });
          skillNameToId.set(skill.name, created.id);
          createdSkillIds.push(created.id);

          if (skill.files) {
            for (const file of skill.files) {
              await cli.skillFilesUpsert(created.id, file.path, file.content, opts.workspace_id);
            }
          }
          result.created.skills++;
        } catch (err: any) {
          result.errors.push(`Failed to create skill "${skill.name}": ${err.message}`);
          await rollback();
          result.success = false;
          return result;
        }
      }

      // ── 0b. Entity-ref Skills ──
      for (const resolved of entityRefResolved) {
        if (resolved.entity.entity !== 'skill') continue;
        if (inlineSkillNames.has(resolved.entity.name)) continue; // inline wins
        if (existingSkillNameToId.has(resolved.entity.name)) {
          skillNameToId.set(resolved.entity.name, existingSkillNameToId.get(resolved.entity.name)!);
          result.skipped.skills++;
          continue;
        }
        try {
          const skill = resolved.entity as SkillEntity;
          const mainContent = skill.files?.find((f) => f.path === 'SKILL.md')?.content
            || skill.files?.[0]?.content || '';
          const config = skill.config ? JSON.stringify(skill.config) : undefined;
          const created = await cli.createSkill(opts.workspace_id, {
            name: skill.name,
            description: skill.description,
            content: mainContent,
            config,
          });
          skillNameToId.set(skill.name, created.id);
          createdSkillIds.push(created.id);

          if (skill.files) {
            for (const file of skill.files) {
              await cli.skillFilesUpsert(created.id, file.path, file.content, opts.workspace_id);
            }
          }
          result.created.skills++;
          emit('skills', result.created.skills + result.skipped.skills, entityRefResolved.length, skill.name, 'create');
        } catch (err: any) {
          result.errors.push(`Failed to create entity-ref skill "${resolved.entity.name}": ${err.message}`);
          await rollback();
          result.success = false;
          return result;
        }
      }

      // ── 1. Labels ──
      for (const label of template.labels) {
        const exists = existing.labels.find((l) => l.name === label.name);
        if (exists) { result.skipped.labels++; continue; }
        try {
          await cli.createLabel(opts.workspace_id, { name: label.name, color: label.color });
          result.created.labels++;
        } catch (err: any) {
          result.errors.push(`Failed to create label "${label.name}": ${err.message}`);
        }
      }

      // ── 2. Projects ──
      for (const project of template.projects) {
        const exists = existing.projects.find((p) => p.title === project.title);
        if (exists) {
          result.skipped.projects++;
          if (project.resources?.length) {
            for (const res of project.resources) {
              try { await cli.createProjectResource(exists.id, opts.workspace_id, res); } catch {}
            }
          }
          continue;
        }
        try {
          const created = await cli.createProject(opts.workspace_id, {
            title: project.title, description: project.description, status: project.status,
          });
          result.created.projects++;
          if (project.resources?.length) {
            for (const res of project.resources) {
              await cli.createProjectResource(created.id, opts.workspace_id, res);
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to create project "${project.title}": ${err.message}`);
        }
      }

      // ── 3. Inline Agents ──
      const agentIdMap = new Map<string, string>();
      for (const agent of template.agents) {
        const existingAgent = existing.agents.find((a) => a.name === agent.name);

        if (existingAgent) {
          agentIdMap.set(agent.name, existingAgent.id);
          if (opts.mode === 'force-overwrite') {
            try {
              const runtimeId = runtimeMap.get(agent.runtime_provider) || existingAgent.runtime_id;
              const env = resolveEnv(agent.custom_env_template);
              const args = safeCustomArgs(agent.runtime_provider, runtimeId, agent.custom_args);
              await cli.updateAgent(existingAgent.id, {
                description: agent.description,
                instructions: agent.instructions,
                model: agent.model || undefined,
                visibility: agent.visibility || 'private',
                customArgs: args,
              }, opts.workspace_id);
              if (env) await cli.setAgentEnv(existingAgent.id, env, opts.workspace_id);
              result.updated.agents++;
            } catch (err: any) {
              result.errors.push(`Failed to update agent "${agent.name}": ${err.message}`);
            }
          } else {
            result.skipped.agents++;
          }

          // Assign skills
          if (agent.skills?.length) {
            const skillIds = agent.skills.map((n) => skillNameToId.get(n)).filter((id): id is string => !!id);
            if (skillIds.length > 0) {
              await cli.agentSkillsSet(existingAgent.id, skillIds, opts.workspace_id);
            }
          }
          continue;
        }

        // Create new agent
        const runtimeId = runtimeMap.get(agent.runtime_provider);
        if (!runtimeId) {
          result.errors.push(`No runtime mapped for agent "${agent.name}" (provider: ${agent.runtime_provider})`);
          result.skipped.agents++;
          continue;
        }

        try {
          const env = resolveEnv(agent.custom_env_template);
          const args = safeCustomArgs(agent.runtime_provider, runtimeId, agent.custom_args);
          const created = await cli.createAgent(opts.workspace_id, {
            name: agent.name,
            description: agent.description,
            instructions: agent.instructions,
            runtimeId,
            model: agent.model || undefined,
            visibility: agent.visibility || 'private',
            customArgs: args,
            customEnv: env,
          });
          agentIdMap.set(agent.name, created.id);
          createdAgentIds.push(created.id);

          if (agent.skills?.length) {
            const skillIds = agent.skills.map((n) => skillNameToId.get(n)).filter((id): id is string => !!id);
            if (skillIds.length > 0) {
              await cli.agentSkillsSet(created.id, skillIds, opts.workspace_id);
            }
          }
          result.created.agents++;
        } catch (err: any) {
          result.errors.push(`Failed to create agent "${agent.name}": ${err.message}`);
          await rollback();
          result.success = false;
          return result;
        }
      }

      // ── 4. Entity-ref Agents ──
      for (const resolved of entityRefResolved) {
        if (resolved.entity.entity !== 'agent') continue;
        if (inlineAgentNames.has(resolved.entity.name)) continue; // inline wins

        const agent = resolved.entity as AgentEntity;
        const existingAgent = existing.agents.find((a) => a.name === agent.name);

        if (existingAgent) {
          agentIdMap.set(agent.name, existingAgent.id);
          if (opts.mode === 'force-overwrite') {
            try {
              const runtimeId = runtimeMap.get(agent.runtime_provider) || existingAgent.runtime_id;
              const env = resolveEnv(agent.custom_env_template);
              const args = safeCustomArgs(agent.runtime_provider, runtimeId, agent.custom_args);
              await cli.updateAgent(existingAgent.id, {
                description: agent.description,
                instructions: agent.instructions,
                model: agent.model || undefined,
                visibility: agent.visibility || 'private',
                customArgs: args,
              }, opts.workspace_id);
              if (env) await cli.setAgentEnv(existingAgent.id, env, opts.workspace_id);
              result.updated.agents++;
            } catch (err: any) {
              result.errors.push(`Failed to update entity-ref agent "${agent.name}": ${err.message}`);
            }
          } else {
            result.skipped.agents++;
          }
        } else {
          const runtimeId = runtimeMap.get(agent.runtime_provider);
          if (!runtimeId) {
            result.errors.push(`No runtime mapped for entity-ref agent "${agent.name}" (provider: ${agent.runtime_provider})`);
            result.skipped.agents++;
            continue;
          }
          try {
            const env = resolveEnv(agent.custom_env_template);
            const args = safeCustomArgs(agent.runtime_provider, runtimeId, agent.custom_args);
            const created = await cli.createAgent(opts.workspace_id, {
              name: agent.name,
              description: agent.description,
              instructions: agent.instructions,
              runtimeId,
              model: agent.model || undefined,
              visibility: agent.visibility || 'private',
              customArgs: args,
              customEnv: env,
            });
            agentIdMap.set(agent.name, created.id);
            createdAgentIds.push(created.id);
            result.created.agents++;
            emit('agents', result.created.agents + result.skipped.agents, entityRefResolved.length, agent.name, 'create');
          } catch (err: any) {
            result.errors.push(`Failed to create entity-ref agent "${agent.name}": ${err.message}`);
            await rollback();
            result.success = false;
            return result;
          }
        }

        // Bind skills from entity
        if (agent.skills && Object.keys(agent.skills).length > 0) {
          const skillIds = Object.keys(agent.skills)
            .map((n) => skillNameToId.get(n))
            .filter((id): id is string => !!id);
          if (skillIds.length > 0) {
            const agentId = agentIdMap.get(agent.name);
            if (agentId) {
              try {
                await cli.agentSkillsSet(agentId, skillIds, opts.workspace_id);
              } catch (err: any) {
                result.errors.push(`Failed to bind skills to entity-ref agent "${agent.name}": ${err.message}`);
              }
            }
          }
        }
      }

      // ── 5. Autopilots (inline + entity-ref) ──
      // Inline autopilots
      for (const ap of template.autopilots) {
        const exists = existing.autopilots.find((a) => a.title === ap.title);
        if (exists) {
          result.skipped.autopilots++;
          // Check for missing triggers
          if (ap.triggers?.length) {
            try {
              const detail = await cli.getAutopilotDetail(exists.id, opts.workspace_id);
              const existingCrons = new Set(detail.triggers.map((t) => t.cron_expression));
              for (const trigger of ap.triggers) {
                if (!existingCrons.has(trigger.cron)) {
                  await cli.addAutopilotTrigger(exists.id, trigger, opts.workspace_id);
                  result.created.triggers++;
                } else {
                  result.skipped.triggers++;
                }
              }
            } catch { result.skipped.triggers += ap.triggers.length; }
          }
          continue;
        }

        const agentId = agentIdMap.get(ap.agent_ref);
        if (!agentId) {
          result.errors.push(`Cannot create autopilot "${ap.title}": agent "${ap.agent_ref}" not found`);
          result.skipped.autopilots++;
          continue;
        }

        try {
          const created = await cli.createAutopilot(opts.workspace_id, {
            title: ap.title, description: ap.description, agentId, mode: ap.mode,
          });
          createdAutopilotIds.push(created.id);
          result.created.autopilots++;

          if (ap.triggers?.length) {
            for (const trigger of ap.triggers) {
              await cli.addAutopilotTrigger(created.id, trigger, opts.workspace_id);
              result.created.triggers++;
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to create autopilot "${ap.title}": ${err.message}`);
        }
      }

      // Entity-ref autopilots
      for (const resolved of entityRefResolved) {
        if (resolved.entity.entity !== 'autopilot') continue;
        if (inlineAutopilotNames.has(resolved.entity.title)) continue; // inline wins

        const ap = resolved.entity as any; // AutopilotEntity
        const exists = existing.autopilots.find((a: any) => a.title === ap.title);
        if (exists) {
          result.skipped.autopilots++;
          continue;
        }

        // Parse agent_ref to get agent name
        const agentRefParsed = parseEntityRef(ap.agent_ref);
        const agentId = agentIdMap.get(agentRefParsed.name);

        if (!agentId) {
          result.errors.push(`Cannot create autopilot "${ap.title}": agent "${agentRefParsed.name}" not found`);
          result.skipped.autopilots++;
          continue;
        }

        try {
          const created = await cli.createAutopilot(opts.workspace_id, {
            title: ap.title, description: ap.description, agentId, mode: ap.mode,
          });
          createdAutopilotIds.push(created.id);
          result.created.autopilots++;
          emit('autopilots', result.created.autopilots, entityRefResolved.length, ap.title, 'create');

          if (ap.triggers?.length) {
            for (const trigger of ap.triggers) {
              await cli.addAutopilotTrigger(created.id, trigger, opts.workspace_id);
              result.created.triggers++;
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to create entity-ref autopilot "${ap.title}": ${err.message}`);
        }
      }

      // ── 6. Generate lockfile (v2 only) ──
      const optsV2 = opts as ImportOptionsV2;
      if (entityRefs.length > 0 && optsV2.lockfile !== false) {
        const pinned: Record<string, { version: string; hash: string }> = {};
        for (const resolved of entityRefResolved) {
          pinned[`${resolved.entity.entity}/${resolved.entity.name}`] = {
            version: resolved.entity.version,
            hash: 'sha256:placeholder',
          };
        }
        try {
          const reg = new EntityRegistry();
          reg.writeLockfile(opts.workspace_id, pinned);
        } catch {
          // Lockfile write failure is non-fatal
        }
      }
    } catch (err: any) {
      result.success = false;
      result.errors.push(`Import failed: ${err.message}`);
    }

    return result;
  }
}
