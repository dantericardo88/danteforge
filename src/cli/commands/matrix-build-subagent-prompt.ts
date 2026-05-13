// Matrix Kernel — Per-lease sub-agent prompt builder
//
// The `/matrixdev` slash command body needs to dispatch parallel sub-agents
// (one per lease) via the host AI's Agent tool. Each sub-agent must get a
// self-contained prompt that includes everything the kernel knows about
// the lease — worktree path, branch, scope, acceptance criteria — but
// presented as direct instructions to a fresh agent context, not as a
// passive packet on disk.
//
// This module assembles that prompt deterministically from the lease graph
// and the existing work-instruction.json on disk, so the slash command body
// can just call this and pass the result through to the Agent tool.

import fs from 'node:fs/promises';
import path from 'node:path';

const EMBEDDED_DIR = '.danteforge/embedded-mode';

export interface SubagentPrompt {
  leaseId: string;
  /** Short (4-6 word) description for the Agent tool's `description` field. */
  description: string;
  /** Markdown prompt body for the Agent tool's `prompt` field. */
  prompt: string;
}

export interface BuildSubagentPromptOptions {
  cwd?: string;
  /** Injection seam for tests — overrides fs.readFile. */
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>;
}

interface WorkInstructionJson {
  leaseId: string;
  workPacketId: string;
  packetTitle: string;
  objective: string;
  ownedPaths: string[];
  readOnlyPaths: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  worktreePath: string;
  hostAI: string;
  createdAt: string;
}

interface LeaseGraphShape {
  leases: Array<{ id: string; branch: string; worktreePath: string }>;
}

export async function buildSubagentPrompt(
  leaseId: string,
  options: BuildSubagentPromptOptions = {},
): Promise<SubagentPrompt> {
  const cwd = options.cwd ?? process.cwd();
  const read = options._readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc) as Promise<string>);

  // 1. Read the work-instruction packet (machine-readable sibling of the .md).
  const packetPath = path.join(cwd, EMBEDDED_DIR, leaseId, 'work-instruction.json');
  let packet: WorkInstructionJson;
  try {
    const raw = await read(packetPath, 'utf8');
    packet = JSON.parse(raw) as WorkInstructionJson;
  } catch (err) {
    throw new Error(
      `buildSubagentPrompt(${leaseId}): could not read ${packetPath}. ` +
      `Did the kernel write the work-instruction packet? Run \`matrix-kernel run-wave --adapter embedded\` first. ` +
      `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Cross-reference the lease graph for the branch (the packet only has worktreePath).
  let branch = '<unknown>';
  try {
    const leaseRaw = await read(
      path.join(cwd, '.danteforge', 'matrix', 'matrix.lease-graph.json'),
      'utf8',
    );
    const leaseGraph = JSON.parse(leaseRaw) as LeaseGraphShape;
    const lease = leaseGraph.leases.find(l => l.id === leaseId);
    if (lease) branch = lease.branch;
  } catch {
    // Branch is decorative; missing graph is non-fatal.
  }

  // 3. Build the agent description (short, deterministic).
  const description = describeLease(packet);

  // 4. Assemble the prompt.
  const prompt = renderPrompt(packet, branch);

  return { leaseId, description, prompt };
}

function describeLease(packet: WorkInstructionJson): string {
  // Workpacket IDs look like work.<dim>.<timestamp>. Extract the dim.
  const match = packet.workPacketId.match(/^work\.([^.]+)/);
  const dim = match ? match[1] : 'lease';
  return `Matrix lease: ${dim}`.slice(0, 60);
}

function renderPrompt(packet: WorkInstructionJson, branch: string): string {
  const ownedList = packet.ownedPaths.length === 0
    ? '_(none — but a packet with no owned paths is a kernel bug; surface this)_'
    : packet.ownedPaths.map(p => `- \`${p}\``).join('\n');
  const forbiddenList = packet.forbiddenPaths.length === 0
    ? '_(none)_'
    : packet.forbiddenPaths.map(p => `- \`${p}\``).join('\n');
  const readOnlyList = packet.readOnlyPaths.length === 0
    ? '_(none)_'
    : packet.readOnlyPaths.map(p => `- \`${p}\``).join('\n');
  const criteriaList = packet.acceptanceCriteria.length === 0
    ? '_(none specified — judge the work against the objective alone)_'
    : packet.acceptanceCriteria.map(c => `- ${c}`).join('\n');

  return `You are a parallel sub-agent dispatched by the DanteForge Matrix Kernel. The kernel is the conductor; you are one of N concurrent workers each executing a separate lease in their own isolated git worktree on their own branch.

## Lease identity

- **Lease ID:** \`${packet.leaseId}\`
- **Work packet:** \`${packet.workPacketId}\` — ${packet.packetTitle}
- **Worktree root:** \`${packet.worktreePath}\`
- **Branch:** \`${branch}\` (your edits stay on this branch; main is untouched)

## Objective

${packet.objective}

## Scope (STRICT)

**You MAY edit files inside the worktree root above, AT THESE RELATIVE PATHS ONLY:**
${ownedList}

**You MUST NOT modify (under any circumstances):**
${forbiddenList}

**Read-only (reference only, never edit):**
${readOnlyList}

## Acceptance criteria

${criteriaList}

## How to work

1. **All edits go INSIDE \`${packet.worktreePath}\`.** Every owned-path above is relative to that worktree root. Do NOT edit anything in the main repo checkout — only the worktree.
2. **Use your own Edit/Write/Read/Bash tools** to make the changes. Run typecheck / tests from the worktree directory (\`cd ${packet.worktreePath} && npm run typecheck\` or whatever the project uses) before declaring success.
3. **Do NOT spawn other sub-agents.** No nested Agent tool calls, no \`claude\` / \`codex\` subprocesses. You're already a sub-agent; the kernel handles parallelism at the wave level above you.
4. **If you cannot satisfy the acceptance criteria in one pass, return early and say so.** Do not invent fake changes to pad the diff — merge-court rejects zero-diff completions and will tell the user honestly. Better to come back with "I couldn't do X because Y" than to ship broken code.
5. **When done, do NOT call \`matrix-kernel embedded-complete\` yourself.** The parent slash command will call it for every lease in a batch after all sub-agents return. Your job is just to do the edit + local checks.

## What to return

When you finish (success or partial failure), reply with a single message containing:

1. **Status:** \`completed\`, \`partial\`, or \`failed\`
2. **Summary:** one-sentence description of what you accomplished
3. **Files modified:** flat list of paths relative to the worktree root
4. **Acceptance criteria check:** which criteria you satisfied, which you didn't
5. **Notes (optional):** anything the kernel / human reviewer needs to know (e.g. "tests pass except for an unrelated flaky one in tests/x.test.ts")

Keep the reply concise — the parent slash command will parse it.
`;
}
