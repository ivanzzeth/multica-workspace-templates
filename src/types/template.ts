export interface TemplateAgent {
  name: string;
  description: string;
  instructions: string;
  model: string;
  runtime_provider: string;
  custom_args?: string[];
  custom_env_template?: Record<string, string>;
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
}

export interface ImportResult {
  success: boolean;
  created: { agents: number; projects: number; labels: number; autopilots: number; triggers: number };
  skipped: { agents: number; projects: number; labels: number; autopilots: number; triggers: number };
  updated: { agents: number };
  errors: string[];
}

export interface TemplateSummary {
  name: string;
  description: string;
  agent_count: number;
  project_count: number;
  label_count: number;
  autopilot_count: number;
}
