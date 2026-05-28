// Matrix Kernel — CouncilUniverseProposals
//
// Extracts runnable capability-test proposals from verified universe files.
// Proposals are saved to .danteforge/compete/universe-proposals/<dimId>.json
// and applied to matrix.json via council-universe-apply (kernel-controlled write).
//
// A proposal is NOT a score change — it's a candidate outcome entry (shell/cli-smoke/
// runtime-exec) that can be run by `danteforge validate <dimId>` to produce real
// receipts and unlock scores above 7.0 via the existing receipt-ceiling system.
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import { makeReadOnlyLease } from './council-worktree.js';

export interface ProposedOutcome {
  id: string;
  tier: 'T2' | 'T5' | 'T7';
  kind: 'shell' | 'cli-smoke' | 'runtime-exec';
  command: string;
  expected_exit: number;
  expected_output_pattern?: string;
  timeout_ms: number;
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
  meta: { extractedBy: string; verified: boolean },
): Promise<void> {
  const record: ProposalRecord = {
    ...result,
    dimId,
    extractedFrom: `.danteforge/compete/universe/${dimId}.md`,
    extractedAt: new Date().toISOString(),
    extractedBy: meta.extractedBy,
    verified: meta.verified,
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
      `A verified competitive universe file exists. Extract runnable shell tests from it.`,
      `These tests will be run by \`danteforge validate ${dimId}\` to lift score ceilings above 7.0.`,
      ``,
      `## Rules for proposed commands`,
      `- Run from repo root (e.g. X:\\Projects\\DanteForge)`,
      `- Deterministic: no external network calls, no LLM — or short timeout (≤60s)`,
      `- Exit 0 on success, non-zero on failure`,
      `- shell: npm scripts, npx tsx, node scripts — check exit code`,
      `- cli-smoke: \`node dist/index.js <cmd>\` — check exit + optional stdout pattern`,
      `- runtime-exec: node/tsx script that exercises real code paths`,
      `- Tier T5 preferred (≤7 days freshness window) — unlock score ceiling to 8.0`,
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
            kind: 'shell',
            command: 'npm run test:smoke',
            expected_exit: 0,
            expected_output_pattern: 'pass',
            timeout_ms: 30000,
            description: `Example — replace with real test from universe criteria`,
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
      o.id && o.kind && o.command && o.tier && typeof o.expected_exit === 'number',
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
