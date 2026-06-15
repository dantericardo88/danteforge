import type { Command } from 'commander';
import { registerWikiCmds } from './register-wiki-cmds.js';
import { registerCompeteCmds } from './register-compete-cmds.js';
import { registerConvergenceCmds } from './register-convergence-cmds.js';
import { registerCouncilCmds } from './register-council-cmds.js';
import { registerSearchCmds } from './register-search-cmds.js';
import { registerOutcomesCmds } from './register-outcomes-cmds.js';
import { registerTruthCmds } from './register-truth-cmds.js';
import { registerOpsCmds } from './register-ops-cmds.js';
import { registerWaveCmds, registerGroundingCmd } from './register-wave-cmds.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerLateCommands(program: Command, C: () => Promise<Commands>): void {
  registerWikiCmds(program, C);
  registerCompeteCmds(program, C);
  registerConvergenceCmds(program, C);
  registerCouncilCmds(program, C);
  registerSearchCmds(program, C);
  registerOutcomesCmds(program, C);
  registerTruthCmds(program);
  registerOpsCmds(program, C);
  registerWaveCmds(program);
  registerGroundingCmd(program);
}
