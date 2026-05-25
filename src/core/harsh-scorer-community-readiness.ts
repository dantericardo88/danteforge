import path from 'path';

import { assessCommunityAdoptionReadiness } from './community-adoption.js';
import {
  fetchCommunityMetrics,
  type CommunityMetrics,
  type CommunityReadinessScore,
} from './harsh-scorer-community.js';

interface CommunityScorerOptions {
  _fetchCommunity?: (packageName: string, repoSlug: string) => Promise<CommunityMetrics>;
  _assessCommunityReadiness?: (cwd: string) => Promise<CommunityReadinessScore>;
}

export async function fetchCommunityData(
  cwd: string,
  options: CommunityScorerOptions,
  readFileFn: (p: string) => Promise<string>,
): Promise<CommunityMetrics> {
  try {
    const pkgRaw = await readFileFn(path.join(cwd, 'package.json'));
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const packageName = typeof pkg['name'] === 'string' ? pkg['name'] : '';
    const repoUrl = typeof pkg['repository'] === 'string'
      ? pkg['repository']
      : typeof (pkg['repository'] as Record<string, unknown>)?.['url'] === 'string'
        ? (pkg['repository'] as Record<string, unknown>)['url'] as string
        : '';
    const repoSlug = repoUrl.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    if (!packageName) return {};
    const fetchFn = options._fetchCommunity
      ? (pn: string, rs: string) => options._fetchCommunity!(pn, rs)
      : (pn: string, rs: string) => fetchCommunityMetrics(pn, rs);
    return await fetchFn(packageName, repoSlug).catch(() => ({}));
  } catch {
    return {};
  }
}

export async function assessCommunityReadiness(
  cwd: string,
  options: CommunityScorerOptions,
): Promise<CommunityReadinessScore | undefined> {
  const assessFn = options._assessCommunityReadiness ?? assessCommunityAdoptionReadiness;
  return await assessFn(cwd).catch(() => undefined);
}
