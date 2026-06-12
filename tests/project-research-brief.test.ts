// project-research-brief.test.ts — the anti-wrong-identity regression.
//
// council-universe research + proposal extraction used to hardcode DanteForge's identity, so
// running them on a fleet repo (DanteCode / DanteAgents / DanteSecurity) researched competitors
// for the WRONG product. These tests pin: identity resolves from the TARGET repo's own artifacts,
// DanteForge keeps its rich blurb only on a name match, the fallback never invents a domain, and
// the research packet carries the resolved identity instead of the old hardcoded one.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectBrief, extractReadmeExcerpt } from '../src/matrix/engines/project-research-brief.js';
import { makeUniversePacket, type UniverseTarget } from '../src/matrix/engines/council-universe-runner.js';

const ROOT = path.join('X:\\tmp', `research-brief-${process.pid}`);
let n = 0;
async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = path.join(ROOT, `repo-${n++}`);
  await fs.mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  }
  return dir;
}

before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('resolveProjectBrief — identity from the TARGET repo, never assumed', () => {
  test('project-intent.json (detect artifact) wins when it AGREES with the manifest, carrying goal + categories', async () => {
    const dir = await makeRepo({
      '.danteforge/matrix-orchestration/project-intent.json': JSON.stringify({
        projectName: 'acme-scanner', projectType: 'security_tool',
        goal: 'Scan container images for CVEs before deploy.',
        competitiveCategoryBoundary: { direct: ['container security scanners'] },
      }),
      'package.json': JSON.stringify({ name: 'acme-scanner', description: 'container CVE scanner' }),
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'intent');
    assert.equal(brief.projectName, 'acme-scanner');
    const ctx = brief.contextLines.join('\n');
    assert.match(ctx, /Scan container images for CVEs/);
    assert.match(ctx, /container security scanners/);
    assert.doesNotMatch(ctx, /DanteForge/);
  });

  test('intent wins when there is NO manifest to cross-check against', async () => {
    const dir = await makeRepo({
      '.danteforge/matrix-orchestration/project-intent.json': JSON.stringify({
        projectName: 'lone-intent', projectType: 'cli_tool', goal: 'A repo with no manifest at all.',
      }),
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'intent');
    assert.equal(brief.projectName, 'lone-intent');
  });

  test('CH-016 regression: a STALE intent that contradicts the manifest LOSES to the manifest', async () => {
    // The live failure: a month-old cold-test fixture named "Quill" (a toy TODO-CLI) survived in
    // project-intent.json and aimed real ladder research at the wrong competitive landscape.
    const dir = await makeRepo({
      '.danteforge/matrix-orchestration/project-intent.json': JSON.stringify({
        projectName: 'Quill', projectType: 'cli_tool',
        goal: 'A simple command-line TODO list manager.',
      }),
      'package.json': JSON.stringify({ name: 'dantesecurity', description: 'USB/endpoint security agent' }),
      'README.md': '# DanteSecurity\n\nA Rust endpoint agent that blocks unauthorized USB devices.\n',
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'manifest', 'stale intent must not override the repo manifest');
    assert.equal(brief.projectName, 'dantesecurity');
    const ctx = brief.contextLines.join('\n');
    assert.doesNotMatch(ctx, /TODO list manager/);
    assert.match(ctx, /USB\/endpoint security agent/);
  });

  test('package.json + README excerpt when no intent artifact exists', async () => {
    const dir = await makeRepo({
      'package.json': JSON.stringify({ name: 'dantesecurity', description: 'USB/endpoint security agent' }),
      'README.md': '# DanteSecurity\n\n![badge](x)\n\nA Rust endpoint agent that blocks unauthorized USB devices in real time.\nIt ships as a system service.\n\nMore prose here.',
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'manifest');
    assert.equal(brief.projectName, 'dantesecurity');
    const ctx = brief.contextLines.join('\n');
    assert.match(ctx, /USB\/endpoint security agent/);
    assert.match(ctx, /blocks unauthorized USB devices/);
    assert.doesNotMatch(ctx, /AI coding assistant optimizer/);
  });

  test('Cargo.toml identity for a Rust repo with no package.json', async () => {
    const dir = await makeRepo({
      'Cargo.toml': '[package]\nname = "endpoint-guard"\nversion = "0.3.0"\ndescription = "Kernel-level USB device firewall"\n',
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'manifest');
    assert.equal(brief.projectName, 'endpoint-guard');
    assert.match(brief.contextLines.join('\n'), /USB device firewall/);
  });

  test('the DanteForge name keeps the rich hand-authored meta-layer blurb', async () => {
    const dir = await makeRepo({
      'package.json': JSON.stringify({ name: 'danteforge', description: 'whatever' }),
    });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'danteforge');
    assert.match(brief.contextLines.join('\n'), /provider-agnostic AI coding assistant optimizer/);
  });

  test('bare repo → honest fallback that instructs reading the repo, inventing nothing', async () => {
    const dir = await makeRepo({ 'main.c': 'int main(){return 0;}' });
    const brief = await resolveProjectBrief(dir);
    assert.equal(brief.source, 'fallback');
    const ctx = brief.contextLines.join('\n');
    assert.match(ctx, /No machine-readable project description/);
    assert.match(ctx, /READ the README/i);
    assert.doesNotMatch(ctx, /AI coding/);
  });
});

describe('extractReadmeExcerpt — first real prose paragraph only', () => {
  test('skips headings, badges, images, HTML and stops at the blank line', () => {
    const md = '# Title\n\n[![ci](b)](u)\n\n<p align="center">x</p>\n\nThe real description line one.\nLine two of it.\n\nSecond paragraph ignored.';
    assert.equal(extractReadmeExcerpt(md), 'The real description line one. Line two of it.');
  });
  test('returns null when there is no prose', () => {
    assert.equal(extractReadmeExcerpt('# Only\n## Headings\n'), null);
  });
});

describe('makeUniversePacket — the research objective carries the RESOLVED identity', () => {
  const target: UniverseTarget = { dimId: 'security', dimName: 'Security', currentScore: 4.0, targetScore: 9.0 };

  test('a non-DanteForge brief produces a prompt about THAT product, with no DanteForge leakage', () => {
    const packet = makeUniversePacket(target, 'codex', {
      projectName: 'endpoint-guard', source: 'manifest',
      contextLines: ['**endpoint-guard** is the product under research — Kernel-level USB device firewall.'],
    }) as unknown as { objective: string };
    assert.match(packet.objective, /for \*\*endpoint-guard\*\*/);
    assert.match(packet.objective, /USB device firewall/);
    assert.doesNotMatch(packet.objective, /DanteForge/);
  });

  test('the DanteForge brief keeps the meta-layer research guidance', () => {
    const packet = makeUniversePacket(target, 'codex', {
      projectName: 'DanteForge', source: 'danteforge',
      contextLines: ['DanteForge is a **provider-agnostic AI coding assistant optimizer and skillset**.'],
    }) as unknown as { objective: string };
    assert.match(packet.objective, /for \*\*DanteForge\*\*/);
    assert.match(packet.objective, /provider-agnostic AI coding assistant optimizer/);
  });
});
