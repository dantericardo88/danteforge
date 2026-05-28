// Matrix Kernel — CouncilUniverseProposals
//
// Extracts runnable capability-test proposals from verified universe files.
// Proposals are saved to .danteforge/compete/universe-proposals/<dimId>.json
// and applied to matrix.json via council-universe-apply (kernel-controlled write).
//
// A proposal is NOT a score change — it's a candidate outcome entry (shell /
// runtime-exec) that can be run by `danteforge validate <dimId>` to produce real
// receipts and unlock scores above 7.0 via the existing receipt-ceiling system.
//
// cli-smoke is excluded: it requires cli_args: string[] rather than command: string,
// and correct arg splitting cannot be reliably inferred by extraction. Use
// runtime-exec or shell for DanteForge CLI checks instead.
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import { makeReadOnlyLease } from './council-worktree.js';

export interface ProposedOutcome {
  id: string;
  tier: 'T2' | 'T5' | 'T7';
  kind: 'shell' | 'runtime-exec';
  command: string;
  expected_exit: number;
  expected_output_pattern?: string;
  timeout_ms: number;
  /** File that this outcome exercises — mandatory for T2+ (enforced by apply). */
  required_callsite: string;
  description: string;
}

export interface ProposalResult {
  proposedCapabilityTest: { command: string; description: string } | null;
  proposedOutcomes: ProposedOutcome[];
}

export interface ProposalRecord extends ProposalResult {
  dimId: string;
  extractedFrom: string;
  extractedAt: string;
  extractedBy: string;
  verified: boolean;
  /** SHA-256 of the universe file at extraction time. Apply verifies this hasn't changed. */
  universeSha256: string;
}

export function hashUniverseContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface ProposalOptions {
  projectPath: string;
  dimId: string;
  dimName: string;
  universeContent: string;
  existingCapabilityTest?: { command: string; description: string };
  existingOutcomeIds?: string[];
  extractor: 'claude-code' | 'codex';
  timeoutMs?: number;
  _runAdapter?: typeof runAdapter;
}

function proposalsDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'compete', 'universe-proposals');
}

function proposalPath(projectPath: string, dimId: string): string {
  return path.join(proposalsDir(projectPath), `${dimId}.json`);
}

export async function loadProposalFile(projectPath: string, dimId: string): Promise<ProposalRecord | null> {
  try {
    const raw = await fs.readFile(proposalPath(projectPath, dimId), 'utf8');
    return JSON.parse(raw) as ProposalRecord;
  } catch { return null; }
}

export async function saveProposalFile(
  projectPath: string,
  dimId: string,
  result: ProposalResult,
  meta: { extractedBy: string; verified: boolean; universeContent: string },
): Promise<void> {
  const record: ProposalRecord = {
    ...result,
    dimId,
    extractedFrom: `.danteforge/compete/universe/${dimId}.md`,
    extractedAt: new Date().toISOString(),
    extractedBy: meta.extractedBy,
    verified: meta.verified,
    universeSha256: hashUniverseContent(meta.universeContent),
  };
  await fs.mkdir(proposalsDir(projectPath), { recursive: true });
  await fs.writeFile(proposalPath(projectPath, dimId), JSON.stringify(record, null, 2), 'utf8');
}

