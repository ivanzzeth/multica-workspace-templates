import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { stringify as stringifyYaml } from 'yaml';
import type { Template } from '../types/template.js';

export class TemplateWriter {
  private templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir || join(homedir(), '.multica-templates');
  }

  saveTemplate(template: Template, filename?: string): string {
    const name = filename || `${template.name.toLowerCase().replace(/\s+/g, '-')}.yaml`;
    const filePath = join(this.templatesDir, name);

    if (!existsSync(this.templatesDir)) {
      mkdirSync(this.templatesDir, { recursive: true });
    }

    const yaml = stringifyYaml(template, {
      indent: 2,
      lineWidth: 120,
      nullStr: '',
    });
    writeFileSync(filePath, yaml, 'utf-8');
    return filePath;
  }
}
