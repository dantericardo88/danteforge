// Demo fixtures — inline TypeScript string constants, zero I/O, zero LLM, zero network.
// rawPrompt values are intentionally vague to score ≤ 25 via scoreRawPrompt.

export interface DemoFixture {
  name: string;
  description: string;
  rawPrompt: string;
  artifactSet: {
    constitution: string;
    spec: string;
    plan: string;
  };
  expectedPdseScore: number;
  expectedRawScore: number;
}

// ── Fixture 1: task-tracker ────────────────────────────────────────────────────

const TASK_TRACKER_CONSTITUTION = `# Project Constitution — Task Tracker

## Principles
- Use TypeScript strict mode with no \`any\` types
- Write unit tests for all business logic (target: 80% coverage)
- All API endpoints must validate input and return typed responses
- Use dependency injection for testability
- Prefer immutable data structures
- Document public APIs with JSDoc
- Handle errors explicitly — no silent failures
- Keep functions pure where possible

## Quality Standards
- Minimum test coverage: 80%
- No console.log in production code
- All functions must have explicit return types
`;

const TASK_TRACKER_SPEC = `# Task Tracker — Specification

## Overview
A web-based task management application allowing users to create, assign, and track tasks through completion.

## Requirements

### REQ-001: Task Creation
Users must be able to create tasks with a title, description, priority (low/medium/high), and due date.
Acceptance criteria: Task form validates all required fields before submission.

### REQ-002: Task Assignment
Tasks must be assignable to team members via their email address.
Acceptance criteria: Email validation, confirmation notification sent.

### REQ-003: Status Tracking
Tasks must support status transitions: Todo → In Progress → Done → Archived.
Acceptance criteria: Only valid transitions allowed, timestamps recorded.

### REQ-004: Priority Filtering
Users must be able to filter tasks by priority, assignee, and status.
Acceptance criteria: Filter combinations work correctly, results update in real-time.

### REQ-005: Audit Trail
All task state changes must be logged with timestamp and user identity.
Acceptance criteria: Audit log is immutable and queryable.
`;

const TASK_TRACKER_PLAN = `# Task Tracker — Implementation Plan

## Phase 1: Data Layer (Week 1)
- Define Task, User, and AuditEntry TypeScript interfaces
- Implement in-memory task repository with CRUD operations
- Write unit tests for all repository methods
- Set up CI pipeline with coverage gate

## Phase 2: Business Logic (Week 2)
- Implement task state machine with valid transition guards
- Build priority filter and search functions
- Add audit trail recording on every state change
- Achieve 80% test coverage milestone

## Phase 3: API Layer (Week 3)
- Build REST API endpoints for task CRUD and filtering
- Add input validation middleware with typed error responses
- Integrate email notification for task assignment
- Write integration tests for all endpoints

## Phase 4: Frontend (Week 4)
- Build task list view with real-time filter controls
- Implement task creation form with full validation
- Add assignment UI with email autocomplete
- End-to-end tests for critical user flows
`;

// ── Fixture 2: auth-system ─────────────────────────────────────────────────────

const AUTH_SYSTEM_CONSTITUTION = `# Project Constitution — Auth System

## Principles
- Security first: never store plain-text passwords or tokens
- Use industry-standard JWT with short-lived access tokens (15 min)
- Refresh tokens must be rotated on every use
- All authentication failures must be logged for audit
- Rate limiting is mandatory on all auth endpoints
- Secrets must come from environment variables — never hardcoded
- Fail closed: deny access on any ambiguous auth state
- Use TypeScript strict mode with no \`any\` types

## Quality Standards
- Minimum test coverage: 85%
- All auth flows must have integration tests
- Security review required before any auth code ships
`;

const AUTH_SYSTEM_SPEC = `# Auth System — Specification

## Overview
A JWT-based authentication and authorization system providing secure login, token management, and role-based access control.

## Requirements

### REQ-001: User Login
Users must authenticate with email and bcrypt-hashed password.
Acceptance criteria: Returns signed JWT access token and refresh token on success; generic error on failure.

### REQ-002: JWT Access Tokens
Access tokens must be signed with RS256, expire after 15 minutes, and include userId and roles claims.
Acceptance criteria: Expired or tampered tokens are rejected with 401.

### REQ-003: Refresh Token Rotation
Refresh tokens must be single-use and rotated on every refresh request.
Acceptance criteria: Reused refresh token invalidates the entire token family.

### REQ-004: Rate Limiting
Login endpoint must enforce rate limiting: max 5 failed attempts per 15 minutes per IP.
Acceptance criteria: Exceeded limit returns 429 with Retry-After header.

### REQ-005: Role-Based Access Control
API routes must support role guards: admin, editor, viewer.
Acceptance criteria: Requests with insufficient roles receive 403; role check is enforced at middleware level.
`;

