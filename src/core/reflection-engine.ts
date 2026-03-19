// Reflection Engine — structured self-assessment after every agent turn
// Harvested from: Reflection-3.ts (OpenCode), Ralph Loop (Vercel Labs), Rigour (rigour-labs)
// Produces evidence-based verdicts instead of "trust me bro" claims.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import { isLLMAvailable, callLLM } from './llm.js';
import { recordMemory } from './memory-engine.js';
import type { ExecutionTelemetry } from './execution-telemetry.js';

const REFLECTIONS_DIR = path.join('.danteforge', 'reflections');

// --- Types -------------------------------------------------------------------

export type ReflectionStatus = 'complete' | 'in_progress' | 'blocked' | 'stuck';
export type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER';

export interface EvidenceGate {
  ran: boolean;
  passed: boolean;
  ranAfterChanges: boolean;
}

export interface ReflectionVerdict {
  sessionId: string;
  taskName: string;
  status: ReflectionStatus;
  confidence: number; // 0.0–1.0
  evidence: {
    tests: EvidenceGate;
    build: EvidenceGate;
    lint: EvidenceGate;
  };
  remainingWork: string[];
  nextSteps: string[];
  needsHumanAction: string[];
  stuck: boolean;
  severity: Severity;
  timestamp: string;
}

export interface ReflectionConfig {
  maxAttempts: number;
  confidenceThreshold: number;
  enableLoopDetection: boolean;
  enableFixPackets: boolean;
}

export interface ReflectionEvaluation {
  complete: boolean;
  missing: string[];
  feedback: string;
  score: number; // 0–100
}

export type ReflectionHook = (verdict: ReflectionVerdict) => Promise<void>;

// --- Defaults ----------------------------------------------------------------

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  maxAttempts: 3,
  confidenceThreshold: 0.8,
  enableLoopDetection: true,
  enableFixPackets: true,
};

// --- Hook Registry -----------------------------------------------------------

const hooks: ReflectionHook[] = [];

export function registerHook(hook: ReflectionHook): void {
  hooks.push(hook);
}

export function clearHooks(): void {
  hooks.length = 0;
}

