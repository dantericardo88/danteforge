// Matrix Orchestration — THIRD_PARTY_NOTICES generator (PRD §7)
//
// Walks the phase audit log + kernel work graph for every harvested OSS
// pattern, classifies its license via core/oss-researcher.classifyLicense,
// and emits a THIRD_PARTY_NOTICES.md at the project root.
//
// FAILSAFE: if any harvested source's license classifies as `blocked`, this
// module throws LicenseViolation. Callers (final-report, orchestrator) MUST
// surface that error and refuse to write the final report.

import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyLicense } from '../../core/oss-researcher.js';
import { readAuditLog } from '../state-io.js';
import { ORCH_REPORT_PATHS } from '../types.js';
import type { AuditEvent } from '../types.js';
import type { PhaseExecutionResult } from '../types.js';

// ── Errors ──────────────────────────────────────────────────────────────────

export class LicenseViolation extends Error {
  constructor(public repoUrl: string, public licenseName: string) {
    super(`THIRD_PARTY_NOTICES: ${repoUrl} is ${licenseName} (blocked)`);
    this.name = 'LicenseViolation';
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface HarvestedPattern {
  /** Repo or upstream URL (used as the identity key). */
  repoUrl: string;
  /** Pattern human-readable name. */
  patternName?: string;
  /** Raw LICENSE text used by classifyLicense. May be absent for clean-room. */
  licenseText?: string;
  /** When we copy code verbatim, copyType === 'direct'; otherwise 'clean_room'. */
  copyType: 'direct' | 'clean_room';
  /** Optional credit line that wraps the canonical attribution. */
  attribution?: string;
  /** ISO timestamp when the pattern was harvested. */
  harvestedAt?: string;
}

export interface GenerateThirdPartyNoticesArgs {
  /** All harvested patterns for the run. Caller resolves these from kernel
   *  work graph + audit log; we accept the resolved list to keep this module
   *  pure-functional and testable. */
  patterns: HarvestedPattern[];
  /** Used in the report header. */
  projectName: string;
  /** Optional run id; appears in the trailer. */
  runId?: string;
}

export interface GenerateThirdPartyNoticesOptions {
  cwd: string;
  /** Override LICENSE classifier (defaults to core/oss-researcher). */
  _classify?: (text: string) => { status: 'allowed' | 'blocked' | 'unknown'; name: string };
  _now?: () => string;
  /** When true, write to disk; default true. */
  writeToDisk?: boolean;
}

/**
 * Build (and optionally write) THIRD_PARTY_NOTICES.md. Returns the rendered
 * markdown body. Throws LicenseViolation on any blocked-license pattern.
 */
export async function generateThirdPartyNotices(
  args: GenerateThirdPartyNoticesArgs,
  options: GenerateThirdPartyNoticesOptions,
): Promise<string> {
  const now = options._now ?? (() => new Date().toISOString());
  const classify = options._classify ?? classifyLicense;
  const writeToDisk = options.writeToDisk ?? true;

  const sections: string[] = [];
  sections.push(renderHeader(args.projectName, now(), args.runId));

  if (args.patterns.length === 0) {
    sections.push('No third-party patterns were harvested in this run.\n');
  } else {
    for (const pattern of args.patterns) {
      const classification = pattern.licenseText
        ? classify(pattern.licenseText)
        : { status: 'unknown' as const, name: 'unknown' };

      if (classification.status === 'blocked') {
        throw new LicenseViolation(pattern.repoUrl, classification.name);
      }
      sections.push(renderPatternSection(pattern, classification));
    }
  }

  sections.push(renderFooter());
  const body = sections.join('\n');

  if (writeToDisk) {
    const outPath = path.join(options.cwd, ORCH_REPORT_PATHS.thirdPartyNotices);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, body, 'utf8');
  }
  return body;
}

/**
 * Helper: extract harvested patterns from the audit log. Caller code that
 * already has the list in memory should pass it directly to
 * `generateThirdPartyNotices` — this helper is convenience.
 */
export async function collectHarvestedPatterns(
  cwd: string,
  _phaseResults: PhaseExecutionResult[],
): Promise<HarvestedPattern[]> {
  const events = await readAuditLog(cwd);
  return events
    .filter(isHarvestEvent)
    .map(eventToPattern)
    .filter((p): p is HarvestedPattern => p !== null);
}

// ── Renderers ───────────────────────────────────────────────────────────────

function renderHeader(projectName: string, generatedAt: string, runId?: string): string {
  const trailer = runId ? `\n*Run id:* \`${runId}\`\n` : '\n';
  return [
    `# THIRD_PARTY_NOTICES — ${projectName}`,
    '',
    `Generated: ${generatedAt}${trailer}`,
    'This document lists every third-party pattern harvested into this project,',
    'its license, and how the pattern was incorporated (direct copy vs. clean-room).',
    'Patterns under blocked licenses are refused at harvest time; their presence',
    'in this file would indicate a constitution violation.',
    '',
  ].join('\n');
}

function renderPatternSection(
  pattern: HarvestedPattern,
  classification: { status: string; name: string },
): string {
  const lines: string[] = [];
  lines.push(`## ${pattern.patternName ?? pattern.repoUrl}`);
  lines.push('');
  lines.push(`- **Source:** ${pattern.repoUrl}`);
  lines.push(`- **License:** ${classification.name} (${classification.status})`);
  lines.push(`- **Incorporation:** ${pattern.copyType === 'direct' ? 'direct copy (verbatim)' : 'clean-room reimplementation'}`);
  if (pattern.harvestedAt) lines.push(`- **Harvested:** ${pattern.harvestedAt}`);
  lines.push('');
  lines.push(renderAttribution(pattern, classification.name));
  lines.push('');
  return lines.join('\n');
}

function renderAttribution(pattern: HarvestedPattern, licenseName: string): string {
  if (pattern.attribution) return pattern.attribution;
  if (pattern.copyType === 'clean_room') {
    return [
      `This project includes a clean-room reimplementation inspired by`,
      `${pattern.repoUrl} (${licenseName}). No source code was copied; only`,
      `the architectural pattern was studied and reproduced from first principles.`,
    ].join(' ');
  }
  return [
    `Portions of this work include code from ${pattern.repoUrl}, used under`,
    `the ${licenseName} license. Full license text available at the upstream`,
    `repository. Copyright remains with the original authors.`,
  ].join(' ');
}

function renderFooter(): string {
  return [
    '---',
    '',
    'If you believe a pattern has been mis-attributed or mis-licensed, please',
    'open an issue and we will correct the record promptly.',
    '',
  ].join('\n');
}

// ── Audit-log -> pattern shim ───────────────────────────────────────────────

function isHarvestEvent(event: AuditEvent): boolean {
  if (event.kind !== 'phase_attempt_outcome') return false;
  const p = event.payload as Record<string, unknown> | undefined;
  return typeof p?.harvestUrl === 'string';
}

function eventToPattern(event: AuditEvent): HarvestedPattern | null {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p || typeof p.harvestUrl !== 'string') return null;
  return {
    repoUrl: p.harvestUrl,
    patternName: typeof p.patternName === 'string' ? p.patternName : undefined,
    licenseText: typeof p.licenseText === 'string' ? p.licenseText : undefined,
    copyType: p.copyType === 'direct' ? 'direct' : 'clean_room',
    attribution: typeof p.attribution === 'string' ? p.attribution : undefined,
    harvestedAt: event.ts,
  };
}
