// ModelProfileEngine — accumulates verification data into per-model behavioral profiles.
// Called after every DanteForge verification run to build statistical maps of model behavior.
// Profiles are stored in .danteforge/model-profiles/ and are project-scoped.

import fs from 'fs/promises';
import path from 'path';
import {
  type ModelProfile,
  type CategoryStats,
  type WeaknessPattern,
  type StrengthPattern,
  type CompensationRule,
  classifyTask,
  generateCompensation,
  createEmptyProfile,
  computeTrend,
} from './model-profile.js';

const PROFILE_DIR_NAME = path.join('.danteforge', 'model-profiles');
const MAX_RECENT_SCORES = 10;
const PATTERN_ANALYSIS_INTERVAL = 20;

export interface RecordResultInput {
  modelKey: string;
  providerId: string;
  modelId: string;
  taskDescription: string;
  taskCategories: string[];
  pdseScore: number;
  passed: boolean;
  antiStubViolations: number;
  tokensUsed: number;
  retriesNeeded: number;
  gaslightFindings?: string[];
  sevenLevelsRootCause?: {
    level: number;
    domain: string;
    finding: string;
  };
}

export interface PatternAnalysis {
  newWeaknesses: WeaknessPattern[];
  newStrengths: StrengthPattern[];
  autoCompensations: CompensationRule[];
}

export interface ModelRanking {
  modelKey: string;
  predictedPdse: number;
  confidence: number;
  compensations: string[];
  reasoning: string;
}

/**
 * Engine that accumulates verification data into model profiles.
 * Called after every DanteForge verification run.
 */
export class ModelProfileEngine {
  private profiles: Map<string, ModelProfile> = new Map();
  private readonly profileDir: string;

  constructor(projectRoot: string) {
    this.profileDir = path.join(projectRoot, PROFILE_DIR_NAME);
  }

  /**
   * Record a verification result for a model.
   * Updates category stats, aggregate metrics, and triggers pattern analysis every N tasks.
   */
  async recordResult(result: RecordResultInput): Promise<void> {
    let profile = await this.getOrCreateProfile(result.providerId, result.modelId);
    const timestamp = new Date().toISOString();

    for (const category of result.taskCategories) {
      profile = updateCategoryStats(profile, category, result, timestamp);
    }

    profile = updateAggregate(profile, result);
    profile.updatedAt = timestamp;
    profile.totalTasks++;

    if (profile.totalTasks % PATTERN_ANALYSIS_INTERVAL === 0) {
      const analysis = await this.runPatternAnalysis(profile);
      profile.weaknesses = [...profile.weaknesses, ...analysis.newWeaknesses];
      profile.strengths = [...profile.strengths, ...analysis.newStrengths];
      profile.compensations = [...profile.compensations, ...analysis.autoCompensations];
    }

    if (result.sevenLevelsRootCause && result.sevenLevelsRootCause.level >= 3) {
      profile = applySevenLevelsFindings(profile, result, timestamp);
    }

    this.profiles.set(result.modelKey, profile);
    await this.saveProfile(profile);
  }

  /**
   * Get the profile for a specific model (from cache or disk).
   */
  async getProfile(modelKey: string): Promise<ModelProfile | null> {
    if (this.profiles.has(modelKey)) {
      return this.profiles.get(modelKey)!;
    }
    const loaded = await this.loadProfile(modelKey);
    if (loaded) this.profiles.set(modelKey, loaded);
    return loaded;
  }

  /**
   * Get all profiles stored on disk.
   */
  async getAllProfiles(): Promise<ModelProfile[]> {
    const results: ModelProfile[] = [];
    let entries: string[];
    try {
      const dirEntries = await fs.readdir(this.profileDir);
      entries = dirEntries.filter(e => e.endsWith('.json'));
    } catch {
      return [];
    }

    for (const entry of entries) {
      try {
        const raw = await fs.readFile(path.join(this.profileDir, entry), 'utf8');
        const profile = JSON.parse(raw) as ModelProfile;
        this.profiles.set(profile.modelKey, profile);
        results.push(profile);
      } catch {
        // Skip malformed profiles
      }
    }

    return results;
  }

