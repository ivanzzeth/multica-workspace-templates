/**
 * Unit tests for DependencyResolver.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EntityRegistry } from '../../src/services/entity-registry.js';
import { DependencyResolver } from '../../src/services/dependency-resolver.js';
import { parseEntityRef } from '../../src/types/entity.js';
import type { SkillEntity, AgentEntity, AutopilotEntity, ResolvedEntity } from '../../src/types/entity.js';

// ── Helpers ──

let dir: string;
let registry: EntityRegistry;
let resolver: DependencyResolver;

function tempDir(): string {
  const d = join(tmpdir(), `resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeSkill(name: string, version: string, desc?: string): SkillEntity {
  return {
    entity: 'skill',
    schema_version: '1.0',
    name,
    version,
    description: desc || `Skill ${name}`,
    files: [{ path: 'SKILL.md', content: `# ${name}\n\nTest skill content.` }],
  };
}

function makeAgent(name: string, version: string, desc?: string, skills?: Record<string, string>, instructions?: string): AgentEntity {
  return {
    entity: 'agent',
    schema_version: '1.0',
    name,
    version,
    description: desc || `Agent ${name}`,
    instructions: instructions || `# ${name}\n\nYou are ${name}.`,
    model: 'auto',
    runtime_provider: 'claude',
    skills: skills || {},
  };
}

function makeAutopilot(name: string, version: string, agentRef: string, desc?: string): AutopilotEntity {
  return {
    entity: 'autopilot',
    schema_version: '1.0',
    name,
    version,
    title: `Auto ${name}`,
    description: desc || `Autopilot ${name}`,
    mode: 'run_only',
    agent_ref: agentRef,
    triggers: [{ cron: '0 9 * * 1-5', timezone: 'Asia/Shanghai' }],
  };
}

beforeEach(() => {
  dir = tempDir();
  registry = new EntityRegistry(dir, dir);
  resolver = new DependencyResolver(registry);
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

function saveAll(entities: Array<SkillEntity | AgentEntity | AutopilotEntity>): void {
  for (const e of entities) {
    registry.save(e);
  }
}

// ── Flattening Tests ──

describe('DependencyResolver — Flattening', () => {
  test('single skill ref → single resolved entity', () => {
    saveAll([makeSkill('go-test', '1.2.0')]);
    const result = resolver.resolve({ refs: ['skill/go-test@1.2.0'] });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity.name).toBe('go-test');
  });

  test('entity with no dependencies → only itself resolved', () => {
    saveAll([makeSkill('standalone', '1.0.0')]);
    const result = resolver.resolve({ refs: ['skill/standalone@1.0.0'] });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].dependencies).toHaveLength(0);
  });

  test('agent with 3 skill refs → agent + 3 skills resolved', () => {
    saveAll([
      makeSkill('skill-a', '1.0.0'),
      makeSkill('skill-b', '1.0.0'),
      makeSkill('skill-c', '1.0.0'),
      makeAgent('worker', '2.0.1', 'Worker', {
        'skill-a': '^1.0.0',
        'skill-b': '^1.0.0',
        'skill-c': '^1.0.0',
      }),
    ]);
    const result = resolver.resolve({ refs: ['agent/worker@2.0.1'] });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(4); // agent + 3 skills
  });

  test('autopilot with agent_ref → autopilot + agent + transitive skills', () => {
    saveAll([
      makeSkill('planning', '1.0.0'),
      makeAgent('planner', '3.0.0', 'Planner', { 'planning': '^1.0.0' }),
      makeAutopilot('daily', '1.0.0', 'agent/planner@^3.0.0'),
    ]);
    const result = resolver.resolve({ refs: ['autopilot/daily@1.0.0'] });
    expect(result.errors).toHaveLength(0);
    // autopilot + agent + skill
    expect(result.entities).toHaveLength(3);
  });

  test('deep chain: autopilot → agent → 2 skills', () => {
    saveAll([
      makeSkill('s1', '1.0.0'),
      makeSkill('s2', '1.0.0'),
      makeAgent('planner', '1.0.0', 'Planner', { 's1': '^1.0.0', 's2': '^1.0.0' }),
      makeAutopilot('sync', '1.0.0', 'agent/planner@^1.0.0'),
    ]);
    const result = resolver.resolve({ refs: ['autopilot/sync@1.0.0'] });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(4);
  });
});

// ── Deduplication Tests ──

describe('DependencyResolver — Deduplication', () => {
  test('two agents ref same skill → skill imported once', () => {
    saveAll([
      makeSkill('shared-skill', '1.5.0'),
      makeAgent('agent-a', '1.0.0', 'A', { 'shared-skill': '^1.0.0' }),
      makeAgent('agent-b', '1.0.0', 'B', { 'shared-skill': '^1.0.0' }),
    ]);
    const result = resolver.resolve({ refs: ['agent/agent-a@1.0.0', 'agent/agent-b@1.0.0'] });
    expect(result.errors).toHaveLength(0);
    // 2 agents + 1 shared skill
    expect(result.entities).toHaveLength(3);
    const skills = result.entities.filter((e) => e.entity.entity === 'skill');
    expect(skills).toHaveLength(1);
    expect(skills[0].entity.name).toBe('shared-skill');
  });

  test('two autopilots ref same agent → agent imported once', () => {
    saveAll([
      makeAgent('planner', '1.0.0', 'Planner'),
      makeAutopilot('ap1', '1.0.0', 'agent/planner@^1.0.0'),
      makeAutopilot('ap2', '1.0.0', 'agent/planner@^1.0.0'),
    ]);
    const result = resolver.resolve({ refs: ['autopilot/ap1@1.0.0', 'autopilot/ap2@1.0.0'] });
    expect(result.errors).toHaveLength(0);
    // 2 autopilots + 1 agent (deduped)
    expect(result.entities).toHaveLength(3);
  });

  test('template explicitly includes skill that agent also refs → imported once', () => {
    saveAll([
      makeSkill('shared', '1.5.0'),
      makeAgent('worker', '1.0.0', 'W', { 'shared': '^1.0.0' }),
    ]);
    const result = resolver.resolve({ refs: ['agent/worker@1.0.0', 'skill/shared@1.5.0'] });
    expect(result.errors).toHaveLength(0);
    // agent + skill once
    expect(result.entities).toHaveLength(2);
  });
});

// ── Version Solving Tests ──

describe('DependencyResolver — Version solving', () => {
  test('exact version match: 2.0.1 → 2.0.1', () => {
    saveAll([makeSkill('go', '1.0.0'), makeSkill('go', '2.0.0'), makeSkill('go', '2.0.1')]);
    // Just test registry resolves correctly (which we already tested in registry tests)
    const v = registry.resolve(parseEntityRef('skill/go@2.0.1'));
    expect(v).toBe('2.0.1');
  });

  test('multiple candidates → picks highest satisfying version', () => {
    saveAll([
      makeSkill('go', '1.0.0'),
      makeSkill('go', '1.5.0'),
      makeSkill('go', '1.6.1'),
    ]);
    const v = registry.resolve(parseEntityRef('skill/go@^1.2.0'));
    expect(v).toBe('1.6.1');
  });

  test('no satisfying version → resolution error', () => {
    saveAll([makeSkill('go', '1.0.0')]);
    const result = resolver.resolve({ refs: ['skill/go@^2.0.0'] });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('No version');
  });

  test('different version constraints on same entity → deduped to best', () => {
    saveAll([
      makeSkill('shared', '1.2.0'),
      makeSkill('shared', '1.5.0'),
      makeSkill('shared', '1.6.1'),
      makeAgent('a', '1.0.0', 'A', { 'shared': '^1.2.0' }),  // ≥1.2.0 <2.0.0
      makeAgent('b', '1.0.0', 'B', { 'shared': '^1.5.0' }),  // ≥1.5.0 <2.0.0
    ]);
    const result = resolver.resolve({ refs: ['agent/a@1.0.0', 'agent/b@1.0.0'] });
    expect(result.errors).toHaveLength(0);
    const skills = result.entities.filter((e) => e.entity.entity === 'skill');
    expect(skills).toHaveLength(1);
    // Both constraints satisfied by 1.6.1
    expect(skills[0].entity.version).toBe('1.6.1');
  });

  test('incompatible constraints → each resolved independently', () => {
    saveAll([
      makeSkill('lib', '1.9.0'),
      makeSkill('lib', '2.0.0'),
      makeAgent('a', '1.0.0', 'A', { 'lib': '^1.0.0' }),  // ≥1.0.0 <2.0.0
      makeAgent('b', '1.0.0', 'B', { 'lib': '^2.0.0' }),  // ≥2.0.0 <3.0.0
    ]);
    // Both agents ref lib with non-overlapping ranges
    // In the two-pass resolver, each agent independently resolves its lib dep.
    // When deduped, the HIGHEST version (2.0.0) wins.
    // This is a known limitation: 2.0.0 doesn't satisfy A's ^1.0.0 constraint.
    // A full DAG resolver would catch this, but per our simplified design,
    // we dedup to highest and warn.
    const result = resolver.resolve({ refs: ['agent/a@1.0.0', 'agent/b@1.0.0'] });
    // Currently, both resolve independently and are deduped to highest.
    // The resolver doesn't re-verify the deduped version against constraints.
    // This is acceptable for v1.0 since the entity graph has max depth 3.
    // A warning is emitted about the dedup.
    expect(result.warnings.some((w) => w.message.includes('deduplicated'))).toBe(true);
  });
});

// ── Topological Sort Tests ──

describe('DependencyResolver — Topological sort', () => {
  test('skills always ordered before agents', () => {
    saveAll([
      makeSkill('s1', '1.0.0'),
      makeSkill('s2', '1.0.0'),
      makeAgent('a1', '1.0.0', 'A1', { 's1': '^1.0.0' }),
      makeAgent('a2', '1.0.0', 'A2', { 's2': '^1.0.0' }),
    ]);
    const result = resolver.resolve({ refs: ['agent/a1@1.0.0', 'agent/a2@1.0.0'] });
    const typeseq = result.entities.map((e) => e.entity.entity);
    const firstAgentIdx = typeseq.indexOf('agent');
    const lastSkillIdx = typeseq.lastIndexOf('skill');
    // All skills must come before all agents
    if (firstAgentIdx >= 0 && lastSkillIdx >= 0) {
      expect(lastSkillIdx).toBeLessThan(firstAgentIdx);
    }
  });

  test('agents always ordered before autopilots', () => {
    saveAll([
      makeAgent('planner', '1.0.0'),
      makeAutopilot('sync', '1.0.0', 'agent/planner@^1.0.0'),
    ]);
    const result = resolver.resolve({ refs: ['autopilot/sync@1.0.0'] });
    const typeseq = result.entities.map((e) => e.entity.entity);
    expect(typeseq).toEqual(['agent', 'autopilot']);
  });

  test('full order: skills → agents → autopilots', () => {
    saveAll([
      makeSkill('s', '1.0.0'),
      makeAgent('a', '1.0.0', 'A', { 's': '^1.0.0' }),
      makeAutopilot('ap', '1.0.0', 'agent/a@^1.0.0'),
    ]);
    const result = resolver.resolve({ refs: ['autopilot/ap@1.0.0'] });
    const typeseq = result.entities.map((e) => e.entity.entity);
    expect(typeseq).toEqual(['skill', 'agent', 'autopilot']);
  });
});

// ── Error Handling Tests ──

describe('DependencyResolver — Error handling', () => {
  test('entity refs non-existent entity → resolution error', () => {
    const result = resolver.resolve({ refs: ['skill/nonexistent@1.0.0'] });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].fatal).toBe(true);
  });

  test('suggestion provided for missing entity', () => {
    const result = resolver.resolve({ refs: ['skill/nonexistent@1.0.0'] });
    expect(result.errors[0].suggestion).toBeDefined();
  });

  test('empty ref list → empty resolution, no error', () => {
    const result = resolver.resolve({ refs: [] });
    expect(result.entities).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('large transitive chain resolves within performance budget', () => {
    // Create 50 skills + 1 agent that depends on all of them
    const skills: Record<string, string> = {};
    const skillEntities: SkillEntity[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `skill-${i}`;
      skills[name] = '^1.0.0';
      skillEntities.push(makeSkill(name, '1.0.0'));
    }
    const agent = makeAgent('big-agent', '1.0.0', 'Big', skills);
    saveAll([...skillEntities, agent]);

    const start = Date.now();
    const result = resolver.resolve({ refs: ['agent/big-agent@1.0.0'] });
    const elapsed = Date.now() - start;

    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(51); // 1 agent + 50 skills
    expect(elapsed).toBeLessThan(2000); // under 2 seconds
  });
});

// ── Template Resolution Tests ──

describe('DependencyResolver — resolveTemplate', () => {
  test('inline agent wins over entity ref with same name', () => {
    saveAll([makeAgent('worker', '2.0.1', 'Entity Worker', {}, 'entity version')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@2.0.1'],
      inlineAgentNames: ['worker'],
    });

    // Entity ref should be skipped
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].entity_type).toBe('agent');
    expect(result.skipped[0].reason).toContain('inline');
    expect(result.entities).toHaveLength(0);
    expect(result.warnings.some((w) => w.message.includes('skipped'))).toBe(true);
  });

  test('inline skill wins over entity ref with same name', () => {
    saveAll([makeSkill('go-test', '1.2.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['skill/go-test@1.2.0'],
      inlineSkillNames: ['go-test'],
    });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].entity_type).toBe('skill');
  });

  test('mixed: 2 inline + 3 entity refs, no overlap', () => {
    saveAll([
      makeAgent('agent-c', '1.0.0'),
      makeAgent('agent-d', '1.0.0'),
      makeAgent('agent-e', '1.0.0'),
    ]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/agent-c@1.0.0', 'agent/agent-d@1.0.0', 'agent/agent-e@1.0.0'],
      inlineAgentNames: ['agent-a', 'agent-b'],
    });

    // All 3 refs should resolve (no overlap with inline names)
    expect(result.entities).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  test('partial overlap: inline covers 1 of 3 entity refs', () => {
    saveAll([makeAgent('worker', '2.0.1'), makeAgent('qa', '1.5.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@2.0.1', 'agent/qa@1.5.0'],
      inlineAgentNames: ['worker'], // inline covers worker
    });

    // worker skipped, qa resolved
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].ref).toContain('worker');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity.name).toBe('qa');
  });
});

// ── Override Tests ──

describe('DependencyResolver — Overrides', () => {
  test('model override applies to agent', () => {
    saveAll([makeAgent('worker', '1.0.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { model: 'claude-opus-4-8' },
      },
    });

    expect(result.entities).toHaveLength(1);
    expect((result.entities[0].entity as AgentEntity).model).toBe('claude-opus-4-8');
  });

  test('override attempts to change instructions → rejected with warning', () => {
    saveAll([makeAgent('worker', '1.0.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { instructions: 'hacked instructions' },
      },
    });

    expect(result.warnings.some((w) => w.message.includes('instructions'))).toBe(true);
    // Instructions unchanged
    expect((result.entities[0].entity as AgentEntity).instructions).toContain('You are worker');
  });

  test('override attempts to change runtime_provider → rejected', () => {
    saveAll([makeAgent('worker', '1.0.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { runtime_provider: 'cursor' },
      },
    });

    expect(result.warnings.some((w) => w.message.includes('runtime_provider'))).toBe(true);
  });

  test('skills_remove removes a skill from agent', () => {
    saveAll([
      makeSkill('python', '1.0.0'),
      makeSkill('go-test', '1.0.0'),
      makeAgent('worker', '1.0.0', 'Worker', { 'python': '^1.0.0', 'go-test': '^1.0.0' }),
    ]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { skills_remove: ['python'] },
      },
    });

    // Topological sort puts skills before agents — find the agent
    const agent = result.entities.find((e) => e.entity.entity === 'agent')!.entity as AgentEntity;
    expect(agent.skills).toBeDefined();
    expect(agent.skills).not.toHaveProperty('python');
    expect(agent.skills).toHaveProperty('go-test');
  });

  test('adds new skill via override', () => {
    saveAll([makeSkill('new-skill', '1.0.0'), makeAgent('worker', '1.0.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { skills: { 'new-skill': '^1.0.0' } },
      },
    });

    const agent = result.entities[0].entity as AgentEntity;
    expect(agent.skills).toHaveProperty('new-skill', '^1.0.0');
  });

  test('adds custom_env_template via override', () => {
    saveAll([makeAgent('worker', '1.0.0')]);

    const result = resolver.resolveTemplate({
      entityRefs: ['agent/worker@1.0.0'],
      overrides: {
        'agent/worker': { custom_env_template: { CUSTOM_KEY: '${CUSTOM_KEY}' } },
      },
    });

    const agent = result.entities[0].entity as AgentEntity;
    expect(agent.custom_env_template).toHaveProperty('CUSTOM_KEY', '${CUSTOM_KEY}');
  });
});
