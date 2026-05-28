export interface MulticaWorkspace {
  id: string;
  name: string;
}

export interface MulticaAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  runtime_id: string;
  custom_args: string[];
  custom_env: Record<string, string>;
  custom_env_redacted: boolean;
  skills: { id: string; name: string; description: string }[];
  max_concurrent_tasks: number;
  mcp_config: Record<string, any> | null;
  mcp_config_redacted: boolean;
  runtime_config: Record<string, any>;
  runtime_mode: string;
  avatar_url: string | null;
  status: string;
  visibility: string;
  workspace_id: string;
}

export interface MulticaSkill {
  id: string;
  name: string;
  description: string;
  config: Record<string, any>;
  created_at: string;
  created_by: string;
  workspace_id: string;
  updated_at: string;
}

export interface MulticaSkillDetail extends MulticaSkill {
  content?: string;
  files?: MulticaSkillFile[];
}

export interface MulticaSkillFile {
  id: string;
  skill_id: string;
  path: string;
  content: string;
}

export interface MulticaRuntime {
  id: string;
  name: string;
  provider: string;
  status: string;
  device_info: string;
}

export interface MulticaProject {
  id: string;
  title: string;
  description: string;
  status: string;
  icon: string | null;
}

export interface MulticaLabel {
  id: string;
  name: string;
  color: string;
}

export interface MulticaAutopilot {
  id: string;
  title: string;
  description: string;
  assignee_id: string;
  execution_mode: string;
  status: string;
}

export interface MulticaTrigger {
  id: string;
  autopilot_id: string;
  cron_expression: string;
  timezone: string;
  label: string | null;
  enabled: boolean;
  kind: string;
}

export interface MulticaAutopilotDetail {
  autopilot: MulticaAutopilot & { workspace_id: string };
  triggers: MulticaTrigger[];
}
