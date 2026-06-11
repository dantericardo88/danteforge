import fs from 'node:fs/promises';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { MARKET_DIMS_SCORE_CAP } from '../../core/compete-matrix-score.js';
import { logger } from '../../core/logger.js';
import { detectProductProbes, type ProductProbe } from './evidence-scaffold-detect.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvidenceScaffoldOptions {
  cwd?: string;
  dryRun?: boolean;
  projectType?: 'npm' | 'go' | 'python' | 'custom';
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _writeMatrix?: (m: CompeteMatrix, p: string) => Promise<void>;
  /**
   * Time Machine integration seam. Tri-state:
   *   undefined → lazy-import the real createTimeMachineCommit (production)
   *   null      → disable
   *   function  → injected mock
   * Best-effort: TM failures never block the scaffold write.
   */
  _createTimeMachineCommit?: ((opts: import('../../core/time-machine.js').CreateTimeMachineCommitOptions) => Promise<unknown>) | null;
  /** Product-probe detection seam (defaults to the real detectProductProbes). */
  _detectProbes?: (cwd: string) => ProductProbe[];
}

export interface ScaffoldResult {
  autoDetected: string[];
  stubGenerated: string[];
  alreadyHave: string[];
  skipped: string[];
  /** Dims whose capability_test came from a runnable product probe (generic-repo detection). */
  probeDetected: string[];
  /** Dims whose capability_test is a failing scaffold carrying a needsInput candidate + scaffold_note
   *  — routed to the yardstick author instead of the build loop. */
  probeAuthorRouted: string[];
  /** Dims that received a failing T5 outcome scaffold-marker (the 7→9 depth-path requirement). */
  outcomeStubsGenerated: string[];
  /** Dims whose T5 outcome came from a runnable product probe (real command, not `exit 1`). */
  outcomeProbesGenerated: string[];
  /** Dims whose T5 outcome is a failing scaffold carrying a needsInput candidate + scaffold_note. */
  outcomeAuthorRouted: string[];
  /** Dims that already declared outcomes (left untouched). */
  outcomesAlreadyHave: string[];
  matrixPath: string;
}

/**
 * Build a failing T5 outcome scaffold-marker for a dimension. The command is `exit 1` and the
 * callsite is a to-be-filled marker, so the outcome is declared (the 7→9 depth path is
 * now visible) but cannot pass until a human replaces it with a real smoke check
 * that produces an observable artifact. `_scaffold: true` keeps it INFERRED so it can
 * never contribute to a T7 receipt even if someone flips the command to `exit 0`.
 */
function buildOutcomeStub(dimId: string, label: string, candidate?: ProductProbe): Record<string, unknown> {
  return {
    id: `${dimId}-t5-scaffold`,
    kind: 'shell',
    tier: 'T5',
    description:
      `SCAFFOLD — replace with a real T5 smoke check that produces an observable ` +
      `artifact proving "${label}" works in production. Until then this dimension is ` +
      `capped at 7.0 (depth doctrine).`,
    command: 'exit 1',
    expected_exit: 0,
    required_callsite: 'TODO-set-real-callsite',
    // Declared provenance: a scaffold is agent-authored starter data. This caps it
    // at 7.0 structurally, so a scaffold can never drift up to a frontier score even if
    // its command is later flipped to exit 0 without real provenance being declared.
    input_source: { type: 'synthetic-fixture', fixture_id: 'matrix-build-scaffold' },
    _scaffold: true,
    // A detected entrypoint with no derivable realistic input keeps the failing scaffold
    // (honest) but carries the candidate + a marker so `capability-test conduct` routes the
    // dim to the yardstick author instead of letting the build loop churn on `exit 1`.
    ...(candidate ? { candidate_command: candidate.command, scaffold_note: scaffoldNoteFor(candidate) } : {}),
  };
}

/** The author-routing marker: names the detected entrypoint and exactly what realistic input is missing. */
function scaffoldNoteFor(candidate: ProductProbe): string {
  return (
    `Runnable ${candidate.language} entrypoint detected via ${candidate.source} ` +
    `(\`${candidate.command}\`), but ${candidate.missingInput ?? 'no realistic input is derivable'}. ` +
    `Route to the yardstick author (capability-test conduct) to supply a realistic input — ` +
    `do not churn the build loop on this failing scaffold.`
  );
}

