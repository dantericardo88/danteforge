export type ConvergenceTrendStatus =
  | 'improving'
  | 'regressing'
  | 'stalled'
  | 'oscillating'
  | 'insufficient';

export interface ConvergenceTrendPoint {
  score: number;
  ts: string;
}

export interface ConvergenceTrendAnalysis {
  status: ConvergenceTrendStatus;
  count: number;
  delta: number;
  directionChanges: number;
  drawdown: number;
}

export interface ConvergenceTrendOptions {
  trendThreshold?: number;
  oscillationDrawdownThreshold?: number;
  oscillationDirectionChanges?: number;
}

const DEFAULT_TREND_THRESHOLD = 0.05;
const DEFAULT_OSCILLATION_DRAWDOWN_THRESHOLD = 0.2;
const DEFAULT_OSCILLATION_DIRECTION_CHANGES = 2;

export function analyzeConvergenceTrend(
  points: ConvergenceTrendPoint[],
  options: ConvergenceTrendOptions = {},
): ConvergenceTrendAnalysis {
  const trendThreshold = options.trendThreshold ?? DEFAULT_TREND_THRESHOLD;
  const oscillationDrawdownThreshold =
    options.oscillationDrawdownThreshold ?? DEFAULT_OSCILLATION_DRAWDOWN_THRESHOLD;
  const oscillationDirectionChanges =
    options.oscillationDirectionChanges ?? DEFAULT_OSCILLATION_DIRECTION_CHANGES;

  if (points.length < 2) {
    return {
      status: 'insufficient',
      count: points.length,
      delta: 0,
      directionChanges: 0,
      drawdown: 0,
    };
  }

  const first = points[0]!.score;
  const last = points[points.length - 1]!.score;
  const delta = last - first;
  let directionChanges = 0;
  let lastDirection = 0;
  let peak = first;

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!.score;
    const current = points[i]!.score;
    peak = Math.max(peak, current);
    const stepDelta = current - previous;
    const direction = Math.abs(stepDelta) >= trendThreshold ? Math.sign(stepDelta) : 0;
    if (direction !== 0) {
      if (lastDirection !== 0 && direction !== lastDirection) directionChanges++;
      lastDirection = direction;
    }
  }

  const drawdown = peak - last;
  if (
    directionChanges >= oscillationDirectionChanges &&
    drawdown >= oscillationDrawdownThreshold
  ) {
    return { status: 'oscillating', count: points.length, delta, directionChanges, drawdown };
  }

  if (delta > trendThreshold) {
    return { status: 'improving', count: points.length, delta, directionChanges, drawdown };
  }

  if (delta < -trendThreshold) {
    return { status: 'regressing', count: points.length, delta, directionChanges, drawdown };
  }

  return { status: 'stalled', count: points.length, delta, directionChanges, drawdown };
}
