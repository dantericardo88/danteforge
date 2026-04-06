import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { loadConfig } from '../../core/config.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { requirePlan, runGate } from '../../core/gates.js';
import { detectHost, detectMCPCapabilities, buildUXRefinePrompt } from '../../core/mcp.js';
import { isUIProject } from '../../core/mcp-adapter.js';
import { handoff } from '../../core/handoff.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import fs from 'fs/promises';
import path from 'path';

async function hasForgeRun(): Promise<boolean> {
  try {
    const state = await loadState();
    if (state.auditLog.some((entry: string) => entry.includes('| forge: wave '))) {
      return true;
    }
  } catch {
    // State not initialized yet.
  }

  const buildDirs = ['dist', 'build', '.next', '.nuxt', '.output', 'out', '.svelte-kit'];
  for (const dir of buildDirs) {
    try {
      await fs.access(dir);
      return true;
    } catch {
      // Continue.
    }
  }

  return false;
}

export async function uxRefine(options: {
  prompt?: boolean;
  light?: boolean;
  host?: string;
  figmaUrl?: string;
  tokenFile?: string;
  skipUx?: boolean;
  magic?: boolean;
  afterForge?: boolean;
  openpencil?: boolean;
  lint?: boolean;
} = {}) {
  return withErrorBoundary('ux-refine', async () => {
  if (options.skipUx) {
    logger.info('UX refinement skipped (--skip-ux)');
    return;
  }

  // --lint: run design rules engine against DESIGN.op
  if (options.lint) {
    await runDesignLint();
    return;
  }

  if (options.openpencil) {
    await runOpenPencilRefinement();
    return;
  }

  if (!options.prompt) {
    logger.error('UX refinement requires an explicit mode. Use --openpencil for local DESIGN.op refinement or --prompt for guided Figma/manual refinement.');
    process.exitCode = 1;
    return;
  }

  if (!(await runGate(() => requirePlan(options.light)))) { process.exitCode = 1; return; }

  const forgeCompleted = options.afterForge || await hasForgeRun();
  if (!forgeCompleted) {
    logger.error('UX refinement is blocked until a real forge pass has completed. Run "danteforge forge 1" first, then re-run with --prompt or --openpencil.');
    process.exitCode = 1;
    return;
  }

  const hasUI = await isUIProject();
  if (!hasUI && !options.figmaUrl) {
    logger.error('No frontend/UI project was detected. UX refinement is only supported for UI projects or an explicit --figma-url.');
    process.exitCode = 1;
    return;
  }

  const state = await loadState();
  const config = await loadConfig();
  const host = detectHost(options.host);
  const capabilities = await detectMCPCapabilities(host);
  const figmaUrl = options.figmaUrl ?? config.figma?.defaultFileUrl ?? state.figmaUrl;
  const tokenFile = options.tokenFile ?? config.figma?.designTokensPath ?? state.designTokensPath ?? 'src/design-tokens.css';
  const componentPaths = await discoverUIComponents();

  if (componentPaths.length === 0 && !figmaUrl) {
    logger.error('No UI component files were found for prompt generation. Add component files or provide --figma-url.');
    process.exitCode = 1;
    return;
  }

  const designContext = [
    `Project: ${state.project}`,
    `Workflow stage: ${state.workflowStage}`,
    `Phase: ${state.currentPhase}`,
    `Profile: ${state.profile}`,
    state.constitution ? `Principles: ${state.constitution.substring(0, 200)}` : '',
  ].filter(Boolean).join('\n');

  const prompt = buildUXRefinePrompt(
    componentPaths.length > 0 ? componentPaths : ['(project root)'],
    designContext,
    figmaUrl,
    tokenFile,
    state.constitution,
  );

  const savedPath = await savePrompt('ux-refine', prompt);
  displayPrompt(prompt, [
    'Paste this prompt into your MCP-capable editor or use it as a manual Figma refinement checklist.',
    capabilities.hasFigmaMCP
      ? `Detected Figma MCP server: ${capabilities.figmaServerName ?? 'figma'}`
      : 'No Figma MCP server was detected. Follow the manual steps in the prompt.',
    'After manual refinement, save the result as .danteforge/UX_REFINE.md or import it with "danteforge import <file> --as UX_REFINE.md".',
    'Then run "danteforge verify" to validate the refinement before synthesis.',
    `Prompt saved to: ${savedPath}`,
  ].join('\n'));

  state.mcpHost = host;
  if (figmaUrl) state.figmaUrl = figmaUrl;
  state.designTokensPath = tokenFile;
  state.auditLog.push(`${new Date().toISOString()} | ux-refine: prompt generated (host: ${host}, figma-mcp: ${capabilities.hasFigmaMCP})`);
  await saveState(state);
  });
}

