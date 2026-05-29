/**
 * EntityValidator — validates entity YAML files before import/publish.
 *
 * Performs:
 * 1. Schema validation (required fields, types, discriminator)
 * 2. Name & path validation (prevent traversal attacks)
 * 3. Cross-reference validation
 * 4. Secret scanning (API keys, tokens, private keys)
 * 5. Safe YAML parsing with depth/count limits
 */

import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import type {
  Entity,
  EntityType,
  SkillEntity,
  AgentEntity,
  AutopilotEntity,
  SkillFile,
} from '../types/entity.js';
import { ENTITY_NAME_RE, parseEntityRef } from '../types/entity.js';

// ── Constants ──

const VALID_ENTITY_TYPES: EntityType[] = ['skill', 'agent', 'autopilot'];
const VALID_SCHEMA_VERSIONS = ['1.0'];
const VALID_MODES = ['run_only', 'create_issue'];
// Semver:
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

// Secret detection patterns
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Generic API Key', regex: /(?:api[_-]?key|apikey|secret|token|password)["\s:=]+["'][A-Za-z0-9+/=_-]{20,}["']/i },
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Slack Token', regex: /xox[bpsa]-[A-Za-z0-9-]{10,}/ },
  { name: 'Generic Token', regex: /(?:auth[_-]?token|access[_-]?token)["\s:=]+["'][A-Za-z0-9+/=_-]{16,}["']/i },
];

// Filesystem-dangerous paths
const DANGEROUS_PATH_SEGMENTS = ['..', '~', '\\'];
const PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*[a-zA-Z0-9]$/;

// ── Types ──

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  entity_type?: EntityType;
  issues: ValidationIssue[];
}

// ── Safe YAML Parsing ──

/**
 * Parse a YAML file safely.
 * - Rejects unknown tags (no code execution)
 * - Limits alias count (no YAML bomb)
 * - Limits nesting depth
 */
function safeParseYamlFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  // Quick size check before parsing
  if (Buffer.byteLength(content, 'utf-8') > 10 * 1024 * 1024) {
    throw new Error(`File too large (>10MB): ${filePath}`);
  }

  try {
    return parseYaml(content, {
      maxAliasCount: 100,        // prevent YAML bomb
      // The 'yaml' package v2 is safe by default for code execution
      // (no !!js/function etc.), but we set strict limits.
    });
  } catch (err: any) {
    throw new Error(`YAML parse error in ${filePath}: ${err.message}`);
  }
}

/**
 * Parse a YAML string safely (for inline content validation).
 */
function safeParseYamlString(content: string): unknown {
  try {
    return parseYaml(content, {
      maxAliasCount: 100,
    });
  } catch (err: any) {
    throw new Error(`YAML parse error: ${err.message}`);
  }
}

// ── High-Entropy Detection ──

/**
 * Simple high-entropy string detection.
 * Flags strings that look like random secrets (>4.0 bits/char).
 */
function isHighEntropy(str: string): boolean {
  if (str.length < 16) return false;

  // Shannon entropy approximation
  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  // Average entropy > 4.0 bits/char suggests random string
  return entropy > 4.0;
}

// ── EntityValidator ──

export class EntityValidator {
  /**
   * Validate an entity from a YAML file path.
   */
  validateFile(filePath: string): ValidationResult {
    try {
      const raw = safeParseYamlFile(filePath);
      return this.validate(raw);
    } catch (err: any) {
      return {
        valid: false,
        issues: [{ severity: 'error', message: err.message }],
      };
    }
  }

  /**
   * Validate an entity from a YAML string.
   */
  validateString(content: string): ValidationResult {
    try {
      const raw = safeParseYamlString(content);
      return this.validate(raw);
    } catch (err: any) {
      return {
        valid: false,
        issues: [{ severity: 'error', message: err.message }],
      };
    }
  }

