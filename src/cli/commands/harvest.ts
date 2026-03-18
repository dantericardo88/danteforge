// Harvest command — Titan Harvest V2 track runner
// Three modes: --prompt (copy-paste template), LLM execute (fills each step via API), local fallback (display template)
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import {
  createEmptyTrack,
  computeTrackHash,
  writeTrackFiles,
  loadTrackCount,
  shouldTriggerMetaEvolution,
  type HarvestTrack,
} from '../../core/harvest-engine.js';
import { auditSelfEdit } from '../../core/safe-self-edit.js';

// ─── Copy-paste prompt template ───────────────────────────────────────────────

function buildHarvestTemplate(system: string, mode: 'full' | 'sep-lite'): string {
  const isLite = mode === 'sep-lite';
  const donorRange = isLite ? '2-3' : '3-8';
  const organRange = isLite ? '2-4' : '3-6';

  return `Titan Harvest V2 — Hyper-Efficient Track
System: ${system}${isLite ? ' (SEP-LITE MODE)' : ''}

Core Principles:
1. Pattern Learning Only — Extract superpowers, mechanical patterns, and donor-agnostic metacode idioms. Never copy code, schemas, assets, or visuals.
2. Constitutional Lock-In — Once ratified, the track is immutable. Changes = new track or additive expansion only.
3. Mechanical Purity + Determinism — Every operation is hash-verifiable. Systems are regulators, not thinkers.
4. Ruthless Deletion & Simplicity — If anything can be deleted, merged, or skipped without breaking invariants → it must be.
5. Evidence-Driven + Agile Immutability — 100% replayable via hashes. Scope expansion only through mechanical protocols.

═══════════════════════════════════════════════════════
STEP 1: DISCOVERY
═══════════════════════════════════════════════════════
System Objective (1 sentence, locked):
<fill>

Donors (${donorRange} max): Name | Why | 1-2 superpowers each
<fill>

Superpower Clusters (3-5 max):
<fill>

Proposed Organs (${organRange} max): Name | Mandate (may-do) | Prohibition (must-not) | Boundary note
<fill>

═══════════════════════════════════════════════════════
STEP 2: CONSTITUTION & BEHAVIOR
═══════════════════════════════════════════════════════
For each organ:
  Mandates (4-6 bullets)
  Prohibitions (4-6 bullets)
  States (3-5, with invariants)
  Operations (4-7, with inputs/outputs/pre-post conditions)

Global mandates (3-5):
<fill>

Global prohibitions (3-5):
<fill>

═══════════════════════════════════════════════════════
STEP 3: WIRING
═══════════════════════════════════════════════════════
Signals (5-10 max): Name | Schema (simple JSON shape) | Invariants
<fill>

Wiring Map (OrganA → Signal → OrganB):
<fill>

Dependency Graph:
<fill>

Spine Compliance (YES/NO): API envelope | Event envelope | ID/time rules | RBAC | Audit fields
<fill>
${isLite ? '' : `
═══════════════════════════════════════════════════════
STEP 4: EVIDENCE & TESTS
═══════════════════════════════════════════════════════
Evidence Rules (4-6 types + sufficiency gates):
<fill>

Test Charters (4-6 categories + 2-3 adversarials each):
<fill>

Golden Flows (1-3 flows this machine touches + exact invariants):
<fill>
`}
═══════════════════════════════════════════════════════
STEP 5: RATIFICATION & METACODE
═══════════════════════════════════════════════════════
Metacode Catalog (2-5 donor-agnostic pseudo patterns + 2-4 anti-patterns to reject):
<fill>

Gate Sheet Result (Defined = YES/NO):
<fill>

Expansion Readiness Score (1-10, must be ≥8):
<fill>

Reflection (one sentence: "One waste we deleted this track: …"):
<fill>

sha256(entire_track_text): <computed by DanteForge>
summary.json: { "trackId": "...", "organs": [...], "goldenFlows": [...], "expansionReadiness": ... }

After Step 5: The track is now ratified and frozen. Save the output as JSON and run:
  danteforge harvest "${system}"${isLite ? ' --lite' : ''}
`;
}

