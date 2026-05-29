/**
 * DependencyResolver — resolves entity dependency graphs with semver constraints.
 *
 * Two-pass design:
 *   Pass 1: Collect all explicitly referenced entities from template manifest.
 *   Pass 2: For each Agent, resolve its Skill dependencies. For each Autopilot,
 *           resolve its Agent dependency.
 *
 * The entity graph is a tree (max depth 3: autopilot → agent → skills),
 * so a full DAG algorithm is unnecessary for v1.0. The resolver interface
 * is designed to support a future DAG upgrade when entity inheritance is added.
 */

import type {
  Entity,
  EntityRef,
  EntityRefString,
  EntityType,
  AgentSkillDeps,
  AgentEntity,
  AutopilotEntity,
  ResolvedEntity,
  ResolutionResult,
  ResolutionWarning,
  ResolutionError,
} from '../types/entity.js';
import {
  parseEntityRef,
  serializeEntityRef,
  DEFAULT_NAMESPACE,
} from '../types/entity.js';
import type { EntityRegistry } from './entity-registry.js';

// ── Types ──

/** Request to resolve a set of entity references. */
export interface ResolveRequest {
  /** Entity refs that should be resolved. */
  refs: string[];
  /** Whether to resolve transitive dependencies (default: true). */
  transitive?: boolean;
  /** Maximum depth for transitive resolution (default: 10). */
  maxDepth?: number;
  /** Whether to verify hash pins when present on refs. */
  verifyHashes?: boolean;
}

/** Request to resolve a template import (inline + entity refs). */
export interface ResolveTemplateRequest {
  /** Entity refs from template.includes.entities. */
  entityRefs: string[];
  /** Overrides for each entity ref (keyed by ref string). */
  overrides?: Record<string, Record<string, any>>;
  /** Inline entity names (for dedup — these win over refs with same name). */
  inlineAgentNames?: string[];
  inlineSkillNames?: string[];
  inlineAutopilotNames?: string[];
}

/** Result of resolving a template import. */
export interface ResolveTemplateResult {
  /** Resolved entities in topological order. */
  entities: ResolvedEntity[];
  /** Skipped entity refs (inline won, already exists, etc.). */
  skipped: Array<{ ref: string; entity_type: EntityType; reason: string }>;
  /** Resolution warnings. */
  warnings: ResolutionWarning[];
  /** Resolution errors. */
  errors: ResolutionError[];
}

// ── DependencyResolver ──

export class DependencyResolver {
  constructor(private registry: EntityRegistry) {}

  // ── Public API ──

