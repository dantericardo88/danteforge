/**
 * Tests for universal resilience layer
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeWithResilience,
  readFileResilient,
  writeFileResilient,
  gitOperationResilient,
  mcpCallResilient,
  networkRequestResilient,
  getConcurrentCount,
  resetConcurrentCounters,
  CircuitOpenError,
  OperationTimeoutError,
  ConcurrencyLimitError,
  type ResilienceConfig,
  type OperationType,
} from '../src/core/resilience.js';
import { resetAllCircuits } from '../src/core/circuit-breaker.js';

describe('Universal Resilience Layer', () => {
  beforeEach(() => {
    resetAllCircuits();
    resetConcurrentCounters();
  });

  describe('Basic Execution', () => {
    it('should execute successful operation', async () => {
      const operation = async () => 'success';

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
      });

      assert.equal(result, 'success');
    });

    it('should pass through operation result', async () => {
      const operation = async () => ({ data: 'test', count: 42 });

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
      });

      assert.deepEqual(result, { data: 'test', count: 42 });
    });

    it('should execute async operation', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      };

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
      });

      assert.equal(result, 'async result');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow operation', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 'should not reach here';
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            timeout: 100, // 100ms timeout
          }),
        (err: Error) => {
          assert.ok(err instanceof OperationTimeoutError);
          assert.match(err.message, /timed out after 100ms/);
          return true;
        },
      );
    });

    it('should complete fast operation before timeout', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'success';
      };

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
        timeout: 200,
      });

      assert.equal(result, 'success');
    });

    it('should use default timeout if not specified', async () => {
      const operation = async () => 'success';

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
        // No timeout specified - uses default (300000ms)
      });

      assert.equal(result, 'success');
    });

    it('should respect explicit timeout over default', async () => {
      // Test explicit timeout parameter (more reliable than env var test)
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'should timeout';
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            timeout: 50, // Explicit 50ms timeout (instead of env var)
          }),
        OperationTimeoutError,
      );
    });
  });

  describe('Retry Logic', () => {
    it('should retry failing operation', async () => {
      let attempts = 0;

      const operation = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient failure');
        }
        return 'success on attempt 3';
      };

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
        retries: 3,
      });

      assert.equal(result, 'success on attempt 3');
      assert.equal(attempts, 3);
    });

    it('should throw after exhausting retries', async () => {
      let attempts = 0;

      const operation = async () => {
        attempts++;
        throw new Error('Persistent failure');
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            retries: 2,
          }),
        (err: Error) => {
          assert.equal(err.message, 'Persistent failure');
          return true;
        },
      );

      assert.equal(attempts, 3); // Initial + 2 retries
    });

    it('should not retry on circuit breaker errors', async () => {
      let attempts = 0;

      // Trip the circuit breaker first
      for (let i = 0; i < 5; i++) {
        try {
          await executeWithResilience(
            async () => {
              throw new Error('Fail');
            },
            {
              operationType: 'file_read',
              operationId: 'test.txt',
              retries: 0,
            },
          );
        } catch {
          // Expected
        }
      }

      // Now try with circuit open
      const operation = async () => {
        attempts++;
        return 'should not reach here';
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            retries: 3,
          }),
        CircuitOpenError,
      );

      assert.equal(attempts, 0); // Should not execute at all
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should trip circuit breaker after threshold failures', async () => {
      const operation = async () => {
        throw new Error('Failure');
      };

      const config: ResilienceConfig = {
        operationType: 'file_read',
        operationId: 'test.txt',
        retries: 0,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 30_000,
          halfOpenSuccessThreshold: 1,
        },
      };

      // Fail 3 times to trip circuit
      for (let i = 0; i < 3; i++) {
        try {
          await executeWithResilience(operation, config);
        } catch (err) {
          assert.notEqual((err as Error).constructor.name, 'CircuitOpenError');
        }
      }

      // 4th attempt should hit open circuit
      await assert.rejects(async () => executeWithResilience(operation, config), CircuitOpenError);
    });

    it('should reset circuit breaker after success', async () => {
      let shouldFail = true;

      const operation = async () => {
        if (shouldFail) throw new Error('Failure');
        return 'success';
      };

      const config: ResilienceConfig = {
        operationType: 'file_read',
        operationId: 'test.txt',
        retries: 0,
      };

      // Fail once
      try {
        await executeWithResilience(operation, config);
      } catch {
        // Expected
      }

      // Succeed
      shouldFail = false;
      const result = await executeWithResilience(operation, config);
      assert.equal(result, 'success');

      // Fail again - should start from 0 failures
      shouldFail = true;
      try {
        await executeWithResilience(operation, config);
      } catch (err) {
        assert.notEqual((err as Error).constructor.name, 'CircuitOpenError');
      }
    });
  });

  describe('Concurrency Limiting', () => {
    it('should track concurrent operations', async () => {
      const operation = async () => {
        const count = getConcurrentCount('file_read');
        await new Promise((resolve) => setTimeout(resolve, 50));
        return count;
      };

      const promises = [
        executeWithResilience(operation, { operationType: 'file_read', operationId: 'file1.txt' }),
        executeWithResilience(operation, { operationType: 'file_read', operationId: 'file2.txt' }),
        executeWithResilience(operation, { operationType: 'file_read', operationId: 'file3.txt' }),
      ];

      const results = await Promise.all(promises);

      // At least one should have seen concurrent operations
      assert.ok(results.some((count) => count > 0));
    });

    it('should enforce max concurrent limit', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      };

      const config: ResilienceConfig = {
        operationType: 'file_read',
        operationId: 'test.txt',
        maxConcurrent: 2,
      };

      const promise1 = executeWithResilience(operation, config);
      const promise2 = executeWithResilience(operation, config);

      // Third should fail immediately
      await assert.rejects(async () => executeWithResilience(operation, config), ConcurrencyLimitError);

      await Promise.all([promise1, promise2]);
    });

    it('should release concurrency slot after completion', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'success';
      };

      const config: ResilienceConfig = {
        operationType: 'file_read',
        operationId: 'test.txt',
        maxConcurrent: 1,
      };

      // First operation
      await executeWithResilience(operation, config);

      // Second operation should succeed (slot released)
      const result = await executeWithResilience(operation, config);
      assert.equal(result, 'success');
    });

    it('should release concurrency slot after failure', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Failure');
      };

      const config: ResilienceConfig = {
        operationType: 'file_read',
        operationId: 'test.txt',
        maxConcurrent: 1,
        retries: 0,
      };

      // First operation fails
      try {
        await executeWithResilience(operation, config);
      } catch {
        // Expected
      }

      // Second operation should succeed (slot released)
      const successOperation = async () => 'success';
      const result = await executeWithResilience(successOperation, config);
      assert.equal(result, 'success');
    });
  });

  describe('Helper Functions', () => {
    it('should execute resilient file read', async () => {
      const operation = async () => 'file contents';

      const result = await readFileResilient('/path/to/file.txt', operation);

      assert.equal(result, 'file contents');
    });

    it('should execute resilient file write', async () => {
      let written = false;
      const operation = async () => {
        written = true;
      };

      await writeFileResilient('/path/to/file.txt', operation);

      assert.ok(written);
    });

    it('should execute resilient git clone', async () => {
      const operation = async () => 'clone result';

      const result = await gitOperationResilient('clone https://github.com/repo.git', operation);

      assert.equal(result, 'clone result');
    });

    it('should execute resilient git commit', async () => {
      const operation = async () => 'commit hash';

      const result = await gitOperationResilient('commit -m "message"', operation);

      assert.equal(result, 'commit hash');
    });

    it('should execute resilient git push', async () => {
      const operation = async () => undefined;

      await gitOperationResilient('push origin main', operation);
    });

    it('should execute resilient MCP call', async () => {
      const operation = async () => ({ design: 'data' });

      const result = await mcpCallResilient('figma', 'get-design', operation);

      assert.deepEqual(result, { design: 'data' });
    });

    it('should execute resilient network request', async () => {
      const operation = async () => ({ status: 200, body: 'OK' });

      const result = await networkRequestResilient('https://api.example.com', operation);

      assert.deepEqual(result, { status: 200, body: 'OK' });
    });
  });

  describe('Operation Type Classification', () => {
    const operationTypes: OperationType[] = [
      'file_read',
      'file_write',
      'git_clone',
      'git_commit',
      'git_push',
      'git_pull',
      'mcp_call',
      'network_request',
      'llm_call',
    ];

    it('should support all operation types', async () => {
      for (const operationType of operationTypes) {
        const operation = async () => 'success';

        const result = await executeWithResilience(operation, {
          operationType,
          operationId: 'test',
        });

        assert.equal(result, 'success');
      }
    });
  });

  describe('Error Propagation', () => {
    it('should propagate custom error types', async () => {
      class CustomError extends Error {
        constructor() {
          super('Custom error');
          this.name = 'CustomError';
        }
      }

      const operation = async () => {
        throw new CustomError();
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            retries: 0,
          }),
        CustomError,
      );
    });

    it('should include stack trace in propagated errors', async () => {
      const operation = async () => {
        throw new Error('Test error');
      };

      try {
        await executeWithResilience(operation, {
          operationType: 'file_read',
          operationId: 'test.txt',
          retries: 0,
        });
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok((err as Error).stack);
        assert.match((err as Error).stack!, /Test error/);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero retries', async () => {
      let attempts = 0;

      const operation = async () => {
        attempts++;
        throw new Error('Failure');
      };

      await assert.rejects(
        async () =>
          executeWithResilience(operation, {
            operationType: 'file_read',
            operationId: 'test.txt',
            retries: 0,
          }),
        Error,
      );

      assert.equal(attempts, 1); // No retries
    });

    it('should handle immediate success (no retries needed)', async () => {
      let attempts = 0;

      const operation = async () => {
        attempts++;
        return 'success';
      };

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
        retries: 3,
      });

      assert.equal(result, 'success');
      assert.equal(attempts, 1); // Only one attempt needed
    });

    it('should handle undefined optional config values', async () => {
      const operation = async () => 'success';

      const result = await executeWithResilience(operation, {
        operationType: 'file_read',
        operationId: 'test.txt',
        maxConcurrent: undefined,
        timeout: undefined,
        retries: undefined,
        circuitBreaker: undefined,
      });

      assert.equal(result, 'success');
    });

    it('should reset concurrent counters', () => {
      // Simulate some concurrent operations
      const operation = async () => 'success';
      const promises = [
        executeWithResilience(operation, { operationType: 'file_read', operationId: 'file1.txt' }),
        executeWithResilience(operation, { operationType: 'file_write', operationId: 'file2.txt' }),
      ];

      resetConcurrentCounters();

      assert.equal(getConcurrentCount('file_read'), 0);
      assert.equal(getConcurrentCount('file_write'), 0);
    });
  });
});
