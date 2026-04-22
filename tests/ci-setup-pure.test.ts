import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  buildGitHubWorkflow,
  buildGitLabCI,
  buildBitbucketPipelines,
  resolveWorkflowPath,
} from '../src/cli/commands/ci-setup.js';

describe('buildGitHubWorkflow', () => {
  it('returns a non-empty YAML string', () => {
    const yml = buildGitHubWorkflow('main');
    assert.ok(yml.length > 0);
  });

  it('embeds the branch name in push trigger', () => {
    const yml = buildGitHubWorkflow('develop');
    assert.ok(yml.includes('develop'));
  });

  it('includes danteforge verify step', () => {
    const yml = buildGitHubWorkflow('main');
    assert.ok(yml.includes('danteforge verify'));
  });

  it('includes Node.js setup', () => {
    const yml = buildGitHubWorkflow('main');
    assert.ok(yml.includes('setup-node') || yml.includes('node-version'));
  });

  it('is deterministic', () => {
    assert.equal(buildGitHubWorkflow('main'), buildGitHubWorkflow('main'));
  });

  it('uses provided branch name not "main" when different branch given', () => {
    const yml = buildGitHubWorkflow('release/v1.0');
    assert.ok(yml.includes('release/v1.0'));
  });
});

describe('buildGitLabCI', () => {
  it('returns a non-empty YAML string', () => {
    const yml = buildGitLabCI('main');
    assert.ok(yml.length > 0);
  });

  it('embeds the branch name', () => {
    const yml = buildGitLabCI('develop');
    assert.ok(yml.includes('develop'));
  });

  it('includes danteforge verify step', () => {
    const yml = buildGitLabCI('main');
    assert.ok(yml.includes('danteforge verify'));
  });

  it('defines stages section', () => {
    const yml = buildGitLabCI('main');
    assert.ok(yml.includes('stages:') || yml.includes('stage:'));
  });

  it('is deterministic', () => {
    assert.equal(buildGitLabCI('main'), buildGitLabCI('main'));
  });
});

describe('buildBitbucketPipelines', () => {
  it('returns a non-empty YAML string', () => {
    const yml = buildBitbucketPipelines('main');
    assert.ok(yml.length > 0);
  });

  it('embeds the branch name', () => {
    const yml = buildBitbucketPipelines('feature-branch');
    assert.ok(yml.includes('feature-branch'));
  });

  it('includes danteforge verify step', () => {
    const yml = buildBitbucketPipelines('main');
    assert.ok(yml.includes('danteforge verify'));
  });

  it('includes pipelines section', () => {
    const yml = buildBitbucketPipelines('main');
    assert.ok(yml.includes('pipelines:'));
  });

  it('is deterministic', () => {
    assert.equal(buildBitbucketPipelines('main'), buildBitbucketPipelines('main'));
  });
});

describe('resolveWorkflowPath', () => {
  const cwd = '/projects/my-app';

  it('returns github workflow path with .github/workflows dir', () => {
    const p = resolveWorkflowPath('github', cwd);
    assert.ok(p.includes('.github'));
    assert.ok(p.includes('workflows'));
    assert.ok(p.endsWith('danteforge.yml'));
  });

  it('returns gitlab ci file at root', () => {
    const p = resolveWorkflowPath('gitlab', cwd);
    assert.ok(p.endsWith('.gitlab-ci.yml'));
  });

  it('returns bitbucket pipelines file', () => {
    const p = resolveWorkflowPath('bitbucket', cwd);
    assert.ok(p.endsWith('bitbucket-pipelines.yml'));
  });

  it('uses outputDir when provided for github (does not use default .github/workflows)', () => {
    const custom = path.join(cwd, 'custom-output');
    const defaultP = resolveWorkflowPath('github', cwd);
    const customP = resolveWorkflowPath('github', cwd, custom);
    assert.notEqual(customP, defaultP);
    assert.ok(customP.endsWith('danteforge.yml'));
  });

  it('uses outputDir when provided for gitlab (does not use cwd root)', () => {
    const custom = path.join(cwd, 'custom-output');
    const customP = resolveWorkflowPath('gitlab', cwd, custom);
    assert.ok(customP.includes('custom-output'));
    assert.ok(customP.endsWith('.gitlab-ci.yml'));
  });

  it('uses outputDir when provided for bitbucket', () => {
    const custom = path.join(cwd, 'custom-output');
    const customP = resolveWorkflowPath('bitbucket', cwd, custom);
    assert.ok(customP.includes('custom-output'));
    assert.ok(customP.endsWith('bitbucket-pipelines.yml'));
  });
});
