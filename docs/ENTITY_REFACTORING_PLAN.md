# Multica Workspace Templates — Entity Componentization Refactoring Plan

> **Version**: v0.4.0-revised  
> **Status**: Revised (superset design, testing strategy, UI design)  
> **Author**: Ivan Zhang & Claude  
> **Last Updated**: 2026-05-29 14:03 UTC+08

---

## 1. Problem Statement

### 1.1 Current State (v0.0.1)

The template system exports entire workspace configurations as **monolithic YAML files**. A single template (`basic4agent.yaml`) is ~28,000 lines:

```yaml
version: "1.1"
name: Basic4Agent
agents:
  - name: Worker
    instructions: |-
      # Multica Worker Agent
      ... (thousands of lines of agent instructions inlined)
    skills: [golang-testing, python-pro, ...]   # name-only references
skills:
  - name: golang-testing
    files:
      - path: SKILL.md
        content: |-
          ... (full skill content inlined)
autopilots:
  - title: Daily Sync
    agent_ref: Worker
    triggers: [...]
```

### 1.2 Pain Points

| Pain Point | Impact |
|---|---|
| **No cross-template reuse** | Want the same `Worker` agent in 5 templates? Copy-paste 900KB of instructions |
| **No independent versioning** | Skill `golang-testing` gets a bug fix → must re-export and update ALL templates |
| **Blind copy on import** | Import overwrites agents/skills with template snapshot — can silently downgrade |
| **No granular import** | Cannot import *just one agent with its skills* — must import entire template |
| **Template bloat** | 28K-line YAML files are hard to review, diff, and store in git |
| **No dependency graph** | No way to know "autopilot X depends on agent Y which depends on skills A, B, C" |
| **Drift between instances** | Workspace A and Workspace B both imported `Worker`, then evolved independently — no way to reconcile |

### 1.3 Design Principle: Superset, Not Rewrite

**v2 is a strict superset of v1.** The existing inline format is the foundation; entity references are an additional capability layered on top.

```
v1 (existing):              Template = Inline [Agents + Skills + Autopilots + Projects + Labels]

v2 (new, superset):         Template = Inline [Agents + Skills + Autopilots + ...]     ← v1 subset, fully supported
                            PLUS
                            Template.includes.entities = [Refs to external entities]    ← NEW capability

                            At import time:
                            ref entities + inline entities → merged into single workspace
                            (inline wins on name collision — explicit > implicit)
```

**Key implications of the superset approach**:

| Principle | What it means |
|---|---|
| **Zero breakage** | All existing v1 templates are valid v2 templates. No migration required. |
| **Inline always works** | Users can always define agents/skills inline. v1 template = v2 template with no `includes` section. |
| **Refs are additive** | Entity references ADD entities to the import; they don't replace inline content. |
| **Inline wins on conflict** | If an entity ref and an inline definition have the same name, inline wins (explicit overrides implicit). |
| **Mixed mode** | A single template can have inline agents AND entity-ref agents. They coexist. |
| **Gradual adoption** | Users start with inline. When they want to reuse an agent, they extract it as an entity. Other templates reference it. The original template still works with inline until they choose to switch. |

**The goal**:

```
Before:   Template = [Agents + Skills + Autopilots + Projects + Labels]  (one big YAML, no reuse)

After:    Template = [Agents + Skills + Autopilots + ...]                 ← inline still works
             + includes.entities = [ref: agent/worker@2.0, ...]           ← NEW: compose from entities

          Entity = [Agent | Skill | Autopilot]                            ← independently versioned, reusable
```

**Entities are an optional building block. Templates remain fully self-contained YAML files.**

---

## 2. Entity Architecture

### 2.1 Entity Types

| Entity Type | Identity | What It Contains |
|---|---|---|
| **Skill** | `name` + `version` | description, files[], config |
| **Agent** | `name` + `version` | description, instructions, model, runtime, skills[], env, mcp_config |
| **Autopilot** | `name` + `version` | title, description, mode, triggers[], agent_ref (to Agent entity) |

Projects and Labels are **workspace-scoped mutable objects**, not entities. They stay inline in templates.

### 2.2 Entity Identity & Addressing

Each entity is uniquely identified by `{type}/{name}@{version}`:

```
skill/golang-testing@1.2.0
agent/worker@2.0.1
autopilot/daily-sync@1.0.0
```

**Versioning scheme**: Semantic Versioning (MAJOR.MINOR.PATCH)

