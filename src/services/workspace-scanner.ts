import * as cli from './cli.js';
import type {
  MulticaAgent,
  MulticaProject,
  MulticaLabel,
  MulticaAutopilot,
  MulticaRuntime,
  MulticaSkill,
  MulticaProjectResource,
} from '../types/multica.js';

export interface WorkspaceState {
  agents: MulticaAgent[];
  projects: MulticaProject[];
  labels: MulticaLabel[];
  autopilots: MulticaAutopilot[];
  runtimes: MulticaRuntime[];
  skills: MulticaSkill[];
  projectResources: Map<string, MulticaProjectResource[]>;
}

export class WorkspaceScanner {
  async scanWorkspace(workspaceId: string): Promise<WorkspaceState> {
    const [agents, projects, labels, autopilots, runtimes, skills] = await Promise.all([
      cli.listAgents(workspaceId),
      cli.listProjects(workspaceId),
      cli.listLabels(workspaceId),
      cli.listAutopilots(workspaceId),
      cli.listRuntimes(workspaceId),
      cli.listSkills(workspaceId),
    ]);

    // Fetch resources for each project (in parallel)
    const projectResources = new Map<string, MulticaProjectResource[]>();
    const resourceResults = await Promise.allSettled(
      projects.map((p) => cli.listProjectResources(p.id, workspaceId)),
    );
    for (let i = 0; i < projects.length; i++) {
      const result = resourceResults[i];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        projectResources.set(projects[i].id, result.value);
      }
    }

    return { agents, projects, labels, autopilots, runtimes, skills, projectResources };
  }
}
