import { maskSecrets } from './logger.js';

export interface SerializedErrorCause {
  name: string;
  message: string;
  code?: string;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function codeFrom(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as Record<string, unknown>)['code'];
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function errorName(value: unknown): string {
  if (value instanceof Error) return value.name;
  return 'NonErrorCause';
}

function serializedCause(value: unknown): SerializedErrorCause {
  const code = codeFrom(value);
  return {
    name: errorName(value),
    message: maskSecrets(stringifyUnknown(value)),
    ...(code ? { code } : {}),
  };
}

export function safeErrorMessage(value: unknown): string {
  return maskSecrets(stringifyUnknown(value));
}

export function safeErrorStack(error: Error): string | undefined {
  return error.stack ? maskSecrets(error.stack) : undefined;
}

export function collectErrorCauses(error: unknown, maxDepth = 8): SerializedErrorCause[] {
  const causes: SerializedErrorCause[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number): void {
    if (depth >= maxDepth || seen.has(value)) return;
    seen.add(value);

    if (value instanceof Error) {
      const cause = value.cause;
      if (cause !== undefined) {
        causes.push(serializedCause(cause));
        visit(cause, depth + 1);
      }

      if (value instanceof AggregateError) {
        for (const aggregateCause of value.errors) {
          causes.push(serializedCause(aggregateCause));
          visit(aggregateCause, depth + 1);
        }
      }
    }
  }

  visit(error, 0);
  return causes;
}

export function errorSearchText(error: Error): string {
  const parts = [
    error.message,
    ...collectErrorCauses(error).map(cause => cause.message),
  ];
  return parts.join(' ');
}

export function firstCauseCode(error: Error): string | undefined {
  return collectErrorCauses(error).find(cause => cause.code)?.code;
}
