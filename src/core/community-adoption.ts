import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import {
  computeCommunityAdoptionScore,
  type CommunityMetrics,
  type CommunityReadinessScore,
} from './harsh-scorer-community.js';
import {
  analyzeCommunityOnboarding,
  type CommunityOnboardingReport,
} from './community-onboarding.js';
import {
  analyzeCommunityEngagement,
} from './community-engagement.js';
import {
  analyzeCommunityProof,
  type CommunityProofReport,
} from './community-proof.js';
import {
  createShowcaseDemo,
  generateAdoptionPack,
  generateExampleProjects,
  generateProjectTemplates,
  improveDocumentation,
} from './community-adoption-generators.js';

export { computeCommunityAdoptionScore, type CommunityMetrics, type CommunityReadinessScore };
export { analyzeCommunityOnboarding, type CommunityOnboardingReport };
export { analyzeCommunityProof, type CommunityProofReport };

export interface CommunityAdoptionOptions {
  cwd?: string;
  generateExamples?: boolean;
  generateTemplates?: boolean;
  generateAdoptionPack?: boolean;
  improveDocs?: boolean;
  createShowcase?: boolean;
}

export interface CommunityReadinessSignal {
  id: string;
  label: string;
  weight: number;
  earned: number;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  required?: boolean;
}

export interface CommunityAdoptionReadiness extends CommunityReadinessScore {
  maxScore: number;
  signals: CommunityReadinessSignal[];
  missingRequired: string[];
  nextActions: string[];
}

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  repository?: unknown;
  bugs?: unknown;
  homepage?: unknown;
  bin?: unknown;
  exports?: unknown;
  files?: unknown;
  keywords?: unknown;
  publishConfig?: unknown;
  private?: unknown;
}

const ADOPTION_ACTIONS: Record<string, string> = {
  'package-metadata': 'Complete package name, version, description, and license metadata.',
  'publishable-package': 'Expose a CLI or package export and make npm publishing explicit.',
  'distribution-proof': 'Declare packaged files and public publish configuration before release.',
  'repository-links': 'Add repository, homepage, and issue tracker links to package.json.',
  'keyword-discovery': 'Add at least three searchable npm keywords.',
  'readme-quickstart': 'Add install and first-run commands to README.md.',
  'contributor-guide': 'Add CONTRIBUTING.md with setup, test, and pull request steps.',
  'community-governance': 'Add community governance docs such as CODE_OF_CONDUCT.md or COMMUNITY.md.',
  'issue-templates': 'Add GitHub issue templates for bugs and feature requests.',
  'security-policy': 'Add SECURITY.md with a private vulnerability reporting path.',
  'release-notes': 'Add CHANGELOG.md or RELEASE.md with release history.',
  examples: 'Add at least one runnable example or showcase walkthrough.',
  'package-manager-coverage': 'Document install and first-run paths for npm/npx and at least one alternate package manager.',
  'copy-paste-onboarding': 'Add fenced shell commands that install, run, and verify the tool.',
  'command-reference': 'Add docs/COMMANDS.md with the commands a new adopter needs first.',
  'troubleshooting-support': 'Add docs/TROUBLESHOOTING.md with doctor, logs, reproduction, and issue guidance.',
  'support-policy': 'Add SUPPORT.md with response expectations and high-quality report guidance.',
  'pull-request-template': 'Add a pull request template with summary and verification checklists.',
  'contributor-labels': 'Add contributor-friendly labels such as good first issue, help wanted, and needs-triage.',
  'discussion-routing': 'Route questions and workflow discussions away from bug reports.',
  'maintainer-ownership': 'Add CODEOWNERS so outside contributors know who reviews each surface.',
  'contributor-recognition': 'Add funding or recognition metadata so contributors see how participation is valued.',
  'community-roadmap': 'Add a public roadmap with current priorities, upcoming work, and how contributors can help.',
  'adoption-evidence-guide': 'Add docs/ADOPTION_EVIDENCE.md with the fields maintainers require for public adoption proof.',
  'public-adopter-proof': 'Record at least one verified public adopter with a proof link, verified date, use case, and outcome.',
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readPackage(cwd: string): Promise<PackageMetadata> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as PackageMetadata;
  } catch {
    return {};
  }
}

