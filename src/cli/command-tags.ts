// command-tags.ts — the curation convention for DanteForge's command surface.
//
// DanteForge has accreted 200+ command files. The default `--help` is already curated to a small
// VISIBLE_COMMANDS set (index.ts), but a command that someone DOES reach (full listing, docs, an old
// script) should say what it is: a supported core command, an experiment, or a deprecated alias.
//
// This is curation BY SUBTRACTION, non-destructively: nothing is deleted. `markExperimental` /
// `markDeprecated` annotate the description and force the command hidden, so the surface reads as
// "the coherent core + clearly-labelled everything-else" without breaking a single existing caller.

import type { Command } from 'commander';

const EXPERIMENTAL_TAG = '[experimental]';

function hide(cmd: Command): void {
  (cmd as unknown as { _hidden: boolean })._hidden = true;
}

/** Prefix a tag onto a command's description exactly once (idempotent). */
function prefixDescription(cmd: Command, tag: string): void {
  const current = cmd.description() ?? '';
  if (current.startsWith(tag)) return;
  cmd.description(`${tag} ${current}`.trim());
}

/** Mark a command as experimental: tag the help text and hide it from the default listing. */
export function markExperimental(cmd: Command, note?: string): void {
  prefixDescription(cmd, note ? `${EXPERIMENTAL_TAG} (${note})` : EXPERIMENTAL_TAG);
  hide(cmd);
}

/** Mark a command as deprecated in favour of `replacement`: tag the help text and hide it. */
export function markDeprecated(cmd: Command, replacement: string): void {
  prefixDescription(cmd, `[deprecated → use \`${replacement}\`]`);
  hide(cmd);
}

/**
 * Apply experimental/deprecated tags to top-level commands by name, centrally (the same pattern as
 * VISIBLE_COMMANDS). Unknown names are ignored so the maps can name commands that may not be
 * registered in every build. Returns the names actually tagged (for logging / tests).
 */
export function applyCommandTags(
  program: Command,
  experimental: Map<string, string | undefined>,
  deprecated: Map<string, string>,
): { experimental: string[]; deprecated: string[] } {
  const taggedExp: string[] = [];
  const taggedDep: string[] = [];
  for (const cmd of program.commands) {
    const name = cmd.name();
    if (experimental.has(name)) { markExperimental(cmd, experimental.get(name)); taggedExp.push(name); }
    else if (deprecated.has(name)) { markDeprecated(cmd, deprecated.get(name)!); taggedDep.push(name); }
  }
  return { experimental: taggedExp, deprecated: taggedDep };
}
