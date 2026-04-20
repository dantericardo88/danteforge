// src/cli/commands/score-rubric.ts — Triple-rubric scoring CLI commands

import fs from 'node:fs/promises';
import path from 'node:path';
import { DIMENSIONS_28, getDimension } from '../../scoring/dimensions.js';
import { parseEvidenceFile } from '../../scoring/evidence.js';
import { runMatrix, diffSnapshots } from '../../scoring/run-matrix.js';
import { formatMarkdownReport, formatDiffReport, formatJsonSnapshot, parseJsonSnapshot } from '../../scoring/report.js';
import { ALL_RUBRIC_IDS } from '../../scoring/rubrics.js';
import type { RubricId, EvidenceRecord, DimensionDefinition } from '../../scoring/types.js';

// ── Injection seams ───────────────────────────────────────────────────────────

export interface ScoreRubricOptions {
  matrix?: string;
  subject?: string;
  evidence?: string;
  rubrics?: string;
  out?: string;
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, d: string) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
  _emit?: (msg: string) => void;
}

export interface ScoreDiffOptions {
  before: string;
  after: string;
  out?: string;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, d: string) => Promise<void>;
  _emit?: (msg: string) => void;
}

// ── rubric-score command ──────────────────────────────────────────────────────

export async function rubricScore(options: ScoreRubricOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = options._writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
  const mkdir = options._mkdir ?? ((p: string) => fs.mkdir(p, { recursive: true }).then(() => {}));
  const emit = options._emit ?? ((msg: string) => console.log(msg));

  emit('[rubric-score] Starting triple-rubric scoring...');

  // 1. Load dimensions
  const dimensions: DimensionDefinition[] = DIMENSIONS_28;
  const matrixId = options.matrix ?? 'product-28';

  // 2. Load evidence
  let evidence: EvidenceRecord[] = [];
  if (options.evidence) {
    const evidencePath = path.resolve(cwd, options.evidence);
    try {
      const raw = await readFile(evidencePath);
      evidence = parseEvidenceFile(raw);
      emit(`[rubric-score] Loaded ${evidence.length} evidence records from ${evidencePath}`);
    } catch (e) {
      emit(`[rubric-score] Warning: could not load evidence file: ${(e as Error).message}`);
      emit('[rubric-score] Proceeding with empty evidence (all dims will score 0).');
    }
  } else {
    emit('[rubric-score] No --evidence file provided. Scoring with empty evidence.');
  }

  // 3. Parse rubric IDs
  const rubricIds: RubricId[] = options.rubrics
    ? (options.rubrics.split(',').map((r) => r.trim()) as RubricId[])
    : ALL_RUBRIC_IDS;

  for (const id of rubricIds) {
    if (!ALL_RUBRIC_IDS.includes(id as RubricId)) {
      throw new Error(`Unknown rubric: ${id}. Valid: ${ALL_RUBRIC_IDS.join(', ')}`);
    }
  }

  const subject = options.subject ?? 'Unknown';

  // 4. Run matrix
  emit(`[rubric-score] Running matrix for "${subject}" on ${dimensions.length} dimensions × ${rubricIds.length} rubrics...`);
  const snapshot = runMatrix({ matrixId, subject, dimensions, evidence, rubricIds });

  // 5. Emit summary
  emit('');
  emit(`## ${subject} — Triple Rubric Score`);
  emit('');
  for (const r of snapshot.rubricScores) {
    const pct = r.normalized.toFixed(1);
    emit(`  ${r.rubricId.padEnd(24)} ${r.total.toString().padStart(6)} / ${r.maxTotal}  (${pct}%)`);
  }
  emit('');

  // 6. Write outputs
  const outBase = options.out
    ? path.resolve(cwd, options.out.replace(/\.(md|json)$/, ''))
    : path.join(cwd, '.danteforge', 'reports', `${subject.toLowerCase().replace(/\s+/g, '-')}-score`);

  const outDir = path.dirname(outBase);
  await mkdir(outDir);

  const mdPath = `${outBase}.md`;
  const jsonPath = `${outBase}.json`;

  const mdReport = formatMarkdownReport(snapshot);
  const jsonReport = formatJsonSnapshot(snapshot);

  await writeFile(mdPath, mdReport);
  await writeFile(jsonPath, jsonReport);

  emit(`[rubric-score] Markdown report: ${mdPath}`);
  emit(`[rubric-score] JSON snapshot:   ${jsonPath}`);
}

// ── rubric-score:diff command ─────────────────────────────────────────────────

export async function rubricScoreDiff(options: ScoreDiffOptions): Promise<void> {
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = options._writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
  const emit = options._emit ?? ((msg: string) => console.log(msg));

  const beforeRaw = await readFile(options.before);
  const afterRaw = await readFile(options.after);

  const beforeSnapshot = parseJsonSnapshot(beforeRaw);
  const afterSnapshot = parseJsonSnapshot(afterRaw);

  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  const report = formatDiffReport(diff);

  emit(report);

  if (options.out) {
    await writeFile(options.out, report);
    emit(`[rubric-score:diff] Diff report: ${options.out}`);
  }
}

// ── Dimension show helper ─────────────────────────────────────────────────────

export function showDimension(id: string, emit = console.log): void {
  const dim = getDimension(id);
  if (!dim) {
    emit(`Unknown dimension: ${id}`);
    return;
  }
  emit(`\n${dim.name} (${dim.id})`);
  emit(`Category: ${dim.category}`);
  emit(`Max score: ${dim.maxScore}${dim.hardCeiling !== undefined ? ` (ceiling: ${dim.hardCeiling})` : ''}`);
  emit(`Description: ${dim.description}`);
  emit(`Required evidence types: ${dim.requiredEvidenceTypes.join(', ')}`);
}
