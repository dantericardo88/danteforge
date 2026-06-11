// LAW L7 — Flag wiring: every option the orchestrator passes on a CLI string is accepted by the
// target command's commander registration (catches passed-but-unwired flags before a live run).
//
// Approach (the robust path, stated per the plan): the commander program is built via the REAL
// register functions (registerOutcomesCmds / registerCorePipelineCmds / registerCouncilCmds — the
// same modules src/cli/index.ts wires) and its Option metadata is introspected directly. Emitted
// commands come from TWO sources: (1) the real setupCommands/buildTo7Commands return values, and
// (2) a source-parse of every df(...)/runCli(...) literal arg array in ascend-frontier.ts (the
// defaultPushTo9 / defaultBuildAll / defaultPromoteOne paths, which are not exported).
//
// NEGATIVE CONTROLS: known-unwired flags are checked and the law is asserted to TRIP.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { registerOutcomesCmds } from '../../src/cli/register-outcomes-cmds.js';
import { registerCorePipelineCmds } from '../../src/cli/register-core-pipeline-cmds.js';
import { registerCouncilCmds } from '../../src/cli/register-council-cmds.js';
import { setupCommands, buildTo7Commands } from '../../src/cli/commands/ascend-frontier.js';

type LazyCommands = Parameters<typeof registerOutcomesCmds>[1];

function buildProgram(): Command {
  const program = new Command();
  program.name('danteforge');
  // Registration must never invoke the lazy command loader — actions are not fired here.
  const lazy = (() => { throw new Error('the lazy command loader must not run during registration'); }) as unknown as LazyCommands;
  registerOutcomesCmds(program, lazy);
  registerCorePipelineCmds(program, lazy);
  registerCouncilCmds(program, lazy);
  return program;
}

interface Resolution { cmd: Command; rest: string[] }

/** Walk literal argv tokens into the registered (sub)command tree. */
function resolveCommand(root: Command, argv: string[]): Resolution | null {
  let cmd = root.commands.find(c => c.name() === argv[0] || c.aliases().includes(argv[0] ?? ''));
  if (!cmd) return null;
  let i = 1;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok.startsWith('-')) break;
    const sub = cmd.commands.find(c => c.name() === tok || c.aliases().includes(tok));
    if (!sub) break;
    cmd = sub as Command;
    i++;
  }
  return { cmd, rest: argv.slice(i) };
}

/** LAW L7 checker: every --flag token must be a registered Option on the resolved command. */
function checkFlagWiring(root: Command, argv: string[]): string[] {
  const violations: string[] = [];
  const res = resolveCommand(root, argv);
  if (!res) return [`"${argv[0]}" resolves to NO registered command`];
  const accepted = new Map<string, boolean>(); // flag -> takesValue
  for (const o of res.cmd.options) {
    if (o.long) accepted.set(o.long, !!(o.required || o.optional));
    if (o.short) accepted.set(o.short, !!(o.required || o.optional));
  }
  const tokens = res.rest;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok.startsWith('--')) continue; // positional / option value
    const flag = tok.split('=')[0]!;
    if (!accepted.has(flag)) {
      violations.push(`"${argv.join(' ')}": flag ${flag} is NOT registered on command "${res.cmd.name()}"`);
      continue;
    }
    // Skip the value token of a value-taking flag, unless the value was a non-literal
    // expression dropped by the source-parse (then the next token starts with '--').
    if (accepted.get(flag) && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('--')) i++;
  }
  return violations;
}

/** Source-parse the literal df()/runCli() arg arrays out of ascend-frontier.ts. Non-literal
 *  elements (dimId, joined member lists, template goals) are dropped — flags are all literals. */
async function parseEmittedArgArrays(): Promise<string[][]> {
  const src = await fs.readFile(path.resolve('src/cli/commands/ascend-frontier.ts'), 'utf8');
  const arrays: string[][] = [];
  const arrayRe = /\b(?:df|runCli)\(\s*[A-Za-z_$][\w$]*\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRe.exec(src)) !== null) {
    const literals: string[] = [];
    const litRe = /'((?:[^'\\]|\\.)*)'/g;
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(m[1]!)) !== null) literals.push(lm[1]!);
    // Drop stray literals leaked from expressions like members.join(',').
    const cleaned = literals.filter(t => t !== ',' && t.trim().length > 0);
    if (cleaned.length > 0) arrays.push(cleaned);
  }
  return arrays;
}

