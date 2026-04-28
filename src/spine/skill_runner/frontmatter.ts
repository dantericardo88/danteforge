/**
 * SKILL.md frontmatter parser. The frontmatter is YAML wrapped in `---` fences.
 * We accept the existing Dante skill format (name + description only) AND the
 * extended Dante-native format (with based_on, attribution, etc.).
 */

import { readFileSync } from 'node:fs';
import type { SkillFrontmatter } from './types.js';

export function parseFrontmatter(skillFilePath: string): SkillFrontmatter {
  const raw = readFileSync(skillFilePath, 'utf-8');
  return parseFrontmatterFromString(raw);
}

export function parseFrontmatterFromString(raw: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]+?)\r?\n---/m.exec(raw);
  if (!match) {
    throw new Error('SKILL.md missing YAML frontmatter');
  }
  const body = match[1] ?? '';
  const lines = body.split(/\r?\n/);
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }
    const m = /^(\w[\w_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = (m[1] ?? '').replace(/-/g, '_');
    const rest = (m[2] ?? '').trim();
    if (rest === '|' || rest === '>') {
      i++;
      const block: string[] = [];
      while (i < lines.length && /^\s+/.test(lines[i] ?? '')) {
        block.push((lines[i] ?? '').replace(/^\s{0,2}/, ''));
        i++;
      }
      out[key] = block.join('\n');
      continue;
    }
    if (rest === '') {
      i++;
      const block: string[] = [];
      while (i < lines.length && /^\s+-\s+/.test(lines[i] ?? '')) {
        const item = (/^\s+-\s+(.*)$/.exec(lines[i] ?? '') || [])[1] ?? '';
        block.push(unquote(item));
        i++;
      }
      out[key] = block;
      continue;
    }
    out[key] = unquote(rest);
    i++;
  }
  return normalize(out);
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalize(raw: Record<string, unknown>): SkillFrontmatter {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    basedOn: typeof raw.based_on === 'string' ? raw.based_on : undefined,
    attribution: typeof raw.attribution === 'string' ? raw.attribution : undefined,
    license: typeof raw.license === 'string' ? raw.license : undefined,
    constitutionalDependencies: Array.isArray(raw.constitutional_dependencies)
      ? (raw.constitutional_dependencies as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined,
    requiredDimensions: Array.isArray(raw.required_dimensions)
      ? (raw.required_dimensions as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined,
    sacredContentTypes: Array.isArray(raw.sacred_content_types)
      ? (raw.sacred_content_types as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined
  };
}