- **MAJOR**: Breaking change (agent's skills list changed significantly, instruction semantics changed)
- **MINOR**: New feature (new skill file added, new agent capability)
- **PATCH**: Bug fix (typo in instructions, skill content improvement)

### 2.3 Entity Schema

#### Skill Entity (`entity/skill.yaml`)

```yaml
entity: skill               # discriminator
schema_version: "1.0"
name: golang-testing
version: 1.2.0              # semver
description: Go testing patterns — table-driven tests, testify, gomock
config:                     # optional, arbitrary key-value
  requires_framework: testify
  auto_install: true
files:                      # skill files (at minimum SKILL.md)
  - path: SKILL.md
    content: |-
      # Go Testing
      ...
  - path: advanced/suite.md
    content: |-
      # Test Suite Patterns
      ...
metadata:                   # optional, for discovery
  author: multica
  tags: [go, testing, quality]
  created_at: "2025-11-15T00:00:00Z"
  updated_at: "2026-04-10T00:00:00Z"
```

#### Agent Entity (`entity/agent.yaml`)

```yaml
entity: agent
schema_version: "1.0"
name: worker
version: 2.0.1
description: 开发+调研。全栈开发和技术调研
instructions: |-
  # Multica Worker Agent
  ... (full instructions)
model: auto
runtime_provider: claude
visibility: private
max_concurrent_tasks: 6
custom_env_template:
  ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN}
  ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
skills:                          # reference skills by name+semver range
  golang-testing: ^1.2.0
  python-pro: ^2.0.0
  security-review: ^1.0.0
  # ... more skills with version constraints
custom_args: []
runtime_config: {}
mcp_config: null
metadata:
  tags: [development, fullstack]
```

**Key change**: `skills` becomes `{name: semver_range}` instead of `[string]`. This enables:
- Automatic dependency resolution on import
- Version conflict detection
- "Bring your own skills" — import just the agent, resolve skills from local registry

#### Autopilot Entity (`entity/autopilot.yaml`)

```yaml
entity: autopilot
schema_version: "1.0"
name: daily-sync
version: 1.0.0
title: Daily Sync
description: Daily issue scheduling and team sync
mode: run_only                   # run_only | create_issue
agent_ref: worker@^2.0.0        # reference agent entity
triggers:
  - cron: "57 8 * * 1-5"         # off-minute to avoid fleet stampede
    timezone: Asia/Shanghai
    label: weekday-morning
metadata:
  tags: [scheduling, daily]
```

### 2.4 Entity Storage

```
~/.multica/
├── entities/                    # Local entity cache (the registry)
│   ├── skill/
│   │   └── golang-testing/
│   │       ├── 1.0.0.yaml
│   │       ├── 1.1.0.yaml
│   │       └── 1.2.0.yaml
│   ├── agent/
│   │   └── worker/
│   │       ├── 2.0.0.yaml
│   │       └── 2.0.1.yaml
│   └── autopilot/
│       └── daily-sync/
│           └── 1.0.0.yaml
├── templates/                   # Template manifests (composed of entity references)
│   ├── basic4agent.yaml         # ~5KB instead of ~28K lines
│   └── my-custom.yaml
├── config.json
└── servers.json
```

### 2.5 Content Hash Integrity

Each entity file gets a SHA256 hash computed on import:

```yaml
# Inside the entity cache manifest: ~/.multica/entities/.manifest.yaml
skill/golang-testing@1.2.0:
  hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  path: skill/golang-testing/1.2.0.yaml
  imported_at: "2026-05-29T10:00:00Z"
```

Template references can optionally pin a hash for integrity verification.

---

## 3. Template Composition Model

### 3.1 New Template Schema (v2.0 — Superset of v1)

v2 templates support BOTH inline definitions AND entity references. They coexist and merge at import time.

```yaml
# Template v2.0 = v1 inline definitions + optional entity references
schema_version: "2.0"
name: Basic4Agent
description: Basic 4-agent team with full development capabilities
metadata:
  author: multica
  tags: [team, development]

# ── Section A: Inline definitions (v1 format, fully supported) ──
# Everything that worked in v1 still works here. This section alone
# makes the file a valid v1 template (backward compatible).
agents:
  - name: Assistant
    description: 需求沟通、创建 issue、工作区管理
    instructions: |-
      ... (full instructions, same as v1)
    model: deepseek-v4-pro
    runtime_provider: claude
    skills: [agent-browser, code-review-quality, ...]

skills:
  - name: golang-testing
    files:
      - path: SKILL.md
        content: |-
          ... (full skill content)

autopilots:
  - title: Daily Sync
    agent_ref: Planner
    triggers: [...]

# ── Section B: Entity references (NEW in v2) ──
# These are ADDED to the inline definitions at import time.
# If a ref has the same name as an inline agent/skill/autopilot,
# the INLINE version wins (explicit > implicit).
includes:
  entities:
    - ref: agent/worker@2.0.1
      hash: sha256:abc123...        # optional, for integrity pinning
      overrides:                      # optional, template-level overrides
        model: claude-opus-4-8
    - ref: agent/qa@1.5.0
    - ref: skill/golang-testing@1.2.0
    - ref: autopilot/weekly-review@1.0.0

# ── Section C: Workspace-scoped objects (same as v1) ──
projects:
  - title: My Project
    description: ...
    status: in_progress

labels:
  - name: bug
    color: "#ef4444"

runtime_mapping:
  claude: { display_name: "Claude" }
  cursor: { display_name: "Cursor" }
```

### 3.2 Import Merge Rules (Inline + Entity Refs)

When both inline definitions and entity references exist, the import engine merges them:

```
Template.agents.inline       = [Assistant, Planner]        (from Section A)
Template.includes.entities   = [agent/worker@2.0.1, ...]   (from Section B)
                   ↓
           Merge (union), inline wins on name collision
                   ↓
Final import set             = [Assistant, Planner, Worker, QA, ...]
```

**Conflict resolution** (same name in both inline and ref):
1. **Inline wins**: The inline definition is the explicit version for this template. The entity ref with the same name is skipped with a warning ("Agent 'X' defined inline; entity ref 'agent/X@Y' ignored").
2. **Only ref provided**: Entity is resolved from registry and imported.
3. **Only inline provided**: Imported directly (identical to v1 behavior).

### 3.3 Template Size: Mixed Mode

| Template | v1 (inline only) | v2 (mixed) | v2 (pure ref) |
|---|---|---|---|
| basic4agent | ~28,000 lines | ~15,000 lines (agents inline) + 5 entity refs | ~50 lines |
| Custom team | ~8,000 lines | ~8,000 lines (no entity refs used) | N/A |

Users choose their own level of decomposition. No forced migration.

### 3.4 Override Semantics

Overrides apply at **template import time** and take precedence over entity defaults:

```yaml
includes:
  entities:
    - ref: agent/worker@^2.0.0
      overrides:
        model: claude-opus-4-8          # entity default is 'auto', template says Opus
        max_concurrent_tasks: 8          # entity default is 6, template says 8
        skills:
          golang-testing: ^1.2.0        # add skill not in entity
        custom_env_template:
          CUSTOM_KEY: ${CUSTOM_KEY}     # add extra env var
```

**Overrides CANNOT** change:
- `name` (identity)
- `version` (managed by entity)
- `instructions` (if you need different instructions, create a new entity version)

**Rationale**: `instructions` is the core value of an Agent entity. Overriding it in a template defeats the purpose of independent versioning — just create `agent/worker@2.1.0` with the new instructions.

### 3.5 Override Merge Strategy

```
final = entity_defaults > template_overrides > import-time_options
         (base)            (template layer)        (user at import time)
```

Precedence (highest wins):
1. User provides at import time (env vars, runtime mapping)
2. Template-level overrides
3. Entity defaults

---

## 4. Dependency Resolution Engine

### 4.1 The Import DAG

```
Template
├── agent/assistant@^3.0.0
│   ├── skill/agent-browser@^2.0.0
│   ├── skill/code-review-quality@^1.5.0
│   └── skill/golang-testing@^1.2.0
├── agent/worker@^2.0.0
│   ├── skill/golang-testing@^1.2.0       ← shared dependency
│   └── skill/python-pro@^2.0.0
├── autopilot/daily-sync@^1.0.0
│   └── agent/planner@^1.0.0               ← auto-discovered, not explicitly in template
│       └── skill/multica-issue-management@^1.0.0
└── autopilot/weekly-review@^1.0.0
    └── agent/planner@^1.0.0               ← same agent as above
```

### 4.2 Resolution Algorithm

```typescript
interface ResolutionResult {
  entities: Map<string, EntityDescriptor>;  // entity_ref -> resolved entity data
  warnings: ResolutionWarning[];            // non-fatal issues
  errors: ResolutionError[];                // fatal issues
}

function resolveTemplate(template: TemplateV2, registry: EntityRegistry): ResolutionResult {
  // Phase 1: Flatten
  //   Walk template.includes.entities, recursively resolve each entity's dependencies
  //
  // Phase 2: Deduplicate
  //   Multiple references to the same entity (e.g., two agents reference golang-testing@^1.0)
  //   → pick the highest compatible version
  //
  // Phase 3: Version Solve
  //   For each entity, find the best version satisfying all semver constraints
  //   Use the highest existing version that satisfies ALL constraints
  //
  // Phase 4: Topological Sort
  //   Order: skills → agents → autopilots (respect dependency DAG)
  //
  // Phase 5: Validate
  //   - No missing dependencies (agent references skill not in registry)
  //   - No version conflicts (two constraints are incompatible)
  //   - No circular dependencies
  //   - Hash integrity check (if pinned)
}
```

### 4.3 Version Conflict Resolution

**Strategy**: Collect all constraints for each entity, find highest version satisfying ALL:

```
Agent A requires: golang-testing@^1.2.0  (≥1.2.0, <2.0.0)
Agent B requires: golang-testing@^1.5.0  (≥1.5.0, <2.0.0)

Registry has: 1.2.0, 1.5.0, 1.6.1, 2.0.0

Solution: 1.6.1 (highest within intersection [1.5.0, 2.0.0))
```

If no compatible version exists → **resolution error**, user must decide:
1. Import with older version (risk inconsistency)
2. Update one of the agents to accept newer version
3. Import without the conflicting skill

### 4.4 Transitive Dependency Discovery

When importing an autopilot entity, its `agent_ref` triggers transitive resolution:

```
Import: autopilot/daily-sync@1.0.0
  → autopilot.daily-sync.agent_ref = worker@^2.0.0
    → resolve agent/worker@^2.0.0
      → worker.skills = {golang-testing: ^1.2.0, python-pro: ^2.0.0}
        → resolve skill/golang-testing@^1.2.0
        → resolve skill/python-pro@^2.0.0
```

This means `importer apply --entity autopilot/daily-sync@1.0.0` imports the autopilot, its agent, AND all transitive skills.

---

## 5. Entity Registry

### 5.1 Local Registry (`~/.multica/entities/`)

The local registry is the ground truth for entity availability:

```
~/.multica/entities/
├── .manifest.yaml          # index of all locally cached entities
├── .remotes.yaml           # configured remote sources
├── skill/
│   ├── golang-testing/
│   │   ├── 1.0.0.yaml
│   │   └── 1.2.0.yaml
│   └── ...
├── agent/
│   └── ...
└── autopilot/
    └── ...
```

### 5.2 Registry CLI Subcommands

```bash
# List locally cached entities
multica-templates entity list
multica-templates entity list --type agent
multica-templates entity list --filter golang

# Show entity details
multica-templates entity show agent/worker@2.0.1

# Import entity from remote/file
multica-templates entity import ./my-skill.yaml
multica-templates entity import --remote github:ivanzzeth/multica-entities skill/golang-testing@^1.2

# Export entity from workspace
multica-templates entity export --workspace <ws-id> agent/worker

# Validate entity file
multica-templates entity validate ./agent.yaml

# Search remote registries
multica-templates entity search go testing
```

### 5.3 Remote Registries

```yaml
# ~/.multica/entities/.remotes.yaml
remotes:
  - name: official
    url: https://entities.multica.dev/v1
    priority: 10
  - name: my-team
    url: git@github.com:myorg/multica-entities.git
    type: git
    branch: main
    path: entities/
    priority: 20
  - name: community
    url: https://raw.githubusercontent.com/multica-community/entities/main/
    priority: 30
```

Resolution order: local cache → highest-priority remote → fall through remotes.

### 5.4 Entity Publication Workflow

```
Developer:
  1. Creates/updates entity YAML file locally
  2. multica-templates entity validate ./my-agent.yaml
  3. multica-templates entity publish ./my-agent.yaml --remote my-team
     → commits to git repo
     → bumps version
     → creates git tag my-agent@2.1.0
  4. (other users) multica-templates entity pull agent/my-agent@^2.1
     → fetches from remote
     → validates hash
     → caches locally
```

---

## 6. Import Engine Changes

### 6.1 Current Import Pipeline (for reference)

```
dryRun(): template → read YAML → scan workspace → compare names → return diff
apply():   template → read YAML → scan workspace → run mutations → return result
```

### 6.2 New Import Pipeline

```
Phase 0: Template Parsing
  Parse v2.0 template manifest → extract entity refs + overrides

Phase 1: Dependency Resolution
  Resolve all entity refs → build DAG → version-solve → topo-sort

Phase 2: Dry Run (enhanced)
  For each entity in topological order:
    - Check if entity already exists in target workspace
    - If exists: "update" (with new version) or "skip" (same version)
    - If missing: "create"
  Include transitive dependencies in dry run preview

Phase 3: Apply (streaming)
  Execute in topological order: skills → agents → autopilots
  Each step reports progress with entity ref + action

Phase 4: Skill Binding
  After all imports, bind agent→skill associations using resolved skill IDs
```

### 6.3 New Import Options

```typescript
interface ImportOptions {
  // Existing
  template_name: string;
  workspace_id: string;
  runtime_map: RuntimeMapAssignment[];
  mode: 'skip-existing' | 'force-overwrite';
  env_vars?: Record<string, string>;

  // New
  entity_selection?: {                     // Granular import: pick specific entities
    type: 'all' | 'selected';
    entities?: string[];                  // e.g., ['agent/worker', 'skill/golang-testing']
  };
  resolve_strategy?: 'latest' | 'pinned';  // latest = use newest compatible; pinned = exact hash
  dry_run_depth?: number;                  // 0 = only template entities, 1 = + direct deps, -1 = full transitive
  skip_missing?: boolean;                  // skip unresolvable deps instead of failing
}
```

### 6.4 Import Result (Enhanced)

```typescript
interface ImportResult {
  success: boolean;
  created: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  skipped: { agents: number; projects: number; labels: number; autopilots: number; triggers: number; skills: number };
  updated: { agents: number; skills: number };
  errors: string[];

  // New
  resolved: EntityResolution[];   // what was resolved and which version
  warnings: ImportWarning[];      // non-fatal issues
  dependency_tree: DepTreeNode;   // for UI visualization
}
```

---

## 7. Export Engine Changes

### 7.1 Current Export (for reference)

```
Scan workspace → build monolithic Template → write YAML
```

### 7.2 New Export Pipeline

```
Phase 1: Scan workspace (same as before)

Phase 2: Entity Extraction
  For each agent in workspace:
    - Extract as separate entity by default
    - Offer option: "inline" (old behavior) vs "reference" (new)
  For each skill referenced by agents:
    - Pull full content from workspace
    - Save as separate entity
  For each autopilot:
    - Extract as separate entity with agent_ref

Phase 3: Template Assembly
  Build template manifest with entity references
  Save entities to local registry
  Save template manifest to templates dir
```

### 7.3 Export Modes

```typescript
interface ExportOptions {
  // Existing
  agents: boolean;
  autopilots: boolean;
  skills: boolean;
  projects: boolean;
  labels: boolean;

  // New
  mode: 'inline' | 'reference' | 'split';  // New export format
  version_bump: 'auto' | 'manual' | 'none'; // Auto version bump on re-export
  entity_registry?: 'local' | 'remote';     // Where to save entities
  publish?: boolean;                         // Also publish to remote registry
  include_transitive?: boolean;              // Include transitive deps in template manifest
}
```

- **`inline`**: Legacy monolithic YAML (compatibility mode)
- **`reference`**: Template manifest with entity refs + save entities to local registry
- **`split`**: Template manifest + individual entity YAML files (for git-based sharing)

---

## 8. Backward Compatibility (Superset Design)

### 8.1 v1 Templates ARE Valid v2 Templates

Since v2 is a superset of v1, **every existing v1 template is automatically a valid v2 template** with zero changes:

```yaml
# This v1 template:
version: "1.1"
name: Basic4Agent
agents: [...]
skills: [...]
autopilots: [...]

# ...is semantically identical to this v2 template:
schema_version: "2.0"
name: Basic4Agent
agents: [...]        # inline — same as v1
skills: [...]        # inline — same as v1
autopilots: [...]    # inline — same as v1
# includes section simply omitted (no entity refs)
```

### 8.2 TemplateReader Version Detection

The `TemplateReader` detects format by checking the `schema_version` field:

```typescript
function readTemplate(name: string): TemplateV2 {
  const raw = parseYaml(content);

  // v1 format: has `version: "1.x"` without `schema_version`
  // v2 format: has `schema_version: "2.x"`
  if (raw.schema_version?.startsWith('2.')) {
    return parseV2(raw);     // may have includes.entities
  }

  // v1 format OR v2 format without includes
  // Both are valid: inline agents/skills/autopilots
  return parseAsInline(raw);  // unified internal representation
}
```

### 8.3 Import Engine: Unified Pipeline

Since both formats produce inline content, and v2 adds optional entity refs, the import pipeline is unified:

```typescript
function importTemplate(template: TemplateV2, opts: ImportOptions): ImportResult {
  // Step 1: Collect inline entities (present in both v1 and v2)
  const inlineSet = collectInlineEntities(template);  // agents, skills, autopilots

  // Step 2: Resolve entity refs (v2 only, empty array for v1)
  const refSet = resolveEntityRefs(template.includes?.entities ?? [], registry);

  // Step 3: Merge — inline wins on name collision
  const finalSet = merge(inlineSet, refSet, { inlineWins: true });

  // Step 4: Import in topological order (same pipeline for both)
  return applyImport(finalSet, opts);
}
```

### 8.4 Export: All Three Modes Produce Valid Templates

| Mode | Output | Backward Compatible? |
|------|--------|---------------------|
| `inline` | v1-style monolithic YAML | ✅ Valid v1 AND v2 |
| `reference` | v2 manifest with entity refs, empty inline | ✅ Valid v2 |
| `mixed` | v2 manifest with BOTH inline AND entity refs | ✅ Valid v2 |

### 8.5 Gradual Adoption Path

```
Phase A: No change
  User continues exporting/importing v1 inline templates.
  └─ Works exactly as before. No migration needed.

Phase B: Extract one entity
  User exports with --mode mixed, extracts the Worker agent as an entity.
  └─ Template has: inline Assistant + Planner, entity ref agent/worker@1.0.0
  └─ Other templates can now reference agent/worker@1.0.0

Phase C: Entity-first
  User migrates all reusable agents to entities.
  └─ Template has: entity refs only, inline section is empty
  └─ Template size ~50 lines

Phase D: Mixed always available
  Even at Phase C, the user can add an inline agent for quick prototyping.
  └─ v2 supports mixed mode indefinitely — no forced "purity"
```

---

## 9. Implementation Phases

### Phase 1: Entity Schema & Registry (v0.2.0)

**Goal**: Define and implement entity storage + validation, no template changes yet.

**Tasks**:
1. Define `EntitySchema` types in `src/types/entity.ts`
2. Implement `EntityRegistry` class (`src/services/entity-registry.ts`)
   - `save(entity: Entity): string` — persist to `~/.multica/entities/`
   - `load(ref: EntityRef): Entity` — load from local cache
   - `resolve(name: string, constraint: string): EntityVersion` — version resolution
   - `list(filter?: EntityFilter): EntitySummary[]` — list cached entities
   - `delete(ref: EntityRef): void`
   - `hash(entity: Entity): string` — SHA256 of canonical YAML
3. Implement `EntityValidator` (`src/services/entity-validator.ts`)
   - Schema validation (required fields, types)
   - Cross-reference validation (agent→skill versions are resolvable)
   - Circular dependency detection
4. Implement CLI: `entity list`, `entity show`, `entity import`, `entity validate`, `entity export`
5. Implement API routes: `GET /api/entities`, `GET /api/entities/:type/:name`, `POST /api/entities/import`, `POST /api/entities/validate`
6. Unit tests for Registry + Validator
7. **Deliverable**: Can create, store, list, and validate entities independently

**Files changed**:
- `src/types/entity.ts` (new)
- `src/types/template.ts` (add v2 types, keep v1)
- `src/services/entity-registry.ts` (new)
- `src/services/entity-validator.ts` (new)
- `src/routes/api.ts` (add entity routes)
- `src/services/cli.ts` (add entity CLI parsing)

### Phase 2: Dependency Resolution Engine (v0.3.0)

**Goal**: Resolve entity dependency graphs with semver constraints.

**Tasks**:
1. Implement `DependencyResolver` (`src/services/dependency-resolver.ts`)
   - `resolve(refs: EntityRef[], registry: EntityRegistry): ResolutionResult`
   - Flattening (recursive dependency walk)
   - Deduplication (pick highest compatible version)
   - Topological sort (skills → agents → autopilots)
   - Version constraint solving (semver range intersection)
   - Hash integrity verification
2. Implement conflict reporting with actionable messages
3. Unit tests: complex dependency graphs, version conflicts, circular deps
4. Integration tests with real entity files
5. **Deliverable**: `resolve(['agent/worker@^2.0', 'autopilot/daily-sync@^1.0'])` returns fully resolved DAG

**Files changed**:
- `src/services/dependency-resolver.ts` (new)
- `src/types/entity.ts` (add ResolutionResult, etc.)

### Phase 3: Template v2 Schema & Import (v0.4.0)

**Goal**: Templates become manifests; import resolves entities from registry.

**Tasks**:
1. Define `TemplateV2` type in `src/types/template.ts`
2. Update `TemplateReader` to detect and parse v2 templates
3. Update `TemplateWriter` to write v2 manifests
4. Implement `ImportEngineV2.apply()` with resolution pipeline:
   a. Parse template manifest
   b. Resolve entity DAG
   c. Import entities in topological order (via existing `cli.createSkill`, etc.)
   d. Bind agent↔skill associations
   e. Create autopilots with resolved agent IDs
5. Implement `ImportEngineV2.dryRun()` with dependency tree preview
6. Update API: `POST /api/import/dry-run`, `POST /api/import/apply` (auto-detect template version)
7. Integration tests: import v2 template end-to-end
8. **Deliverable**: Import a v2 reference-based template into a fresh workspace

**Files changed**:
- `src/types/template.ts` (add TemplateV2, ImportOptionsV2, ImportResultV2)
- `src/services/template-reader.ts` (v2 parsing)
- `src/services/template-writer.ts` (v2 writing)
- `src/services/import-engine.ts` (refactor for v2 pipeline)
- `src/routes/api.ts` (update import routes)

### Phase 4: Template v2 Export (v0.5.0)

**Goal**: Export workspaces as v2 manifests with entity extraction.

**Tasks**:
1. Implement `ExportEngine.apply()` with entity extraction:
   - For each agent: save as entity to local registry, add ref to template
   - For each skill (with full content): save as entity to local registry, add ref
   - For each autopilot: save as entity to local registry, add ref
2. Support `mode: 'reference'` (default), `mode: 'inline'` (v1 compat), `mode: 'split'`
3. Auto-version-bump logic: detect changed entity content, bump semver, ask user
4. Update API: `POST /api/export/preview`, `POST /api/export/apply`
5. UI: Export form shows new mode selection
6. **Deliverable**: Export a workspace as v2 template + entities

**Files changed**:
- `src/services/export-engine.ts` (entity extraction)
- `src/services/entity-registry.ts` (save-on-export)
- `src/routes/api.ts` (update export routes)
- `src/components/ExportForm.tsx` (mode selection UI)

### Phase 5: Remote Registry (v0.6.0)

**Goal**: Pull/publish entities from remote git repos.

**Tasks**:
1. Implement `RemoteRegistry` (`src/services/remote-registry.ts`)
   - `pull(ref: EntityRef): Entity` — fetch from git remote, cache locally
   - `publish(entity: Entity): void` — commit + tag + push to git remote
   - `search(query: string): EntitySummary[]` — search remote index
2. Implement `git` transport: `git fetch`, `git show <tag>:entity.yaml`
3. Implement remote index: `entities/index.yaml` in remote repo listing all entities
4. CLI: `entity pull`, `entity publish`, `entity search`
5. API: `POST /api/entities/pull`, `POST /api/entities/publish`, `GET /api/entities/search`
6. **Deliverable**: `multica-templates entity pull agent/worker@^2.0` from team git repo

**Files changed**:
- `src/services/remote-registry.ts` (new)
- `~/.multica/entities/.remotes.yaml` (config file)
- `src/routes/api.ts` (remote routes)
- CLI subcommands

---

## 10. UI Design

### 10.1 Design Principles

| Principle | Description |
|---|---|
| **Progressive disclosure** | v1 users see the same UI they're used to. Entity features appear only when they opt in. |
| **Mixed mode is first-class** | The UI never forces a choice between "inline" and "entity ref." Both are always available. |
| **Dependency visibility** | Users always see what WILL be imported before they commit. No hidden transitive pulls. |
| **Gradual adoption** | The UI encourages (but never forces) entity extraction. "You've used this agent in 3 templates — extract as entity?" |

### 10.2 Templates View — Main Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  🏠 Templates                                [+ Import] [Export] │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🔍 Search templates...                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Tabs: [All] [Built-in (2)] [User (3)] [v2 Entity (1)]      │
│                                                              │
│  ┌──────────────────────┐ ┌──────────────────────────────┐  │
│  │ 📦 Basic4Agent       │ │ 📦 My Team                   │  │
│  │ v2.0 · Mixed mode    │ │ v1.1 · Inline only           │  │
│  │ 4 agents (1 inline,  │ │ 3 agents · 15 skills         │  │
│  │   3 entity refs)     │ │ Exported Jun 15              │  │
│  │ 2 autopilots         │ │                              │  │
│  │                       │ │ [Import] [View]              │  │
│  │ [Import] [View]       │ │                              │  │
│  └──────────────────────┘ └──────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────┐                                   │
│  │ 🆕 Custom Dev Team   │                                   │
│  │ v2.0 · Pure ref mode │                                   │
│  │ 6 entity refs · 0 inline                                 │
│  │ ~50 lines             │                                   │
│  │                       │                                   │
│  │ [Import] [View]       │                                   │
│  └──────────────────────┘                                   │
└──────────────────────────────────────────────────────────────┘
```

### 10.3 Import Wizard — Step by Step

#### Step 1: Select Workspace
Same as current v0.0.1 — list workspaces, click to select.

#### Step 2: Select Template
Same as current — show template list, click to select. After selection, template detail shows:

```
┌──────────────────────────────────────────────────────────────┐
│  Template: Basic4Agent (v2.0 — mixed mode)                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                        │ │
│  │  📋 Inline agents (2):                                  │ │
│  │    Assistant · Worker                                   │ │
│  │                                                        │ │
│  │  🔗 Entity references (4):                              │ │
│  │    agent/planner@1.0.0          ─── resolves from cache  │ │
│  │    agent/qa@1.5.0               ─── resolves from cache  │ │
│  │    autopilot/daily-sync@1.0.0                          │ │
│  │    skill/golang-testing@1.2.0                          │ │
│  │                                                        │ │
│  │  ⚠️ 2 entities not in local cache. Will pull from:      │ │
│  │    remote: my-team (git@github.com:myorg/entities.git) │ │
│  │                                                        │ │
│  │  [View Dependency Tree]                                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Entity selection:  ○ All  ● Selected                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ☑ agent/assistant (inline)                              │ │
│  │ ☑ agent/worker (inline)                                 │ │
│  │ ☑ agent/planner@1.0.0 (ref)     ──→ skills: [3]         │ │
│  │ ☑ agent/qa@1.5.0 (ref)          ──→ skills: [2]         │ │
│  │ ☑ autopilot/daily-sync@1.0.0    ──→ agent: planner      │ │
│  │ ☑ skill/golang-testing@1.2.0                            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [◀ Back]                              [Continue: Runtime Map ▶] │
└──────────────────────────────────────────────────────────────┘
```

#### Step 3: Runtime Mapping
Same as current v0.0.1 — for each agent, pick a runtime. Enhanced:

```
┌──────────────────────────────────────────────────────────────┐
│  Runtime Mapping                                            │
│                                                              │
│  Inline agents:                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Assistant    runtime: [Claude ▼]          provider: claude│ │
│  │ Worker       runtime: [Claude ▼]          provider: claude│ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Entity-ref agents:                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Planner      runtime: [Claude ▼]          provider: claude│ │
│  │ QA           runtime: [Claude ▼]          provider: claude│ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Per-entity runtime override:                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ agent/planner@1.0.0                                     │ │
│  │   Default runtime (from template): Claude                │ │
│  │   Override: [Use template default ▼]                     │ │
│  │                                                         │ │
│  │ agent/qa@1.5.0                                          │ │
│  │   Default runtime (from template): Claude                │ │
│  │   Override: [Cursor ▼]                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [◀ Back]                                  [Continue: Review ▶] │
└──────────────────────────────────────────────────────────────┘
```

#### Step 4: Dependency Tree & Review

```
┌──────────────────────────────────────────────────────────────┐
│  Import Preview — Dependency Tree                           │
│                                                              │
│  📦 Template: Basic4Agent                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                        │ │
│  │  Agents (4)                          Skills (5)         │ │
│  │  ┌──────────┐                       ┌────────────┐      │ │
│  │  │ Assistant │──inline               │ go-testing │──ref │ │
│  │  └──────────┘                       └────────────┘      │ │
│  │  ┌──────────┐                       ┌────────────┐      │ │
│  │  │  Worker   │──inline               │ python-pro │──ref │ │
│  │  └──────────┘────┐                  └────────────┘      │ │
│  │  ┌──────────┐    │                  ┌────────────┐      │ │
│  │  │ Planner   │─ref│──→ skills       │sec-review  │──ref │ │
│  │  └──────────┘    │                  └────────────┘      │ │
│  │  ┌──────────┐    │                                      │ │
│  │  │    QA    │─ref│  Autopilots (1)                       │ │
│  │  └──────────┘    │  ┌──────────────┐                    │ │
│  │                  │  │  Daily Sync  │──ref               │ │
│  │                  └──│  → Planner   │                    │ │
│  │                     └──────────────┘                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Actions Summary ───────────────────────────────────────┐ │
│  │ 🟢 CREATE  4 agents, 5 skills, 1 autopilot             │ │
│  │ 🟡 UPDATE  1 agent (Assistant — force-overwrite mode)  │ │
│  │ ⚪ SKIP    1 skill (golang-testing already exists)     │ │
│  │ ⚠️ WARNING skill "ruby-pro" not in registry — skipped  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Entity lockfile:                                           │
│  ☑ Generate entity-lock.yaml for reproducible imports      │
│                                                              │
│  Import mode:  ○ Skip existing  ● Force overwrite           │
│                                                              │
│  [◀ Back]                                  [▶ Apply Import]  │
└──────────────────────────────────────────────────────────────┘
```

#### Step 5: Import Progress

```
┌──────────────────────────────────────────────────────────────┐
│  Importing Basic4Agent to "Web3Gate"...                      │
│                                                              │
│  ┌─ Skills ────────────────────────────────────────────────┐ │
│  │ ████████████████████████████  5/5 complete              │ │
│  │ ✅ golang-testing     created                           │ │
│  │ ✅ python-pro         created                           │ │
│  │ ✅ security-review    created                           │ │
│  │ ⬜ agent-browser      skipped (exists)                  │ │
│  │ ✅ code-review        created                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Agents ────────────────────────────────────────────────┐ │
│  │ ████████████░░░░░░░░░░░░░░  2/4 in progress            │ │
│  │ ✅ Assistant          created                           │ │
│  │ ✅ Worker             created                           │ │
│  │ ⏳ Planner            importing...                      │ │
│  │ ⬜ QA                 pending                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Autopilots ────────────────────────────────────────────┐ │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░  0/1 pending                  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ℹ️ Agent "ruby-pro" ref was not found. Skipped.             │
│    Run: multica-templates entity fetch skill/ruby-pro        │
└──────────────────────────────────────────────────────────────┘
```

### 10.4 Entity Browser

```
┌──────────────────────────────────────────────────────────────┐
│  🧩 Entity Browser                                          │
│                                                              │
│  Tabs: [All (12)] [Agents (4)] [Skills (6)] [Autopilots (2)]│
│                                                              │
│  ┌─ Filter ────────────────────────────────────────────────┐ │
│  │ 🔍 Search entities...    Source: [All ▼]  Status: [All ▼] │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────┐ ┌────────────────────┐              │
│  │ 🤖 Worker          │ │ 🤖 Assistant       │              │
│  │ agent · 3 versions │ │ agent · 1 version  │              │
│  │                    │ │                    │              │
│  │ latest: 2.0.1     │ │ latest: 3.0.0     │              │
│  │ skills: 6         │ │ skills: 12        │              │
│  │ source: local     │ │ source: remote    │              │
│  │ [View] [Install]   │ │ [View] [Fetch]    │              │
│  └────────────────────┘ └────────────────────┘              │
│                                                              │
│  ┌────────────────────┐ ┌────────────────────┐              │
│  │ 🛠 golang-testing  │ │ 🐍 python-pro      │              │
│  │ skill · 5 versions │ │ skill · 2 versions │              │
│  │ latest: 1.6.1     │ │ latest: 2.1.0     │              │
│  │ used by: 2 agents │ │ used by: 1 agent  │              │
│  │ [View] [Install]   │ │ [View] [Install]   │              │
│  └────────────────────┘ └────────────────────┘              │
│                                                              │
│  ┌────────────────────┐ ┌────────────────────┐              │
│  │ ⏰ Daily Sync      │ │ 📅 Weekly Review   │              │
│  │ autopilot · 1 ver  │ │ autopilot · 1 ver  │              │
│  │ agent: Planner     │ │ agent: Planner     │              │
│  │ triggers: 1        │ │ triggers: 1        │              │
│  │ [View]             │ │ [View]             │              │
│  └────────────────────┘ └────────────────────┘              │
│                                                              │
│  [+ Import Entity]  [Fetch from Remote]                     │
└──────────────────────────────────────────────────────────────┘
```

### 10.5 Entity Detail View

```
┌──────────────────────────────────────────────────────────────┐
│  ◀ Back to Entity Browser                                   │
│                                                              │
│  🤖 Worker  ──────────────────────────────────────────────── │
│  agent · v2.0.1 · local · sha256:abc123def                                  │
│                                                              │
│  Description: 开发+调研。全栈开发和技术调研                    │
│  Model: auto · Runtime: claude · Visibility: private        │
│  Max concurrent tasks: 6                                     │
│                                                              │
│  ┌─ Skills (6) ────────────────────────────────────────────┐ │
│  │ 🛠 golang-testing@^1.2.0  ──→ latest 1.6.1 [local]      │ │
│  │ 🐍 python-pro@^2.0.0      ──→ latest 2.1.0 [local]      │ │
│  │ 🔒 security-review@^1.0.0 ──→ latest 1.3.0 [local]      │ │
│  │ 📋 code-review@^1.5.0     ──→ latest 1.8.2 [remote]     │ │
│  │ 🐙 gh-cli@^1.0.0          ──→ latest 1.2.0 [local]      │ │
│  │ 🎨 frontend-design@^1.0.0 ──→ latest 1.4.1 [local]      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Env Template ───────────────────────────────────────────┐ │
│  │ ANTHROPIC_AUTH_TOKEN=${ANTHROPIC_AUTH_TOKEN}              │ │
│  │ ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}                  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Versions: 2.0.1 (latest) · 2.0.0 · 1.0.0                   │
│                                                              │
│  ┌─ Instructions (preview) ────────────────────────────────┐ │
│  │ # Multica Worker Agent                                  │ │
│  │ 你是multica的Worker...                                   │ │
│  │                                                         │ │
│  │ [Expand to full instructions (24,000 chars)]            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Install to Workspace ▼]  [Fork Entity]  [Delete]          │
└──────────────────────────────────────────────────────────────┘
```

### 10.6 Export Wizard v2

```
┌──────────────────────────────────────────────────────────────┐
│  Export Workspace Configuration                             │
│                                                              │
│  Step 1: Select Workspace                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Workspace: [Web3Gate ▼]                                 │ │
│  │ 4 agents · 15 skills · 2 autopilots · 3 projects       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Step 2: Export Mode                                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                        │ │
│  │  ● Mixed (recommended)                                 │ │
│  │    Keep inline: Assistant, Worker                       │ │
│  │    Extract as entity: Planner, QA                       │ │
│  │    Extract as entity: 15 skills                         │ │
│  │    Extract as entity: 2 autopilots                      │ │
│  │                                                        │ │
│  │  ○ Entity-reference only                               │ │
│  │    All agents/skills/autopilots → entities              │ │
│  │    Template: refs only (~50 lines)                     │ │
│  │                                                        │ │
│  │  ○ Inline only (v1 compatibility)                      │ │
│  │    All agents/skills/autopilots → inline               │ │
│  │    Template: monolithic (~28K lines)                   │ │
│  │                                                        │ │
│  │  ○ Custom                                              │ │
│  │    Choose per entity: inline vs extract                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Step 3: Customize (when Custom mode selected)               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Agents:                                                 │ │
│  │   Assistant:  ○ Inline  ● Extract as entity            │ │
│  │   Worker:     ○ Inline  ● Extract as entity            │ │
│  │   Planner:    ● Inline  ○ Extract as entity            │ │
│  │   QA:         ● Inline  ○ Extract as entity            │ │
│  │                                                        │ │
│  │ Skills:                                                 │ │
│  │   ☑ Extract all 15 skills as entities                   │ │
│  │   ☐ Include skill file contents (large but portable)   │ │
│  │                                                        │ │
│  │ Autopilots:                                             │ │
│  │   ☑ Extract all 2 autopilots as entities               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Step 4: Entity Versioning                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Auto-detect changes since last export:                 │ │
│  │                                                        │ │
│  │ agent/worker: last exported 2.0.0 → changes detected   │ │
│  │   Version bump: [2.0.1 ▼] (auto)                       │ │
│  │                                                        │ │
│  │ agent/planner: last exported 1.0.0 → no changes        │ │
│  │   Version: 1.0.0 (unchanged, will not re-export)      │ │
│  │                                                        │ │
│  │ skill/golang-testing: new entity (first export)        │ │
│  │   Version: [1.0.0 ▼]                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Sections to include:                                        │
│  ☑ Agents  ☑ Skills  ☑ Autopilots  ☐ Projects  ☐ Labels   │
│                                                              │
│  Template name: [Web3Gate-team___________]                   │
│                                                              │
│  [◀ Back]                         [Preview] [Export & Save]  │
└──────────────────────────────────────────────────────────────┘
```

### 10.7 Menu / Navigation Changes

```
Sidebar (or top nav):

  🏠 Templates        ← existing
  🧩 Entity Browser   ← NEW
  ⬇️  Import           ← existing
  ⬆️  Export           ← existing
  ⚙️  Settings         ← existing

