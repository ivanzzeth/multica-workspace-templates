#!/usr/bin/env node
import 'tsx/esm';

const args = process.argv.slice(2);
const cmd = args[0];

const help = `
multica-templates — Multica workspace template manager

Usage:
  multica-templates start [--dev] [--electron]     Start the web UI server
  multica-templates entity list [--type <t>] [--q <text>]
  multica-templates entity show <type/name@version>
  multica-templates entity validate <file>
  multica-templates entity import <file>
  multica-templates entity delete <type/name@version>
  multica-templates entity extract --template <name> --agents <a,b> [--skills <s,b>] [--autopilots <a,b>]
  multica-templates entity fork <type/name@version> --bump <major|minor|patch>
  multica-templates template list
  multica-templates template show <name>
  multica-templates template validate <file>
  multica-templates help

Examples:
  multica-templates start --dev
  multica-templates entity list --type agent
  multica-templates entity show agent/Worker@1.0.0
  multica-templates entity extract --template Basic4Agent --agents Assistant,Worker
  multica-templates entity fork agent/Worker@1.0.0 --bump minor
  multica-templates template show Basic4Agent
`.trim();

async function main() {
  if (!cmd || cmd === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(help);
    process.exit(0);
  }

  if (cmd === 'start') {
    await startServer();
    return;
  }

  if (cmd === 'entity') {
    await entityCommand(args.slice(1));
    return;
  }

  if (cmd === 'template') {
    await templateCommand(args.slice(1));
    return;
  }

  console.log(`Unknown command: ${cmd}`);
  console.log(help);
  process.exit(1);
}

// ── Start Server ──

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

    try {
      const { default: open } = await import('open');
      open(`http://localhost:${port}`);
    } catch {}
  }
}

// ── Entity Commands ──

