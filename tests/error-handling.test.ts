import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DanteError, ValidationError, NetworkError, FileSystemError, withErrorHandling, withRetry } from '../src/core/errors.js';

describe('Error Handling Tests', () => {
  it('should create DanteError with proper structure', () => {
    const error = new DanteError('Test error', 'TEST_ERROR', { userId: '123' });

    assert(error instanceof Error, 'Should be an Error instance');
    assert(error.name === 'DanteError', 'Should have correct name');
    assert(error.message === 'Test error', 'Should have correct message');
    assert(error.code === 'TEST_ERROR', 'Should have error code');
    assert(error.timestamp, 'Should have timestamp');
    assert(error.context?.userId === '123', 'Should have context');
  });

  it('should create ValidationError', () => {
    const error = new ValidationError('Invalid input', 'email');

    assert(error instanceof DanteError, 'Should inherit from DanteError');
    assert(error.name === 'ValidationError', 'Should have correct name');
    assert(error.context?.field === 'email', 'Should include field in context');
  });

  it('should create NetworkError', () => {
    const error = new NetworkError('Connection failed', 'https://api.example.com', 500);

    assert(error instanceof DanteError, 'Should inherit from DanteError');
    assert(error.name === 'NetworkError', 'Should have correct name');
    assert(error.context?.url === 'https://api.example.com', 'Should include URL');
    assert(error.context?.statusCode === 500, 'Should include status code');
  });

  it('should create FileSystemError', () => {
    const error = new FileSystemError('File not found', '/path/to/file', 'read');

    assert(error instanceof DanteError, 'Should inherit from DanteError');
    assert(error.name === 'FileSystemError', 'Should have correct name');
    assert(error.context?.path === '/path/to/file', 'Should include path');
    assert(error.context?.operation === 'read', 'Should include operation');
  });

  it('should handle withErrorHandling wrapper', async () => {
    // Test successful operation
    const result = await withErrorHandling(
      async () => 'success',
      'test-operation'
    );
    assert(result === 'success', 'Should return result on success');

    // Test error wrapping
    try {
      await withErrorHandling(
        async () => { throw new Error('Test error'); },
        'failing-operation'
      );
      assert.fail('Should have thrown');
    } catch (error) {
      assert(error instanceof DanteError, 'Should wrap error in DanteError');
      assert(error.message.includes('failing-operation'), 'Should include operation name');
    }
  });

  it('should handle withRetry wrapper', async () => {
    let attempts = 0;

    // Test successful retry
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('Temporary failure');
        return 'success';
      },
      'retry-test',
      3,
      10 // Short delay for test
    );

    assert(result === 'success', 'Should eventually succeed');
    assert(attempts === 2, 'Should have retried once');

    // Test max retries exceeded
    try {
      await withRetry(
        async () => { throw new Error('Persistent failure'); },
        'persistent-failure',
        2,
        10
      );
      assert.fail('Should have thrown');
    } catch (error) {
      assert(error instanceof DanteError, 'Should wrap in DanteError');
      assert(error.code === 'MAX_RETRIES_EXCEEDED', 'Should have max retries code');
    }
  });

  it('should serialize errors to JSON', () => {
    const error = new ValidationError('Test validation', 'field1');
    const json = error.toJSON();

    assert(json.name === 'ValidationError', 'Should include name');
    assert(json.message === 'Test validation', 'Should include message');
    assert(json.code === 'VALIDATION_ERROR', 'Should include code');
    assert(json.timestamp, 'Should include timestamp');
    assert(json.context?.field === 'field1', 'Should include context');
    assert(json.stack, 'Should include stack trace');
  });
});