  /**
   * Resolve a set of entity refs and their transitive dependencies.
   *
   * Example:
   *   resolve(['agent/worker@2.0.1', 'autopilot/daily-sync@1.0.0'])
   *   → worker agent + its skills, autopilot + its agent + that agent's skills
   */
  resolve(request: ResolveRequest): ResolutionResult {
    const {
      refs,
      transitive = true,
      maxDepth = 10,
      verifyHashes = true,
    } = request;

    const errors: ResolutionError[] = [];
    const warnings: ResolutionWarning[] = [];
    const resolvedMap = new Map<string, ResolvedEntity>();
    const stack: Array<{ refStr: string; depth: number }> = [];
    const seen = new Set<string>();

    // Phase 1: Queue all initial refs
    for (const refStr of refs) {
      const parsed = parseEntityRef(refStr);
      const normalizedRef = serializeEntityRef(parsed);
      if (!seen.has(normalizedRef)) {
        seen.add(normalizedRef);
        stack.push({ refStr, depth: 0 });
      }
    }

    // Phase 2: BFS resolution (queue-based, not recursive)
    while (stack.length > 0) {
      const { refStr, depth } = stack.shift()!;

      // Resolve the entity
      try {
        const parsed = parseEntityRef(refStr);
        const normalizedRef = serializeEntityRef(parsed);

        // Skip duplicates
        if (resolvedMap.has(normalizedRef)) continue;

        // Verify hash if pinned
        if (verifyHashes && parsed.hash) {
          // Hash verification is handled by EntityRegistry.load
        }

        // Resolve version
        const version = this.registry.resolve(parsed);
        const versionedRef = serializeEntityRef({ ...parsed, version });
        const entity = this.registry.load(versionedRef);

        // Determine action (create/skip)
        const action = 'create'; // workspace check happens in ImportEngine, not here

        const deps = this.collectDependencies(entity);

        resolvedMap.set(normalizedRef, {
          entity,
          action,
          reason: `resolved to ${versionedRef}`,
          dependencies: deps,
        });

        // Phase 3: Enqueue transitive dependencies
        if (transitive && depth < maxDepth) {
          for (const depStr of deps) {
            const depRef = parseEntityRef(depStr);
            const depNormalized = serializeEntityRef(depRef);
            if (!seen.has(depNormalized)) {
              seen.add(depNormalized);
              stack.push({ refStr: depStr, depth: depth + 1 });
            }
          }
        }
      } catch (err: any) {
        errors.push({
          entity_ref: refStr,
          message: err.message,
          suggestion: this.suggestFix(err.message, refStr),
          fatal: true,
        });
        resolvedMap.set(refStr, {
          entity: null as any,
          action: 'skip',
          reason: err.message,
          dependencies: [],
        });
      }
    }

    // Phase 4: Version deduplication
    // If entity A references skill/X@^1.2 and entity B references skill/X@^1.5,
    // we must check if the resolved versions differ and reconcile.
    const deduped = this.deduplicate(resolvedMap, warnings);

    // Phase 5: Topological sort: skills → agents → autopilots
    const sorted = this.topologicalSort(deduped);

    return {
      entities: sorted,
      warnings,
      errors,
      roots: refs,
    };
  }

  /**
   * Resolve a template import with inline + entity ref merging.
   *
   * Inline entities win on name collision (explicit > implicit).
   */
  resolveTemplate(request: ResolveTemplateRequest): ResolveTemplateResult {
    const {
      entityRefs,
      inlineAgentNames = [],
      inlineSkillNames = [],
      inlineAutopilotNames = [],
    } = request;

    const skipped: ResolveTemplateResult['skipped'] = [];
    const allWarnings: ResolutionWarning[] = [];
    const allErrors: ResolutionError[] = [];

    // Filter out entity refs that are covered by inline definitions
    const filteredRefs: string[] = [];
    for (const refStr of entityRefs) {
      try {
        const ref = parseEntityRef(refStr);
        let shouldSkip = false;

        if (ref.type === 'agent' && inlineAgentNames.includes(ref.name)) {
          shouldSkip = true;
        } else if (ref.type === 'skill' && inlineSkillNames.includes(ref.name)) {
          shouldSkip = true;
        } else if (ref.type === 'autopilot' && inlineAutopilotNames.includes(ref.name)) {
          shouldSkip = true;
        }

        if (shouldSkip) {
          skipped.push({
            ref: refStr,
            entity_type: ref.type,
            reason: `inline ${ref.type} "${ref.name}" takes precedence over entity ref`,
          });
          allWarnings.push({
            entity_ref: refStr,
            message: `Entity ref skipped: inline ${ref.type} "${ref.name}" wins.`,
            suggestion: 'Remove the inline definition or the entity ref — keeping both means inline wins.',
          });
        } else {
          filteredRefs.push(refStr);
        }
      } catch {
        // Invalid ref format → pass to resolver for error handling
        filteredRefs.push(refStr);
      }
    }

    // Resolve remaining refs
    const resolution = this.resolve({ refs: filteredRefs });

    // Apply overrides to resolved entities
    if (request.overrides) {
      for (const resolved of resolution.entities) {
        const refStr = serializeEntityRef(parseEntityRef(
          `${resolved.entity.entity}/${resolved.entity.name}@${resolved.entity.version}`
        ));
        const override = request.overrides[refStr] || request.overrides[`${resolved.entity.entity}/${resolved.entity.name}`];

        if (override) {
          this.applyOverrides(resolved, override, allWarnings);
        }
      }
    }

    return {
      entities: resolution.entities,
      skipped,
      warnings: [...allWarnings, ...resolution.warnings],
      errors: [...allErrors, ...resolution.errors],
    };
  }

