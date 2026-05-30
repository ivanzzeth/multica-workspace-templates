#!/usr/bin/env node
import 'tsx/esm';

const args = process.argv.slice(2);
const cmd = args[0];

const help = `
multica-templates — Multica workspace template manager

Usage:
  multica-templates start [--dev] [--electron]     Start the web UI server

  Entity management (offline — local registry):
    entity list [--type <t>] [--q <text>]
    entity show <type/name@version>
    entity validate <file>
    entity import <file>
    entity delete <type/name@version>
    entity extract --template <name> --agents <a,b> [--skills <s,b>] [--autopilots <a,b>]
    entity fork <type/name@version> --bump <major|minor|patch>

  Template management:
    template list
    template show <name>
    template validate <file>

  Import / Export (requires multica CLI):
    import preview <template> --workspace <id> [--mode skip|overwrite]
    import apply <template> --workspace <id> --runtime <provider=id,...> [--mode skip|overwrite] [--env KEY=val,...]
    export preview --workspace <id> [--mode inline|reference|mixed]
    export apply --workspace <id> --name <name> [--mode inline|reference|mixed]

  Secret management:
    secret list [--server <id>]
    secret set <key> <value> [--server <id>]
    secret delete <key> [--server <id>]

  Workspace & Server:
    workspace list
    runtime list --workspace <id>
    server list
    server add <name> <url> <token>
    server delete <id>
    server switch <id>

  Help:
    help

Examples:
  multica-templates start --dev
  multica-templates entity list --type agent
  multica-templates entity show agent/Worker@1.0.0
  multica-templates entity extract --template Basic4Agent --agents Assistant,Worker
  multica-templates entity fork agent/Worker@1.0.0 --bump minor
  multica-templates template show Basic4Agent
  multica-templates import preview Basic4Agent --workspace ws-123
  multica-templates export apply --workspace ws-123 --name my-team --mode reference
  multica-templates secret list
  multica-templates secret set ANTHROPIC_AUTH_TOKEN sk-ant-xxx
  multica-templates workspace list
`.trim();

async function main() {
  if (!cmd || cmd === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(help);
    process.exit(0);
  }

  if (cmd === 'start') { await startServer(); return; }
  if (cmd === 'entity') { await entityCommand(args.slice(1)); return; }
  if (cmd === 'template') { await templateCommand(args.slice(1)); return; }
  if (cmd === 'import') { await importCommand(args.slice(1)); return; }
  if (cmd === 'export') { await exportCommand(args.slice(1)); return; }
  if (cmd === 'secret' || cmd === 'secrets') { await secretCommand(args.slice(1)); return; }
  if (cmd === 'workspace' || cmd === 'ws') { await workspaceCommand(args.slice(1)); return; }
  if (cmd === 'runtime') { await runtimeCommand(args.slice(1)); return; }
  if (cmd === 'server' || cmd === 'servers') { await serverCommand(args.slice(1)); return; }

  console.log(`Unknown command: ${cmd}`);
  console.log(help);
  process.exit(1);
}

/* ═══════════════════════════ Start Server ═══════════════════════════ */

async function startServer() {
  const { startServer } = await import('../src/server.js');
  const PORT = parseInt(process.env.PORT || '8422', 10);
  const HOST = process.env.HOST || '0.0.0.0';
  const isDev = args.includes('--dev');
  const isElectron = args.includes('--electron');

  const { port } = await startServer(PORT, isDev, HOST);

  if (isElectron) {
    const { createWindow } = await import('../src/electron/app.js');
    createWindow(port, isDev);
  } else {
    console.log(`\n  🌐  Open http://localhost:${port} in your browser`);
    console.log(`  🖥️  Or run with --electron for desktop mode`);
    console.log(`  📂  User templates: ~/.multica-templates/\n`);
    try { const { default: open } = await import('open'); open(`http://localhost:${port}`); } catch {}
  }
}

/* ═══════════════════════════ Entity Commands ═══════════════════════════ */

