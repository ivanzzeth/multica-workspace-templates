import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import type { Template, TemplateSummary } from '../types/template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

export class TemplateReader {
  private templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir || TEMPLATES_DIR;
  }

  listTemplates(): TemplateSummary[] {
    if (!existsSync(this.templatesDir)) return [];
    const files = readdirSync(this.templatesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    return files.map((f) => {
      const t = this.readTemplate(f.replace(/\.ya?ml$/, ''));
      return {
        name: t.name,
        description: t.description,
        agent_count: t.agents.length,
        project_count: t.projects.length,
        label_count: t.labels.length,
        autopilot_count: t.autopilots.length,
      };
    });
  }

  readTemplate(name: string): Template {
    // Try both .yaml and .yml
    let content: string | null = null;
    for (const ext of ['.yaml', '.yml']) {
      const p = join(this.templatesDir, `${name}${ext}`);
      if (existsSync(p)) {
        content = readFileSync(p, 'utf-8');
        break;
      }
    }
    if (!content) {
      throw new Error(`Template "${name}" not found in ${this.templatesDir}`);
    }
    const template = parseYaml(content) as Template;
    this.validate(template, name);
    return template;
  }

  private validate(t: Template, name: string): void {
    if (!t.version) throw new Error(`Template "${name}" missing version`);
    if (!t.agents?.length) throw new Error(`Template "${name}" has no agents`);
    if (!t.projects?.length) throw new Error(`Template "${name}" has no projects`);

    // Validate agent_refs in autopilots
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
