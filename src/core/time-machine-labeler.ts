/**
 * time-machine-labeler.ts
 *
 * Interactive human adjudication loop for Time Machine causal attribution labels.
 * Reads label-candidates.json (from build-corpus), shows each candidate with the
 * model-suggested classification, prompts for human confirmation or override,
 * and writes the final labels.json accepted by eval-attribution.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import type { CausalClassification } from './time-machine-causal-attribution.js';
import type { TimeMachineLabelCandidate } from './time-machine-corpus.js';

export interface LabelCandidatesFile {
  schemaVersion: string;
  candidates: TimeMachineLabelCandidate[];
  storePath?: string;
}

export interface HumanLabel {
  nodeId: string;
  expected: CausalClassification;
  humanConfirmed: boolean;
  labeledAt: string;
}

export interface LabelsOutput {
  schemaVersion: 'danteforge.time-machine.labels.v1';
  humanAdjudicated: boolean;
  createdAt: string;
  branchPointId: string;
  sessionId: string;
  originalTimelineId: string;
  alternateTimelineId: string;
  labels: HumanLabel[];
}

export interface LabelSessionOptions {
  candidatesFile: string;
  outFile: string;
  /** Accept all suggestions automatically without prompting (for testing/automation) */
  auto?: boolean;
  /** Max candidates to label in this session (default: all) */
  limit?: number;
  out?: (line: string) => void;
}

export interface LabelSessionResult {
  total: number;
  labeled: number;
  skipped: number;
  outFile: string;
}

const LABEL_KEYS: Record<string, CausalClassification> = {
  '1': 'independent',
  '2': 'dependent-adaptable',
  '3': 'dependent-incompatible',
  i: 'independent',
  d: 'dependent-adaptable',
  x: 'dependent-incompatible',
};

function classificationIndex(c: CausalClassification): string {
  if (c === 'independent') return '1';
  if (c === 'dependent-adaptable') return '2';
  return '3';
}

function truncate(s: string, maxLen = 120): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

export async function runLabelSession(options: LabelSessionOptions): Promise<LabelSessionResult> {
  const out = options.out ?? ((line: string) => process.stdout.write(line + '\n'));
  const candidatesPath = path.resolve(options.candidatesFile);

  if (!existsSync(candidatesPath)) {
    throw new Error(`candidates file not found: ${candidatesPath}\nRun 'danteforge time-machine node build-corpus' first.`);
  }

  const raw = await fs.readFile(candidatesPath, 'utf8');
  const candidatesFile = JSON.parse(raw) as LabelCandidatesFile;
  const allCandidates = candidatesFile.candidates ?? [];

  // Load existing labels if out file already exists (resume support)
  let existingLabels: HumanLabel[] = [];
  const outPath = path.resolve(options.outFile);
  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(await fs.readFile(outPath, 'utf8')) as LabelsOutput;
      existingLabels = existing.labels ?? [];
    } catch { /* start fresh */ }
  }
  const labeledIds = new Set(existingLabels.map(l => l.nodeId));

  const unlabeled = allCandidates
    .filter(c => !labeledIds.has(c.nodeId))
    .slice(0, options.limit ?? allCandidates.length);

  if (unlabeled.length === 0) {
    out('All candidates already labeled. Use --out to write a new file or delete existing labels.json to restart.');
    return { total: allCandidates.length, labeled: 0, skipped: 0, outFile: outPath };
  }

  const firstCandidate = allCandidates[0];
  const newLabels: HumanLabel[] = [...existingLabels];
  let skipped = 0;

  if (!options.auto) {
    out('');
    out('══════════════════════════════════════════════════════');
    out('  DanteForge Time Machine — Human Label Adjudication');
    out('══════════════════════════════════════════════════════');
    out(`  Candidates to label: ${unlabeled.length} (${labeledIds.size} already done)`);
    out('');
    out('  [1/i] independent   [2/d] dependent-adaptable   [3/x] dependent-incompatible');
    out('  [Enter] accept suggestion   [s] skip   [q] quit and save progress');
    out('');
  }

  if (options.auto) {
    for (const candidate of unlabeled) {
      newLabels.push({
        nodeId: candidate.nodeId,
        expected: candidate.suggested,
        humanConfirmed: false,
        labeledAt: new Date().toISOString(),
      });
    }
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (prompt: string): Promise<string> =>
      new Promise(resolve => rl.question(prompt, resolve));

    try {
      for (let i = 0; i < unlabeled.length; i++) {
        const candidate = unlabeled[i]!;
        const suggested = candidate.suggested;
        const suggestedIdx = classificationIndex(suggested);

        out(`──── ${i + 1} / ${unlabeled.length} ─────────────────────────────────────────────`);
        out(`  Session:  ${candidate.sessionId}`);
        out(`  Node:     ${candidate.nodeId}`);
        out(`  Branch:   ${candidate.branchPointId}`);
        out(`  Reason:   ${truncate(candidate.reason)}`);
        out(`  Suggested: [${suggestedIdx}] ${suggested}`);
        out('');

        const answer = await question(`  Label [${suggestedIdx}]: `);
        const trimmed = answer.trim().toLowerCase();

        if (trimmed === 'q') {
          out('  Saving progress and exiting...');
          break;
        }
        if (trimmed === 's') {
          skipped++;
          out('  Skipped.');
          out('');
          continue;
        }

        const label: CausalClassification = LABEL_KEYS[trimmed] ?? suggested;
        newLabels.push({
          nodeId: candidate.nodeId,
          expected: label,
          humanConfirmed: true,
          labeledAt: new Date().toISOString(),
        });
        if (label !== suggested) {
          out(`  Saved: ${label} (overrode suggestion)`);
        } else {
          out(`  Saved: ${label}`);
        }
        out('');
      }
    } finally {
      rl.close();
    }
  }

  const output: LabelsOutput = {
    schemaVersion: 'danteforge.time-machine.labels.v1',
    humanAdjudicated: !options.auto,
    createdAt: new Date().toISOString(),
    branchPointId: firstCandidate?.branchPointId ?? '',
    sessionId: firstCandidate?.sessionId ?? '',
    originalTimelineId: firstCandidate?.originalTimelineId ?? '',
    alternateTimelineId: firstCandidate?.alternateTimelineId ?? '',
    labels: newLabels,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const labeled = newLabels.length - existingLabels.length;
  if (!options.auto) {
    out('');
    out(`  Saved ${labeled} new label(s) to: ${outPath}`);
    out(`  Total labeled: ${newLabels.length} / ${allCandidates.length}`);
    if (newLabels.length >= 100) {
      out('  ✓ 100-label threshold met — ready for eval-attribution');
    } else {
      out(`  Need ${100 - newLabels.length} more label(s) to meet the 100-label threshold.`);
    }
    out('');
  }

  return { total: allCandidates.length, labeled, skipped, outFile: outPath };
}
