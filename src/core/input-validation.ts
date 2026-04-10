import path from 'path';
import { ValidationError } from './errors.js';

/**
 * Sanitize a file path — resolve, normalize, and reject directory traversal.
 * Throws ValidationError if the path attempts to escape the base directory.
 */
export function sanitizePath(input: string, baseCwd?: string): string {
  const base = path.resolve(baseCwd ?? process.cwd());
  const resolved = path.resolve(base, input);
  // Normalize both to handle trailing slashes and case on Windows
  const normalizedBase = path.normalize(base) + path.sep;
  const normalizedResolved = path.normalize(resolved);
  if (!normalizedResolved.startsWith(normalizedBase) && normalizedResolved !== path.normalize(base)) {
    throw new ValidationError(
      `Path traversal rejected: "${input}" resolves outside project root`,
    );
  }
  return resolved;
}

const KNOWN_PROVIDERS = ['ollama', 'grok', 'claude', 'openai', 'gemini'] as const;
export type KnownProvider = typeof KNOWN_PROVIDERS[number];

/**
 * Validate that a provider name is recognized.
 */
export function validateProviderName(input: string): KnownProvider {
  const normalized = input.toLowerCase().trim();
  const match = KNOWN_PROVIDERS.find(p => p === normalized);
  if (!match) {
    throw new Error(`Unknown provider: "${input}". Valid providers: ${KNOWN_PROVIDERS.join(', ')}`);
  }
  return match;
}

/**
 * Validate a subcommand against an allowed list.
 */
export function validateSubcommand(input: string, allowed: string[]): string {
  const normalized = input.toLowerCase().trim();
  if (!allowed.includes(normalized)) {
    throw new Error(`Unknown subcommand: "${input}". Valid options: ${allowed.join(', ')}`);
  }
  return normalized;
}
