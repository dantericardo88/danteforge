// shared-options.ts — Reusable Commander.js option factories
// Import these in command files instead of duplicating inline option strings.
// Each factory returns the Commander option args tuple used with .option().

import type { Command } from 'commander';

// ── Option factories ──────────────────────────────────────────────────────────

/** --cwd <path>  Working directory option (defaults to process.cwd()) */
export function addCwdOption(cmd: Command): Command {
  return cmd.option('--cwd <path>', 'Working directory', process.cwd());
}

/** --json  Machine-readable output option */
export function addJsonOption(cmd: Command): Command {
  return cmd.option('--json', 'Output as JSON');
}

/** --yes / -y  Skip confirmation prompts option */
export function addYesOption(cmd: Command): Command {
  return cmd.option('-y, --yes', 'Skip confirmation prompts');
}

/** --quiet  Suppress non-error output option */
export function addQuietOption(cmd: Command): Command {
  return cmd.option('--quiet', 'Suppress non-error output');
}

// ── Option descriptor objects (for programmatic use / testing) ────────────────

export interface OptionDescriptor {
  flags: string;
  description: string;
  defaultValue?: string;
}

export function cwdOption(): OptionDescriptor {
  return { flags: '--cwd <path>', description: 'Working directory', defaultValue: process.cwd() };
}

export function jsonOption(): OptionDescriptor {
  return { flags: '--json', description: 'Output as JSON' };
}

export function yesOption(): OptionDescriptor {
  return { flags: '-y, --yes', description: 'Skip confirmation prompts' };
}

export function quietOption(): OptionDescriptor {
  return { flags: '--quiet', description: 'Suppress non-error output' };
}
