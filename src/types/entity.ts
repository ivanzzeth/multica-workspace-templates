/**
 * Entity type definitions for the componentized entity architecture.
 *
 * Entities are independently versioned, reusable building blocks.
 * Templates compose entities via references — see template.ts for TemplateV2.
 *
 * Naming convention: {namespace}/{type}/{name}@{version}
 *   e.g., multica/skill/golang-testing@1.2.0
 */

// ── Entity Discriminator ──

export type EntityType = 'skill' | 'agent' | 'autopilot';

// ── Entity Identity ──

/**
 * Parsed entity reference.
 *
 * Format: [{namespace}/]{type}/{name}@[{semver}]
 *
 * Examples:
 *   skill/golang-testing@1.2.0         (default namespace)
 *   multica/agent/worker@2.0.1         (explicit namespace)
 *   skill/golang-testing               (latest version)
 */
export interface EntityRef {
  /** Namespace (default: 'multica') */
  namespace: string;
  /** Entity type: skill | agent | autopilot */
  type: EntityType;
  /** Entity name (kebab-case, no path separators) */
  name: string;
  /** Exact version string (e.g., '2.0.1'), or undefined for latest */
  version?: string;
  /** Optional hash pin (sha256:...) */
  hash?: string;
}

/** Serialized entity reference string. */
export type EntityRefString = string;

// ── Entity Metadata ──

export interface EntityMetadata {
  author?: string;
  tags?: string[];
  created_at?: string;     // ISO 8601
  updated_at?: string;     // ISO 8601
  changelog?: string;
  deprecated?: boolean;
  deprecation_message?: string;
}

// ── Skill Entity ──

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillEntity {
  entity: 'skill';
  schema_version: string;  // e.g., '1.0'
  min_engine_version?: string;
  /** Namespace (default: 'multica') */
  namespace?: string;
  name: string;
  version: string;         // semver
  description: string;
  config?: Record<string, any>;
  files?: SkillFile[];
  metadata?: EntityMetadata;
}

// ── Agent Entity ──

/**
 * Agent's skill dependency map.
 * Key: skill name, Value: version constraint
 *   e.g., { 'golang-testing': '^1.2.0', 'python-pro': '^2.0.0' }
 *
 * Empty object {} means no skill dependencies.
 * `undefined` means the field was not specified (vs explicitly empty).
 */
export type AgentSkillDeps = Record<string, string>;

export interface AgentEntity {
  entity: 'agent';
  schema_version: string;
  min_engine_version?: string;
  namespace?: string;
  name: string;
  version: string;
  description: string;
  instructions: string;
  model: string;
  runtime_provider: string;
  visibility?: string;
  max_concurrent_tasks?: number;
  custom_env_template?: Record<string, string>;
  skills?: AgentSkillDeps;
  custom_args?: string[];
  runtime_config?: Record<string, any>;
  mcp_config?: Record<string, string> | null;
  metadata?: EntityMetadata;
}

// ── Autopilot Entity ──

export interface AutopilotTrigger {
  cron: string;
  timezone: string;
  label?: string;
}

export interface AutopilotEntity {
  entity: 'autopilot';
  schema_version: string;
  min_engine_version?: string;
  namespace?: string;
  name: string;
  version: string;
  title: string;
  description: string;
  mode: 'run_only' | 'create_issue';
  /** Entity ref string for the assigned agent (e.g., 'agent/worker@^2.0.0') */
  agent_ref: string;
  triggers?: AutopilotTrigger[];
  metadata?: EntityMetadata;
}

// ── Union Entity Type ──

export type Entity = SkillEntity | AgentEntity | AutopilotEntity;

// ── Entity Registry Types ──

/** Manifest entry for a cached entity. */
export interface EntityManifestEntry {
  /** Serialized entity ref (e.g., 'multica/skill/golang-testing@1.2.0') */
  ref: EntityRefString;
  /** SHA256 hash of the canonical YAML */
  hash: string;
  /** Relative path from entities root (e.g., 'skill/golang-testing/1.2.0.yaml') */
  path: string;
  /** ISO 8601 timestamp of when the entity was imported */
  imported_at: string;
  /** Origin of the entity */
  source: 'local' | string;  // 'local' or remote name (e.g., 'my-team')
  /** Size in bytes */
  size: number;
}

/** The entities manifest file content. */
export interface EntityManifest {
  version: '1.0';
  updated_at: string;
  entities: Record<EntityRefString, EntityManifestEntry>;
}

/** Summary for entity listing (lightweight, no full content). */
export interface EntitySummary {
  ref: EntityRefString;
  type: EntityType;
  namespace: string;
  name: string;
  version: string;
  description: string;
  source: 'local' | string;
  size: number;
  imported_at: string;
  /** For agents: number of skill deps. For autopilots: agent_ref. */
  deps_info?: string;
  tags?: string[];
}

/** Filter for entity listing. */
export interface EntityFilter {
  type?: EntityType;
  namespace?: string;
  name_contains?: string;
  source?: 'local' | string;
  deprecated?: boolean;
}

// ── Dependency Resolution Types ──

/** A single resolved entity in the dependency DAG. */
export interface ResolvedEntity {
  /** The referenced entity, fully loaded from registry. */
  entity: Entity;
  /** Type of action for this entity in the current import. */
  action: 'create' | 'update' | 'skip';
  /** Reason for the action (e.g., 'already exists', 'new entity'). */
  reason?: string;
  /** Direct dependencies of this entity (entity refs it references). */
  dependencies: EntityRefString[];
}

