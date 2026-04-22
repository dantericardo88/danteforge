import assert from 'node:assert/strict';
import {
  formatLiveConfigurationError,
  resolveLiveRequestTimeoutMs,
  validateLiveConfiguration,
} from './live-check-lib.mjs';
import {
  computeProofStatus,
  getWorkflowContext,
  readGitSha,
  readPackageVersion,
  writeLiveVerifyReceipt,
} from './proof-receipts.mjs';

const PROMPT = 'Reply with exactly the single word DanteForge.';
const EXPECTED = /danteforge/i;
const ANTIGRAVITY_BUNDLES_URL = process.env.ANTIGRAVITY_BUNDLES_URL ?? 'https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/docs/BUNDLES.md';
const FIGMA_MCP_URL = process.env.FIGMA_MCP_URL ?? 'https://mcp.figma.com/mcp';
const LIVE_RECEIPT_JSON_PATH = '.danteforge/evidence/live/latest.json';

async function fetchJson(url, init = {}, timeoutMs = resolveLiveRequestTimeoutMs(process.env)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}: ${body.slice(0, 240)}`);
    }
    return body.trim() ? JSON.parse(body) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function ensureResponse(provider, text) {
  assert.match(text, EXPECTED, `${provider} did not return the expected contract word.`);
  return text;
}

async function checkOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for openai live verification.');
  const payload = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 8,
    }),
  });
  return ensureResponse('openai', payload?.choices?.[0]?.message?.content ?? '');
}

async function checkGrok() {
  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL ?? 'grok-3-mini';
  if (!apiKey) throw new Error('XAI_API_KEY is required for grok live verification.');
  const payload = await fetchJson('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 8,
    }),
  });
  return ensureResponse('grok', payload?.choices?.[0]?.message?.content ?? '');
}

async function checkClaude() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for claude live verification.');
  const payload = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: PROMPT }],
    }),
  });
  const text = (payload?.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block?.text ?? '')
    .join('');
  return ensureResponse('claude', text);
}

async function checkGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for gemini live verification.');
  const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
      generationConfig: {
        maxOutputTokens: 8,
      },
    }),
  });
  const text = (payload?.candidates ?? [])
    .flatMap(candidate => candidate?.content?.parts ?? [])
    .map(part => part?.text ?? '')
    .join('');
  return ensureResponse('gemini', text);
}

async function checkOllama() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3';
  const payload = await fetchJson(
    `${baseUrl.replace(/\/+$/, '')}/api/chat`,
    {
      method: 'POST',
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: PROMPT }],
      }),
    },
    resolveLiveRequestTimeoutMs(process.env, 'ollama'),
  );
  return ensureResponse('ollama', payload?.message?.content ?? '');
}

async function checkAntigravityUpstream() {
  const response = await fetch(ANTIGRAVITY_BUNDLES_URL, {
    method: 'GET',
    headers: {
      'user-agent': 'danteforge-live-check',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Antigravity upstream returned ${response.status}`);
  }
  assert.match(body, /BUNDLES|docs\/users\/bundles\.md|skills/i, 'Antigravity upstream response shape changed.');
}

async function checkFigmaMcp() {
  const response = await fetch(FIGMA_MCP_URL, { method: 'HEAD' });
  if (!(response.ok || response.status === 404 || response.status === 405)) {
    throw new Error(`Figma MCP endpoint returned ${response.status}`);
  }
}

const checks = {
  openai: checkOpenAI,
  grok: checkGrok,
  claude: checkClaude,
  gemini: checkGemini,
  ollama: checkOllama,
};

const cwd = process.cwd();
const version = await readPackageVersion(cwd);
const gitSha = readGitSha(cwd);
const providerResults = [];
const upstreamChecks = [];
let providers = [];
let errorMessage = null;

try {
  const configuration = validateLiveConfiguration(process.env);
  if (configuration.error || configuration.missing.length > 0) {
    throw new Error(formatLiveConfigurationError(configuration));
  }

  providers = configuration.providers;
  for (const provider of providers) {
    const check = checks[provider];
    if (!check) {
      throw new Error(`Unknown live provider "${provider}". Valid values: ${Object.keys(checks).join(', ')}`);
    }
    process.stdout.write(`Checking ${provider}...\n`);
    try {
      const result = await check();
      providerResults.push({ provider, status: 'pass', detail: result });
      process.stdout.write(`  ok: ${result}\n`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      providerResults.push({ provider, status: 'fail', detail });
      throw error;
    }
  }

  process.stdout.write('Checking Antigravity upstream...\n');
  try {
    await checkAntigravityUpstream();
    upstreamChecks.push({ name: 'antigravity-upstream', status: 'pass', detail: 'reachable' });
    process.stdout.write('  ok: upstream reachable\n');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    upstreamChecks.push({ name: 'antigravity-upstream', status: 'fail', detail });
    throw error;
  }

  process.stdout.write('Checking Figma MCP endpoint...\n');
  try {
    await checkFigmaMcp();
    upstreamChecks.push({ name: 'figma-mcp', status: 'pass', detail: 'reachable' });
    process.stdout.write('  ok: endpoint reachable\n');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    upstreamChecks.push({ name: 'figma-mcp', status: 'fail', detail });
    throw error;
  }

  process.stdout.write('Live integration checks passed\n');
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
  if (providerResults.length === 0 && providers.length === 0) {
    upstreamChecks.push({ name: 'configuration', status: 'fail', detail: errorMessage });
  }
  process.stderr.write(`Live integration checks failed: ${errorMessage}\n`);
  process.exitCode = 1;
} finally {
  const receipt = {
    project: 'danteforge',
    version,
    gitSha,
    timestamp: new Date().toISOString(),
    cwd,
    platform: process.platform,
    nodeVersion: process.version,
    providers,
    providerResults,
    upstreamChecks,
    workflowContext: getWorkflowContext(process.env),
    errorMessage,
    status: computeProofStatus([
      ...providerResults,
      ...upstreamChecks,
      ...(errorMessage ? [{ status: 'fail' }] : []),
    ]),
  };
  const receiptPath = await writeLiveVerifyReceipt(receipt, cwd);
  process.stdout.write(`Live verify receipt written to ${receiptPath} (${LIVE_RECEIPT_JSON_PATH})\n`);
}