async function runOpenPencilRefinement(): Promise<void> {
  logger.info('OpenPencil local mode - extracting tokens and previews from DESIGN.op');

  try {
    const raw = await fs.readFile('.danteforge/DESIGN.op', 'utf-8');
    const { parseOP, validateOP } = await import('../../harvested/openpencil/op-codec.js');
    const { extractTokensFromDocument, tokensToCSS, tokensToTailwindConfig } = await import('../../harvested/openpencil/token-extractor.js');
    const { renderToASCII, renderToHTML } = await import('../../harvested/openpencil/headless-renderer.js');

    const doc = parseOP(raw);
    const validation = validateOP(doc);
    if (!validation.valid) {
      for (const err of validation.errors) logger.error(`  Validation: ${err}`);
      logger.error('DESIGN.op has validation errors - fix them before running ux-refine --openpencil');
      process.exitCode = 1;
      return;
    }

    for (const warning of validation.warnings) {
      logger.warn(`  ${warning}`);
    }

    const tokens = extractTokensFromDocument(doc);
    const css = tokensToCSS(tokens);
    const tailwind = tokensToTailwindConfig(tokens);
    const preview = renderToASCII(doc);
    const html = renderToHTML(doc);

    await fs.mkdir('.danteforge', { recursive: true });
    await fs.writeFile('.danteforge/design-tokens.css', css);
    await fs.writeFile('.danteforge/design-tokens.tailwind.js', tailwind);
    await fs.writeFile('.danteforge/design-preview.html', html);

    logger.success('Design tokens extracted:');
    logger.info('  CSS:      .danteforge/design-tokens.css');
    logger.info('  Tailwind: .danteforge/design-tokens.tailwind.js');
    logger.info('  Preview:  .danteforge/design-preview.html');
    process.stdout.write(preview + '\n');

    const state = await loadState();
    state.auditLog.push(`${new Date().toISOString()} | ux-refine: OpenPencil local refinement (tokens: ${tokens.colors.length}c/${tokens.typography.length}t/${tokens.spacing.length}s)`);
    await saveState(state);
    await handoff('ux-refine', {});
    logger.success('Local design refinement complete');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.error('No DESIGN.op found - run "danteforge design <prompt>" first or create the file manually.');
    } else {
      logger.error(`OpenPencil refinement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}

async function discoverUIComponents(): Promise<string[]> {
  const patterns = [
    'src/components',
    'src/pages',
    'src/views',
    'src/ui',
    'src/app',
    'components',
    'pages',
    'app',
  ];

  const extensions = ['.tsx', '.jsx', '.vue', '.svelte', '.html'];
  const found: string[] = [];

  for (const dir of patterns) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          found.push(path.join(dir, entry.name));
          if (found.length >= 50) return found;
        }
      }
    } catch {
      // Directory does not exist.
    }
  }

  return found;
}

async function runDesignLint(): Promise<void> {
  logger.info('Running design lint against DESIGN.op...');
  const designPath = path.join('.danteforge', 'DESIGN.op');

  try {
    const content = await fs.readFile(designPath, 'utf8');
    const { parseOP } = await import('../../harvested/openpencil/op-codec.js');
    const { evaluateDocument, formatViolationReport, loadRules, loadRuleConfig } = await import('../../core/design-rules-engine.js');

    const doc = parseOP(content);
    const violations = evaluateDocument(
      doc,
      loadRules('.danteforge/design-rules.yaml'),
      loadRuleConfig('.danteforge/design-rules.yaml'),
    );
    const report = formatViolationReport(violations);

    logger.info('');
    logger.info(report);

    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    if (errors.length > 0) {
      logger.error(`${errors.length} error(s) found — fix before proceeding`);
      process.exitCode = 1;
    } else if (warnings.length > 0) {
      logger.warn(`${warnings.length} warning(s) found — review recommended`);
    } else {
      logger.success('Design lint passed — no issues found');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ENOENT')) {
      logger.error(`Design file not found: ${designPath}`);
      logger.info('Run `danteforge design <prompt>` first to generate a design.');
    } else {
      logger.error(`Design lint failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}
