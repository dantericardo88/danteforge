import { logger } from '../../core/logger.js';
import { installAssistantSkills, type AssistantRegistry } from '../../core/assistant-installer.js';
import { resolveConfigPaths } from '../../core/config.js';

const DEFAULT_ASSISTANTS: AssistantRegistry[] = ['claude', 'codex', 'antigravity', 'opencode'];
const ALL_ASSISTANTS: AssistantRegistry[] = ['claude', 'codex', 'antigravity', 'opencode', 'cursor'];

function normalizeAssistant(value: string): AssistantRegistry | null {
  switch (value.trim().toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'antigravity':
    case 'gemini':
    case 'gemini-3.1':
      return 'antigravity';
    case 'opencode':
    case 'open-code':
      return 'opencode';
    case 'cursor':
      return 'cursor';
    default:
      return null;
  }
}

function parseAssistants(raw: string | undefined): AssistantRegistry[] | undefined {
  if (!raw) {
    return DEFAULT_ASSISTANTS;
  }

  if (raw.trim().toLowerCase() === 'all') {
    return ALL_ASSISTANTS;
  }

  const assistants = raw
    .split(',')
    .map(value => normalizeAssistant(value))
    .filter(Boolean);

  if (assistants.length === 0) {
    throw new Error('Invalid assistant list. Use: claude,codex,antigravity|gemini,opencode,cursor');
  }

  return [...new Set(assistants)] as AssistantRegistry[];
}

export async function setupAssistants(options: { assistants?: string } = {}) {
  const assistants = parseAssistants(options.assistants);
  const result = await installAssistantSkills({ assistants });
  const paths = resolveConfigPaths();

  logger.success('Installed DanteForge skills for local coding assistants');
  for (const entry of result.assistants) {
    const noun = entry.installMode === 'cursor-rules' ? 'bootstrap file' : 'skills';
    logger.info(`${entry.assistant}: ${entry.installedSkills.length} ${noun} -> ${entry.targetDir}`);
  }
  logger.info(`Shared secrets/config: ${paths.configFile}`);
  logger.info('Cursor is project-local and opt-in. Run `danteforge setup assistants --assistants cursor` when you want the `.cursor/rules/danteforge.mdc` bootstrap file.');
  logger.info('Next: run `danteforge config --set-key "openai:..."` and `danteforge doctor --live` on the target machine.');
}
