import type { Template, ImportOptions, DryRunResult, ImportResult, DryRunItem } from '../types/template.js';
import { TemplateReader } from './template-reader.js';
import { WorkspaceScanner } from './workspace-scanner.js';
import * as cli from './cli.js';

export class ImportEngine {
  constructor(
    private reader: TemplateReader,
    private scanner: WorkspaceScanner,
  ) {}

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

    // Skills
    const existingSkillNames = new Set(existing.skills.map((s) => s.name));
    for (const skill of template.skills || []) {
      if (existingSkillNames.has(skill.name)) {
        result.skills.push({ name: skill.name, action: 'skip', reason: 'Skill already exists' });
      } else {
        result.skills.push({ name: skill.name, action: 'create' });
      }
    }

    for (const agent of template.agents) {
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

  async apply(
    opts: ImportOptions,
    onProgress?: (evt: { phase: string; current: number; total: number; item: string; action: string; errors: string[] }) => void,
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

    // Build maps: template runtime_provider → assigned runtime_id, and runtime_id → actual provider
    const runtimeMap = new Map<string, string>();
    const runtimeIdProvider = new Map<string, string>();
    for (const rm of opts.runtime_map) {
      runtimeMap.set(rm.runtime_provider, rm.runtime_id);
      if (rm.runtime_id) {
        runtimeIdProvider.set(rm.runtime_id, rm.runtime_provider);
      }
    }

    // Drop runtime-specific custom_args when assigned runtime provider differs from template
    function safeCustomArgs(templateProvider: string, assignedRuntimeId: string, templateArgs?: string[]): string[] | undefined {
      if (!templateArgs || templateArgs.length === 0) return undefined;
      const actualProvider = runtimeIdProvider.get(assignedRuntimeId);
      if (actualProvider && actualProvider !== templateProvider) {
        return undefined; // args specific to cursor/claude/etc — don't apply to wrong runtime
      }
      return templateArgs;
    }

    const envOverrides: Record<string, string> = opts.env_vars || {};

    // Resolve env: use user-supplied value if non-empty, otherwise keep template placeholder
    function resolveEnv(template?: Record<string, string>): Record<string, string> | undefined {
      if (!template || Object.keys(template).length === 0) return undefined;
      const env: Record<string, string> = {};
      for (const key of Object.keys(template)) {
        const userVal = envOverrides[key];
        env[key] = (userVal && userVal !== '' && !userVal.startsWith('${')) ? userVal : template[key];
      }
      return Object.keys(env).length > 0 ? env : undefined;
    }

    try {
      // 0. Skills (no dependencies)
      const skillNameToId = new Map<string, string>(); // skill name → multica skill ID
      const existingSkillNameToId = new Map<string, string>();
      for (const s of existing.skills) {
        existingSkillNameToId.set(s.name, s.id);
      }

      for (const skill of template.skills || []) {
        const idx = result.created.skills + result.skipped.skills;
        const total = (template.skills || []).length;
        const existingId = existingSkillNameToId.get(skill.name);
        if (existingId) {
          skillNameToId.set(skill.name, existingId);
          result.skipped.skills++;
          emit('skills', idx + 1, total, skill.name, 'skip');
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

          // Upsert additional files
          if (skill.files) {
            for (const file of skill.files) {
              try {
                await cli.skillFilesUpsert(created.id, file.path, file.content, opts.workspace_id);
              } catch (err: any) {
                result.errors.push(`Failed to upsert skill file "${file.path}" for skill "${skill.name}": ${err.message}`);
              }
            }
          }

          result.created.skills++;
          emit('skills', idx + 1, total, skill.name, 'create');
        } catch (err: any) {
          result.errors.push(`Failed to create skill "${skill.name}": ${err.message}`);
        }
      }

      // 1. Labels (no dependencies)
      for (let i = 0; i < template.labels.length; i++) {
        const label = template.labels[i];
        const exists = existing.labels.find((l) => l.name === label.name);
        if (exists) {
          result.skipped.labels++;
          emit('labels', i + 1, template.labels.length, label.name, 'skip');
          continue;
        }
        try {
          await cli.createLabel(opts.workspace_id, { name: label.name, color: label.color });
          result.created.labels++;
          emit('labels', i + 1, template.labels.length, label.name, 'create');
        } catch (err: any) {
          result.errors.push(`Failed to create label "${label.name}": ${err.message}`);
        }
      }

      // Helper: create resources for an existing project that's missing them
      async function createResourcesIfMissing(
        projectId: string,
        resources: { resource_type: string; resource_ref: Record<string, any> }[],
        result: ImportResult,
      ) {
        for (const res of resources) {
          try {
            await cli.createProjectResource(projectId, opts.workspace_id, res);
          } catch (err: any) {
            result.errors.push(`Failed to create resource "${res.resource_type}": ${err.message}`);
          }
        }
      }

      // 2. Projects (no dependencies)
      for (let i = 0; i < template.projects.length; i++) {
        const project = template.projects[i];
        const exists = existing.projects.find((p) => p.title === project.title);
        if (exists) {
          result.skipped.projects++;
          emit('projects', i + 1, template.projects.length, project.title, 'skip');
          // Still create resources for existing projects if they have none
          if (project.resources?.length) {
            await createResourcesIfMissing(exists.id, project.resources, result);
          }
          continue;
        }
        try {
          const created = await cli.createProject(opts.workspace_id, {
            title: project.title,
            description: project.description,
            status: project.status,
          });
          result.created.projects++;
          emit('projects', i + 1, template.projects.length, project.title, 'create');

          // Create project resources
          if (project.resources?.length) {
            for (const res of project.resources) {
              try {
                await cli.createProjectResource(created.id, opts.workspace_id, res);
              } catch (err: any) {
                result.errors.push(`Failed to create resource "${res.resource_type}" for project "${project.title}": ${err.message}`);
              }
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to create project "${project.title}": ${err.message}`);
        }
      }

      // 3. Agents
      const agentIdMap = new Map<string, string>();
      for (let i = 0; i < template.agents.length; i++) {
        const agent = template.agents[i];
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
              if (env) {
                await cli.setAgentEnv(existingAgent.id, env, opts.workspace_id);
              }
              result.updated.agents++;
              emit('agents', i + 1, template.agents.length, agent.name, 'update');
            } catch (err: any) {
              result.errors.push(`Failed to update agent "${agent.name}": ${err.message}`);
            }
          } else {
            result.skipped.agents++;
            emit('agents', i + 1, template.agents.length, agent.name, 'skip');
          }

          // Assign skills to existing agent if template has skills
          if (agent.skills?.length) {
            const skillIds = agent.skills
              .map((name) => skillNameToId.get(name))
              .filter((id): id is string => !!id);
            if (skillIds.length > 0) {
              try {
                await cli.agentSkillsSet(existingAgent.id, skillIds, opts.workspace_id);
              } catch (err: any) {
                result.errors.push(`Failed to assign skills to agent "${agent.name}": ${err.message}`);
              }
            }
          }

          continue;
        }

        // Create new agent
        const runtimeId = runtimeMap.get(agent.runtime_provider);
        if (!runtimeId) {
          result.errors.push(`No runtime mapped for agent "${agent.name}" (provider: ${agent.runtime_provider})`);
          result.skipped.agents++;
          emit('agents', i + 1, template.agents.length, agent.name, 'skip');
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

          // Assign skills to new agent
          if (agent.skills?.length) {
            const skillIds = agent.skills
              .map((name) => skillNameToId.get(name))
              .filter((id): id is string => !!id);
            if (skillIds.length > 0) {
              try {
                await cli.agentSkillsSet(created.id, skillIds, opts.workspace_id);
              } catch (err: any) {
                result.errors.push(`Failed to assign skills to agent "${agent.name}": ${err.message}`);
              }
            }
          }

          result.created.agents++;
          emit('agents', i + 1, template.agents.length, agent.name, 'create');
        } catch (err: any) {
          result.errors.push(`Failed to create agent "${agent.name}": ${err.message}`);
        }
      }

      // 4. Autopilots
      for (let i = 0; i < template.autopilots.length; i++) {
        const ap = template.autopilots[i];
        const exists = existing.autopilots.find((a) => a.title === ap.title);
        if (exists) {
          result.skipped.autopilots++;
          emit('autopilots', i + 1, template.autopilots.length, ap.title, 'skip');
          // Check if existing autopilot is missing any triggers from template
          if (ap.triggers && ap.triggers.length > 0) {
            try {
              const detail = await cli.getAutopilotDetail(exists.id, opts.workspace_id);
              const existingCrons = new Set(detail.triggers.map((t) => t.cron_expression));
              for (const trigger of ap.triggers) {
                if (existingCrons.has(trigger.cron)) {
                  result.skipped.triggers++;
                } else {
                  await cli.addAutopilotTrigger(exists.id, trigger, opts.workspace_id);
                  result.created.triggers++;
                }
              }
            } catch {
              result.skipped.triggers += ap.triggers.length;
            }
          }
          continue;
        }

        const agentId = agentIdMap.get(ap.agent_ref);
        if (!agentId) {
          result.errors.push(`Cannot create autopilot "${ap.title}": agent "${ap.agent_ref}" not created/found`);
          result.skipped.autopilots++;
          continue;
        }

        try {
          const created = await cli.createAutopilot(opts.workspace_id, {
            title: ap.title,
            description: ap.description,
            agentId,
            mode: ap.mode,
          });
          result.created.autopilots++;
          emit('autopilots', i + 1, template.autopilots.length, ap.title, 'create');

          // Create triggers if defined in template
          if (ap.triggers && ap.triggers.length > 0) {
            for (const trigger of ap.triggers) {
              try {
                await cli.addAutopilotTrigger(created.id, trigger, opts.workspace_id);
                result.created.triggers++;
              } catch (err: any) {
                result.errors.push(
                  `Failed to add trigger to autopilot "${ap.title}": ${err.message}`,
                );
              }
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to create autopilot "${ap.title}": ${err.message}`);
        }
      }
    } catch (err: any) {
      result.success = false;
      result.errors.push(`Import failed: ${err.message}`);
    }

    return result;
  }
}
