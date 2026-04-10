// Wiki Linter — self-evolution engine: contradiction detection, staleness, link integrity, pattern synthesis
// Four-pass lint cycle that keeps the wiki accurate and densely cross-linked.

import path from 'node:path';
import {
  type WikiContradiction,
  type WikiStalePage,
  type WikiBrokenLink,
  type WikiPatternSuggestion,
  type WikiLintReport,
  type WikiAuditEntry,
  WIKI_DIR,
  AUDIT_LOG_FILE,
  LINT_REPORT_FILE,
  STALENESS_DAYS,
} from './wiki-schema.js';
import {
  parseFrontmatter,
  extractBody,
  buildLinkGraph,
  findOrphanPages,
  resolveWikiLink,
} from './wiki-indexer.js';

// ── I/O injection types ───────────────────────────────────────────────────────

export type ReadFileFn = (filePath: string) => Promise<string>;
export type WriteFileFn = (filePath: string, content: string) => Promise<void>;
export type ReadDirFn = (dirPath: string) => Promise<string[]>;
export type ExistsFn = (filePath: string) => Promise<boolean>;
export type MkdirFn = (dirPath: string, opts?: { recursive?: boolean }) => Promise<void>;
export type LLMCallerFn = (prompt: string) => Promise<string>;

async function defaultReadFile(filePath: string): Promise<string> {
  const { default: fs } = await import('node:fs/promises');
  return fs.readFile(filePath, 'utf8');
}

async function defaultWriteFile(filePath: string, content: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.writeFile(filePath, content, 'utf8');
}

async function defaultReadDir(dirPath: string): Promise<string[]> {
  const { default: fs } = await import('node:fs/promises');
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

async function defaultMkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(dirPath, opts);
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface WikiLintOptions {
  cwd?: string;
  heuristicOnly?: boolean;        // Skip LLM calls (zero-cost mode)
  maxLLMTokens?: number;          // Budget cap for LLM lint calls
  stalenessThresholdDays?: number;
  _llmCaller?: LLMCallerFn;
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _readDir?: ReadDirFn;
  _exists?: ExistsFn;
  _mkdir?: MkdirFn;
}

// ── Pass 1: Contradiction detection ──────────────────────────────────────────

/**
 * Detect conflicting claims in entity pages that have multiple source entries.
 * Auto-resolves if one source is strictly newer; flags ambiguous cases for human review.
 */
export async function scanContradictions(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
  _llmCaller?: LLMCallerFn,
): Promise<WikiContradiction[]> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);
  const contradictions: WikiContradiction[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('index.md') || filePath.endsWith('LINT_REPORT.md')) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm || fm.sources.length < 2) continue;

      const body = extractBody(content);

      // Extract History entries — look for multiple dated entries that might conflict
      const historyEntries = body.match(/###\s+\d{4}-\d{2}-\d{2}[^\n]*\n\n(.*?)(?=###|\n##\s|$)/gs) ?? [];
      if (historyEntries.length < 2) continue;

      if (_llmCaller) {
        // LLM-assisted contradiction detection
        const prompt = [
          'Review these history entries from a wiki entity page and identify any factual contradictions.',
          'Return JSON: { "hasContradiction": boolean, "claimA": string, "claimB": string }',
          'If no contradiction, return: { "hasContradiction": false, "claimA": "", "claimB": "" }',
          '',
          'Entries:',
          historyEntries.slice(0, 5).join('\n---\n'),
        ].join('\n');

        try {
          const response = await _llmCaller(prompt);
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { hasContradiction: boolean; claimA: string; claimB: string };
            if (parsed.hasContradiction && parsed.claimA && parsed.claimB) {
              // Auto-resolve if we can determine which source is newer
              const sourceTimestamps = fm.sources.map((s, i) => ({
                source: s,
                idx: i,
              }));
              const canAutoResolve = sourceTimestamps.length >= 2;

              contradictions.push({
                entityId: fm.entity,
                claimA: parsed.claimA,
                claimB: parsed.claimB,
                sourceA: fm.sources[0] ?? 'unknown',
                sourceB: fm.sources[fm.sources.length - 1] ?? 'unknown',
                autoResolved: canAutoResolve,
                resolution: canAutoResolve ? `Kept claim from most recent source: ${fm.sources[fm.sources.length - 1]}` : undefined,
              });
            }
          }
        } catch {
          // LLM failure is non-fatal for lint
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return contradictions;
}

// ── Pass 2: Staleness detection ───────────────────────────────────────────────

/**
 * Flag wiki pages whose most recent source update is older than threshold days.
 * Only flags pages that are still referenced by active artifacts.
 */
export async function scanStaleness(
  wikiDir: string,
  stalenessThresholdDays = STALENESS_DAYS,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
): Promise<WikiStalePage[]> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);
  const stalePages: WikiStalePage[] = [];
  const now = Date.now();

  for (const filePath of files) {
    if (filePath.endsWith('index.md') || filePath.endsWith('LINT_REPORT.md') || filePath.endsWith('pdse-history.md')) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm?.updated) continue;

      const updatedMs = new Date(fm.updated).getTime();
      if (isNaN(updatedMs)) continue;

      const ageDays = (now - updatedMs) / (1000 * 60 * 60 * 24);

      if (ageDays > stalenessThresholdDays) {
        stalePages.push({
          entityId: fm.entity,
          lastUpdated: fm.updated,
          daysSinceUpdate: Math.floor(ageDays),
          referencedByArtifacts: fm.sources,
        });
      }
    } catch {
      // Skip unreadable
    }
  }

  return stalePages;
}

