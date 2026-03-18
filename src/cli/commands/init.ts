// init — interactive first-run wizard for new DanteForge projects
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import { isLLMAvailable } from '../../core/llm.js';
import { loadConfig } from '../../core/config.js';

export async function init(options: { prompt?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const timestamp = new Date().toISOString();

  logger.success('DanteForge Init — Project Setup Wizard');
  logger.info('');

  // Step 1: Detect project type
  const projectType = await detectProjectType(cwd);
  logger.info(`Detected project type: ${projectType}`);

  // Step 2: Check if .danteforge/ already exists
  const stateDir = path.join(cwd, '.danteforge');
  let isExisting = false;
  try {
    await fs.access(stateDir);
    isExisting = true;
    logger.warn('.danteforge/ directory already exists — refreshing configuration.');
  } catch {
    logger.info('No existing DanteForge project detected. Starting fresh.');
  }

  // Step 3: Lightweight health checks
  logger.info('');
  logger.info('Health checks:');

  const checks: { name: string; ok: boolean; message: string }[] = [];

  // Node version
  const major = parseInt(process.version.slice(1), 10);
  checks.push({
    name: 'Node.js',
    ok: major >= 18,
    message: major >= 18
      ? `${process.version} (compatible)`
      : `${process.version} — requires Node 18+`,
  });

  // Config / API key
  try {
    const config = await loadConfig();
    const hasKey = Object.values(config.providers).some(
      (p) => p?.apiKey,
    );
    checks.push({
      name: 'API key',
      ok: hasKey,
      message: hasKey
        ? `Provider: ${config.defaultProvider} (key configured)`
        : 'No API key — local-only mode. Use "danteforge config --set-key" to add one.',
    });
  } catch {
    checks.push({
      name: 'API key',
      ok: false,
      message: 'No config found — local-only mode.',
    });
  }

  // LLM availability
  const llmReady = await isLLMAvailable();
  checks.push({
    name: 'LLM provider',
    ok: llmReady,
    message: llmReady
      ? 'Live LLM provider available for direct execution.'
      : 'No live LLM — commands will use local fallback or --prompt mode.',
  });

  for (const check of checks) {
    const icon = check.ok ? '[OK]  ' : '[WARN]';
    logger[check.ok ? 'success' : 'warn'](`  ${icon} ${check.name}: ${check.message}`);
  }

  // Step 4: Initialize state
  const state = await loadState();
  state.projectType = projectType;
  state.auditLog.push(
    `${timestamp} | init: project type=${projectType}, existing=${isExisting}`,
  );
  await saveState(state);

  // Step 5: Guidance
  logger.info('');
  logger.success('Setup complete. Recommended next steps:');
  logger.info('');

  if (llmReady) {
    logger.info('  Quick start (LLM-powered):');
    logger.info('    danteforge magic "Your idea here"');
    logger.info('');
  }

  logger.info('  Step-by-step (works offline):');
  logger.info('    1. danteforge constitution    — establish project rules');
  logger.info('    2. danteforge specify <idea>   — generate specification');
  logger.info('    3. danteforge clarify          — find requirement gaps');
  logger.info('    4. danteforge plan             — create execution plan');
  logger.info('    5. danteforge tasks            — break into executable work');
  logger.info('    6. danteforge forge 1          — execute first wave');
  logger.info('    7. danteforge verify           — verify artifacts');
  logger.info('    8. danteforge synthesize       — generate final report');
  logger.info('');
  logger.info('Run "danteforge help" for context-aware guidance at any time.');
  logger.info('Run "danteforge doctor" for full system diagnostics.');
}