async function runHooks(verdict: ReflectionVerdict): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(verdict);
    } catch (err) {
      logger.warn(`Reflection hook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// --- Self-Assessment Prompt --------------------------------------------------

function buildSelfAssessmentPrompt(taskName: string, taskOutput: string, telemetry: ExecutionTelemetry): string {
  const telemetrySummary = [
    `Tool calls: ${telemetry.toolCalls.length}`,
    `Writes: ${telemetry.toolCalls.filter(tc => tc.isWrite).length}`,
    `Bash commands: ${telemetry.bashCommands.length}`,
    `Files modified: ${telemetry.filesModified.length}`,
    `Duration: ${(telemetry.duration / 1000).toFixed(1)}s`,
  ].join(', ');

  return `You are a strict code quality reviewer. Assess the following task execution and return ONLY valid JSON (no markdown fences, no explanation).

Task: ${taskName}
Execution telemetry: ${telemetrySummary}
Files modified: ${telemetry.filesModified.join(', ') || 'none'}

Task output (truncated to 2000 chars):
${taskOutput.slice(0, 2000)}

Return this exact JSON structure:
{
  "status": "complete" | "in_progress" | "blocked" | "stuck",
  "confidence": <number 0.0 to 1.0>,
  "evidence": {
    "tests": { "ran": <bool>, "passed": <bool>, "ranAfterChanges": <bool> },
    "build": { "ran": <bool>, "passed": <bool>, "ranAfterChanges": <bool> },
    "lint": { "ran": <bool>, "passed": <bool>, "ranAfterChanges": <bool> }
  },
  "remainingWork": [<string items>],
  "nextSteps": [<string items>],
  "needsHumanAction": [<string items>],
  "stuck": <bool>
}`;
}

// --- Heuristic Fallback ------------------------------------------------------

function heuristicAssessment(taskName: string, taskOutput: string, telemetry: ExecutionTelemetry): ReflectionVerdict {
  const writes = telemetry.toolCalls.filter(tc => tc.isWrite).length;
  const hasOutput = taskOutput.trim().length > 0;
  const mentionsPass = /\bpass(ed)?\b/i.test(taskOutput);
  const mentionsFail = /\bfail(ed|ure)?\b/i.test(taskOutput);
  const mentionsError = /\b(error|exception|crash)\b/i.test(taskOutput);

  let status: ReflectionStatus = 'in_progress';
  let confidence = 0.5;
  const remainingWork: string[] = [];

  if (writes > 0 && hasOutput && mentionsPass && !mentionsFail && !mentionsError) {
    status = 'complete';
    confidence = 0.7;
  } else if (mentionsFail || mentionsError) {
    status = 'blocked';
    confidence = 0.6;
    remainingWork.push('Fix failing tests or errors');
  } else if (writes === 0) {
    status = 'stuck';
    confidence = 0.4;
    remainingWork.push('No write operations detected — task may not have started');
  }

  return {
    sessionId: `heuristic-${Date.now()}`,
    taskName,
    status,
    confidence,
    evidence: {
      tests: { ran: mentionsPass || mentionsFail, passed: mentionsPass && !mentionsFail, ranAfterChanges: false },
      build: { ran: false, passed: false, ranAfterChanges: false },
      lint: { ran: false, passed: false, ranAfterChanges: false },
    },
    remainingWork,
    nextSteps: status === 'complete' ? [] : ['Review task output and retry'],
    needsHumanAction: [],
    stuck: status === 'stuck',
    severity: status === 'complete' ? 'NONE' : status === 'stuck' ? 'HIGH' : 'MEDIUM',
    timestamp: new Date().toISOString(),
  };
}

// --- JSON Parsing ------------------------------------------------------------

function parseVerdictJSON(raw: string): Partial<ReflectionVerdict> | null {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned) as Partial<ReflectionVerdict>;
  } catch {
    // Try to extract JSON from surrounding text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Partial<ReflectionVerdict>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeVerdict(parsed: Partial<ReflectionVerdict>, taskName: string): ReflectionVerdict {
  const defaultGate: EvidenceGate = { ran: false, passed: false, ranAfterChanges: false };
  const evidence = parsed.evidence ?? { tests: defaultGate, build: defaultGate, lint: defaultGate };

  const status = parsed.status ?? 'in_progress';
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

  let severity: Severity = 'NONE';
  if (status === 'stuck') severity = 'HIGH';
  else if (status === 'blocked') severity = 'MEDIUM';
  else if (status === 'in_progress') severity = 'LOW';

  return {
    sessionId: `llm-${Date.now()}`,
    taskName,
    status,
    confidence,
    evidence: {
      tests: { ...defaultGate, ...evidence.tests },
      build: { ...defaultGate, ...evidence.build },
      lint: { ...defaultGate, ...evidence.lint },
    },
    remainingWork: Array.isArray(parsed.remainingWork) ? parsed.remainingWork : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    needsHumanAction: Array.isArray(parsed.needsHumanAction) ? parsed.needsHumanAction : [],
    stuck: parsed.stuck ?? (status === 'stuck'),
    severity,
    timestamp: new Date().toISOString(),
  };
}

// --- Persistence -------------------------------------------------------------

async function persistVerdict(verdict: ReflectionVerdict, cwd = process.cwd()): Promise<string> {
  const dir = path.join(cwd, REFLECTIONS_DIR);
  await fs.mkdir(dir, { recursive: true });

  const safeName = verdict.taskName.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60);
  const filename = `${safeName}-${Date.now()}.json`;
  const filePath = path.join(dir, filename);

  await fs.writeFile(filePath, JSON.stringify(verdict, null, 2));
  return filePath;
}

export async function loadLatestVerdict(cwd = process.cwd()): Promise<ReflectionVerdict | null> {
  const dir = path.join(cwd, REFLECTIONS_DIR);
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    const content = await fs.readFile(path.join(dir, files[0]!), 'utf8');
    return JSON.parse(content) as ReflectionVerdict;
  } catch {
    return null;
  }
}

// --- Core API ----------------------------------------------------------------

export async function reflect(
  taskName: string,
  taskOutput: string,
  telemetry: ExecutionTelemetry,
  cwd?: string,
): Promise<ReflectionVerdict> {
  logger.info(`Reflecting on: ${taskName}`);

  let verdict: ReflectionVerdict;
  const llmReady = await isLLMAvailable();

  if (llmReady) {
    try {
      const prompt = buildSelfAssessmentPrompt(taskName, taskOutput, telemetry);
      const response = await callLLM(prompt, undefined, { recordMemory: false });
      const parsed = parseVerdictJSON(response);

      if (parsed) {
        verdict = normalizeVerdict(parsed, taskName);
      } else {
        logger.warn('Reflection: LLM response was not valid JSON — falling back to heuristics');
        verdict = heuristicAssessment(taskName, taskOutput, telemetry);
      }
    } catch (err) {
      logger.warn(`Reflection LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      verdict = heuristicAssessment(taskName, taskOutput, telemetry);
    }
  } else {
    verdict = heuristicAssessment(taskName, taskOutput, telemetry);
  }

  // Persist
  const verdictPath = await persistVerdict(verdict, cwd);
  logger.info(`Reflection verdict: ${verdict.status} (confidence: ${verdict.confidence}, severity: ${verdict.severity})`);

  // Record to memory if issues found
  if (verdict.severity !== 'NONE') {
    await recordMemory({
      category: 'insight',
      summary: `Reflection on "${taskName}": ${verdict.status} (${verdict.severity})`,
      detail: `Confidence: ${verdict.confidence}, Missing: ${verdict.remainingWork.join(', ') || 'none'}, Path: ${verdictPath}`,
      tags: ['reflection', verdict.status, verdict.severity.toLowerCase()],
      relatedCommands: ['forge', 'party', 'verify'],
    });
  }

  await runHooks(verdict);
  return verdict;
}

