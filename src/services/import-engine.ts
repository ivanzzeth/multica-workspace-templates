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
    };

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

  async apply(opts: ImportOptions): Promise<ImportResult> {
    const template = this.reader.readTemplate(opts.template_name);
    const existing = await this.scanner.scanWorkspace(opts.workspace_id);

    const result: ImportResult = {
      success: true,
      created: { agents: 0, projects: 0, labels: 0, autopilots: 0, triggers: 0 },
      skipped: { agents: 0, projects: 0, labels: 0, autopilots: 0, triggers: 0 },
      updated: { agents: 0 },
      errors: [],
    };

    // Build a map of runtime_provider → runtime_id from the user's mapping
    const runtimeMap = new Map<string, string>();
    for (const rm of opts.runtime_map) {
      runtimeMap.set(rm.runtime_provider, rm.runtime_id);
    }

    try {
      // 1. Labels (no dependencies)
      for (const label of template.labels) {
        const exists = existing.labels.find((l) => l.name === label.name);
        if (exists) {
          result.skipped.labels++;
          continue;
        }
        try {
          await cli.createLabel(opts.workspace_id, { name: label.name, color: label.color });
          result.created.labels++;
        } catch (err: any) {
          result.errors.push(`Failed to create label "${label.name}": ${err.message}`);
        }
      }

      // 2. Projects (no dependencies)
      for (const project of template.projects) {
        const exists = existing.projects.find((p) => p.title === project.title);
        if (exists) {
          result.skipped.projects++;
          continue;
        }
        try {
          await cli.createProject(opts.workspace_id, {
            title: project.title,
            description: project.description,
            status: project.status,
          });
          result.created.projects++;
        } catch (err: any) {
          result.errors.push(`Failed to create project "${project.title}": ${err.message}`);
        }
      }

      // 3. Agents (no cross-dependencies, can parallelize)
      const agentIdMap = new Map<string, string>(); // agentName → multica agent ID
      for (const agent of template.agents) {
        const existingAgent = existing.agents.find((a) => a.name === agent.name);

        if (existingAgent) {
          agentIdMap.set(agent.name, existingAgent.id);
          if (opts.mode === 'force-overwrite') {
            try {
              const runtimeId = runtimeMap.get(agent.runtime_provider) || existingAgent.runtime_id;
              const env = this.resolveEnv(agent.custom_env_template);
              await cli.updateAgent(existingAgent.id, {
                description: agent.description,
                instructions: agent.instructions,
                model: agent.model || undefined,
                customArgs: agent.custom_args,
                customEnv: env,
              });
              result.updated.agents++;
            } catch (err: any) {
              result.errors.push(`Failed to update agent "${agent.name}": ${err.message}`);
            }
          } else {
            result.skipped.agents++;
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
          const env = this.resolveEnv(agent.custom_env_template);
          const created = await cli.createAgent(opts.workspace_id, {
            name: agent.name,
            description: agent.description,
            instructions: agent.instructions,
            runtimeId,
            model: agent.model || undefined,
            customArgs: agent.custom_args,
            customEnv: env,
          });
          agentIdMap.set(agent.name, created.id);
          result.created.agents++;
        } catch (err: any) {
          result.errors.push(`Failed to create agent "${agent.name}": ${err.message}`);
        }
      }

      // 4. Autopilots (depend on agents) + triggers (depend on autopilots)
      for (const ap of template.autopilots) {
        const exists = existing.autopilots.find((a) => a.title === ap.title);
        if (exists) {
          result.skipped.autopilots++;
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

  /**
   * Resolve env var placeholders from the template.
   * Template values like "${ANTHROPIC_AUTH_TOKEN}" are kept as-is;
   * the user provides actual values during runtime mapping step.
   * For now, we use whatever env values the template defines.
   * Empty object means no env vars needed.
   */
  private resolveEnv(template?: Record<string, string>): Record<string, string> | undefined {
    if (!template || Object.keys(template).length === 0) return undefined;
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(template)) {
      // If value is a placeholder like "${SOMETHING}", skip it unless the user provided it
      // In a full implementation, the frontend would collect env values.
      // For now, keep the key with an empty value so the agent gets the env var slot.
      if (value.startsWith('${') && value.endsWith('}')) {
        const envVal = process.env[key];
        if (envVal) {
          resolved[key] = envVal;
        }
        // else: skip — agent will have no value for this env var
      } else {
        resolved[key] = value;
      }
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }
}