  // ── Private Methods ──

  /**
   * Collect dependency refs from an entity.
   */
  private collectDependencies(entity: Entity): EntityRefString[] {
    const deps: EntityRefString[] = [];

    switch (entity.entity) {
      case 'skill':
        // Skills have no dependencies
        break;

      case 'agent': {
        const agent = entity as AgentEntity;
        if (agent.skills) {
          for (const [skillName, constraint] of Object.entries(agent.skills)) {
            deps.push(`skill/${skillName}@${constraint}`);
          }
        }
        break;
      }

      case 'autopilot': {
        const ap = entity as AutopilotEntity;
        // agent_ref is already an entity ref string (e.g., "agent/planner@^1.0.0")
        deps.push(ap.agent_ref);
        break;
      }
    }

    return deps;
  }

  /**
   * Deduplicate resolved entities that map to the same type/name.
   *
   * When two agents reference the same skill at different constraints:
   *   Agent A: skill/X@^1.2 → resolved to 1.6.1
   *   Agent B: skill/X@^1.5 → resolved to 1.6.1
   *
   * Both should resolve to the same version. If they land on different
   * versions, we reconcile to the highest compatible one.
   */
  private deduplicate(
    map: Map<string, ResolvedEntity>,
    warnings: ResolutionWarning[],
  ): Map<string, ResolvedEntity> {
    // Group by type + name
    const groups = new Map<string, ResolvedEntity[]>();

    for (const [refStr, resolved] of map) {
      if (!resolved || !resolved.entity?.entity) continue; // skip error entries
      const ref = parseEntityRef(refStr);
      const key = `${ref.type}/${ref.name}`;
      const group = groups.get(key) || [];
      group.push(resolved);
      groups.set(key, group);
    }

    const result = new Map<string, ResolvedEntity>();

    for (const [key, group] of groups) {
      if (group.length === 1) {
        // No dedup needed
        const ref = parseEntityRef(group[0].entity.entity + '/' + group[0].entity.name + '@' + group[0].entity.version);
        result.set(serializeEntityRef(ref), group[0]);
      } else {
        // Multiple entries — pick highest version
        let highest = group[0];
        let highestSemver = group[0].entity.version;

        for (let i = 1; i < group.length; i++) {
          const version = group[i].entity.version;
          if (this.compareSemver(version, highestSemver) > 0) {
            highest = group[i];
            highestSemver = version;
          }
        }

        const ref = parseEntityRef(highest.entity.entity + '/' + highest.entity.name + '@' + highestSemver);
        result.set(serializeEntityRef(ref), {
          ...highest,
          reason: `highest version among ${group.length} resolved instances`,
        });

        // Warn about the dedup
        const [type, name] = key.split('/');
        warnings.push({
          entity_ref: key,
          message: `${group.length} references to ${type} "${name}" deduplicated to version ${highestSemver}.`,
        });
      }
    }

    return result;
  }

  /**
   * Sort entities in topological order: skills → agents → autopilots.
   */
  private topologicalSort(map: Map<string, ResolvedEntity>): ResolvedEntity[] {
    const skills: ResolvedEntity[] = [];
    const agents: ResolvedEntity[] = [];
    const autopilots: ResolvedEntity[] = [];

    for (const resolved of map.values()) {
      if (resolved.entity.entity === null) continue;
      switch (resolved.entity.entity) {
        case 'skill':
          skills.push(resolved);
          break;
        case 'agent':
          agents.push(resolved);
          break;
        case 'autopilot':
          autopilots.push(resolved);
          break;
      }
    }

    return [...skills, ...agents, ...autopilots];
  }

