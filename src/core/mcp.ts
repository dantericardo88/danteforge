// MCP (Model Context Protocol) adapter — tool-agnostic host detection + Figma prompt layer
// DanteForge does NOT implement a full MCP client. It detects the host editor,
// checks for Figma MCP server config, and generates prompts the host tool can execute.
// No external dependencies — uses only Node builtins (fs, path, os).

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export type MCPHost = 'claude-code' | 'cursor' | 'codex' | 'vscode' | 'windsurf' | 'jetbrains' | 'unknown';

export interface MCPCapabilities {
  host: MCPHost;
  hasMCP: boolean;
  hasFigmaMCP: boolean;
  figmaServerName?: string;
}

/**
 * Detect which AI coding editor is running DanteForge.
 * Checks environment variables set by each host tool.
 * Falls back to 'unknown' when no host is detected.
 *
 * @param override - Explicit host via --host flag ('auto' triggers detection)
 */
export function detectHost(override?: string): MCPHost {
  if (override && override !== 'auto') {
    const valid: MCPHost[] = ['claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'jetbrains'];
    if (valid.includes(override as MCPHost)) return override as MCPHost;
    logger.warn(`Unknown host "${override}" — falling back to auto-detection`);
  }

  const env = process.env;

  // Claude Code
  if (env.CLAUDE_CODE || env.CLAUDE_SESSION_ID || env.CLAUDE_PROJECT_DIR) return 'claude-code';

  // Cursor
  if (env.CURSOR_SESSION || env.CURSOR_TRACE_ID || env.TERM_PROGRAM === 'cursor') return 'cursor';

  // Codex (OpenAI)
  if (env.CODEX_SESSION || env.CODEX || env.CODEX_ENV) return 'codex';

  // Windsurf (check before VS Code since Windsurf is VS Code-based)
  if (env.WINDSURF_SESSION || env.TERM_PROGRAM === 'windsurf') return 'windsurf';

  // JetBrains (check before VS Code — IntelliJ/WebStorm/PyCharm/etc.)
  if (env.IDEA_INITIAL_DIRECTORY || env.INTELLIJ_ENVIRONMENT_READER) return 'jetbrains';

  // VS Code (most generic — check last)
  if (env.VSCODE_PID || env.VSCODE_CWD || env.TERM_PROGRAM === 'vscode') return 'vscode';

  return 'unknown';
}

/**
 * Detect MCP capabilities by checking host-specific config files
 * for Figma MCP server entries.
 */
export async function detectMCPCapabilities(host: MCPHost): Promise<MCPCapabilities> {
  const capabilities: MCPCapabilities = { host, hasMCP: false, hasFigmaMCP: false };

  const homeDir = os.homedir();
  const cwd = process.cwd();

  // Host-specific MCP config file locations
  const configPaths: string[] = [];
  switch (host) {
    case 'claude-code':
      configPaths.push(
        path.join(cwd, '.claude', 'mcp.json'),
        path.join(homeDir, '.claude', 'mcp.json'),
      );
      break;
    case 'cursor':
      configPaths.push(
        path.join(cwd, '.cursor', 'mcp.json'),
        path.join(homeDir, '.cursor', 'mcp.json'),
      );
      break;
    case 'vscode':
    case 'windsurf':
      configPaths.push(
        path.join(cwd, '.vscode', 'settings.json'),
        path.join(cwd, '.vscode', 'mcp.json'),
      );
      break;
    case 'codex':
      configPaths.push(
        path.join(cwd, '.codex', 'mcp.json'),
      );
      break;
    case 'jetbrains':
      configPaths.push(
        path.join(cwd, '.idea', 'mcp.json'),
      );
      break;
    default:
      // Check common locations for unknown hosts
      configPaths.push(
        path.join(cwd, '.claude', 'mcp.json'),
        path.join(cwd, '.cursor', 'mcp.json'),
        path.join(cwd, '.vscode', 'mcp.json'),
      );
  }

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      capabilities.hasMCP = true;

      // Check for Figma MCP server entry
      const lower = content.toLowerCase();
      if (lower.includes('figma')) {
        capabilities.hasFigmaMCP = true;
        capabilities.figmaServerName = extractFigmaServerName(content);
        break;
      }
    } catch {
      // Config file not found — continue checking
    }
  }

  return capabilities;
}

/**
 * Extract the Figma MCP server name from a config file's JSON content.
 */
