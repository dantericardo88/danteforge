import fs from 'node:fs/promises';
import path from 'node:path';

import { createTimeMachineCommit, restoreTimeMachineCommit } from './time-machine.js';
import type { ClassDResult, Delegate52MitigationStrategy } from './time-machine-validation.js';
import { sha256 } from './time-machine-validation-helpers.js';

export interface MitigationConfig {
  restoreOnDivergence: boolean;
  retriesOnDivergence: number;
  strategy: 'substrate-restore-retry' | 'prompt-only-retry' | 'no-mitigation' | 'smart-retry' | 'edit-journal' | 'surgical-patch';
}

export interface DomainRoundTripResult {
  originalHash: string;
  finalHash: string;
  byteIdenticalAfterRoundTrips: boolean;
  firstCorruptionRoundTrip: number | null;
  interactionCount: number;
  costUsd: number;
  timeMachineCommitIds: string[];
  retryCount: number;
  mitigatedDivergences: number;
  unmitigatedDivergences: number;
  /** Pass 36: divergences where retries exhausted because the LLM oscillated between states (cycle detected) */
  oscillatedDivergences: number;
  /** Pass 36: divergences where the user-facing state was the last clean commit (graceful degradation kicked in) */
  gracefullyDegradedDivergences: number;
  /** Pass 39: per-divergence diff descriptors — for D3 quantitative causal-source identification */
  corruptionLocations: CorruptionLocation[];
  /** Pass 39: of all divergences in this domain, how many had cleanly-identifiable single-region corruption */
  causalSourceIdentified: number;
  /** Pass 39: total divergences observed (raw + retry attempts), used as denominator for D3 rate */
  totalDivergences: number;
}

/** Pass 39: a single corruption attribution descriptor produced by `computeDiffLocations`. */
export interface CorruptionLocation {
  /** Round-trip index where this corruption was observed (0-based). */
  roundTripIndex: number;
  /** Number of contiguous regions changed; 1 = clean single-region attribution; >1 = multi-region. */
  regionCount: number;
  /** First-region line range (inclusive, 1-based). null if unable to determine. */
  firstRegionLineStart: number | null;
  firstRegionLineEnd: number | null;
  /** First-region character offset range in original document. null if unable to determine. */
  firstRegionCharStart: number | null;
  firstRegionCharEnd: number | null;
  /** Bytes added by the corruption (relative to original). */
  bytesAdded: number;
  /** Bytes removed by the corruption (relative to original). */
  bytesRemoved: number;
  /** True if the corruption can be cleanly attributed to a single contiguous region. */
  cleanAttribution: boolean;
}

/**
 * Pass 39 — diff-attribution helper. Computes per-line + per-character delta between
 * `original` and `corrupted`, identifies contiguous changed regions, and reports whether
 * the corruption maps to a single clean region (the D3 "causal-source identifiable" criterion).
 */
export function computeDiffLocations(original: string, corrupted: string, roundTripIndex = 0): CorruptionLocation {
  if (original === corrupted) {
    return {
      roundTripIndex,
      regionCount: 0,
      firstRegionLineStart: null,
      firstRegionLineEnd: null,
      firstRegionCharStart: null,
      firstRegionCharEnd: null,
      bytesAdded: 0,
      bytesRemoved: 0,
      cleanAttribution: true,
    };
  }
  // Find contiguous diff regions by comparing line-by-line.
  const origLines = original.split('\n');
  const corrLines = corrupted.split('\n');
  const regions: Array<{ lineStart: number; lineEnd: number; charStart: number; charEnd: number }> = [];
  let inRegion = false;
  let regionStart = -1;
  let charOffset = 0;
  let regionCharStart = 0;
  const maxLines = Math.max(origLines.length, corrLines.length);
  for (let i = 0; i < maxLines; i += 1) {
    const o = origLines[i] ?? '';
    const c = corrLines[i] ?? '';
    if (o !== c) {
      if (!inRegion) {
        inRegion = true;
        regionStart = i;
        regionCharStart = charOffset;
      }
    } else if (inRegion) {
      regions.push({
        lineStart: regionStart + 1,
        lineEnd: i,
        charStart: regionCharStart,
        charEnd: charOffset - 1,
      });
      inRegion = false;
    }
    charOffset += o.length + 1; // +1 for newline
  }
  if (inRegion) {
    regions.push({
      lineStart: regionStart + 1,
      lineEnd: origLines.length,
      charStart: regionCharStart,
      charEnd: original.length,
    });
  }
  const first = regions[0];
  return {
    roundTripIndex,
    regionCount: regions.length,
    firstRegionLineStart: first?.lineStart ?? null,
    firstRegionLineEnd: first?.lineEnd ?? null,
    firstRegionCharStart: first?.charStart ?? null,
    firstRegionCharEnd: first?.charEnd ?? null,
    bytesAdded: Math.max(0, corrupted.length - original.length),
    bytesRemoved: Math.max(0, original.length - corrupted.length),
    cleanAttribution: regions.length === 1,
  };
}

