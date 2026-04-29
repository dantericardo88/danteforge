import os from 'node:os';

const MAX_DEFAULT_CONCURRENCY = 8;
const MAX_HEAVY_CONCURRENCY = 2;

function cpuBudget() {
  return Math.max(1, Math.ceil(os.availableParallelism() / 2));
}

export function getDefaultTestConcurrency() {
  return Math.max(1, Math.min(MAX_DEFAULT_CONCURRENCY, cpuBudget()));
}

export function getHeavyLaneConcurrency() {
  return Math.max(1, Math.min(MAX_HEAVY_CONCURRENCY, getDefaultTestConcurrency()));
}

export const TEST_LANES = [
  {
    id: 'default',
    description: 'All unit and integration tests that do not need special isolation.',
    concurrency: getDefaultTestConcurrency(),
    nodeArgs: [],
    patterns: [],
  },
  {
    id: 'orchestration-heavy',
    description: 'Long-running orchestration and autonomous-loop suites.',
    concurrency: getHeavyLaneConcurrency(),
    nodeArgs: ['--test-timeout=180000'],
    patterns: [
      /^tests\/ascend.*\.test\.ts$/,
      /^tests\/autoforge.*\.test\.ts$/,
      /^tests\/autonomous-forge\.test\.ts$/,
      /^tests\/proof-pack\.test\.ts$/,
      /^tests\/self-improve-loop\.test\.ts$/,
    ],
  },
  {
    id: 'orchestration-e2e',
    description: 'End-to-end orchestration pipeline suites that must not be co-scheduled with autonomous loops.',
    concurrency: 1,
    nodeArgs: ['--test-isolation=process', '--test-timeout=180000'],
    patterns: [
      /^tests\/e2e-autoforge-pipeline\.test\.ts$/,
      /^tests\/e2e-spec-pipeline\.test\.ts$/,
    ],
  },
  {
    id: 'cli-process',
    description: 'Saturated CLI spawn suites run in a dedicated low-concurrency process lane.',
    concurrency: 2,
    nodeArgs: ['--test-isolation=process', '--test-timeout=180000'],
    patterns: [
      /^tests\/cli-flags\.test\.ts$/,
      /^tests\/cli-release-readiness\.test\.ts$/,
      /^tests\/config-cli\.test\.ts$/,
      /^tests\/doctor\.test\.ts$/,
      /^tests\/verify-json-e2e\.test\.ts$/,
    ],
  },
];

export function classifyTestFile(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');

  for (const lane of TEST_LANES.slice(1)) {
    if (lane.patterns.some((pattern) => pattern.test(normalizedPath))) {
      return lane.id;
    }
  }

  return 'default';
}

export function buildTestPlan(testFiles) {
  const grouped = new Map(TEST_LANES.map((lane) => [lane.id, []]));

  for (const file of testFiles) {
    grouped.get(classifyTestFile(file))?.push(file);
  }

  return TEST_LANES
    .map((lane) => ({
      ...lane,
      files: (grouped.get(lane.id) ?? []).sort((left, right) => left.localeCompare(right)),
    }))
    .filter((lane) => lane.files.length > 0);
}
