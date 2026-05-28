# Multica Workspace Templates

Import and export Multica workspace configurations as portable YAML templates. Switch between multiple Multica server instances, manage per-server secrets, and replicate agent teams across workspaces with one click.

## Quick Start

```bash
npx multica-workspace-templates
# Opens http://localhost:8422
```

Or clone and run locally:

```bash
git clone https://github.com/ivanzzeth/multica-workspace-templates.git
cd multica-workspace-templates
npm install
npm run dev
```

**Prerequisites**: `multica` CLI installed and authenticated (`multica login`).

## Features

- **Multi-Server** — Connect to multiple Multica instances, switch from header dropdown
- **Export with filters** — Checkbox which sections to export (projects/labels default off)
- **Project resources** — GitHub repos and linked resources included in exports
- **Streaming import** — Real-time progress bars for each phase
- **Secrets** — Global + per-server secrets with fallback chain. One-click save during import
- **Hash routing** — `/#templates` (default), `/#import`, `/#export`, `/#settings`

## Architecture

```
Browser (SPA)
  ↓ fetch /api/*
Express server (port 8422)
  ↓ spawn/subprocess or HTTP
multica CLI / Multica API
```

### Storage

| Path | Contents |
|------|----------|
| `~/.multica/config.json` | Active server connection |
| `~/.multica/servers.json` | All server profiles + per-server secrets |
| `~/.multica/secrets.json` | Global secrets shared across all servers |
| `~/.multica-templates/` | User-exported templates (overrides built-in on name collision) |
| `./templates/` | Built-in templates tracked in git |

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces` | List workspaces on current server |
| GET | `/api/templates` | List all templates (built-in + user) |
| GET | `/api/templates/:name` | Get template detail |
| POST | `/api/import/dry-run` | Preview import changes |
| POST | `/api/import/apply` | Apply import (streaming NDJSON progress) |
| POST | `/api/export/preview` | Preview workspace export |
| POST | `/api/export/apply` | Export workspace to YAML file |
| GET/POST/DELETE | `/api/servers` | Server profile CRUD |
| POST | `/api/servers/:id/switch` | Switch active server |
| GET/POST/DELETE | `/api/secrets` | Global secrets CRUD (`?server=<id>` for per-server) |
| POST | `/api/secrets/resolve` | Resolve env vars (server → global → placeholder) |
| POST | `/api/secrets/save-to-server` | Bulk save env vars to server secrets |

## Template Format

```yaml
version: "1.0"
name: MyTemplate
description: Exported from Multica workspace
agents:
  - name: Worker
    description: ...
    instructions: ...
    model: claude-sonnet-4-6
    runtime_provider: claude
    custom_env_template:
      ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN}
    skills: [skill-a, skill-b]
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
autopilots:
  - title: Daily Sync
    description: ...
    agent_ref: Worker
    mode: run_only
    triggers:
      - cron: "0 9 * * 1-5"
        timezone: Asia/Shanghai
```

## Development

```bash
npm run dev          # Start dev server with HMR
npm run build        # Production build
npm run typecheck    # TypeScript check
npm start            # Production start
```

## License

MIT