/**
 * Build a T5 outcome from a RUNNABLE product probe — a real invocation of the repo's own
 * entrypoint, not `exit 1`. Kind is runtime-exec, NOT cli-smoke: cli-smoke spawns DanteForge's
 * own binary with cli_args[], while a generic-repo probe is one shell command string.
 * Honest tier: T5 with no input_source claim (absent provenance caps at 8.0 structurally) and a
 * to-be-filled callsite marker, so a probe can never launder itself into a frontier receipt.
 */
function buildProbeOutcome(dimId: string, label: string, probe: ProductProbe): Record<string, unknown> {
  return {
    id: `${dimId}-t5-product-probe`,
    kind: 'runtime-exec',
    tier: 'T5',
    description:
      `PRODUCT PROBE (auto-detected from ${probe.source}, ${probe.language}) — runs the repo's ` +
      `real entrypoint as the T5 smoke check for "${label}". Confirm the callsite and tighten ` +
      `the assertion before trusting it beyond T5.`,
    command: probe.command,
    expected_exit: 0,
    timeout_ms: 120000,
    required_callsite: 'TODO-set-real-callsite',
    product_probe: { source: probe.source, language: probe.language, confidence: probe.confidence },
  };
}

// ── Scaffold map: dim ID → shell command per project type ─────────────────────

const NPM_SCAFFOLD: Record<string, string> = {
  testing:                 'npm test 2>&1 | tail -5',
  security:                'npm run check:anti-stub 2>&1 | tail -5',
  maintainability:         'npm run check:file-size 2>&1 | tail -3',
  functionality:           'node dist/index.js --help 2>&1 | head -3',
  developer_experience:    'node dist/index.js go --help 2>&1 | head -3',
  ux_polish:               'node dist/index.js init --non-interactive 2>&1 | tail -3',
  autonomy:                'node dist/index.js autoforge --dry-run --score-only 2>&1 | tail -3',
  error_handling:          'node dist/index.js doctor 2>&1 | tail -3',
  performance:             'npm run build 2>&1 | tail -3',
  documentation:           'node dist/index.js wiki-status 2>&1 | tail -3',
  convergence_self_healing: 'node dist/index.js autoforge --score-only 2>&1 | tail -3',
  spec_driven_pipeline:    'node dist/index.js specify --help 2>&1 | head -3',
  planning_quality:        'node dist/index.js plan --help 2>&1 | head -3',
};

const GO_SCAFFOLD: Record<string, string> = {
  testing:         'go test ./... 2>&1 | tail -5',
  security:        'go vet ./... 2>&1 | tail -5',
  maintainability: 'go build ./... 2>&1 | tail -3',
  functionality:   './main --help 2>&1 | head -3',
};

const PYTHON_SCAFFOLD: Record<string, string> = {
  testing:         'python -m pytest --tb=short 2>&1 | tail -10',
  security:        'python -m bandit -r src/ 2>&1 | tail -5',
  maintainability: 'python -m flake8 src/ 2>&1 | tail -5',
  functionality:   'python -m main --help 2>&1 | head -3',
};

