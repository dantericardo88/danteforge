// DanteSanitize — LLM-driven file split analysis and content generation
import path from 'path';
import { callLLM } from './llm.js';
import type { SplitPlan, SplitPlanFile } from './sanitize-types.js';

// ── Prompt builders ──────────────────────────────────────────────────────────

export function buildAnalysisPrompt(filePath: string, content: string, loc: number): string {
  const stem = path.basename(filePath, path.extname(filePath));
  return `You are a TypeScript module architect. The file "${filePath}" has ${loc} lines and exceeds the 750-line hard limit.

Analyze it and return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "valid": boolean,
  "reason": string | null,
  "newFiles": [{ "name": string, "purpose": string, "exports": string[] }],
  "retainInOriginal": string[]
}

Rules:
- Each extracted file must itself be under 500 LOC after extraction
- Extraction priority: (1) TypeScript interfaces/types/enums → ${stem}-types.ts, (2) pure utility functions with no side effects → ${stem}-utils.ts, (3) helper functions → ${stem}-helpers.ts, (4) constants/config → ${stem}-config.ts
- Keep the primary export, main class, or main orchestration function in the original file
- New filenames must follow the pattern: ${stem}-<suffix>.ts
- "exports" lists the exact exported symbol names (function/class/interface/type/const names) to move
- "retainInOriginal" lists symbols that stay in the original file
- If the file cannot be split cleanly (e.g., everything is tightly coupled), return { "valid": false, "reason": "..." }

FILE: ${filePath}
---
${content}`;
}

export function buildExtractionPrompt(
  originalFile: string,
  content: string,
  targetFile: SplitPlanFile,
  typecheckError?: string,
): string {
  const errorSection = typecheckError
    ? `\nPREVIOUS ATTEMPT FAILED with TypeScript errors — fix the imports accordingly:\n${typecheckError.slice(0, 2000)}\n`
    : '';
  return `Extract the following exports from "${originalFile}" into a new file named "${targetFile.name}".

Purpose of this new file: ${targetFile.purpose}
Exports to move: ${targetFile.exports.join(', ')}
${errorSection}
Rules:
- Include all necessary imports at the top (use .js extensions for relative ESM imports)
- Preserve all JSDoc comments exactly
- Do NOT include exports that are not in the list above
- Return ONLY the TypeScript file content, no markdown fences, no explanation

ORIGINAL FILE (${originalFile}):
---
${content}`;
}

export function buildRewritePrompt(
  originalFile: string,
  content: string,
  plan: SplitPlan,
  typecheckError?: string,
): string {
  const allRemovedExports = plan.newFiles.flatMap(f => f.exports);
  const importStatements = plan.newFiles
    .map(f => {
      const importPath = `./${f.name.replace(/\.ts$/, '.js')}`;
      return `import { ${f.exports.join(', ')} } from '${importPath}';`;
    })
    .join('\n');
  const errorSection = typecheckError
    ? `\nPREVIOUS ATTEMPT FAILED with TypeScript errors — fix accordingly:\n${typecheckError.slice(0, 2000)}\n`
    : '';
  return `Rewrite "${originalFile}" to remove the extracted symbols and add imports from the new split files.

1. REMOVE these exported symbols (they have been moved to separate files): ${allRemovedExports.join(', ')}
2. ADD these import statements near the top of the file (after existing imports):
${importStatements}
3. Keep ALL other code EXACTLY the same — do not refactor, rename, or reformat anything
${errorSection}
Return ONLY the TypeScript file content, no markdown fences, no explanation.

ORIGINAL FILE (${originalFile}):
---
${content}`;
}

// ── Split analysis (Step 1) ──────────────────────────────────────────────────

export interface AnalyzeSplitOptions {
  /** Skip AST fast-path and use LLM analysis exclusively. */
  skipAst?: boolean;
}

export async function analyzeSplitOpportunities(
  filePath: string,
  content: string,
  loc: number,
  llmCaller?: (prompt: string) => Promise<string>,
  options: AnalyzeSplitOptions = {},
): Promise<SplitPlan> {
  // Phase 1: try AST-based boundary detection first (deterministic, free)
  if (!options.skipAst) {
    try {
      const { analyzeBoundariesAst } = await import('./sanitize-boundary.js');
      const astPlan = analyzeBoundariesAst(content, filePath);
      if (astPlan.valid && astPlan.newFiles.length > 0) {
        return astPlan;
      }
    } catch { /* AST may fail on unparseable input; fall through to LLM */ }
  }

  // Phase 2: LLM analysis fallback
  const caller = llmCaller ?? ((p: string) => callLLM(p));
  const prompt = buildAnalysisPrompt(filePath, content, loc);
  let raw: string;
  try {
    raw = await caller(prompt);
  } catch (err) {
    return { valid: false, newFiles: [], retainInOriginal: [], reason: `LLM error: ${String(err)}` };
  }

  // Strip markdown fences if LLM wrapped response
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<SplitPlan>;
    if (typeof parsed.valid !== 'boolean') {
      return { valid: false, newFiles: [], retainInOriginal: [], reason: 'LLM response missing valid field' };
    }
    if (!parsed.valid) {
      return { valid: false, newFiles: [], retainInOriginal: [], reason: parsed.reason ?? 'LLM declined to split' };
    }
    if (!Array.isArray(parsed.newFiles) || parsed.newFiles.length === 0) {
      return { valid: false, newFiles: [], retainInOriginal: [], reason: 'No new files in split plan' };
    }
    return {
      valid: true,
      newFiles: parsed.newFiles,
      retainInOriginal: parsed.retainInOriginal ?? [],
    };
  } catch {
    return { valid: false, newFiles: [], retainInOriginal: [], reason: 'Failed to parse LLM JSON response' };
  }
}

// ── Split execution (Steps 2 + 3) ───────────────────────────────────────────

export interface SplitExecutionResult {
  newFiles: Map<string, string>;    // filename → content
  rewrittenOriginal: string;
}

export async function executeSplit(
  filePath: string,
  content: string,
  plan: SplitPlan,
  llmCaller?: (prompt: string) => Promise<string>,
  typecheckError?: string,
): Promise<SplitExecutionResult> {
  const caller = llmCaller ?? ((p: string) => callLLM(p));
  const newFiles = new Map<string, string>();

  // Step 2: generate each new file
  for (const targetFile of plan.newFiles) {
    const prompt = buildExtractionPrompt(filePath, content, targetFile, typecheckError);
    const raw = await caller(prompt);
    const fileContent = raw.replace(/^```(?:typescript|ts)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    newFiles.set(targetFile.name, fileContent);
  }

  // Step 3: rewrite original
  const rewritePrompt = buildRewritePrompt(filePath, content, plan, typecheckError);
  const rawRewrite = await caller(rewritePrompt);
  const rewrittenOriginal = rawRewrite
    .replace(/^```(?:typescript|ts)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  return { newFiles, rewrittenOriginal };
}

// ── Typecheck verification ───────────────────────────────────────────────────

export async function verifySplit(
  cwd: string,
  _runTypecheck?: (cwd: string) => Promise<{ success: boolean; output: string }>,
): Promise<{ success: boolean; output: string }> {
  if (_runTypecheck) {
    return _runTypecheck(cwd);
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsc', '--noEmit', '--skipLibCheck'],
      { cwd, timeout: 60_000 },
    );
    return { success: true, output: stdout + stderr };
  } catch (err: unknown) {
    const output = err instanceof Error && 'stdout' in err
      ? String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '') +
        String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr ?? '')
      : String(err);
    return { success: false, output };
  }
}
