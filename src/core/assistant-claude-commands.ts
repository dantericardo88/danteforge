// assistant-claude-commands.ts — installs Claude Code personal slash commands. Claude Code surfaces user
// slash commands from ~/.claude/commands/*.md (NOT ~/.claude/skills/). DanteForge previously installed only
// skills for Claude, so /autoforge, /inferno, /council, etc. never appeared in the VS Code slash menu. This
// mirrors the canonical commands/*.md there and generates the two aliases operators reach for but that have no
// file: /askcouncil (→ council) and /supervise. Split from assistant-installer.ts to honor the 500-LOC standard.

import fs from 'node:fs/promises';
import path from 'node:path';

const SUPERVISE_COMMAND_MD = `---
name: supervise
description: "Auto-reengage Supervisor — keep an autonomous engine looping through transient stops (sleep, crash, provider outage, dead council member) WITHOUT a human running resume. Builds to the 8.0 technological frontier unattended, then pauses for feedback (9+ is feedback-gated)."
---

# /supervise — Auto-reengage Supervisor

Keep an autonomous build engine looping through transient stops without babysitting it.

\`\`\`bash
danteforge supervise "<goal>" --engine autoforge --target 8 --posture tiered
\`\`\`

- Auto-restarts: degraded panel, provider outage (waits the named reset), crash/docker-down, max-cycles-with-progress.
- Pauses + notifies you ONLY on a real capability ceiling / policy / budget — written to .danteforge/ESCALATIONS.md.
- Survives host sleep: \`danteforge supervise "<goal>" --install-keepalive\`.
- Status / stop: \`danteforge supervise --status\` · \`danteforge supervise --stop\`.

8.0 is the technological frontier the loop reaches unattended; 9+ unlocks only after real usage + feedback.
`;

async function copyMarkdown(commandsDir: string, targetDir: string): Promise<void> {
  let entries: string[];
  try { entries = await fs.readdir(commandsDir); } catch { return; }
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    await fs.copyFile(path.join(commandsDir, entry), path.join(targetDir, entry));
  }
}

async function writeAlias(cmdDir: string, source: string, alias: string): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(cmdDir, `${source}.md`), 'utf8');
    await fs.writeFile(path.join(cmdDir, `${alias}.md`), raw.replace(/^name:\s*.+$/m, `name: ${alias}`), 'utf8');
  } catch {
    // best-effort — alias generation never blocks install
  }
}

/** Install Claude Code slash commands from the packaged commands/ dir, plus the /askcouncil + /supervise aliases. */
export async function syncClaudeCommands(homeDir: string, packagedCommandsDir: string): Promise<void> {
  const cmdDir = path.join(homeDir, '.claude', 'commands');
  await copyMarkdown(packagedCommandsDir, cmdDir);
  await writeAlias(cmdDir, 'council', 'askcouncil');
  try {
    await fs.mkdir(cmdDir, { recursive: true });
    await fs.writeFile(path.join(cmdDir, 'supervise.md'), SUPERVISE_COMMAND_MD, 'utf8');
  } catch {
    // best-effort
  }
}
