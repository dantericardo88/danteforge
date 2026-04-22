import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';

export type CIProvider = 'github' | 'gitlab' | 'bitbucket';

export interface CISetupOptions {
  provider?: CIProvider;    // default: 'github'
  outputDir?: string;
  branch?: string;          // default: 'main'
  cwd?: string;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
}

export interface CISetupResult {
  provider: CIProvider;
  writtenPath: string;
  content: string;
}

export function buildGitHubWorkflow(branch: string): string {
  return `name: DanteForge Quality Gate

on:
  push:
    branches: [ "${branch}" ]
  pull_request:
    branches: [ "${branch}" ]

jobs:
  danteforge-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install DanteForge
        run: npm install -g danteforge

      - name: Run DanteForge verify
        run: danteforge verify --release

      - name: Extract PDSE Score
        id: pdse
        run: |
          if [ -f ".danteforge/latest-pdse.json" ]; then
            SCORE=$(node -e "const j=require('.danteforge/latest-pdse.json'); console.log(j.avgScore ?? 'N/A')")
            echo "score=$SCORE" >> $GITHUB_OUTPUT
          else
            echo "score=N/A" >> $GITHUB_OUTPUT
          fi

      - name: Comment PDSE Score on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const score = '\${{ steps.pdse.outputs.score }}';
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: \`## DanteForge Quality Gate\\n\\n**PDSE Score:** \${score}/100\\n\\nRun \\\`danteforge verify\\\` locally to see full artifact quality report.\`
            });
`;
}

export function buildGitLabCI(branch: string): string {
  return `# DanteForge Quality Gate — GitLab CI
stages:
  - quality

danteforge-verify:
  stage: quality
  image: node:20
  only:
    - ${branch}
    - merge_requests
  script:
    - npm ci
    - npm install -g danteforge
    - danteforge verify --release
  artifacts:
    when: always
    paths:
      - .danteforge/
`;
}

export function buildBitbucketPipelines(branch: string): string {
  return `# DanteForge Quality Gate — Bitbucket Pipelines
image: node:20

pipelines:
  branches:
    ${branch}:
      - step:
          name: DanteForge Quality Gate
          caches:
            - node
          script:
            - npm ci
            - npm install -g danteforge
            - danteforge verify --release
  pull-requests:
    '**':
      - step:
          name: DanteForge Quality Gate (PR)
          caches:
            - node
          script:
            - npm ci
            - npm install -g danteforge
            - danteforge verify --release
`;
}

export function resolveWorkflowPath(provider: CIProvider, cwd: string, outputDir?: string): string {
  switch (provider) {
    case 'github':
      return path.join(outputDir ?? path.join(cwd, '.github', 'workflows'), 'danteforge.yml');
    case 'gitlab':
      return path.join(outputDir ?? cwd, '.gitlab-ci.yml');
    case 'bitbucket':
      return path.join(outputDir ?? cwd, 'bitbucket-pipelines.yml');
  }
}

export async function ciSetup(options?: CISetupOptions): Promise<CISetupResult> {
  const provider: CIProvider = options?.provider ?? 'github';
  const branch = options?.branch ?? 'main';
  const cwd = options?.cwd ?? process.cwd();
  const writeFn = options?._writeFile ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));
  const mkdirFn = options?._mkdir ?? ((p: string, opts?: { recursive?: boolean }) => fs.mkdir(p, opts).then(() => undefined));
  const stdoutFn = options?._stdout ?? ((line: string) => logger.success(line));

  let content: string;
  switch (provider) {
    case 'github':
      content = buildGitHubWorkflow(branch);
      break;
    case 'gitlab':
      content = buildGitLabCI(branch);
      break;
    case 'bitbucket':
      content = buildBitbucketPipelines(branch);
      break;
  }

  const writtenPath = resolveWorkflowPath(provider, cwd, options?.outputDir);
  await mkdirFn(path.dirname(writtenPath), { recursive: true });
  await writeFn(writtenPath, content);
  stdoutFn(`CI workflow written to ${writtenPath}`);

  return { provider, writtenPath, content };
}
