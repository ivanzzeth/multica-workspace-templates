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
  status: string;
  visibility: string;
  workspace_id: string;
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
