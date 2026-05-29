# Multica Workspace Templates — Entity Componentization Refactoring Plan

> **Version**: v0.3.0-reviewed  
> **Status**: Reviewed (4-perspective) — ready for implementation  
> **Author**: Ivan Zhang & Claude  
> **Last Updated**: 2026-05-29

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

### 1.3 The Goal

Transform the template system from **monolithic snapshots** into a **composable entity architecture**:

```
Before:   Template = [Agents + Skills + Autopilots + Projects + Labels]  (one big YAML)
After:    Template = Entity References + Overrides                         (5KB manifest)
          Entity   = [Agent | Skill | Autopilot]                          (independently versioned)
```

**Entities are the product. Templates are just recipes.**

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

### 3.1 New Template Schema (v2.0)

```yaml
# Template = composition manifest, NOT monolithic blob
version: "2.0"
schema_version: "2.0"
name: Basic4Agent
description: Basic 4-agent team with full development capabilities

# Include section: entity references
includes:
  entities:
    - ref: agent/assistant@^3.0.0
      hash: sha256:abc123...        # optional, for integrity pinning
      overrides:                      # optional, template-level overrides
        model: deepseek-v4-pro        # override model for this template
    - ref: agent/worker@^2.0.0
      overrides:
        max_concurrent_tasks: 8
    - ref: agent/planner@^1.0.0
    - ref: agent/qa@^1.5.0
    - ref: autopilot/daily-sync@^1.0.0
    - ref: autopilot/weekly-review@^1.0.0

  # Inline-only entities (no reusable value, or quick prototyping)
  inline:
    skills: []                       # skills defined inline (rare — prefer entity refs)
    agents: []                       # agents defined inline
    autopilots: []

# Workspace-scoped objects (not entities — mutable state)
projects:
  - title: My Project
    description: ...
    status: in_progress
    resources:
      - resource_type: github_repo
        resource_ref: { url: "https://github.com/user/repo" }

labels:
  - name: bug
    color: "#ef4444"

runtime_mapping:
  claude: { display_name: "Claude" }
  cursor: { display_name: "Cursor" }
  codex: { display_name: "Codex" }
```

### 3.2 Template Size Reduction

| Template | v1.1 (monolithic) | v2.0 (reference-based) | Reduction |
|---|---|---|---|
| basic4agent | ~28,000 lines / 900KB | ~50-100 lines / 5KB | **~99.8%** |
| CI/CD dev template | ~15,000 lines | ~40 lines / 3KB | **~99.7%** |

### 3.3 Override Semantics

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

### 3.4 Override Merge Strategy

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

## 8. Backward Compatibility

### 8.1 Reading v1 Templates

The `TemplateReader` must detect template version:

```typescript
function readTemplate(name: string): Template | TemplateV2 {
  const raw = parseYaml(content);

  if (raw.version?.startsWith('2.')) {
    return parseV2(raw);     // new entity-reference format
  }
  return parseV1(raw);       // legacy monolithic format
}
```

### 8.2 Importing v1 Templates

v1 templates are treated as **all-inline** v2 templates:

```
v1 template → internally converted to v2 with everything in `includes.inline`
            → import proceeds normally
```

### 8.3 Exporting for v1 Consumers

The `ExportEngine` can still produce v1 templates via `mode: 'inline'`:

```bash
multica-templates export --mode inline   # produces v1-compatible monolithic YAML
multica-templates export --mode reference # produces v2 manifest + entities
multica-templates export --mode split     # produces v2 manifest + entity files
```

### 8.4 Migration Path