describe('L7 — every orchestrator-emitted flag is wired into a commander registration', () => {
  test('setupCommands + buildTo7Commands emit only registered commands and flags', () => {
    const program = buildProgram();
    const emitted = [
      ...setupCommands(false, []),
      ...setupCommands(true, ['claude-code', 'codex']),
      ...buildTo7Commands(false, [], ['dim_a']),
    ];
    assert.ok(emitted.length >= 7, `a real command set was emitted (got ${emitted.length})`);
    for (const args of emitted) {
      assert.deepEqual(checkFlagWiring(program, args), [], `unwired flag in "${args.join(' ')}"`);
    }
  });

  test('the push-to-9 / parallel-promote df() arg lists (source-parsed) are fully wired', async () => {
    const program = buildProgram();
    const arrays = await parseEmittedArgArrays();
    // The push path alone issues frontier-spec init/freeze, council-crusade, session-record,
    // validate, frontier-review (+ the parallel council variants) — the parse must really see them.
    assert.ok(arrays.length >= 8, `source-parse found the emitted arrays (got ${arrays.length}: ${JSON.stringify(arrays)})`);
    const commandsSeen = new Set(arrays.map(a => a[0]));
    for (const expected of ['frontier-spec', 'council-crusade', 'session-record', 'validate', 'frontier-review', 'council']) {
      assert.ok(commandsSeen.has(expected), `the parse reached the ${expected} call sites (saw: ${[...commandsSeen].join(', ')})`);
    }
    for (const args of arrays) {
      assert.deepEqual(checkFlagWiring(program, args), [], `unwired flag in "${args.join(' ')}"`);
    }
  });

  test('the load-bearing flags REALLY exist on their targets (no vacuous resolution)', () => {
    const program = buildProgram();
    // --preserve-sessions on validate is the frontier session-collapse fix; --max-minutes on
    // harden-crusade is the dead-loop checkpoint; both must stay wired.
    assert.deepEqual(checkFlagWiring(program, ['validate', 'dim_x', '--preserve-sessions']), []);
    assert.deepEqual(checkFlagWiring(program, ['harden-crusade', '--max-minutes', '55']), []);
    assert.deepEqual(checkFlagWiring(program, ['frontier-spec', 'init', 'dim_x', '--write']), []);
    assert.deepEqual(checkFlagWiring(program, ['frontier-review', 'dim_x', '--builder', 'codex', '--min-judges', '2', '--json', '--write']), []);
    assert.deepEqual(checkFlagWiring(program, ['capability-test', 'conduct', '--execute', '--max-actions', '3']), []);
  });
});

describe('L7 — NEGATIVE controls: unwired flags and unknown commands TRIP the law', () => {
  test('a passed-but-unwired flag is caught', () => {
    const program = buildProgram();
    const violations = checkFlagWiring(program, ['harden-crusade', '--definitely-not-a-flag']);
    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /--definitely-not-a-flag is NOT registered/);
  });

  test('a misspelled flag on a subcommand is caught (the silent-noop class)', () => {
    const program = buildProgram();
    const violations = checkFlagWiring(program, ['validate', 'dim_x', '--preserve-session']); // singular — wrong
    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /--preserve-session is NOT registered/);
  });

  test('an unregistered command name is caught', () => {
    const program = buildProgram();
    const violations = checkFlagWiring(program, ['frontier-push', '--write']);
    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /resolves to NO registered command/);
  });

  test('value tokens are not mistaken for flags (no false positives on numbers)', () => {
    const program = buildProgram();
    assert.deepEqual(checkFlagWiring(program, ['harden-crusade', '--parallel', '1', '--loop', '--target', '7', '--time', '18', '--max-minutes', '55']), []);
  });
});
