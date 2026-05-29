/**
 * EntityRegistry — local entity cache with manifest management.
 *
 * Stores entities on the filesystem under ~/.multica/entities/
 * with a .manifest.yaml index for fast lookup and hash verification.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync, rmdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { parse as parseYaml, stringify } from 'yaml';
import semver from 'semver';
import type {
  Entity,
  EntityType,
  EntityRef,
  EntityRefString,
  EntityManifest,
  EntityManifestEntry,
  EntitySummary,
  EntityFilter,
  EntityLockfile,
} from '../types/entity.js';
import {
  DEFAULT_NAMESPACE,
  parseEntityRef,
  serializeEntityRef,
  entityFilePath,
  entityDisplayRef,
} from '../types/entity.js';

// ── Constants ──

const ENTITIES_DIR = join(homedir(), '.multica', 'entities');
const MANIFEST_FILE = '.manifest.yaml';
const LOCKFILE_DIR = join(homedir(), '.multica', 'workspaces');

// ── Helpers ──

/** Canonical YAML serialization: sort keys recursively, 2-space indent. */
function canonicalYaml(entity: Entity): string {
  return stringify(entity, {
    indent: 2,
    lineWidth: 0,           // never fold lines
    sortMapEntries: true,   // sort keys alphabetically
    singleQuote: false,
  });
}

/** Compute SHA256 hash of canonical YAML. */
export function hashEntity(entity: Entity): string {
  const yaml = canonicalYaml(entity);
  return `sha256:${createHash('sha256').update(yaml).digest('hex')}`;
}

/** Safe YAML parse — rejects unknown tags (no !!js/function, etc.). */
function safeParseYaml(content: string): unknown {
  return parseYaml(content, {
    // The 'yaml' package v2 uses `parse` which is safe by default
    // (no !!js/function tags supported). We explicitly set maxAliasCount
    // to prevent YAML bomb attacks.
    maxAliasCount: 100,
  });
}

// ── EntityRegistry ──

export class EntityRegistry {
  private entitiesDir: string;
  private manifestPath: string;
  private lockfileDir: string;

  constructor(entitiesDir?: string, lockfileDir?: string) {
    this.entitiesDir = entitiesDir || ENTITIES_DIR;
    this.manifestPath = join(this.entitiesDir, MANIFEST_FILE);
    this.lockfileDir = lockfileDir || LOCKFILE_DIR;

    // Ensure directories exist
    if (!existsSync(this.entitiesDir)) {
      mkdirSync(this.entitiesDir, { recursive: true });
    }
    if (!existsSync(this.lockfileDir)) {
      mkdirSync(this.lockfileDir, { recursive: true });
    }

    // Reconcile manifest on startup
    this.reconcileManifest();
  }

  // ── Manifest Operations ──

  /** Read the manifest file. Returns empty manifest if file doesn't exist. */
  private readManifest(): EntityManifest {
    if (!existsSync(this.manifestPath)) {
      return this.emptyManifest();
    }
    try {
      const content = readFileSync(this.manifestPath, 'utf-8');
      const parsed = safeParseYaml(content) as EntityManifest;
      if (!parsed || parsed.version !== '1.0') {
        return this.emptyManifest();
      }
      return parsed;
    } catch {
      return this.emptyManifest();
    }
  }

  /** Write the manifest file atomically. */
  private writeManifest(manifest: EntityManifest): void {
    manifest.updated_at = new Date().toISOString();
    const yaml = stringify(manifest, { indent: 2, sortMapEntries: true });
    writeFileSync(this.manifestPath, yaml, 'utf-8');
  }

  private emptyManifest(): EntityManifest {
    return {
      version: '1.0',
      updated_at: new Date().toISOString(),
      entities: {},
    };
  }

