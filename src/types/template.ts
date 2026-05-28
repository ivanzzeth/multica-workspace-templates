export interface TemplateSkillFile {
  path: string;
  content: string;
}

export interface TemplateSkill {
  name: string;
  description: string;
  config?: Record<string, any>;
  files?: TemplateSkillFile[];
}

export interface TemplateAgent {
  name: string;
  description: string;
  instructions: string;
  model: string;
  runtime_provider: string;
  custom_args?: string[];
  custom_env_template?: Record<string, string>;
  skills?: string[];
  max_concurrent_tasks?: number;
  runtime_config?: Record<string, any>;
  mcp_config?: Record<string, string> | null;
}

export interface TemplateProject {
  title: string;
  description: string;
  status: string;
}

export interface TemplateLabel {
  name: string;
  color: string;
}

export interface TemplateAutopilotTrigger {
  cron: string;
  timezone: string;
  label?: string;
}

export interface TemplateAutopilot {
  title: string;
  description: string;
  agent_ref: string;
  mode: 'run_only' | 'create_issue';
  triggers?: TemplateAutopilotTrigger[];
}

export interface RuntimeMappingEntry {
  display_name: string;
}

export interface Template {
  version: string;
  name: string;
  description: string;
  agents: TemplateAgent[];
  projects: TemplateProject[];
  labels: TemplateLabel[];
  autopilots: TemplateAutopilot[];
  runtime_mapping: Record<string, RuntimeMappingEntry>;
  skills?: TemplateSkill[];
}

export type ImportMode = 'skip-existing' | 'force-overwrite';

export interface RuntimeMapAssignment {
  agent_name: string;
  runtime_provider: string;
  runtime_id: string;
  runtime_name: string;
}

export interface ImportOptions {
  template_name: string;
  workspace_id: string;
  runtime_map: RuntimeMapAssignment[];
  mode: ImportMode;
  env_vars?: Record<string, string>;
}

export interface DryRunItem {
  name: string;
  action: 'create' | 'update' | 'skip';
  reason?: string;
}

export interface DryRunResult {
  agents: DryRunItem[];
  projects: DryRunItem[];
  labels: DryRunItem[];
  autopilots: DryRunItem[];
  skills: DryRunItem[];
}

export interface ImportResult {
  success: boolean;
  created: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  skipped: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  updated: { agents: number };
  errors: string[];
}

export interface ExportOptions {
  agents: boolean;
  autopilots: boolean;
  skills: boolean;
  projects: boolean;
  labels: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  agents: true,
  autopilots: true,
  skills: true,
  projects: false,
  labels: false,
};

export interface TemplateSummary {
  name: string;
  version: string;
  description: string;
  agent_count: number;
  project_count: number;
  label_count: number;
  autopilot_count: number;
  skill_count: number;
  source: 'builtin' | 'user';
}
