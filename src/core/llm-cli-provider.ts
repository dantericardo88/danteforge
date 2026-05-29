// llm-cli-provider.ts — Use the local claude / codex SUBSCRIPTION CLIs as an LLM backend.
//
// DanteForge has two LLM paths: the council/build loop already shells out to the
// `claude` and `codex` CLIs as AGENTS, but the internal text helper (callLLM —
// competitor scan, OSS research, council-universe, scoring) historically only
// routed to API-key providers (Anthropic API, OpenAI, Ollama, …). On a machine
// with no cloud key and slow local Ollama, that helper fails and produces empty
// matrices (the DanteSecurity incident).
//
// This module closes the gap: it lets callLLM use the same subscription CLIs for
// plain text completion, so ONE backend powers both research and build —
// `danteforge config --provider claude-code` and you never need a separate key.
//
// Invocation (validated headless):
//   claude -p           — prompt on stdin, prints just the response (clean)
//   codex exec <prompt> — prompt as arg, prints response + footer noise (cleaned)

import { spawn } from 'node:child_process';
import { withCliSlot } from './cli-semaphore.js';

export type CliAgentProvider = 'claude-code' | 'codex';

interface CliAgentSpec {
  bin: string;
  /** Static args; the prompt is appended (viaStdin=false) or written to stdin (viaStdin=true). */
  args: string[];
  viaStdin: boolean;
  /** Optional stdout cleaner for CLIs that wrap the answer in footer/echo noise. */
  clean?: (out: string) => string;
}

const CLI_AGENTS: Record<CliAgentProvider, CliAgentSpec> = {
  'claude-code': { bin: 'claude', args: ['-p'], viaStdin: true },
  'codex': { bin: 'codex', args: ['exec'], viaStdin: false, clean: stripCodexNoise },
};

export function isCliAgentProvider(provider: string): provider is CliAgentProvider {
  return provider === 'claude-code' || provider === 'codex';
}

/** `codex exec` emits process-termination lines, a "tokens used" footer, and echoes the answer. */
function stripCodexNoise(out: string): string {
  const lines = out.split(/\r?\n/);
  const cleaned: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^SUCCESS: The process with PID/i.test(t)) continue;
    if (/^tokens used$/i.test(t)) continue;
    if (/^[\d,]+$/.test(t)) continue; // bare token count
    if (cleaned[cleaned.length - 1] === t) continue; // de-dup the echoed answer
    cleaned.push(t);
  }
  return cleaned.join('\n').trim();
}

/**
 * Run a one-shot text completion through a subscription CLI. Returns the model's
 * text. Throws with an actionable message if the CLI is missing, times out, or
 * exits non-zero. Default timeout is generous because CLI agents spin up slowly.
 */
export async function callCliAgent(
  provider: CliAgentProvider,
  prompt: string,
  timeoutMs = 300_000,
  _spawn: typeof spawn = spawn,
): Promise<string> {
  const spec = CLI_AGENTS[provider];
  const args = spec.viaStdin ? [...spec.args] : [...spec.args, prompt];

  // Fleet governor: hold one of N shared CLI slots for the lifetime of this spawn so
  // a fleet of windows collectively stays under the per-account subscription rate limit.
  return withCliSlot(() => spawnCliAgent(spec, args, prompt, timeoutMs, _spawn), { label: provider });
}

function spawnCliAgent(
  spec: CliAgentSpec,
  args: string[],
  prompt: string,
  timeoutMs: number,
  _spawn: typeof spawn,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = _spawn(spec.bin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish(() => reject(new Error(`${spec.bin} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      finish(() => reject(new Error(
        `Failed to spawn "${spec.bin}": ${err.message}. Is the ${spec.bin} CLI installed and on PATH? ` +
        `Run \`danteforge council --discover\` to check.`,
      )));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(() => reject(new Error(`${spec.bin} exited ${code ?? 'null'}: ${stderr.slice(0, 300)}`)));
        return;
      }
      const text = (spec.clean ? spec.clean(stdout) : stdout).trim();
      if (!text) {
        finish(() => reject(new Error(`${spec.bin} returned empty output`)));
        return;
      }
      finish(() => resolve(text));
    });

    if (spec.viaStdin) {
      try { child.stdin?.write(prompt); child.stdin?.end(); } catch { /* spawn error path handles it */ }
    } else {
      child.stdin?.end();
    }
  });
}
