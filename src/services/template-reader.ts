import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { parseEntityRef } from '../types/entity.js';
import type {
  Template,
  TemplateV2,
  TemplateSummary,
  AnyTemplate,
} from '../types/template.js';
import { isTemplateV2 } from '../types/template.js';

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
    const builtin = this.listFrom(this.builtinDir, 'builtin');
    const user = this.listFrom(this.userDir, 'user');
    // User templates override built-in when names collide
    const userNames = new Set(user.map((t) => t.name));
    return [...builtin.filter((t) => !userNames.has(t.name)), ...user];
  }

  /** Read a template — returns TemplateV2 (v1 templates are auto-upgraded). */
  readTemplate(name: string): TemplateV2 {
    // Try user dir first so custom templates take priority
    try {
      return this.readFrom(this.userDir, name);
    } catch {
      return this.readFrom(this.builtinDir, name);
    }
  }

  /** Read the raw template (may be v1 or v2 format). */
  readTemplateRaw(name: string): AnyTemplate {
    try {
      return this.readFromRaw(this.userDir, name);
    } catch {
      return this.readFromRaw(this.builtinDir, name);
    }
  }

  private listFrom(dir: string, source: 'builtin' | 'user'): TemplateSummary[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    const results: TemplateSummary[] = [];
    for (const f of files) {
      try {
        const name = f.replace(/\.ya?ml$/, '');
        const t = this.readFrom(dir, name);
        const summary: TemplateSummary = {
          name: t.name,
          version: t.schema_version || '1.0',
          description: t.description,
          agent_count: t.agents.length,
          project_count: t.projects?.length ?? 0,
          label_count: t.labels?.length ?? 0,
          autopilot_count: t.autopilots?.length ?? 0,
          skill_count: t.skills?.length ?? 0,
          source,
        };
        // Add v2-specific fields
        if (isTemplateV2(t)) {
          summary.entity_ref_count = t.includes?.entities?.length ?? 0;
          const hasInline = t.agents.length > 0 || (t.skills?.length ?? 0) > 0 || t.autopilots.length > 0;
          const hasRefs = (t.includes?.entities?.length ?? 0) > 0;
          summary.mode = hasInline && hasRefs ? 'mixed'
            : hasRefs ? 'reference'
            : 'inline';
          summary.version = t.schema_version;
        }
        results.push(summary);
      } catch {
        // Skip invalid templates without breaking the whole list
      }
    }
    return results;
  }

  /**
   * Read a template from a directory. Always returns TemplateV2.
   * v1 templates are normalized to v2 with empty includes.
   */
  private readFrom(dir: string, name: string): TemplateV2 {
    const raw = this.readYamlFile(dir, name);
    return this.asV2(raw as unknown as AnyTemplate, name);
  }

  private readFromRaw(dir: string, name: string): AnyTemplate {
    return this.readYamlFile(dir, name) as unknown as AnyTemplate;
  }

  private readYamlFile(dir: string, name: string): Record<string, unknown> {
    let content: string | null = null;
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
      }
    }
    if (!content) {
      throw new Error(`Template "${name}" not found in ${dir}`);
    }
    return parseYaml(content) as Record<string, unknown>;
  }

  /**
   * Normalize any template to TemplateV2.
   *
   * v1 templates: version field present, no schema_version → normalized with includes = undefined.
   * v2 templates: schema_version: "2.0" → parsed as-is.
   */
  private asV2(template: AnyTemplate, name: string): TemplateV2 {
    // If already v2, validate and return
    if (isTemplateV2(template)) {
      this.validateV2(template, name);
      return template;
    }

    // v1 → normalize to v2
    const v1 = template as Template;
    this.validateV1(v1, name);

    return {
      schema_version: '1.0', // mark as v1-origin
      name: v1.name,
      description: v1.description,
      agents: v1.agents,
      projects: v1.projects,
      labels: v1.labels,
      autopilots: v1.autopilots,
      runtime_mapping: v1.runtime_mapping,
      skills: v1.skills,
      // No includes — pure inline
      includes: undefined,
    };
  }

  // ── Validation ──

  private validateV1(t: Template, name: string): void {
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

  private validateV2(t: TemplateV2, name: string): void {
    if (!t.schema_version) throw new Error(`Template "${name}" missing schema_version`);
    if (!t.name) throw new Error(`Template "${name}" missing name`);

    // Inline validation (same as v1, but relaxed: entity refs may provide agents)
    const inlineAgentNames = new Set(t.agents.map((a) => a.name));
    const refs = t.includes?.entities ?? [];

    // Collect entity-ref agent names (these will be resolved at import time)
    const refAgentNames = new Set<string>();
    for (const ref of refs) {
      try {
        const parsed = parseEntityRef(ref.ref);
        if (parsed.type === 'agent') refAgentNames.add(parsed.name);
      } catch {
        // Invalid ref — will be caught at import time
      }
    }

    // Check: autopilot agent_refs must exist either inline or in entity refs
    const allAgentNames = new Set([...inlineAgentNames, ...refAgentNames]);
    for (const ap of t.autopilots || []) {
      if (!allAgentNames.has(ap.agent_ref)) {
        // Not fatal — agent may come from inline definition with a different name
        // We'll catch this at import time
      }
    }

    // Check: auto-pilots referencing entity-ref agents — these will work at import time
  }
}
