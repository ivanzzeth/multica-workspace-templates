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
  visibility?: string;
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
  resources?: {
    resource_type: string;
    resource_ref: Record<string, any>;
  }[];
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

// ── Template v2 (superset of v1) ──

/** Optional metadata block on v2 templates. */
export interface TemplateMetadata {
  author?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

/** A single entity reference in a template v2 includes section. */
export interface EntityRefEntry {
  /** Entity reference string (e.g., 'agent/worker@2.0.1'). */
  ref: string;
  /** Optional hash pin for integrity verification. */
  hash?: string;
  /** Optional template-level overrides (see OverrideEngine for allowed fields). */
  overrides?: Record<string, any>;
}

/** The includes section of a v2 template. */
export interface TemplateV2Includes {
  /** Entity references — resolved from local/remote registry at import time. */
  entities?: EntityRefEntry[];
}

/**
 * Template v2 — a strict superset of Template.
 *
 * Every v1 Template is a valid TemplateV2: the `includes` field is optional.
 * When present, entity refs are resolved and merged with inline definitions.
 * Inline wins on name collision (explicit > implicit).
 */
export interface TemplateV2 {
  /** Schema version: '2.0' for v2 templates. */
  schema_version: string;
  /** Minimum engine version required. */
  min_engine_version?: string;
  name: string;
  description: string;
  /** Optional metadata block. */
  metadata?: TemplateMetadata;

  // ── Inline definitions (v1 template fields, always supported) ──
  agents: TemplateAgent[];
  projects: TemplateProject[];
  labels: TemplateLabel[];
  autopilots: TemplateAutopilot[];
  runtime_mapping: Record<string, RuntimeMappingEntry>;
  skills?: TemplateSkill[];

  // ── Entity references (NEW in v2) ──
  /** Optional entity references. Omitted = pure inline (v1 behavior). */
  includes?: TemplateV2Includes;
}

// ── Enhanced import types ──

/** Granular entity selection for import. */
export interface EntitySelection {
  type: 'all' | 'selected';
  entities?: string[];
}

/** Extended import options for v2 templates. */
export interface ImportOptionsV2 extends ImportOptions {
  /** Granular entity selection (default: 'all'). */
  entity_selection?: EntitySelection;
  /** Maximum depth for transitive dependency resolution. */
  resolve_depth?: number;
  /** Whether to generate/update the workspace lockfile. */
  lockfile?: boolean;
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
  /** For v2 templates: count of entity references in includes. */
  entity_ref_count?: number;
  /** Display mode: 'inline' (v1 only), 'reference' (v2 refs only), 'mixed' (v2 both). */
  mode?: 'inline' | 'reference' | 'mixed';
}

/** Union type for version-agnostic template handling. */
export type AnyTemplate = Template | TemplateV2;

/** Check if a template is in v2 format. */
export function isTemplateV2(t: AnyTemplate): t is TemplateV2 {
  return 'schema_version' in t && (t as any).schema_version?.startsWith('2.');
}
