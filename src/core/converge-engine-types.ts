import type { ScoringDimension } from './harsh-scorer.js';

export interface ConvergeOptions {
  cwd?: string;
  target?: number;
  maxCycles?: number;
  checkOnly?: boolean;
  dims?: ScoringDimension[];
  escalateAfter?: number;
  _computeScore?: (cwd: string) => Promise<ConvergeScoreSnapshot>;
  _runForge?: (goal: string, cwd: string) => Promise<{ success: boolean }>;
  _runParty?: (dim: string, cwd: string) => Promise<{ success: boolean }>;
  _stdout?: (line: string) => void;
}

export interface ConvergeScoreSnapshot {
  displayScore: number;
  displayDimensions: Record<string, number>;
}

export interface ConvergeResult {
  cyclesRun: number;
  dimsAtTarget: string[];
  dimsFailing: string[];
  finalScores: Record<string, number>;
  success: boolean;
  exitCode: 0 | 1 | 2;
}

export interface ConvDimState {
  id: string;
  stuckCount: number;
  lastScore: number;
}

export interface ConvCycleRecord {
  cycle: number;
  scores: Record<string, number>;
  overallScore: number;
  dimsAtTarget: string[];
  dimsFailing: string[];
  action: 'forge' | 'party' | 'pass';
  worstDim: string | null;
  timestamp: string;
}

export interface ConvProgressFile {
  target: number;
  maxCycles: number;
  cyclesRun: number;
  lastCycle: ConvCycleRecord | null;
  history: ConvCycleRecord[];
}
