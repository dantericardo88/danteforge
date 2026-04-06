/**
 * Tests for structured audit logging
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  logAuditEvent,
  AuditEvent,
  generateCorrelationId,
  getSessionId,
  resetSessionId,
  getUserId,
  auditEvent,
  logCommandStart,
  logCommandEnd,
  logLLMCall,
  logFileWrite,
  logGitOperation,
  logMCPCall,
  logGateCheck,
  logError,
  type AuditEventType,
  type AuditStatus,
} from '../src/core/structured-audit.js';

describe('Structured Audit Logging', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'danteforge-test-audit-'));
    resetSessionId(); // Fresh session for each test
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Core Functions', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.notEqual(id1, id2);
    });

    it('should maintain session ID across calls', () => {
      const session1 = getSessionId();
      const session2 = getSessionId();

      assert.equal(session1, session2);
      assert.match(session1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should reset session ID on demand', () => {
      const session1 = getSessionId();
      resetSessionId();
      const session2 = getSessionId();

      assert.notEqual(session1, session2);
    });

    it('should get user ID', () => {
      const userId = getUserId();
      assert.ok(userId);
      assert.ok(typeof userId === 'string');
    });
  });

  describe('Log File Writing', () => {
    it('should create audit directory if missing', () => {
      const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        correlationId: generateCorrelationId(),
        sessionId: getSessionId(),
        eventType: 'command_start',
        status: 'success',
        metadata: {},
      };

      logAuditEvent(event, tmpDir);

      const auditDir = join(tmpDir, '.danteforge', 'audit');
      assert.ok(existsSync(auditDir));
    });

    it('should write JSONL formatted events', () => {
      const correlationId = generateCorrelationId();
      const event: AuditEvent = {
        timestamp: '2026-04-01T10:00:00.000Z',
        correlationId,
        sessionId: getSessionId(),
        eventType: 'command_start',
        command: 'danteforge plan',
        status: 'success',
        metadata: { foo: 'bar' },
      };

      logAuditEvent(event, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');

      // Should be single line JSON
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 1);

      // Should parse as valid JSON
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.correlationId, correlationId);
      assert.equal(parsed.eventType, 'command_start');
      assert.equal(parsed.command, 'danteforge plan');
      assert.deepEqual(parsed.metadata, { foo: 'bar' });
    });

    it('should append multiple events to same file', () => {
      const event1: AuditEvent = {
        timestamp: new Date().toISOString(),
        correlationId: generateCorrelationId(),
        sessionId: getSessionId(),
        eventType: 'command_start',
        status: 'success',
        metadata: {},
      };

      const event2: AuditEvent = {
        timestamp: new Date().toISOString(),
        correlationId: generateCorrelationId(),
        sessionId: getSessionId(),
        eventType: 'llm_call',
        provider: 'ollama',
        status: 'success',
        metadata: {},
      };

      logAuditEvent(event1, tmpDir);
      logAuditEvent(event2, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n');

      assert.equal(lines.length, 2);
      const parsed1 = JSON.parse(lines[0]);
      const parsed2 = JSON.parse(lines[1]);

      assert.equal(parsed1.eventType, 'command_start');
      assert.equal(parsed2.eventType, 'llm_call');
    });

    it('should auto-fill timestamp if missing', () => {
      const event: AuditEvent = {
        timestamp: '', // Will be auto-filled
        correlationId: generateCorrelationId(),
        sessionId: getSessionId(),
        eventType: 'command_start',
        status: 'success',
        metadata: {},
      };

      logAuditEvent(event, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.ok(parsed.timestamp);
      assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should auto-fill session ID if missing', () => {
      const currentSession = getSessionId();
      const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        correlationId: generateCorrelationId(),
        sessionId: '', // Will be auto-filled
        eventType: 'command_start',
        status: 'success',
        metadata: {},
      };

      logAuditEvent(event, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.sessionId, currentSession);
    });

    it('should not crash on write failure', () => {
      const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        correlationId: generateCorrelationId(),
        sessionId: getSessionId(),
        eventType: 'command_start',
        status: 'success',
        metadata: {},
      };

      // Try to write to invalid path (best-effort logging)
      assert.doesNotThrow(() => {
        logAuditEvent(event, '/invalid/nonexistent/path');
      });
    });
  });

  describe('Fluent API (AuditEventBuilder)', () => {
    it('should build basic event', () => {
      const event = auditEvent('command_start').command('danteforge plan').success().build();

      assert.equal(event.eventType, 'command_start');
      assert.equal(event.command, 'danteforge plan');
      assert.equal(event.status, 'success');
      assert.ok(event.timestamp);
      assert.ok(event.correlationId);
      assert.ok(event.sessionId);
    });

    it('should build LLM call event with all fields', () => {
      const event = auditEvent('llm_call')
        .provider('ollama')
        .model('qwen2.5-coder:7b')
        .tokens(1234, 0.001)
        .duration(2500)
        .success()
        .build();

      assert.equal(event.eventType, 'llm_call');
      assert.equal(event.provider, 'ollama');
      assert.equal(event.model, 'qwen2.5-coder:7b');
      assert.equal(event.tokensUsed, 1234);
      assert.equal(event.costUsd, 0.001);
      assert.equal(event.duration, 2500);
      assert.equal(event.status, 'success');
    });

    it('should build failure event with error details', () => {
      const event = auditEvent('error')
        .failure('DF-LLM-001', 'LLM timeout', 'Error: timeout\n  at ...')
        .build();

      assert.equal(event.eventType, 'error');
      assert.equal(event.status, 'failure');
      assert.equal(event.errorCode, 'DF-LLM-001');
      assert.equal(event.errorMessage, 'LLM timeout');
      assert.equal(event.stackTrace, 'Error: timeout\n  at ...');
    });

    it('should build file write event', () => {
      const event = auditEvent('file_write').filePath('/path/to/file.ts').success().build();

      assert.equal(event.eventType, 'file_write');
      assert.equal(event.filePath, '/path/to/file.ts');
      assert.equal(event.status, 'success');
    });

    it('should build git operation event', () => {
      const event = auditEvent('git_operation').gitOperation('commit').success().build();

      assert.equal(event.eventType, 'git_operation');
      assert.equal(event.gitOperation, 'commit');
    });

    it('should build MCP call event', () => {
      const event = auditEvent('mcp_call')
        .mcpServer('figma')
        .mcpTool('get-design')
        .duration(1500)
        .success()
        .build();

      assert.equal(event.eventType, 'mcp_call');
      assert.equal(event.mcpServer, 'figma');
      assert.equal(event.mcpTool, 'get-design');
      assert.equal(event.duration, 1500);
    });

    it('should build gate check event', () => {
      const event = auditEvent('gate_check').gateType('constitution').success().build();

      assert.equal(event.eventType, 'gate_check');
      assert.equal(event.gateType, 'constitution');
    });

    it('should add custom metadata', () => {
      const event = auditEvent('command_start')
        .metadata('custom_field', 'custom_value')
        .metadata('another_field', 123)
        .build();

      assert.equal(event.metadata.custom_field, 'custom_value');
      assert.equal(event.metadata.another_field, 123);
    });

    it('should add bulk metadata', () => {
      const event = auditEvent('command_start')
        .metadataAll({ field1: 'value1', field2: 42, field3: true })
        .build();

      assert.deepEqual(event.metadata, { field1: 'value1', field2: 42, field3: true });
    });

    it('should override correlation ID', () => {
      const customCorrId = 'custom-correlation-id';
      const event = auditEvent('command_start').correlationId(customCorrId).build();

      assert.equal(event.correlationId, customCorrId);
    });

    it('should set user ID', () => {
      const event = auditEvent('command_start').userId('test@example.com').build();

      assert.equal(event.userId, 'test@example.com');
    });

    it('should set warning status', () => {
      const event = auditEvent('command_end').warning().build();

      assert.equal(event.status, 'warning');
    });

    it('should log event via builder', () => {
      auditEvent('command_start').command('danteforge plan').log(tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      assert.ok(existsSync(logFile));

      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'command_start');
      assert.equal(parsed.command, 'danteforge plan');
    });
  });

  describe('Helper Functions', () => {
    it('should log command start and return correlation ID', () => {
      const corrId = logCommandStart('danteforge plan', undefined, tmpDir);

      assert.ok(corrId);
      assert.match(corrId, /^[0-9a-f-]+$/);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'command_start');
      assert.equal(parsed.command, 'danteforge plan');
      assert.equal(parsed.correlationId, corrId);
    });

    it('should log command start with custom correlation ID', () => {
      const customCorrId = 'my-correlation-id';
      const corrId = logCommandStart('danteforge plan', customCorrId, tmpDir);

      assert.equal(corrId, customCorrId);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.correlationId, customCorrId);
    });

    it('should log command end with duration', () => {
      const corrId = generateCorrelationId();
      logCommandEnd('danteforge plan', corrId, 'success', 5000, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'command_end');
      assert.equal(parsed.command, 'danteforge plan');
      assert.equal(parsed.correlationId, corrId);
      assert.equal(parsed.status, 'success');
      assert.equal(parsed.duration, 5000);
    });

    it('should log command end with failure status', () => {
      const corrId = generateCorrelationId();
      logCommandEnd('danteforge plan', corrId, 'failure', 3000, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.status, 'failure');
    });

    it('should log LLM call with all details', () => {
      const corrId = generateCorrelationId();
      logLLMCall('ollama', 'qwen2.5-coder:7b', corrId, 1234, 0.001, 2500, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'llm_call');
      assert.equal(parsed.provider, 'ollama');
      assert.equal(parsed.model, 'qwen2.5-coder:7b');
      assert.equal(parsed.tokensUsed, 1234);
      assert.equal(parsed.costUsd, 0.001);
      assert.equal(parsed.duration, 2500);
    });

    it('should log file write event', () => {
      const corrId = generateCorrelationId();
      logFileWrite('/path/to/file.ts', corrId, 'success', tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'file_write');
      assert.equal(parsed.filePath, '/path/to/file.ts');
      assert.equal(parsed.status, 'success');
    });

    it('should log git operation event', () => {
      const corrId = generateCorrelationId();
      logGitOperation('commit', corrId, 'success', tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'git_operation');
      assert.equal(parsed.gitOperation, 'commit');
    });

    it('should log MCP call event', () => {
      const corrId = generateCorrelationId();
      logMCPCall('figma', 'get-design', corrId, 1500, 'success', tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'mcp_call');
      assert.equal(parsed.mcpServer, 'figma');
      assert.equal(parsed.mcpTool, 'get-design');
      assert.equal(parsed.duration, 1500);
    });

    it('should log gate check event (passed)', () => {
      const corrId = generateCorrelationId();
      logGateCheck('constitution', corrId, true, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'gate_check');
      assert.equal(parsed.gateType, 'constitution');
      assert.equal(parsed.status, 'success');
    });

    it('should log gate check event (failed)', () => {
      const corrId = generateCorrelationId();
      logGateCheck('constitution', corrId, false, tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.status, 'failure');
    });

    it('should log error event with stack trace', () => {
      const corrId = generateCorrelationId();
      logError('DF-LLM-001', 'LLM timeout', corrId, 'Error: timeout\n  at ...', tmpDir);

      const logFile = join(tmpDir, '.danteforge', 'audit', 'detailed.jsonl');
      const content = readFileSync(logFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.equal(parsed.eventType, 'error');
      assert.equal(parsed.errorCode, 'DF-LLM-001');
      assert.equal(parsed.errorMessage, 'LLM timeout');
      assert.equal(parsed.stackTrace, 'Error: timeout\n  at ...');
      assert.equal(parsed.status, 'failure');
    });
  });

  describe('Event Type Coverage', () => {
    const eventTypes: AuditEventType[] = [
      'command_start',
      'command_end',
      'llm_call',
      'llm_response',
      'file_write',
      'file_read',
      'git_operation',
      'mcp_call',
      'gate_check',
      'error',
      'warning',
    ];

    it('should support all event types', () => {
      for (const eventType of eventTypes) {
        const event = auditEvent(eventType).build();
        assert.equal(event.eventType, eventType);
      }
    });
  });

  describe('Status Coverage', () => {
    const statuses: AuditStatus[] = ['success', 'failure', 'warning'];

    it('should support all status values', () => {
      const successEvent = auditEvent('command_end').success().build();
      assert.equal(successEvent.status, 'success');

      const failureEvent = auditEvent('command_end').failure().build();
      assert.equal(failureEvent.status, 'failure');

      const warningEvent = auditEvent('command_end').warning().build();
      assert.equal(warningEvent.status, 'warning');
    });
  });
});
