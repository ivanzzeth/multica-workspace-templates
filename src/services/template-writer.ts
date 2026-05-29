import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { stringify as stringifyYaml } from 'yaml';
import type { Template, TemplateV2 } from '../types/template.js';

export class TemplateWriter {
  private templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir || join(homedir(), '.multica-templates');
  }

  /** Save a v1 template (backward compatible). */
  saveTemplate(template: Template, filename?: string): string {
    const name = filename || `${template.name.toLowerCase().replace(/\s+/g, '-')}.yaml`;
    return this.writeFile(name, template);
  }

  /** Save a v2 template manifest. */
  saveTemplateV2(template: TemplateV2, filename?: string): string {
    const name = filename || `${template.name.toLowerCase().replace(/\s+/g, '-')}.yaml`;
    return this.writeFile(name, template);
  }

  /** Get the templates directory. */
  getTemplatesDir(): string {
    return this.templatesDir;
  }

  private writeFile(filename: string, data: object): string {
    const filePath = join(this.templatesDir, filename);

    if (!existsSync(this.templatesDir)) {
      mkdirSync(this.templatesDir, { recursive: true });
    }

    const yaml = stringifyYaml(data, {
      indent: 2,
      lineWidth: 120,
      nullStr: '',
    });
    writeFileSync(filePath, yaml, 'utf-8');
    return filePath;
  }
}
