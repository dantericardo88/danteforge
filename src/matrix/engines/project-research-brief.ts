// project-research-brief.ts — WHO is this competitive research for?
//
// council-universe research + capability-proposal extraction used to hardcode DanteForge's
// identity into every prompt. Running them on ANY other repo (the fleet, an arbitrary cold repo)
// therefore produced competitive research for the WRONG product — worse than no research, because
// the resulting Score Ladders and proposals would seed wrong frontier bars that the anti-softening
// gate then defends. This module resolves the TARGET repo's own identity from artifacts that
// already exist, in priority order:
//
//   1. .danteforge/matrix-orchestration/project-intent.json  (matrix-orchestrate detect)
//   2. package.json / Cargo.toml / pyproject.toml name+description, plus the README's first
//      prose paragraph
//   3. an honest "read the README first" instruction — it NEVER invents a domain
//
// DanteForge itself keeps its rich hand-authored meta-layer blurb (matched by name): that context
// is load-bearing for its research quality, and it is exactly what must NOT leak onto other repos.

import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProjectResearchBrief {
  projectName: string;
  /** Markdown lines for the research prompt's CRITICAL CONTEXT block. */
  contextLines: string[];
  /** Provenance of the identity. */
  source: 'intent' | 'manifest' | 'fallback' | 'danteforge';
}

const DANTEFORGE_CONTEXT: string[] = [
  'DanteForge is a **provider-agnostic AI coding assistant optimizer and skillset**.',
  'It is NOT a standalone coding assistant. It is a meta-layer that can be applied ON TOP OF:',
  'Claude Code, Codex (OpenAI), Grok Build, Cursor, Aider, QwenCoder, Goose, DanteCode, and any future AI coding tool.',
  '',
  "DanteForge's job: make ANY AI coding assistant dramatically better through structured specs,",
  'multi-agent orchestration, wave-based execution, hard gates, skills, lessons, and self-improvement loops.',
  '',
  'When researching OSS leaders, look for:',
  '- Tools that ORCHESTRATE or OPTIMIZE other AI agents (not just tools that write code themselves)',
  '- Multi-agent frameworks, eval harnesses, skill systems, workflow engines applied to AI coding',
  '- The best published techniques a meta-layer tool could implement',
];

function danteforgeBrief(): ProjectResearchBrief {
  return { projectName: 'DanteForge', contextLines: DANTEFORGE_CONTEXT, source: 'danteforge' };
}

function isDanteForge(name: string): boolean {
  return name.trim().toLowerCase() === 'danteforge';
}

async function readIfExists(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

/** First real prose paragraph of a README: skips headings, badges, images, HTML and blank lines. */
export function extractReadmeExcerpt(readme: string, maxChars = 300): string | null {
  const lines = readme.split(/\r?\n/);
  const para: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (para.length === 0) {
      if (t === '' || t.startsWith('#') || t.startsWith('![') || t.startsWith('[!') || t.startsWith('<') || t.startsWith('|') || t.startsWith('---')) continue;
      para.push(t);
    } else {
      if (t === '') break;
      para.push(t);
    }
  }
  if (para.length === 0) return null;
  const text = para.join(' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
  if (text.length === 0) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** name+description from the first manifest present: package.json, Cargo.toml, pyproject.toml. */
async function readManifestIdentity(projectPath: string): Promise<{ name: string; description?: string } | null> {
  const pkgRaw = await readIfExists(path.join(projectPath, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
      if (pkg.name) return { name: pkg.name, description: pkg.description };
    } catch { /* malformed — try the next manifest */ }
  }
  for (const file of ['Cargo.toml', 'pyproject.toml']) {
    const raw = await readIfExists(path.join(projectPath, file));
    if (!raw) continue;
    const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(raw)?.[1];
    const description = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(raw)?.[1];
    if (name) return { name, description };
  }
  return null;
}

function genericContext(name: string, description: string | undefined, readmeExcerpt: string | null, extra: string[] = []): string[] {
  return [
    `**${name}** is the product under research${description ? ` — ${description}` : ''}.`,
    ...(readmeExcerpt ? ['', `From its README: ${readmeExcerpt}`] : []),
    ...extra,
    '',
    `Research competitors, leaders, and techniques in ${name}'s OWN domain (as described above).`,
    'Do NOT assume it is an AI coding tool or agent framework unless the description says so.',
    'If the domain is still unclear, READ the repository README and main entry files FIRST, then research.',
  ];
}

/**
 * Resolve the research identity for the repo at `projectPath`. Never throws; never invents a
 * domain — when nothing machine-readable exists, the brief instructs the researcher to read the
 * repo first instead of assuming one.
 */
export async function resolveProjectBrief(projectPath: string): Promise<ProjectResearchBrief> {
  // 1. The detect/discover artifact (richest honest source — carries goal + category boundary).
  const intentRaw = await readIfExists(path.join(projectPath, '.danteforge', 'matrix-orchestration', 'project-intent.json'));
  if (intentRaw) {
    try {
      const intent = JSON.parse(intentRaw) as {
        projectName?: string; goal?: string; projectType?: string;
        competitiveCategoryBoundary?: { direct?: string[] };
      };
      if (intent.projectName && intent.goal) {
        if (isDanteForge(intent.projectName)) return danteforgeBrief();
        const cats = intent.competitiveCategoryBoundary?.direct ?? [];
        return {
          projectName: intent.projectName,
          source: 'intent',
          contextLines: genericContext(intent.projectName, undefined, null, [
            `Project type: ${intent.projectType ?? 'software project'}. Goal: ${intent.goal}`,
            ...(cats.length > 0 ? [`Direct competitive categories: ${cats.join(', ')}.`] : []),
          ]),
        };
      }
    } catch { /* malformed — fall through to the manifest */ }
  }

  // 2. Manifest + README.
  const manifest = await readManifestIdentity(projectPath);
  if (manifest) {
    if (isDanteForge(manifest.name)) return danteforgeBrief();
    const readme = await readIfExists(path.join(projectPath, 'README.md'));
    return {
      projectName: manifest.name,
      source: 'manifest',
      contextLines: genericContext(manifest.name, manifest.description, readme ? extractReadmeExcerpt(readme) : null),
    };
  }

  // 3. Honest fallback — no identity found, so say so rather than guessing one.
  const dirName = path.basename(path.resolve(projectPath));
  return {
    projectName: dirName,
    source: 'fallback',
    contextLines: [
      `No machine-readable project description was found in this repository ("${dirName}").`,
      'FIRST read the README and the main entry point to determine what this product actually is and who uses it.',
      'Then research competitors and techniques in THAT domain. Do NOT assume any domain — it is NOT necessarily an AI or coding tool.',
    ],
  };
}