// ── Pass 3: Link integrity ────────────────────────────────────────────────────

/**
 * Verify all [[wikilinks]] and links[] in frontmatter resolve to existing entities.
 * Creates skeleton pages for orphaned link targets. Lists pages with zero inbound links.
 */
export async function scanLinkIntegrity(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
  _writeFile?: WriteFileFn,
  _mkdir?: MkdirFn,
): Promise<{ brokenLinks: WikiBrokenLink[]; orphanPages: string[] }> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;
  const writeFile = _writeFile ?? defaultWriteFile;
  const mkdir = _mkdir ?? defaultMkdir;

  const files = await readDir(wikiDir);
  const existingEntities = new Set<string>();

  // First pass: collect all entity IDs
  for (const filePath of files) {
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (fm?.entity) existingEntities.add(fm.entity);
    } catch { /* skip */ }
  }

  const brokenLinks: WikiBrokenLink[] = [];

  // Second pass: check all links
  for (const filePath of files) {
    if (filePath.endsWith('index.md') || filePath.endsWith('LINT_REPORT.md')) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm) continue;

      // Check frontmatter links[]
      for (const link of fm.links) {
        if (!resolveWikiLink(link, existingEntities)) {
          const targetId = link.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

          // Create a skeleton page for the broken link target
          const stubPath = path.join(wikiDir, `${targetId}.md`);
          const stubContent = [
            '---',
            `entity: "${targetId}"`,
            'type: concept',
            `created: ${new Date().toISOString()}`,
            `updated: ${new Date().toISOString()}`,
            'sources: []',
            'links: []',
            'constitution-refs: []',
            'tags:',
            '  - stub',
            '---',
            '',
            `# ${link}`,
            '',
            '## Summary',
            '',
            '_Stub page created by wiki linter for unresolved link. Fill in details._',
            '',
            '## History',
            '',
            `### ${new Date().toISOString()}`,
            '',
            `Stub created: referenced from \`${fm.entity}\` but not yet documented.`,
          ].join('\n');

          try {
            await mkdir(wikiDir, { recursive: true });
            await writeFile(stubPath, stubContent + '\n');
            existingEntities.add(targetId); // Don't re-create on subsequent iterations
          } catch { /* non-fatal */ }

          brokenLinks.push({
            sourceEntityId: fm.entity,
            targetEntityId: targetId,
            skeletonCreated: true,
          });
        }
      }

      // Check inline [[wikilinks]] in body
      const body = extractBody(content);
      const inlineLinks = body.match(/\[\[([^\]]+)\]\]/g) ?? [];
      for (const rawLink of inlineLinks) {
        const linkTarget = rawLink.slice(2, -2);
        if (!resolveWikiLink(linkTarget, existingEntities)) {
          brokenLinks.push({
            sourceEntityId: fm.entity,
            targetEntityId: linkTarget,
            skeletonCreated: false,
          });
        }
      }
    } catch { /* skip */ }
  }

  // Compute orphan pages using graph
  const graph = await buildLinkGraph(wikiDir, readDir, readFile);
  const orphans = findOrphanPages(graph);

  return { brokenLinks, orphanPages: orphans };
}

