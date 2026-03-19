// Hard Gates — mandatory checkpoints that block progression until prerequisites are met
import fs from 'fs/promises';
import path from 'path';
import { loadState } from './state.js';
import { logger } from './logger.js';
import { detectLoop } from './loop-detector.js';
import { detectAIDrift } from './drift-detector.js';
import { loadLatestVerdict } from './reflection-engine.js';
import type { ExecutionTelemetry } from './execution-telemetry.js';

const STATE_DIR = '.danteforge';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class GateError extends Error {
  constructor(
    message: string,
    public readonly gate: string,
    public readonly remedy: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

/**
 * Gate: Constitution must exist before spec/clarify/plan
 */
export async function requireConstitution(light = false): Promise<void> {
  if (light) return;
  const state = await loadState();
  if (!state.constitution || !(await fileExists(path.join(STATE_DIR, 'CONSTITUTION.md')))) {
    throw new GateError(
      'Gate blocked: No constitution defined.',
      'requireConstitution',
      'Run "danteforge constitution" first to establish project principles.',
    );
  }
}

/**
 * Gate: SPEC.md must exist before plan/tasks
 */
export async function requireSpec(light = false): Promise<void> {
  if (light) return;
  if (!(await fileExists(path.join(STATE_DIR, 'SPEC.md')))) {
    throw new GateError(
      'Gate blocked: No SPEC.md found.',
      'requireSpec',
      'Run "danteforge specify <idea>" first to generate spec artifacts.',
    );
  }
}

/**
 * Gate: CLARIFY.md must exist before plan generation
 */
export async function requireClarify(light = false): Promise<void> {
  if (light) return;
  if (!(await fileExists(path.join(STATE_DIR, 'CLARIFY.md')))) {
    throw new GateError(
      'Gate blocked: No CLARIFY.md found.',
      'requireClarify',
      'Run "danteforge clarify" first to resolve requirement gaps before planning.',
    );
  }
}

/**
 * Gate: PLAN.md must exist before forge/tasks execution
 */
export async function requirePlan(light = false): Promise<void> {
  if (light) return;
  if (!(await fileExists(path.join(STATE_DIR, 'PLAN.md')))) {
    throw new GateError(
      'Gate blocked: No PLAN.md found.',
      'requirePlan',
      'Run "danteforge plan" first to generate an execution plan.',
    );
  }
}

/**
 * Gate: Tests must exist before production code generation (TDD enforcement)
 */
export async function requireTests(light = false): Promise<void> {
  if (light) return;
  const state = await loadState();
  if (!state.tddEnabled) return; // TDD gate only active when explicitly enabled

  // Check for any test files in the project
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  let hasTests = false;

  for (const dir of testDirs) {
    if (await fileExists(dir)) {
      const entries = await fs.readdir(dir);
      if (entries.some(e => e.includes('.test.') || e.includes('.spec.'))) {
        hasTests = true;
        break;
      }
    }
  }

  if (!hasTests) {
    throw new GateError(
      'Gate blocked: TDD mode is enabled but no test files found.',
      'requireTests',
      'Write tests first (RED phase), then run forge. See: test-driven-development skill.',
    );
  }
}

/**
 * Gate: DESIGN.op must exist before design-dependent commands
 */
export async function requireDesign(light = false): Promise<void> {
  if (light) return;
  const designPath = path.join(STATE_DIR, 'DESIGN.op');
  if (!(await fileExists(designPath))) {
    throw new GateError(
      'Gate blocked: No DESIGN.op found.',
      'requireDesign',
      'Run "danteforge design <prompt>" first to generate design artifacts.',
    );
  }
  // Validate JSON structure
  try {
    const content = await fs.readFile(designPath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed.nodes || !parsed.document) {
      throw new Error('Missing required .op fields: nodes, document');
    }
  } catch (err) {
    if (err instanceof GateError) throw err;
    throw new GateError(
      `Gate blocked: DESIGN.op is malformed — ${err instanceof Error ? err.message : String(err)}`,
      'requireDesign',
      'Regenerate with: danteforge design <prompt>',
    );
  }
}

/**
 * Gate: Generic approval gate for human-in-the-loop
 */
export async function requireApproval(artifact: string, light = false): Promise<void> {
  if (light) return;
  // In CLI mode, this logs a warning — actual blocking is done by the caller
  logger.warn(`Approval gate: "${artifact}" requires human review before proceeding.`);
}

/**
 * Gate: No execution loops detected (v0.9.0 — Reflection Engine)
 */
export async function requireNoLoops(telemetry: ExecutionTelemetry, light = false): Promise<void> {
  if (light) return;
  const result = detectLoop(telemetry);
  if (result.detected && result.severity === 'HIGH') {
    throw new GateError(
      `Gate blocked: ${result.type} loop detected — ${result.evidence}`,
      'requireNoLoops',
      result.type === 'planning'
        ? 'Stop reading files and start writing code. You have enough context.'
        : 'Stop repeating the same commands. Try a different approach or ask for help.',
    );
  }
}

/**
 * Gate: Reflection score meets minimum threshold (v0.9.0 — Reflection Engine)
 */
export async function requireReflectionScore(minScore: number, light = false): Promise<void> {
  if (light) return;
  const verdict = await loadLatestVerdict();
  if (!verdict) return; // No reflection data yet — don't block
  const { evaluateVerdict } = await import('./reflection-engine.js');
  const evaluation = evaluateVerdict(verdict);
  if (evaluation.score < minScore) {
    throw new GateError(
      `Gate blocked: Reflection score ${evaluation.score} is below minimum ${minScore}.`,
      'requireReflectionScore',
      `Address reflection feedback: ${evaluation.missing.slice(0, 3).join('; ')}`,
    );
  }
}

/**
 * Gate: No BLOCKER-level AI drift violations (v0.9.0 — Reflection Engine)
 */
export async function requireNoDrift(filesModified: string[], light = false): Promise<void> {
  if (light) return;
  if (filesModified.length === 0) return;
  const violations = await detectAIDrift(filesModified);
  const blockers = violations.filter(v => v.severity === 'BLOCKER' || v.severity === 'HIGH');
  if (blockers.length > 0) {
    const details = blockers.slice(0, 3).map(v => `${v.file}:${v.line} — ${v.message}`).join('; ');
    throw new GateError(
      `Gate blocked: ${blockers.length} AI drift violation(s) detected — ${details}`,
      'requireNoDrift',
      'Fix hallucinated imports, remove stubs, and verify API endpoints before proceeding.',
    );
  }
}

/**
 * Run a gate and handle errors gracefully
 */
export async function runGate(gateFn: () => Promise<void>): Promise<boolean> {
  try {
    await gateFn();
    return true;
  } catch (err) {
    if (err instanceof GateError) {
      logger.error(`${err.message}`);
      logger.info(`Remedy: ${err.remedy}`);
      process.exitCode = 1;
      return false;
    }
    throw err;
  }
}
