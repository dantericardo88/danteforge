#!/usr/bin/env node
// ============================================================================
// Post-build sync: DanteForgeEngine → DanteCode
//
// Rebuilds the DanteForge quality engine (obfuscated binary) and copies it
// into the DanteCode monorepo at packages/danteforge/dist/.
//
// Paths are resolved relative to this machine's project layout.
// Skip with: SKIP_DANTECODE_SYNC=1 npm run build
// ============================================================================

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// --- Configuration -----------------------------------------------------------

const ENGINE_ROOT = resolve(
  process.env.DANTEFORGE_ENGINE_ROOT
    ?? join(process.cwd(), "..", "DanteForgeEngine")
);
const DANTECODE_ROOT = resolve(
  process.env.DANTECODE_ROOT
    ?? join(process.cwd(), "..", "DanteCode")
);
const DANTECODE_PKG = join(DANTECODE_ROOT, "packages", "danteforge");
const PLUGIN_CACHE = resolve(
  process.env.DANTEFORGE_PLUGIN_CACHE
    ?? resolve(
      process.env.USERPROFILE ?? process.env.HOME ?? "",
      ".claude/plugins/cache/danteforge-dev/danteforge"
    )
);

const ENGINE_DIST = join(ENGINE_ROOT, "dist");
const DANTECODE_DIST = join(DANTECODE_PKG, "dist");

// Internal @dantecode/* packages that DanteForgeEngine depends on (externalized in tsup)
const INTERNAL_DEPS = {
  "@dantecode/config-types": join(DANTECODE_ROOT, "packages", "config-types"),
  "@dantecode/core": join(DANTECODE_ROOT, "packages", "core"),
};

// --- Guards ------------------------------------------------------------------

if (!existsSync(ENGINE_ROOT)) {
  console.log("[sync-dantecode] DanteForgeEngine not found at", ENGINE_ROOT, "— skipping");
  process.exit(0);
}

if (!existsSync(DANTECODE_PKG)) {
  console.log("[sync-dantecode] DanteCode not found at", DANTECODE_PKG, "— skipping");
  process.exit(0);
}

// --- Step 1: Install engine dependencies if missing --------------------------

console.log("[sync-dantecode] Step 1/5: Checking DanteForgeEngine dependencies...");

const engineNodeModules = join(ENGINE_ROOT, "node_modules");
const hasTsup = existsSync(join(engineNodeModules, "tsup"));
const hasObfuscator = existsSync(join(engineNodeModules, "javascript-obfuscator"));

if (!hasTsup || !hasObfuscator) {
  console.log("[sync-dantecode] Linking internal @dantecode/* packages...");
  for (const [name, localPath] of Object.entries(INTERNAL_DEPS)) {
    const target = join(engineNodeModules, ...name.split("/"));
    if (!existsSync(target) && existsSync(localPath)) {
      mkdirSync(join(engineNodeModules, "@dantecode"), { recursive: true });
      // Use npm link to create symlinks for internal packages
      try {
        const { symlinkSync } = await import("node:fs");
        symlinkSync(localPath, target, "junction");
        console.log(`[sync-dantecode] Linked ${name} → ${localPath}`);
      } catch {
        console.log(`[sync-dantecode] Link already exists for ${name}`);
      }
    }
  }
  console.log("[sync-dantecode] Installing DanteForgeEngine dependencies...");
  execSync("npm install --ignore-scripts", { cwd: ENGINE_ROOT, stdio: "inherit" });
}

// --- Step 2: Build engine JS + obfuscate (skip DTS — types are stable in DanteCode) ---

console.log("[sync-dantecode] Step 2/5: Building DanteForgeEngine (JS + obfuscate)...");

// Preserve existing .d.ts before clean build (tsup clean: true wipes dist/)
const existingDts = join(ENGINE_DIST, "index.d.ts");
let preservedDts = null;
if (existsSync(existingDts)) {
  preservedDts = readFileSync(existingDts, "utf-8");
}
// Also check DanteCode's .d.ts as fallback
const dantecodeExistingDts = join(DANTECODE_DIST, "index.d.ts");
if (!preservedDts && existsSync(dantecodeExistingDts)) {
  preservedDts = readFileSync(dantecodeExistingDts, "utf-8");
}

// Build JS only (--no-dts) then obfuscate
execSync("npx tsup src/index.ts --no-dts", { cwd: ENGINE_ROOT, stdio: "inherit" });
execSync("node scripts/obfuscate.mjs", { cwd: ENGINE_ROOT, stdio: "inherit" });

