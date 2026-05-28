import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { loadConfig } from '../config.js';
import type {
  MulticaWorkspace,
  MulticaAgent,
  MulticaRuntime,
  MulticaProject,
  MulticaLabel,
  MulticaAutopilot,
  MulticaAutopilotDetail,
  MulticaSkill,
  MulticaSkillDetail,
} from '../types/multica.js';

const exec = promisify(execFile);

interface ExecOptions {
  env?: Record<string, string>;
}

let multicaPath: string | null = null;

async function resolveMulticaPath(): Promise<string> {
  if (multicaPath) return multicaPath;
  const { stdout } = await exec('which', ['multica']);
  multicaPath = stdout.trim();
  return multicaPath;
}

function buildEnv(workspaceId?: string): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (workspaceId) {
    env.MULTICA_WORKSPACE_ID = workspaceId;
  }
  return env;
}

interface ExecOptions {
  env?: Record<string, string>;
  stdin?: string;
}

async function runMultica<T = string>(
  args: string[],
  opts?: ExecOptions & { parseJson?: boolean; workspaceId?: string },
): Promise<T> {
  const path = await resolveMulticaPath();
  const env = opts?.env ?? buildEnv(opts?.workspaceId);

  if (opts?.stdin !== undefined) {
    // Use spawn for stdin support
    return new Promise<T>((resolve, reject) => {
      const child = spawn(path, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed: ${path} ${args.join(' ')}\n${stderr}`));
          return;
        }
        try {
          resolve(opts?.parseJson ? JSON.parse(stdout) as T : stdout.trim() as unknown as T);
        } catch {
          resolve(stdout.trim() as unknown as T);
        }
      });
      child.stdin.write(opts.stdin);
      child.stdin.end();
    });
  }

  const { stdout } = await exec(path, args, { env });
  if (opts?.parseJson) {
    return JSON.parse(stdout) as T;
  }
  return stdout.trim() as unknown as T;
}

/**
 * Parse the table output of `multica workspace list` (which doesn't support --output json).
 * Output format:
 *   ID                                    NAME
 *   d8ea625e-...                           Web3Gate
 */
function parseWorkspaceTable(output: string): MulticaWorkspace[] {
  const lines = output.trim().split('\n');
  // Skip header line
  const dataLines = lines.slice(1);
  const workspaces: MulticaWorkspace[] = [];
  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // ID is 36 chars (UUID) + 2 spaces, then name
    const id = trimmed.slice(0, 36).trim();
    const name = trimmed.slice(38).trim();
    if (id && name) {
      workspaces.push({ id, name });
    }
  }
  return workspaces;
}

// ── Read Operations ──

export async function listWorkspaces(): Promise<MulticaWorkspace[]> {
  const data = await runMultica(['workspace', 'list', '--output', 'json'], {
    parseJson: true,
  });
  if (Array.isArray(data)) return data as MulticaWorkspace[];
  // Fallback: if CLI changed format, try parsing table
  return parseWorkspaceTable(data as unknown as string);
}

export async function listAgents(workspaceId: string): Promise<MulticaAgent[]> {
  return runMultica(['agent', 'list', '--output', 'json'], { parseJson: true, workspaceId }) as Promise<MulticaAgent[]>;
}

export async function listRuntimes(workspaceId: string): Promise<MulticaRuntime[]> {
  return runMultica(['runtime', 'list', '--output', 'json'], { parseJson: true, workspaceId }) as Promise<MulticaRuntime[]>;
}

export async function listProjects(workspaceId: string): Promise<MulticaProject[]> {
  return runMultica(['project', 'list', '--output', 'json'], { parseJson: true, workspaceId }) as Promise<MulticaProject[]>;
}

export async function listLabels(workspaceId: string): Promise<MulticaLabel[]> {
  return runMultica(['label', 'list', '--output', 'json'], { parseJson: true, workspaceId }) as Promise<MulticaLabel[]>;
}

export async function listAutopilots(workspaceId: string): Promise<MulticaAutopilot[]> {
  return runMultica(['autopilot', 'list', '--output', 'json'], { parseJson: true, workspaceId }).then((data: any) => {
    // autopilot list returns { autopilots: [...] }
    if (data && data.autopilots) return data.autopilots as MulticaAutopilot[];
    return data as MulticaAutopilot[];
  });
}

// ── Mutations ──

export interface AgentCreateOpts {
  name: string;
  description: string;
  instructions: string;
  runtimeId: string;
  model?: string;
  customArgs?: string[];
  customEnv?: Record<string, string>;
}

export async function createAgent(workspaceId: string, opts: AgentCreateOpts): Promise<{ id: string }> {
  const args = ['agent', 'create',
    '--name', opts.name,
    '--description', opts.description,
    '--instructions', opts.instructions,
    '--runtime-id', opts.runtimeId,
    '--output', 'json',
  ];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.customArgs && opts.customArgs.length > 0) {
    args.push('--custom-args', JSON.stringify(opts.customArgs));
  }
  if (opts.customEnv && Object.keys(opts.customEnv).length > 0) {
    args.push('--custom-env', JSON.stringify(opts.customEnv));
  }
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export interface AgentUpdateOpts {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  customArgs?: string[];
  maxConcurrentTasks?: number;
  mcpConfig?: string;
  runtimeConfig?: string;
}

export async function updateAgent(agentId: string, opts: AgentUpdateOpts): Promise<void> {
  const args = ['agent', 'update', agentId];
  if (opts.name) args.push('--name', opts.name);
  if (opts.description) args.push('--description', opts.description);
  if (opts.instructions) args.push('--instructions', opts.instructions);
  if (opts.model !== undefined) args.push('--model', opts.model);
  if (opts.customArgs) args.push('--custom-args', JSON.stringify(opts.customArgs));
  if (opts.maxConcurrentTasks !== undefined) args.push('--max-concurrent-tasks', String(opts.maxConcurrentTasks));
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
  if (opts.runtimeConfig) args.push('--runtime-config', opts.runtimeConfig);
  await runMultica(args);
}

export async function setAgentEnv(agentId: string, env: Record<string, string>, workspaceId: string): Promise<void> {
  await runMultica(['agent', 'env', 'set', agentId, '--custom-env-stdin'], {
    workspaceId,
    stdin: JSON.stringify(env),
  });
}

export interface ProjectCreateOpts {
  title: string;
  description: string;
  status: string;
}

export async function createProject(workspaceId: string, opts: ProjectCreateOpts): Promise<{ id: string }> {
  const args = ['project', 'create',
    '--title', opts.title,
    '--description', opts.description,
    '--status', opts.status,
    '--output', 'json',
  ];
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export interface LabelCreateOpts {
  name: string;
  color: string;
}

export async function createLabel(workspaceId: string, opts: LabelCreateOpts): Promise<{ id: string }> {
  const args = ['label', 'create',
    '--name', opts.name,
    '--color', opts.color,
    '--output', 'json',
  ];
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export interface AutopilotCreateOpts {
  title: string;
  description: string;
  agentId: string;
  mode: 'run_only' | 'create_issue';
}

export async function createAutopilot(workspaceId: string, opts: AutopilotCreateOpts): Promise<{ id: string }> {
  const args = ['autopilot', 'create',
    '--title', opts.title,
    '--description', opts.description,
    '--agent', opts.agentId,
    '--mode', opts.mode,
    '--output', 'json',
  ];
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export async function getAutopilotDetail(autopilotId: string, workspaceId: string): Promise<MulticaAutopilotDetail> {
  return runMultica(['autopilot', 'get', autopilotId, '--output', 'json'], {
    parseJson: true,
    workspaceId,
  }) as Promise<MulticaAutopilotDetail>;
}

export interface AutopilotTriggerAddOpts {
  cron: string;
  timezone: string;
  label?: string;
}

export async function addAutopilotTrigger(
  autopilotId: string,
  opts: AutopilotTriggerAddOpts,
  workspaceId: string,
): Promise<{ id: string }> {
  const args = ['autopilot', 'trigger-add', autopilotId,
    '--cron', opts.cron,
    '--timezone', opts.timezone,
    '--output', 'json',
  ];
  if (opts.label) {
    args.push('--label', opts.label);
  }
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export async function getWorkspaceConfig() {
  return loadConfig();
}

// ── Skills ──

export async function listSkills(workspaceId: string): Promise<MulticaSkill[]> {
  return runMultica(['skill', 'list', '--output', 'json'], { parseJson: true, workspaceId }).then((data: any) => {
    if (data && data.skills) return data.skills as MulticaSkill[];
    return data as MulticaSkill[];
  });
}

export async function getSkill(id: string, workspaceId: string): Promise<MulticaSkillDetail> {
  return runMultica(['skill', 'get', id, '--output', 'json'], {
    parseJson: true,
    workspaceId,
  }) as Promise<MulticaSkillDetail>;
}

export interface SkillCreateOpts {
  name: string;
  description: string;
  content: string;
  config?: string;
}

export async function createSkill(workspaceId: string, opts: SkillCreateOpts): Promise<{ id: string }> {
  const args = ['skill', 'create',
    '--name', opts.name,
    '--description', opts.description,
    '--content', opts.content,
    '--output', 'json',
  ];
  if (opts.config) {
    args.push('--config', opts.config);
  }
  return runMultica(args, { parseJson: true, workspaceId }) as Promise<{ id: string }>;
}

export async function skillFilesUpsert(
  skillId: string,
  path: string,
  content: string,
  workspaceId: string,
): Promise<void> {
  await runMultica(['skill', 'files', 'upsert', skillId, '--path', path, '--content', content], {
    workspaceId,
  });
}

export async function agentSkillsSet(
  agentId: string,
  skillIds: string[],
  workspaceId: string,
): Promise<void> {
  await runMultica(['agent', 'skills', 'set', agentId, '--skill-ids', skillIds.join(',')], {
    workspaceId,
  });
}