function signal(
  id: string,
  label: string,
  weight: number,
  passed: boolean,
  detail: string,
  required = false,
): CommunityReadinessSignal {
  return {
    id,
    label,
    weight,
    earned: passed ? weight : 0,
    status: passed ? 'pass' : 'fail',
    detail,
    required,
  };
}

function hasRepositoryLink(value: unknown): boolean {
  if (typeof value === 'string') return /github\.com|gitlab\.com|bitbucket\.org|https?:\/\//i.test(value);
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url'];
    return typeof url === 'string' && /github\.com|gitlab\.com|bitbucket\.org|https?:\/\//i.test(url);
  }
  return false;
}

function hasIssueUrl(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)['url'] === 'string');
}

function hasPublishSurface(pkg: PackageMetadata): boolean {
  const hasEntrypoint = Boolean(pkg.bin || pkg.exports || (Array.isArray(pkg.files) && pkg.files.length > 0));
  const publishConfig = pkg.publishConfig && typeof pkg.publishConfig === 'object'
    ? pkg.publishConfig as Record<string, unknown>
    : {};
  const isPublic = pkg.private !== true && (publishConfig['access'] === 'public' || !('access' in publishConfig));
  return hasEntrypoint && isPublic;
}

function hasDistributionProof(pkg: PackageMetadata): boolean {
  const files = Array.isArray(pkg.files) ? pkg.files.filter((item) => typeof item === 'string') : [];
  const publishConfig = pkg.publishConfig && typeof pkg.publishConfig === 'object'
    ? pkg.publishConfig as Record<string, unknown>
    : {};
  const declaresRuntimeFiles = files.some((item) => /^(dist|bin|lib|commands|src\/harvested)\b/i.test(item));
  const declaresDocs = files.some((item) => /^README\.md$/i.test(item))
    || files.some((item) => /^LICENSE(?:\.md)?$/i.test(item));
  return pkg.private !== true
    && Boolean(pkg.bin || pkg.exports)
    && declaresRuntimeFiles
    && declaresDocs
    && (publishConfig['access'] === 'public' || !('access' in publishConfig));
}

async function hasIssueTemplates(cwd: string): Promise<boolean> {
  const templateDir = path.join(cwd, '.github', 'ISSUE_TEMPLATE');
  try {
    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && /\.(ya?ml|md)$/i.test(entry.name));
  } catch {
    return false;
  }
}