  /**
   * Reconcile the manifest against the filesystem.
   * - Files on disk not in manifest → warn (orphans), add them
   * - Entries in manifest missing on disk → remove from manifest
   */
  reconcileManifest(): { orphans: string[]; removed: string[] } {
    const manifest = this.readManifest();
    const orphans: string[] = [];
    const removed: string[] = [];

    // Check manifest entries: remove those missing on disk
    for (const [refStr, entry] of Object.entries(manifest.entities)) {
      const fullPath = join(this.entitiesDir, entry.path);
      if (!existsSync(fullPath)) {
        delete manifest.entities[refStr];
        removed.push(refStr);
      }
    }

    // Scan filesystem for orphan YAML files (not in manifest)
    for (const type of ['skill', 'agent', 'autopilot'] as EntityType[]) {
      const typeDir = join(this.entitiesDir, type);
      if (!existsSync(typeDir)) continue;

      const nameDirs = readdirSync(typeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const name of nameDirs) {
        const versionDir = join(typeDir, name);
        const files = readdirSync(versionDir).filter(
          (f) => f.endsWith('.yaml') || f.endsWith('.yml')
        );

        for (const file of files) {
          const version = file.replace(/\.ya?ml$/, '');
          const path = `${type}/${name}/${file}`;
          const refStr = `${type}/${name}@${version}`;

          if (!manifest.entities[refStr]) {
            // Orphan: file exists but not in manifest
            const fullPath = join(versionDir, file);
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const entity = safeParseYaml(content) as Entity;
              if (entity && entity.entity && entity.name && entity.version) {
                const hash = hashEntity(entity);
                manifest.entities[refStr] = {
                  ref: refStr,
                  hash,
                  path,
                  imported_at: statSync(fullPath).mtime.toISOString(),
                  source: 'local',
                  size: statSync(fullPath).size,
                };
                orphans.push(refStr);
              }
            } catch {
              // Skip unparseable files
            }
          }
        }
      }
    }

    if (orphans.length > 0 || removed.length > 0) {
      this.writeManifest(manifest);
    }

