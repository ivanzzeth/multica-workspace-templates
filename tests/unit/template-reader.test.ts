/**
 * Unit tests for TemplateReader — v1 and v2 template parsing.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TemplateReader } from '../../src/services/template-reader.js';
import { isTemplateV2 } from '../../src/types/template.js';

let dir: string;
let reader: TemplateReader;

beforeEach(() => {
  dir = join(tmpdir(), `reader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  reader = new TemplateReader(dir, dir);
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

function writeTemplate(filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
}

describe('TemplateReader — v1 templates', () => {
  test('parses v1 template with inline agents', () => {
    writeTemplate('v1-test.yaml', `
version: "1.1"
name: TestTemplate
description: A v1 template
agents:
  - name: Worker
    description: Worker agent
    instructions: "# Worker"
    model: auto
    runtime_provider: claude
    skills: [skill-a]
projects: []
labels: []
autopilots: []
runtime_mapping:
  claude: { display_name: Claude }
    `);
    const t = reader.readTemplate('v1-test');
    expect(t.name).toBe('TestTemplate');
    expect(t.agents).toHaveLength(1);
    expect(t.agents[0].name).toBe('Worker');
    expect(t.schema_version).toBe('1.0'); // v1 auto-upgraded
    expect(t.includes).toBeUndefined();  // no entity refs
  });

  test('parses v1 template with inline skills', () => {
    writeTemplate('v1-skills.yaml', `
version: "1.1"
name: SkillTemplate
description: Template with skills
agents:
  - name: Dev
    description: Developer
    instructions: "# Dev"
    model: auto
    runtime_provider: claude
skills:
  - name: go-testing
    description: Go testing patterns
    files:
      - path: SKILL.md
        content: "# Go Testing"
projects: []
labels: []
autopilots: []
runtime_mapping:
  claude: { display_name: Claude }
    `);
    const t = reader.readTemplate('v1-skills');
    expect(t.skills).toHaveLength(1);
    expect(t.skills![0].name).toBe('go-testing');
  });

  test('decodes v1 template has correct type detection', () => {
    writeTemplate('v1-check.yaml', `
version: "1.1"
name: CheckTemplate
description: Test
agents: [{ name: A, description: A, instructions: "#", model: auto, runtime_provider: claude }]
projects: []
labels: []
autopilots: []
runtime_mapping: { claude: { display_name: C } }
    `);
    const raw = reader.readTemplateRaw('v1-check');
    expect(isTemplateV2(raw)).toBe(false);
  });
});

describe('TemplateReader — v2 templates', () => {
  test('parses v2 template with entity refs', () => {
    writeTemplate('v2-ref.yaml', `
schema_version: "2.0"
name: RefTemplate
description: Template with entity refs
agents: []
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
includes:
  entities:
    - ref: agent/worker@2.0.1
    - ref: skill/go-testing@1.2.0
    `);
    const t = reader.readTemplate('v2-ref');
    expect(t.name).toBe('RefTemplate');
    expect(t.schema_version).toBe('2.0');
    expect(t.includes).toBeDefined();
    expect(t.includes!.entities).toHaveLength(2);
    expect(t.includes!.entities![0].ref).toBe('agent/worker@2.0.1');
    expect(t.agents).toHaveLength(0);
  });

  test('parses v2 mixed template (inline + entity refs)', () => {
    writeTemplate('v2-mixed.yaml', `
schema_version: "2.0"
name: MixedTemplate
description: Mixed template
agents:
  - name: Assistant
    description: Assistant
    instructions: "# Assistant"
    model: auto
    runtime_provider: claude
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
includes:
  entities:
    - ref: agent/worker@2.0.1
    `);
    const t = reader.readTemplate('v2-mixed');
    expect(t.agents).toHaveLength(1);
    expect(t.agents[0].name).toBe('Assistant');
    expect(t.includes!.entities).toHaveLength(1);
  });

  test('parses v2 with overrides on entity refs', () => {
    writeTemplate('v2-override.yaml', `
schema_version: "2.0"
name: OverrideTemplate
description: Template with overrides
agents: []
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
includes:
  entities:
    - ref: agent/worker@2.0.1
      overrides:
        model: claude-opus-4-8
        max_concurrent_tasks: 8
    `);
    const t = reader.readTemplate('v2-override');
    const entity = t.includes!.entities![0];
    expect(entity.overrides).toBeDefined();
    expect(entity.overrides!.model).toBe('claude-opus-4-8');
    expect(entity.overrides!.max_concurrent_tasks).toBe(8);
  });

  test('decodes v2 template has correct type detection', () => {
    writeTemplate('v2-type.yaml', `
schema_version: "2.0"
name: TypeTemplate
description: Test
agents: []
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping: { claude: { display_name: C } }
    `);
    const raw = reader.readTemplateRaw('v2-type');
    expect(isTemplateV2(raw)).toBe(true);
  });

  test('v2 without includes section works fine', () => {
    writeTemplate('v2-no-includes.yaml', `
schema_version: "2.0"
name: NoIncludes
description: v2 without entity refs
agents:
  - name: Dev
    description: Dev
    instructions: "# Dev"
    model: auto
    runtime_provider: claude
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
    `);
    const t = reader.readTemplate('v2-no-includes');
    expect(t.name).toBe('NoIncludes');
    expect(t.includes).toBeUndefined();
    expect(t.agents).toHaveLength(1);
  });
});

describe('TemplateReader — list templates with mode', () => {
  test('lists templates with correct mode badges', () => {
    writeTemplate('inline-template.yaml', `
version: "1.1"
name: InlineT
description: Pure inline
agents: [{ name: A, description: A, instructions: I, model: auto, runtime_provider: claude }]
projects: []
labels: []
autopilots: []
runtime_mapping: { claude: { display_name: C } }
    `);
    writeTemplate('ref-template.yaml', `
schema_version: "2.0"
name: RefT
description: Pure ref
agents: []
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
includes:
  entities:
    - ref: agent/worker@2.0.1
    `);
    writeTemplate('mixed-template.yaml', `
schema_version: "2.0"
name: MixedT
description: Mixed
agents: [{ name: A, description: A, instructions: I, model: auto, runtime_provider: claude }]
skills: []
autopilots: []
projects: []
labels: []
runtime_mapping:
  claude: { display_name: Claude }
includes:
  entities:
    - ref: agent/worker@2.0.1
    `);

    const list = reader.listTemplates();
    const inline = list.find((t) => t.name === 'InlineT');
    const ref = list.find((t) => t.name === 'RefT');
    const mixed = list.find((t) => t.name === 'MixedT');

    expect(inline).toBeDefined();
    expect(inline!.mode).toBeUndefined(); // v1 templates have no mode field
    expect(inline!.entity_ref_count).toBeUndefined();

    expect(ref).toBeDefined();
    expect(ref!.mode).toBe('reference');
    expect(ref!.entity_ref_count).toBe(1);

    expect(mixed).toBeDefined();
    expect(mixed!.mode).toBe('mixed');
    expect(mixed!.entity_ref_count).toBe(1);
  });
});
