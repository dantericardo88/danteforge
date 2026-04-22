---
name: harvest-pattern
description: Focused OSS pattern harvest with Y/N confirmation per gap. One pattern at a time.
---

# /harvest-pattern — OSS Pattern Harvest

Find how top open-source projects implement a specific pattern, then adopt it gap-by-gap with Y/N control.

## Usage

```
danteforge harvest-pattern "error boundary pattern"
danteforge harvest-pattern "circuit breaker"
danteforge harvest-pattern "plugin registry pattern"
danteforge harvest-pattern "rate limiting" --max-repos 10
```

## What Happens

1. Searches top OSS repos for the pattern
2. Extracts implementation gaps sorted by estimated score gain
3. Shows each gap one at a time — you confirm Y/N
4. Implements confirmed gaps immediately
5. Scores after each implementation
6. Captures a lesson for each adopted pattern

## Output

```
  Searching for OSS implementations of: "circuit breaker"
  Found 4 repos. Found 3 gaps — sorted by estimated impact.

  Pattern: Add exponential backoff with jitter
  Source:  resilience4j → core/src/CircuitBreaker.java
  Dimension: errorHandling  |  Est. gain: +0.8
  Implement this pattern? (Y/n): Y
  Implemented — 2 files changed.
  Score: 7.8/10
  Lesson captured.
```

CLI parity: `danteforge harvest-pattern <pattern>`