App.tsx routes:
  /#/templates        → TemplatesView (with entity count badges)
  /#/entities         → EntityBrowser (NEW)
  /#/import           → ImportWizard (updated for v2)
  /#/export           → ExportForm (updated with mode selection)
  /#/settings         → SettingsView (add remote registry config)
```

### 10.8 Entity Browser: Skill Install Flow

```
User clicks [Install] on skill "golang-testing" in Entity Browser:

┌──────────────────────────────────────────────────────────────┐
│  Install Entity                                             │
│                                                              │
│  🛠 golang-testing@1.6.1                                    │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  This skill is not part of any agent's requirements.        │
│  Installing a standalone skill requires you to manually     │
│  assign it to agents after installation.                    │
│                                                              │
│  Target workspace: [Web3Gate ▼]                             │
│                                                              │
│  ☐ Also install dependencies (none)                        │
│                                                              │
│  Skills imported: 1                                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🟢 CREATE  golang-testing@1.6.1                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Cancel]                               [Install to Workspace] │
└──────────────────────────────────────────────────────────────┘
```

### 10.9 Entity Browser: Agent Install Flow (with transitive deps)

```
User clicks [Install] on agent "Worker" in Entity Browser:

┌──────────────────────────────────────────────────────────────┐
│  Install Entity                                             │
│                                                              │
│  🤖 Worker@2.0.1                                            │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  Target workspace: [Web3Gate ▼]                             │
│                                                              │
│  ℹ️ This agent requires 6 skills. They will be installed    │
│     automatically from your local registry.                  │
│                                                              │
│  Dependency tree (8 entities total):                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🟢 CREATE  agent/worker@2.0.1                           │ │
│  │   ├── 🟢 CREATE  skill/golang-testing@1.6.1             │ │
│  │   ├── 🟢 CREATE  skill/python-pro@2.1.0                 │ │
│  │   ├── 🟢 CREATE  skill/security-review@1.3.0            │ │
│  │   ├── 🟡 UPDATE  skill/code-review@1.8.2 (exists → 1.8.2)│ │
│  │   ├── ⚪ SKIP    skill/gh-cli (already at latest 1.2.0) │ │
│  │   └── 🟢 CREATE  skill/frontend-design@1.4.1            │ │
│  │ Runtime mapping: [Claude ▼]                             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Env variables needed:                                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ANTHROPIC_AUTH_TOKEN  [••••••••••••••••]  (from secrets) │ │
│  │ ANTHROPIC_BASE_URL    [https://api.anthropic.com▼]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ☑ Generate entity-lock.yaml                                │
│                                                              │
│  [Cancel]                               [Install All to Workspace] │
└──────────────────────────────────────────────────────────────┘
```

### 10.10 Template Detail View (when viewing a template before import)

```
┌──────────────────────────────────────────────────────────────┐
│  ◀ Back to Templates                                        │
│                                                              │
│  📦 Basic4Agent (v2.0 — mixed mode)                         │
│  Standard 4-agent development team                          │
│                                                              │
│  ┌─ Inline Entities ───────────────────────────────────────┐ │
│  │ Agent: Assistant  (deepseek-v4-pro, claude runtime)     │ │
│  │ Agent: Planner     (auto, claude runtime)                │ │
│  │                                                        │ │
│  │ [+ 2 inline agents]                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Entity References ─────────────────────────────────────┐ │
│  │ agent/qa@1.5.0           ── QA verification agent       │ │
│  │ autopilot/daily-sync@1.0 ── Daily scheduling            │ │
│  │ agent/worker@2.0.1       ── Full-stack dev agent        │ │
│  │                                                        │ │
│  │ [+ 1 entity ref]                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Projects ──────────────────────────────────────────────┐ │
│  │ Main Project (active)                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Labels ────────────────────────────────────────────────┐ │
│  │ 🔴 bug  🔵 feature                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Import to Workspace ▼]  [Export as YAML]  [Edit Template]  │
└──────────────────────────────────────────────────────────────┘
```

---

---

## 11. File Structure After Refactoring

```
src/
├── types/
│   ├── entity.ts                # NEW: Entity, EntityRef, EntityVersion, etc.
│   ├── template.ts              # MODIFIED: add TemplateV2, ImportOptionsV2
│   └── multica.ts               # Unchanged
├── services/
│   ├── entity-registry.ts       # NEW: local entity cache CRUD
│   ├── entity-validator.ts      # NEW: schema + cross-ref validation
│   ├── dependency-resolver.ts   # NEW: DAG resolution + semver solving
│   ├── remote-registry.ts       # NEW: git-based remote entity registry
│   ├── template-reader.ts       # MODIFIED: detect v1/v2, parse both
│   ├── template-writer.ts       # MODIFIED: write v2 manifests
│   ├── import-engine.ts         # MODIFIED: v2 resolution pipeline
│   ├── export-engine.ts         # MODIFIED: entity extraction
│   ├── workspace-scanner.ts     # Unchanged
│   ├── cli.ts                   # MODIFIED: add entity subcommands
│   ├── secret-store.ts          # Unchanged
│   └── server-store.ts          # Unchanged
├── routes/
│   └── api.ts                   # MODIFIED: entity + remote endpoints
├── components/
│   ├── EntityBrowser.tsx        # NEW
│   ├── DependencyTree.tsx       # NEW
│   ├── ImportWizard.tsx         # MODIFIED
│   ├── ExportForm.tsx           # MODIFIED
│   ├── SettingsView.tsx         # Unchanged
│   └── TemplatesView.tsx        # Unchanged
├── hooks/
│   └── useApi.ts               # MODIFIED: entity endpoints
├── main.ts                      # Unchanged
├── server.ts                    # Unchanged
├── main.tsx                     # Unchanged
├── App.tsx                      # MODIFIED: entity route
└── config.ts                    # Unchanged
```

---

## 12. Testing Strategy

### 11.1 Test Architecture Principles

| Principle | Description |
|---|---|
| **No real multica CLI in unit tests** | All CLI calls are mocked. Entity registry, resolver, import/export engines tested in isolation. |
| **Real YAML files on disk for integration** | Integration tests use actual YAML files in temp directories, real `EntityRegistry` against `fs`, real `yaml.parse`. |
| **Live multica CLI for E2E** | End-to-end tests spin up a real multica instance and run actual `multica agent create` etc. commands. |
| **Test fixtures as versioned YAML** | Entity test fixtures live in `tests/fixtures/entities/` — they are valid entities that double as documentation. |

### 11.2 Test File Organization

```
tests/
├── unit/
│   ├── entity-registry.test.ts         # EntityRegistry CRUD
│   ├── entity-validator.test.ts        # EntityValidator rules
│   ├── dependency-resolver.test.ts     # Resolution algorithm
│   ├── override-engine.test.ts         # Merge semantics
│   ├── template-reader.test.ts         # v1/v2/mixed parsing
│   ├── template-writer.test.ts         # v1/v2/mixed writing
│   └── import-engine.test.ts          # Import pipeline (mocked CLI)
├── integration/
│   ├── entity-import.test.ts           # Entity file → registry → workspace
│   ├── template-v1-import.test.ts      # v1 template → workspace (backward compat)
│   ├── template-v2-import.test.ts      # v2 template → workspace (entity refs)
│   ├── template-mixed-import.test.ts   # Mixed inline + ref import
│   ├── template-export.test.ts         # Workspace → template (all modes)
│   ├── merge-inline-wins.test.ts       # Inline beats entity ref on conflict
│   ├── skill-binding.test.ts           # Agent↔skill association
│   ├── rollback-on-failure.test.ts     # Atomic import — partial failure rollback
│   ├── version-upgrade.test.ts         # Entity version upgrade on re-import
│   └── lockfile.test.ts               # entity-lock.yaml generation + respect
├── e2e/
│   ├── full-import-export.test.ts      # Real multica: export → import → verify
│   ├── entity-lifecycle.test.ts        # Create → publish → pull → install → upgrade
│   └── cross-template-reuse.test.ts    # Two templates share same entity
└── fixtures/
    ├── entities/
    │   ├── skill-minimal-1.0.0.yaml
    │   ├── skill-golang-testing-1.2.0.yaml
    │   ├── agent-worker-2.0.1.yaml
    │   ├── agent-worker-broken.yaml    # intentionally invalid
    │   └── autopilot-daily-sync-1.0.0.yaml
    └── templates/
        ├── v1-basic.yaml               # v1 inline template
        ├── v2-pure-ref.yaml            # v2 entity ref only, no inline
        ├── v2-mixed.yaml               # v2 both inline + ref
        └── v2-conflict.yaml            # v2 inline + ref with name collision