const SCAFFOLD_MAPS: Record<string, Record<string, string>> = {
  npm: NPM_SCAFFOLD,
  go: GO_SCAFFOLD,
  python: PYTHON_SCAFFOLD,
  custom: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectProjectType(cwd: string): 'npm' | 'go' | 'python' | 'custom' {
  try {
    const entries = readdirSync(cwd);
    if (entries.includes('package.json')) return 'npm';
    if (entries.includes('go.mod')) return 'go';
    if (entries.includes('pyproject.toml') || entries.includes('setup.py')) return 'python';
  } catch { /* ignore */ }
  return 'custom';
}

async function writeStubScript(dir: string, dimId: string, writeFn: (p: string, c: string) => Promise<void>, candidate?: ProductProbe): Promise<string> {
  const scriptPath = path.join(dir, `${dimId}.sh`);
  const stub = [
    '#!/bin/bash',
    `# TODO: implement capability test for dimension: ${dimId}`,
    '# Exit 0 = dimension verified  |  Exit 1 = not verified',
    ...(candidate ? [
      `# Candidate entrypoint detected (${candidate.source}): ${candidate.command}`,
      `# Missing: ${candidate.missingInput ?? 'a realistic input'}`,
    ] : []),
    `echo "STUB: replace this with a real test for '${dimId}'"`,
    'exit 1',
  ].join('\n') + '\n';
  await writeFn(scriptPath, stub);
  return scriptPath;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runEvidenceScaffold(options: EvidenceScaffoldOptions = {}): Promise<ScaffoldResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const loadFn = options._loadMatrix ?? loadMatrix;
  const writeFn = options._writeFile ?? ((p, c) => fs.writeFile(p, c, 'utf8'));
  const writeMatrix = options._writeMatrix ?? ((m, p) => fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8'));

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('[evidence-scaffold] No compete matrix found. Run `danteforge compete --init` first.');
    throw new Error('No compete matrix found.');
  }

  const projectType = options.projectType ?? detectProjectType(cwd);
  const scaffoldMap = SCAFFOLD_MAPS[projectType] ?? {};
  const capTestsDir = path.join(cwd, '.danteforge', 'capability-tests');
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');

  const result: ScaffoldResult = {
    autoDetected: [],
    stubGenerated: [],
    alreadyHave: [],
    skipped: [],
    probeDetected: [],
    probeAuthorRouted: [],
    outcomeStubsGenerated: [],
    outcomeProbesGenerated: [],
    outcomeAuthorRouted: [],
    outcomesAlreadyHave: [],
    matrixPath,
  };

  let matrixDirty = false;

  // Prerequisite check for dim-keyed template commands: the referenced runtime surface must
  // EXIST in the target repo. `node <file>` needs the file on disk; `npm test`/`npm run X`
  // need that script in package.json. Anything else (npx tooling etc.) is allowed through —
  // the command may still fail honestly at run time, but it is not broken-by-construction.
  const pkgScripts = (() => {
    try {
      const raw = readFileSync(path.join(cwd, 'package.json'), 'utf8').replace(/^﻿/, '');
      return (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch { return {} as Record<string, string>; }
  })();
  const commandRunnableHere = (command: string, root: string): boolean => {
    const nodeFile = /(?:^|[;&|]\s*)node\s+([\w./\\-]+\.(?:m?[cj]s|js))/i.exec(command)?.[1];
    if (nodeFile && !existsSync(path.join(root, nodeFile))) return false;
    if (/(?:^|[;&|]\s*)npm\s+test\b/.test(command) && pkgScripts['test'] === undefined) return false;
    const runScript = /(?:^|[;&|]\s*)npm\s+run\s+([\w:.-]+)/.exec(command)?.[1];
    if (runScript && pkgScripts[runScript] === undefined) return false;
    return true;
  };

  // Capability-driven detection for generic/cold repos: when the dim-keyed maps find nothing,
  // probe the TARGET repo's real entrypoints (package.json bin/scripts, pyproject, Cargo, go)
  // instead of defaulting every dim to an `exit 1` scaffold the build loop churns on.
  const detectFn = options._detectProbes ?? detectProductProbes;
  let probesMemo: ProductProbe[] | null = null;
  const productProbes = (): ProductProbe[] => {
    if (probesMemo === null) {
      try { probesMemo = detectFn(cwd); } catch { probesMemo = []; }
    }
    return probesMemo;
  };
  const runnableProbe = (): ProductProbe | undefined => productProbes().find(p => !p.needsInput);
  const candidateProbe = (): ProductProbe | undefined => productProbes().find(p => p.needsInput);

  for (const dim of matrix.dimensions) {
    const ct = (dim as unknown as Record<string, unknown>).capability_test;
    if (ct !== null && ct !== undefined) {
      result.alreadyHave.push(dim.id);
      continue;
    }

    // A dim-keyed template command counts ONLY if the TARGET repo can actually run it. The live
    // cold-repo exam caught 13 false positives here: DanteForge-template commands (`node
    // dist/index.js --help`, `npm test`, `npm run check:anti-stub`) were claimed on a repo with
    // no dist/ and no such scripts — broken-by-construction yardsticks the loop then churns on.
    const dimKeyed = scaffoldMap[dim.id] ?? scaffoldMap['_default'];
    const command = dimKeyed && commandRunnableHere(dimKeyed, cwd) ? dimKeyed : undefined;
    const runnable = command ? undefined : runnableProbe();
    const candidate = command || runnable ? undefined : candidateProbe();
    if (command) {
      if (!dryRun) {
        (dim as unknown as Record<string, unknown>).capability_test = {
          command,
          description: `Auto-scaffolded capability test for ${dim.label}`,
          timeoutMs: 30000,
        };
        matrixDirty = true;
      }
      result.autoDetected.push(dim.id);
      logger.info(`[scaffold] ${dim.id}: auto-detected → ${command}`);
    } else if (runnable) {
      // A genuine runnable entrypoint detected from the repo itself — use it instead of a
      // failing scaffold. Arguments were derived, never invented (see evidence-scaffold-detect).
      if (!dryRun) {
        (dim as unknown as Record<string, unknown>).capability_test = {
          command: runnable.command,
          description: `Product-probe capability test for ${dim.label} (auto-detected from ${runnable.source})`,
          timeoutMs: 120000,
        };
        matrixDirty = true;
      }
      result.probeDetected.push(dim.id);
      logger.info(`[scaffold] ${dim.id}: product-probe detected (${runnable.source}) → ${runnable.command}`);
    } else if (candidate) {
      // Entrypoint exists but no realistic input is derivable: keep the failing scaffold
      // (honest) and mark it for the yardstick author via scaffold_note + candidate_command.
      if (!dryRun) {
        await fs.mkdir(capTestsDir, { recursive: true }).catch(() => { /* ignore */ });
        const scriptPath = await writeStubScript(capTestsDir, dim.id, writeFn, candidate);
        const rel = path.relative(cwd, scriptPath).replace(/\\/g, '/');
        (dim as unknown as Record<string, unknown>).capability_test = {
          command: `bash ${rel} 2>&1`,
          description: `Stub capability test for ${dim.label} — edit ${rel}`,
          timeoutMs: 30000,
          candidate_command: candidate.command,
          scaffold_note: scaffoldNoteFor(candidate),
        };
        matrixDirty = true;
      }
      result.probeAuthorRouted.push(dim.id);
      logger.warn(`[scaffold] ${dim.id}: entrypoint candidate (${candidate.source}) needs a realistic input — routed to the yardstick author`);
    } else {
      if (!dryRun) {
        await fs.mkdir(capTestsDir, { recursive: true }).catch(() => { /* ignore */ });
        const scriptPath = await writeStubScript(capTestsDir, dim.id, writeFn);
        const rel = path.relative(cwd, scriptPath).replace(/\\/g, '/');
        (dim as unknown as Record<string, unknown>).capability_test = {
          command: `bash ${rel} 2>&1`,
          description: `Stub capability test for ${dim.label} — edit ${rel}`,
          timeoutMs: 30000,
        };
        matrixDirty = true;
      }
      result.stubGenerated.push(dim.id);
      logger.warn(`[scaffold] ${dim.id}: stub generated — edit .danteforge/capability-tests/${dim.id}.sh`);
    }
  }

  // Outcome scaffolding (the 7→9 depth-path requirement). capability_test gates
  // ≤5→7; outcomes gate 7→9. A matrix that declares the first but not the second is
  // incomplete by its own scoring rules — every dim is silently capped at 7.0 with no
  // signal. Write a failing T5 scaffold-marker per receipt-eligible dim so the depth path is
  // visible and authorable. Market-cap dims are skipped: they are clamped to 5.0
  // regardless, so an outcome there would be pointless.
  for (const dim of matrix.dimensions) {
    const d = dim as unknown as Record<string, unknown>;
    const existing = d.outcomes;
    if (Array.isArray(existing) && existing.length > 0) {
      result.outcomesAlreadyHave.push(dim.id);
      continue;
    }
    if (MARKET_DIMS_SCORE_CAP.has(dim.id)) {
      result.skipped.push(dim.id);
      continue;
    }
    const runnable = runnableProbe();
    const candidate = runnable ? undefined : candidateProbe();
    if (runnable) {
      if (!dryRun) {
        d.outcomes = [buildProbeOutcome(dim.id, dim.label, runnable)];
        matrixDirty = true;
      }
      result.outcomeProbesGenerated.push(dim.id);
      logger.info(`[scaffold] ${dim.id}: T5 product-probe outcome written (\`${runnable.command}\`) — run \`danteforge validate ${dim.id}\` for a real receipt`);
    } else if (candidate) {
      if (!dryRun) {
        d.outcomes = [buildOutcomeStub(dim.id, dim.label, candidate)];
        matrixDirty = true;
      }
      result.outcomeAuthorRouted.push(dim.id);
      logger.warn(`[scaffold] ${dim.id}: entrypoint candidate (${candidate.source}) lacks a realistic input — failing scaffold kept, routed to the yardstick author (see scaffold_note)`);
    } else {
      if (!dryRun) {
        d.outcomes = [buildOutcomeStub(dim.id, dim.label)];
        matrixDirty = true;
      }
      result.outcomeStubsGenerated.push(dim.id);
      logger.warn(`[scaffold] ${dim.id}: T5 outcome stub written — replace its \`exit 1\` command with a real smoke check to unlock 7→9`);
    }
  }

  if (!dryRun && matrixDirty) {
    await writeMatrix(matrix, matrixPath);
    logger.success('[evidence-scaffold] matrix.json updated.');
    const touchedCount = result.autoDetected.length + result.stubGenerated.length
      + result.probeDetected.length + result.probeAuthorRouted.length;
    await recordScaffoldCommit(matrixPath, touchedCount, cwd, options._createTimeMachineCommit);
  }

  const probeDetectedCount = result.probeDetected.length + result.outcomeProbesGenerated.length;
  const authorRoutedCount = result.probeAuthorRouted.length + result.outcomeAuthorRouted.length;
  logger.info('');
  logger.success(`[evidence-scaffold] ${dryRun ? 'DRY RUN — ' : ''}Summary:`);
  logger.info(`  ✓ Already have capability_test: ${result.alreadyHave.length}`);
  logger.info(`  ✓ Auto-detected (dim-keyed):   ${result.autoDetected.length}`);
  logger.info(`  ✓ Product-probe detected:      ${probeDetectedCount} (${result.probeDetected.length} cap-test, ${result.outcomeProbesGenerated.length} outcome)`);
  logger.warn(`  ⚠ Author-routed candidates:    ${authorRoutedCount} (${result.probeAuthorRouted.length} cap-test, ${result.outcomeAuthorRouted.length} outcome — see scaffold_note)`);
  logger.warn(`  ⚠ Cap-test stubs (edit them):  ${result.stubGenerated.length}`);
  logger.info(`  ✓ Already declare outcomes:    ${result.outcomesAlreadyHave.length}`);
  logger.warn(`  ⚠ Outcome stubs (edit them):   ${result.outcomeStubsGenerated.length}`);
  if (result.skipped.length) logger.info(`  ⊘ Skipped (market-cap dims):   ${result.skipped.length}`);
  if (result.stubGenerated.length > 0) {
    logger.info('');
    logger.info('  Edit stub scripts at: .danteforge/capability-tests/');
    logger.info('  Then run: danteforge evidence-audit --run-tests');
  }
  if (result.outcomeStubsGenerated.length > 0) {
    logger.info('');
    logger.info(`  ${result.outcomeStubsGenerated.length} dim(s) now declare a T5 outcome stub (capped at 7.0 until real).`);
    logger.info('  Replace each stub\'s `exit 1` command in matrix.json with a real smoke check,');
    logger.info('  then run: danteforge validate <dim>  (twice, across sessions) to unlock 7→9.');
  }
  if (result.outcomeProbesGenerated.length > 0) {
    logger.info('');
    logger.info(`  ${result.outcomeProbesGenerated.length} dim(s) carry a T5 product-probe outcome (real entrypoint run).`);
    logger.info('  Run: danteforge validate <dim>  to produce real receipts.');
  }
  if (authorRoutedCount > 0) {
    logger.info('');
    logger.info(`  ${authorRoutedCount} candidate(s) need a realistic input (see scaffold_note in matrix.json).`);
    logger.info('  Run: danteforge capability-test conduct  to route them to the yardstick author.');
  }

  return result;
}

/**
 * Phase H Time Machine integration: record the matrix.json mutation as a
 * causal commit. Mirrors outcome-runner.ts:recordOutcomeEvidenceCommit pattern.
 * Best-effort — TM failures never block the scaffold work.
 */
async function recordScaffoldCommit(
  matrixPath: string,
  dimsTouched: number,
  cwd: string,
  override?: EvidenceScaffoldOptions['_createTimeMachineCommit'],
): Promise<void> {
  if (override === null) return;
  try {
    const createFn = override
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    await createFn({
      cwd,
      paths: [matrixPath],
      label: `outcome-scaffold/${dimsTouched}-dims`,
      causalLinks: {
        materials: [matrixPath],
        inputDependencies: [],
      },
    });
  } catch {
    // best-effort
  }
}
