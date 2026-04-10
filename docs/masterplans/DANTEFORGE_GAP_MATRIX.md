{
  "timestamp": "2026-04-10T17:23:24.000Z",
  "gaps": [
    {
      "category": "enterprise",
      "severity": "high",
      "description": "Enterprise readiness at 4.5/10 - missing security controls, compliance automation",
      "blockingFiles": ["src/core/enterprise-readiness.ts"],
      "estimatedEffort": "5 days"
    },
    {
      "category": "testing",
      "severity": "medium",
      "description": "Missing integration and E2E test suites",
      "blockingFiles": ["tests/"],
      "estimatedEffort": "4 days"
    },
    {
      "category": "truth-surface",
      "severity": "low",
      "description": "Version drift between package.json and docs",
      "blockingFiles": ["package.json", "docs/"],
      "estimatedEffort": "1 day"
    },
    {
      "category": "audit",
      "severity": "medium",
      "description": "Audit logging covers only 70% of commands",
      "blockingFiles": ["src/cli/index.ts"],
      "estimatedEffort": "2 days"
    }
  ],
  "overallGapScore": 65,
  "criticalCount": 1,
  "majorCount": 2,
  "minorCount": 1
}