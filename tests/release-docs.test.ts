import assert from 'node:assert';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';

async function loadPackageVersion(): Promise<string> {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
  return pkg.version;
}

async function loadActiveReadinessGuide(): Promise<{ version: string; path: string; content: string }> {
  const version = await loadPackageVersion();
  const guidePath = `docs/Operational-Readiness-v${version}.md`;
  const content = await fs.readFile(guidePath, 'utf8');
  return { version, path: guidePath, content };
}

describe('release documentation', () => {
  it('keeps live verification out of the default install flow', async () => {
    const readme = await fs.readFile('README.md', 'utf8');

    assert.doesNotMatch(
      readme,
      /npm ci\s+npm run verify:all\s+npm run verify:live\s+npm link/s,
    );
  });

  it('documents the install smoke release gate', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /release:check:install-smoke/);
    assert.match(releaseGuide, /release:check:install-smoke/);
  });

  it('documents the built-cli smoke gate and operational readiness guide', async () => {
    const { path: readinessPath, content: readinessGuide } = await loadActiveReadinessGuide();
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');
    const liveCanaryWorkflow = await fs.readFile('.github/workflows/live-canary.yml', 'utf8');

    assert.match(readme, /check:cli-smoke/);
    assert.match(releaseGuide, /check:cli-smoke/);
    assert.match(readme, new RegExp(readinessPath.replace(/\./g, '\\.')));
    assert.match(releaseGuide, new RegExp(readinessPath.replace(/\./g, '\\.')));
    assert.match(readinessGuide, /Known Outstanding Work/);
    assert.match(readinessGuide, /verify:live/);
    assert.match(readme, /live-canary\.yml/);
    assert.match(releaseGuide, /live-canary\.yml/);
    assert.match(liveCanaryWorkflow, /verify:live/);
  });

  it('keeps the active readiness guide receipt-backed instead of hard-coding green gate claims', async () => {
    const { content: readinessGuide } = await loadActiveReadinessGuide();

    assert.match(readinessGuide, /latest local receipt snapshots/i);
    assert.match(readinessGuide, /\.danteforge\/evidence\/verify\/latest\.json/);
    assert.match(readinessGuide, /\.danteforge\/evidence\/release\/latest\.json/);
    assert.match(readinessGuide, /\.danteforge\/evidence\/live\/latest\.json/);
    assert.match(readinessGuide, /sync:readiness-doc/);
    assert.doesNotMatch(readinessGuide, /npm run typecheck\s*#\s*0 errors/i);
    assert.doesNotMatch(readinessGuide, /npm run release:check\s*#\s*EXIT:0/i);
  });

  it('documents the harvested skills import manifest', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    assert.match(readme, /IMPORT_MANIFEST\.yaml/);
  });

  it('documents the GA release and live verification commands', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /verify:live/);
    assert.match(readme, /release:ga/);
    assert.match(releaseGuide, /verify:live/);
    assert.match(releaseGuide, /release:ga/);
  });

  it('documents the live verification environment contract', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /DANTEFORGE_LIVE_PROVIDERS/);
    assert.match(readme, /OPENAI_API_KEY/);
    assert.match(readme, /ANTHROPIC_API_KEY/);
    assert.match(readme, /GEMINI_API_KEY/);
    assert.match(readme, /XAI_API_KEY/);
    assert.match(readme, /OLLAMA_BASE_URL/);
    assert.match(releaseGuide, /DANTEFORGE_LIVE_PROVIDERS/);
  });

  it('documents standalone assistant setup and shared secret storage', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');
    const standaloneGuide = await fs.readFile('docs/Standalone-Assistant-Setup.md', 'utf8');
    const codexGuide = await fs.readFile('docs/Codex-Install.md', 'utf8');

    assert.match(readme, /Standalone-Assistant-Setup\.md/);
    assert.match(readme, /Codex-Install\.md/);
    assert.match(readme, /~\/\.danteforge\/config\.yaml/);
    assert.match(standaloneGuide, /Codex/);
    assert.match(standaloneGuide, /Claude Code/);
    assert.match(standaloneGuide, /Gemini \/ Antigravity/);
    assert.match(standaloneGuide, /OpenCode/);
    assert.match(standaloneGuide, /Cursor/);
    assert.match(standaloneGuide, /Codex-Install\.md/);
    assert.match(standaloneGuide, /\.codex\/config\.toml/);
    assert.match(standaloneGuide, /\.codex\/AGENTS\.md/);
    assert.match(standaloneGuide, /danteforge setup assistants/);
    assert.match(standaloneGuide, /explicit/i);
    assert.match(standaloneGuide, /danteforge doctor --live/);
    assert.match(releaseGuide, /Standalone-Assistant-Setup\.md/);
    assert.match(releaseGuide, /Codex-Install\.md/);
    assert.match(codexGuide, /~\/\.codex\/commands/);
    assert.match(codexGuide, /danteforge-cli/);
    assert.match(codexGuide, /~\/\.codex\/AGENTS\.md/);
    assert.match(codexGuide, /~\/\.codex\/config\.toml/);
    assert.match(codexGuide, /hosted Codex/i);
  });

  it('documents assistant setup as explicit after package installation and clarifies Codex limits', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const standaloneGuide = await fs.readFile('docs/Standalone-Assistant-Setup.md', 'utf8');
    const codexGuide = await fs.readFile('docs/Codex-Install.md', 'utf8');

    assert.match(readme, /setup assistants --assistants codex/i);
    assert.match(readme, /setup assistants --assistants cursor/i);
    assert.match(readme, /What Codex can do today/i);
    assert.match(readme, /hosted Codex/i);
    assert.match(standaloneGuide, /local Codex/i);
    assert.match(standaloneGuide, /hosted Codex/i);
    assert.match(codexGuide, /npm install -g danteforge/i);
    assert.match(codexGuide, /npm install -g \.\/danteforge-/i);
    assert.match(codexGuide, /npm link/i);
    assert.match(codexGuide, /danteforge doctor/i);
  });

  it('documents ux-refine as openpencil or prompt-driven instead of automatic fallback', async () => {
    const readme = await fs.readFile('README.md', 'utf8');

    assert.match(readme, /ux-refine --openpencil/);
    assert.match(readme, /ux-refine --prompt/);
    assert.doesNotMatch(readme, /danteforge ux-refine\s*$/m);
  });

  it('surfaces the Anti-Stub Doctrine and current operational readiness guide', async () => {
    const { version, path: readinessPath, content: readinessGuide } = await loadActiveReadinessGuide();
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');
    const escapedVersion = version.replace(/\./g, '\\.');
    const escapedPath = readinessPath.replace(/\./g, '\\.');

    assert.match(readme, /Anti-Stub Doctrine/i);
    assert.match(readme, new RegExp(escapedPath));
    assert.doesNotMatch(readme, /Operational-Readiness-v0\.6\.0\.md/);
    assert.match(releaseGuide, new RegExp(escapedPath));
    assert.match(readinessGuide, new RegExp(`v${escapedVersion}`));
    assert.match(readinessGuide, /anti-stub/i);
  });

  it('keeps active release docs, install examples, and tag examples aligned with the current package version', async () => {
    const version = await loadPackageVersion();
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');
    const standaloneGuide = await fs.readFile('docs/Standalone-Assistant-Setup.md', 'utf8');
    const codexGuide = await fs.readFile('docs/Codex-Install.md', 'utf8');
    const escapedVersion = version.replace(/\./g, '\\.');

    assert.match(readme, new RegExp(`DanteForge .*${escapedVersion}`));
    assert.match(readme, new RegExp(`danteforge-${escapedVersion}\\.tgz`));
    assert.match(standaloneGuide, new RegExp(`danteforge-${escapedVersion}\\.tgz`));
    assert.match(codexGuide, new RegExp(`danteforge-${escapedVersion}\\.tgz`));
    assert.match(releaseGuide, new RegExp(`v${escapedVersion}`));
  });

  it('keeps Release-History pointed at the current readiness guide', async () => {
    const version = await loadPackageVersion();
    const releaseHistory = await fs.readFile('docs/Release-History.md', 'utf8');
    const escapedVersion = version.replace(/\./g, '\\.');

    assert.match(releaseHistory, new RegExp(`Current Release Surface \\(v${escapedVersion}\\)`));
    assert.match(releaseHistory, new RegExp(`Operational-Readiness-v${escapedVersion}\\.md`));
  });

  it('marks non-current readiness guides as archived and keeps architecture wording non-brittle', async () => {
    const version = await loadPackageVersion();
    const docsDir = await fs.readdir('docs');
    const readinessDocs = docsDir.filter((name) => /^Operational-Readiness-v.*\.md$/.test(name));
    const nonCurrentDocs = readinessDocs.filter((name) => name !== `Operational-Readiness-v${version}.md`);
    const architecture = await fs.readFile('docs/ARCHITECTURE.md', 'utf8');

    for (const name of nonCurrentDocs) {
      const content = await fs.readFile(`docs/${name}`, 'utf8');
      assert.match(content, /^> \*\*ARCHIVED\*\*/);
      assert.doesNotMatch(content, /current shipped state/i);
      assert.match(content, new RegExp(`Operational-Readiness-v${version.replace(/\./g, '\\.')}\\.md`));
    }

    assert.match(architecture, /dozens of commands/i);
    assert.doesNotMatch(architecture, /37\+ commands/);
    assert.doesNotMatch(architecture, /37\+ command handlers/);
  });

  it('documents browse, qa, retro, and ship in the top-level command docs', async () => {
    const readme = await fs.readFile('README.md', 'utf8');

    assert.match(readme, /`danteforge browse`/);
    assert.match(readme, /`danteforge qa`/);
    assert.match(readme, /`danteforge retro`/);
    assert.match(readme, /`danteforge ship`/);
  });

  it('documents the repo-level anti-stub gate in the release surface', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /check:anti-stub/);
    assert.match(releaseGuide, /check:anti-stub/);
  });

  it('documents plugin manifest checks and the real automated release workflow', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /\.claude-plugin/);
    assert.match(releaseGuide, /check:plugin-manifests/);
    assert.match(releaseGuide, /check:repo-hygiene:strict/);
    assert.match(releaseGuide, /npm audit --omit=dev/);
    assert.doesNotMatch(releaseGuide, /Run the staged strict release gate \(`npm run release:check:strict`\)/);
  });

  it('documents the init command and who DanteForge is for', async () => {
    const readme = await fs.readFile('README.md', 'utf8');

    assert.match(readme, /danteforge init/);
    assert.match(readme, /Who This Is For/);
    assert.match(readme, /danteforge autoresearch/);
    assert.match(readme, /danteforge oss/);
    assert.match(readme, /danteforge harvest/);
    assert.match(readme, /danteforge docs/);
  });

  it('keeps the README launch story singular and honest', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const quickStartHeadings = readme.match(/^## Quick Start\b/gm) ?? [];

    assert.strictEqual(quickStartHeadings.length, 1, 'README should expose exactly one primary Quick Start section');
    assert.doesNotMatch(readme, /Enterprise-ready:\s*SOC 2 compliance/i);
    assert.match(readme, /Stable/i);
    assert.match(readme, /Beta/i);
    assert.match(readme, /Experimental/i);
  });
});