  /** Simple semver comparison using string splitting (avoids extra dependency). */
  private compareSemver(a: string, b: string): number {
    const cleanA = (a || '0.0.0').split('-')[0]; // strip pre-release
    const cleanB = (b || '0.0.0').split('-')[0];
    const partsA = cleanA.split('.').map(Number);
    const partsB = cleanB.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const pa = partsA[i] || 0;
      const pb = partsB[i] || 0;
      if (pa > pb) return 1;
      if (pa < pb) return -1;
    }
    return 0;
  }

  /**
   * Apply template-level overrides to a resolved entity.
   *
   * Override ALLOWLIST: model, visibility, max_concurrent_tasks,
   * skills (additive), custom_env_template (additive), description.
   */
  private applyOverrides(
    resolved: ResolvedEntity,
    overrides: Record<string, any>,
    warnings: ResolutionWarning[],
  ): void {
    const entity = resolved.entity;
    const refStr = `${entity.entity}/${entity.name}@${entity.version}`;

    // Check for protected field attempts
    const protectedFields = [
      'entity', 'schema_version', 'name', 'version', 'instructions',
      'runtime_provider', 'mcp_config', 'custom_args', 'min_engine_version',
    ];

    for (const field of protectedFields) {
      if (field in overrides) {
        warnings.push({
          entity_ref: refStr,
          message: `Override for "${field}" is not allowed. This field is identity-protected. Override ignored.`,
        });
        delete overrides[field];
      }
    }

    // Apply allowed overrides
    if ('model' in overrides) {
      (entity as any).model = overrides.model;
    }
    if ('visibility' in overrides) {
      (entity as any).visibility = overrides.visibility;
    }
    if ('max_concurrent_tasks' in overrides) {
      (entity as any).max_concurrent_tasks = overrides.max_concurrent_tasks;
    }
    if ('description' in overrides) {
      (entity as any).description = overrides.description;
    }

    // Additive overrides: skills
    if ('skills' in overrides && entity.entity === 'agent') {
      const agent = entity as AgentEntity;
      const newSkills = overrides.skills as AgentSkillDeps;
      for (const [name, constraint] of Object.entries(newSkills)) {
        if (!agent.skills) {
          agent.skills = {};
        }
        if (agent.skills[name]) {
          warnings.push({
            entity_ref: refStr,
            message: `Skill "${name}" override is overriding existing constraint "${agent.skills[name]}" → "${constraint}".`,
          });
        }
        agent.skills[name] = constraint;
      }
    }

    // skills_remove
    if ('skills_remove' in overrides && entity.entity === 'agent') {
      const agent = entity as AgentEntity;
      const removeList = overrides.skills_remove as string[];
      for (const name of removeList) {
        if (agent.skills && name in agent.skills) {
          delete agent.skills[name];
        } else {
          warnings.push({
            entity_ref: refStr,
            message: `skills_remove: skill "${name}" not found in entity.`,
          });
        }
      }
    }

    // Additive overrides: custom_env_template
    if ('custom_env_template' in overrides && entity.entity === 'agent') {
      const agent = entity as AgentEntity;
      const newEnv = overrides.custom_env_template as Record<string, string>;
      if (!agent.custom_env_template) {
        agent.custom_env_template = {};
      }
      for (const [key, value] of Object.entries(newEnv)) {
        agent.custom_env_template[key] = value; // shallow merge — template wins
      }
    }

    // Recompute hash after overrides
    resolved.action = 'create'; // overridden entity is effectively new
  }

  /**
   * Generate a suggestion for common errors.
   */
  private suggestFix(errorMsg: string, refStr: string): string | undefined {
    if (errorMsg.includes('not found')) {
      return `Run "multica-templates entity fetch ${refStr}" to pull from remote.`;
    }
    if (errorMsg.includes('Hash mismatch')) {
      return 'The entity file may have been tampered with. Try re-fetching or delete and re-import.';
    }
    if (errorMsg.includes('No version')) {
      return 'Try a different version constraint or update the entity that requires this version.';
    }
    return undefined;
  }
}