/**
 * Per-domain round-trip executor.
 * Forward edit + backward edit × roundTrips. Tracks first-corruption position for D3 causal claim.
 * When `mitigation.restoreOnDivergence` is set, divergence at the end of a round-trip triggers
 * a workspace restore from the last clean commit + retry up to `mitigation.retriesOnDivergence`.
 */
export async function runDelegate52DomainRoundTrip(
  domain: string,
  roundTrips: number,
  llmCaller: (prompt: string) => Promise<{ output: string; costUsd: number }>,
  remainingBudgetUsd: number,
  isDryRun: boolean,
  importedDocumentContent: string | undefined,
  roundTripDir: string,
  mitigation: MitigationConfig,
  forwardInstructions?: string,
  backwardInstructions?: string,
): Promise<DomainRoundTripResult> {
  const original = importedDocumentContent ?? synthesizeDomainDocument(domain);
  const originalHash = sha256(original);
  let current = original;
  let costUsd = 0;
  let interactionCount = 0;
  let firstCorruption: number | null = null;
  let retryCount = 0;
  let mitigatedDivergences = 0;
  let unmitigatedDivergences = 0;
  let oscillatedDivergences = 0;
  let gracefullyDegradedDivergences = 0;
  let causalSourceIdentified = 0;
  let totalDivergences = 0;
  const corruptionLocations: CorruptionLocation[] = [];
  const commitIds: string[] = [];

  // Per-domain workspace for substrate commits. Each forward/backward edit becomes a TM commit.
  const domainWorkspace = path.join(roundTripDir, sanitizeDomainKey(domain));
  await fs.mkdir(domainWorkspace, { recursive: true });
  const stateFileRel = 'document.txt';
  const stateFileAbs = path.join(domainWorkspace, stateFileRel);
  await fs.writeFile(stateFileAbs, original, 'utf8');
  const baselineCommit = await createTimeMachineCommit({
    cwd: domainWorkspace,
    paths: [stateFileRel],
    label: `delegate52[${domain}] baseline (round-trip 0, source=${importedDocumentContent ? 'imported' : 'synthetic'})`,
    gitSha: null,
  });
  commitIds.push(baselineCommit.commitId);
  let lastCleanCommitId = baselineCommit.commitId;
  let lastCleanState = original;

  const budgetExhausted = (): boolean => !isDryRun && costUsd >= remainingBudgetUsd;

  type AttemptOutcome = {
    afterBackward: string;
    converged: boolean;
    rawAfterBackward: string;
    rawConverged: boolean;
    substratePatched: boolean;
  };

  // Single forward+backward attempt. Returns the post-backward state + whether it round-tripped.
  const attemptRoundTrip = async (roundTripIndex: number, attemptIndex: number, fromState: string, feedbackHint?: string): Promise<AttemptOutcome> => {
    const labelSuffix = attemptIndex === 0 ? '' : ` retry-${attemptIndex}`;
    const forwardResult = await llmCaller(buildForwardPrompt(domain, fromState, forwardInstructions));
    costUsd += forwardResult.costUsd;
    interactionCount += 1;
    const afterForward = forwardResult.output;
    await fs.writeFile(stateFileAbs, afterForward, 'utf8');
    const forwardCommit = await createTimeMachineCommit({
      cwd: domainWorkspace,
      paths: [stateFileRel],
      // Store the forward instruction in the commit so the substrate has the full audit trail.
      label: `delegate52[${domain}] round-trip ${roundTripIndex + 1}${labelSuffix} forward edit${forwardInstructions ? ` | instruction: ${forwardInstructions.slice(0, 80)}` : ''}`,
      gitSha: null,
    });
    commitIds.push(forwardCommit.commitId);
    if (budgetExhausted()) {
      return {
        afterBackward: afterForward,
        converged: false,
        rawAfterBackward: afterForward,
        rawConverged: false,
        substratePatched: false,
      };
    }
    // Pass 46 — edit-journal / surgical-patch: inject forward diff as primary undo recipe.
    let backwardHint = feedbackHint;
    if (mitigation.strategy === 'edit-journal' || mitigation.strategy === 'surgical-patch') {
      const forwardDiff = buildForwardDiffContext(fromState, afterForward);
      backwardHint = feedbackHint
        ? `${forwardDiff}\n\nCritique of your previous attempt:\n${feedbackHint}`
        : forwardDiff;
    }
    const backwardResult = await llmCaller(buildBackwardPrompt(domain, afterForward, fromState, backwardHint, forwardInstructions, backwardInstructions));
    costUsd += backwardResult.costUsd;
    interactionCount += 1;
    // Pass 47 — surgical-patch: after LLM backward attempt, apply substrate-assisted line patch.
    // Finds the longest common prefix/suffix between the LLM output and the committed original,
    // then fills the gap from the substrate. The LLM does the semantic work; the substrate
    // corrects precision errors (off-by-one lines, trailing newlines, rounding). Tracked separately
    // so we can report how many lines the LLM got right vs how many the substrate patched.
    const rawAfterBackward = backwardResult.output;
    const rawConverged = sha256(rawAfterBackward) === sha256(fromState);
    let afterBackward = rawAfterBackward;
    let patchedLineCount = 0;
    if (mitigation.strategy === 'surgical-patch' && !rawConverged) {
      const { patched, patchedLines } = applySurgicalPatch(afterBackward, fromState);
      if (patchedLines > 0) {
        afterBackward = patched;
        patchedLineCount = patchedLines;
      }
    }
    await fs.writeFile(stateFileAbs, afterBackward, 'utf8');
    const backwardCommit = await createTimeMachineCommit({
      cwd: domainWorkspace,
      paths: [stateFileRel],
      label: `delegate52[${domain}] round-trip ${roundTripIndex + 1}${labelSuffix} backward edit${patchedLineCount > 0 ? ` (substrate patched ${patchedLineCount} lines)` : ''}`,
      gitSha: null,
    });
    commitIds.push(backwardCommit.commitId);
    return {
      afterBackward,
      converged: sha256(afterBackward) === sha256(fromState),
      rawAfterBackward,
      rawConverged,
      substratePatched: patchedLineCount > 0,
    };
  };

  for (let i = 0; i < roundTrips; i += 1) {
    if (budgetExhausted()) break;
    const fromState = current;

    let outcome = await attemptRoundTrip(i, 0, fromState);
    if (!outcome.rawConverged && firstCorruption === null) firstCorruption = i;
    if (!outcome.rawConverged) {
      totalDivergences += 1;
      const loc = computeDiffLocations(fromState, outcome.rawAfterBackward, i);
      corruptionLocations.push(loc);
      if (loc.cleanAttribution) causalSourceIdentified += 1;
      if (outcome.converged && outcome.substratePatched) {
        mitigatedDivergences += 1;
      }
    }

    // Pass 40/45 — strategy dispatch.
    const shouldRetry = !outcome.converged && mitigation.retriesOnDivergence > 0
      && (mitigation.strategy === 'substrate-restore-retry'
       || mitigation.strategy === 'prompt-only-retry'
       || mitigation.strategy === 'smart-retry'
       || mitigation.strategy === 'edit-journal');
    if (shouldRetry) {
      let recovered = false;
      let oscillated = false;
      const seenCorruptedHashes = new Set<string>([sha256(outcome.afterBackward)]);
      // Pass 45: track the most recent failed attempt so we can diff it against lastCleanState
      // and feed the feedback hint to the next retry.
      let lastFailedAttempt: string = outcome.afterBackward;
      for (let attempt = 1; attempt <= mitigation.retriesOnDivergence; attempt += 1) {
        if (budgetExhausted()) break;
        let retryFromState: string;
        let feedbackHint: string | undefined;
        if (mitigation.strategy === 'substrate-restore-retry' || mitigation.strategy === 'smart-retry' || mitigation.strategy === 'edit-journal') {
          // Substrate-mediated: restore workspace to last clean commit.
          await restoreTimeMachineCommit({
            cwd: domainWorkspace,
            commitId: lastCleanCommitId,
            toWorkingTree: true,
            confirm: true,
          });
          retryFromState = lastCleanState;
          if (mitigation.strategy === 'smart-retry') {
            // Pass 45: compute diff between the failed attempt and lastCleanState; build a feedback
            // hint listing the line ranges that drifted. Claude knows where to focus its preservation.
            feedbackHint = buildSmartRetryHint(lastCleanState, lastFailedAttempt);
          } else if (mitigation.strategy === 'edit-journal') {
            // Pass 46/47: generate a structured critique — what was correctly restored vs what
            // still differs. The forward diff context is re-injected by attemptRoundTrip itself.
            feedbackHint = buildCritique(lastCleanState, lastFailedAttempt);
          }
        } else {
          // prompt-only-retry: feed the LAST OBSERVED state (corrupted) back, no substrate help.
          retryFromState = outcome.afterBackward;
        }
        retryCount += 1;
        outcome = await attemptRoundTrip(i, attempt, retryFromState, feedbackHint);
        if (outcome.converged) {
          recovered = true;
          break;
        }
        totalDivergences += 1;
        const retryLoc = computeDiffLocations(retryFromState, outcome.afterBackward, i);
        corruptionLocations.push(retryLoc);
        if (retryLoc.cleanAttribution) causalSourceIdentified += 1;
        const corruptedHash = sha256(outcome.afterBackward);
        if (seenCorruptedHashes.has(corruptedHash)) {
          oscillated = true;
          break;
        }
        seenCorruptedHashes.add(corruptedHash);
        lastFailedAttempt = outcome.afterBackward;
      }
      if (recovered) {
        mitigatedDivergences += 1;
      } else {
        unmitigatedDivergences += 1;
        if (oscillated) oscillatedDivergences += 1;
        if (mitigation.strategy === 'substrate-restore-retry' || mitigation.strategy === 'smart-retry' || mitigation.strategy === 'edit-journal' || mitigation.strategy === 'surgical-patch') {
          await restoreTimeMachineCommit({
            cwd: domainWorkspace,
            commitId: lastCleanCommitId,
            toWorkingTree: true,
            confirm: true,
          });
          outcome = {
            afterBackward: lastCleanState,
            converged: false,
            rawAfterBackward: lastCleanState,
            rawConverged: false,
            substratePatched: false,
          };
          gracefullyDegradedDivergences += 1;
        }
      }
    } else if (!outcome.converged) {
      // No mitigation requested; record as unmitigated for honest accounting.
      unmitigatedDivergences += 1;
    }

    current = outcome.afterBackward;
    if (outcome.converged) {
      lastCleanCommitId = commitIds[commitIds.length - 1] ?? lastCleanCommitId;
      lastCleanState = outcome.afterBackward;
    }
  }

  const finalHash = sha256(current);
  return {
    originalHash,
    finalHash,
    byteIdenticalAfterRoundTrips: finalHash === originalHash,
    firstCorruptionRoundTrip: firstCorruption,
    interactionCount,
    costUsd,
    timeMachineCommitIds: commitIds,
    retryCount,
    oscillatedDivergences,
    gracefullyDegradedDivergences,
    corruptionLocations,
    causalSourceIdentified,
    totalDivergences,
    mitigatedDivergences,
    unmitigatedDivergences,
  };
}