async function hasExampleSurface(cwd: string): Promise<boolean> {
  for (const dir of ['examples', 'showcase']) {
    try {
      const entries = await fs.readdir(path.join(cwd, dir));
      if (entries.length > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function assessCommunityAdoptionReadiness(cwd: string = process.cwd()): Promise<CommunityAdoptionReadiness> {
  const pkg = await readPackage(cwd);
  const readme = await readText(path.join(cwd, 'README.md'));
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((k) => typeof k === 'string') : [];
  const hasPackageBasics = Boolean(pkg.name && pkg.version && pkg.description && pkg.license);
  const hasRepoLinks = hasRepositoryLink(pkg.repository) && hasIssueUrl(pkg.bugs) && typeof pkg.homepage === 'string';
  const hasReadmeQuickstart = /npm\s+(install|i)|npx\s+/i.test(readme)
    && /(quick\s*start|getting started|first run|--help)/i.test(readme);
  const hasGovernance = await exists(path.join(cwd, 'CODE_OF_CONDUCT.md'))
    || await exists(path.join(cwd, 'COMMUNITY.md'));
  const onboarding = await analyzeCommunityOnboarding(cwd);
  const hasCopyPasteOnboarding = onboarding.installCommands.length > 0
    && onboarding.firstRunCommands.length > 0
    && onboarding.verificationCommands.length > 0
    && onboarding.copyPasteCommandCount >= 3;
  const hasPackageManagerCoverage = onboarding.packageManagers.includes('npm')
    && (onboarding.packageManagers.includes('npx') || onboarding.packageManagers.length >= 2);
  const engagement = await analyzeCommunityEngagement(cwd);
  const proof = await analyzeCommunityProof(cwd);

  const signals: CommunityReadinessSignal[] = [
    signal('package-metadata', 'Package metadata', 15, hasPackageBasics, hasPackageBasics
      ? 'package.json includes name, version, description, and license.'
      : 'package.json is missing basic package metadata.', true),
    signal('publishable-package', 'Publishable package surface', 15, hasPublishSurface(pkg), hasPublishSurface(pkg)
      ? 'package.json exposes a public package entrypoint.'
      : 'package.json does not expose a public package entrypoint.'),
    signal('distribution-proof', 'Release distribution proof', 5, hasDistributionProof(pkg), hasDistributionProof(pkg)
      ? 'package.json declares runtime files and public publishing metadata.'
      : 'package.json does not clearly declare shipped files for public release.'),
    signal('repository-links', 'Repository and support links', 12, hasRepoLinks, hasRepoLinks
      ? 'package.json links repository, homepage, and issue tracker.'
      : 'repository, homepage, or issue tracker link is missing.'),
    signal('keyword-discovery', 'Searchable package keywords', 8, keywords.length >= 3, keywords.length >= 3
      ? `package.json includes ${keywords.length} searchable keywords.`
      : 'package.json needs at least three npm keywords.'),
    signal('readme-quickstart', 'README install and first run', 15, hasReadmeQuickstart, hasReadmeQuickstart
      ? 'README.md includes install and first-run guidance.'
      : 'README.md lacks install or first-run guidance.', true),
    signal('contributor-guide', 'Contributor guide', 10, await exists(path.join(cwd, 'CONTRIBUTING.md')),
      'CONTRIBUTING.md gives contributors a predictable path.', true),
    signal('community-governance', 'Community governance', 5, hasGovernance, hasGovernance
      ? 'Community governance docs set collaboration expectations.'
      : 'Community governance docs are missing.'),
    signal('issue-templates', 'Issue templates', 5, await hasIssueTemplates(cwd),
      'Issue templates help users file actionable bugs and feature requests.'),
    signal('security-policy', 'Security policy', 8, await exists(path.join(cwd, 'SECURITY.md')),
      'SECURITY.md documents vulnerability reporting.'),
    signal('release-notes', 'Release notes', 7,
      await exists(path.join(cwd, 'CHANGELOG.md')) || await exists(path.join(cwd, 'RELEASE.md')),
      'Release notes give evaluators a change history.'),
    signal('examples', 'Runnable examples', 10, await hasExampleSurface(cwd),
      'Examples or showcase assets demonstrate real usage.'),
    signal('package-manager-coverage', 'Package manager coverage', 8, hasPackageManagerCoverage,
      hasPackageManagerCoverage
        ? `Docs cover ${onboarding.packageManagers.join(', ')} adoption paths.`
        : 'Docs need npm plus npx or another package-manager path.'),
    signal('copy-paste-onboarding', 'Copy-paste onboarding', 10, hasCopyPasteOnboarding,
      hasCopyPasteOnboarding
        ? `Docs include ${onboarding.copyPasteCommandCount} runnable onboarding commands.`
        : 'Docs need runnable install, first-run, and verification commands.', true),
    signal('command-reference', 'Command reference', 7, onboarding.hasCommandReference,
      onboarding.hasCommandReference
        ? 'docs/COMMANDS.md gives new adopters a command map.'
        : 'docs/COMMANDS.md is missing or too thin.'),
    signal('troubleshooting-support', 'Troubleshooting support', 7, onboarding.hasTroubleshooting,
      onboarding.hasTroubleshooting
        ? 'Troubleshooting docs explain diagnostics and useful issue details.'
        : 'Troubleshooting docs need doctor, logs, reproduction, and issue guidance.'),
    signal('support-policy', 'Support and triage policy', 8, engagement.supportPolicy,
      engagement.supportPolicy
        ? 'SUPPORT.md sets response expectations and useful report details.'
        : 'Support policy needs triage expectations and report-quality guidance.'),
    signal('pull-request-template', 'Pull request template', 6, engagement.pullRequestTemplate,
      engagement.pullRequestTemplate
        ? 'Pull request template asks for summary and verification evidence.'
        : 'Pull request template is missing summary or verification expectations.'),
    signal('contributor-labels', 'Contributor labels', 5, engagement.contributorLabels,
      engagement.contributorLabels
        ? 'Contributor labels expose good-first-issue and triage paths.'
        : 'Contributor labels for good first issue, help wanted, or triage are missing.'),
    signal('discussion-routing', 'Discussion routing', 4, engagement.discussionRouting,
      engagement.discussionRouting
        ? 'Issue template configuration routes questions to discussions.'
        : 'Question and discussion routing is not documented.'),
    signal('maintainer-ownership', 'Maintainer ownership', 6, engagement.maintainerOwnership,
      engagement.maintainerOwnership
        ? 'CODEOWNERS routes contributor changes to maintainers.'
        : 'CODEOWNERS is missing or does not name maintainers.'),
    signal('contributor-recognition', 'Contributor recognition', 5, engagement.contributorRecognition,
      engagement.contributorRecognition
        ? 'Funding or recognition metadata makes contributor support visible.'
        : 'Funding or contributor recognition metadata is missing.'),
    signal('community-roadmap', 'Community roadmap', 7, engagement.communityRoadmap,
      engagement.communityRoadmap
        ? 'Roadmap docs explain priorities and how contributors can help.'
        : 'Roadmap docs need priorities, upcoming work, and contribution guidance.'),
    signal('adoption-evidence-guide', 'Adoption evidence guide', 6, proof.evidenceGuide,
      proof.evidenceGuide
        ? 'Adoption evidence docs define adopter, proof link, verification date, use case, and outcome fields.'
        : 'Adoption evidence docs need the fields required to verify public usage.'),
    signal('public-adopter-proof', 'Public adopter proof', 12, proof.verifiedAdopterProofs.length > 0,
      proof.verifiedAdopterProofs.length > 0
        ? `${proof.verifiedAdopterProofs.length} verified public adopter proof record(s) found.`
        : 'No verified public adopter proof records were found.'),
  ];

  const maxScore = signals.reduce((sum, item) => sum + item.weight, 0);
  const score = signals.reduce((sum, item) => sum + item.earned, 0);
  const missingRequired = signals
    .filter((item) => item.required && item.status !== 'pass')
    .map((item) => item.id);
  const nextActions = signals
    .filter((item) => item.status !== 'pass')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((item) => ADOPTION_ACTIONS[item.id] ?? item.detail);

  return { score, maxScore, signals, missingRequired, nextActions };
}

export async function improveCommunityAdoption(options: CommunityAdoptionOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  logger.info('Improving community adoption features...');
  const improvements: string[] = [];
  if (options.generateExamples) improvements.push(await generateExampleProjects(cwd));
  if (options.generateTemplates) improvements.push(await generateProjectTemplates(cwd));
  if (options.generateAdoptionPack) improvements.push(await generateAdoptionPack(cwd));
  if (options.improveDocs) improvements.push(await improveDocumentation(cwd));
  if (options.createShowcase) improvements.push(await createShowcaseDemo(cwd));
  const readiness = await assessCommunityAdoptionReadiness(cwd);
  logger.success('Community adoption improvements completed:');
  improvements.forEach((improvement) => logger.info(`  - ${improvement}`));
  return {
    improvements,
    readiness,
    score: Math.min(9.0, Math.round((readiness.score / readiness.maxScore) * 90) / 10),
  };
}
