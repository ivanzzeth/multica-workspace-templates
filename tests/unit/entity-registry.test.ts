/**
 * Unit tests for EntityRegistry.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EntityRegistry, hashEntity } from '../../src/services/entity-registry.js';
import { parseEntityRef, serializeEntityRef, entityFilePath } from '../../src/types/entity.js';
import type { Entity, SkillEntity, AgentEntity, AutopilotEntity } from '../../src/types/entity.js';

// ── Helpers ──

function tempDir(): string {
  const dir = join(tmpdir(), `entity-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSkill(overrides?: Partial<SkillEntity>): SkillEntity {
  return {
    entity: 'skill',
    schema_version: '1.0',
    name: 'test-skill',
    version: '1.0.0',
    description: 'A test skill',
    files: [{ path: 'SKILL.md', content: '# Test Skill' }],
    metadata: { tags: ['test'] },
    ...overrides,
  };
}

function makeAgent(overrides?: Partial<AgentEntity>): AgentEntity {
  return {
    entity: 'agent',
    schema_version: '1.0',
    name: 'test-agent',
    version: '1.0.0',
    description: 'A test agent',
    instructions: '# You are a test agent',
    model: 'auto',
    runtime_provider: 'claude',
    skills: { 'test-skill': '^1.0.0' },
    metadata: { tags: ['test'] },
    ...overrides,
  };
}

function makeAutopilot(overrides?: Partial<AutopilotEntity>): AutopilotEntity {
  return {
    entity: 'autopilot',
    schema_version: '1.0',
    name: 'test-ap',
    version: '1.0.0',
    title: 'Test Autopilot',
    description: 'A test autopilot',
    mode: 'run_only',
    agent_ref: 'agent/test-agent@^1.0.0',
    metadata: { tags: ['test'] },
    ...overrides,
  };
}

// ── Tests ──

describe('EntityRegistry', () => {
  let registry: EntityRegistry;
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    // Use isolated dirs for both entities and lockfiles
    registry = new EntityRegistry(dir, dir);
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  // ── save ──

  describe('save', () => {
    test('saves skill entity to correct path', () => {
      const skill = makeSkill({ name: 'golang-testing', version: '1.2.0' });
      const entry = registry.save(skill);

      expect(entry.path).toBe('skill/golang-testing/1.2.0.yaml');
      expect(existsSync(join(dir, entry.path))).toBe(true);
    });

    test('saves agent entity to correct path', () => {
      const agent = makeAgent({ name: 'worker', version: '2.0.1' });
      const entry = registry.save(agent);

      expect(entry.path).toBe('agent/worker/2.0.1.yaml');
      expect(existsSync(join(dir, entry.path))).toBe(true);
    });

    test('saves autopilot entity to correct path', () => {
      const ap = makeAutopilot({ name: 'daily-sync', version: '1.0.0' });
      const entry = registry.save(ap);

      expect(entry.path).toBe('autopilot/daily-sync/1.0.0.yaml');
    });

    test('updates manifest with entry', () => {
      const skill = makeSkill();
      const entry = registry.save(skill);

      const manifestPath = join(dir, '.manifest.yaml');
      expect(existsSync(manifestPath)).toBe(true);

      const manifestContent = readFileSync(manifestPath, 'utf-8');
      expect(manifestContent).toContain('skill/test-skill@1.0.0');
      expect(manifestContent).toContain(entry.hash);
    });

    test('creates intermediate directories', () => {
      const skill = makeSkill({ name: 'a/b/c-test', version: '1.0.0' });
      // Note: name validation should reject this, but registry doesn't validate itself
      // The skill type directory is always used, not the name chars
      const agent = makeAgent({ name: 'deep-nested', version: '3.2.1' });
      const entry = registry.save(agent);

      expect(existsSync(join(dir, entry.path))).toBe(true);
    });

    test('rejects saving entity with same version (immutable)', () => {
      const skill1 = makeSkill({ name: 'test', version: '1.0.0' });
      registry.save(skill1);

      const skill2 = makeSkill({
        name: 'test',
        version: '1.0.0',
        description: 'Different description, same version',
      });

      expect(() => registry.save(skill2)).toThrow('already exists');
      expect(() => registry.save(skill2)).toThrow('immutable');
    });

    test('allows saving different versions of same entity', () => {
      const v1 = makeSkill({ name: 'test', version: '1.0.0' });
      const v2 = makeSkill({ name: 'test', version: '1.1.0' });

      registry.save(v1);
      expect(() => registry.save(v2)).not.toThrow();

      expect(existsSync(join(dir, 'skill/test/1.0.0.yaml'))).toBe(true);
      expect(existsSync(join(dir, 'skill/test/1.1.0.yaml'))).toBe(true);
    });
  });

  // ── load ──

  describe('load', () => {
    test('loads entity by exact ref string', () => {
      const skill = makeSkill({ name: 'golang-testing', version: '1.2.0' });
      registry.save(skill);

      const loaded = registry.load('skill/golang-testing@1.2.0') as SkillEntity;
      expect(loaded.name).toBe('golang-testing');
      expect(loaded.version).toBe('1.2.0');
      expect(loaded.description).toBe('A test skill');
      expect(loaded.files).toHaveLength(1);
    });

    test('loads entity by parsed EntityRef', () => {
      const agent = makeAgent({ name: 'worker', version: '2.0.1' });
      registry.save(agent);

      const ref = parseEntityRef('agent/worker@2.0.1');
      const loaded = registry.loadByRef(ref) as AgentEntity;
      expect(loaded.instructions).toContain('test agent');
    });

    test('load returns latest version when no version specified', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.2.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.1.0' }));

      const loaded = registry.load('skill/test') as SkillEntity;
      expect(loaded.version).toBe('1.2.0');
    });

    test('throws for non-existent entity', () => {
      expect(() => registry.load('skill/nonexistent@1.0.0')).toThrow('not found');
    });

    test('throws on hash mismatch (tampered file)', () => {
      const skill = makeSkill({ name: 'test', version: '1.0.0' });
      const entry = registry.save(skill);

      // Tamper with the file
      const fullPath = join(dir, entry.path);
      writeFileSync(fullPath, 'tampered content', 'utf-8');

      expect(() => registry.load('skill/test@1.0.0')).toThrow('Hash mismatch');
    });

    test('load after save roundtrip — data identical', () => {
      const agent = makeAgent({
        name: 'worker',
        version: '2.0.1',
        skills: { 'skill-a': '^1.0.0', 'skill-b': '^2.0.0' },
        custom_env_template: { KEY: '${KEY}' },
      });
      registry.save(agent);

      const loaded = registry.load('agent/worker@2.0.1') as AgentEntity;
      expect(loaded.name).toBe('worker');
      expect(loaded.description).toBe('A test agent');
      expect(loaded.instructions).toContain('test agent');
      expect(loaded.model).toBe('auto');
      expect(loaded.runtime_provider).toBe('claude');
      expect(loaded.skills).toEqual({ 'skill-a': '^1.0.0', 'skill-b': '^2.0.0' });
      expect(loaded.custom_env_template).toEqual({ KEY: '${KEY}' });
      expect(loaded.metadata?.tags).toEqual(['test']);
    });
  });

  // ── list ──

  describe('list', () => {
    test('lists all entities across types', () => {
      registry.save(makeSkill({ name: 'skill-a', version: '1.0.0' }));
      registry.save(makeAgent({ name: 'agent-a', version: '1.0.0' }));
      registry.save(makeAutopilot({ name: 'ap-a', version: '1.0.0' }));

      const entities = registry.list();
      expect(entities).toHaveLength(3);
    });

    test('filters by type', () => {
      registry.save(makeSkill({ name: 'skill-a', version: '1.0.0' }));
      registry.save(makeAgent({ name: 'agent-a', version: '1.0.0' }));
      registry.save(makeAgent({ name: 'agent-b', version: '1.0.0' }));

      const agents = registry.list({ type: 'agent' });
      expect(agents).toHaveLength(2);
      expect(agents.every((a) => a.type === 'agent')).toBe(true);
    });

    test('filters by name_contains', () => {
      registry.save(makeSkill({ name: 'golang-testing', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'python-pro', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'golang-lint', version: '1.0.0' }));

      const results = registry.list({ name_contains: 'golang' });
      expect(results).toHaveLength(2);
    });

    test('empty registry returns empty list', () => {
      const entities = registry.list();
      expect(entities).toHaveLength(0);
    });

    test('list includes deps_info for agents', () => {
      registry.save(makeAgent({ name: 'worker', version: '1.0.0', skills: { 'a': '^1.0', 'b': '^2.0', 'c': '^3.0' } }));
      const results = registry.list({ type: 'agent' });
      expect(results[0].deps_info).toBe('skills: 3');
    });

    test('list includes deps_info for autopilots', () => {
      registry.save(makeAutopilot({ name: 'ap', version: '1.0.0', agent_ref: 'agent/planner@^1.0.0' }));
      const results = registry.list({ type: 'autopilot' });
      expect(results[0].deps_info).toBe('agent: agent/planner@^1.0.0');
    });
  });

  // ── delete ──

  describe('delete', () => {
    test('deletes entity file and removes from manifest', () => {
      const skill = makeSkill({ name: 'test', version: '1.0.0' });
      const entry = registry.save(skill);

      expect(existsSync(join(dir, entry.path))).toBe(true);
      expect(registry.exists('skill/test@1.0.0')).toBe(true);

      registry.delete('skill/test@1.0.0');

      expect(existsSync(join(dir, entry.path))).toBe(false);
      expect(registry.exists('skill/test@1.0.0')).toBe(false);
    });

    test('throws for non-existent entity', () => {
      expect(() => registry.delete('skill/nonexistent@1.0.0')).toThrow('not found');
    });
  });

  // ── resolve ──

  describe('resolve', () => {
    test('resolves exact version', () => {
      registry.save(makeSkill({ name: 'test', version: '1.2.0' }));
      registry.save(makeSkill({ name: 'test', version: '2.0.0' }));

      const version = registry.resolve(parseEntityRef('skill/test@1.2.0'));
      expect(version).toBe('1.2.0');
    });

    test('resolves latest when no version specified', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.5.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.2.0' }));

      const ref = parseEntityRef('skill/test');
      const version = registry.resolve(ref);
      expect(version).toBe('1.5.0');
    });

    test('throws when no version satisfies constraint', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));

      const ref = parseEntityRef('skill/test@^2.0.0');
      expect(() => registry.resolve(ref)).toThrow('No version');
    });

    test('resolves semver range to highest satisfying', () => {
      registry.save(makeSkill({ name: 'test', version: '1.2.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.5.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.6.1' }));
      registry.save(makeSkill({ name: 'test', version: '2.0.0' }));

      // ^1.2.0 → >=1.2.0 <2.0.0 → highest is 1.6.1
      const ref = parseEntityRef('skill/test@^1.2.0');
      const version = registry.resolve(ref);
      expect(version).toBe('1.6.1');
    });

    test('throws when no versions exist at all', () => {
      const ref = parseEntityRef('skill/nonexistent@1.0.0');
      expect(() => registry.resolve(ref)).toThrow('No versions found');
    });
  });

  // ── listVersions ──

  describe('listVersions', () => {
    test('returns sorted versions', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '2.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.5.0' }));

      const versions = registry.listVersions(parseEntityRef('skill/test'));
      expect(versions).toEqual(['1.0.0', '1.5.0', '2.0.0']);
    });

    test('returns empty array for unknown entity', () => {
      const versions = registry.listVersions(parseEntityRef('skill/nonexistent'));
      expect(versions).toEqual([]);
    });

    test('only returns valid semver versions', () => {
      // Save two valid versions
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '2.0.0' }));

      // Create a non-semver version file manually and reconcile
      const testDir = join(dir, 'skill', 'test');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'not-semver.yaml'), 'entity: skill\nschema_version: "1.0"\nname: test\nversion: not-a-version\ndescription: bad\nfiles:\n  - path: SKILL.md\n    content: "# ok"\n', 'utf-8');

      // Reconcile to pick up the orphan
      registry.reconcileManifest();

      const versions = registry.listVersions(parseEntityRef('skill/test'));
      // Should only return valid semver versions, not the manually created one
      expect(versions).toEqual(['1.0.0', '2.0.0']);
    });
  });

  // ── exists ──

  describe('exists', () => {
    test('returns true for saved entity', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      expect(registry.exists('skill/test@1.0.0')).toBe(true);
    });

    test('returns false for unknown entity', () => {
      expect(registry.exists('skill/test@1.0.0')).toBe(false);
    });
  });

  // ── Lockfile ──

  describe('lockfile', () => {
    test('readLockfile returns null when no lockfile exists', () => {
      const lf = registry.readLockfile('nonexistent-workspace');
      expect(lf).toBeNull();
    });

    test('write and read lockfile roundtrip', () => {
      const pinned = {
        'skill/test@1.0.0': { version: '1.0.0', hash: 'sha256:abcd' },
        'agent/worker@2.0.1': { version: '2.0.1', hash: 'sha256:efgh' },
      };

      registry.writeLockfile('ws-123', pinned);

      const lf = registry.readLockfile('ws-123');
      expect(lf).not.toBeNull();
      expect(lf!.workspace_id).toBe('ws-123');
      expect(Object.keys(lf!.pinned)).toHaveLength(2);
      expect(lf!.pinned['skill/test@1.0.0'].version).toBe('1.0.0');
      expect(lf!.pinned['skill/test@1.0.0'].hash).toBe('sha256:abcd');
    });

    test('writeLockfile merges with existing entries', () => {
      // First write
      registry.writeLockfile('ws-123', {
        'skill/a@1.0.0': { version: '1.0.0', hash: 'sha256:aaa' },
      });

      // Second write with new entries
      registry.writeLockfile('ws-123', {
        'skill/b@2.0.0': { version: '2.0.0', hash: 'sha256:bbb' },
      });

      const lf = registry.readLockfile('ws-123');
      expect(Object.keys(lf!.pinned)).toHaveLength(2);
      expect(lf!.pinned['skill/a@1.0.0'].version).toBe('1.0.0');
      expect(lf!.pinned['skill/b@2.0.0'].version).toBe('2.0.0');
    });

    test('writeLockfile overwrites existing entry with new version', () => {
      registry.writeLockfile('ws-123', {
        'skill/a@1.0.0': { version: '1.0.0', hash: 'sha256:aaa' },
      });

      registry.writeLockfile('ws-123', {
        'skill/a@1.0.0': { version: '1.1.0', hash: 'sha256:ccc' },
      });

      const lf = registry.readLockfile('ws-123');
      expect(lf!.pinned['skill/a@1.0.0'].version).toBe('1.1.0');
      expect(lf!.pinned['skill/a@1.0.0'].hash).toBe('sha256:ccc');
    });
  });

  // ── hashEntity ──

  describe('hashEntity', () => {
    test('produces deterministic hash', () => {
      const skill = makeSkill({ name: 'test', version: '1.0.0' });
      const h1 = hashEntity(skill);
      const h2 = hashEntity(skill);
      expect(h1).toBe(h2);
    });

    test('different entities produce different hashes', () => {
      const s1 = makeSkill({ name: 'a', version: '1.0.0' });
      const s2 = makeSkill({ name: 'b', version: '1.0.0' });
      expect(hashEntity(s1)).not.toBe(hashEntity(s2));
    });

    test('hash includes sha256: prefix', () => {
      const h = hashEntity(makeSkill({ name: 'test', version: '1.0.0' }));
      expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  // ── manifest reconciliation ──

  describe('reconcileManifest', () => {
    test('detects orphan files not in manifest', () => {
      // Create a valid entity file manually without going through save()
      const skillDir = join(dir, 'skill', 'orphan-skill');
      mkdirSync(skillDir, { recursive: true });
      const yaml = 'entity: skill\nschema_version: "1.0"\nname: orphan-skill\nversion: 1.0.0\ndescription: Orphan\nfiles:\n  - path: SKILL.md\n    content: "# Orphan"\nmetadata:\n  tags: []\n';
      writeFileSync(join(skillDir, '1.0.0.yaml'), yaml, 'utf-8');

      const { orphans } = registry.reconcileManifest();
      expect(orphans.length).toBeGreaterThanOrEqual(1);

      // After reconciliation, orphan should be in manifest
      expect(registry.exists('skill/orphan-skill@1.0.0')).toBe(true);
    });
  });

  // ── Fork & Upgrade ──

  describe('fork', () => {
    test('fork skill with patch bump creates new version', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      const entry = registry.fork('skill/test@1.0.0', 'patch');
      expect(entry.ref).toContain('skill/test@1.0.1');
      const loaded = registry.load('skill/test@1.0.1');
      expect(loaded.version).toBe('1.0.1');
      expect(loaded.name).toBe('test');
    });

    test('fork with minor bump resets patch', () => {
      registry.save(makeSkill({ name: 'test', version: '1.2.3' }));
      const entry = registry.fork('skill/test@1.2.3', 'minor');
      expect(entry.ref).toContain('@1.3.0');
    });

    test('fork with major bump resets minor and patch', () => {
      registry.save(makeSkill({ name: 'test', version: '1.2.3' }));
      const entry = registry.fork('skill/test@1.2.3', 'major');
      expect(entry.ref).toContain('@2.0.0');
    });

    test('fork applies optional changes', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0', description: 'Old desc' }));
      registry.fork('skill/test@1.0.0', 'patch', { description: 'New desc' } as any);
      const loaded = registry.load('skill/test@1.0.1') as SkillEntity;
      expect(loaded.description).toBe('New desc');
    });

    test('fork preserves original entity data', () => {
      const agent = makeAgent({ name: 'worker', version: '1.0.0', skills: { 's1': '^1.0' } });
      registry.save(agent);
      registry.fork('agent/worker@1.0.0', 'patch');
      const original = registry.load('agent/worker@1.0.0') as AgentEntity;
      expect(original.version).toBe('1.0.0');
      expect(original.skills).toEqual({ 's1': '^1.0' });
      const forked = registry.load('agent/worker@1.0.1') as AgentEntity;
      expect(forked.version).toBe('1.0.1');
      expect(forked.skills).toEqual({ 's1': '^1.0' });
    });
  });

  describe('upgrade', () => {
    test('upgrade pins new version in lockfile', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.save(makeSkill({ name: 'test', version: '1.1.0' }));

      // Create initial lockfile with old version
      registry.writeLockfile('ws-1', {
        'skill/test': { version: '1.0.0', hash: 'sha256:old' },
      });

      const result = registry.upgrade('skill/test', 'ws-1');
      expect(result.version).toBe('1.1.0');
      expect(result.previous_version).toBe('1.0.0');

      const lf = registry.readLockfile('ws-1');
      expect(lf!.pinned['skill/test']).toBeDefined();
      expect(lf!.pinned['skill/test'].version).toBe('1.1.0');
    });

    test('upgrade when already at latest returns no previous_version', () => {
      registry.save(makeSkill({ name: 'test', version: '1.0.0' }));
      registry.writeLockfile('ws-2', {
        'skill/test': { version: '1.0.0', hash: 'sha256:abc' },
      });

      const result = registry.upgrade('skill/test', 'ws-2');
      expect(result.version).toBe('1.0.0');
      expect(result.previous_version).toBeUndefined();
    });
  });
});