function makeExtractionPacket(
  dimId: string,
  dimName: string,
  universeContent: string,
  existingCapabilityTest: ProposalOptions['existingCapabilityTest'],
  existingOutcomeIds: string[],
): WorkPacket {
  const capTestNote = existingCapabilityTest
    ? `Already has capability_test: "${existingCapabilityTest.command}" — set proposedCapabilityTest to null.`
    : `No capability_test exists — propose one that proves ${dimName} works at the most basic level.`;

  const existingNote = existingOutcomeIds.length > 0
    ? `Do NOT duplicate these existing outcome IDs: ${existingOutcomeIds.join(', ')}`
    : 'No existing outcomes — all proposals are new.';

  return {
    id: `universe-propose.${dimId}.${Date.now()}`,
    dimensionId: dimId,
    objective: [
      `You are a capability-test extractor for the **${dimName}** dimension of DanteForge.`,
      ``,
      `CONTEXT: DanteForge is a provider-agnostic AI coding assistant optimizer — a meta-layer applied ON TOP OF`,
      `Claude Code, Codex, Cursor, Aider, Grok Build, etc. Tests must prove DanteForge's OPTIMIZER capability,`,
      `not the underlying coding assistant. Tests run against the DanteForge TypeScript/Node.js codebase.`,
      ``,
      `A verified competitive universe file exists. Extract runnable shell tests from it.`,
      `These tests will be run by \`danteforge validate ${dimId}\` to lift score ceilings above 7.0.`,
      ``,
      `## Rules for proposed commands`,
      `- Run from repo root (e.g. X:\\Projects\\DanteForge)`,
      `- Deterministic: no external network calls, no LLM — or short timeout (≤60s)`,
      `- Exit 0 on success, non-zero on failure`,
      `- shell: npm scripts, npx tsx, node scripts — check exit code`,
      `- runtime-exec: node/tsx script or test file that exercises real code paths`,
      `- DO NOT propose cli-smoke: it requires a different field format not supported here`,
      `- Propose the tier that HONESTLY reflects what the test proves (T2=code exists, T5=smoke pass, T7=multi-receipt consensus)`,
      `- required_callsite: the src/ file the outcome exercises (mandatory — every outcome must have one)`,
      ``,
      `## Capability test`,
      capTestNote,
      ``,
      `## Existing outcomes (do not duplicate)`,
      existingNote,
      ``,
      `## Universe file`,
      `<universe>`,
      universeContent.slice(0, 8_000),
      `</universe>`,
      ``,
      `Output EXACTLY ONE JSON block with this structure:`,
      '```capability-proposals',
      JSON.stringify({
        proposedCapabilityTest: existingCapabilityTest ? null : {
          command: `node dist/index.js ${dimId} --dry-run`,
          description: `Basic smoke test for ${dimName}`,
        },
        proposedOutcomes: [
          {
            id: `${dimId}_t5_u_1`,
            tier: 'T5',
            kind: 'runtime-exec',
            command: 'npx tsx --test tests/specific.test.ts',
            expected_exit: 0,
            expected_output_pattern: 'pass',
            timeout_ms: 60000,
            required_callsite: `src/path/to/relevant-module.ts`,
            description: `Example — replace with real test that proves ${dimName} capability`,
          },
        ],
      }, null, 2),
      '```',
      ``,
      `Propose 2–4 outcomes. Use real commands from the universe file's "Builder checklist" and "Judge scoring criteria".`,
      `Only use commands that would actually work in this TypeScript Node.js project.`,
    ].join('\n'),
    acceptanceCriteria: ['Output contains a capability-proposals JSON block'],
    proof: { proofRequired: ['capability-proposals JSON block present'] },
    globalForbidden: ['.danteforge/compete/matrix.json', '.danteforge/compete/universe/**'],
    context: { mode: 'propose-only' },
  } as unknown as WorkPacket;
}

function parseProposalOutput(output: string): ProposalResult | null {
  const blockMatch = /```capability-proposals\s*([\s\S]*?)```/.exec(output);
  if (!blockMatch) return null;

  try {
    const raw = JSON.parse(blockMatch[1]!.trim()) as {
      proposedCapabilityTest?: { command: string; description: string } | null;
      proposedOutcomes?: ProposedOutcome[];
    };

    const outcomes = (raw.proposedOutcomes ?? []).filter(o =>
      o.id && o.command && o.tier &&
      (o.kind === 'shell' || o.kind === 'runtime-exec') &&
      typeof o.expected_exit === 'number' &&
      typeof o.required_callsite === 'string' && o.required_callsite.length > 0,
    );

    return {
      proposedCapabilityTest: raw.proposedCapabilityTest ?? null,
      proposedOutcomes: outcomes,
    };
  } catch {
    return null;
  }
}

function makeExtractorAdapter(extractor: 'claude-code' | 'codex', workPacket: WorkPacket) {
  if (extractor === 'codex') return new CodexAdapter({ workPacket });
  return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
}

export async function extractCapabilityProposals(opts: ProposalOptions): Promise<ProposalResult | null> {
  const {
    projectPath,
    dimId,
    dimName,
    universeContent,
    existingCapabilityTest,
    existingOutcomeIds = [],
    extractor,
    timeoutMs = 300_000,
    _runAdapter: _run = runAdapter,
  } = opts;

  const workPacket = makeExtractionPacket(dimId, dimName, universeContent, existingCapabilityTest, existingOutcomeIds);
  const lease = makeReadOnlyLease(projectPath, 'universe-propose');
  const adapter = makeExtractorAdapter(extractor, workPacket);

  try {
    const available = await adapter.isAvailable();
    if (!available) {
      logger.warn(`[universe-propose] ${extractor} not available for ${dimId}`);
      return null;
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Proposal timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    const result = await Promise.race([_run(adapter, { lease }), timeoutPromise]);
    const parsed = parseProposalOutput(result.output ?? '');

    if (!parsed) {
      logger.warn(`[universe-propose] ${dimId}: no capability-proposals block in output`);
      return null;
    }

    logger.info(`[universe-propose] ${dimId}: ${parsed.proposedOutcomes.length} outcomes proposed`);
    return parsed;
  } catch (err) {
    logger.warn(`[universe-propose] ${dimId} failed: ${String(err).split('\n')[0]}`);
    return null;
  }
}
