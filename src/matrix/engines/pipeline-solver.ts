// pipeline-solver.ts — DanteForge's iterate-to-green orchestration as a benchmark SOLVER (CH-029).
//
// The raw `claude -p` solver is ONE-SHOT: a minted receipt then grounds the MODEL's capability, not
// DanteForge's. DanteForge's distinctive value is the forge loop — generate, run the checks, feed the
// failures back, regenerate. This wraps ANY one-shot generator in that loop, using ONLY the public
// doctest examples embedded in the prompt docstring (the hidden grading test is never shown to the
// solver, so this is a legitimate agentic technique, not test-peeking). The receipt then measures
// DanteForge's orchestration OVER the model, which is what the code_generation dimension claims.

import type { PythonRunner } from './humaneval-grounding.js';

export interface VisibleExample {
  /** The call expression, e.g. `has_close_elements([1.0, 2.0], 0.5)`. */
  call: string;
  /** The expected value as a Python literal, e.g. `False` / `[1, 2]` / `'abc'`. */
  expected: string;
}

/**
 * Parse the public `>>> call` / `expected` doctests out of a docstring prompt. A doctest is a line
 * containing `>>> <expr>` followed by a non-`>>>`, non-blank line (the expected repr). Pure + testable.
 * Returns [] when the prompt has no doctests (common — then the loop falls back to a definition check).
 */
export function parseVisibleExamples(prompt: string): VisibleExample[] {
  const out: VisibleExample[] = [];
  const lines = prompt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*>>>\s+(.+?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    const call = m[1]!.trim();
    // The expected value is the next non-blank line that is not itself a `>>>` continuation.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    if (j >= lines.length) break;
    const next = lines[j]!.trim();
    if (next.startsWith('>>>')) continue; // a statement with no shown result
    out.push({ call, expected: next });
  }
  return out;
}

/**
 * Build a Python program that defines the function (prompt + candidate body) and asserts each visible
 * example, collecting failures. Exits non-zero (printing the failures) if ANY example is wrong or errors;
 * exits 0 when all pass. With no examples, asserts only that the entry point is defined + callable.
 */
export function buildVisibleCheckProgram(
  prompt: string,
  entryPoint: string,
  body: string,
  examples: VisibleExample[],
): string {
  if (examples.length === 0) {
    return `${prompt}${body}\n\nassert callable(${entryPoint}), "entry point ${entryPoint} not defined"\n`;
  }
  const checks = examples
    .map((e, idx) => {
      // repr-compare so floats/containers/strings compare by value; each guarded so one bad example
      // doesn't abort the rest (its failure is recorded, not a hard crash).
      const safeExpected = JSON.stringify(e.expected);
      return [
        `try:`,
        `    _got = ${e.call}`,
        `    _exp = (${e.expected})`,
        `    assert _got == _exp, "got %r expected %r" % (_got, _exp)`,
        `except Exception as _e:`,
        `    _failures.append("example ${idx + 1} (" + ${safeExpected} + "): " + str(_e))`,
      ].join('\n');
    })
    .join('\n');
  return `${prompt}${body}\n\n_failures = []\n${checks}\nimport sys\nif _failures:\n    print("\\n".join(_failures))\n    sys.exit(1)\n`;
}

/** Generate a candidate function body. `feedback` carries the prior attempt's visible-check failures. */
export type Generator = (prompt: string, feedback?: string) => Promise<string>;

export interface PipelineSolveOptions {
  /** Max generate→check iterations before returning the best-effort candidate. */
  maxIterations?: number;
}

export interface PipelineSolveResult {
  body: string;
  iterations: number;
  /** True when a candidate passed all visible examples (or the definition check). */
  visiblePassed: boolean;
}

/**
 * The iterate-to-green loop. Generates a candidate, runs the visible-example check, and on failure
 * regenerates with the failure text as feedback — up to maxIterations. Returns the first candidate that
 * clears the visible checks, else the last candidate (best-effort, never throws on a failed attempt).
 */
export async function pipelineSolve(
  spec: { prompt: string; entry_point: string },
  generate: Generator,
  runProgram: PythonRunner,
  opts: PipelineSolveOptions = {},
): Promise<PipelineSolveResult> {
  const maxIterations = Math.max(1, opts.maxIterations ?? 3);
  const examples = parseVisibleExamples(spec.prompt);
  let lastBody = '';
  let feedback: string | undefined;
  for (let i = 1; i <= maxIterations; i++) {
    let body: string;
    try {
      body = await generate(spec.prompt, feedback);
    } catch (err) {
      // A generation error is not fatal to the loop; record it as feedback and retry.
      feedback = `Your previous attempt errored: ${err instanceof Error ? err.message : String(err)}. Output ONLY the function body.`;
      continue;
    }
    lastBody = body;
    const program = buildVisibleCheckProgram(spec.prompt, spec.entry_point, body, examples);
    const r = runProgram(program);
    if (r.status === 0) return { body, iterations: i, visiblePassed: true };
    feedback = `Your previous attempt failed these checks:\n${(r.stderr || 'unknown failure').split('\n').slice(0, 8).join('\n')}\nFix the function. Output ONLY the function body (indented lines after the signature), no signature, no fences.`;
  }
  return { body: lastBody, iterations: maxIterations, visiblePassed: false };
}
