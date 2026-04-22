// matrix-confirm.ts — Confirmation gate before any autonomous improvement loop.
// Displays the competitive landscape and asks the user to confirm or amend it
// before ascend/compete-auto starts cycling. Amendment changes are persisted immediately.

import type { CompeteMatrix } from './compete-matrix.js';
import { removeCompetitor, dropDimension, recategorizeDimension, setDimensionWeight, saveMatrix } from './compete-matrix.js';

export interface MatrixConfirmOptions {
  cwd?: string;
  _confirm?: (message: string) => Promise<boolean>;
  _askQuestion?: (q: string) => Promise<string>;
  _stdout?: (line: string) => void;
  _isTTY?: boolean;
  _saveMatrix?: typeof saveMatrix;
}

// ── Display helpers ──────────────────────────────────────────────────────────

function formatDimRow(dim: { id: string; label?: string; category?: string; scores: Record<string, number>; ceiling?: number; status?: string }): string {
  const self = dim.scores['self'] ?? 0;
  const score = self.toFixed(1);
  let flag = self >= 9.0 ? '✅' : '🔄';
  if (dim.ceiling !== undefined) flag = `⚠️  ceiling ${dim.ceiling.toFixed(1)}`;
  const cat = (dim.category ?? 'unknown').padEnd(12);
  return `    ${dim.id.padEnd(28)} [${cat}]  self: ${score}/10  ${flag}`;
}

function renderLandscape(matrix: CompeteMatrix, emit: (l: string) => void): void {
  emit('');
  emit('  Competitive landscape:');
  emit('');
  const oss = matrix.competitors_oss ?? [];
  const closed = matrix.competitors_closed_source ?? [];
  const all = matrix.competitors ?? [];
  if (oss.length > 0) {
    emit(`  Competitors (OSS — harvestable):   ${oss.join('  •  ')}`);
  }
  if (closed.length > 0) {
    emit(`  Competitors (Closed-source — gold): ${closed.join('  •  ')}`);
  }
  if (oss.length === 0 && closed.length === 0 && all.length > 0) {
    emit(`  Competitors: ${all.join('  •  ')}`);
  }
  emit('');
  emit(`  Scoring dimensions (${matrix.dimensions.length} total):`);
  for (const dim of matrix.dimensions) {
    emit(formatDimRow(dim));
  }
  emit('');
}

// ── Default I/O (readline, TTY-safe) ─────────────────────────────────────────

async function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // non-interactive: auto-confirm
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

async function defaultAskQuestion(q: string): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(`${q} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Amendment loop ────────────────────────────────────────────────────────────

async function runAmendmentLoop(
  matrix: CompeteMatrix,
  cwd: string,
  askFn: (q: string) => Promise<string>,
  emit: (l: string) => void,
  saveFn: typeof saveMatrix,
): Promise<boolean> {
  while (true) {
    emit('');
    emit('  What would you like to change?');
    emit('    1. Remove a competitor');
    emit('    2. Drop a scoring dimension');
    emit('    3. Recategorize a dimension');
    emit('    4. Adjust a dimension weight');
    emit('    5. Save & continue');
    emit('    6. Abort');
    const choice = await askFn('  > ');

    if (choice === '1') {
      const name = await askFn('  Competitor name to remove: ');
      if (name) {
        removeCompetitor(matrix, name);
        await saveFn(matrix, cwd);
        emit(`  ✓ Removed "${name}" from matrix.`);
      }
    } else if (choice === '2') {
      const id = await askFn('  Dimension ID to drop (e.g. community_adoption): ');
      if (id) {
        dropDimension(matrix, id);
        await saveFn(matrix, cwd);
        emit(`  ✓ Dropped dimension "${id}".`);
      }
    } else if (choice === '3') {
      const id = await askFn('  Dimension ID to recategorize: ');
      const cat = await askFn('  New category (e.g. quality, autonomy, community, performance): ');
      if (id && cat) {
        recategorizeDimension(matrix, id, cat);
        await saveFn(matrix, cwd);
        emit(`  ✓ Dimension "${id}" recategorized to "${cat}".`);
      }
    } else if (choice === '4') {
      const id = await askFn('  Dimension ID to reweight: ');
      const wStr = await askFn('  New weight (e.g. 1.5 for high, 0.5 for low): ');
      const w = parseFloat(wStr);
      if (id && Number.isFinite(w)) {
        setDimensionWeight(matrix, id, w);
        await saveFn(matrix, cwd);
        emit(`  ✓ Dimension "${id}" weight set to ${w}.`);
      }
    } else if (choice === '5') {
      return true; // confirmed after amendments
    } else if (choice === '6') {
      return false; // aborted
    } else {
      emit('  Invalid choice. Enter 1-6.');
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Display the competitive landscape and ask the user to confirm before any
 * autonomous loop starts. Returns true (proceed) or false (abort).
 *
 * Non-TTY environments always return true (CI/headless safe).
 * Use --yes flag to skip by not calling this function.
 */
export async function confirmMatrix(
  matrix: CompeteMatrix,
  options: MatrixConfirmOptions = {},
): Promise<boolean> {
  const isTTY = options._isTTY ?? process.stdin.isTTY;
  const emit = options._stdout ?? ((l: string) => process.stdout.write(l + '\n'));
  const confirmFn = options._confirm ?? defaultConfirm;
  const askFn = options._askQuestion ?? defaultAskQuestion;
  const cwd = options.cwd ?? process.cwd();
  const saveFn = options._saveMatrix ?? saveMatrix;

  renderLandscape(matrix, emit);

  // Non-interactive: skip gate
  if (!isTTY && !options._confirm) return true;

  emit('  To amend via CLI (then re-run):');
  emit('    danteforge compete --remove-competitor <name>');
  emit('    danteforge compete --drop-dimension <id>');
  emit('    danteforge compete --edit');
  emit('');

  const confirmed = await confirmFn('  Proceed with this competitive landscape? [Y/n]');
  if (confirmed) return true;

  // Enter inline amendment loop
  const result = await runAmendmentLoop(matrix, cwd, askFn, emit, saveFn);
  if (result) {
    renderLandscape(matrix, emit);
    emit('  Landscape updated. Proceeding...');
  }
  return result;
}