function extractFigmaServerName(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    // MCP configs typically have a "mcpServers" key with server names
    const servers = parsed.mcpServers ?? parsed['mcp.servers'] ?? parsed;
    if (typeof servers === 'object' && servers !== null) {
      for (const key of Object.keys(servers)) {
        if (key.toLowerCase().includes('figma')) {
          return key;
        }
      }
    }
  } catch {
    // JSON parse failed — fall back to regex
    const match = content.match(/"([^"]*figma[^"]*)"\s*:/i);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Build a prompt that instructs the host tool to push current UI state to Figma
 * via MCP (Code-to-Canvas).
 */
export function buildPushToFigmaPrompt(
  componentPaths: string[],
  designContext: string,
  capabilities: MCPCapabilities,
): string {
  const fileList = componentPaths.map(p => `- ${p}`).join('\n');

  if (capabilities.hasFigmaMCP) {
    return `You have access to the Figma MCP tools${capabilities.figmaServerName ? ` (server: "${capabilities.figmaServerName}")` : ''}. Perform a Code-to-Canvas push:

## Task: Push Current UI to Figma

1. Read and analyze these UI component files:
${fileList}

2. Using the Figma MCP tools, create or update editable frames in Figma that represent the current state of these components.

3. For each component:
   - Extract current styles (colors, spacing, typography, borders, shadows)
   - Create a corresponding Figma frame with accurate visual representation
   - Apply auto-layout where the code uses flexbox/grid
   - Label layers with component and prop names

4. Report what was pushed and note any design inconsistencies found.

## Design Context
${designContext}

Output a summary of:
- Components pushed (with Figma frame links if available)
- Design tokens extracted (colors, spacing, fonts)
- Inconsistencies found between components`;
  }

  return buildManualPushInstructions(componentPaths, designContext);
}

/**
 * Build a prompt that instructs the host tool to pull refined designs from Figma
 * back into code via MCP (Canvas-to-Code).
 */
export function buildPullFromFigmaPrompt(
  figmaUrl: string,
  tokenFile: string,
  capabilities: MCPCapabilities,
): string {
  if (capabilities.hasFigmaMCP) {
    return `You have access to the Figma MCP tools${capabilities.figmaServerName ? ` (server: "${capabilities.figmaServerName}")` : ''}. Perform a Canvas-to-Code pull:

## Task: Pull Refined Designs from Figma

1. Read the Figma file: ${figmaUrl}

2. Extract all design tokens:
   - Colors (primary, secondary, accent, semantic)
   - Typography (font families, sizes, weights, line heights)
   - Spacing scale (padding, margin, gap values)
   - Border radius, shadows, opacity values
   - Breakpoints and responsive rules

3. Compare extracted tokens with the existing design tokens file: ${tokenFile}

4. Generate updated design tokens that merge the Figma refinements with existing code values.

5. List all changes with before/after comparisons.

Output:
- Updated design tokens (ready to write to ${tokenFile})
- Change summary (what was added, modified, removed)
- Components that need updating to use the new tokens`;
  }

  return buildManualPullInstructions(figmaUrl, tokenFile);
}

/**
 * Build manual instructions when MCP is not available.
 * User performs the Figma sync manually.
 */
function buildManualPushInstructions(componentPaths: string[], designContext: string): string {
  const fileList = componentPaths.map(p => `- ${p}`).join('\n');
  return `## Manual Figma Push (MCP Not Detected)

No Figma MCP server was detected in your editor. You can set one up with:
  Claude Code: claude mcp add figma-mcp -- npx figma-developer-mcp --token=YOUR_TOKEN
  Cursor:      Add to .cursor/mcp.json
  VS Code:     Add to .vscode/mcp.json

### Manual Steps

1. Start your dev server (e.g., npm run dev) and open your app in the browser.

2. Review these UI component files:
${fileList}

3. In Figma:
   - Create a new page or frame for "Code Sync"
   - Screenshot or manually recreate the current component states
   - Apply auto-layout to match your CSS flexbox/grid patterns

4. Design Context:
${designContext}

5. After making visual refinements in Figma, run:
   danteforge ux-refine --prompt --figma-url <your-figma-file-url>

This will generate prompts to pull the refined designs back into code.`;
}

function buildManualPullInstructions(figmaUrl: string, tokenFile: string): string {
  return `## Manual Figma Pull (MCP Not Detected)

No Figma MCP server was detected in your editor. You can set one up with:
  Claude Code: claude mcp add figma-mcp -- npx figma-developer-mcp --token=YOUR_TOKEN
  Cursor:      Add to .cursor/mcp.json
  VS Code:     Add to .vscode/mcp.json

### Manual Steps

1. Open your Figma file: ${figmaUrl}

2. In Figma Dev Mode, select the refined frames and inspect:
   - Colors → copy hex/rgba values
   - Typography → copy font-family, size, weight, line-height
   - Spacing → copy padding, margin, gap values
   - Border → copy radius, stroke values

3. Update your design tokens file: ${tokenFile}
   Apply the extracted values to the corresponding token names.

4. Run: danteforge verify
   This checks artifact consistency after your manual updates.`;
}

/**
 * Build a combined UX refinement prompt for --prompt mode.
 * Covers the full push/pull cycle as a single prompt.
 */
export function buildUXRefinePrompt(
  componentPaths: string[],
  designContext: string,
  figmaUrl: string | undefined,
  tokenFile: string,
  constitution?: string,
): string {
  const fileList = componentPaths.map(p => `- ${p}`).join('\n');

  return `You are a UX design engineer performing a Figma design-code sync loop.

${constitution ? `## Project Principles\n${constitution}\n` : ''}
## Phase 1: Capture Current State (Code-to-Canvas)

Analyze these UI component files and extract current design values:
${fileList}

For each component, document:
- Layout approach (flex, grid, absolute)
- Color values (backgrounds, text, borders)
- Typography (font, size, weight, line-height)
- Spacing (padding, margin, gap)
- Interactive states (hover, focus, active, disabled)

## Phase 2: Design Review

Compare extracted values against design best practices:
- Color contrast (WCAG 2.1 AA minimum)
- Typography hierarchy (clear visual weight progression)
- Spacing consistency (use of a spacing scale)
- Responsive behavior at key breakpoints

${figmaUrl ? `Figma reference: ${figmaUrl}\nUse the Figma MCP tools to read this file and extract the refined design tokens.\n` : 'No Figma file specified. Provide recommendations based on code analysis.\n'}

## Phase 3: Generate Design Tokens

Output a design tokens file for: ${tokenFile}

Include:
- colors: { primary, secondary, accent, background, surface, text, error, success, warning }
- typography: { headings, body, caption, code } with font-family, size, weight, line-height
- spacing: numbered scale (1-10) mapping to px/rem values
- radii: { sm, md, lg, full }
- shadows: { sm, md, lg }

## Phase 4: Component Update Plan

List specific code changes needed to apply the new design tokens to each component.
Format as actionable tasks with file paths and line-level descriptions.

## Design Context
${designContext}

Output the complete design tokens file and the component update plan.`;
}
