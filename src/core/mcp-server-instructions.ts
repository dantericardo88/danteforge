// mcp-server-instructions.ts — DanteForge's MCP SERVER-LEVEL instructions.
//
// PROVENANCE (engineering-frontier, demand-grounded): harvested external demand cluster "mcp / server / after"
// (6.8/10), specifically:
//   - cline/cline#8797 — MCP hosts ignore MCP server-level instructions (the server has no way to tell the host
//     how it must be used). The SERVER's honest half of that demand is to DECLARE proper server-level
//     instructions via the MCP `instructions` field so any compliant host presents them to the model.
//   - cline/cline#8087 — MCP tool identity must be STABLE across restarts/reconnects. DanteForge already
//     satisfies this (tool names are static `danteforge_*` literals); the instructions state it explicitly so a
//     host can trust cached schemas.
//
// This string is wired into BOTH the SDK `Server` options and the manual `initialize` JSON-RPC result in
// mcp-server.ts, so every host that connects receives it in the initialize response.

export const DANTEFORGE_MCP_INSTRUCTIONS = `DanteForge is an agentic-development control plane exposed over MCP. Its tools drive a structured, gated build workflow and an evidence-grounded quality-scoring matrix.

Start here: call danteforge_state first to learn the current project, phase, and open tasks before acting.

Core build workflow (call in order for new work): danteforge_specify -> danteforge_plan -> danteforge_tasks -> danteforge_forge -> danteforge_verify.
Scoring & assessment: danteforge_assess, danteforge_score, danteforge_score_all, danteforge_gate_check, danteforge_explain_score.

Hard rules this server enforces — honor them when acting on its results:
- Zero tolerance: never write mocks, stubs, or TODOs into source. The pre-commit gate and the merge court reject them.
- Hard gates: constitution -> spec -> plan -> tests must exist before forge; do not bypass them unless the user explicitly runs in --light mode.
- Scores are evidence-gated: a dimension cannot claim above 7.0 without a passing capability_test / validate receipt. Treat any score lacking a receipt as a hypothesis, not a fact.

Tool identity is STABLE across restarts and reconnects: every tool is a static danteforge_* identifier, never an ephemeral per-session key, so cached tool schemas remain valid after a reconnect.`;
