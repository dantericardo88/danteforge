import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Verify E2E Tests', () => {
  it('should produce valid JSON output even on errors', async () => {
    // Create a test repo with issues
    await fs.mkdir('test-repo', { recursive: true });
    await fs.writeFile('test-repo/test.ts', 'TODO: fix this\nfunction test() { mock result; }');

    try {
      const output = execSync('node dist/index.js verify --json', { cwd: 'test-repo', encoding: 'utf8' });
      const json = JSON.parse(output);
      expect(json).toHaveProperty('status');
      expect(json.counts).toBeDefined();
    } catch (error) {
      // Even if command fails, check if JSON was output
      const output = error.stdout || '';
      expect(() => JSON.parse(output)).not.toThrow();
    } finally {
      await fs.rm('test-repo', { recursive: true, force: true });
    }
  });

  it('should detect TODO and mock in files', async () => {
    await fs.mkdir('test-repo', { recursive: true });
    await fs.writeFile('test-repo/test.ts', 'TODO: implement\nfunction mockTest() {}');

    const output = execSync('node dist/index.js verify', { cwd: 'test-repo', encoding: 'utf8' });
    expect(output).toContain('Incomplete work found');
    expect(output).toContain('Potential mock');

    await fs.rm('test-repo', { recursive: true, force: true });
  });
});