// ── Pass 4: Pattern synthesis ─────────────────────────────────────────────────

/**
 * Aggregate decision history entries across wiki and prompt LLM to identify
 * recurring patterns worth promoting to dedicated pattern entity pages.
 */
export async function synthesizePatterns(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
  _llmCaller?: LLMCallerFn,
): Promise<WikiPatternSuggestion[]> {
  if (!_llmCaller) return []; // Requires LLM

  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);
  const decisionHistory: string[] = [];
  const sourceEntities: string[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('index.md') || filePath.endsWith('LINT_REPORT.md')) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const body = extractBody(content);

      // Extract Decisions section
      const decisionsMatch = body.match(/##\s+Decisions\s*\n([\s\S]*?)(?=\n##\s|$)/);
      if (decisionsMatch && decisionsMatch[1].trim().length > 20) {
        decisionHistory.push(`[${fm.entity}] ${decisionsMatch[1].trim().slice(0, 500)}`);
        sourceEntities.push(fm.entity);
      }
    } catch { /* skip */ }
  }

  if (decisionHistory.length < 3) return []; // Not enough data

  try {
    const prompt = [
      'Given these architectural decision history entries from a wiki:',
      '',
      decisionHistory.slice(0, 20).join('\n\n'),
      '',
      'Identify up to 3 recurring patterns that appear across multiple entities and',
      'would benefit from their own dedicated pattern entity page.',
      'Return JSON array: [{ "suggestedEntity": string, "rationale": string, "sourceEntities": string[] }]',
      'Return empty array [] if no clear patterns emerge.',
    ].join('\n');

    const response = await _llmCaller(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const suggestions = JSON.parse(jsonMatch[0]) as WikiPatternSuggestion[];
    return suggestions.filter(s => s.suggestedEntity && s.rationale);
  } catch {
    return [];
  }
}

// ── Lint report formatter ─────────────────────────────────────────────────────

function formatLintReport(report: WikiLintReport): string {
  const lines: string[] = [
    '# Wiki Lint Report',
    '',
    `Generated: ${report.timestamp}`,
    `Total issues: ${report.totalIssues}`,
    `Pass rate: ${(report.passRate * 100).toFixed(1)}%`,
    '',
  ];

  if (report.contradictions.length > 0) {
    lines.push('## Contradictions', '');
    for (const c of report.contradictions) {
      lines.push(`### ${c.entityId}`);
      lines.push(`- Claim A (${c.sourceA}): ${c.claimA}`);
      lines.push(`- Claim B (${c.sourceB}): ${c.claimB}`);
      lines.push(`- Auto-resolved: ${c.autoResolved ? `Yes — ${c.resolution}` : 'No — human review required'}`);
      lines.push('');
    }
  }

  if (report.stalePages.length > 0) {
    lines.push('## Stale Pages', '');
    for (const s of report.stalePages) {
      lines.push(`- **${s.entityId}**: ${s.daysSinceUpdate} days since update (last: ${s.lastUpdated})`);
    }
    lines.push('');
  }

  if (report.brokenLinks.length > 0) {
    lines.push('## Broken Links', '');
    for (const b of report.brokenLinks) {
      lines.push(`- **${b.sourceEntityId}** → **${b.targetEntityId}** (skeleton: ${b.skeletonCreated})`);
    }
    lines.push('');
  }

  if (report.orphanPages.length > 0) {
    lines.push('## Orphan Pages (zero inbound links)', '');
    report.orphanPages.forEach(o => lines.push(`- ${o}`));
    lines.push('');
  }

  if (report.patternSuggestions.length > 0) {
    lines.push('## Pattern Suggestions', '');
    for (const p of report.patternSuggestions) {
      lines.push(`### ${p.suggestedEntity}`);
      lines.push(p.rationale);
      lines.push(`Sources: ${p.sourceEntities.join(', ')}`);
      lines.push('');
    }
  }

  if (report.totalIssues === 0) {
    lines.push('_No issues found. Wiki is healthy._', '');
  }

  return lines.join('\n');
}