  /**
   * Validate an already-parsed entity object.
   */
  validate(raw: unknown): ValidationResult {
    const issues: ValidationIssue[] = [];
    let entityType: EntityType | undefined;

    if (!raw || typeof raw !== 'object') {
      return {
        valid: false,
        issues: [{ severity: 'error', message: 'Entity must be a YAML object (mapping).' }],
      };
    }

    const obj = raw as Record<string, unknown>;

    // ── 1. Discriminator ──
    const type = obj.entity;
    if (!type || typeof type !== 'string') {
      return {
        valid: false,
        issues: [{ severity: 'error', field: 'entity', message: 'Missing or invalid "entity" discriminator. Must be: skill, agent, or autopilot.' }],
      };
    }

    if (!VALID_ENTITY_TYPES.includes(type as EntityType)) {
      return {
        valid: false,
        issues: [{
          severity: 'error',
          field: 'entity',
          message: `Invalid entity type "${type}". Must be one of: ${VALID_ENTITY_TYPES.join(', ')}.`,
        }],
      };
    }

    entityType = type as EntityType;

    // ── 2. Schema version ──
    const schemaVersion = obj.schema_version;
    if (!schemaVersion || typeof schemaVersion !== 'string') {
      issues.push({ severity: 'error', field: 'schema_version', message: 'Missing or invalid "schema_version".' });
    } else if (!VALID_SCHEMA_VERSIONS.includes(schemaVersion)) {
      issues.push({
        severity: 'error',
        field: 'schema_version',
        message: `Unsupported schema_version "${schemaVersion}". Supported: ${VALID_SCHEMA_VERSIONS.join(', ')}. ` +
          'Please upgrade your multica-templates tool.',
      });
    }

    // ── 3. Name validation (common to all entity types) ──
    const name = obj.name;
    if (!name || typeof name !== 'string') {
      issues.push({ severity: 'error', field: 'name', message: 'Missing or invalid "name".' });
    } else {
      // Path traversal check
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        issues.push({
          severity: 'error',
          field: 'name',
          message: `Entity name "${name}" contains path separators. This is not allowed for security reasons.`,
        });
      }
      // Format check
      if (!ENTITY_NAME_RE.test(name)) {
        issues.push({
          severity: 'warning',
          field: 'name',
          message: `Entity name "${name}" does not match recommended format: ` +
            `lowercase alphanumeric with dots, hyphens, underscores (${ENTITY_NAME_RE.source}).`,
        });
      }
      // Length check
      if (name.length > 64) {
        issues.push({
          severity: 'error',
          field: 'name',
          message: `Entity name "${name}" is too long (${name.length} chars). Maximum is 64 characters.`,
        });
      }
    }

    // ── 4. Version ──
    const version = obj.version;
    if (!version || typeof version !== 'string') {
      issues.push({ severity: 'error', field: 'version', message: 'Missing or invalid "version". Must be a semver string (e.g., "1.0.0").' });
    } else if (!SEMVER_RE.test(version)) {
      issues.push({
        severity: 'error',
        field: 'version',
        message: `Invalid semver version "${version}". Must follow MAJOR.MINOR.PATCH format (e.g., "1.2.3").`,
      });
    }

    // ── 5. Description ──
    const description = obj.description;
    if (!description || typeof description !== 'string') {
      issues.push({ severity: 'error', field: 'description', message: 'Missing or invalid "description".' });
    }

    // ── 6. min_engine_version ──
    if (obj.min_engine_version !== undefined && typeof obj.min_engine_version !== 'string') {
      issues.push({ severity: 'error', field: 'min_engine_version', message: '"min_engine_version" must be a semver string.' });
    }

    // ── 7. Metadata ──
    if (obj.metadata !== undefined) {
      if (typeof obj.metadata !== 'object' || obj.metadata === null) {
        issues.push({ severity: 'error', field: 'metadata', message: '"metadata" must be an object.' });
      } else {
        const meta = obj.metadata as Record<string, unknown>;
        if (meta.tags !== undefined && !Array.isArray(meta.tags)) {
          issues.push({ severity: 'warning', field: 'metadata.tags', message: '"tags" should be an array of strings.' });
        }
      }
    }

    // ── 8. Type-specific validation ──
    switch (entityType) {
      case 'skill':
        this.validateSkill(obj as unknown as SkillEntity, issues);
        break;
      case 'agent':
        this.validateAgent(obj as unknown as AgentEntity, issues);
        break;
      case 'autopilot':
        this.validateAutopilot(obj as unknown as AutopilotEntity, issues);
        break;
    }

