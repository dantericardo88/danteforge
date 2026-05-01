/**
 * Labeled-corpus evaluator for Time Machine causal attribution.
 *
 * This is the evidence gate for paper claims: precision/recall numbers must
 * come from a labeled DecisionNode corpus, not from examples or screenshots.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DecisionNode } from './decision-node.js';
import {
  classifyNodesHeuristic,
  type CausalAttributionResult,
  type CausalClassification,
} from './time-machine-causal-attribution.js';

export interface AttributionLabel {
  nodeId: string;
  expected: CausalClassification;
}

export interface AttributionLabelFile {
  branchPointId: string;
  sessionId?: string;
  originalTimelineId?: string;
  alternateTimelineId?: string;
  labels: AttributionLabel[];
}

export interface AttributionEvaluationThresholds {
  precision: number;
  recall: number;
  falseIndependentRate: number;
}

export interface AttributionEvaluationReport {
  branchPointId: string;
  evaluatedAt: string;
  labelCount: number;
  exactMatchRate: number;
  precision: number;
  recall: number;
  falseIndependentRate: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  falseIndependent: number;
  confusion: Record<CausalClassification, Record<CausalClassification, number>>;
  predictions: Array<{
    nodeId: string;
    expected: CausalClassification;
    predicted: CausalClassification;
    confidence: number;
    matched: boolean;
  }>;
  classifier: CausalAttributionResult;
  thresholds: AttributionEvaluationThresholds;
  passed: boolean;
}

export const DEFAULT_ATTRIBUTION_THRESHOLDS: AttributionEvaluationThresholds = {
  precision: 0.85,
  recall: 0.8,
  falseIndependentRate: 0.05,
};

function emptyConfusion(): AttributionEvaluationReport['confusion'] {
  const labels: CausalClassification[] = [
    'independent',
    'dependent-adaptable',
    'dependent-incompatible',
  ];
  return Object.fromEntries(
    labels.map(expected => [
      expected,
      Object.fromEntries(labels.map(predicted => [predicted, 0])),
    ]),
  ) as AttributionEvaluationReport['confusion'];
}

function isDependent(classification: CausalClassification): boolean {
  return classification !== 'independent';
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateAttributionLabels(params: {
  branchPoint: DecisionNode;
  originalTimeline: DecisionNode[];
  alternateTimeline: DecisionNode[];
  labels: AttributionLabel[];
  thresholds?: Partial<AttributionEvaluationThresholds>;
  now?: () => string;
}): AttributionEvaluationReport {
  const thresholds = {
    ...DEFAULT_ATTRIBUTION_THRESHOLDS,
    ...(params.thresholds ?? {}),
  };
  const classifier = classifyNodesHeuristic(
    params.branchPoint,
    params.originalTimeline,
    params.alternateTimeline,
  );
  const byId = new Map(classifier.originalNodes.map(item => [item.node.id, item]));
  const confusion = emptyConfusion();

  let exactMatches = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let falseIndependent = 0;

  const predictions = params.labels.map(label => {
    const attributed = byId.get(label.nodeId);
    if (!attributed) {
      throw new Error(`attribution label references node outside original timeline: ${label.nodeId}`);
    }
    const predicted = attributed.classification;
    const matched = predicted === label.expected;
    if (matched) exactMatches += 1;
    confusion[label.expected][predicted] += 1;

    if (isDependent(label.expected) && isDependent(predicted)) truePositive += 1;
    if (!isDependent(label.expected) && isDependent(predicted)) falsePositive += 1;
    if (isDependent(label.expected) && !isDependent(predicted)) {
      falseNegative += 1;
      falseIndependent += 1;
    }

    return {
      nodeId: label.nodeId,
      expected: label.expected,
      predicted,
      confidence: attributed.confidence,
      matched,
    };
  });

  const dependentExpected = params.labels.filter(label => isDependent(label.expected)).length;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const falseIndependentRate = ratio(falseIndependent, dependentExpected);
  const exactMatchRate = ratio(exactMatches, params.labels.length);
  const passed =
    precision >= thresholds.precision &&
    recall >= thresholds.recall &&
    falseIndependentRate <= thresholds.falseIndependentRate;

  return {
    branchPointId: params.branchPoint.id,
    evaluatedAt: params.now?.() ?? new Date().toISOString(),
    labelCount: params.labels.length,
    exactMatchRate,
    precision,
    recall,
    falseIndependentRate,
    truePositive,
    falsePositive,
    falseNegative,
    falseIndependent,
    confusion,
    predictions,
    classifier,
    thresholds,
    passed,
  };
}

export async function readAttributionLabelFile(filePath: string): Promise<AttributionLabelFile> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as AttributionLabelFile;
  if (!parsed.branchPointId) throw new Error('label file must include branchPointId');
  if (!Array.isArray(parsed.labels) || parsed.labels.length === 0) {
    throw new Error('label file must include at least one label');
  }
  return parsed;
}

export async function writeAttributionEvaluationReport(
  outFile: string,
  report: AttributionEvaluationReport,
): Promise<void> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}
