/**
 * Unit tests for EntityValidator.
 */
import { describe, test, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EntityValidator } from '../../src/services/entity-validator.js';

// ── Helpers ──

const validator = new EntityValidator();

function tempFile(content: string, prefix = 'test-entity'): string {
  const dir = join(tmpdir(), 'entity-validator-test');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${prefix}-${Date.now()}.yaml`);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── Schema Validation ──

describe('EntityValidator — Schema validation', () => {
  test('valid skill entity passes all checks', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: golang-testing
version: 1.2.0
description: Go testing patterns
files:
  - path: SKILL.md
    content: "# Go Testing\\n\\n## Overview"
    `);
    expect(result.valid).toBe(true);
    expect(result.entity_type).toBe('skill');
  });

  test('valid agent entity passes all checks', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: worker
version: 2.0.1
description: Development agent
instructions: "# Worker Agent\\n\\nYou are a developer."
model: auto
runtime_provider: claude
skills:
  golang-testing: ^1.2.0
    `);
    expect(result.valid).toBe(true);
    expect(result.entity_type).toBe('agent');
  });

  test('valid autopilot entity passes all checks', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: daily-sync
version: 1.0.0
title: Daily Sync
description: Daily scheduling
mode: run_only
agent_ref: agent/planner@^1.0.0
    `);
    expect(result.valid).toBe(true);
    expect(result.entity_type).toBe('autopilot');
  });

  test('rejects entity with missing discriminator', () => {
    const result = validator.validateString(`
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('discriminator'))).toBe(true);
  });

  test('rejects unknown entity type', () => {
    const result = validator.validateString(`
entity: unknown
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'entity')).toBe(true);
  });

  test('rejects missing name', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
version: 1.0.0
description: Test
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'name')).toBe(true);
  });

  test('rejects missing version', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
description: Test
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'version')).toBe(true);
  });

  test('rejects invalid semver version', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: latest
description: Test
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'version' && i.message.includes('semver'))).toBe(true);
  });

  test('rejects agent without instructions', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
model: auto
runtime_provider: claude
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'instructions')).toBe(true);
    expect(result.issues.some((i) => i.field === 'description')).toBe(true); // also missing description
  });

  test('rejects skill without files or config', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: A test skill without content
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'files')).toBe(true);
  });

  test('rejects autopilot without agent_ref', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test AP
description: Test
mode: run_only
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'agent_ref')).toBe(true);
  });

  test('rejects autopilot with invalid mode', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test AP
description: Test
mode: invalid_mode
agent_ref: agent/test@1.0.0
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'mode')).toBe(true);
  });

  test('rejects unknown schema_version major', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "9.0"
name: test
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'schema_version')).toBe(true);
  });

  test('accepts compatible schema_version', () => {
    // 1.0 is in the approved list
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(true);
  });
});

// ── Name Validation ──

describe('EntityValidator — Name validation', () => {
  test('rejects name containing ".."', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: "../etc/passwd"
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'name' && i.message.includes('path'))).toBe(true);
  });

  test('rejects name containing "/"', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: "test/evil"
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'name')).toBe(true);
  });

  test('accepts valid kebab-case name', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: golang-testing
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(true);
  });

  test('accepts snake_case name', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: python_testing
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(true);
  });

  test('accepts dot.separated name', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: my.skill.v1
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(true);
  });

  test('rejects name longer than 64 chars', () => {
    const longName = 'a'.repeat(65);
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: ${longName}
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.valid).toBe(false);
  });

  test('warns on name with non-standard characters', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: "Test@Skill!"
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
    `);
    expect(result.issues.some((i) => i.severity === 'warning' && i.field === 'name')).toBe(true);
  });
});

// ── Path Validation ──

describe('EntityValidator — Path validation', () => {
  test('rejects file path containing ".."', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
files:
  - path: "../../../etc/passwd"
    content: "# evil"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field?.includes('path') && i.message.includes('..'))).toBe(true);
  });

  test('rejects absolute file paths', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
files:
  - path: "/etc/passwd"
    content: "# evil"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field?.includes('path') && i.message.includes('absolute'))).toBe(true);
  });

  test('accepts valid relative paths', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Test"
  - path: advanced/guide.md
    content: "# Advanced Guide"
    `);
    expect(result.valid).toBe(true);
  });

  test('rejects duplicate file paths', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
files:
  - path: SKILL.md
    content: "# Content A"
  - path: SKILL.md
    content: "# Content B"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });
});