```

### 11.3 Unit Test Catalog

#### 11.3.1 EntityValidator

```typescript
describe('EntityValidator', () => {
  describe('Schema validation', () => {
    test('valid skill entity passes all checks')
    test('valid agent entity passes all checks')
    test('valid autopilot entity passes all checks')

    test('rejects entity with missing required field (entity type discriminator)')
    test('rejects entity with missing name')
    test('rejects entity with missing version')
    test('rejects entity with invalid semver version (e.g., "latest")')
    test('rejects agent entity without instructions')
    test('rejects skill entity without files or content')
    test('rejects autopilot entity without agent_ref')

    test('rejects entity with unknown schema_version (major version mismatch)')
    test('accepts entity with compatible schema_version (v1.x)')
  })

  describe('Naming validation', () => {
    test('rejects entity name containing ".."')
    test('rejects entity name containing "/"')
    test('rejects entity name containing "\\"')
    test('rejects entity name starting with "."')
    test('rejects entity name longer than 64 chars')
    test('accepts valid kebab-case, snake_case, dot.separated names')
    test('accepts namespaced refs: multica/skill/golang-testing')
  })

  describe('Cross-reference validation', () => {
    test('agent refs valid skill → passes')
    test('agent refs non-existent skill → passes (resolved at import time, not validate time)')
    test('autopilot refs valid agent format → passes')
    test('circular: agent indirectly refs itself via extends → detected and rejected')

    test('skill file paths validated: rejects "../../../etc/passwd"')
    test('skill file paths validated: rejects absolute paths')
    test('skill file paths validated: accepts "SKILL.md", "advanced/guide.md"')
  })

  describe('Secret detection', () => {
    test('rejects entity with API key pattern in instructions')
    test('rejects entity with private key in instructions')
    test('rejects entity with high-entropy base64 in custom_env_template values')
    test('accepts entity with ${ENV_VAR} references (not secrets)')
    test('accepts entity with instructions (no secrets)')
  })

  describe('Hash computation', () => {
    test('same logical entity produces identical hash regardless of YAML formatting')
    test('different entities produce different hashes')
    test('key order in YAML does not affect hash (canonical sort)')
    test('hash is stable across save/load roundtrip')
  })
})
```

#### 11.3.2 EntityRegistry

```typescript
describe('EntityRegistry', () => {
  describe('save', () => {
    test('saves entity to correct path: {type}/{name}/{version}.yaml')
    test('updates .manifest.yaml with hash and imported_at')
    test('creates intermediate directories if needed')
    test('rejects saving entity with same version as existing (immutable)')
    test('rejects saving entity with path traversal in name')
  })

  describe('load', () => {
    test('loads entity by exact ref: agent/worker@2.0.1')
    test('loads entity by name (latest version returned)')
    test('throws for non-existent entity')
    test('verifies hash on load, throws on mismatch')
    test('loads entity after save roundtrip — data identical')
  })

  describe('list', () => {
    test('lists all entities across all types')
    test('filters by type: --type agent')
    test('filters by name substring: --filter go')
    test('empty registry returns empty list, not error')
  })

  describe('delete', () => {
    test('deletes entity file and removes from manifest')
    test('throws when deleting entity referenced by lockfile (protected)')
    test('deleting non-existent entity throws')
  })

  describe('resolve', () => {
    test('resolves exact version: agent/worker@2.0.1 → 2.0.1')
    test('resolves latest: agent/worker → highest version')
    test('throws when no version satisfies constraint')
    test('returns versions sorted by semver')
  })

  describe('Manifest reconciliation', () => {
    test('startup: file on disk not in manifest → flagged as "orphan"')
    test('startup: entry in manifest missing on disk → warned, removed from manifest')
    test('startup: clean manifest + matching files → no warnings')
  })
})
```

#### 11.3.3 DependencyResolver

```typescript
describe('DependencyResolver', () => {
  describe('Flattening', () => {
    test('single entity ref → single resolved entity')
    test('entity with no dependencies → only itself resolved')
    test('agent with 3 skill refs → agent + 3 skills resolved')
    test('autopilot with agent_ref → autopilot + agent + transitived skills')
    test('deep chain: autopilot → agent → skills → (no further deps)')
  })

  describe('Deduplication', () => {
    test('two agents ref same skill → skill imported once')
    test('two autopilots ref same agent → agent imported once')
    test('template explicitly includes skill that agent also refs → imported once')
    test('different version constraints on same entity → deduplicated to best version')
  })

  describe('Version solving', () => {
    test('exact version match: 2.0.1 → 2.0.1')
    test('multiple candidates → picks highest satisfying version')
    test('no satisfying version → resolution error with clear message')
    test('version constraint intersection: [^1.2, ^1.5] → 1.5+')
    test('incompatible constraints → resolution error, lists both constraints')
  })

  describe('Topological sort', () => {
    test('skills always ordered before agents that depend on them')
    test('agents always ordered before autopilots that depend on them')
    test('independent entities have no ordering constraints')
  })

  describe('Error handling', () => {
    test('entity refs non-existent entity → resolution error')
    test('entity file corrupted → resolution error with path')
    test('hash mismatch → resolution error showing expected vs actual')
    test('circular dependency → detected and rejected with cycle path')

    test('100+ transitive deps → resolves within 2 seconds')
    test('empty ref list → empty resolution, no error')
  })
})
```

#### 11.3.4 TemplateReader (v2 + mixed mode)

```typescript
describe('TemplateReader', () => {
  describe('v1 templates (backward compat)', () => {
    test('parses v1 template with inline agents')
    test('parses v1 template with inline skills')
    test('parses v1 template with inline autopilots')
    test('v1 template produces empty includes.entities')
  })

  describe('v2 pure-ref templates', () => {
    test('parses v2 template with entity refs only, no inline')
    test('extracts refs from includes.entities')
    test('extracts overrides from each entity ref')
    test('extracts hash pins when present')
  })

  describe('v2 mixed templates (inline + ref)', () => {
    test('parses template with 3 inline agents + 2 entity refs')
    test('parses template with inline skills + entity-ref skills')
    test('inline and ref sections are both populated in parsed result')
    test('projects and labels parsed correctly in mixed mode')
  })

  describe('v2 inline-only templates', () => {
    test('parses v2 template with only inline agents (no includes section)')
    test('identical semantic result to v1 parsing of same content')
  })

  describe('Error handling', () => {
    test('malformed YAML → parse error with line number')
    test('missing name field → validation error')
    test('entity ref without version → validation error')
    test('unknown fields in includes.entities → warning, not error')
  })
})
```

#### 11.3.5 Override Engine

```typescript
describe('OverrideEngine', () => {
  describe('Merge strategy', () => {
    test('no overrides → entity defaults used as-is')
    test('model override → overridden value takes effect')
    test('visibility override → overridden value takes effect')
    test('max_concurrent_tasks override → overridden value takes effect')
    test('description override → overridden value takes effect')
  })

  describe('Additive overrides', () => {
    test('skills: adding new skill → union of entity skills + override skills')
    test('skills_remove: removing specific skill → subtracted from union')
    test('skills_remove non-existent skill → no-op, warning')
    test('custom_env_template: adding new var → merged')
    test('custom_env_template: overriding existing var → override wins')
  })

  describe('Protected field rejection', () => {
    test('overriding name → rejected')
    test('overriding version → rejected')
    test('overriding instructions → rejected')
    test('overriding runtime_provider → rejected')
    test('overriding mcp_config → rejected')
    test('overriding custom_args → rejected')
    test('overriding entity discriminator → rejected')
    test('overriding schema_version → rejected')
  })

  describe('Deep vs shallow merge', () => {
    test('custom_env_template: shallow merge (template keys override entity keys)')
    test('skills: union merge (both sets combined)')
    test('mcp_config: shallow merge (template version wins for same key)')
  })
})
```

#### 11.3.6 ImportEngine

```typescript
describe('ImportEngine', () => {
  describe('v1 inline import', () => {
    test('imports inline agents from v1 template')
    test('imports inline skills from v1 template')
    test('imports inline autopilots from v1 template')
    test('dry run shows correct create/skip counts')
    test('skip-existing skips existing agents by name')
    test('force-overwrite updates existing agents')
  })

  describe('v2 entity-ref import', () => {
    test('resolves and imports entity-ref agents')
    test('resolves transitive skill dependencies')
    test('dry run shows dependency tree')
    test('entity not in registry → pull from remote or error')
  })

  describe('v2 mixed import (inline + ref)', () => {
    test('imports both inline and ref agents together')
    test('inline agent with same name as entity ref → inline wins, ref skipped')
    test('inline skill with same name as entity ref skill → inline wins')
    test('dry run shows both inline and ref items')
  })

  describe('Atomic import / rollback', () => {
    test('all steps succeed → all entities created, no rollback')
    test('step 3 of 5 fails → steps 1-2 rolled back')
    test('rollback leaves workspace in pre-import state')
    test('skill creation fails → no orphaned skills left behind')
  })

  describe('Lockfile', () => {
    test('first import generates entity-lock.yaml')
    test('subsequent import with same template respects lockfile versions')
    test('entity upgrade updates lockfile entry')
    test('lockfile hash mismatch → warning, user prompted')
  })
})
```

### 11.4 Integration Test Catalog

#### 11.4.1 Entity Import

```typescript
describe('Entity import integration', () => {
  test(
    'import skill entity from YAML file → stored in local registry →'
    + ' imported to workspace via CLI → skill appears in workspace'
  );

  test(
    'import agent entity with 3 skill refs → all skills resolved →'
    + ' agent created with correct skill bindings in workspace'
  );

  test(
    'import autopilot entity → agent auto-imported →'
    + ' agent skills auto-imported → autopilot created with resolved agent ID'
  );

  test(
    'import entity with hash pin → hash verified → import succeeds'
  );

  test(
    'import entity with wrong hash pin → hash mismatch error → import blocked'
  );
});
```

#### 11.4.2 Template v1 Import (Backward Compat)

```typescript
describe('v1 template backward compat', () => {
  test(
    'import existing v1 basic4agent.yaml → agents/skills/autopilots created correctly →'
    + ' result identical to importing with v0.0.1 tool'
  );

  test(
    'v1 template with only agents (no skills section) → agents imported, no errors'
  );

  test(
    'v1 template dry-run → shows correct create/skip for all entity types'
  );

  test(
    're-import v1 template with force-overwrite → agents updated in place'
  );
});
```

#### 11.4.3 Template v2 Import (Entity Refs)

```typescript
describe('v2 template import', () => {
  test(
    'template with 4 entity-ref agents → all resolved from registry →'
    + ' all created in workspace with correct skill bindings'
  );

  test(
    'template with entity-ref agents referencing skills →'
    + ' skills auto-imported transitively → agent-skill bindings correct'
  );

  test(
    'dry-run shows dependency tree: agents at top, skills indented below'
  );

  test(
    'entity ref points to non-existent version → resolution error →'
    + ' dry-run shows error before apply'
  );
});
```

#### 11.4.4 Mixed Mode Import (Inline + Ref)

```typescript
describe('Mixed mode import', () => {
  test(
    'template with 3 inline agents + 2 entity-ref agents →'
    + ' all 5 created in workspace'
  );

  test(
    'inline agent "Worker" + entity ref "agent/worker@2.0.1" →'
    + ' inline Wins → entity ref skipped with warning → inline Worker imported'
  );

  test(
    'inline skill "golang-testing" + entity ref "skill/golang-testing@1.2.0" →'
    + ' inline wins → entity ref skill skipped'
  );

  test(
    'template with entity ref only, no inline → import succeeds →'
    + ' same result as pure-ref import'
  );
});
```

#### 11.4.5 Export Integration

```typescript
describe('Export integration', () => {
  test(
    'export workspace with 2 agents → inline mode → valid v1 template produced'
  );

  test(
    'export workspace → reference mode → entities saved to registry →'
    + ' template contains refs only'
  );

  test(
    'export workspace → mixed mode → entities saved to registry →'
    + ' template contains both inline (as-is) and refs'
  );

  test(
    're-export same workspace with reference mode →'
    + ' version auto-bumped if content changed'
  );

  test(
    'export with include_transitive → template manifest includes'
    + ' all transitive skill refs'
  );
});
```

#### 11.4.6 Merge & Conflict Resolution

```typescript
describe('Merge and conflict resolution', () => {
  test(
    'merge: inline agents [A, B] + entity refs [B, C] → final set: [A, B_inline, C]'
  );

  test(
    'merge: inline skills [X] + entity ref skill [X] → inline X wins, warning emitted'
  );

  test(
    'merge: no overlap → both sets imported independently'
  );

  test(
    'merge: empty inline + 3 refs → only refs imported'
  );

  test(
    'merge: 3 inline + empty refs → only inline imported (v1 behavior)'
  );
});
```

#### 11.4.7 Rollback on Failure

```typescript
describe('Atomic import rollback', () => {
  test(
    '3rd agent creation fails → first 2 agents deleted →'
    + ' first 2 skills (already created) deleted → workspace unchanged'
  );

  test(
    'skill binding fails after agent created → agent deleted → skills kept (safe)'
  );

  test(
    'autopilot creation fails after agent imported → autopilot not created →'
    + ' agent kept (autopilots are leaf nodes, safe to leave agent)'
  );
});
```

#### 11.4.8 Lockfile

```typescript
describe('Lockfile integration', () => {
  test(
    'first import → entity-lock.yaml created with exact versions + hashes'
  );

  test(
    'second import same template → lockfile consulted → same versions used'
  );

  test(
    'entity upgrade agent/worker → lockfile entry updated →'
    + ' workspace agent updated to new version'
  );

  test(
    'manual lockfile edit (tamper) → hash mismatch on next import → error with details'
  );

  test(
    'import with --no-lockfile → lockfile ignored → resolves latest versions'
  );
});
```

### 11.5 End-to-End Test Catalog

```typescript
describe('E2E: Full import-export cycle', () => {
  test(
    'create workspace with 2 agents + 2 skills → export as v2 reference template →'
    + ' import into fresh workspace → verify all agents/skills match'
  );

  test(
    'export as v1 inline template → import into fresh workspace →'
    + ' verify backward compat: all agents/skills identical to source'
  );

  test(
    'export as v2 mixed template (1 inline agent + 2 entity refs) →'
    + ' import into fresh workspace → all 3 agents present →'
    + ' inline agent matches source, ref agents resolved from registry'
  );
});

