// Phase C — enrich the 18 absorbed OSS registry entries with:
// (a) specific dimensionOverlap (PRD §9.2 #2)
// (b) canonical competitorTier from the framework (PRD §9.2 #5)
// (c) prdMapping linking each tool to relevant Dante PRDs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const registryPath = resolve(cwd, '.danteforge/oss-registry.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

// Per-entry enrichment. Tier framework (PRD §9.2 #5):
//  - constitutional_invariant_addition (already used: rtk → Article XIV)
//  - structural_pattern_source (already used: claude-council, openspec)
//  - content_partner (already used: mattpocock_skills)
//  - tactical_pattern (most absorbed entries land here)
//  - declined (hyperspace)
//
// For absorbed entries, we add a refined sub-tier where useful.

const ENRICHMENT = {
  aider: {
    dimensionOverlap: ['developerExperience', 'autonomy', 'tokenEconomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'AI-pair-programming TUI; proven CLI orchestration patterns. No current Dante consuming PRD; tag as tactical pattern available for future harvest.',
    prdMapping: 'prd_pending_developer_experience'
  },
  continue: {
    dimensionOverlap: ['developerExperience', 'ecosystemMcp', 'autonomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'IDE-extension surface; provides patterns for VSCode/JetBrains agent integration. Adjacent to DanteCode product.',
    prdMapping: 'prd_pending_dantecode_extension_layer'
  },
  openhands: {
    dimensionOverlap: ['autonomy', 'convergenceSelfHealing', 'developerExperience'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Agent-OS surface (formerly OpenDevin community). Patterns for sustained autonomous loops.',
    prdMapping: 'prd_pending_agent_os_layer'
  },
  swe_agent: {
    dimensionOverlap: ['autonomy', 'specDrivenPipeline', 'planningQuality'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Princeton research project on SWE-bench; benchmarking patterns. Informs evaluation methodology.',
    prdMapping: 'prd_pending_evaluation_benchmarks'
  },
  metagpt: {
    dimensionOverlap: ['planningQuality', 'specDrivenPipeline', 'autonomy'],
    competitorTier: 'secondary_pattern_source_multi_agent_framework',
    competitorTierRationale: 'Multi-agent framework with explicit role hierarchy (PM/architect/engineer). Patterns relevant to /dante-grill-me role taxonomy.',
    prdMapping: 'prd_pending_role_taxonomy_extension'
  },
  autogen: {
    dimensionOverlap: ['ecosystemMcp', 'autonomy', 'planningQuality'],
    competitorTier: 'secondary_pattern_source_multi_agent_framework',
    competitorTierRationale: 'Microsoft multi-agent conversation framework. Patterns for inter-agent message protocols.',
    prdMapping: 'prd_pending_inter_agent_protocols'
  },
  crewai: {
    dimensionOverlap: ['planningQuality', 'autonomy', 'developerExperience'],
    competitorTier: 'secondary_pattern_source_multi_agent_framework',
    competitorTierRationale: 'Role-based crew abstraction; pattern overlap with /dante-grill-me role taxonomy.',
    prdMapping: 'prd_pending_role_taxonomy_extension'
  },
  langchain: {
    dimensionOverlap: ['ecosystemMcp', 'tokenEconomy', 'developerExperience'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Agent-framework + tooling abstractions. Patterns for retrieval + chaining; less relevant to Dante spec-driven pipeline.',
    prdMapping: 'prd_pending_tooling_layer'
  },
  cline: {
    dimensionOverlap: ['developerExperience', 'autonomy', 'uxPolish'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Autonomous coding agent for VSCode. Adjacent to DanteCode in IDE-surface space.',
    prdMapping: 'prd_pending_dantecode_extension_layer'
  },
  goose: {
    dimensionOverlap: ['autonomy', 'developerExperience', 'ecosystemMcp'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'On-machine AI agent (Block). Patterns for local-first agent execution.',
    prdMapping: 'prd_pending_local_first_layer'
  },
  gpt_engineer: {
    dimensionOverlap: ['specDrivenPipeline', 'planningQuality', 'autonomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Spec-to-code generation. Pattern overlap with /dante-to-prd → /dante-tdd chain.',
    prdMapping: 'prd_pending_spec_to_code_chain'
  },
  tabby: {
    dimensionOverlap: ['developerExperience', 'tokenEconomy', 'security'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Self-hosted code completion. Patterns for local-LLM-backed inline completion.',
    prdMapping: 'prd_pending_local_llm_layer'
  },
  codegeex: {
    dimensionOverlap: ['developerExperience', 'tokenEconomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Multilingual code-generation model. Lower DanteForge relevance.',
    prdMapping: 'prd_pending_multilingual_codegen'
  },
  fauxpilot: {
    dimensionOverlap: ['developerExperience', 'security'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Self-hosted Copilot alternative. Lower DanteForge relevance.',
    prdMapping: 'prd_pending_local_llm_layer'
  },
  ollama: {
    dimensionOverlap: ['tokenEconomy', 'ecosystemMcp', 'autonomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Local LLM runtime; already used by Dante (Pilot 3, magic-orchestrate-real-llm). Foundational dependency, not competitive.',
    prdMapping: 'prd_26_context_economy_layer'
  },
  opendevin: {
    dimensionOverlap: ['autonomy', 'convergenceSelfHealing', 'developerExperience'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'Open Devin — autonomous engineer; superseded by openhands community. Same pattern space.',
    prdMapping: 'prd_pending_agent_os_layer'
  },
  agentcoder: {
    dimensionOverlap: ['planningQuality', 'autonomy'],
    competitorTier: 'tactical_pattern_no_license',
    competitorTierRationale: 'Research multi-agent code generation. License unverified (no SPDX). Pattern observation only; no integration possible until license is clarified.',
    prdMapping: 'prd_pending_research_only'
  },
  plandex: {
    dimensionOverlap: ['planningQuality', 'specDrivenPipeline', 'autonomy'],
    competitorTier: 'tactical_pattern',
    competitorTierRationale: 'CLI orchestrator for long AI coding tasks. Pattern overlap with /dante-tdd cycle execution.',
    prdMapping: 'prd_pending_long_horizon_orchestration'
  }
};

let updated = 0;
for (const [id, enrichment] of Object.entries(ENRICHMENT)) {
  const entry = registry.entries[id];
  if (!entry) {
    console.log(`  WARN: ${id} not in registry`);
    continue;
  }
  entry.dimensionOverlap = enrichment.dimensionOverlap;
  entry.competitorTier = enrichment.competitorTier;
  entry.competitorTierRationale = enrichment.competitorTierRationale;
  entry.prdMapping = enrichment.prdMapping;
  updated++;
}

registry.version = '1.5';
registry.lastEnrichmentAt = new Date().toISOString();
registry.enrichmentNote = 'Pass 6 (PRD §9.2 #2 + #5) — populated dimensionOverlap, canonical competitorTier, prdMapping for the 18 absorbed compete-matrix-only entries.';

writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');

console.log(`Enriched ${updated}/${Object.keys(ENRICHMENT).length} absorbed entries.`);
console.log(`Each now has: dimensionOverlap (≥2 dims), competitorTier (canonical), competitorTierRationale, prdMapping`);
console.log(`Registry v1.5: ${registryPath}`);
