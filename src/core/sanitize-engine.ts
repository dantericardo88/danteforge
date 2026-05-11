// DanteSanitize — main loop, queue management, session persistence, ticker
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectSourceFileSizes, countMaintainableLoc } from './file-size-hygiene.js';
import { callLLM } from './llm.js';
import { logger } from './logger.js';
import {
  analyzeSplitOpportunities,
  executeSplit,
  verifySplit,
  type SplitExecutionResult,
} from './sanitize-splitter.js';
import { moveSymbolsViaAst } from './sanitize-ast-mover.js';
import { validatePostSplit } from './sanitize-validators.js';
import { withFileLock, loadFrozenFiles, writePlatformKernelNeeded, LockTimeoutError } from './sanitize-locks.js';
import {
  SANITIZE_HARD_LOC,
  SANITIZE_DEFAULT_MAX_CYCLES,
  SANITIZE_SESSION_DIR,
  SANITIZE_BACKUP_DIR,
  SANITIZE_SESSION_FILE,
  SANITIZE_REPORT_FILE,
  type SanitizeEngineOptions,
  type SanitizeEngineResult,
  type SanitizeSession,
  type SanitizeQueueItem,
  type SanitizeResult,
  type SanitizeSkipItem,
  type SanitizeSkipReason,
} from './sanitize-types.js';

// ── Session persistence ──────────────────────────────────────────────────────

export async function loadSession(cwd: string): Promise<SanitizeSession | null> {
  const sessionPath = path.join(cwd, SANITIZE_SESSION_FILE);
  try {
    const raw = await fs.readFile(sessionPath, 'utf8');
    return JSON.parse(raw) as SanitizeSession;
  } catch {
    return null;
  }
}

export async function saveSession(cwd: string, session: SanitizeSession): Promise<void> {
  const sessionPath = path.join(cwd, SANITIZE_SESSION_FILE);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
}

// ── Queue builder ────────────────────────────────────────────────────────────

export async function buildQueue(
  cwd: string,
  threshold: number,
  pattern?: string,
  skipPattern?: string,
  _inspect?: SanitizeEngineOptions['_inspect'],
): Promise<SanitizeQueueItem[]> {
  const inspector = _inspect ?? inspectSourceFileSizes;
  const report = await inspector(cwd);
  const now = new Date().toISOString();

  const items: SanitizeQueueItem[] = [];
  for (const entry of report.files) {
    if (entry.loc <= threshold) continue;
    if (pattern && !entry.relativePath.includes(pattern.replace('*', ''))) continue;
    if (skipPattern && entry.relativePath.includes(skipPattern.replace('*', ''))) continue;
    items.push({ path: entry.relativePath, loc: entry.loc, addedAt: now });
  }

  // Sort worst-first (highest LOC first)
  return items.sort((a, b) => b.loc - a.loc);
}

// ── Ticker ───────────────────────────────────────────────────────────────────

export function printTicker(session: SanitizeSession): void {
  const total = session.completed.length + session.skipped.length + session.queue.length;
  const done = session.completed.length;
  const barWidth = 16;
  const filled = total > 0 ? Math.round((done / total) * barWidth) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  logger.info(
    `[Sanitize] ${bar}  ${done}/${total} clean  |  ${session.queue.length} remaining  |  ${session.skipped.length} skipped  |  cycle ${session.cyclesRun}`,
  );
}

// ── Backup helpers ───────────────────────────────────────────────────────────

async function writeBak(
  cwd: string,
  filePath: string,
  content: string,
  writeFile: (p: string, c: string) => Promise<void>,
): Promise<string> {
  const stem = path.basename(filePath, path.extname(filePath));
  const ts = Date.now();
  const bakName = `${stem}-${ts}.bak`;
  const bakPath = path.join(cwd, SANITIZE_BACKUP_DIR, bakName);
  await fs.mkdir(path.dirname(bakPath), { recursive: true });
  await writeFile(bakPath, content);
  return bakPath;
}

// ── Main engine loop ─────────────────────────────────────────────────────────

