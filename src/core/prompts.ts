// Interactive prompt helpers — wraps @inquirer/prompts for DanteForge commands
// Falls back gracefully in non-TTY environments (CI, pipes, tests)
// Tests use _readline injection seams on the calling command — not this module

import { type LLMProvider } from './config.js';
import type { MagicLevel } from './magic-presets.js';

// Dynamic import to avoid loading inquirer in non-TTY/test contexts
async function getInquirer() {
  return import('@inquirer/prompts');
}

export async function selectProvider(defaultProvider?: LLMProvider): Promise<LLMProvider> {
  if (!process.stdout.isTTY) return defaultProvider ?? 'ollama';
  try {
    const { select } = await getInquirer();
    return select({
      message: 'Select your LLM provider:',
      choices: [
        { value: 'ollama', name: 'Ollama (local, free)' },
        { value: 'claude', name: 'Claude (Anthropic)' },
        { value: 'openai', name: 'OpenAI (GPT-4o)' },
        { value: 'grok', name: 'Grok (xAI)' },
        { value: 'gemini', name: 'Gemini (Google)' },
      ],
      default: defaultProvider ?? 'ollama',
    });
  } catch {
    return defaultProvider ?? 'ollama';
  }
}

export async function selectPreset(defaultPreset?: MagicLevel): Promise<MagicLevel> {
  if (!process.stdout.isTTY) return defaultPreset ?? 'magic';
  try {
    const { select } = await getInquirer();
    return select({
      message: 'Select execution preset:',
      choices: [
        { value: 'spark',   name: 'spark  — quick fix    (~$0.10, 1 wave)' },
        { value: 'ember',   name: 'ember  — small feat   (~$0.25, 3 waves)' },
        { value: 'canvas',  name: 'canvas — design first (~$0.75, 6 waves)' },
        { value: 'magic',   name: 'magic  — standard     (~$1.00, 6 waves)' },
        { value: 'blaze',   name: 'blaze  — complex      (~$2.00, 8 waves)' },
        { value: 'nova',    name: 'nova   — full cycle   (~$3.00, 10 waves)' },
        { value: 'inferno', name: 'inferno — max power  (~$5.00, 15 waves)' },
      ],
      default: defaultPreset ?? 'magic',
    });
  } catch {
    return defaultPreset ?? 'magic';
  }
}

export async function confirmDestructive(action: string): Promise<boolean> {
  if (!process.stdout.isTTY) return false;
  try {
    const { confirm } = await getInquirer();
    return confirm({ message: `${action} — are you sure?`, default: false });
  } catch {
    return false;
  }
}

export async function inputWithDefault(message: string, defaultVal: string): Promise<string> {
  if (!process.stdout.isTTY) return defaultVal;
  try {
    const { input } = await getInquirer();
    const result = await input({ message, default: defaultVal });
    return result || defaultVal;
  } catch {
    return defaultVal;
  }
}