describe('E2E: Entity lifecycle', () => {
  test(
    'create Agent entity YAML → validate → save to registry →'
    + ' install into workspace → verify agent exists →'
    + ' create new version → upgrade workspace agent'
  );

  test(
    'import agent from workspace → extract as entity →'
    + ' validate entity → publish to remote registry →'
    + ' pull from different machine → install → verify identical'
  );
});

describe('E2E: Cross-template reuse', () => {
  test(
    'Template A exports Worker agent as entity v1.0.0 →'
    + ' Template B references agent/worker@1.0.0 →'
    + ' import Template B into fresh workspace →'
    + ' Worker agent matches Template A export'
  );

  test(
    'Update Worker entity to v1.1.0 →'
    + ' re-import Template B → lockfile prevents auto-upgrade →'
    + ' explicit entity upgrade → Worker updated to v1.1.0'
  );
});
```

### 11.6 Edge Case Matrix (for QA)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Template with 0 agents, 0 skills, 0 autopilots (only projects/labels) | Import succeeds, no entity resolution needed |
| 2 | Agent entity with empty skills map `{}` | Imported with no skill bindings |
| 3 | Agent entity references skill not in registry | Resolution error with "pull from remote?" suggestion |
| 4 | Two autopilots in template ref the same agent entity | Agent imported once, both autopilots created |
| 5 | Entity YAML file is syntactically valid but not an entity (wrong schema) | Validation error with specific field violations |
| 6 | Entity file on disk is 0 bytes (truncated) | Parse error with clear message |
| 7 | Entity references 100+ transitive skills | Resolved within 2s; progress streaming works |
| 8 | Concurrent imports to the same workspace from two sessions | Workspace scanner snapshots state at start; second import wins name collisions |
| 9 | Lockfile references entity version no longer in registry | Warning: "Entity X@Y.Z is locked but not found. Use --upgrade to resolve." |
| 10 | Template with `includes.entities` that's an empty array | Import succeeds, only inline entities processed |
| 11 | Inline agent has same name as multiple entity ref agents (duplicate) | First ref skipped, duplicate ref also skipped |
| 12 | override tries to set `skills_remove: [skill-not-present]` | Warning emitted, import continues |
| 13 | Import with `--no-lockfile` flag | Lockfile not generated; always resolves latest |
| 14 | Entity name with Unicode characters | Validated per allowlist; likely rejected unless explicitly allowed |
| 15 | Uninstall/reinstall multica-templates tool | Entities survive in `~/.multica/entities/`; templates in `~/.multica/templates/` |

### 11.7 Test Execution Strategy

```bash
# Unit tests (fast, no external deps, run on every change)
npm run test:unit              # vitest --testPathPattern='tests/unit'

