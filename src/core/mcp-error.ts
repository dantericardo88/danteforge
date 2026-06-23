// mcp-error.ts — structured MCP error semantics for DanteForge's MCP server.
//
// PROVENANCE (engineering-frontier, server-owned slice of the ecosystem_mcp bundle): the demand-satisfaction
// council named "structured MCP error semantics" as part of the genuine ecosystem_mcp rung-9 surface, and the
// attribution here is CLEAN — DanteForge IS the server, so improving how its tools report errors is squarely
// the server's own job (no host-vs-server gap).
//
// Today every tool error is a flat `{ error: "<string>" }` — a host cannot programmatically tell a missing
// parameter from a gate block from an internal failure, so it can only regex-match human prose. This module
// classifies errors into stable machine codes, attaches an actionable hint and a retriable flag, and (in
// mcp-server.ts) emits them ALONGSIDE the legacy string `error` field so existing callers keep working.

export type McpErrorCode =
  | 'missing_parameter' // a required parameter was not supplied
  | 'invalid_parameter' // a parameter was supplied but is the wrong type/value
  | 'not_found'         // a requested resource/artifact/gate/tool does not exist
  | 'gate_blocked'      // a hard gate refused the operation (constitution/spec/plan/tests)
  | 'rate_limited'      // the rate limiter rejected the call
  | 'internal';         // an unexpected failure

export interface McpStructuredError {
  code: McpErrorCode;
  message: string;
  /** The offending parameter / resource name, when one can be identified. */
  param?: string;
  /** A concrete next step the caller can take. */
  hint: string;
  /** Whether the SAME call could plausibly succeed on retry (rate limits, transient internal faults). */
  retriable: boolean;
}

const HINTS: Record<McpErrorCode, string> = {
  missing_parameter: 'Supply the named parameter, then retry.',
  invalid_parameter: 'Correct the parameter type/value, then retry.',
  not_found: 'Check the name/path — call danteforge_state or the relevant list tool to see valid values.',
  gate_blocked: 'A hard gate refused this — satisfy the prerequisite (constitution/spec/plan/tests) or use --light, then retry.',
  rate_limited: 'Too many requests in the window — wait briefly, then retry.',
  internal: 'An unexpected error occurred — retry; if it persists, report it with the message.',
};

const RETRIABLE: Record<McpErrorCode, boolean> = {
  missing_parameter: false,
  invalid_parameter: false,
  not_found: false,
  gate_blocked: false,
  rate_limited: true,
  internal: true,
};

/** Infer a stable error code (and the offending param, when present) from a legacy human message. */
export function classifyErrorMessage(message: string): { code: McpErrorCode; param?: string } {
  const m = message ?? '';
  const miss = /missing (?:required )?parameter:?\s*([A-Za-z0-9_]+)/i.exec(m);
  if (miss) return { code: 'missing_parameter', param: miss[1] };
  if (/\b(must be (?:a |an |one of)|invalid (?:value|parameter|argument)|expected )\b/i.test(m)) {
    return { code: 'invalid_parameter' };
  }
  if (/\b(not found|unknown|no such|does not exist|cannot find)\b/i.test(m)) {
    const named = /(?:unknown|no such)\s+\w+:?\s*([A-Za-z0-9_./-]+)/i.exec(m);
    return { code: 'not_found', param: named?.[1] };
  }
  if (/\b(gate|blocked|requires|must exist|forbidden|not allowed|run constitution|run specify)\b/i.test(m)) {
    return { code: 'gate_blocked' };
  }
  if (/\brate.?limit/i.test(m)) return { code: 'rate_limited' };
  return { code: 'internal' };
}

/** Build a structured error explicitly (preferred at new callsites). */
export function structuredError(
  code: McpErrorCode,
  message: string,
  opts: { param?: string; hint?: string } = {},
): McpStructuredError {
  return { code, message, param: opts.param, hint: opts.hint ?? HINTS[code], retriable: RETRIABLE[code] };
}

/** Upgrade a legacy string message OR pass through an already-structured error. */
export function toStructuredError(input: string | McpStructuredError): McpStructuredError {
  if (typeof input !== 'string') return input;
  const { code, param } = classifyErrorMessage(input);
  return structuredError(code, input, { param });
}
