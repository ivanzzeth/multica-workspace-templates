import * as cli from './cli.js';
import type {
  MulticaAgent,
  MulticaProject,
  MulticaLabel,
  MulticaAutopilot,
  MulticaRuntime,
} from '../types/multica.js';

export interface WorkspaceState {
  agents: MulticaAgent[];
  projects: MulticaProject[];
  labels: MulticaLabel[];
  autopilots: MulticaAutopilot[];
  runtimes: MulticaRuntime[];
}

export class WorkspaceScanner {
  async scanWorkspace(workspaceId: string): Promise<WorkspaceState> {
    const [agents, projects, labels, autopilots, runtimes] = await Promise.all([
      cli.listAgents(workspaceId),
      cli.listProjects(workspaceId),
      cli.listLabels(workspaceId),
      cli.listAutopilots(workspaceId),
      cli.listRuntimes(workspaceId),
    ]);

    return { agents, projects, labels, autopilots, runtimes };
  }
}