// Restore .d.ts
if (preservedDts) {
  writeFileSync(join(ENGINE_DIST, "index.d.ts"), preservedDts);
  console.log("[sync-dantecode] Restored preserved index.d.ts");
} else {
  console.warn("[sync-dantecode] WARNING: No .d.ts available — DanteCode types won't be updated");
}

// --- Step 3: Validate output -------------------------------------------------

console.log("[sync-dantecode] Step 3/5: Validating build output...");

const distJs = join(ENGINE_DIST, "index.js");
const distDts = join(ENGINE_DIST, "index.d.ts");

if (!existsSync(distJs) || !existsSync(distDts)) {
  console.error("[sync-dantecode] ERROR: Build output missing — expected dist/index.js and dist/index.d.ts");
  process.exit(1);
}

const jsContent = readFileSync(distJs, "utf-8");
const dtsContent = readFileSync(distDts, "utf-8");

// Verify obfuscation (should be compact — very few newlines)
const lineCount = jsContent.split("\n").length;
if (lineCount > 10) {
  console.warn(`[sync-dantecode] WARNING: dist/index.js has ${lineCount} lines — expected ≤10 (obfuscated)`);
}

// Verify required exports exist in .d.ts
const requiredExports = [
  "runAntiStubScanner",
  "runConstitutionCheck",
  "runLocalPDSEScorer",
  "recordSuccessPattern",
  "queryLessons",
  "formatLessonsForPrompt",
  "recordLesson",
  "recordPreference",
];

const missingExports = requiredExports.filter((name) => !dtsContent.includes(name));
if (missingExports.length > 0) {
  console.error("[sync-dantecode] ERROR: Missing required exports in .d.ts:", missingExports.join(", "));
  process.exit(1);
}

const jsSizeKB = (jsContent.length / 1024).toFixed(1);
const sha256 = createHash("sha256").update(jsContent).digest("hex").slice(0, 12);
console.log(`[sync-dantecode] Validated: ${jsSizeKB} KB, ${lineCount} lines, sha256=${sha256}…`);

// --- Step 4: Copy to DanteCode ----------------------------------------------

console.log("[sync-dantecode] Step 4/5: Copying to DanteCode...");

mkdirSync(DANTECODE_DIST, { recursive: true });
copyFileSync(distJs, join(DANTECODE_DIST, "index.js"));
copyFileSync(distDts, join(DANTECODE_DIST, "index.d.ts"));

console.log("[sync-dantecode] Copied dist/index.js + dist/index.d.ts → DanteCode/packages/danteforge/dist/");

// --- Step 5: Update plugin cache (if it exists) -----------------------------

console.log("[sync-dantecode] Step 5/5: Updating Claude Code plugin cache...");

// Find the current version from DanteForge's package.json
const forgePkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));
const version = forgePkg.version;
const cacheDir = join(PLUGIN_CACHE, version);

if (existsSync(cacheDir)) {
  const cacheDist = join(cacheDir, "dist");
  mkdirSync(cacheDist, { recursive: true });
  // Copy the main CLI dist (not the engine dist) to plugin cache
  const cliDist = resolve("dist");
  if (existsSync(join(cliDist, "index.js"))) {
    copyFileSync(join(cliDist, "index.js"), join(cacheDist, "index.js"));
    // Copy chunk files too
    const { readdirSync } = await import("node:fs");
    const chunks = readdirSync(cliDist).filter((f) => f.endsWith(".js") && f !== "index.js");
    for (const chunk of chunks) {
      copyFileSync(join(cliDist, chunk), join(cacheDist, chunk));
    }
    console.log(`[sync-dantecode] Updated plugin cache at ${cacheDir}`);
  }

  // Sync commands/ directory to plugin cache
  const srcCommands = resolve("commands");
  const cacheCommands = join(cacheDir, "commands");
  if (existsSync(srcCommands)) {
    const { readdirSync } = await import("node:fs");
    mkdirSync(cacheCommands, { recursive: true });
    const cmdFiles = readdirSync(srcCommands).filter((f) => f.endsWith(".md"));
    let synced = 0;
    for (const file of cmdFiles) {
      copyFileSync(join(srcCommands, file), join(cacheCommands, file));
      synced++;
    }
    console.log(`[sync-dantecode] Synced ${synced} command files to plugin cache`);
  }
} else {
  console.log(`[sync-dantecode] Plugin cache for v${version} not found — skipping cache update`);
}

// --- Done --------------------------------------------------------------------

console.log("[sync-dantecode] Sync complete.");
