import { CompletionVerdict } from './completion-oracle.js';
import { ResidualGapReport } from './residual-gap-miner.js';

export interface WaveDelta {
  waveId: string;
  startTime: string;
  endTime: string;
  initialVerdict: CompletionVerdict;
  finalVerdict: CompletionVerdict;
  initialGapScore: number;
  finalGapScore: number;
  gapsResolved: number;
  gapsIntroduced: number;
  netProgress: number;
  durationMs: number;
  efficiency: number; // progress per hour
}

export interface ProgressMetrics {
  totalWaves: number;
  totalProgress: number;
  averageEfficiency: number;
  trend: 'improving' | 'stalled' | 'regressing';
  estimatedCompletion: {
    wavesRemaining: number;
    timeRemainingHours: number;
    confidence: number;
  };
}

/**
 * Tracks progress between waves and calculates improvement metrics.
 * Provides evidence-based assessment of whether progress is being made.
 */
export class WaveDeltaTracker {
  private deltas: WaveDelta[] = [];
  private currentWave: Partial<WaveDelta> | null = null;

  startWave(waveId: string, initialVerdict: CompletionVerdict, initialGapScore: number): void {
    this.currentWave = {
      waveId,
      startTime: new Date().toISOString(),
      initialVerdict,
      initialGapScore
    };
  }

  endWave(finalVerdict: CompletionVerdict, finalGapScore: number): WaveDelta | null {
    if (!this.currentWave) return null;

    const delta: WaveDelta = {
      ...this.currentWave,
      endTime: new Date().toISOString(),
      finalVerdict,
      finalGapScore,
      gapsResolved: Math.max(0, this.currentWave.initialGapScore! - finalGapScore),
      gapsIntroduced: Math.max(0, finalGapScore - this.currentWave.initialGapScore!),
      netProgress: this.currentWave.initialGapScore! - finalGapScore,
      durationMs: new Date().getTime() - new Date(this.currentWave.startTime!).getTime(),
      efficiency: 0 // Calculated below
    } as WaveDelta;

    // Calculate efficiency (progress per hour)
    const durationHours = delta.durationMs / (1000 * 60 * 60);
    delta.efficiency = durationHours > 0 ? delta.netProgress / durationHours : 0;

    this.deltas.push(delta);
    this.currentWave = null;

    return delta;
  }

  getProgressMetrics(): ProgressMetrics {
    if (this.deltas.length === 0) {
      return {
        totalWaves: 0,
        totalProgress: 0,
        averageEfficiency: 0,
        trend: 'stalled',
        estimatedCompletion: {
          wavesRemaining: 0,
          timeRemainingHours: 0,
          confidence: 0
        }
      };
    }

    const totalProgress = this.deltas.reduce((sum, d) => sum + d.netProgress, 0);
    const averageEfficiency = this.deltas.reduce((sum, d) => sum + d.efficiency, 0) / this.deltas.length;

    // Calculate trend based on last 3 waves
    const recentDeltas = this.deltas.slice(-3);
    const trend = calculateTrend(recentDeltas);

    // Estimate completion
    const estimatedCompletion = estimateCompletion(this.deltas, totalProgress);

    return {
      totalWaves: this.deltas.length,
      totalProgress,
      averageEfficiency,
      trend,
      estimatedCompletion
    };
  }

  getWaveHistory(): WaveDelta[] {
    return [...this.deltas];
  }

  getRecentEfficiency(): number {
    const recentDeltas = this.deltas.slice(-3);
    if (recentDeltas.length === 0) return 0;

    return recentDeltas.reduce((sum, d) => sum + d.efficiency, 0) / recentDeltas.length;
  }

  shouldContinue(): { continue: boolean; reason: string; confidence: number } {
    const metrics = this.getProgressMetrics();

    // If no waves completed, continue
    if (metrics.totalWaves === 0) {
      return { continue: true, reason: 'no_waves_completed', confidence: 1.0 };
    }

    // If trend is regressing, stop
    if (metrics.trend === 'regressing') {
      return { continue: false, reason: 'regressing_trend_detected', confidence: 0.9 };
    }

    // If stalled for 3+ waves, stop
    if (metrics.trend === 'stalled' && metrics.totalWaves >= 3) {
      return { continue: false, reason: 'stalled_progress', confidence: 0.8 };
    }

    // If estimated completion is unrealistic (>100 hours), stop
    if (metrics.estimatedCompletion.timeRemainingHours > 100) {
      return { continue: false, reason: 'unrealistic_completion_estimate', confidence: 0.7 };
    }

    // Continue if improving or early stages
    return { continue: true, reason: 'progress_detected', confidence: 0.6 };
  }
}

function calculateTrend(recentDeltas: WaveDelta[]): 'improving' | 'stalled' | 'regressing' {
  if (recentDeltas.length < 2) return 'stalled';

  const progressValues = recentDeltas.map(d => d.netProgress);
  const averageProgress = progressValues.reduce((sum, p) => sum + p, 0) / progressValues.length;

  // If average progress is positive and recent wave had progress, improving
  if (averageProgress > 0 && recentDeltas[recentDeltas.length - 1].netProgress > 0) {
    return 'improving';
  }

  // If average progress is near zero, stalled
  if (Math.abs(averageProgress) < 2) {
    return 'stalled';
  }

  // If average progress is negative, regressing
  if (averageProgress < 0) {
    return 'regressing';
  }

  return 'stalled';
}

function estimateCompletion(deltas: WaveDelta[], totalProgressSoFar: number): {
  wavesRemaining: number;
  timeRemainingHours: number;
  confidence: number;
} {
  if (deltas.length === 0) {
    return { wavesRemaining: 0, timeRemainingHours: 0, confidence: 0 };
  }

  // Assume target is 100 (perfect score)
  const targetProgress = 100;
  const remainingProgress = Math.max(0, targetProgress - totalProgressSoFar);

  // Use recent efficiency for estimation
  const recentEfficiency = deltas.slice(-3).reduce((sum, d) => sum + d.efficiency, 0) /
                          Math.max(1, deltas.slice(-3).length);

  if (recentEfficiency <= 0) {
    return { wavesRemaining: 0, timeRemainingHours: 0, confidence: 0 };
  }

  const timeRemainingHours = remainingProgress / recentEfficiency;
  const wavesRemaining = Math.ceil(remainingProgress / Math.max(1, recentEfficiency * 2)); // Assume 2 hours per wave

  // Confidence decreases as estimate increases
  const confidence = Math.max(0.1, Math.min(0.9, 50 / (timeRemainingHours + 1)));

  return { wavesRemaining, timeRemainingHours, confidence };
}