const AUTH_SYSTEM_PLAN = `# Auth System — Implementation Plan

## Phase 1: Token Infrastructure (Week 1)
- Generate RS256 key pair and wire into config loader
- Implement signToken and verifyToken pure functions
- Write unit tests covering expiry, tamper, and missing claims
- Set up test harness with injected time functions

## Phase 2: User Authentication (Week 2)
- Build login endpoint with bcrypt password verification
- Implement refresh token store with rotation logic
- Add token family invalidation on refresh token reuse
- Integration tests for login, refresh, and logout flows

## Phase 3: Rate Limiting & Security (Week 3)
- Integrate sliding-window rate limiter on login endpoint
- Add audit logging middleware for auth failures
- Implement environment-based secret loading with fail-fast validation
- Security-focused test suite: brute force, replay, timing attacks

## Phase 4: RBAC Middleware (Week 4)
- Build role guard middleware factory for Express routes
- Integrate claims extraction from verified JWT
- Write tests for all role combinations and edge cases
- End-to-end tests covering full auth + protected resource flow
`;

// ── Fixture 3: data-pipeline ──────────────────────────────────────────────────

const DATA_PIPELINE_CONSTITUTION = `# Project Constitution — Data Pipeline

## Principles
- Idempotent operations: re-running a pipeline must produce identical output
- Schema validation at ingress — reject malformed records before processing
- Use TypeScript strict mode with no \`any\` types
- All transformations must be pure functions with no side effects
- Log every record that fails validation or transformation
- Support partial failures: one bad record must not abort the batch
- Prefer streaming over buffering for memory efficiency
- Document schema contracts with examples

## Quality Standards
- Minimum test coverage: 80%
- Performance baseline: process 10 000 records in under 5 seconds
- All pipeline stages must be independently testable
`;

const DATA_PIPELINE_SPEC = `# Data Pipeline — Specification

## Overview
An ETL (Extract, Transform, Load) data processing pipeline that ingests records from CSV or JSON sources, validates and transforms them, and writes results to a configured output sink.

## Requirements

### REQ-001: Source Ingestion
The pipeline must ingest records from CSV files and JSON arrays.
Acceptance criteria: Supports configurable delimiters; detects encoding; reports row count on completion.

### REQ-002: Schema Validation
Each record must be validated against a JSON Schema before transformation.
Acceptance criteria: Invalid records are written to a dead-letter log; valid records proceed; summary report at end.

### REQ-003: Transformation Engine
Transformations are defined as an ordered list of named functions in a config file.
Acceptance criteria: Unknown transform names cause startup failure with a clear error message.

### REQ-004: Output Sink
Transformed records must be written to CSV, JSON, or a PostgreSQL table based on config.
Acceptance criteria: Output is atomic — partial writes are rolled back on failure.

### REQ-005: Observability
The pipeline must emit structured log events for ingestion start/end, validation failures, transform errors, and output commit.
Acceptance criteria: Logs are machine-parseable JSON; each event includes timestamp, stage, and record count.
`;

const DATA_PIPELINE_PLAN = `# Data Pipeline — Implementation Plan

## Phase 1: Core Interfaces (Week 1)
- Define PipelineConfig, Record, ValidationResult, and SinkOptions TypeScript types
- Implement JSON Schema validator wrapper with typed result
- Write unit tests for validator covering required fields, type mismatches, and extra properties
- Set up streaming reader abstraction for CSV and JSON sources

## Phase 2: Transform Engine (Week 2)
- Build transform registry: map of name → pure function
- Implement pipeline executor: validate → transform chain → collect results
- Add dead-letter writer for rejected records
- Unit tests for each built-in transform and error propagation

## Phase 3: Output Sinks (Week 3)
- Implement CSV writer with atomic temp-file-then-rename strategy
- Implement JSON writer with same atomicity guarantee
- Add PostgreSQL sink with transaction-wrapped batch insert
- Integration tests for each sink with real temp files

## Phase 4: Observability & Performance (Week 4)
- Wire structured JSON logger through all pipeline stages
- Add throughput timer and emit summary event on completion
- Benchmark against 10 000-record target (< 5 s)
- End-to-end test covering full CSV-in → PostgreSQL-out flow
`;

// ── Fixture registry ──────────────────────────────────────────────────────────

export const DEMO_FIXTURES: DemoFixture[] = [
  {
    name: 'task-tracker',
    description: 'Simple task management application',
    rawPrompt: 'Build a task tracker app',
    artifactSet: {
      constitution: TASK_TRACKER_CONSTITUTION,
      spec: TASK_TRACKER_SPEC,
      plan: TASK_TRACKER_PLAN,
    },
    expectedPdseScore: 72,
    expectedRawScore: 15,
  },
  {
    name: 'auth-system',
    description: 'JWT authentication and authorization system',
    rawPrompt: 'Add authentication to my app',
    artifactSet: {
      constitution: AUTH_SYSTEM_CONSTITUTION,
      spec: AUTH_SYSTEM_SPEC,
      plan: AUTH_SYSTEM_PLAN,
    },
    expectedPdseScore: 70,
    expectedRawScore: 12,
  },
  {
    name: 'data-pipeline',
    description: 'ETL data processing pipeline',
    rawPrompt: 'Build a data processing pipeline',
    artifactSet: {
      constitution: DATA_PIPELINE_CONSTITUTION,
      spec: DATA_PIPELINE_SPEC,
      plan: DATA_PIPELINE_PLAN,
    },
    expectedPdseScore: 70,
    expectedRawScore: 12,
  },
];

export function getDemoFixture(name: string): DemoFixture | undefined {
  return DEMO_FIXTURES.find((f) => f.name === name);
}

export function listDemoFixtures(): string[] {
  return DEMO_FIXTURES.map((f) => f.name);
}