async function entityCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);
  const flags = parseFlags(rest);

  const { EntityRegistry } = await import('../src/services/entity-registry.js');
  const { EntityValidator } = await import('../src/services/entity-validator.js');
  const { parseEntityRef, serializeEntityRef } = await import('../src/types/entity.js');

  const registry = new EntityRegistry();
  const validator = new EntityValidator();

  switch (sub) {
    case 'list': {
      const type = flags.type || flags.t;
      const q = flags.q || flags.filter;
      const entities = registry.list(type ? { type } : undefined);
      const filtered = q
        ? entities.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()))
        : entities;

      if (filtered.length === 0) {
        console.log('No entities found.');
      } else {
        console.log(`${filtered.length} entit${filtered.length === 1 ? 'y' : 'ies'}:\n`);
        for (const e of filtered) {
          const icon = e.type === 'agent' ? '🤖' : e.type === 'skill' ? '🛠️' : '⏰';
          console.log(`  ${icon} ${e.ref.padEnd(35)} ${e.description || ''}`);
          if (e.deps_info) console.log(`     ${e.deps_info}`);
        }
      }
      break;
    }

    case 'show': {
      const refStr = rest[0];
      if (!refStr) { console.log('Usage: entity show <type/name@version>'); process.exit(1); }
      try {
        const entity = registry.load(refStr);
        console.log(JSON.stringify(entity, null, 2));
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'validate': {
      const file = rest[0];
      if (!file) { console.log('Usage: entity validate <file>'); process.exit(1); }
      const result = validator.validateFile(file);
      if (result.valid) {
        console.log(`✅ Valid ${result.entity_type} entity`);
      } else {
        console.log('❌ Invalid entity:');
        for (const issue of result.issues) {
          const emoji = issue.severity === 'error' ? '🔴' : '🟡';
          console.log(`  ${emoji} [${issue.field || '-'}] ${issue.message}`);
        }
        process.exit(1);
      }
      break;
    }

    case 'import': {
      const file = rest[0];
      if (!file) { console.log('Usage: entity import <file>'); process.exit(1); }

      const result = validator.validateFile(file);
      if (!result.valid) {
        console.log('❌ Validation failed:');
        for (const issue of result.issues) {
          console.log(`  🔴 [${issue.field || '-'}] ${issue.message}`);
        }
        process.exit(1);
      }

      const { readFileSync } = await import('fs');
      const { parse: parseYaml } = await import('yaml');
      const content = readFileSync(file, 'utf-8');
      const entity = parseYaml(content);
      if (!entity.namespace) entity.namespace = 'multica';

      try {
        const entry = registry.save(entity);
        console.log(`✅ Imported: ${entry.ref}`);
        console.log(`   Path: ${entry.path}`);
        console.log(`   Hash: ${entry.hash}`);
        console.log(`   Size: ${(entry.size / 1024).toFixed(1)}KB`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'delete': {
      const refStr = rest[0];
      if (!refStr) { console.log('Usage: entity delete <type/name@version>'); process.exit(1); }
      try {
        registry.delete(refStr);
        console.log(`✅ Deleted: ${refStr}`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'extract': {
      const templateName = flags.template || flags.t;
      const agentList = flags.agents || flags.a || '';
      const skillList = flags.skills || flags.s || '';
      const apList = flags.autopilots || flags.ap || '';

      if (!templateName) {
        console.log('Usage: entity extract --template <name> --agents <name1,name2> [--skills <...>]');
        process.exit(1);
      }

      const agents = agentList.split(',').map((s) => s.trim()).filter(Boolean);
      const skills = skillList.split(',').map((s) => s.trim()).filter(Boolean);
      const autopilots = apList.split(',').map((s) => s.trim()).filter(Boolean);

      if (agents.length === 0 && skills.length === 0 && autopilots.length === 0) {
        console.log('Specify at least one entity to extract: --agents, --skills, or --autopilots');
        process.exit(1);
      }

      const { TemplateReader } = await import('../src/services/template-reader.js');
      const reader = new TemplateReader();

      try {
        const template = reader.readTemplate(templateName);
        const tv = template.skills || [];
        const extracted = [];
        const seenSkill = {};

        function extractSkill(skillName) {
          if (seenSkill[skillName]) return;
          if (registry.exists(`skill/${skillName}@1.0.0`)) { seenSkill[skillName] = true; return; }
          const skill = tv.find((s) => s.name === skillName);
          if (!skill) return;
          try {
            registry.save({ entity: 'skill', schema_version: '1.0', name: skill.name, version: '1.0.0',
              description: skill.description, config: skill.config,
              files: skill.files?.map((f) => ({ path: f.path, content: f.content })) });
            extracted.push(`skill/${skillName}@1.0.0`);
          } catch {}
          seenSkill[skillName] = true;
        }

        for (const name of agents) {
          const agent = template.agents.find((a) => a.name === name);
          if (!agent) { console.error(`Agent "${name}" not found`); process.exit(1); }
          if (agent.skills?.length) agent.skills.forEach(extractSkill);
          registry.save({
            entity: 'agent', schema_version: '1.0', name: agent.name, version: '1.0.0',
            description: agent.description, instructions: agent.instructions,
            model: agent.model, runtime_provider: agent.runtime_provider,
            visibility: agent.visibility || 'private',
            skills: agent.skills?.length ? Object.fromEntries(agent.skills.map((s) => [s, '^1.0.0'])) : undefined,
            custom_env_template: agent.custom_env_template,
          });
          extracted.push(`agent/${name}@1.0.0`);
        }

        for (const name of skills) extractSkill(name);

        for (const name of autopilots) {
          const ap = template.autopilots.find((a) => a.title === name);
          if (!ap) { console.error(`Autopilot "${name}" not found`); process.exit(1); }
          const ag = template.agents.find((a) => a.name === ap.agent_ref);
          if (ag && !extracted.some((r) => r.startsWith(`agent/${ag.name}@`))) {
            if (ag.skills?.length) ag.skills.forEach(extractSkill);
            registry.save({
              entity: 'agent', schema_version: '1.0', name: ag.name, version: '1.0.0',
              description: ag.description, instructions: ag.instructions,
              model: ag.model, runtime_provider: ag.runtime_provider,
              visibility: ag.visibility || 'private',
              skills: ag.skills?.length ? Object.fromEntries(ag.skills.map((s) => [s, '^1.0.0'])) : undefined,
            });
            extracted.push(`agent/${ag.name}@1.0.0`);
          }
          registry.save({
            entity: 'autopilot', schema_version: '1.0',
            name: ap.title.toLowerCase().replace(/\s+/g, '-'), version: '1.0.0',
            title: ap.title, description: ap.description, mode: ap.mode,
            agent_ref: `agent/${ap.agent_ref}@^1.0.0`, triggers: ap.triggers,
          });
          extracted.push(`autopilot/${ap.title}@1.0.0`);
        }

        console.log(`✅ Extracted ${extracted.length} entit${extracted.length === 1 ? 'y' : 'ies'}:`);
        for (const ref of extracted) console.log(`   ${ref}`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'fork': {
      const refStr = rest[0];
      const bump = flags.bump || flags.b || 'patch';
      if (!refStr) { console.log('Usage: entity fork <type/name@version> [--bump patch|minor|major]'); process.exit(1); }
      try {
        const entry = registry.fork(refStr, bump);
        console.log(`✅ Forked: ${entry.ref}`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`Unknown entity command: ${sub || '(none)'}`);
      console.log('Available: list, show, validate, import, delete, extract, fork');
      process.exit(1);
  }
}

// ── Template Commands ──

async function templateCommand(subArgs) {
  const sub = subArgs[0];
  const rest = subArgs.slice(1);

  const { TemplateReader } = await import('../src/services/template-reader.js');
  const reader = new TemplateReader();

  switch (sub) {
    case 'list': {
      const templates = reader.listTemplates();
      if (templates.length === 0) {
        console.log('No templates found.');
      } else {
        console.log(`${templates.length} template${templates.length === 1 ? '' : 's'}:\n`);
        for (const t of templates) {
          const modeStr = t.mode ? ` [${t.mode}]` : '';
          const refStr = t.entity_ref_count ? ` +${t.entity_ref_count} entity refs` : '';
          console.log(`  📦 ${t.name} v${t.version}${modeStr}  ${t.agent_count} agents${refStr}`);
        }
      }
      break;
    }

    case 'show': {
      const name = rest[0];
      if (!name) { console.log('Usage: template show <name>'); process.exit(1); }
      try {
        const template = reader.readTemplate(name);
        console.log(JSON.stringify({
          name: template.name,
          schema_version: template.schema_version,
          description: template.description,
          inline_agents: template.agents.map((a) => a.name),
          inline_skills: (template.skills || []).map((s) => s.name),
          inline_autopilots: template.autopilots.map((a) => a.title),
          entity_refs: (template.includes?.entities || []).map((e) => e.ref),
          projects: template.projects.length,
          labels: template.labels.length,
        }, null, 2));
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'validate': {
      const file = rest[0];
      if (!file) { console.log('Usage: template validate <file>'); process.exit(1); }
      try {
        const { readFileSync } = await import('fs');
        const { parse: parseYaml } = await import('yaml');
        const content = readFileSync(file, 'utf-8');
        const raw = parseYaml(content);

        if (raw.schema_version?.startsWith('2.')) {
          reader.readTemplate(raw.name);
          console.log(`✅ Valid v2 template: ${raw.name}`);
          if (raw.includes?.entities?.length) {
            console.log(`   Entity refs: ${raw.includes.entities.length}`);
          }
        } else {
          reader.readTemplate(raw.name);
          console.log(`✅ Valid v1 template: ${raw.name}`);
        }
      } catch (e) {
        console.error(`❌ Invalid template: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`Unknown template command: ${sub || '(none)'}`);
      console.log('Available: list, show, validate');
      process.exit(1);
  }
}

// ── Flags Parser ──

function parseFlags(argsArr) {
  const flags = {};
  for (let i = 0; i < argsArr.length; i++) {
    const arg = argsArr[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx >= 0) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else if (i + 1 < argsArr.length && !argsArr[i + 1].startsWith('--')) {
        flags[key] = argsArr[++i];
      } else {
        flags[key] = 'true';
      }
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