/** A warning encountered during resolution. */
export interface ResolutionWarning {
  entity_ref: EntityRefString;
  message: string;
  /** Optional: suggested action for the user. */
  suggestion?: string;
}

/** An error encountered during resolution. */
export interface ResolutionError {
  entity_ref: EntityRefString;
  message: string;
  /** Optional: suggested action for the user. */
  suggestion?: string;
  /** Whether the error is fatal (blocks import) or can be skipped. */
  fatal: boolean;
}

/** Result of dependency resolution. */
export interface ResolutionResult {
  /** Resolved entities in topological order (skills → agents → autopilots). */
  entities: ResolvedEntity[];
  /** Non-fatal warnings. */
  warnings: ResolutionWarning[];
  /** Errors encountered. If any are fatal, the import is blocked. */
  errors: ResolutionError[];
  /** Root entity refs that initiated the resolution. */
  roots: EntityRefString[];
}

// ── Lockfile Types ──

/** Per-workspace entity lockfile. */
export interface EntityLockfile {
  version: '1.0';
  workspace_id: string;
  updated_at: string;
  /** Pinned entities: ref → exact version + hash. */
  pinned: Record<EntityRefString, {
    version: string;
    hash: string;
    imported_at: string;
  }>;
}

// ── Import/Export Integration Types ──

/** Options for installing an entity into a workspace. */
export interface EntityInstallOptions {
  /** Target workspace ID. */
  workspace_id: string;
  /** Runtime mapping: template runtime_provider → workspace runtime_id. */
  runtime_map?: Record<string, string>;
  /** Environment variable values (key → value). */
  env_vars?: Record<string, string>;
  /** Whether to fetch from remote if not in local cache. */
  fetch?: boolean;
  /** Whether to generate/update the lockfile. */
  lockfile?: boolean;
  /** Whether to force overwrite existing entities. */
  force?: boolean;
}

// ── Entity Parsing Utilities ──

/** Default namespace for entities. */
export const DEFAULT_NAMESPACE = 'multica';

/** Regex for valid entity names (kebab-case, alphanumeric + dots/hyphens/underscores). */
export const ENTITY_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}[a-z0-9]$/;

/**
 * Parse an entity reference string into its components.
 *
 * Format: [{namespace}/]{type}/{name}@[{semver}][#{hash}]
 *
 * Examples:
 *   "skill/golang-testing@1.2.0"   → { namespace: 'multica', type: 'skill', name: 'golang-testing', version: '1.2.0' }
 *   "multica/agent/worker@2.0.1#sha256:abc" → { namespace: 'multica', type: 'agent', ...}
 *   "agent/worker"                 → { namespace: 'multica', type: 'agent', name: 'worker' }
 */
export function parseEntityRef(ref: string): EntityRef {
  let remaining = ref.trim();

  // Extract hash pin: #sha256:...
  let hash: string | undefined;
  const hashIdx = remaining.lastIndexOf('#');
  if (hashIdx > 0 && remaining.slice(hashIdx + 1).startsWith('sha256:')) {
    hash = remaining.slice(hashIdx + 1);
    remaining = remaining.slice(0, hashIdx);
  }

  // Extract version: @version
  let version: string | undefined;
  const atIdx = remaining.lastIndexOf('@');
  if (atIdx > 0) {
    version = remaining.slice(atIdx + 1);
    remaining = remaining.slice(0, atIdx);
  }

  // Split by '/' to extract namespace, type, name
  const parts = remaining.split('/');
  let namespace = DEFAULT_NAMESPACE;
  let type: EntityType;
  let name: string;

  if (parts.length === 3) {
    // namespace/type/name
    namespace = parts[0];
    type = parts[1] as EntityType;
    name = parts[2];
  } else if (parts.length === 2) {
    // type/name
    type = parts[0] as EntityType;
    name = parts[1];
  } else {
    throw new Error(
      `Invalid entity ref "${ref}": expected format "{namespace}/type/name[@version][#hash]" or "type/name[@version][#hash]"`
    );
  }

  if (!['skill', 'agent', 'autopilot'].includes(type)) {
    throw new Error(`Invalid entity type "${type}" in ref "${ref}". Expected: skill, agent, or autopilot.`);
  }

  return { namespace, type, name, version, hash };
}

/**
 * Serialize an EntityRef back to a string.
 */
export function serializeEntityRef(ref: EntityRef): EntityRefString {
  let s = '';
  if (ref.namespace && ref.namespace !== DEFAULT_NAMESPACE) {
    s += `${ref.namespace}/`;
  }
  s += `${ref.type}/${ref.name}`;
  if (ref.version) {
    s += `@${ref.version}`;
  }
  if (ref.hash) {
    s += `#${ref.hash}`;
  }
  return s;
}

/**
 * Build the filesystem path for an entity within the registry.
 * Returns: {type}/{name}/{version}.yaml
 */
export function entityFilePath(ref: EntityRef): string {
  return `${ref.type}/${ref.name}/${ref.version}.yaml`;
}

/**
 * Build a short display string for an entity ref.
 * e.g., "agent/worker@2.0.1" or "multica/agent/worker@2.0.1"
 */
export function entityDisplayRef(ref: EntityRef, includeNamespace?: boolean): string {
  let s = '';
  if (includeNamespace && ref.namespace && ref.namespace !== DEFAULT_NAMESPACE) {
    s += `${ref.namespace}/`;
  }
  s += `${ref.type}/${ref.name}`;
  if (ref.version) {
    s += `@${ref.version}`;
  }
  return s;
}
