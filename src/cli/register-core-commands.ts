import type { Command } from 'commander';
import { registerCoreCraftCmds } from './register-core-craft-cmds.js';
import { registerCoreSkillsCmds } from './register-core-skills-cmds.js';
import { registerCoreIntelCmds } from './register-core-intel-cmds.js';
import { registerCorePipelineCmds } from './register-core-pipeline-cmds.js';
type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCoreCommands(program: Command, C: () => Promise<Commands>): void {
  registerCoreCraftCmds(program, C);
  registerCoreSkillsCmds(program, C);
  registerCoreIntelCmds(program, C);
  registerCorePipelineCmds(program, C);
}