export async function runSanitize(options: SanitizeEngineOptions = {}): Promise<SanitizeEngineResult> {
  const cwd = options.cwd ?? process.cwd();
  const threshold = options.threshold ?? SANITIZE_HARD_LOC;
  const maxCycles = options.maxCycles ?? SANITIZE_DEFAULT_MAX_CYCLES;
  const dryRun = options.dryRun ?? false;
  const skipTypecheck = options.skipTypecheck ?? false;

  const llmCaller = options._callLLM ?? ((p: string) => callLLM(p));
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const removeFile = options._removeFile ?? ((p: string) => fs.unlink(p));
  const typechecker = options._runTypecheck;

  // Orient: load existing session only if it matches current threshold; otherwise rebuild
  let session = await loadSession(cwd);
  if (!session || session.threshold !== threshold) {
    if (session && session.threshold !== threshold) {
      logger.info(`[Sanitize] Threshold changed (${session.threshold} → ${threshold}); rebuilding queue.`);
    }
    const queue = await buildQueue(cwd, threshold, options.pattern, options.skipPattern, options._inspect);
    session = {
      startedAt: new Date().toISOString(),
      cwd,
      threshold,
      queue,
      completed: [],
      skipped: [],
      cyclesRun: 0,
    };
    await saveSession(cwd, session);
  }

  const initialViolations = session.queue.length;

  if (session.queue.length === 0) {
    logger.success('[Sanitize] No violations found — project is already clean.');
    return buildResult(session, 0, cwd);
  }

  logger.info(`[Sanitize] Found ${session.queue.length} file(s) above ${threshold} LOC threshold.`);

  // Dry run: just report
  if (dryRun) {
    logger.info('[Sanitize] Dry run — no files will be modified.\n');
    for (const item of session.queue) {
      logger.info(`  ${item.path}  (${item.loc} LOC)`);
    }
    return buildResult(session, initialViolations, cwd);
  }

  await fs.mkdir(path.join(cwd, SANITIZE_SESSION_DIR), { recursive: true });
  await fs.mkdir(path.join(cwd, SANITIZE_BACKUP_DIR), { recursive: true });

  // Load frozen files once at start; defer any violations to platform-kernel
  const frozenFiles = await loadFrozenFiles({ cwd });

  while (session.queue.length > 0 && session.cyclesRun < maxCycles) {
    const item = session.queue[0]!;
    logger.info(`[Sanitize] Processing ${item.path} (${item.loc} LOC) — cycle ${session.cyclesRun + 1}`);

    // Frozen-file guard: defer to platform-kernel workstream
    if (frozenFiles.includes(item.path)) {
      logger.warn(`[Sanitize] ${item.path} is a FROZEN file — deferring to platform-kernel workstream`);
      await writePlatformKernelNeeded({ cwd, files: [{ path: item.path, loc: item.loc }] });
      skipItem(session, item, 'no-split-found', 'Frozen file — requires platform-kernel sprint');
      session.queue.shift();
      session.cyclesRun++;
      await saveSession(cwd, session);
      continue;
    }

    // Per-file lock: prevents concurrent sanitize runs from racing
    const { acquireFileLock } = await import('./sanitize-locks.js');
    let lockHandle: Awaited<ReturnType<typeof acquireFileLock>> | null = null;
    try {
      lockHandle = await acquireFileLock({ cwd, filePath: item.path, maxWaitMs: 5000 });
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        logger.info(`[Sanitize] ${item.path} is locked by another agent — requeueing`);
        session.queue.push(session.queue.shift()!);
        session.cyclesRun++;
        await saveSession(cwd, session);
        continue;
      }
      throw err;
    }

    // Outer try/finally: guarantees lock release on every exit path (continue, throw, return)
    try {

    let content: string;
    try {
      content = await readFile(path.join(cwd, item.path));
    } catch (err) {
      skipItem(session, item, 'llm-error', `Could not read file: ${String(err)}`);
      session.queue.shift();
      session.cyclesRun++;
      await saveSession(cwd, session);
      continue;
    }

    // Safety: write backup before touching anything
    const bakPath = await writeBak(cwd, item.path, content, writeFile);

    try {
      // Step 1: LLM analysis
      const plan = await analyzeSplitOpportunities(item.path, content, item.loc, llmCaller);
      if (!plan.valid) {
        logger.warn(`[Sanitize] No clean split found for ${item.path}: ${plan.reason}`);
        skipItem(session, item, 'no-split-found', plan.reason);
        session.queue.shift();
        session.cyclesRun++;
        await saveSession(cwd, session);
        printTicker(session);
        continue;
      }

      // Step 2+3: generate split — Tier 1 (AST) first, fall back to Tier 2 (LLM)
      const result = await executeSplitTiered(item.path, content, plan, llmCaller);

      // AST-delta validation (catches dropped/invented symbols before disk write)
      const delta = await validatePostSplit({
        cwd,
        originalContent: content,
        originalPath: item.path,
        rewrittenOriginal: result.rewrittenOriginal,
        newFiles: result.newFiles,
      });
      if (!delta.ok) {
        logger.error(`[Sanitize] AST-delta check failed on ${item.path}: ${delta.reason}`);
        skipItem(session, item, 'typecheck-failed', delta.reason);
        session.queue.shift();
        session.cyclesRun++;
        await saveSession(cwd, session);
        printTicker(session);
        continue;
      }

      await writeFiles(cwd, item.path, result.rewrittenOriginal, result.newFiles, writeFile);

      if (!skipTypecheck) {
        const check1 = await verifySplit(cwd, typechecker);
        if (!check1.success) {
          // Revert and retry once with error context
          await writeFile(path.join(cwd, item.path), content);
          await deleteNewFiles(cwd, Array.from(result.newFiles.keys()), item.path, removeFile);

          logger.warn(`[Sanitize] Typecheck failed on ${item.path} — retrying with error context`);
          // Retry: skip Tier 1 (AST), go straight to LLM with the error context
          const result2 = await executeSplit(item.path, content, plan, llmCaller, check1.output);
          await writeFiles(cwd, item.path, result2.rewrittenOriginal, result2.newFiles, writeFile);

          const check2 = await verifySplit(cwd, typechecker);
          if (!check2.success) {
            await writeFile(path.join(cwd, item.path), content);
            await deleteNewFiles(cwd, Array.from(result2.newFiles.keys()), item.path, removeFile);
            logger.error(`[Sanitize] Both attempts failed for ${item.path} — skipping`);
            skipItem(session, item, 'typecheck-failed', check2.output.slice(0, 500));
            session.queue.shift();
            session.cyclesRun++;
            await saveSession(cwd, session);
            printTicker(session);
            continue;
          }

          // Second attempt passed — record the successful files
          await recordSuccess(cwd, session, item, content, Array.from(result2.newFiles.keys()), readFile);
        } else {
          await recordSuccess(cwd, session, item, content, Array.from(result.newFiles.keys()), readFile);
        }
      } else {
        await recordSuccess(cwd, session, item, content, Array.from(result.newFiles.keys()), readFile);
      }

      // Check if any new files are themselves oversized; enqueue if so
      const newFileNames = Array.from(result.newFiles.keys());
      for (const newFileName of newFileNames) {
        const newFilePath = resolveNewFilePath(cwd, item.path, newFileName);
        try {
          const newContent = await readFile(newFilePath);
          const newLoc = countMaintainableLoc(newContent);
          if (newLoc > threshold) {
            logger.warn(`[Sanitize] New file ${newFileName} is still ${newLoc} LOC — queuing for further splitting`);
            session.queue.push({ path: path.relative(cwd, newFilePath), loc: newLoc, addedAt: new Date().toISOString() });
          }
        } catch { /* best-effort */ }
      }

    } catch (err) {
      logger.error(`[Sanitize] Error processing ${item.path}: ${String(err)}`);
      // Best-effort restore from backup
      try {
        const bakContent = await readFile(bakPath);
        await writeFile(path.join(cwd, item.path), bakContent);
      } catch { /* ignore */ }
      skipItem(session, item, 'llm-error', String(err));
      session.queue.shift();
    }

    session.cyclesRun++;
    await saveSession(cwd, session);
    printTicker(session);

    } finally {
      await lockHandle?.release();
      lockHandle = null;
    }
  }

  if (session.cyclesRun >= maxCycles && session.queue.length > 0) {
    logger.warn(`[Sanitize] Reached max cycles (${maxCycles}) with ${session.queue.length} file(s) remaining.`);
  }

  const remainingViolations = session.queue.length;
  await writeReport(cwd, session);

  return buildResult(session, remainingViolations, cwd);
}