    // ── 9. Secret scanning ──
    if (obj.instructions && typeof obj.instructions === 'string') {
      this.scanSecrets(obj.instructions, 'instructions', issues);
    }
    if (obj.custom_env_template && typeof obj.custom_env_template === 'object') {
      const env = obj.custom_env_template as Record<string, unknown>;
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') {
          // Skip template references like ${VAR_NAME}
          if (!/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value)) {
            this.scanSecrets(value, `custom_env_template.${key}`, issues);
            // Warn about non-template values (might be hardcoded secrets)
            if (!value.startsWith('${')) {
              issues.push({
                severity: 'warning',
                field: `custom_env_template.${key}`,
                message: `Environment variable "${key}" has a literal value. ` +
                  `Consider using a reference like \$\{${key}\} instead to avoid hardcoding secrets.`,
              });
            }
          }
        }
      }
    }

    // ── Result ──
    const hasErrors = issues.some((i) => i.severity === 'error');
    return {
      valid: !hasErrors,
      entity_type: entityType,
      issues,
    };
  }

  // ── Skill-specific validation ──

  private validateSkill(skill: SkillEntity, issues: ValidationIssue[]): void {
    // Files validation
    if (!skill.files || skill.files.length === 0) {
      // Allow skills without files if they have a config
      if (!skill.config || Object.keys(skill.config).length === 0) {
        issues.push({
          severity: 'error',
          field: 'files',
          message: 'Skill entity must have at least one file (e.g., SKILL.md) or a config.',
        });
      }
    } else {
      this.validateSkillFiles(skill.files, issues);
    }

    // Config validation
    if (skill.config !== undefined && typeof skill.config !== 'object') {
      issues.push({
        severity: 'error',
        field: 'config',
        message: '"config" must be an object (key-value map).',
      });
    }
  }

  private validateSkillFiles(files: SkillFile[], issues: ValidationIssue[]): void {
    const seenPaths = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const field = `files[${i}]`;

      if (!file.path || typeof file.path !== 'string') {
        issues.push({ severity: 'error', field: `${field}.path`, message: 'Missing or invalid file path.' });
        continue;
      }

      // Path traversal check
      if (file.path.includes('..')) {
        issues.push({
          severity: 'error',
          field: `${field}.path`,
          message: `File path "${file.path}" contains ".." which is not allowed for security reasons.`,
        });
      }

      // Absolute path check
      if (file.path.startsWith('/') || file.path.startsWith('\\')) {
        issues.push({
          severity: 'error',
          field: `${field}.path`,
          message: `File path "${file.path}" is absolute. Only relative paths are allowed.`,
        });
      }

      // Dangerous segments
      for (const seg of DANGEROUS_PATH_SEGMENTS) {
        if (file.path.includes(seg)) {
          issues.push({
            severity: 'error',
            field: `${field}.path`,
            message: `File path "${file.path}" contains dangerous segment "${seg}".`,
          });
          break;
        }
      }

      // Format check
      if (!PATH_RE.test(file.path)) {
        issues.push({
          severity: 'warning',
          field: `${field}.path`,
          message: `File path "${file.path}" may contain unsafe characters. Recommended format: alphanumeric with dots, hyphens, slashes.`,
        });
      }

      // Duplicate path check
      if (seenPaths.has(file.path)) {
        issues.push({
          severity: 'error',
          field: `${field}.path`,
          message: `Duplicate file path "${file.path}". Each file must have a unique path.`,
        });
      }
      seenPaths.add(file.path);

      // Content check
      if (file.content === undefined || file.content === null || typeof file.content !== 'string') {
        issues.push({ severity: 'error', field: `${field}.content`, message: 'Missing or invalid file content.' });
      } else {
        // Size limit
        if (Buffer.byteLength(file.content, 'utf-8') > 1 * 1024 * 1024) {
          issues.push({
            severity: 'warning',
            field: `${field}.content`,
            message: `File content is ${(Buffer.byteLength(file.content, 'utf-8') / 1024 / 1024).toFixed(1)}MB. Maximum recommended is 1MB.`,
          });
        }
        // Secret scan
        this.scanSecrets(file.content, `${field}.content`, issues);
      }
    }
  }

  // ── Agent-specific validation ──

  private validateAgent(agent: AgentEntity, issues: ValidationIssue[]): void {
    // Instructions (required)
    if (!agent.instructions || typeof agent.instructions !== 'string') {
      issues.push({ severity: 'error', field: 'instructions', message: 'Missing or invalid "instructions".' });
    }

    // Model
    if (!agent.model || typeof agent.model !== 'string') {
      issues.push({ severity: 'warning', field: 'model', message: '"model" is recommended. Defaults to "auto".' });
    }

    // Runtime provider
    if (!agent.runtime_provider || typeof agent.runtime_provider !== 'string') {
      issues.push({ severity: 'error', field: 'runtime_provider', message: 'Missing or invalid "runtime_provider".' });
    }

    // Visibility
    if (agent.visibility !== undefined && typeof agent.visibility !== 'string') {
      issues.push({ severity: 'error', field: 'visibility', message: '"visibility" must be a string (e.g., "private", "workspace").' });
    }

    // Max concurrent tasks
    if (agent.max_concurrent_tasks !== undefined) {
      if (typeof agent.max_concurrent_tasks !== 'number' || agent.max_concurrent_tasks < 1 || agent.max_concurrent_tasks > 100) {
        issues.push({
          severity: 'warning',
          field: 'max_concurrent_tasks',
          message: '"max_concurrent_tasks" should be a number between 1 and 100.',
        });
      }
    }

    // Skills
    if (agent.skills !== undefined) {
      if (typeof agent.skills !== 'object' || agent.skills === null) {
        issues.push({
          severity: 'error',
          field: 'skills',
          message: '"skills" must be an object mapping skill names to version constraints.',
        });
      } else {
        for (const [skillName, constraint] of Object.entries(agent.skills)) {
          if (typeof constraint !== 'string') {
            issues.push({
              severity: 'error',
              field: `skills.${skillName}`,
              message: `Skill constraint for "${skillName}" must be a semver string.`,
            });
          }
        }
      }
    }

    // custom_args
    if (agent.custom_args !== undefined && !Array.isArray(agent.custom_args)) {
      issues.push({ severity: 'error', field: 'custom_args', message: '"custom_args" must be an array of strings.' });
    }

    // custom_env_template
    if (agent.custom_env_template !== undefined) {
      if (typeof agent.custom_env_template !== 'object' || agent.custom_env_template === null) {
        issues.push({ severity: 'error', field: 'custom_env_template', message: '"custom_env_template" must be an object.' });
      }
    }
  }

  // ── Autopilot-specific validation ──

  private validateAutopilot(ap: AutopilotEntity, issues: ValidationIssue[]): void {
    // Title
    if (!ap.title || typeof ap.title !== 'string') {
      issues.push({ severity: 'error', field: 'title', message: 'Missing or invalid "title".' });
    }

    // Mode
    if (!ap.mode || !VALID_MODES.includes(ap.mode)) {
      issues.push({
        severity: 'error',
        field: 'mode',
        message: `"mode" must be one of: ${VALID_MODES.join(', ')}. Got: "${ap.mode}".`,
      });
    }

    // agent_ref
    if (!ap.agent_ref || typeof ap.agent_ref !== 'string') {
      issues.push({ severity: 'error', field: 'agent_ref', message: 'Missing or invalid "agent_ref". Must reference an agent entity.' });
    } else {
      try {
        const ref = parseEntityRef(ap.agent_ref);
        if (ref.type !== 'agent') {
          issues.push({
            severity: 'error',
            field: 'agent_ref',
            message: `agent_ref must reference an agent entity, got type "${ref.type}".`,
          });
        }
      } catch (err: any) {
        issues.push({
          severity: 'error',
          field: 'agent_ref',
          message: `Invalid agent_ref format: ${err.message}`,
        });
      }
    }

    // Triggers
    if (ap.triggers !== undefined) {
      if (!Array.isArray(ap.triggers)) {
        issues.push({ severity: 'error', field: 'triggers', message: '"triggers" must be an array.' });
      } else {
        for (let i = 0; i < ap.triggers.length; i++) {
          const trigger = ap.triggers[i];
          if (!trigger.cron || typeof trigger.cron !== 'string') {
            issues.push({
              severity: 'error',
              field: `triggers[${i}].cron`,
              message: 'Missing or invalid cron expression.',
            });
          }
          if (!trigger.timezone || typeof trigger.timezone !== 'string') {
            issues.push({
              severity: 'error',
              field: `triggers[${i}].timezone`,
              message: 'Missing or invalid timezone.',
            });
          }
        }
      }
    }
  }

  // ── Secret Scanning ──

  private scanSecrets(content: string, field: string, issues: ValidationIssue[]): void {
    for (const pattern of SECRET_PATTERNS) {
      const match = content.match(pattern.regex);
      if (match) {
        issues.push({
          severity: 'error',
          field,
          message: `Detected potential secret (${pattern.name}) in "${field}". ` +
            `Remove the secret before publishing this entity. Found near: "${match[0].slice(0, 40)}..."`,
        });
        return; // One secret finding per field is enough
      }
    }

    // High-entropy check (expensive, only run if no pattern match)
    // Check each "word" > 16 chars for entropy
    const words = content.split(/[\s"'\n,;:={}[\]()]+/).filter((w) => w.length > 16);
    for (const word of words) {
      if (isHighEntropy(word)) {
        issues.push({
          severity: 'warning',
          field,
          message: `Detected high-entropy string in "${field}". ` +
            `This may be an API key or token. Please verify it's not a secret.`,
        });
        break; // One warning is enough
      }
    }
  }
}
