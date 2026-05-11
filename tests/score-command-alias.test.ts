import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

describe("CLI score compatibility alias", () => {
  it("registers danteforge score as a compatibility alias for measure", () => {
    const src = readFileSync(join(repoRoot, "src", "cli", "register-late-commands.ts"), "utf8");

    assert.match(src, /\.command\('score'\)/);
    assert.match(src, /measureCmd/);
  });
});
