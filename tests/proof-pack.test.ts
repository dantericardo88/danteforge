import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

const tutorialPath = 'docs/tutorials/first-15-minutes.md';
const publicCaseStudyPath = 'docs/case-studies/public-example.md';
const internalCaseStudyPath = 'docs/case-studies/internal-self-hosting.md';

async function read(path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

function assertProofArtifactShape(content: string, label: string): void {
  assert.match(content, /## Commands/i, `${label} should include a Commands section`);
  assert.match(content, /## Environment/i, `${label} should include an Environment section`);
  assert.match(content, /## Receipts?/i, `${label} should include a Receipts section`);
  assert.match(content, /## Known Limitations/i, `${label} should include a Known Limitations section`);
}

describe('launch proof pack', () => {
  it('ships the tutorial and both case studies', async () => {
    const tutorial = await read(tutorialPath);
    const publicCaseStudy = await read(publicCaseStudyPath);
    const internalCaseStudy = await read(internalCaseStudyPath);

    assert.match(tutorial, /danteforge init/i);
    assert.match(tutorial, /danteforge go/i);
    assert.match(publicCaseStudy, /examples\/todo-app/i);
    assert.match(internalCaseStudy, /DanteCode|DanteAgents/i);
  });

  it('keeps each proof artifact grounded in commands, environment, receipts, and honest limitations', async () => {
    const tutorial = await read(tutorialPath);
    const publicCaseStudy = await read(publicCaseStudyPath);
    const internalCaseStudy = await read(internalCaseStudyPath);

    assertProofArtifactShape(tutorial, tutorialPath);
    assertProofArtifactShape(publicCaseStudy, publicCaseStudyPath);
    assertProofArtifactShape(internalCaseStudy, internalCaseStudyPath);
  });

  it('links the proof pack from the README and release guide', async () => {
    const readme = await read('README.md');
    const releaseGuide = await read('RELEASE.md');

    assert.match(readme, /docs\/tutorials\/first-15-minutes\.md/);
    assert.match(readme, /docs\/case-studies\/public-example\.md/);
    assert.match(readme, /docs\/case-studies\/internal-self-hosting\.md/);
    assert.match(releaseGuide, /docs\/tutorials\/first-15-minutes\.md/);
    assert.match(releaseGuide, /docs\/case-studies\/public-example\.md/);
    assert.match(releaseGuide, /docs\/case-studies\/internal-self-hosting\.md/);
  });
});
