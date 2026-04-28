/**
 * CLI command surface for the 5 Dante-native skills.
 * Each subcommand wires the skill's executor through the truth-loop-aware
 * skill runner, so every invocation produces an evidence chain + verdict.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { logger } from '../../core/logger.js';
import { runSkill } from '../../spine/skill_runner/runner.js';
import { parseFrontmatter } from '../../spine/skill_runner/frontmatter.js';
import { SKILL_EXECUTORS } from '../../spine/skill_runner/executors/index.js';

const SKILL_PATHS: Record<string, string> = {
  'dante-to-prd': 'src/harvested/dante-agents/skills/dante-to-prd/SKILL.md',
  'dante-grill-me': 'src/harvested/dante-agents/skills/dante-grill-me/SKILL.md',
  'dante-tdd': 'src/harvested/dante-agents/skills/dante-tdd/SKILL.md',
  'dante-triage-issue': 'src/harvested/dante-agents/skills/dante-triage-issue/SKILL.md',
  'dante-design-an-interface': 'src/harvested/dante-agents/skills/dante-design-an-interface/SKILL.md'
};

export interface DanteSkillFlags {
  inputFile?: string;
  inputJson?: string;
  outDir?: string;
  scoreOverride?: string;
}

export async function runDanteSkill(skillName: string, flags: DanteSkillFlags): Promise<{ exitCode: number; outputDir: string | null }> {
  const executor = SKILL_EXECUTORS[skillName];
  if (!executor) {
    logger.error(`Unknown Dante skill: ${skillName}`);
    return { exitCode: 2, outputDir: null };
  }
  const skillRel = SKILL_PATHS[skillName];
  if (!skillRel || !existsSync(skillRel)) {
    logger.error(`SKILL.md not found for ${skillName} at ${skillRel}`);
    return { exitCode: 2, outputDir: null };
  }

  const frontmatter = parseFrontmatter(skillRel);

  const inputs = readInputs(flags);
  if ('error' in inputs) {
    logger.error(`Skill input parse failed: ${inputs.error}`);
    return { exitCode: 2, outputDir: null };
  }

  const repo = resolve(process.cwd());

  const result = await runSkill(executor, {
    skillName,
    repo,
    inputs: inputs.value,
    frontmatter,
    scorer: flags.scoreOverride ? parseScoreOverride(flags.scoreOverride) : undefined
  });

  logger.info(`Skill ${skillName} → ${result.verdict.finalStatus} (gate: ${result.gate.overall})`);
  logger.info(`  output: ${result.outputDir}`);
  if (result.gate.blockingReasons.length > 0) {
    logger.info(`  blocking: ${result.gate.blockingReasons.slice(0, 3).join('; ')}`);
  }

  return {
    exitCode: result.gate.overall === 'green' ? 0 : 1,
    outputDir: result.outputDir
  };
}

function readInputs(flags: DanteSkillFlags): { value: Record<string, unknown> } | { error: string } {
  if (flags.inputJson) {
    try {
      return { value: JSON.parse(flags.inputJson) as Record<string, unknown> };
    } catch (err) {
      return { error: `--inputs-json could not be parsed: ${(err as Error).message}` };
    }
  }
  if (flags.inputFile) {
    if (!existsSync(flags.inputFile)) return { error: `input file not found: ${flags.inputFile}` };
    try {
      const raw = readFileSync(flags.inputFile, 'utf-8');
      return { value: JSON.parse(raw) as Record<string, unknown> };
    } catch (err) {
      return { error: `input file parse failed: ${(err as Error).message}` };
    }
  }
  return { value: {} };
}

function parseScoreOverride(raw: string): (dims: string[]) => Record<string, number> {
  // Format: dim1=9.5,dim2=7.0
  const parsed: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    const score = Number.parseFloat(v ?? '0');
    if (k && Number.isFinite(score)) parsed[k.trim()] = score;
  }
  return (dims: string[]) => {
    const out: Record<string, number> = {};
    for (const d of dims) out[d] = parsed[d] ?? 9.0;
    return out;
  };
}