# Integration tests (real filesystem, mocked multica CLI, run pre-commit)
npm run test:integration       # vitest --testPathPattern='tests/integration'

# E2E tests (real multica CLI, run in CI and pre-push)
npm run test:e2e               # vitest --testPathPattern='tests/e2e'

# All tests
npm test                       # runs unit → integration → e2e in sequence
```

**Coverage targets**:
| Layer | Coverage Target |
|-------|----------------|
| Unit tests | ≥ 85% line coverage |
| Integration tests | Cover all major user flows (11.4 catalog) |
| E2E tests | Cover critical paths (import, export, entity lifecycle) |

---

## 13. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking change for existing users | High | High | Backward compat mode; `migrate` command; deprecation notice for v1 |
| Semver solving complexity | Medium | Medium | Use `semver` npm package; limit to `^` and `~` ranges initially |
| Entity proliferation (too many versions) | Medium | Low | `entity prune` command to remove unused versions |
| Remote registry availability | Low | Medium | Local cache is always available; graceful fallback |
| import time explosion with deep deps | Low | Medium | BFS resolution; parallel entity loading; progress streaming |
| User confusion: "what got imported?" | Medium | Medium | Dependency tree visualization in UI; dry-run always runs first |

---

## 14. Success Metrics

| Metric | Current (v0.0.1) | Target (v1.0.0) |
|---|---|---|
| Template file size | 28,000 lines | < 200 lines |
| Time to update a skill across 5 templates | Re-export 5 times (~10 min) | Update one entity file (30 sec) |
| New user: "I want just Worker agent" | Import whole template, delete extras | `entity pull agent/worker` (1 command) |
| Cross-template consistency | Manual (copy-paste) | Automatic (same entity, same version) |
| Import dry run detail | "X will be created/skipped" | Full dependency tree with versions |

---

## 15. Timeline Estimate

| Phase | Effort | Cumulative |
|---|---|---|
| Phase 1: Entity Schema & Registry | 3-5 days | Week 1 |
| Phase 2: Dependency Resolution | 3-4 days | Week 2 |
| Phase 3: Template v2 Import | 4-5 days | Week 3 |
| Phase 4: Template v2 Export | 3-4 days | Week 4 |
| Phase 5: Remote Registry | 3-5 days | Week 5 |
| Phase 6: UI Updates | 4-5 days | Week 6-7 |
| Phase 7: Migration + Docs | 3-4 days | Week 8 |

**Total**: ~4-5 weeks of focused development.

---

## 16. Multi-Perspective Review & Resolution

This plan was reviewed from 4 independent perspectives: **Architecture**, **Security**, **Implementation Feasibility**, and **UX/Product Design**. Full review reports are available; this section synthesizes the critical findings and resolutions.

### 15.1 Critical Findings — Resolved

| # | Finding | Source | Resolution | Phase |
|---|---------|--------|------------|-------|
| C1 | **No workspace lockfile** — importing same template at different times can produce different resolved dependency trees | Arch, UX | Add `entity-lock.yaml` per workspace that pins exact `{type}/{name}@{version}#{hash}` for all resolved entities. Subsequent imports respect the lockfile. `entity upgrade` updates it. | Phase 3 |
| C2 | **`entity upgrade` command not designed** — the most common post-import operation (update a skill to new version) has no implementation coverage | UX | Define `entity upgrade <ref> --workspace <id>` in Phase 3. It updates the entity in registry, applies changes to workspace, and updates the lockfile. | Phase 3 |
| C3 | **Entity name path traversal** — `../../../etc/cron.d/evil` used in file paths escapes `~/.multica/entities/` | Security | Validate entity names against `^[a-z0-9][a-z0-9._-]{0,63}[a-z0-9]$`. Reject names containing `..`, `/`, `\`. Validate skill file paths likewise. | Phase 1 |
| C4 | **Safe YAML parsing** — `yaml.load()` can execute arbitrary code via `!!js/function` tags | Security | Mandate safe parsing: TypeScript uses `yaml.parse()` or `js-yaml.load({ schema: JSON_SCHEMA })`. Document as non-negotiable implementation constraint. | Phase 1 |
| C5 | **Transitive dependencies imported without user confirmation** — drive-by dependency attack vector | Security | Show full dependency tree (with versions + sources) before importing. Require explicit confirmation for transitive dependencies. `--yes` flag for CI scenarios. | Phase 3 |
| C6 | **Dependency confusion via flat namespace + multiple remotes** — attacker publishes high-version entity in community registry that shadows official | Security | Ship with namespaced entity names from day one: `{namespace}/{type}/{name}` (e.g., `multica/skill/golang-testing`). Each remote is pinned to a namespace. Template references include namespace. | Phase 1 |
| C7 | **Entity immutability decided** — was an open question (Q1) | Arch | **RESOLVED**: Published entity versions are immutable. Like npm, published versions cannot change. Create a new patch version instead. Enforced by: (a) local cache files set to read-only after import, (b) hash verification on every load, (c) signature verification on remote pulls. | Phase 1 |
| C8 | **Agent instructions unsanitized** — malicious entity can inject prompt injection payloads into `instructions` fields | Security | Display instructions/skill content for review before first-time import from untrusted sources. Add optional `--review` mode that opens content in `$EDITOR`. Implement automated scanning for known dangerous patterns. | Phase 3 |
| C9 | **No git tag signature verification** — `git show <tag>:entity.yaml` trusts mutable git tags | Security | Require GPG-signed tags for all entity versions. CLI verifies signatures on pull (`git tag -v`). Reject unsigned or unknown-signer tags. Document signing key fingerprint in `.remotes.yaml`. | Phase 5 |

### 15.2 High-Priority Findings — Resolved

| # | Finding | Source | Resolution | Phase |
|---|---------|--------|------------|-------|
| H1 | **Migration tool ships too late** — Phase 7 is 5 weeks after v2 import, leaving existing v1 users stranded | UX, Impl | Move migration to Phase 4 (alongside v2 export). Reduce scope: single-template conversion only (1 v1 template → 1 v2 manifest + N entity files). Multi-template deduplication deferred to v1.1. | Phase 4 |
| H2 | **Cache vs workspace lifecycle confusing** — `entity import` means 3 different things (cache-only, workspace-only, combined) | UX | Use distinct verbs: `entity fetch` (cache-only), `entity install --workspace <id>` (workspace), `entity install --fetch --workspace <id>` (combined). Cache becomes transparent implementation detail for most workflows. | Phase 2 |
| H3 | **No transaction/rollback during import** — partial import failure leaves orphaned entities | Arch | Implement atomic import: dry-run first, then execute all mutations in a transaction. If any step fails, rollback all changes. Workspace scanner snapshots state at start for rollback. | Phase 3 |
| H4 | **No mechanism to remove a skill from an agent via overrides** — template authors who want a slimmed-down agent must fork the entire entity | Arch, UX | Add `skills_remove: [skill-name]` override key. Setting a skill to `null` in the skills map means "exclude this skill." | Phase 4 |
| H5 | **Deep merge semantics unspecified** — `custom_env_template` merge could be shallow or deep, both are needed | Arch | Define explicit merge rules per field type: `skills` → union of entity + template, minus `skills_remove`; `custom_env_template` → shallow merge (template keys override entity keys); `mcp_config` → shallow merge. Document in override spec. | Phase 4 |
| H6 | **Override protection list incomplete** — `runtime_provider`, `mcp_config`, `custom_args` not protected from override | Security | Define override ALLOWLIST model: only `model`, `visibility`, `max_concurrent_tasks`, `skills` (additive), `custom_env_template` (additive), `description` can be overridden. All other fields are identity-protected. Reject overrides targeting any other field. | Phase 3 |
| H7 | **No secret scanning in entity validation** — agent instructions could accidentally contain API keys | Security | Add secret detection pass to `EntityValidator`: scan for high-entropy strings, known API key patterns, private key headers. Reject entity publish if secrets detected. | Phase 1 |
| H8 | **Entity schema evolution unaddressed** — no migration strategy for entity `schema_version` changes | Arch | Define additive-only evolution for schema v1.x: v1.1 can add optional fields, never remove or rename. Major schema changes → bump to v2.0 with explicit migration. `EntityReader` accepts all v1.x schemas. Unknown major version → graceful error with "upgrade tool" message. | Phase 1 |
| H9 | **Manifest-filesystem synchronization gap** — `.manifest.yaml` and filesystem can diverge | Arch | `.manifest.yaml` is authoritative. On startup, filesystem is reconciled against manifest. Files on disk not in manifest → flagged and skipped. Files in manifest missing on disk → re-fetch or warn. | Phase 1 |
| H10 | **No canonicalization for hash computation** — same logical entity can produce different hashes | Arch | Define canonical serialization: parse YAML → sort keys recursively → emit with 2-space indent, no quoting unless necessary → SHA256. Hash is computed on the canonical representation. | Phase 1 |

### 15.3 Medium-Priority Notes (addressed, not blocking)

| # | Finding | Resolution |
|---|---------|------------|
| M1 | `skip_missing` silently creates broken agent state | Gate behind `--force` flag. Emit prominent warning when skills are skipped. |
| M2 | Semver range greediness — high version from low-priority remote wins | Prefer locally cached versions. When pulling, resolve within highest-trust remote first. |
| M3 | `inline` entities create dual mental model in v2 | **REVERSED**: v2 is a superset. Inline definitions ARE the v1 format and remain first-class. The template v2 schema supports both inline and entity refs side-by-side. No forced migration. Users never lose the ability to inline. |
| M4 | Dependency tree visualization arrives late (Phase 6) | Add `import dry-run --tree` text output in Phase 3. Graphical tree in Phase 6. |
| M5 | No `entity edit` or entity iteration workflow | Add `entity fork <ref> --bump <major|minor|patch>` in Phase 2. |
| M6 | `runtime_mapping` forces template-wide only | Allow per-entity `runtime_mapping` override within each entity ref in includes. |
| M7 | Simpler resolver would suffice for v1.0 — DAG is overengineered for depth-3 tree | Keep DAG interface but implement simpler two-pass resolver internally. Upgrade to full DAG when `extends` is added. |
| M8 | No entity deprecation/revocation mechanism | Add `deprecated: true` + `deprecation_message` to entity manifest. CLI warns on deprecated entity use. Full revocation list in remote registry index. Phase 5. |
| M9 | No `min_engine_version` field | Add `min_engine_version` to both entity and template manifests. Parser validates before processing. |
| M10 | `version` and `schema_version` redundant on templates | Merge: `schema_version` alone controls parsing behavior. `version` removed from v2 format. Template identity is `name`. |
| M11 | Template manifest lacks metadata | Add `metadata:` block mirroring entity metadata pattern. |

### 15.4 Updated Open Questions

After review resolution, remaining open questions:

1. **Skill files vs skill reference** (unchanged from original Q2): Should templates reference skills by name only? **Resolution**: Reference-only at template level. If skill doesn't exist locally, pull from remote or fail with helpful message.

2. **Autopilot as entity** (unchanged from original Q3): Are autopilots independent entities? **Resolution**: Entity-fy them but defer to Phase 5 (alongside remote registry). Agents and Skills are the v1.0 MVP entities. Autopilots become entities in v1.1 when the entity model is proven.

3. **Skill versioning independence** (unchanged from original Q5): If skill `golang-testing@1.3.0` adds a file, do agents referencing `^1.0.0` get it? **Resolution**: Yes, MINOR bumps are compatible. Agents get new files automatically on upgrade.

4. **Entity inheritance/composition** (unchanged from original Q6): Should agents support `extends`? **Resolution**: Not in v1.0. Revisit if user demand exists.

### 15.5 Revised Timeline

| Phase | Original | Revised | Delta | Reason |
|-------|----------|---------|-------|--------|
| Phase 1: Entity Schema & Registry | 3-5 days | 5-7 days | +2 | Added: namespace from day one, safe YAML, secret scanning, schema evolution, canonical hash, manifest reconciliation |
| Phase 2: Dependency Resolution | 3-4 days | 5-6 days | +2 | Added: lockfile generation, entity fork command, two-pass resolver, fetch/install verb redesign |
| Phase 3: Template v2 Import | 4-5 days | 6-7 days | +2 | Added: atomic import with rollback, instruction review gate, `--tree` output, override allowlist enforcement |
| Phase 4: Template v2 Export + Migration | 3-4 days | 6-7 days | +3 | Added: migration tool (moved from Phase 7), skills_remove, deep merge, per-entity runtime_mapping |
| Phase 5: Remote Registry | 3-5 days | 5-7 days | +2 | Added: GPG signature verification, deprecation mechanism, entity revocation list |
| Phase 6: UI Updates | 4-5 days | 6-8 days | +2-3 | Added: granular entity selection, dependency tree, import review screen |
| Phase 7: Documentation + Release | *was Phase 7* | 3-4 days | — | Reduced: migration moved to Phase 4 |
| **Total** | **23-32 days** | **36-46 days** | **+13 days** | ~7-9 weeks for solo developer, ~5-7 weeks with 2 developers |

### 15.6 Deferred to v1.1

| Feature | Reason |
|---------|--------|
| Semver range matching (`^` and `~`) | Exact `@version` matching ships in v1.0 to simplify resolver |
| Autopilot entity-fication | Agent + Skill entity model proves the pattern first |
| Multi-template dedup migration | Ship single-template migration first |
| Entity inheritance (`extends`) | Adds significant complexity; wait for user demand |
| Remote HTTP registry transport | Git transport is sufficient for v1.0; revisit when multi-tenant needed |

---

## Appendix A: Entity File Examples

### A.1 Complete Skill Entity

```yaml
# ~/.multica/entities/skill/golang-testing/1.2.0.yaml
entity: skill
schema_version: "1.0"
name: golang-testing
version: 1.2.0
description: Go testing patterns — table-driven tests, testify, gomock, test fixtures
config:
  requires_framework: testify
