// Transform src/cli/index.ts: make commands import lazy
// Replaces static import * as commands with lazy async loader
import fs from 'node:fs';

const src = fs.readFileSync('src/cli/index.ts', 'utf8');

// Step 1: Replace the static import with lazy loader helper
let out = src.replace(
  "import * as commands from './commands/index.js';",
  `// Lazy-load command implementations — deferred until action fires, not at startup
type Commands = Awaited<typeof import('./commands/index.js')>;
let _cmds: Commands | null = null;
const C = (): Promise<Commands> =>
  _cmds ? Promise.resolve(_cmds) : import('./commands/index.js').then(m => (_cmds = m as Commands));`
);

// Step 2: In already-async action handlers, replace await commands. → await (await C()).
out = out.replace(/await commands\./g, 'await (await C()).');

// Step 3: Handle `=> void commands.xyz(...)` → `=> (await C()).xyz(...)`
// (void is fine on a promise-returning call, makes it fire-and-forget)
out = out.replace(/=> void commands\./g, '=> void (C().then(c => c.');
// But this breaks the closing paren... let's do differently
// Revert and use a simpler approach: void commands.xyz({...}) → C().then(c => c.xyz({...}))
// Actually just replace `void commands.` with `void (await C()).` and handle async below
out = out.replace(/=> void commands\./g, '=> (async () => { void (await C()).');

// Step 4: Replace remaining `=> commands.` (non-void) in action handlers → `=> (await C()).`
// These are inside arrow functions that already return a Promise implicitly
out = out.replace(/=> commands\./g, '=> (C().then(c => c.');

// Hmm this approach gets messy with closing parens. Let's try a cleaner approach.
// REVERT to a per-pattern approach but handle ALL the patterns systematically.

// Reload original and try again cleanly:
out = src;

// ── STEP 1: Replace the static import ──────────────────────────────────────
out = out.replace(
  "import * as commands from './commands/index.js';",
  `// Lazy-load command implementations — deferred until action fires, not at startup
type Commands = Awaited<typeof import('./commands/index.js')>;
let _cmds: Commands | null = null;
const C = (): Promise<Commands> =>
  _cmds ? Promise.resolve(_cmds) : import('./commands/index.js').then(m => (_cmds = m as Commands));`
);

// ── STEP 2: Simple direct reference: .action(commands.xyz) ──────────────────
// These pass commands.xyz as a function reference — convert to async wrapper
out = out.replace(
  /\.action\(commands\.([a-zA-Z_][a-zA-Z0-9_]*)\)/g,
  '.action((...a: unknown[]) => C().then(c => c.$1(...a as never)))'
);

// ── STEP 3: In existing async handlers, replace await commands. ──────────────
out = out.replace(/await commands\./g, 'await (await C()).');

// ── STEP 4: All remaining `commands.` are inside synchronous arrow functions.
// Strategy: make the surrounding .action arrow function async by:
// (a) replacing `(.action((...args...) =>` with `(.action(async (...args...) =>`
//     for actions that have commands. in their body
// (b) replacing each `commands.` with `(await C()).`
//
// Since we can't easily match multi-line content with regex, we do a targeted
// line-by-line pass: for each line containing `commands.`, if it's not already
// inside an async context, we need to fix its enclosing .action() to be async.
//
// SIMPLER: just do string replacements for all known remaining patterns.

// Pattern: return commands.xyz( → return (await C()).xyz(
out = out.replace(/return commands\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g,
  'return (await C()).$1(');

// Pattern: if (...) return commands. → handled above

// Pattern: .action((args) => commands.xyz( on same line
// Regex: find .action( followed by arrow function pointing to commands.
// Since the body may have complex args, match: .action(<preamble> => commands.
out = out.replace(
  /\.action\((\([^()\n]*\)) => commands\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g,
  '.action(async $1 => (await C()).$2('
);

// Pattern: .action((<args>) => void commands.xyz(
out = out.replace(
  /\.action\((\([^()\n]*\)) => void commands\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g,
  '.action(async $1 => { void (await C()).$2('
);

// Pattern: .action(() => commands.xyz() - no args in action
out = out.replace(
  /\.action\(\(\) => commands\.([a-zA-Z_][a-zA-Z0-9_]*)\(\)/g,
  '.action(async () => (await C()).$1()'
);

// Make multi-branch action handlers async where we inserted (await C())
// Pattern: .action((args) => { \n  if ... return (await C()) — need outer async
// These are the plan/harvest/compete/measure/build/setup handlers
// Strategy: find .action((<args>) => { on a line, check next 10 lines for (await C())
// If found, insert async:
out = out.replace(
  /\.action\((\([^()\n]*\)) => \{(\s*\n[\s\S]{0,500}?\(await C\(\)\))/,
  '.action(async $1 => {$2'
);
// Run multiple times for multiple occurrences
for (let i = 0; i < 15; i++) {
  const replaced = out.replace(
    /\.action\((\([^()\n]*\)) => \{((?:\s*\n[\s\S]{0,800}?)*?\(await C\(\)\))/,
    '.action(async $1 => {$2'
  );
  if (replaced === out) break;
  out = replaced;
}

// ── Count remaining ─────────────────────────────────────────────────────────
const remaining = (out.match(/commands\./g) || []).length;
const cRefs = (out.match(/C\(\)/g) || []).length;
console.log('Remaining commands. references:', remaining);
console.log('C() references added:', cRefs);

if (remaining > 0) {
  const lines = out.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('commands.')) {
      console.log(`  Line ${i + 1}: ${line.trim()}`);
    }
  });
}

if (remaining === 0) {
  fs.writeFileSync('src/cli/index.ts', out);
  console.log('\n✓ Written to src/cli/index.ts');
} else {
  fs.writeFileSync('src/cli/index.ts.transformed', out);
  console.log('\nWritten to index.ts.transformed (manual fixes still needed)');
}