export function evaluateVerdict(
  verdict: ReflectionVerdict,
  config: ReflectionConfig = DEFAULT_REFLECTION_CONFIG,
): ReflectionEvaluation {
  const missing: string[] = [];

  // Evidence gates
  if (!verdict.evidence.tests.ran) {
    missing.push('Tests were not run');
  } else if (!verdict.evidence.tests.passed) {
    missing.push('Tests did not pass');
  } else if (!verdict.evidence.tests.ranAfterChanges) {
    missing.push('Tests were not re-run after code changes');
  }

  if (!verdict.evidence.build.ran) {
    missing.push('Build was not run');
  } else if (!verdict.evidence.build.passed) {
    missing.push('Build failed');
  }

  if (!verdict.evidence.lint.ran) {
    missing.push('Lint was not run');
  } else if (!verdict.evidence.lint.passed) {
    missing.push('Lint failed');
  }

  // Confidence check
  if (verdict.confidence < config.confidenceThreshold) {
    missing.push(`Confidence ${verdict.confidence} is below threshold ${config.confidenceThreshold}`);
  }

  // Stuck detection
  if (verdict.stuck) {
    missing.push('Agent reported being stuck — rethink approach');
  }

  // Human action check
  if (verdict.needsHumanAction.length > 0) {
    missing.push(`Needs human action: ${verdict.needsHumanAction.join(', ')}`);
  }

  // Remaining work
  for (const item of verdict.remainingWork) {
    missing.push(`Remaining: ${item}`);
  }

  const complete = verdict.status === 'complete' && missing.length === 0;

  // Score: 0–100 based on gates passed
  let score = 0;
  if (verdict.evidence.tests.ran && verdict.evidence.tests.passed) score += 30;
  if (verdict.evidence.build.ran && verdict.evidence.build.passed) score += 25;
  if (verdict.evidence.lint.ran && verdict.evidence.lint.passed) score += 15;
  score += Math.round(verdict.confidence * 20);
  if (verdict.remainingWork.length === 0) score += 10;

  const feedback = complete
    ? 'All evidence gates passed. Task is complete.'
    : `Task incomplete. Missing: ${missing.join('; ')}`;

  return { complete, missing, feedback, score };
}
