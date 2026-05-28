import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import type { Template, TemplateSummary } from '../types/template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = resolve(__dirname, '../../templates');

export class TemplateReader {
  private builtinDir: string;
  private userDir: string;

  constructor(builtinDir?: string, userDir?: string) {
    this.builtinDir = builtinDir || BUILTIN_DIR;
    this.userDir = userDir || join(homedir(), '.multica-templates');
    // Ensure user dir exists so writer can write there
    if (!existsSync(this.userDir)) {
      mkdirSync(this.userDir, { recursive: true });
    }
  }

  listTemplates(): TemplateSummary[] {
    const builtin = this.listFrom(this.builtinDir);
    const user = this.listFrom(this.userDir);
    // User templates override built-in when names collide
    const userNames = new Set(user.map((t) => t.name));
    return [...builtin.filter((t) => !userNames.has(t.name)), ...user];
  }

  readTemplate(name: string): Template {
    // Try user dir first so custom templates take priority
    try {
      return this.readFrom(this.userDir, name);
    } catch {
      return this.readFrom(this.builtinDir, name);
    }
  }

  private listFrom(dir: string): TemplateSummary[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    return files.map((f) => {
      const t = this.readFrom(dir, f.replace(/\.ya?ml$/, ''));
      return {
        name: t.name,
        version: t.version,
        description: t.description,
        agent_count: t.agents.length,
        project_count: t.projects?.length ?? 0,
        label_count: t.labels?.length ?? 0,
        autopilot_count: t.autopilots?.length ?? 0,
        skill_count: t.skills?.length ?? 0,
      };
    });
  }

  private readFrom(dir: string, name: string): Template {
    let content: string | null = null;
    let foundName = name;
    for (const ext of ['.yaml', '.yml']) {
      const p = join(dir, `${name}${ext}`);
      if (existsSync(p)) {
        content = readFileSync(p, 'utf-8');
        break;
      }
    }
    // Fall back to case-insensitive file name match
    if (!content && existsSync(dir)) {
      const files = readdirSync(dir);
      const match = files.find((f) => {
        const base = f.replace(/\.ya?ml$/, '');
        return base.toLowerCase() === name.toLowerCase();
      });
      if (match) {
        content = readFileSync(join(dir, match), 'utf-8');
        foundName = match.replace(/\.ya?ml$/, '');
      }
    }
    if (!content) {
      throw new Error(`Template "${name}" not found in ${dir}`);
    }
    const template = parseYaml(content) as Template;
    this.validate(template, name);
    return template;
  }

  private validate(t: Template, name: string): void {
    if (!t.version) throw new Error(`Template "${name}" missing version`);
    if (!t.agents?.length) throw new Error(`Template "${name}" has no agents`);

    const agentNames = new Set(t.agents.map((a) => a.name));
    for (const ap of t.autopilots || []) {
      if (!agentNames.has(ap.agent_ref)) {
        throw new Error(
          `Template "${name}": autopilot "${ap.title}" references unknown agent "${ap.agent_ref}"`,
        );
      }
    }
  }
}
