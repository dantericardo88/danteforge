// Phase D — fetch real source files from harvest targets via gh API,
// decode them, write to a local harvest cache, and emit a summary digest
// the human-authored function-comparison docs reference for citations.
//
// Output: .danteforge/OSS_HARVEST/raw/<source>/<file>.md and
//         .danteforge/OSS_HARVEST/raw/_digest.json

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const cacheRoot = resolve(process.cwd(), '.danteforge', 'OSS_HARVEST', 'raw');
mkdirSync(cacheRoot, { recursive: true });

const TARGETS = [
  // obra/superpowers
  { owner: 'obra', repo: 'superpowers', path: 'skills/brainstorming/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/writing-plans/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/test-driven-development/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/verification-before-completion/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/systematic-debugging/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/dispatching-parallel-agents/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/subagent-driven-development/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/requesting-code-review/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/receiving-code-review/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/writing-skills/SKILL.md', cacheDir: 'superpowers' },
  { owner: 'obra', repo: 'superpowers', path: 'skills/using-git-worktrees/SKILL.md', cacheDir: 'superpowers' },
  // Fission-AI/OpenSpec
  { owner: 'Fission-AI', repo: 'OpenSpec', path: 'openspec/AGENTS.md', cacheDir: 'openspec' },
  // mattpocock/skills (fill in remaining triage; to-prd + tdd + grill-with-docs already have findings recorded)
  { owner: 'mattpocock', repo: 'skills', path: 'skills/engineering/triage/SKILL.md', cacheDir: 'mattpocock' },
  { owner: 'mattpocock', repo: 'skills', path: 'skills/engineering/diagnose/SKILL.md', cacheDir: 'mattpocock' }
];

const digest = [];

for (const t of TARGETS) {
  const cachedPath = resolve(cacheRoot, t.cacheDir, t.path.replaceAll('/', '__'));
  mkdirSync(dirname(cachedPath), { recursive: true });

  let body;
  if (existsSync(cachedPath)) {
    body = readFileSync(cachedPath, 'utf-8');
    console.log(`cache hit: ${t.owner}/${t.repo}/${t.path}`);
  } else {
    try {
      const json = execFileSync(
        'gh', ['api', `repos/${t.owner}/${t.repo}/contents/${t.path}`, '--jq', '.content'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      body = Buffer.from(json.trim(), 'base64').toString('utf-8');
      writeFileSync(cachedPath, body, 'utf-8');
      console.log(`fetched: ${t.owner}/${t.repo}/${t.path}`);
    } catch (e) {
      console.log(`MISS: ${t.owner}/${t.repo}/${t.path} (${e.message?.slice(0, 100)})`);
      continue;
    }
  }

  const lines = body.split(/\r?\n/);
  const headings = lines.filter(l => /^#+\s/.test(l));
  const firstNonEmpty = lines.find(l => l.trim().length > 0 && !l.startsWith('---')) ?? '';
  const ironLaw = lines.find(l => /^[#-*]/.test(l) && /(must|never|always|do not|always)/i.test(l)) ?? '';

  digest.push({
    source: `${t.owner}/${t.repo}`,
    path: t.path,
    cachedAt: cachedPath.replaceAll('\\', '/'),
    bytes: body.length,
    headingCount: headings.length,
    firstHeading: headings[0] ?? '(none)',
    sample: firstNonEmpty.slice(0, 200),
    ironLawCandidate: ironLaw.slice(0, 200)
  });
}

const digestPath = resolve(cacheRoot, '_digest.json');
writeFileSync(digestPath, JSON.stringify({ harvestedAt: new Date().toISOString(), entries: digest }, null, 2) + '\n', 'utf-8');
console.log(`\nDigest written: ${digestPath}`);
console.log(`Files harvested: ${digest.length}/${TARGETS.length}`);