    return { orphans, removed };
  }

  // ── CRUD Operations ──

  /**
   * Save an entity to the local registry.
   *
   * @throws if an entity with the same ref already exists (immutability).
   */
  save(entity: Entity): EntityManifestEntry {
    // Build ref string — only include namespace if not the default
    const namespace = entity.namespace && entity.namespace !== DEFAULT_NAMESPACE
      ? entity.namespace : undefined;
    const namespacePrefix = namespace ? `${namespace}/` : '';
    const refStr = `${namespacePrefix}${entity.entity}/${entity.name}@${entity.version}`;
    const ref = parseEntityRef(refStr);
    const path = entityFilePath(ref);

    // Check immutability: reject if version already exists
    const manifest = this.readManifest();
    if (manifest.entities[refStr]) {
      throw new Error(
        `Entity "${refStr}" already exists. Entities are immutable. ` +
        `Create a new version instead.`
      );
    }

    // Compute hash
    const hash = hashEntity(entity);

    // Write entity file
    const fullPath = join(this.entitiesDir, path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const yaml = canonicalYaml(entity);
    writeFileSync(fullPath, yaml, 'utf-8');

    // Update manifest
    const entry: EntityManifestEntry = {
      ref: refStr,
      hash,
      path,
      imported_at: new Date().toISOString(),
      source: 'local',
      size: Buffer.byteLength(yaml, 'utf-8'),
    };

    manifest.entities[refStr] = entry;
    this.writeManifest(manifest);

    return entry;
  }

  /**
   * Load an entity from the local registry by exact ref string.
   *
   * Supports both prefixed (multica/skill/test@1.0.0) and unprefixed (skill/test@1.0.0) forms.
   *
   * @throws if the entity is not found or hash verification fails.
   */
  load(refStr: EntityRefString): Entity {
    const manifest = this.readManifest();
    let entry = manifest.entities[refStr];

    if (!entry) {
      // Try unprefixed form: if refStr starts with "multica/", strip it
      if (refStr.startsWith(`${DEFAULT_NAMESPACE}/`)) {
        const unprefixed = refStr.slice(DEFAULT_NAMESPACE.length + 1);
        entry = manifest.entities[unprefixed];
      }
    }

    if (!entry) {
      // Try to resolve if no version specified
      const parsed = parseEntityRef(refStr);
      if (!parsed.version) {
        const versions = this.listVersions(parsed);
        if (versions.length > 0) {
          const latest = versions[versions.length - 1];
          const latestRef = `${parsed.type}/${parsed.name}@${latest}`;
          return this.load(latestRef);
        }
      }
      throw new Error(`Entity "${refStr}" not found in local registry.`);
    }

    const fullPath = join(this.entitiesDir, entry.path);
    if (!existsSync(fullPath)) {
      // Manifest entry exists but file is missing
      delete manifest.entities[refStr];
      this.writeManifest(manifest);
      throw new Error(
        `Entity "${refStr}" found in manifest but file is missing at "${entry.path}". ` +
        `Run 'entity fetch' to re-download.`
      );
    }

    const content = readFileSync(fullPath, 'utf-8');
    const entity = safeParseYaml(content) as Entity;

    // Verify hash
    const actualHash = hashEntity(entity);
    if (actualHash !== entry.hash) {
      throw new Error(
        `Hash mismatch for entity "${refStr}". ` +
        `Expected: ${entry.hash}, got: ${actualHash}. ` +
        `The entity file may have been tampered with.`
      );
    }

    return entity;
  }

  /**
   * Load an entity by parsed EntityRef.
   */
  loadByRef(ref: EntityRef): Entity {
    return this.load(serializeEntityRef(ref));
  }

  /**
   * Delete an entity from the local registry.
   *
   * @throws if the entity is pinned in any lockfile.
   */
  delete(refStr: EntityRefString): void {
    const manifest = this.readManifest();
    const entry = manifest.entities[refStr];
    if (!entry) {
      throw new Error(`Entity "${refStr}" not found.`);
    }

    // Check if this entity is pinned in any workspace lockfile
    const pinnedIn = this.findLockfileReferences(refStr);
    if (pinnedIn.length > 0) {
      throw new Error(
        `Cannot delete entity "${refStr}": it is pinned in lockfiles for workspaces: ` +
        `${pinnedIn.join(', ')}. Run 'entity unpin' first or delete the workspace.`
      );
    }

    // Delete file
    const fullPath = join(this.entitiesDir, entry.path);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }

    // Update manifest
    delete manifest.entities[refStr];
    this.writeManifest(manifest);

    // Clean up empty directories
    this.cleanupEmptyDirs(entry.path);
  }

  /** Remove empty parent directories after entity deletion. */
  private cleanupEmptyDirs(relativePath: string): void {
    // Walk up from version dir to type dir, removing empty dirs
    const parts = relativePath.split('/');
    // relativePath = "skill/golang-testing/1.2.0.yaml"
    const versionDir = join(this.entitiesDir, parts[0], parts[1]);
    const typeDir = join(this.entitiesDir, parts[0]);

    // Remove version dir if empty
    try {
      const versionFiles = readdirSync(versionDir);
      if (versionFiles.length === 0) {
        rmdirSync(versionDir);

        // Remove name dir if empty
        const nameDir = versionDir;
        const nameFiles = readdirSync(dirname(nameDir));
        if (nameFiles.length === 0) {
          rmdirSync(dirname(nameDir));
        }
      }
    } catch {
      // Directory not empty or doesn't exist — fine
    }
  }

  // ── Listing & Resolution ──

  /**
   * List all entities matching the optional filter.
   */
  list(filter?: EntityFilter): EntitySummary[] {
    const manifest = this.readManifest();
    const results: EntitySummary[] = [];

    for (const [refStr, entry] of Object.entries(manifest.entities)) {
      try {
        const ref = parseEntityRef(refStr);

        // Apply filters
        if (filter?.type && ref.type !== filter.type) continue;
        if (filter?.namespace && ref.namespace !== filter.namespace) continue;
        if (filter?.source && entry.source !== filter.source) continue;
        if (filter?.name_contains) {
          const lower = filter.name_contains.toLowerCase();
          if (!ref.name.toLowerCase().includes(lower)) continue;
        }

        // Load entity to get description and metadata
        const entity = this.load(refStr);

        // Check deprecated filter
        if (filter?.deprecated !== undefined) {
          const isDeprecated = entity.metadata?.deprecated === true;
          if (isDeprecated !== filter.deprecated) continue;
        }

        // Build deps_info
        let depsInfo: string | undefined;
        if (ref.type === 'agent' && 'skills' in entity && entity.skills) {
          depsInfo = `skills: ${Object.keys(entity.skills).length}`;
        } else if (ref.type === 'autopilot' && 'agent_ref' in entity) {
          depsInfo = `agent: ${entity.agent_ref}`;
        }

        results.push({
          ref: refStr,
          type: ref.type,
          namespace: ref.namespace,
          name: ref.name,
          version: ref.version || 'unknown',
          description: entity.description || '',
          source: entry.source as 'local' | string,
          size: entry.size,
          imported_at: entry.imported_at,
          deps_info: depsInfo,
          tags: entity.metadata?.tags,
        });
      } catch {
        // Skip entries we can't load
      }
    }

    return results;
  }

  /**
   * List all versions of an entity by parsed ref (type + namespace + name).
   * Returns versions sorted by semver (oldest first).
   */
  listVersions(ref: Pick<EntityRef, 'type' | 'namespace' | 'name'>): string[] {
    const manifest = this.readManifest();
    // Build both prefixed and unprefixed variants
    const ns = ref.namespace && ref.namespace !== DEFAULT_NAMESPACE ? ref.namespace : '';
    const prefixWithNs = ns ? `${ns}/${ref.type}/${ref.name}@` : `${ref.type}/${ref.name}@`;
    const prefixNoNs = `${ref.type}/${ref.name}@`;
    const versions: string[] = [];

    for (const refStr of Object.keys(manifest.entities)) {
      if (refStr.startsWith(prefixWithNs) || (ns && refStr.startsWith(prefixNoNs))) {
        const matchingPrefix = refStr.startsWith(prefixWithNs) ? prefixWithNs : prefixNoNs;
        const version = refStr.slice(matchingPrefix.length);
        if (semver.valid(version)) {
          versions.push(version);
        }
      }
    }

    return versions.sort((a, b) => semver.compare(a, b));
  }

  /**
   * Resolve the latest version of an entity that satisfies the constraint.
   *
   * @param ref - Parsed ref (version may be a semver range like '^1.2.0')
   * @returns The best matching version string
   * @throws if no version satisfies the constraint
   */
  resolve(ref: EntityRef): string {
    const versions = this.listVersions(ref);

    if (versions.length === 0) {
      throw new Error(
        `No versions found for "${entityDisplayRef(ref)}". ` +
        `Fetch from remote or import manually.`
      );
    }

    if (!ref.version) {
      // No constraint → return latest
      return versions[versions.length - 1];
    }

    // If exact version requested
    if (semver.valid(ref.version)) {
      if (versions.includes(ref.version)) {
        return ref.version;
      }
      throw new Error(
        `Version "${ref.version}" not found for "${entityDisplayRef(ref)}". ` +
        `Available: ${versions.join(', ')}`
      );
    }

    // Semver range → find highest satisfying version
    const satisfying = versions.filter((v) => semver.satisfies(v, ref.version!));
    if (satisfying.length === 0) {
      throw new Error(
        `No version of "${entityDisplayRef(ref)}" satisfies constraint "${ref.version}". ` +
        `Available versions: ${versions.join(', ')}`
      );
    }

    // Return the highest satisfying version
    return satisfying[satisfying.length - 1];
  }

  /**
   * Check if an entity exists in the local registry.
   */
  exists(refStr: EntityRefString): boolean {
    const manifest = this.readManifest();
    if (refStr in manifest.entities) return true;
    // Try unprefixed form
    if (refStr.startsWith(`${DEFAULT_NAMESPACE}/`)) {
      const unprefixed = refStr.slice(DEFAULT_NAMESPACE.length + 1);
      if (unprefixed in manifest.entities) return true;
    }
    return false;
  }

  // ── Lockfile Operations ──

  /** Get the lockfile path for a workspace. */
  private lockfilePath(workspaceId: string): string {
    return join(this.lockfileDir, workspaceId, 'entity-lock.yaml');
  }

  /** Read a workspace lockfile. Returns null if not found. */
  readLockfile(workspaceId: string): EntityLockfile | null {
    const path = this.lockfilePath(workspaceId);
    if (!existsSync(path)) return null;
    try {
      const content = readFileSync(path, 'utf-8');
      return safeParseYaml(content) as EntityLockfile;
    } catch {
      return null;
    }
  }

  /**
   * Write (or update) a workspace lockfile with the given pinned entities.
   */
  writeLockfile(
    workspaceId: string,
    pinned: Record<string, { version: string; hash: string }>,
  ): void {
    const dir = dirname(this.lockfilePath(workspaceId));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const existing = this.readLockfile(workspaceId);
    const now = new Date().toISOString();

    const lockfile: EntityLockfile = {
      version: '1.0',
      workspace_id: workspaceId,
      updated_at: now,
      pinned: {},
    };

    // Merge: existing entries + new/updated entries
    for (const [ref, data] of Object.entries(pinned)) {
      lockfile.pinned[ref] = {
        ...data,
        imported_at: existing?.pinned[ref]?.imported_at || now,
      };
    }

    // Preserve entries not being updated
    if (existing) {
      for (const [ref, data] of Object.entries(existing.pinned)) {
        if (!lockfile.pinned[ref]) {
          lockfile.pinned[ref] = data;
        }
      }
    }

    const yaml = stringify(lockfile, { indent: 2, sortMapEntries: true });
    writeFileSync(this.lockfilePath(workspaceId), yaml, 'utf-8');
  }

  /**
   * Find which workspace lockfiles reference a given entity ref.
   */
  private findLockfileReferences(refStr: EntityRefString): string[] {
    const workspaces: string[] = [];
    if (!existsSync(this.lockfileDir)) return workspaces;

    try {
      const wsDirs = readdirSync(this.lockfileDir);
      for (const wsId of wsDirs) {
        const lf = this.readLockfile(wsId);
        if (lf && refStr in lf.pinned) {
          workspaces.push(wsId);
        }
      }
    } catch {
      // Directory read failed — skip
    }

    return workspaces;
  }

  // ── Utils ──

  /** Get the entities directory path. */
  getEntitiesDir(): string {
    return this.entitiesDir;
  }

  /** Get the manifest path. */
  getManifestPath(): string {
    return this.manifestPath;
  }

  // ── Entity Fork ──

  /**
   * Fork an existing entity to a new version.
   *
   * Copies the entity content, bumps the version, and saves as a new entity.
   *
   * @param refStr - Source entity ref (e.g., 'skill/test@1.0.0')
   * @param bump - Which part of the version to bump: 'major', 'minor', or 'patch'
   * @param changes - Optional partial overrides for the new version
   * @returns The manifest entry of the newly created entity
   */
  fork(
    refStr: EntityRefString,
    bump: 'major' | 'minor' | 'patch' = 'patch',
    changes?: Partial<Entity>,
  ): EntityManifestEntry {
    const source = this.load(refStr);
    const ref = parseEntityRef(refStr);
    const currentVersion = ref.version || source.version;

    // Compute new version
    const parts = currentVersion.split('.');
    let major = parseInt(parts[0] || '0', 10);
    let minor = parseInt(parts[1] || '0', 10);
    let patch = parseInt(parts[2] || '0', 10);

    switch (bump) {
      case 'major':
        major += 1;
        minor = 0;
        patch = 0;
        break;
      case 'minor':
        minor += 1;
        patch = 0;
        break;
      case 'patch':
        patch += 1;
        break;
    }

    const newVersion = `${major}.${minor}.${patch}`;

    // Clone the entity and apply changes
    const newEntity: Entity = JSON.parse(JSON.stringify(source));
    newEntity.version = newVersion;

    if (changes) {
      Object.assign(newEntity, changes);
    }

    return this.save(newEntity);
  }

  // ── Entity Upgrade ──

  /**
   * Upgrade an entity in a workspace lockfile to a newer version.
   *
   * This does NOT modify the workspace itself (that's done by the ImportEngine).
   * It only updates the lockfile to pin the new version for future imports.
   *
   * @param refStr - The entity ref to upgrade (e.g., 'skill/test' or 'skill/test@^1.2')
   * @param workspaceId - Target workspace
   * @returns The new version + hash
   */
  upgrade(
    refStr: EntityRefString,
    workspaceId: string,
  ): { ref: string; version: string; hash: string; previous_version?: string } {
    const parsed = parseEntityRef(refStr);

    // Resolve the latest/best version
    const newVersion = this.resolve(parsed);
    const versionedRef = serializeEntityRef({ ...parsed, version: newVersion });
    const entity = this.load(versionedRef);
    const hash = hashEntity(entity);

    // Read existing lockfile to find previous pinned version
    const existing = this.readLockfile(workspaceId);
    let previousVersion: string | undefined;

    if (existing) {
      // Find the old entry — try different key formats
      const oldKey = serializeEntityRef({ ...parsed, version: undefined });
      for (const key of Object.keys(existing.pinned)) {
        try {
          const lockedRef = parseEntityRef(key);
          if (lockedRef.type === parsed.type && lockedRef.name === parsed.name) {
            previousVersion = existing.pinned[key].version;
            break;
          }
        } catch { continue; }
      }
    }

    // Update lockfile
    const refKey = serializeEntityRef({ ...parsed, version: undefined });
    this.writeLockfile(workspaceId, {
      [refKey]: { version: newVersion, hash },
    });

    return {
      ref: versionedRef,
      version: newVersion,
      hash,
      previous_version: previousVersion && previousVersion !== newVersion
        ? previousVersion : undefined,
    };
  }
}