// ── Secret Detection ──

describe('EntityValidator — Secret detection', () => {
  test('detects AWS access key in instructions', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
description: Test agent
instructions: "Use this key: AKIAIOSFODNN7EXAMPLE"
model: auto
runtime_provider: claude
    `);
    const secretIssue = result.issues.find((i) => i.field === 'instructions' && i.message.includes('secret'));
    expect(secretIssue).toBeDefined();
    expect(secretIssue!.severity).toBe('error');
  });

  test('detects private key header in instructions', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
instructions: "My key:\\n-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAK..."
model: auto
runtime_provider: claude
    `);
    expect(result.issues.some((i) => i.message.includes('secret'))).toBe(true);
  });

  test('detects GitHub token pattern', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
instructions: "Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
model: auto
runtime_provider: claude
    `);
    expect(result.issues.some((i) => i.message.includes('secret'))).toBe(true);
  });

  test('accepts ${ENV_VAR} references (not secrets)', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
instructions: "Use token from env"
model: auto
runtime_provider: claude
custom_env_template:
  API_KEY: \${API_KEY}
  AUTH_TOKEN: \${AUTH_TOKEN}
    `);
    // Should pass without secret errors
    const secretErrors = result.issues.filter((i) => i.message.includes('secret') && i.severity === 'error');
    expect(secretErrors).toHaveLength(0);
  });

  test('warns about literal values in custom_env_template', () => {
    const result = validator.validateString(`
entity: agent
schema_version: "1.0"
name: test
version: 1.0.0
description: Test
instructions: "OK"
model: auto
runtime_provider: claude
custom_env_template:
  API_KEY: "sk-actual-literal-value-should-be-ref"
    `);
    expect(result.issues.some((i) =>
      i.field === 'custom_env_template.API_KEY' && i.message.includes('literal')
    )).toBe(true);
  });
});

// ── Cross-Reference Validation ──

describe('EntityValidator — Cross-reference validation', () => {
  test('accepts valid agent_ref format', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test
description: Test
mode: run_only
agent_ref: agent/worker@^2.0.0
    `);
    expect(result.valid).toBe(true);
  });

  test('rejects agent_ref with wrong type', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test
description: Test
mode: run_only
agent_ref: skill/some-skill@1.0.0
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('agent entity'))).toBe(true);
  });

  test('rejects invalid agent_ref format', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test
description: Test
mode: run_only
agent_ref: "just-a-name"
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'agent_ref')).toBe(true);
  });
});

// ── Edge Cases ──

describe('EntityValidator — Edge cases', () => {
  test('validates from file path', () => {
    const path = tempFile(`
entity: skill
schema_version: "1.0"
name: from-file
version: 1.0.0
description: Loaded from file
files:
  - path: SKILL.md
    content: "# File test"
    `);
    const result = validator.validateFile(path);
    expect(result.valid).toBe(true);
    expect(result.entity_type).toBe('skill');
  });

  test('rejects empty string', () => {
    const result = validator.validateString('');
    expect(result.valid).toBe(false);
  });

  test('rejects non-object', () => {
    const result = validator.validateString('just a string');
    expect(result.valid).toBe(false);
  });

  test('rejects null', () => {
    const result = validator.validateString('null');
    expect(result.valid).toBe(false);
  });

  test('skill without files but with config is valid', () => {
    const result = validator.validateString(`
entity: skill
schema_version: "1.0"
name: config-only-skill
version: 1.0.0
description: A config-only skill
config:
  key: value
  flag: true
    `);
    expect(result.valid).toBe(true);
  });

  test('autopilot with triggers validates correctly', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test AP
description: Test
mode: run_only
agent_ref: agent/test@1.0.0
triggers:
  - cron: "0 9 * * 1-5"
    timezone: Asia/Shanghai
    `);
    expect(result.valid).toBe(true);
  });

  test('autopilot trigger missing cron is rejected', () => {
    const result = validator.validateString(`
entity: autopilot
schema_version: "1.0"
name: test
version: 1.0.0
title: Test AP
description: Test
mode: run_only
agent_ref: agent/test@1.0.0
triggers:
  - timezone: Asia/Shanghai
    `);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field?.includes('cron'))).toBe(true);
  });
});
