import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cliDir = join(import.meta.dirname, "..", "src", "cli");

// Scan ALL CLI register files rather than a hardcoded path: the `score` command moved from
// register-late-commands.ts to register-convergence-cmds.ts during a refactor, which silently broke the
// old single-file assertion. The honest invariant is "score is registered as a measure alias SOMEWHERE in
// src/cli", not "in this exact file".
const allCliSrc = readdirSync(cliDir)
  .filter(f => f.endsWith(".ts"))
  .map(f => readFileSync(join(cliDir, f), "utf8"))
  .join("\n");

describe("CLI score compatibility alias", () => {
  it("registers danteforge score as a compatibility alias for measure", () => {
    assert.match(allCliSrc, /\.command\('score'\)/);
    assert.match(allCliSrc, /measureCmd/);
  });
});