files:
  - path: SKILL.md
    content: |-
      # Go Testing
      ... (full content)
  - path: advanced/table-driven.md
    content: |-
      # Table-Driven Tests
      ... (full content)
metadata:
  author: multica
  tags: [go, testing, quality]
  changelog: |
    1.2.0: Added test fixture patterns
    1.1.0: Added testify mock patterns
    1.0.0: Initial release
```

### A.2 Complete Agent Entity

```yaml
# ~/.multica/entities/agent/worker/2.0.1.yaml
entity: agent
schema_version: "1.0"
name: worker
version: 2.0.1
description: 开发+调研。全栈开发和技术调研
instructions: |-
  # Multica Worker Agent
  ... (full instructions, same as current inline content)
model: auto
runtime_provider: claude
visibility: private
max_concurrent_tasks: 6
custom_env_template:
  ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN}
  ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
skills:
  golang-testing: ^1.2.0
  python-pro: ^2.0.0
  security-review: ^1.0.0
  code-review-quality: ^1.5.0
  gh-cli: ^1.0.0
  # ... more
metadata:
  tags: [development, fullstack, worker]
  changelog: |
    2.0.1: Fixed PR format instructions
    2.0.0: Upgraded to new workflow — added deployment verification
    1.0.0: Initial worker agent
```

### A.3 Complete Autopilot Entity

```yaml
# ~/.multica/entities/autopilot/daily-sync/1.0.0.yaml
entity: autopilot
schema_version: "1.0"
name: daily-sync
version: 1.0.0
title: Daily Issue Sync
description: Daily issue scheduling — assigns backlog issues to available workers
mode: run_only
agent_ref: planner@^1.0.0
triggers:
  - cron: "57 8 * * 1-5"
    timezone: Asia/Shanghai
    label: weekday-morning