// ─── LLM prompt builders for each step ───────────────────────────────────────

function buildStep1Prompt(system: string, mode: 'full' | 'sep-lite'): string {
  const isLite = mode === 'sep-lite';
  return `You are running a Titan Harvest V2 track for the system: "${system}"${isLite ? ' (SEP-LITE mode — focused, minimal)' : ''}.

Execute Step 1: Discovery.

Output ONLY valid JSON with this exact shape:
{
  "objective": "<1 sentence system objective>",
  "donors": [
    { "name": "<donor>", "why": "<rationale>", "superpowers": ["<sp1>", "<sp2>"] }
  ],
  "superpowerClusters": ["<cluster1>", "<cluster2>", "<cluster3>"],
  "organs": [
    {
      "name": "<organ>",
      "mandate": ["<mandate1>"],
      "prohibitions": ["<prohib1>"],
      "boundaryNote": "<boundary>"
    }
  ]
}

Rules:
- Donors: ${isLite ? '2-3' : '3-8'} max
- Organs: ${isLite ? '2-4' : '3-6'} max
- SuperpowerClusters: 3-5 max
- Pattern learning only — no code or schema copying
- Output ONLY the JSON, no preamble.`;
}

function buildStep2Prompt(system: string, step1: HarvestTrack['step1Discovery']): string {
  return `You are running a Titan Harvest V2 track for: "${system}".

Step 1 output:
${JSON.stringify(step1, null, 2)}

Execute Step 2: Constitution & Behavior.

Output ONLY valid JSON:
{
  "organBehaviors": {
    "<organName>": {
      "mandates": ["<m1>", "<m2>", "<m3>", "<m4>"],
      "prohibitions": ["<p1>", "<p2>", "<p3>", "<p4>"],
      "states": ["<s1>", "<s2>", "<s3>"],
      "operations": ["<o1>", "<o2>", "<o3>", "<o4>"]
    }
  },
  "globalMandates": ["<gm1>", "<gm2>", "<gm3>"],
  "globalProhibitions": ["<gp1>", "<gp2>", "<gp3>"]
}

Rules:
- Each organ: 4-6 mandates, 4-6 prohibitions, 3-5 states, 4-7 operations
- Global: 3-5 mandates, 3-5 prohibitions
- No semantics, no discretion, no TBD
- Output ONLY the JSON, no preamble.`;
}

function buildStep3Prompt(
  system: string,
  step1: HarvestTrack['step1Discovery'],
): string {
  return `You are running a Titan Harvest V2 track for: "${system}".

Step 1 organs: ${step1.organs.map(o => o.name).join(', ')}

Execute Step 3: Wiring.

Output ONLY valid JSON:
{
  "signals": [
    { "name": "<signal>", "schema": "{ key: type }", "invariants": "<invariant>" }
  ],
  "wiringMap": "<OrganA> → <Signal> → <OrganB>\\n...",
  "dependencyGraph": "<text dependency graph>",
  "spineCompliance": {
    "apiEnvelope": true,
    "eventEnvelope": true,
    "idTimeRules": true,
    "rbac": true,
    "auditFields": true
  }
}

SPINE-REV-0 canonical shapes (declare compliance for each):
  API: { "ok": bool, "data": <payload> } or { "ok": false, "error": { "code": "kebab", "message": "..." } }
  Event: { "id": "ULID", "at": "ISO8601", "kind": "domain.action", "level": "...", "actor": {}, "data": {} }
  IDs: ULID or UUIDv7
  Auth: deny-by-default RBAC
  Audit: actor, action, object, before/after hash, correlationId

Rules:
- Signals: 5-10 max
- Binary YES/NO for each spine compliance key (true/false)
- Output ONLY the JSON, no preamble.`;
}

