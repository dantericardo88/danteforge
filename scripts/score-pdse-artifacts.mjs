#!/usr/bin/env node
/**
 * Diagnostic: score current PDSE artifacts against section checklists.
 * Shows what's missing for functionality/planningQuality/maintainability signals.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const df = path.join(cwd, '.danteforge');

const CHECKLISTS = {
  CONSTITUTION: ['zero ambiguity', 'local-first', 'atomic commit', 'verify before commit'],
  SPEC:         ['## Feature', '## What', '## User Stor', '## Non-functional', '## Acceptance Criteria'],
  CLARIFY:      ['## Ambiguities', '## Missing Requirements', '## Consistency', '## Clarification'],
  PLAN:         ['## Architecture', '## Implementation', '## Technology', '## Risk', '## Testing Strategy'],
  TASKS:        ['### Phase', 'task'],
};

const CON_KEYWORDS = ['zero ambiguity','local-first','atomic commit','fail-closed','verify','pipeda','audit','deterministic'];
const AMBIGUITY = ['should','might','could','TBD','maybe','probably','somehow','sort of','roughly','approximately','unclear','not sure','to be determined','we will see','at some point','eventually','if possible'];
const FRESHNESS = ['TODO', 'TBD', 'FIXME', 'to be determined', 'figure out later'];
const files = { CONSTITUTION:'CONSTITUTION.md', SPEC:'SPEC.md', CLARIFY:'CLARIFY.md', PLAN:'PLAN.md', TASKS:'TASKS.md' };

for (const [name, file] of Object.entries(files)) {
  let content = '';
  try { content = await fs.readFile(path.join(df, file), 'utf8'); } catch {
    try { content = await fs.readFile(path.join(cwd, file), 'utf8'); } catch { content = ''; }
  }
  const cl = content.toLowerCase();
  const checklist = CHECKLISTS[name] ?? [];
  const missing = checklist.filter(s => !cl.includes(s.toLowerCase()));
  const foundKw = CON_KEYWORDS.filter(k => cl.includes(k.toLowerCase()));
  const missingKw = CON_KEYWORDS.filter(k => !cl.includes(k.toLowerCase()));
  const ambig = AMBIGUITY.filter(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'gi').test(content);
  });
  const fresh = FRESHNESS.filter(m => cl.includes(m.toLowerCase()));

  const completeness = checklist.length > 0 ? Math.round((checklist.length - missing.length) / checklist.length * 20) : 20;
  const conAlign = Math.min(foundKw.length * 3, 20);
  let testability = 20;
  if (name === 'SPEC' && !(/acceptance criteria/i.test(content))) testability = Math.min(testability, 8);
  if (name === 'TASKS') {
    const taskLines = content.split('\n').filter(l => /^[-*]\s/.test(l.trim()));
    const tasksVerify = taskLines.filter(l => /verify|done|acceptance|test|assert/i.test(l));
    testability = taskLines.length > 0 ? Math.round((tasksVerify.length / taskLines.length) * 20) : 20;
  }
  const clarityScore = Math.max(0, 20 - ambig.length);
  const freshScore = Math.max(0, 10 - fresh.length * 2);
  const integration = 10;
  const total = completeness + clarityScore + testability + conAlign + integration + freshScore;

  console.log(`\n${name}: estimated total ≈ ${total}/100`);
  console.log(`  completeness    = ${completeness}/20  ${missing.length > 0 ? 'MISSING: ' + missing.join(' | ') : 'OK'}`);
  console.log(`  conAlignment    = ${conAlign}/20  foundKw=${foundKw.length}/8  missingKw: ${missingKw.slice(0, 4).join(', ')}`);
  console.log(`  clarity         ≈ ${clarityScore}/20  ambig words (${ambig.length}): ${ambig.slice(0, 5).join(', ')}`);
  console.log(`  testability     = ${testability}/20`);
  console.log(`  freshness       = ${freshScore}/10  markers: ${fresh.join(', ')}`);
  console.log(`  chars=${content.length}`);
}
