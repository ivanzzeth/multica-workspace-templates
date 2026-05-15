import * as cli from './cli.js';
import type {
  MulticaAgent,
  MulticaProject,
  MulticaLabel,
  MulticaAutopilot,
  MulticaRuntime,
  MulticaSkill,
} from '../types/multica.js';

export interface WorkspaceState {
  agents: MulticaAgent[];
  projects: MulticaProject[];
  labels: MulticaLabel[];
  autopilots: MulticaAutopilot[];
  runtimes: MulticaRuntime[];
  skills: MulticaSkill[];
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

    return { agents, projects, labels, autopilots, runtimes, skills };
  }
}