function buildStep4Prompt(
  system: string,
  step1: HarvestTrack['step1Discovery'],
): string {
  return `You are running a full Titan Harvest V2 track for: "${system}".

Step 1 organs: ${step1.organs.map(o => o.name).join(', ')}

Execute Step 4: Evidence & Tests.

Output ONLY valid JSON:
{
  "evidenceRules": [
    "<rule1>: <sufficiency gate>",
    "<rule2>: <sufficiency gate>"
  ],
  "testCharters": [
    "<category>: <adversarial1>, <adversarial2>",
    "<category>: <adversarial1>, <adversarial2>"
  ],
  "goldenFlows": [
    "<flow name>: <invariants + evidence guaranteed>"
  ]
}

Rules:
- evidenceRules: 4-6 entries
- testCharters: 4-6 categories with 2-3 adversarials each
- goldenFlows: 1-3 entries
- Output ONLY the JSON, no preamble.`;
}

function buildStep5Prompt(
  system: string,
  track: HarvestTrack,
): string {
  return `You are running a Titan Harvest V2 track for: "${system}".

Prior steps summary:
- Organs: ${track.step1Discovery.organs.map(o => o.name).join(', ')}
- Superpower clusters: ${track.step1Discovery.superpowerClusters.join(', ')}
- Global mandates: ${track.step2Constitution.globalMandates.join('; ')}

Execute Step 5: Ratification & Metacode.

Output ONLY valid JSON:
{
  "metacodeCatalog": {
    "patterns": ["<pattern1>", "<pattern2>"],
    "antiPatterns": ["<antiPattern1>", "<antiPattern2>"]
  },
  "gateSheet": {
    "<gate1>": true,
    "<gate2>": true
  },
  "expansionReadiness": 9,
  "reflection": "One waste we deleted this track: ..."
}

Rules:
- metacodeCatalog.patterns: 2-5 donor-agnostic pseudo patterns
- metacodeCatalog.antiPatterns: 2-4 anti-patterns to reject
- expansionReadiness: 1-10 (must be ≥8 or reflect and note why)
- reflection: exactly one sentence starting with "One waste we deleted this track:"
- Output ONLY the JSON, no preamble.`;
}

// ─── JSON extraction helper ───────────────────────────────────────────────────

