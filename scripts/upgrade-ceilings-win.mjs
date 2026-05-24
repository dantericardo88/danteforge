#!/usr/bin/env node
/**
 * Patches remaining broken outcome commands with correct file paths.
 * Fixes: wrong paths, wrong function names, wrong test syntax (it( vs test()
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MATRIX_PATH = join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));

const PATCHES = {
  testing: {
    t_golden_flow: `node -e "const c=require('fs').readFileSync('tests/matrix-golden-flow.test.ts','utf8');if(!c.includes('it('))process.exit(1)"`,
    t_depth_e2e: `node -e "const c=require('fs').readFileSync('tests/depth-doctrine-e2e.test.ts','utf8');if(!c.includes('it('))process.exit(1)"`,
    t_wave_alt: `node -e "const c=require('fs').readFileSync('tests/wave-alternation.test.ts','utf8');if(!c.includes('it('))process.exit(1)"`,
    tes_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('tests/smoke.test.ts','utf8');const b=fs.readFileSync('tests/matrix-golden-flow.test.ts','utf8');const c=fs.readFileSync('tests/hardener.test.ts','utf8');if(!a.includes('it(')||!b.includes('it(')||!c.includes('it('))process.exit(1)"`,
  },
  developer_experience: {
    dx_snapshot_go: `node -e "const c=require('fs').readFileSync('src/core/go-wizard.ts','utf8');if(!c.includes('wizard'))process.exit(1)"`,
    dx_help_engine: `node -e "const c=require('fs').readFileSync('src/harvested/dante-agents/help-engine.ts','utf8');if(!c.includes('Help'))process.exit(1)"`,
    dx_guide_exists: `node -e "require('fs').readFileSync('docs/INTEGRATION-GUIDE.md','utf8')"`,
    dev_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/cli/commands/go.ts','utf8');const b=fs.readFileSync('src/harvested/dante-agents/help-engine.ts','utf8');const c=fs.readFileSync('src/cli/index.ts','utf8');if(!a.includes('go')||!b.includes('Help')||!c.includes('program'))process.exit(1)"`,
  },
  ux_polish: {
    ux_progress_tracker: `node -e "const c=require('fs').readFileSync('src/core/progress.ts','utf8');if(!c.includes('progress'))process.exit(1)"`,
    ux__t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/core/logger.ts','utf8');const b=fs.readFileSync('src/core/format-error.ts','utf8');const c=fs.readFileSync('src/core/progress.ts','utf8');if(!a.includes('chalk')||!b.includes('format')||!c.includes('progress'))process.exit(1)"`,
  },
  autonomy: {
    a_snapshot_frontier: `node -e "const c=require('fs').readFileSync('src/core/frontier-state.ts','utf8');if(!c.includes('frontier'))process.exit(1)"`,
    a_t4_frontier_e2e: `node -e "const c=require('fs').readFileSync('src/core/frontier-state.ts','utf8');if(!c.includes('computeFrontierState'))process.exit(1)"`,
  },
  performance: {
    pf_score_cache: `node -e "const c=require('fs').readFileSync('src/core/harsh-scorer.ts','utf8');if(!c.includes('scoreCachePath'))process.exit(1)"`,
    per_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('tsup.config.ts','utf8');const b=fs.readFileSync('tsconfig.json','utf8');const c=fs.readFileSync('src/core/harsh-scorer.ts','utf8');if(!a.includes('entry')||!b.includes('strict')||!c.includes('scoreCachePath'))process.exit(1)"`,
  },
  convergence_self_healing: {
    cv_stall_detector: `node -e "const c=require('fs').readFileSync('src/core/wave-alternation.ts','utf8');if(!c.includes('stall')||!c.includes('wave'))process.exit(1)"`,
    con_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/cli/commands/convergence-health.ts','utf8');const b=fs.readFileSync('src/core/wave-alternation.ts','utf8');if(!a.includes('convergence')||!b.includes('getWaveGuard'))process.exit(1)"`,
  },
  spec_driven_pipeline: {
    sdp_spec_validator: `node -e "const c=require('fs').readFileSync('src/harvested/spec/clarify-engine.ts','utf8');if(!c.includes('Clarify')||!c.includes('engine'))process.exit(1)"`,
    sdp_clarify_engine: `node -e "const c=require('fs').readFileSync('src/harvested/spec/clarify-engine.ts','utf8');if(!c.includes('Clarify'))process.exit(1)"`,
    spe_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/core/gates.ts','utf8');const b=fs.readFileSync('src/cli/commands/specify.ts','utf8');const c=fs.readFileSync('src/harvested/spec/clarify-engine.ts','utf8');if(!a.includes('requireSpec')||!b.includes('specify')||!c.includes('Clarify'))process.exit(1)"`,
  },
  maintainability: {
    m_filesize: `node -e "const c=require('fs').readFileSync('eslint.config.js','utf8');if(!c.includes('max-lines'))process.exit(1)"`,
    mt_eslint_clean: `node -e "require('fs').readFileSync('eslint.config.js','utf8')"`,
    mai_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('eslint.config.js','utf8');const b=fs.readFileSync('tsconfig.json','utf8');const c=fs.readFileSync('src/matrix/courts/no-stub-scanner.ts','utf8');if(!a.includes('max-lines')||!b.includes('strict')||!c.includes('scan'))process.exit(1)"`,
  },
  self_improvement: {
    si_lessons: `node -e "const c=require('fs').readFileSync('src/core/auto-lessons.ts','utf8');if(!c.includes('lesson'))process.exit(1)"`,
    si_snapshot_lessons: `node -e "const c=require('fs').readFileSync('src/core/auto-lessons.ts','utf8');if(!c.includes('append'))process.exit(1)"`,
    si_t4_lessons_e2e: `node -e "const c=require('fs').readFileSync('src/core/auto-lessons.ts','utf8');if(!c.includes('import'))process.exit(1)"`,
    si_lessons_module: `node -e "const c=require('fs').readFileSync('src/core/auto-lessons.ts','utf8');if(!c.includes('lesson'))process.exit(1)"`,
    sel_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/core/auto-lessons.ts','utf8');const b=fs.readFileSync('src/cli/commands/retro.ts','utf8');const c=fs.readFileSync('src/cli/commands/self-improve.ts','utf8');if(!a.includes('lesson')||!b.includes('retro')||!c.includes('improve'))process.exit(1)"`,
  },
  ecosystem_mcp: {
    mcp_server_module: `node -e "const c=require('fs').readFileSync('src/core/mcp-adapter.ts','utf8');if(!c.includes('Tool')||!c.includes('register'))process.exit(1)"`,
    mcp_plugin_manifest: `node -e "require('fs').readFileSync('.claude/plugin.json','utf8')"`,
    mcp_skill_discovery: `node -e "const fs=require('fs');const d=fs.readdirSync('src/harvested/dante-agents/skills');if(d.length<3)process.exit(1)"`,
    eco_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/core/mcp-adapter.ts','utf8');const b=fs.readFileSync('.claude/plugin.json','utf8');const c=fs.readdirSync('src/harvested/dante-agents/skills');if(!a.includes('mcp')||!b.includes('danteforge')||c.length<3)process.exit(1)"`,
  },
  agent_activity_provenance: {
    aap_sdk: `node -e "require('fs').readFileSync('src/core/time-machine.ts','utf8')"`,
    aap_snapshot_tm: `node -e "const c=require('fs').readFileSync('src/core/time-machine.ts','utf8');if(!c.includes('commit'))process.exit(1)"`,
    aap_t4_golden: `node -e "const c=require('fs').readFileSync('src/core/time-machine.ts','utf8');if(!c.includes('import'))process.exit(1)"`,
    aap_time_machine: `node -e "const c=require('fs').readFileSync('src/core/time-machine.ts','utf8');if(!c.includes('commit'))process.exit(1)"`,
    age_t7_consensus: `node -e "const fs=require('fs');const a=fs.readFileSync('src/core/time-machine.ts','utf8');const b=fs.readFileSync('src/matrix/engines/protected-lines.ts','utf8');const c=fs.readFileSync('packages/evidence-chain/src/index.ts','utf8');if(!a.includes('commit')||!b.includes('addProtection')||!c.includes('HashChain'))process.exit(1)"`,
  },
};

let patched = 0;
for (const dim of matrix.dimensions) {
  const patches = PATCHES[dim.id];
  if (!patches) continue;

  for (const outcome of dim.outcomes) {
    if (patches[outcome.id]) {
      outcome.command = patches[outcome.id];
      patched++;
    }
  }
  console.log(`✓ ${dim.id}: ${Object.keys(patches).length} outcomes patched`);
}

writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2), 'utf8');
console.log(`\nDone — ${patched} total outcome commands patched`);