// ── Tiered split execution ────────────────────────────────────────────────────

/**
 * Tier 1: try the deterministic AST mover for each new file in the plan.
 *   - If all symbols move cleanly, no LLM call is needed (zero cost).
 *   - If any symbol refuses (decorator, multi-decl const, etc.), fall through.
 * Tier 2: LLM-driven `executeSplit` (existing v1 logic).
 */
export async function executeSplitTiered(
  filePath: string,
  content: string,
  plan: import('./sanitize-types.js').SplitPlan,
  llmCaller: (prompt: string) => Promise<string>,
): Promise<SplitExecutionResult> {
  const newFiles = new Map<string, string>();
  let workingContent = content;
  let allMoved = true;

  for (const file of plan.newFiles) {
    const moveResult = moveSymbolsViaAst({
      content: workingContent,
      filePath,
      symbols: file.exports,
      newFileName: file.name,
    });
    if (!moveResult.success) {
      allMoved = false;
      break;
    }
    newFiles.set(file.name, moveResult.newFileContent!);
    workingContent = moveResult.rewrittenOriginal!;
  }

  if (allMoved) {
    logger.info(`[Sanitize] Tier 1 (AST) handled all ${plan.newFiles.length} extractions — no LLM cost`);
    return { newFiles, rewrittenOriginal: workingContent };
  }

  // Tier 2: fall back to LLM
  logger.info('[Sanitize] AST mover refused — falling back to LLM (Tier 2)');
  return executeSplit(filePath, content, plan, llmCaller);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function skipItem(
  session: SanitizeSession,
  item: SanitizeQueueItem,
  reason: SanitizeSkipReason,
  error?: string,
): void {
  const existing = session.skipped.find(s => s.path === item.path);
  if (existing) {
    existing.attempts++;
    existing.reason = reason;
    existing.lastError = error;
  } else {
    session.skipped.push({ path: item.path, reason, lastError: error, attempts: 1 });
  }
}

function resolveNewFilePath(cwd: string, originalRelPath: string, newFileName: string): string {
  const originalDir = path.dirname(path.join(cwd, originalRelPath));
  return path.join(originalDir, newFileName);
}

async function writeFiles(
  cwd: string,
  originalRelPath: string,
  rewrittenOriginal: string,
  newFiles: Map<string, string>,
  writeFile: (p: string, c: string) => Promise<void>,
): Promise<void> {
  await writeFile(path.join(cwd, originalRelPath), rewrittenOriginal);
  const dir = path.dirname(path.join(cwd, originalRelPath));
  for (const [name, content] of newFiles) {
    await writeFile(path.join(dir, name), content);
  }
}

async function deleteNewFiles(
  cwd: string,
  newFileNames: string[],
  originalRelPath: string,
  removeFile: (p: string) => Promise<void>,
): Promise<void> {
  const dir = path.dirname(path.join(cwd, originalRelPath));
  for (const name of newFileNames) {
    try { await removeFile(path.join(dir, name)); } catch { /* best-effort */ }
  }
}

async function recordSuccess(
  cwd: string,
  session: SanitizeSession,
  item: SanitizeQueueItem,
  originalContent: string,
  newFileNames: string[],
  readFile: (p: string) => Promise<string>,
): Promise<void> {
  let locAfter = item.loc;
  try {
    const rewrittenContent = await readFile(path.join(cwd, item.path));
    locAfter = countMaintainableLoc(rewrittenContent);
  } catch { /* best-effort */ }

  // Re-queue if original is still over threshold
  if (locAfter > (session.threshold ?? SANITIZE_HARD_LOC)) {
    session.queue[0]!.loc = locAfter;
    // Move to end of queue to give other files a turn
    session.queue.push(session.queue.shift()!);
    return;
  }

  const splitResult: SanitizeResult = {
    originalPath: item.path,
    newFiles: newFileNames,
    locBefore: item.loc,
    locAfter,
    splitAt: new Date().toISOString(),
  };
  session.completed.push(splitResult);
  session.queue.shift();
  logger.success(`[Sanitize] ✓ ${item.path}  ${item.loc} → ${locAfter} LOC  (+${newFileNames.length} new file(s))`);
}

async function writeReport(cwd: string, session: SanitizeSession): Promise<void> {
  const lines = [
    '# DanteSanitize Report',
    '',
    `**Started:** ${session.startedAt}`,
    `**Cycles run:** ${session.cyclesRun}`,
    `**Files split:** ${session.completed.length}`,
    `**Files skipped:** ${session.skipped.length}`,
    `**Remaining violations:** ${session.queue.length}`,
    '',
    '## Split Files',
    '',
  ];
  for (const r of session.completed) {
    lines.push(`- \`${r.originalPath}\`  ${r.locBefore} → ${r.locAfter} LOC  → ${r.newFiles.join(', ')}`);
  }
  if (session.skipped.length > 0) {
    lines.push('', '## Skipped Files', '');
    for (const s of session.skipped) {
      lines.push(`- \`${s.path}\`  reason: ${s.reason}  attempts: ${s.attempts}`);
    }
  }
  const reportPath = path.join(cwd, SANITIZE_REPORT_FILE);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
}

function buildResult(
  session: SanitizeSession,
  remainingViolations: number,
  cwd: string,
): SanitizeEngineResult {
  return {
    cyclesRun: session.cyclesRun,
    filesProcessed: session.completed.length + session.skipped.length,
    filesSplit: session.completed.length,
    filesSkipped: session.skipped.length,
    remainingViolations,
    success: remainingViolations === 0,
    sessionPath: path.join(cwd, SANITIZE_SESSION_FILE),
  };
}