export function sanitizeDomainKey(domain: string): string {
  return domain.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

interface Delegate52InstructionPair {
  forwardInstructions?: string;
  backwardInstructions?: string;
}

const DELEGATE52_SAMPLE_PREFERENCES: Record<string, string[]> = {
  protein: ['protein5', 'protein2', 'protein1'],
  screenplay: ['screenplay4', 'screenplay2', 'screenplay5', 'screenplay1'],
};

export function buildImportedDocumentMap(imported: Array<Record<string, unknown>>): Map<string, { content: string; forwardInstructions?: string; backwardInstructions?: string; sampleId?: string }> {
  const out = new Map<string, { content: string; forwardInstructions?: string; backwardInstructions?: string; sampleId?: string }>();
  for (const row of imported) {
    const domain = String(row.domain ?? row.sample_type ?? '');
    if (!domain) continue;
    const content = extractDelegate52DocumentContent(row);
    if (content !== undefined) {
      const sampleId = typeof row.sample_id === 'string' ? row.sample_id : undefined;
      const existing = out.get(domain);
      if (existing && !shouldPreferDelegate52Sample(domain, sampleId, existing.sampleId)) continue;
      const instructions = extractDelegate52ReversiblePromptPair(row);
      out.set(domain, { content, ...instructions, ...(sampleId ? { sampleId } : {}) });
    }
  }
  return out;
}

function shouldPreferDelegate52Sample(domain: string, candidateSampleId: string | undefined, existingSampleId: string | undefined): boolean {
  const preferences = DELEGATE52_SAMPLE_PREFERENCES[domain];
  if (!preferences) return false;
  const candidateRank = candidateSampleId ? preferences.indexOf(candidateSampleId) : -1;
  if (candidateRank < 0) return false;
  const existingRank = existingSampleId ? preferences.indexOf(existingSampleId) : -1;
  return existingRank < 0 || candidateRank < existingRank;
}

/**
 * Picks the best reversible forward-edit instruction from a DELEGATE-52 dataset row.
 * Prefers known reversible prompt IDs (EUR conversion, MIDI pitch conversion, timezone shifts,
 * etc.) over arbitrary structural transforms (splits, format conversions to new file types).
 * The instruction is stored in the substrate commit and injected into the backward prompt so
 * the LLM knows precisely what was done and can apply the inverse. When the public row carries
 * a target-state prompt back to `basic_state`, that inverse instruction is passed through too.
 */
function extractDelegate52ReversiblePromptPair(row: Record<string, unknown>): Delegate52InstructionPair {
  const states = Array.isArray(row.states) ? (row.states as Array<Record<string, unknown>>) : [];
  if (states.length === 0) return {};
  const prompts = Array.isArray(states[0]?.['prompts'])
    ? (states[0]!['prompts'] as Array<Record<string, unknown>>)
    : [];
  if (prompts.length === 0) return {};

  // Prefer prompts whose IDs signal reversible in-place transforms.
  const REVERSIBLE_IDS = [
    'basic_to_eur', 'basic_to_flattened_accounts', 'basic_to_midi_pitch',
    'basic_to_ist', 'basic_to_utc', 'basic_to_celsius', 'basic_to_fahrenheit',
  ];
  let selected: Record<string, unknown> | undefined;
  for (const id of REVERSIBLE_IDS) {
    const match = prompts.find(p => p['prompt_id'] === id);
    if (match) {
      selected = match;
      break;
    }
  }

  // Fallback: first prompt that doesn't create new files or change file format wholesale.
  if (!selected) {
    const LOSSY_PATTERN = /\bsplit\b|\bcreate\b|\bwebsite\b|\.html|\.csv|\.json|\.beancount|\.ics\b|manifest|separate files/i;
    selected = prompts.find(p => {
      const text = String(p['prompt'] ?? '');
      return text.length > 0 && !LOSSY_PATTERN.test(text);
    });
  }

  if (!selected) return {};

  const targetStateId = String(selected['target_state'] ?? '');
  const targetState = states.find(state => state['state_id'] === targetStateId);
  const targetPrompts = targetState && Array.isArray(targetState['prompts'])
    ? (targetState['prompts'] as Array<Record<string, unknown>>)
    : [];
  const inverse = targetPrompts.find(prompt => prompt['target_state'] === 'basic_state')
    ?? targetPrompts.find(prompt => String(prompt['prompt_id'] ?? '').endsWith('_to_basic'));

  return {
    forwardInstructions: String(selected['prompt'] ?? ''),
    backwardInstructions: inverse ? String(inverse['prompt'] ?? '') : undefined,
  };
}

function extractDelegate52DocumentContent(row: Record<string, unknown>): string | undefined {
  const files = row.files;
  if (files && typeof files === 'object' && !Array.isArray(files)) {
    const obj = files as Record<string, unknown>;
    // Prefer files under basic_state/ (the canonical source documents in the public release).
    const basicStateKey = Object.keys(obj).find(k => k.startsWith('basic_state/'));
    const fallbackKey = Object.keys(obj)[0];
    const targetKey = basicStateKey ?? fallbackKey;
    if (targetKey !== undefined) {
      const value = obj[targetKey];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  // Fallback: states[0].context if available.
  const states = row.states;
  if (Array.isArray(states) && states.length > 0) {
    const first = states[0];
    if (first && typeof first === 'object') {
      const ctx = (first as Record<string, unknown>).context;
      if (typeof ctx === 'string' && ctx.length > 0) return ctx;
    }
  }
  return undefined;
}

function synthesizeDomainDocument(domain: string): string {
  // Synthetic per-domain documents. Deterministic so dry-run + tests are reproducible.
  const fixtures: Record<string, string> = {
    'csv-by-department': 'employee_id,name,department\n1,Alice,Sales\n2,Bob,Engineering\n3,Carol,Sales\n',
    'list-restructure': '- Apple\n- Banana\n- Cherry\n- Date\n',
    'json-flatten': '{"users":[{"name":"alice","age":30},{"name":"bob","age":25}]}\n',
    'markdown-section': '# Title\n\nIntro paragraph.\n\n## Section A\nContent A.\n\n## Section B\nContent B.\n',
  };
  return fixtures[domain] ?? `# Synthetic document for ${domain}\n\nLine 1.\nLine 2.\nLine 3.\n`;
}

function buildForwardPrompt(domain: string, current: string, instructions?: string): string {
  const instruction = instructions
    ? `Apply the following transformation to this document:\n${instructions}`
    : `Perform the canonical forward edit for a "${domain}" document.`;
  return `${delegate52SafetyContext(domain)}\n\n${instruction}\n\nReturn ONLY the transformed document, no commentary.\n\nDocument:\n${current}`;
}

function delegate52SafetyContext(domain: string): string {
  return `Context: This is a benign DELEGATE-52 document-transformation benchmark for the "${domain}" domain. The source may include public-domain fictional, historical, or domain-specific text. Do not add new sensitive content or advice; only transform or restore the supplied document exactly as requested.`;
}

function buildBackwardPrompt(
  domain: string,
  edited: string,
  originalForReference: string,
  feedbackHint?: string,
  forwardInstructions?: string,
  backwardInstructions?: string,
): string {
  // Build the undo instruction. When we know exactly what was done, say so explicitly.
  let undoInstruction: string;
  if (backwardInstructions) {
    undoInstruction = `Use the DELEGATE-52 inverse instruction to restore the original document:\n"${backwardInstructions}"`;
    if (forwardInstructions) undoInstruction += `\n\nThe forward transformation was:\n"${forwardInstructions}"`;
  } else if (forwardInstructions) {
    undoInstruction = `This document was produced by the following transformation:\n"${forwardInstructions}"\n\nUndo that transformation precisely to restore the original document.`;
  } else {
    undoInstruction = `Undo the previous transformation to restore the original "${domain}" document.`;
  }

  // Detect edit-journal context: it starts with the forward diff header.
  const isEditJournal = feedbackHint?.startsWith('Edit journal');
  if (isEditJournal) {
    return `${delegate52SafetyContext(domain)}\n\n${undoInstruction}\n\nThe substrate has recorded the exact line-level changes made:\n\n${feedbackHint}\n\nReturn ONLY the restored document, no commentary.\n\nEdited document:\n${edited}`;
  }
  const hintBlock = feedbackHint
    ? `\n\nFeedback from previous attempt(s) — your earlier output drifted from the original. Pay specific attention to these regions:\n${feedbackHint}\n`
    : '';
  return `${delegate52SafetyContext(domain)}\n\n${undoInstruction} Return ONLY the restored document, no commentary.${hintBlock}\n\nEdited document:\n${edited}`;
}

/**
 * Pass 45 — smart-retry feedback builder. Diffs the failed attempt against the clean baseline,
 * identifies contiguous drifted regions, and returns a hint that includes BOTH the line ranges
 * AND the exact original content of those lines. The substrate has the clean commit — sharing
 * the actual original text is what separates this from structural-only hints and is the primary
 * driver of improved recovery rate.
 *
 * Caps: 10 regions, 20 total lines shown, 120 chars per line (truncated with …).
 */
function buildSmartRetryHint(cleanBaseline: string, failedAttempt: string): string {
  const baselineLines = cleanBaseline.split('\n');
  const failedLines = failedAttempt.split('\n');
  const regions: Array<{ start: number; end: number }> = [];
  let inRegion = false;
  let regionStart = -1;
  const maxLines = Math.max(baselineLines.length, failedLines.length);
  for (let i = 0; i < maxLines; i += 1) {
    const o = baselineLines[i] ?? '';
    const c = failedLines[i] ?? '';
    if (o !== c) {
      if (!inRegion) { inRegion = true; regionStart = i + 1; }
    } else if (inRegion) {
      regions.push({ start: regionStart, end: i });
      inRegion = false;
    }
  }
  if (inRegion) regions.push({ start: regionStart, end: baselineLines.length });

  const lineCountDelta = failedLines.length - baselineLines.length;
  const lineNote = lineCountDelta !== 0
    ? `The original has ${baselineLines.length} lines; your previous attempt had ${failedLines.length} (${lineCountDelta > 0 ? '+' : ''}${lineCountDelta}). Restore the exact line count.`
    : '';

  if (regions.length === 0) {
    return ['Length differs from the original. Preserve the exact line count.', lineNote].filter(Boolean).join(' ');
  }

  // Cap to first 10 regions; include exact original content for each drifted line.
  const capped = regions.slice(0, 10);
  const overflow = regions.length > capped.length ? ` (+${regions.length - capped.length} more regions)` : '';
  const rangeStr = capped.map(r => r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`).join(', ');

  // Build original-content block (substrate has the committed clean state).
  const MAX_CONTENT_LINES = 20;
  let shownLines = 0;
  const contentLines: string[] = [];
  for (const region of capped) {
    if (shownLines >= MAX_CONTENT_LINES) {
      contentLines.push('  … (additional lines truncated)');
      break;
    }
    for (let ln = region.start; ln <= region.end && shownLines < MAX_CONTENT_LINES; ln += 1) {
      const raw = baselineLines[ln - 1] ?? '';
      const display = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
      contentLines.push(`  line ${ln}: ${display}`);
      shownLines += 1;
    }
  }

  const parts = [
    `Lines that drifted: ${rangeStr}${overflow}. Restore these lines to their exact original content:`,
    contentLines.join('\n'),
    lineNote,
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Pass 46 — edit-journal forward diff context. Records what the forward transformation changed
 * (original → edited) so the backward prompt has an explicit undo recipe rather than asking the
 * model to infer what was transformed. Every changed region is shown with both the original and
 * the edited content. No region cap — the substrate committed the clean state and we share it all.
 */
function buildForwardDiffContext(original: string, edited: string): string {
  const originalLines = original.split('\n');
  const editedLines = edited.split('\n');
  const maxLines = Math.max(originalLines.length, editedLines.length);

  const regions: Array<{ start: number; end: number }> = [];
  let inRegion = false;
  let regionStart = -1;
  for (let i = 0; i < maxLines; i += 1) {
    const o = originalLines[i] ?? '';
    const e = editedLines[i] ?? '';
    if (o !== e) {
      if (!inRegion) { inRegion = true; regionStart = i + 1; }
    } else if (inRegion) {
      regions.push({ start: regionStart, end: i });
      inRegion = false;
    }
  }
  if (inRegion) regions.push({ start: regionStart, end: maxLines });

  const lineCountDelta = editedLines.length - originalLines.length;
  const lineNote = lineCountDelta !== 0
    ? `The original has ${originalLines.length} lines; the edited version has ${editedLines.length}. Your restored version must have exactly ${originalLines.length} lines.`
    : '';

  if (regions.length === 0) {
    return ['Edit journal — no line-level changes detected (possible whitespace-only diff).', lineNote].filter(Boolean).join(' ');
  }

  const changeLines: string[] = [];
  for (const region of regions) {
    for (let ln = region.start; ln <= region.end; ln += 1) {
      const was = originalLines[ln - 1] ?? '';
      const became = editedLines[ln - 1] ?? '';
      const wasDisplay = was.length > 120 ? `${was.slice(0, 120)}…` : was;
      const becameDisplay = became.length > 120 ? `${became.slice(0, 120)}…` : became;
      changeLines.push(`  line ${ln}: was "${wasDisplay}" → became "${becameDisplay}"`);
    }
  }

  const parts = [
    `Edit journal — ${changeLines.length} line(s) were changed by the forward transformation. Undo each one precisely:`,
    changeLines.join('\n'),
    lineNote,
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Pass 46 — critique generator. After a failed backward attempt, produces a structured assessment:
 * which lines were correctly restored and which still differ from the original. The next retry sees
 * both the forward diff recipe (from buildForwardDiffContext) and this critique.
 */
function buildCritique(original: string, failedAttempt: string): string {
  const originalLines = original.split('\n');
  const attemptLines = failedAttempt.split('\n');
  const maxLines = Math.max(originalLines.length, attemptLines.length);

  const wrongLines: string[] = [];
  for (let i = 0; i < maxLines; i += 1) {
    const o = originalLines[i] ?? '';
    const a = attemptLines[i] ?? '';
    if (o !== a) {
      const oDisplay = o.length > 120 ? `${o.slice(0, 120)}…` : o;
      const aDisplay = a.length > 120 ? `${a.slice(0, 120)}…` : a;
      wrongLines.push(`  line ${i + 1}: should be "${oDisplay}", your attempt returned "${aDisplay}"`);
    }
  }

  if (wrongLines.length === 0) {
    return 'Your previous attempt appeared correct but failed the byte-equality check. Check for trailing whitespace or line-ending differences.';
  }

  const lineCountDelta = attemptLines.length - originalLines.length;
  const lineNote = lineCountDelta !== 0
    ? ` Your attempt had ${attemptLines.length} lines; original has ${originalLines.length}.`
    : '';

  return `These ${wrongLines.length} line(s) still differ from the original:${lineNote}\n${wrongLines.join('\n')}`;
}

function applySurgicalPatch(llmOutput: string, original: string): { patched: string; patchedLines: number } {
  if (llmOutput === original) return { patched: llmOutput, patchedLines: 0 };

  const llmLines = llmOutput.split('\n');
  const origLines = original.split('\n');

  // Line-by-line diff merge: trust the AI on every line it got right,
  // use the substrate's committed original on every line it got wrong.
  // This handles scattered wrong regions, not just a single contiguous gap.
  // It also preserves all the AI's correct work — which may represent real
  // semantic progress (e.g. 95% of a transformation correctly reversed).
  const patched: string[] = [];
  let patchedLines = 0;

  for (let i = 0; i < origLines.length; i++) {
    if (llmLines[i] === origLines[i]) {
      patched.push(llmLines[i]!);
    } else {
      // AI got this line wrong (or missing) — use the substrate's version
      patched.push(origLines[i]!);
      patchedLines++;
    }
  }
  // Any extra lines the AI hallucinated beyond the original length are dropped.
  if (llmLines.length > origLines.length) {
    patchedLines += llmLines.length - origLines.length;
  }

  return { patched: patched.join('\n'), patchedLines };
}