```
Week 1-2:   Implement v2 schema + entity registry (v0.2.0)
Week 3:     Implement v2 import (v0.3.0)
Week 4:     Implement v2 export (v0.4.0)
Week 5:     Migration tool: convert v1 templates to v2 (v0.5.0)
Week 6:     Entity publish/pull from remote (v0.6.0)
Week 7-8:   UI updates + testing + docs (v1.0.0)
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

### Phase 6: UI — Granular Import & Entity Browser (v0.7.0)

**Goal**: Users can browse entities, pick individual ones to import, see dependency trees.

**Tasks**:
1. Entity Browser component (`src/components/EntityBrowser.tsx`):
   - List local entities by type
   - Show entity detail (version, description, dependencies)
   - Dependency tree visualization
2. Import Wizard v2:
   - Template selection → dependency tree preview → granular entity checkboxes
   - Show "these skills will be pulled" with version info
   - Conflict resolution UI (two incompatible versions → user chooses)
3. Export Wizard v2:
   - Mode selection: inline / reference / split
   - Entity version bump preview
   - Entity publication checkbox
4. **Deliverable**: Full UI for v2 import/export with entity management

**Files changed**:
- `src/components/EntityBrowser.tsx` (new)
- `src/components/ImportWizard.tsx` (refactor)
- `src/components/ExportForm.tsx` (refactor)
- `src/hooks/useApi.ts` (entity endpoints)
- `src/App.tsx` (entity browser route)

### Phase 7: Migration Tool + Documentation (v0.8.0 → v1.0.0)

**Goal**: Smooth upgrade path and comprehensive docs.

**Tasks**:
1. `multica-templates migrate` command:
   - Convert v1 monolithic YAML → v2 manifest + entity files
   - Entity deduplication: detect duplicate agents/skills across templates
   - Dry-run mode: preview what will be extracted
2. Breaking change documentation
3. Video walkthrough / blog post
4. Release v1.0.0
5. **Deliverable**: Existing v1 users can migrate in one command

---

## 10. File Structure After Refactoring

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

## 11. Testing Strategy

### 11.1 Unit Tests

| Module | Test Cases |
|---|---|
| `EntityValidator` | Valid entity passes; missing required field fails; invalid semver fails; circular dependency detected; cross-entity ref validation |
| `EntityRegistry` | Save/load roundtrip; version listing; hash computation; delete; concurrent writes |
| `DependencyResolver` | Flat dependency; deep transitive chain; shared dependency deduplication; version conflict detection; semver range intersection; topological sort correctness; circular dependency rejection; missing entity error |
| `TemplateReader` (v2) | Parse v2 manifest; parse v1 (backward compat); parse mixed inline+ref; malformed template error |
| `OverrideEngine` | Simple override; deep merge; protected field rejection; env var overlay |

### 11.2 Integration Tests

| Scenario | Steps |
|---|---|
| Full v2 import | Create entities → create template → import → verify workspace state |
| Partial entity import | Import just `agent/worker` → verify its skills auto-imported |
| v1 backward compat | Import existing v1 template → works exactly as before |
| Version upgrade | Import v1 agent → re-import with v2 (force-overwrite) → agent updated |
| Conflict resolution | Create two agents with incompatible version constraints → verify resolution error |
| Remote pull | Push entity to remote → pull from another machine → verify identical |

### 11.3 Edge Cases

| Edge Case | Expected Behavior |
|---|---|
| Empty skills list on agent | No skill resolution needed, import succeeds |
| Agent refs non-existent skill | Resolution error with clear message |
| Two autopilots ref same agent | Agent imported once, both autopilots created |
| Circular: agent indirectly refs itself | Detected and rejected during validation |
| Template with 0 entities (only projects/labels) | Valid template, import projects/labels only |
| Entity file corrupted (invalid YAML) | Skip with warning, continue importing others |
| Concurrent imports to same workspace | Workspace scanner snapshots state at start; second import wins for name collisions |
| Hash mismatch on pinned entity | Block import, ask user to trust or re-fetch |
| Entity with 100+ transitive deps | Performance: must resolve within 2 seconds |
| Uninstall/reinstall of multica-templates | Registry persisted in `~/.multica/entities/`, survives npm uninstall |

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking change for existing users | High | High | Backward compat mode; `migrate` command; deprecation notice for v1 |
| Semver solving complexity | Medium | Medium | Use `semver` npm package; limit to `^` and `~` ranges initially |
| Entity proliferation (too many versions) | Medium | Low | `entity prune` command to remove unused versions |
| Remote registry availability | Low | Medium | Local cache is always available; graceful fallback |
| import time explosion with deep deps | Low | Medium | BFS resolution; parallel entity loading; progress streaming |
| User confusion: "what got imported?" | Medium | Medium | Dependency tree visualization in UI; dry-run always runs first |

---

## 13. Success Metrics

| Metric | Current (v0.0.1) | Target (v1.0.0) |
|---|---|---|
| Template file size | 28,000 lines | < 200 lines |
| Time to update a skill across 5 templates | Re-export 5 times (~10 min) | Update one entity file (30 sec) |
| New user: "I want just Worker agent" | Import whole template, delete extras | `entity pull agent/worker` (1 command) |
| Cross-template consistency | Manual (copy-paste) | Automatic (same entity, same version) |
| Import dry run detail | "X will be created/skipped" | Full dependency tree with versions |

---

## 14. Timeline Estimate

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

## 15. Multi-Perspective Review & Resolution

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
| M3 | `inline` entities create dual mental model in v2 | Removed from v2.0. Prototyping uses v1 format. Migration path is v1 → v2. |
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