  /**
   * Rank available models by predicted PDSE for a task.
   * Returns empty array when no profile data is available (no guessing).
   */
  async rankModelsForTask(
    taskDescription: string,
    availableModels: string[],
  ): Promise<ModelRanking[]> {
    const categories = classifyTask(taskDescription);
    const rankings: ModelRanking[] = [];

    for (const modelKey of availableModels) {
      const profile = await this.getProfile(modelKey);
      if (!profile || profile.totalTasks === 0) continue;

      const categoryScores: number[] = [];
      let totalTaskCount = 0;

      for (const cat of categories) {
        const stats = profile.categories[cat];
        if (stats && stats.taskCount > 0) {
          categoryScores.push(stats.averagePdse);
          totalTaskCount += stats.taskCount;
        }
      }

      if (categoryScores.length === 0) {
        if (profile.aggregate.averagePdse > 0 && profile.totalTasks >= 5) {
          categoryScores.push(profile.aggregate.averagePdse);
          totalTaskCount = profile.totalTasks;
        } else {
          continue;
        }
      }

      const predictedPdse = categoryScores.reduce((s, v) => s + v, 0) / categoryScores.length;
      const confidence = Math.min(1, totalTaskCount / 20);
      const compensations = this.getCompensationsSync(profile, categories);

      rankings.push({
        modelKey,
        predictedPdse,
        confidence,
        compensations,
        reasoning: buildReasoning(profile, categories, predictedPdse),
      });
    }

    rankings.sort((a, b) => b.predictedPdse - a.predictedPdse || b.confidence - a.confidence);
    return rankings;
  }

  /**
   * Get compensating instructions for a model on specific task categories.
   */
  async getCompensations(modelKey: string, taskCategories: string[]): Promise<string[]> {
    const profile = await this.getProfile(modelKey);
    if (!profile) return [];
    return this.getCompensationsSync(profile, taskCategories);
  }

  /**
   * Analyze profiles to detect new weakness/strength patterns.
   */
  async analyzePatterns(modelKey: string): Promise<PatternAnalysis> {
    const profile = await this.getProfile(modelKey);
    if (!profile) return { newWeaknesses: [], newStrengths: [], autoCompensations: [] };
    return this.runPatternAnalysis(profile);
  }