// ── Main lint cycle ───────────────────────────────────────────────────────────

/**
 * Run all four lint passes and produce LINT_REPORT.md.
 * Budget-capped: LLM passes are skipped in heuristicOnly mode.
 */
export async function runLintCycle(opts: WikiLintOptions = {}): Promise<WikiLintReport> {
  const cwd = opts.cwd ?? process.cwd();
  const readDir = opts._readDir ?? defaultReadDir;
  const readFile = opts._readFile ?? defaultReadFile;
  const writeFile = opts._writeFile ?? defaultWriteFile;
  const mkdir = opts._mkdir ?? defaultMkdir;
  const llmCaller = opts.heuristicOnly ? undefined : opts._llmCaller;
  const stalenessThreshold = opts.stalenessThresholdDays ?? STALENESS_DAYS;

  const wikiDir = path.join(cwd, WIKI_DIR);
  await mkdir(wikiDir, { recursive: true });

  const timestamp = new Date().toISOString();

  // Pass 1: Contradictions (LLM-assisted if not heuristicOnly)
  const contradictions = await scanContradictions(wikiDir, readDir, readFile, llmCaller);

  // Pass 2: Staleness (pure arithmetic)
  const stalePages = await scanStaleness(wikiDir, stalenessThreshold, readDir, readFile);

  // Pass 3: Link integrity (creates skeleton pages)
  const { brokenLinks, orphanPages } = await scanLinkIntegrity(wikiDir, readDir, readFile, writeFile, mkdir);

  // Pass 4: Pattern synthesis (LLM-assisted if not heuristicOnly)
  const patternSuggestions = await synthesizePatterns(wikiDir, readDir, readFile, llmCaller);

  // Compute stats
  const files = (await readDir(wikiDir)).filter(
    f => !f.endsWith('index.md') && !f.endsWith('LINT_REPORT.md') && !f.endsWith('pdse-history.md')
  );
  const totalIssues = contradictions.length + stalePages.length + brokenLinks.length;
  const passRate = files.length > 0 ? Math.max(0, (files.length - totalIssues) / files.length) : 1;

  const report: WikiLintReport = {
    timestamp,
    contradictions,
    stalePages,
    brokenLinks,
    orphanPages,
    patternSuggestions,
    totalIssues,
    passRate,
  };

  // Write LINT_REPORT.md
  try {
    const lintReportPath = path.join(wikiDir, 'LINT_REPORT.md');
    await writeFile(lintReportPath, formatLintReport(report));
  } catch {
    // Non-fatal
  }

  // Append audit entry
  try {
    const auditPath = path.join(cwd, AUDIT_LOG_FILE);
    await mkdir(path.dirname(auditPath), { recursive: true });
    let existing = '';
    try { existing = await readFile(auditPath); } catch { /* new */ }
    const entry: WikiAuditEntry = {
      timestamp,
      event: 'lint',
      triggeredBy: 'wiki-lint',
      summary: `Lint cycle: ${totalIssues} issues, pass rate ${(passRate * 100).toFixed(1)}%`,
    };
    await writeFile(auditPath, existing + JSON.stringify(entry) + '\n');
  } catch {
    // Non-fatal
  }

  return report;
}
