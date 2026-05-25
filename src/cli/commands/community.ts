import { logger } from '../../core/logger.js';
import {
  assessCommunityAdoptionReadiness,
  improveCommunityAdoption,
  type CommunityAdoptionReadiness,
} from '../../core/community-adoption.js';

export interface CommunityOptions {
  cwd?: string;
  json?: boolean;
  fix?: boolean;
  failBelow?: number;
  _stdout?: (line: string) => void;
}

export interface CommunityCommandResult {
  readiness: CommunityAdoptionReadiness;
  scorePercent: number;
  passed: boolean;
  improvements: string[];
}

function normalizePercent(readiness: CommunityAdoptionReadiness): number {
  if (readiness.maxScore <= 0) return 0;
  return Math.round((readiness.score / readiness.maxScore) * 100);
}

function renderHuman(result: CommunityCommandResult): string[] {
  const { readiness, scorePercent, passed, improvements } = result;
  const lines = [
    `Community adoption readiness: ${scorePercent}% (${readiness.score}/${readiness.maxScore})`,
    `Gate: ${passed ? 'pass' : 'fail'}`,
  ];

  if (improvements.length > 0) {
    lines.push('', 'Generated:');
    for (const improvement of improvements) lines.push(`  - ${improvement}`);
  }

  const missing = readiness.signals.filter((signal) => signal.status !== 'pass');
  if (missing.length > 0) {
    lines.push('', 'Highest-impact next actions:');
    for (const action of readiness.nextActions) lines.push(`  - ${action}`);
  }

  if (readiness.missingRequired.length > 0) {
    lines.push('', `Missing required: ${readiness.missingRequired.join(', ')}`);
  }

  return lines;
}

export async function community(options: CommunityOptions = {}): Promise<CommunityCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => logger.info(line));

  let improvements: string[] = [];
  let readiness: CommunityAdoptionReadiness;

  if (options.fix) {
    const result = await improveCommunityAdoption({ cwd, generateAdoptionPack: true });
    improvements = result.improvements;
    readiness = result.readiness;
  } else {
    readiness = await assessCommunityAdoptionReadiness(cwd);
  }

  const scorePercent = normalizePercent(readiness);
  const passed = options.failBelow === undefined || scorePercent >= options.failBelow;
  const result: CommunityCommandResult = { readiness, scorePercent, passed, improvements };

  if (options.json) {
    emit(JSON.stringify({
      scorePercent,
      passed,
      score: readiness.score,
      maxScore: readiness.maxScore,
      missingRequired: readiness.missingRequired,
      nextActions: readiness.nextActions,
      improvements,
      signals: readiness.signals,
    }, null, 2));
  } else {
    for (const line of renderHuman(result)) emit(line);
  }

  return result;
}