function extractJson<T>(raw: string): T {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = jsonMatch?.[1]?.trim() ?? raw.trim();
  return JSON.parse(candidate) as T;
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function harvest(
  system: string,
  options: { lite?: boolean; prompt?: boolean } = {},
): Promise<void> {
  const mode: 'full' | 'sep-lite' = options.lite ? 'sep-lite' : 'full';

  logger.info(`Titan Harvest V2 — system: "${system}" (${mode} mode)`);

  const state = await loadState();
  const template = buildHarvestTemplate(system, mode);

  // Mode 1: --prompt (display the 5-step template for copy-paste)
  if (options.prompt) {
    const savedPath = await savePrompt(`harvest-${system.replace(/\s+/g, '-')}`, template);
    displayPrompt(template, [
      'Fill in each step and paste the output back.',
      `Prompt saved to: ${savedPath}`,
      'Once you have the completed JSON, re-run without --prompt to write the track files.',
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | harvest: prompt generated for "${system}"`);
    await saveState(state);
    return;
  }

  // Mode 2: LLM execute — fill each step via API
  const llmAvailable = await isLLMAvailable();

  if (llmAvailable) {
    logger.info('LLM available — running Titan Harvest V2 steps via API...');

    try {
      const track = createEmptyTrack(system, mode);

      // Step 1: Discovery
      logger.info('Step 1: Discovery...');
      const step1Raw = await callLLM(buildStep1Prompt(system, mode));
      const step1Data = extractJson<HarvestTrack['step1Discovery']>(step1Raw);
      track.step1Discovery = step1Data;
      logger.success(`Step 1 complete — ${step1Data.organs.length} organ(s) discovered`);

      // Step 2: Constitution
      logger.info('Step 2: Constitution & Behavior...');
      const step2Raw = await callLLM(buildStep2Prompt(system, track.step1Discovery));
      const step2Data = extractJson<HarvestTrack['step2Constitution']>(step2Raw);
      track.step2Constitution = step2Data;
      logger.success('Step 2 complete');

      // Step 3: Wiring
      logger.info('Step 3: Wiring...');
      const step3Raw = await callLLM(buildStep3Prompt(system, track.step1Discovery));
      const step3Data = extractJson<HarvestTrack['step3Wiring']>(step3Raw);
      track.step3Wiring = step3Data;
      logger.success(`Step 3 complete — ${step3Data.signals.length} signal(s) wired`);

      // Step 4: Evidence (full mode only)
      if (mode === 'full') {
        logger.info('Step 4: Evidence & Tests...');
        const step4Raw = await callLLM(buildStep4Prompt(system, track.step1Discovery));
        const step4Data = extractJson<NonNullable<HarvestTrack['step4Evidence']>>(step4Raw);
        track.step4Evidence = step4Data;
        logger.success(`Step 4 complete — ${step4Data.goldenFlows.length} golden flow(s)`);
      } else {
        logger.info('Step 4: Skipped (SEP-LITE mode)');
      }

      // Step 5: Ratification
      logger.info('Step 5: Ratification & Metacode...');
      const step5Raw = await callLLM(buildStep5Prompt(system, track));
      const step5Data = extractJson<Omit<HarvestTrack['step5Ratification'], 'hash'>>(step5Raw);
      track.step5Ratification = { ...step5Data, hash: '' };

      // Compute deterministic hash and finalize summary
      const hash = computeTrackHash(track);
      track.step5Ratification.hash = hash;

      const goldenFlows = mode === 'full' && track.step4Evidence
        ? track.step4Evidence.goldenFlows
        : [];

      track.summary = {
        trackId: track.trackId,
        organs: track.step1Discovery.organs.map(o => o.name),
        goldenFlows,
        expansionReadiness: track.step5Ratification.expansionReadiness,
      };

      logger.success(`Step 5 complete — expansion readiness: ${track.step5Ratification.expansionReadiness}/10`);

      // Write track files
      const { trackPath, summaryPath } = await writeTrackFiles(track);
      logger.success(`Track ratified: ${trackPath}`);
      logger.info(`Summary: ${summaryPath}`);

      // Check meta-evolution trigger
      const trackCount = await loadTrackCount();
      if (shouldTriggerMetaEvolution(trackCount)) {
        logger.warn(`Meta-evolution triggered at track #${trackCount}! Run a harvest on "Titan Harvest Framework" to self-evolve.`);
      }

      // Audit log entry
      await auditSelfEdit({
        timestamp: new Date().toISOString(),
        filePath: trackPath,
        action: 'write',
        reason: `Titan Harvest V2 track created for system: ${system}`,
        approved: true,
        afterHash: hash,
      });

      state.auditLog.push(
        `${new Date().toISOString()} | harvest: track ${track.trackId} ratified (${mode}, readiness=${track.step5Ratification.expansionReadiness})`,
      );
      await saveState(state);

      logger.success(`Titan Harvest V2 complete. Track ID: ${track.trackId}`);
      return;
    } catch (err) {
      logger.warn(`LLM harvest failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local template display...');
    }
  }

  // Mode 3: Local fallback — display template for manual use
  logger.info('No LLM available. Displaying Titan Harvest V2 template for manual use.');
  const savedPath = await savePrompt(`harvest-${system.replace(/\s+/g, '-')}`, template);
  displayPrompt(template, [
    'Fill in each step with your AI assistant, then re-run with a live LLM configured.',
    `Template saved to: ${savedPath}`,
    'Configure a provider with: danteforge config --set-key "grok:<key>"',
  ].join('\n'));

  state.auditLog.push(`${new Date().toISOString()} | harvest: local template displayed for "${system}"`);
  await saveState(state);
}