async function entityCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { EntityRegistry } = await import('../src/services/entity-registry.js');
  const { EntityValidator } = await import('../src/services/entity-validator.js');
  const registry = new EntityRegistry();
  const validator = new EntityValidator();

  switch (sub) {
    case 'list': {
      const type = flags.type || flags.t;
      const q = flags.q || flags.filter;
      const entities = registry.list(type ? { type } : undefined);
      const filtered = q ? entities.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())) : entities;
      if (filtered.length === 0) { console.log('No entities found.'); break; }
      console.log(`${filtered.length} entit${filtered.length === 1 ? 'y' : 'ies'}:\n`);
      for (const e of filtered) {
        const icon = e.type === 'agent' ? '🤖' : e.type === 'skill' ? '🛠️' : '⏰';
        console.log(`  ${icon} ${e.ref.padEnd(35)} ${e.description || ''}`);
        if (e.deps_info) console.log(`     ${e.deps_info}`);
      }
      break;
    }
    case 'show': {
      const refStr = rest[0];
      if (!refStr) { console.log('Usage: entity show <type/name@version>'); process.exit(1); }
      try { console.log(JSON.stringify(registry.load(refStr), null, 2)); } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'validate': {
      const file = rest[0];
      if (!file) { console.log('Usage: entity validate <file>'); process.exit(1); }
      const result = validator.validateFile(file);
      if (result.valid) { console.log(`✅ Valid ${result.entity_type} entity`); break; }
      console.log('❌ Invalid entity:');
      for (const issue of result.issues) console.log(`  ${issue.severity === 'error' ? '🔴' : '🟡'} [${issue.field || '-'}] ${issue.message}`);
      process.exit(1);
      break;
    }
    case 'import': {
      const file = rest[0];
      if (!file) { console.log('Usage: entity import <file>'); process.exit(1); }
      const r = validator.validateFile(file);
      if (!r.valid) { console.log('❌ Validation failed:'); r.issues.forEach((i) => console.log(`  🔴 [${i.field || '-'}] ${i.message}`)); process.exit(1); }
      const { readFileSync } = await import('fs');
      const { parse: parseYaml } = await import('yaml');
      const entity = parseYaml(readFileSync(file, 'utf-8'));
      if (!entity.namespace) entity.namespace = 'multica';
      try {
        const entry = registry.save(entity);
        console.log(`✅ Imported: ${entry.ref}\n   Path: ${entry.path}\n   Hash: ${entry.hash}\n   Size: ${(entry.size / 1024).toFixed(1)}KB`);
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'delete': {
      const refStr = rest[0];
      if (!refStr) { console.log('Usage: entity delete <type/name@version>'); process.exit(1); }
      try { registry.delete(refStr); console.log(`✅ Deleted: ${refStr}`); } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'extract': {
      const templateName = flags.template || flags.t;
      const agentList = flags.agents || flags.a || '';
      const skillList = flags.skills || flags.s || '';
      const apList = flags.autopilots || flags.ap || '';
      if (!templateName) { console.log('Usage: entity extract --template <name> --agents <name1,name2> [--skills <...>]'); process.exit(1); }
      const agents = agentList.split(',').map((s) => s.trim()).filter(Boolean);
      const skills = skillList.split(',').map((s) => s.trim()).filter(Boolean);
      const autopilots = apList.split(',').map((s) => s.trim()).filter(Boolean);
      if (agents.length === 0 && skills.length === 0 && autopilots.length === 0) { console.log('Specify at least one entity to extract'); process.exit(1); }
      const { TemplateReader } = await import('../src/services/template-reader.js');
      const reader = new TemplateReader();
      try {
        const template = reader.readTemplate(templateName);
        const tv = template.skills || [];
        const extracted = [];
        const seenSkill = {};
        function extractSkill(sn) {
          if (seenSkill[sn]) return;
          if (registry.exists(`skill/${sn}@1.0.0`)) { seenSkill[sn] = true; return; }
          const sk = tv.find((s) => s.name === sn);
          if (!sk) return;
          try { registry.save({ entity: 'skill', schema_version: '1.0', name: sk.name, version: '1.0.0', description: sk.description, config: sk.config, files: sk.files?.map((f) => ({ path: f.path, content: f.content })) }); extracted.push(`skill/${sn}@1.0.0`); } catch {}
          seenSkill[sn] = true;
        }
        for (const n of agents) {
          const a = template.agents.find((x) => x.name === n);
          if (!a) { console.error(`Agent "${n}" not found`); process.exit(1); }
          if (a.skills?.length) a.skills.forEach(extractSkill);
          registry.save({ entity: 'agent', schema_version: '1.0', name: a.name, version: '1.0.0', description: a.description, instructions: a.instructions, model: a.model, runtime_provider: a.runtime_provider, visibility: a.visibility || 'private', skills: a.skills?.length ? Object.fromEntries(a.skills.map((s) => [s, '^1.0.0'])) : undefined, custom_env_template: a.custom_env_template });
          extracted.push(`agent/${n}@1.0.0`);
        }
        for (const n of skills) extractSkill(n);
        for (const n of autopilots) {
          const ap = template.autopilots.find((x) => x.title === n);
          if (!ap) { console.error(`Autopilot "${n}" not found`); process.exit(1); }
          const ag = template.agents.find((x) => x.name === ap.agent_ref);
          if (ag && !extracted.some((r) => r.startsWith(`agent/${ag.name}@`))) {
            if (ag.skills?.length) ag.skills.forEach(extractSkill);
            registry.save({ entity: 'agent', schema_version: '1.0', name: ag.name, version: '1.0.0', description: ag.description, instructions: ag.instructions, model: ag.model, runtime_provider: ag.runtime_provider, visibility: ag.visibility || 'private', skills: ag.skills?.length ? Object.fromEntries(ag.skills.map((s) => [s, '^1.0.0'])) : undefined });
            extracted.push(`agent/${ag.name}@1.0.0`);
          }
          registry.save({ entity: 'autopilot', schema_version: '1.0', name: ap.title.toLowerCase().replace(/\s+/g, '-'), version: '1.0.0', title: ap.title, description: ap.description, mode: ap.mode, agent_ref: `agent/${ap.agent_ref}@^1.0.0`, triggers: ap.triggers });
          extracted.push(`autopilot/${ap.title}@1.0.0`);
        }
        console.log(`✅ Extracted ${extracted.length} entit${extracted.length === 1 ? 'y' : 'ies'}:`);
        for (const ref of extracted) console.log(`   ${ref}`);
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'fork': {
      const refStr = rest[0];
      const bump = flags.bump || flags.b || 'patch';
      if (!refStr) { console.log('Usage: entity fork <type/name@version> [--bump patch|minor|major]'); process.exit(1); }
      try { const entry = registry.fork(refStr, bump); console.log(`✅ Forked: ${entry.ref}`); } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    default:
      console.log(`Unknown entity command: ${sub || '(none)'}`);
      console.log('Available: list, show, validate, import, delete, extract, fork');
      process.exit(1);
  }
}

/* ═══════════════════════════ Template Commands ═══════════════════════════ */

async function templateCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const { TemplateReader } = await import('../src/services/template-reader.js');
  const reader = new TemplateReader();

  switch (sub) {
    case 'list': {
      const templates = reader.listTemplates();
      if (templates.length === 0) { console.log('No templates found.'); break; }
      console.log(`${templates.length} template${templates.length === 1 ? '' : 's'}:\n`);
      for (const t of templates) {
        const modeStr = t.mode ? ` [${t.mode}]` : '';
        const refStr = t.entity_ref_count ? ` +${t.entity_ref_count} entity refs` : '';
        console.log(`  📦 ${t.name} v${t.version}${modeStr}  ${t.agent_count} agents${refStr}`);
      }
      break;
    }
    case 'show': {
      const name = rest[0];
      if (!name) { console.log('Usage: template show <name>'); process.exit(1); }
      try {
        const t = reader.readTemplate(name);
        console.log(JSON.stringify({
          name: t.name, schema_version: t.schema_version, description: t.description,
          inline_agents: t.agents.map((a) => a.name),
          inline_skills: (t.skills || []).map((s) => s.name),
          inline_autopilots: t.autopilots.map((a) => a.title),
          entity_refs: (t.includes?.entities || []).map((e) => e.ref),
          projects: t.projects.length, labels: t.labels.length,
        }, null, 2));
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'validate': {
      const file = rest[0];
      if (!file) { console.log('Usage: template validate <file>'); process.exit(1); }
      try {
        const { readFileSync } = await import('fs');
        const { parse: parseYaml } = await import('yaml');
        const raw = parseYaml(readFileSync(file, 'utf-8'));
        reader.readTemplate(raw.name);
        console.log(`✅ Valid template: ${raw.name}`);
      } catch (e) { console.error(`❌ Invalid template: ${e.message}`); process.exit(1); }
      break;
    }
    default:
      console.log(`Unknown template command: ${sub || '(none)'}`);
      console.log('Available: list, show, validate');
      process.exit(1);
  }
}

/* ═══════════════════════════ Import Commands ═══════════════════════════ */

async function importCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { TemplateReader } = await import('../src/services/template-reader.js');
  const { WorkspaceScanner } = await import('../src/services/workspace-scanner.js');
  const { ImportEngine } = await import('../src/services/import-engine.js');
  const { EntityRegistry } = await import('../src/services/entity-registry.js');

  const reader = new TemplateReader();
  const scanner = new WorkspaceScanner();
  const registry = new EntityRegistry();
  const importer = new ImportEngine(reader, scanner, registry);

  const workspaceId = flags.workspace || flags.w;
  if (!workspaceId) { console.log('Usage: import <preview|apply> <template> --workspace <id>'); process.exit(1); }

  const templateName = rest[0];
  if (!templateName) { console.log('Usage: import <preview|apply> <template> --workspace <id>'); process.exit(1); }

  const importMode = (flags.mode || flags.m || 'skip-existing') === 'overwrite' ? 'force-overwrite' : 'skip-existing';

  // Parse runtime map: --runtime claude=rt-123,cursor=rt-456
  const runtimeMap = [];
  if (flags.runtime || flags.r) {
    const pairs = (flags.runtime || flags.r).split(',');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx >= 0) runtimeMap.push({ agent_name: '*', runtime_provider: pair.slice(0, eqIdx), runtime_id: pair.slice(eqIdx + 1), runtime_name: pair.slice(0, eqIdx) });
    }
  }

  // Parse env vars: --env KEY=val,KEY2=val2
  const envVars = {};
  if (flags.env || flags.e) {
    const pairs = (flags.env || flags.e).split(',');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx >= 0) envVars[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
    }
  }

  switch (sub) {
    case 'preview':
    case 'dry-run': {
      try {
        const result = await importer.dryRun({ template_name: templateName, workspace_id: workspaceId, runtime_map: runtimeMap, mode: importMode, env_vars: envVars });
        console.log(`\nImport preview for "${templateName}" → workspace ${workspaceId}:\n`);
        for (const section of ['agents', 'skills', 'autopilots', 'projects', 'labels']) {
          const items = result[section];
          if (!items?.length) continue;
          console.log(`  ${section}:`);
          for (const item of items) {
            const act = item.action === 'create' ? '🟢' : item.action === 'update' ? '🟡' : '⚪';
            console.log(`    ${act} ${item.action.padEnd(6)} ${item.name}${item.reason ? `  (${item.reason})` : ''}`);
          }
        }
        console.log('');
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    case 'apply': {
      try {
        console.log(`Importing "${templateName}" → workspace ${workspaceId}...`);
        const result = await importer.apply({ template_name: templateName, workspace_id: workspaceId, runtime_map: runtimeMap, mode: importMode, env_vars: envVars });
        if (!result.success) { console.log('❌ Import failed'); if (result.errors.length) result.errors.forEach((e) => console.log(`  🔴 ${e}`)); process.exit(1); }
        if (result.errors.length) { for (const e of result.errors) console.log(`  🟡 ${e}`); }
        console.log(`\n✅ Imported: ${result.created.agents} agents, ${result.created.skills} skills, ${result.created.autopilots} autopilots, ${result.created.projects} projects, ${result.created.labels} labels`);
        if (result.updated.agents) console.log(`   Updated: ${result.updated.agents} agents`);
        if (result.skipped.agents) console.log(`   Skipped: ${result.skipped.agents} existing agents`);
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    default:
      console.log(`Usage: import preview|apply <template> --workspace <id> [--mode skip|overwrite] [--runtime provider=id,...]`);
      process.exit(1);
  }
}

/* ═══════════════════════════ Export Commands ═══════════════════════════ */

async function exportCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { TemplateReader } = await import('../src/services/template-reader.js');
  const { TemplateWriter } = await import('../src/services/template-writer.js');
  const { WorkspaceScanner } = await import('../src/services/workspace-scanner.js');
  const { ExportEngine } = await import('../src/services/export-engine.js');
  const { EntityRegistry } = await import('../src/services/entity-registry.js');

  const reader = new TemplateReader();
  const writer = new TemplateWriter();
  const scanner = new WorkspaceScanner();
  const registry = new EntityRegistry();
  const exporter = new ExportEngine(scanner, writer, reader, undefined, registry);

  const workspaceId = flags.workspace || flags.w;
  if (!workspaceId) { console.log('Usage: export <preview|apply> --workspace <id>'); process.exit(1); }

  const mode = flags.mode || flags.m || 'mixed';
  const name = rest[0] || flags.name || flags.n;

  if (sub === 'preview') {
    try {
      const result = await exporter.preview(workspaceId, { mode, agents: true, autopilots: true, skills: true, labels: false, projects: false });
      console.log(`\nExport preview for workspace ${workspaceId} (${mode} mode):\n`);
      console.log(`  Name: ${result.name}`);
      if (result.agents.length) console.log(`  Inline agents: ${result.agents.map((a) => a.name).join(', ')}`);
      if (result.includes?.entities?.length) console.log(`  Entity refs: ${result.includes.entities.length}`);
      console.log(`  Skills: ${result.skills?.length || 0} (inline), ${result.includes?.entities?.filter((e) => e.ref.startsWith('skill/')).length || 0} (refs)`);
      console.log(`  Autopilots: ${result.autopilots.length} (inline), ${result.includes?.entities?.filter((e) => e.ref.startsWith('autopilot/')).length || 0} (refs)`);
      console.log(`  Projects: ${result.projects.length}`);
      console.log(`  Labels: ${result.labels.length}`);
    } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
  } else if (sub === 'apply') {
    if (!name) { console.log('Usage: export apply --workspace <id> --name <name> [--mode inline|reference|mixed]'); process.exit(1); }
    try {
      const result = await exporter.apply(workspaceId, name, { mode, agents: true, autopilots: true, skills: true, labels: false, projects: false });
      console.log(`✅ Exported: ${result.saved_to}`);
      console.log(`   Version: ${result.version}`);
      console.log(`   Mode: ${result.mode || mode}`);
      if (result.entities_saved > 0) console.log(`   Entities saved to registry: ${result.entities_saved}`);
    } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
  } else {
    console.log('Usage: export preview|apply --workspace <id> --name <name> [--mode inline|reference|mixed]');
    process.exit(1);
  }
}

/* ═══════════════════════════ Secret Commands ═══════════════════════════ */

async function secretCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { ServerStore } = await import('../src/services/server-store.js');
  const { SecretStore } = await import('../src/services/secret-store.js');
  const servers = new ServerStore();
  servers.seed();
  const secrets = new SecretStore(servers);

  const serverId = flags.server || flags.s;

  switch (sub) {
    case 'list': {
      if (serverId) {
        const all = secrets.effectiveSecrets(serverId);
        const srv = secrets.listServer(serverId);
        const glb = secrets.listGlobal();
        console.log(`Secrets for server ${serverId}:\n`);
        for (const [k, v] of Object.entries(all)) {
          const origin = k in srv ? '(server)' : '(global)';
          const val = v.startsWith('${') ? v : '***';
          console.log(`  ${k}=${val} ${origin}`);
        }
      } else {
        const glb = secrets.listGlobal();
        console.log(`Global secrets:\n`);
        if (Object.keys(glb).length === 0) { console.log('  No global secrets.'); break; }
        for (const [k, v] of Object.entries(glb)) {
          const val = v.startsWith('${') ? v : '***';
          console.log(`  ${k}=${val}`);
        }
      }
      break;
    }
    case 'set': {
      const key = rest[0];
      const value = rest[1];
      if (!key || value === undefined) { console.log('Usage: secret set <key> <value> [--server <id>]'); process.exit(1); }
      if (serverId) {
        secrets.setServer(serverId, key, value);
        console.log(`✅ Set ${key} for server ${serverId}`);
      } else {
        secrets.setGlobal(key, value);
        console.log(`✅ Set ${key} (global)`);
      }
      break;
    }
    case 'delete':
    case 'unset': {
      const key = rest[0];
      if (!key) { console.log('Usage: secret delete <key> [--server <id>]'); process.exit(1); }
      const ok = serverId ? secrets.deleteServer(serverId, key) : secrets.deleteGlobal(key);
      if (ok) console.log(`✅ Deleted ${key}`); else console.error(`❌ Key "${key}" not found`);
      break;
    }
    default:
      console.log('Usage: secret list|set|delete [--server <id>]');
      process.exit(1);
  }
}

/* ═══════════════════════════ Workspace Commands ═══════════════════════════ */

async function workspaceCommand(subArgs) {
  const sub = subArgs[0] || 'list';

  const cli = await import('../src/services/cli.js');

  switch (sub) {
    case 'list': {
      try {
        const workspaces = await cli.listWorkspaces();
        if (workspaces.length === 0) { console.log('No workspaces found.'); break; }
        console.log(`${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}:\n`);
        for (const ws of workspaces) console.log(`  ${ws.id.padEnd(40)} ${ws.name}`);
      } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
      break;
    }
    default:
      console.log('Usage: workspace list');
      process.exit(1);
  }
}

/* ═══════════════════════════ Runtime Commands ═══════════════════════════ */

async function runtimeCommand(subArgs) {
  const flags = parseFlags(subArgs);
  const workspaceId = flags.workspace || flags.w;

  if (!workspaceId) { console.log('Usage: runtime list --workspace <id>'); process.exit(1); }

  const cli = await import('../src/services/cli.js');

  try {
    const runtimes = await cli.listRuntimes(workspaceId);
    if (runtimes.length === 0) { console.log('No runtimes found.'); return; }
    console.log(`${runtimes.length} runtime${runtimes.length === 1 ? '' : 's'}:\n`);
    for (const r of runtimes) console.log(`  ${r.id.padEnd(40)} ${r.name} (${r.provider}) — ${r.status}`);
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}

/* ═══════════════════════════ Server Commands ═══════════════════════════ */

async function serverCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { ServerStore } = await import('../src/services/server-store.js');
  const servers = new ServerStore();
  servers.seed();

  switch (sub) {
    case 'list': {
      const all = servers.list();
      const current = servers.getCurrent();
      console.log(`${all.length} server${all.length === 1 ? '' : 's'}:\n`);
      for (const s of all) {
        const marker = s.id === current?.id ? ' ← current' : '';
        console.log(`  ${s.id.padEnd(8)} ${(s.name || 'unnamed').padEnd(20)} ${s.server_url}${marker}`);
      }
      break;
    }
    case 'add': {
      const name = rest[0];
      const url = rest[1];
      const token = rest[2];
      if (!url || !token) { console.log('Usage: server add <name> <url> <token> [--workspace <id>]'); process.exit(1); }
      const profile = servers.add({ name, server_url: url, token, workspace_id: flags.workspace || flags.w });
      console.log(`✅ Added server: ${profile.id} — ${name}`);
      break;
    }
    case 'delete':
    case 'remove': {
      const id = rest[0];
      if (!id) { console.log('Usage: server delete <id>'); process.exit(1); }
      const ok = servers.remove(id);
      if (ok) console.log(`✅ Deleted server ${id}`); else console.error(`❌ Server "${id}" not found`);
      break;
    }
    case 'switch':
    case 'use': {
      const id = rest[0];
      if (!id) { console.log('Usage: server switch <id>'); process.exit(1); }
      const profile = servers.switchTo(id);
      if (profile) console.log(`✅ Switched to server ${profile.name} (${profile.server_url})`); else console.error(`❌ Server "${id}" not found`);
      break;
    }
    default:
      console.log('Usage: server list|add|delete|switch');
      process.exit(1);
  }
}

/* ═══════════════════════════ Flags Parser ═══════════════════════════ */

function parseFlags(argsArr) {
  const flags = {};
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx >= 0) { flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1); }
      else if (i + 1 < argsArr.length && !argsArr[i + 1].startsWith('--')) { flags[key] = argsArr[++i]; }
      else { flags[key] = 'true'; }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = i + 1 < argsArr.length ? argsArr[++i] : 'true';
    }
  }
  return flags;
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