  /**
   * Generate a human-readable profile report in Markdown.
   */
  async generateReport(modelKey: string): Promise<string> {
    const profile = await this.getProfile(modelKey);
    if (!profile) return `No profile found for model: ${modelKey}`;

    const lines: string[] = [];
    lines.push(`# Model Profile: ${profile.modelKey}`);
    lines.push('');
    lines.push(`**Provider:** ${profile.providerId} | **Model:** ${profile.modelId}`);
    lines.push(`**Total Tasks:** ${profile.totalTasks} | **Created:** ${profile.createdAt.slice(0, 10)} | **Updated:** ${profile.updatedAt.slice(0, 10)}`);
    lines.push('');

    lines.push('## Aggregate Performance');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Average PDSE | ${profile.aggregate.averagePdse.toFixed(1)} |`);
    lines.push(`| First-Pass Success Rate | ${(profile.aggregate.firstPassSuccessRate * 100).toFixed(1)}% |`);
    lines.push(`| Average Retries (when failing) | ${profile.aggregate.averageRetriesNeeded.toFixed(2)} |`);
    lines.push(`| Average Tokens per Task | ${Math.round(profile.aggregate.averageTokensPerTask)} |`);
    lines.push(`| Stub Violation Rate | ${(profile.aggregate.stubViolationRate * 100).toFixed(1)}% |`);
    lines.push('');

    const categoryEntries = Object.entries(profile.categories).sort(
      ([, a], [, b]) => b.averagePdse - a.averagePdse,
    );

    if (categoryEntries.length > 0) {
      lines.push('## Category Performance');
      lines.push('');
      lines.push('| Category | Tasks | Avg PDSE | First-Pass | Trend |');
      lines.push('|----------|-------|----------|------------|-------|');
      for (const [cat, stats] of categoryEntries) {
        lines.push(
          `| ${cat} | ${stats.taskCount} | ${stats.averagePdse.toFixed(1)} | ${(stats.firstPassSuccessRate * 100).toFixed(0)}% | ${stats.trend} |`,
        );
      }
      lines.push('');
    }

    if (profile.strengths.length > 0) {
      lines.push('## Strengths');
      lines.push('');
      for (const s of profile.strengths) {
        lines.push(`- **${s.category}**: ${s.description} (avg PDSE ${s.averagePdse.toFixed(1)} over ${s.taskCount} tasks)`);
      }
      lines.push('');
    }

    if (profile.weaknesses.length > 0) {
      lines.push('## Weaknesses');
      lines.push('');
      for (const w of profile.weaknesses) {
        const compensated = w.compensated ? ' ✓ compensated' : '';
        lines.push(`- **[${w.severity.toUpperCase()}] ${w.category}**: ${w.description} (seen ${w.occurrenceCount}x)${compensated}`);
        if (w.rootCause) lines.push(`  - Root cause: ${w.rootCause}`);
      }
      lines.push('');
    }

    if (profile.compensations.length > 0) {
      lines.push('## Active Compensations');
      lines.push('');
      for (const c of profile.compensations) {
        const impact = c.pdseImpact !== undefined ? ` (+${c.pdseImpact.toFixed(1)} PDSE)` : '';
        lines.push(`- **${c.appliesTo.join(', ')}** [${c.source}]${impact}: ${c.instruction}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Private Methods ──────────────────────────────────────────────────────────

  private async getOrCreateProfile(providerId: string, modelId: string): Promise<ModelProfile> {
    const modelKey = `${providerId}:${modelId}`;
    const existing = await this.getProfile(modelKey);
    if (existing) return existing;
    return createEmptyProfile(providerId, modelId);
  }

  private getCompensationsSync(profile: ModelProfile, taskCategories: string[]): string[] {
    return profile.compensations
      .filter(c => c.appliesTo.some(cat => taskCategories.includes(cat)))
      .map(c => c.instruction);
  }

  private async runPatternAnalysis(profile: ModelProfile): Promise<PatternAnalysis> {
    if (profile.totalTasks < PATTERN_ANALYSIS_INTERVAL) {
      return { newWeaknesses: [], newStrengths: [], autoCompensations: [] };
    }

    const newWeaknesses: WeaknessPattern[] = [];
    const newStrengths: StrengthPattern[] = [];
    const now = new Date().toISOString();

    for (const [category, stats] of Object.entries(profile.categories)) {
      if (stats.taskCount < 5) continue;

      const isWeak = stats.averagePdse < profile.aggregate.averagePdse - 10;
      const alreadyWeak = profile.weaknesses.some(w => w.category === category);

      if (isWeak && !alreadyWeak) {
        const severity = stats.averagePdse < 70 ? 'high' : stats.averagePdse < 80 ? 'medium' : 'low';
        const firstSeen = stats.recentScores[0]?.timestamp ?? now;
        const lastSeen = stats.recentScores[stats.recentScores.length - 1]?.timestamp ?? now;

        newWeaknesses.push({
          id: `w_${profile.modelKey.replace(':', '_')}_${category}_${Date.now()}`,
          description: `Below-average performance on ${category} tasks (avg PDSE: ${stats.averagePdse.toFixed(1)} vs overall ${profile.aggregate.averagePdse.toFixed(1)})`,
          category,
          severity,
          occurrenceCount: stats.taskCount,
          firstSeen,
          lastSeen,
          compensated: false,
        });
      }

      const isStrong = stats.averagePdse > profile.aggregate.averagePdse + 5;
      const alreadyStrong = profile.strengths.some(s => s.category === category);

      if (isStrong && !alreadyStrong) {
        newStrengths.push({
          id: `s_${profile.modelKey.replace(':', '_')}_${category}_${Date.now()}`,
          description: `Excellent performance on ${category} tasks (avg PDSE: ${stats.averagePdse.toFixed(1)})`,
          category,
          averagePdse: stats.averagePdse,
          taskCount: stats.taskCount,
        });
      }
    }

    const autoCompensations = newWeaknesses.map(w => {
      const comp = generateCompensation(w);
      w.compensated = true;
      return comp;
    });

    return { newWeaknesses, newStrengths, autoCompensations };
  }

  private async saveProfile(profile: ModelProfile): Promise<void> {
    await fs.mkdir(this.profileDir, { recursive: true });
    const filename = profileFilename(profile.providerId, profile.modelId);
    const filePath = path.join(this.profileDir, filename);
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(profile, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  private async loadProfile(modelKey: string): Promise<ModelProfile | null> {
    const [providerId, ...modelParts] = modelKey.split(':');
    if (!providerId || modelParts.length === 0) return null;
    const modelId = modelParts.join(':');
    const filePath = path.join(this.profileDir, profileFilename(providerId, modelId));
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as ModelProfile;
    } catch {
      return null;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function profileFilename(providerId: string, modelId: string): string {
  const safeName = `${providerId}_${modelId}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `${safeName}.json`;
}

function updateCategoryStats(
  profile: ModelProfile,
  category: string,
  result: RecordResultInput,
  timestamp: string,
): ModelProfile {
  const existing: CategoryStats = profile.categories[category] ?? {
    category,
    taskCount: 0,
    averagePdse: 0,
    minPdse: Infinity,
    maxPdse: -Infinity,
    firstPassSuccessRate: 0,
    averageRetries: 0,
    averageTokens: 0,
    stubViolationRate: 0,
    trend: 'stable',
    recentScores: [],
  };

  const n = existing.taskCount + 1;
  const avgPdse = rollingAvg(existing.averagePdse, existing.taskCount, result.pdseScore);
  const firstPassRate = rollingAvg(
    existing.firstPassSuccessRate,
    existing.taskCount,
    result.retriesNeeded === 0 ? 1 : 0,
  );
  const avgRetries = rollingAvg(existing.averageRetries, existing.taskCount, result.retriesNeeded);
  const avgTokens = rollingAvg(existing.averageTokens, existing.taskCount, result.tokensUsed);
  const stubRate = rollingAvg(
    existing.stubViolationRate,
    existing.taskCount,
    result.antiStubViolations > 0 ? 1 : 0,
  );

  const recentScores = [
    ...existing.recentScores,
    { timestamp, pdse: result.pdseScore },
  ].slice(-MAX_RECENT_SCORES);

  const updated: CategoryStats = {
    category,
    taskCount: n,
    averagePdse: avgPdse,
    minPdse: Math.min(existing.minPdse === Infinity ? result.pdseScore : existing.minPdse, result.pdseScore),
    maxPdse: Math.max(existing.maxPdse === -Infinity ? result.pdseScore : existing.maxPdse, result.pdseScore),
    firstPassSuccessRate: firstPassRate,
    averageRetries: avgRetries,
    averageTokens: avgTokens,
    stubViolationRate: stubRate,
    trend: computeTrend(recentScores),
    recentScores,
  };

  return {
    ...profile,
    categories: {
      ...profile.categories,
      [category]: updated,
    },
  };
}

function updateAggregate(profile: ModelProfile, result: RecordResultInput): ModelProfile {
  const n = profile.totalTasks;
  return {
    ...profile,
    aggregate: {
      averagePdse: rollingAvg(profile.aggregate.averagePdse, n, result.pdseScore),
      firstPassSuccessRate: rollingAvg(
        profile.aggregate.firstPassSuccessRate,
        n,
        result.retriesNeeded === 0 ? 1 : 0,
      ),
      averageRetriesNeeded: rollingAvg(profile.aggregate.averageRetriesNeeded, n, result.retriesNeeded),
      averageTokensPerTask: rollingAvg(profile.aggregate.averageTokensPerTask, n, result.tokensUsed),
      stubViolationRate: rollingAvg(
        profile.aggregate.stubViolationRate,
        n,
        result.antiStubViolations > 0 ? 1 : 0,
      ),
    },
  };
}

function applySevenLevelsFindings(
  profile: ModelProfile,
  result: RecordResultInput,
  timestamp: string,
): ModelProfile {
  if (!result.sevenLevelsRootCause) return profile;
  const { finding, domain } = result.sevenLevelsRootCause;
  const matchingCategory = result.taskCategories[0] ?? domain;

  const existingWeak = profile.weaknesses.find(
    w => w.category === matchingCategory && w.rootCause === finding,
  );

  if (existingWeak) {
    const updated = profile.weaknesses.map(w =>
      w === existingWeak
        ? { ...w, occurrenceCount: w.occurrenceCount + 1, lastSeen: timestamp }
        : w,
    );
    return { ...profile, weaknesses: updated };
  }

  const newWeakness: WeaknessPattern = {
    id: `w7l_${profile.modelKey.replace(':', '_')}_${matchingCategory}_${Date.now()}`,
    description: `7 Levels Deep finding (Level ${result.sevenLevelsRootCause.level}): ${finding}`,
    category: matchingCategory,
    severity: 'medium',
    occurrenceCount: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
    rootCause: finding,
    compensated: false,
  };

  const comp = generateCompensation(newWeakness);
  newWeakness.compensated = true;

  return {
    ...profile,
    weaknesses: [...profile.weaknesses, newWeakness],
    compensations: [...profile.compensations, comp],
  };
}

function buildReasoning(profile: ModelProfile, categories: string[], predictedPdse: number): string {
  const catNames = categories.join(', ');
  const dataPoints = categories
    .map(c => profile.categories[c])
    .filter(Boolean)
    .map(s => `${s!.category}: ${s!.averagePdse.toFixed(1)} (${s!.taskCount} tasks)`);

  if (dataPoints.length > 0) {
    return `Predicted ${predictedPdse.toFixed(1)} PDSE for [${catNames}] based on: ${dataPoints.join('; ')}`;
  }
  return `Predicted ${predictedPdse.toFixed(1)} PDSE from aggregate (${profile.totalTasks} total tasks) — no category-specific data for [${catNames}]`;
}

function rollingAvg(currentAvg: number, currentCount: number, newValue: number): number {
  if (currentCount === 0) return newValue;
  return (currentAvg * currentCount + newValue) / (currentCount + 1);
}