metadata:
  tags: [scheduling, daily, automation]
```

### A.4 Complete Template v2 Manifest

```yaml
version: "2.0"
schema_version: "2.0"
name: Basic4Agent
description: Standard 4-agent development team (Assistant, Worker, Planner, QA)
includes:
  entities:
    - ref: agent/assistant@^3.0.0
      overrides:
        model: deepseek-v4-pro
    - ref: agent/worker@^2.0.0
    - ref: agent/planner@^1.0.0
    - ref: agent/qa@^1.5.0
    - ref: autopilot/daily-sync@^1.0.0
    - ref: autopilot/weekly-review@^1.0.0
projects:
  - title: Main Project
    description: Default project for development tasks
    status: active
labels:
  - name: bug
    color: "#ef4444"
  - name: feature
    color: "#3b82f6"
runtime_mapping:
  claude: { display_name: "Claude" }
  cursor: { display_name: "Cursor" }
  codex: { display_name: "Codex" }
```

---

## Appendix B: Comparison — Before vs After

### Import a team config on a fresh workspace

**Before (v1)**:
```bash
# 1. Export from source workspace (produces 28K-line YAML)
multica-templates export --workspace abc123 --name my-team

# 2. Transfer file to target machine
scp ~/.multica-templates/my-team.yaml target:~/.multica-templates/

# 3. Import entire template
# UI: select workspace → select template → map runtimes → import
```

**After (v2)**:
```bash
# Option A: Import entire team from template manifest
multica-templates import apply my-team --workspace xyz789

# Option B: Import just the Worker agent with its skills
multica-templates entity pull agent/worker@^2.0           # fetch from remote
multica-templates entity import agent/worker@2.0.1 --workspace xyz789  # import to workspace

# Option C: Install directly from remote
multica-templates entity import --remote github:myorg/entities agent/worker@^2.0 --workspace xyz789
```

### Update a skill across all workspaces

**Before (v1)**:
```bash
# 1. Fix skill content in source workspace
# 2. Re-export all affected templates
# 3. Re-import all templates on all target workspaces
# 4. Pray nothing else changed
```

**After (v2)**:
```bash
# 1. Update entity file
multica-templates entity publish skill/golang-testing --bump patch

# 2. On target workspaces (or auto via cron):
multica-templates entity pull skill/golang-testing
multica-templates entity upgrade skill/golang-testing --workspace xyz789
```

---

## Appendix C: CLI Command Reference (Planned)

```bash
# Entity management
multica-templates entity list [--type agent|skill|autopilot] [--filter <text>]
multica-templates entity show <ref>              # e.g., agent/worker@2.0.1
multica-templates entity import <file>           # import from YAML file
multica-templates entity validate <file>         # validate entity YAML
multica-templates entity export --workspace <id> agent/worker  # export from workspace
multica-templates entity delete <ref>
multica-templates entity prune [--type agent]    # remove unused versions

# Remote operations
multica-templates entity pull <ref> [--remote <name>]
multica-templates entity publish <file> [--remote <name>]
multica-templates entity search <query> [--remote <name>]

# Remote management
multica-templates remote list
multica-templates remote add <name> <url> [--type git|http]
multica-templates remote remove <name>

# Template operations (enhanced)
multica-templates import apply <template> --workspace <id> [--entities agent/worker,skill/go-testing]
multica-templates export apply --workspace <id> --name <name> [--mode inline|reference|split]

# Migration
multica-templates migrate <template-file> [--dry-run]
```
