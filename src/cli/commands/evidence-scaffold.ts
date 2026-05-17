import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvidenceScaffoldOptions {
  cwd?: string;
  dryRun?: boolean;
  projectType?: 'npm' | 'go' | 'python' | 'custom';
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _writeMatrix?: (m: CompeteMatrix, p: string) => Promise<void>;
}

export interface ScaffoldResult {
  autoDetected: string[];
  stubGenerated: string[];
  alreadyHave: string[];
  skipped: string[];
  matrixPath: string;
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

async function writeStubScript(dir: string, dimId: string, writeFn: (p: string, c: string) => Promise<void>): Promise<string> {
  const scriptPath = path.join(dir, `${dimId}.sh`);
  const stub = [
    '#!/bin/bash',
    `# TODO: implement capability test for dimension: ${dimId}`,
    '# Exit 0 = dimension verified  |  Exit 1 = not verified',
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
    matrixPath,
  };

  let matrixDirty = false;

  for (const dim of matrix.dimensions) {
    const ct = (dim as unknown as Record<string, unknown>).capability_test;
    if (ct !== null && ct !== undefined) {
      result.alreadyHave.push(dim.id);
      continue;
    }

    const command = scaffoldMap[dim.id] ?? scaffoldMap['_default'];
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

  if (!dryRun && matrixDirty) {
    await writeMatrix(matrix, matrixPath);
    logger.success('[evidence-scaffold] matrix.json updated.');
  }

  logger.info('');
  logger.success(`[evidence-scaffold] ${dryRun ? 'DRY RUN — ' : ''}Summary:`);
  logger.info(`  ✓ Already have capability_test: ${result.alreadyHave.length}`);
  logger.info(`  ✓ Auto-detected:               ${result.autoDetected.length}`);
  logger.warn(`  ⚠ Stubs generated (edit them): ${result.stubGenerated.length}`);
  if (result.skipped.length) logger.info(`  ⊘ Skipped:                    ${result.skipped.length}`);
  if (result.stubGenerated.length > 0) {
    logger.info('');
    logger.info('  Edit stub scripts at: .danteforge/capability-tests/');
    logger.info('  Then run: danteforge evidence-audit --run-tests');
  }

  return result;
}
