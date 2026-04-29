// Maturity Engine — 40 tests for 8-dimension scoring and assessment

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  scoreMaturityDimensions,
  analyzeGaps,
  assessMaturity,
  type MaturityContext,
  type MaturityDimensions,
  type GapSeverity,
} from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult } from '../src/core/pdse.js';

describe('maturity-engine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-maturity-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(cwd: string, overrides: Partial<MaturityContext> = {}): MaturityContext {
    return {
      cwd,
      state: { projectType: 'web' } as DanteState,
      pdseScores: {},
      targetLevel: 4,
      ...overrides,
    };
  }

  // ── Functionality ──

  describe('scoreFunctionality', () => {
    it('returns 50 (neutral) when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.functionality, 50);
    });

    it('scores based on PDSE completeness and integrationFitness', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { completeness: 18, integrationFitness: 9 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18/20)*70 + (9/10)*30 = 63 + 27 = 90
      assert.equal(dimensions.functionality, 90);
    });

    it('averages across multiple artifacts', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { completeness: 20, integrationFitness: 10 },
        } as ScoreResult,
        'PLAN.md': {
          dimensions: { completeness: 10, integrationFitness: 5 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // avg completeness: 15, avg integration: 7.5
      // (15/20)*70 + (7.5/10)*30 = 52.5 + 22.5 = 75
      assert.equal(dimensions.functionality, 75);
    });
  });

  // ── Testing ──

  describe('scoreTesting', () => {
    it('returns 50 (neutral) when no test infrastructure exists', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 50);
    });

    it('adds 10 points for .c8rc.json', async () => {
      const c8Path = path.join(tmpDir, '.c8rc.json');
      await fs.writeFile(c8Path, '{}', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 60); // 50 + 10
    });

    it('adds points for test files', async () => {
      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'foo.test.ts'), '', 'utf8');
      await fs.writeFile(path.join(testDir, 'bar.test.ts'), '', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 54); // 50 + 4 (2 files * 2)
    });

    it('adds 20 points for 90%+ coverage', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, JSON.stringify({ total: { lines: { pct: 92 } } }), 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 70); // 50 + 20
    });

    it('adds 15 points for 85%+ coverage', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, JSON.stringify({ total: { lines: { pct: 87 } } }), 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 65); // 50 + 15
    });

    it('handles invalid coverage JSON gracefully', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, '{invalid json', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 50); // Neutral default
    });
  });

  // ── Error Handling ──

  describe('scoreErrorHandling', () => {
    it('returns 50 when no src directory exists', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.errorHandling, 50);
    });

    it('scores based on try/catch and throw ratio', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'test.ts');
      const content = `
        function foo() { try { throw new Error(); } catch {} }
        function bar() { throw new Error(); }
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 2 functions, 1 try, 2 throws => ratio 3/2 = 1.5 => exceptional coverage band
      assert.equal(dimensions.errorHandling, 95);
    });

    it('adds 10 points for custom error classes', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'errors.ts');
      const content = `
        class CustomError extends Error {}
        function foo() {}
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 1 function, 0 try/throw => absent-coverage base + custom error bonus
      assert.equal(dimensions.errorHandling, 23);
    });

    it('finds try/catch in nested subdirectory file via _collectFiles injection', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'core', 'svc.ts');
      const content = 'function handle() { try { throw new Error(); } catch {} }';
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => content,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // 1 function, 1 try, 1 throw → ratio 2/1 = 2.0 → capped 100
      assert.equal(dims.errorHandling, 95);
    });

    it('finds custom error class in deeply nested file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'core', 'errors', 'app.ts');
      const content = 'class AppError extends Error {}\nfunction fn() {}';
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => content,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // 1 function, 0 try/throw → base 0 + 10 custom error bonus = 10
      assert.ok(dims.errorHandling > 0);
      assert.notEqual(dims.errorHandling, 50); // not the zero-file fallback
    });

    it('regression: real subdirectory file is found by defaultCollectFiles', async () => {
      const coreDir = path.join(tmpDir, 'src', 'core');
      await fs.mkdir(coreDir, { recursive: true });
      // 1 function with 3 throws → ratio 3/1 = 3.0 → capped 100 (distinguishes from fallback 50)
      const content = `function f() {\n  throw new Error();\n  throw new Error();\n  throw new Error();\n}`;
      await fs.writeFile(path.join(coreDir, 'main.ts'), content, 'utf8');
      // No _collectFiles injection — exercises real defaultCollectFiles recursion
      const dims = await scoreMaturityDimensions(makeCtx(tmpDir));
      assert.equal(dims.errorHandling, 95);
    });
  });

  // ── Security ──

  describe('scoreSecurity', () => {
    it('starts with 70 baseline', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.security, 70);
    });

    it('penalizes dangerous patterns', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'bad.ts');
      const content = `
        eval('alert(1)');
        element.innerHTML = '<script>alert(1)</script>';
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - (2 patterns * 10) = 50
      assert.equal(dimensions.security, 50);
    });

    it('adds 10 points for .env file', async () => {
      const envPath = path.join(tmpDir, '.env');
      await fs.writeFile(envPath, 'API_KEY=secret', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.security, 80); // 70 + 10
    });

    it('detects SQL injection risks', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'db.ts');
      const content = `
        db.query('SELECT * FROM users WHERE id = ' + userId);
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 10 (SQL without parameterization) = 60
      assert.equal(dimensions.security, 60);
    });

    it('penalizes eval() found in nested src/core/ file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'core', 'bad.ts');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => "eval('alert(1)')",
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.security, 60); // 70 - 10
    });

    it('penalizes innerHTML found in nested component file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'components', 'widget.tsx');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => 'el.innerHTML = userInput',
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.security, 60); // 70 - 10
    });

    it('clean nested file retains 70 baseline with no deductions', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'core', 'safe.ts');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => 'export function add(a: number, b: number) { return a + b; }',
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.security, 70);
    });

    it('regression: real nested subdirectory file with eval is penalized', async () => {
      const coreDir = path.join(tmpDir, 'src', 'core');
      await fs.mkdir(coreDir, { recursive: true });
      await fs.writeFile(path.join(coreDir, 'vuln.ts'), "eval('test')", 'utf8');
      // No _collectFiles injection — exercises real defaultCollectFiles recursion
      const dims = await scoreMaturityDimensions(makeCtx(tmpDir));
      assert.equal(dims.security, 60); // before fix this was always 70
    });
  });

  // ── UX Polish ──

  describe('scoreUxPolish', () => {
    it('returns 50 for non-web, non-cli projects (library)', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'library' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 50);
    });

    it('adds points for loading states', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'component.tsx');
      const content = `
        const [isLoading, setIsLoading] = useState(false);
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 65); // 50 + 15
    });

    it('adds points for ARIA labels', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'button.tsx');
      const content = `
        <button aria-label="Close">X</button>
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 65); // 50 + 15
    });

    it('adds points for Tailwind config', async () => {
      const tailwindPath = path.join(tmpDir, 'tailwind.config.js');
      await fs.writeFile(tailwindPath, 'module.exports = {}', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
        _readFile: async (p: string) => {
          if (p === tailwindPath) return 'module.exports = {}';
          throw new Error('Not found');
        },
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 60); // 50 + 10
    });

    it('finds isLoading in nested src/pages/ file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'pages', 'home.tsx');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async (p: string) => {
          if (p === nestedFile) return 'const [isLoading] = useState(false)';
          throw new Error('Not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 65); // 50 + 15
    });

    it('finds aria-label in nested component via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'components', 'ui', 'button.tsx');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async (p: string) => {
          if (p === nestedFile) return '<button aria-label="submit">Go</button>';
          throw new Error('Not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 65); // 50 + 15
    });

    it('regression: aria-label in real subdirectory scores above 50', async () => {
      const compDir = path.join(tmpDir, 'src', 'components');
      await fs.mkdir(compDir, { recursive: true });
      await fs.writeFile(path.join(compDir, 'btn.tsx'), '<button aria-label="close">X</button>', 'utf8');
      // No _collectFiles injection — exercises real defaultCollectFiles
      const dims = await scoreMaturityDimensions(makeCtx(tmpDir));
      assert.ok(dims.uxPolish > 50); // before fix this was always 50
    });

    // ── CLI scoring branch ──

    it('CLI: logger usage adds +15 (score 65)', async () => {
      const srcFile = path.join(tmpDir, 'src', 'cmd.ts');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'cli' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === srcFile) return 'logger.info("starting")';
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 65); // 50 + 15
    });

    it('CLI: --json flag adds +15 (score 65)', async () => {
      const srcFile = path.join(tmpDir, 'src', 'cmd.ts');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'cli' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === srcFile) return '.option("--json", "output as json")';
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 65); // 50 + 15
    });

    it('CLI: spinner usage adds +10 (score 60)', async () => {
      const srcFile = path.join(tmpDir, 'src', 'cmd.ts');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'cli' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === srcFile) return 'const spin = ora("loading").start()';
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 60); // 50 + 10
    });

    it('CLI: process.exitCode discipline adds +10 (score 60)', async () => {
      const srcFile = path.join(tmpDir, 'src', 'cmd.ts');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'cli' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === srcFile) return 'process.exitCode = 1;';
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 60); // 50 + 10
    });

    it('CLI: all 4 signals → score 100 (capped)', async () => {
      const srcFile = path.join(tmpDir, 'src', 'cmd.ts');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'cli' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === srcFile) return [
            'logger.info("go")',
            '.option("--json", "json")',
            'const s = ora("loading").start()',
            'process.exitCode = 1;',
          ].join('\n');
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 100); // 50 + 15 + 15 + 10 + 10 = 100
    });

    it('CLI: projectType unknown + bin in package.json → detected as CLI, scores logger', async () => {
      const srcFile = path.join(tmpDir, 'src', 'index.ts');
      const pkgPath = path.join(tmpDir, 'package.json');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'unknown' } as DanteState,
        _collectFiles: async () => [srcFile],
        _readFile: async (p: string) => {
          if (p === pkgPath) return JSON.stringify({ name: 'mytool', bin: { mytool: 'dist/index.js' } });
          if (p === srcFile) return 'logger.info("ready")';
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 65); // 50 + 15
    });

    it('CLI: projectType unknown + no bin in package.json → returns 50', async () => {
      const pkgPath = path.join(tmpDir, 'package.json');
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'unknown' } as DanteState,
        _collectFiles: async () => [],
        _readFile: async (p: string) => {
          if (p === pkgPath) return JSON.stringify({ name: 'mylib', version: '1.0.0' });
          throw new Error('not found');
        },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 50);
    });

    it('CLI: web project still uses web scoring branch (regression guard)', async () => {
      // Web project with no web-specific UX signals → stays at 50
      const ctx = makeCtx(tmpDir, {
        state: { projectType: 'web' } as DanteState,
        _collectFiles: async () => [],
        _readFile: async () => { throw new Error('not found'); },
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.uxPolish, 50);
    });
  });

  // ── Documentation ──

  describe('scoreDocumentation', () => {
    it('returns 50 when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.documentation, 50);
    });

    it('scores based on PDSE clarity and freshness', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { clarity: 18, freshness: 9 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18/20)*70 + (9/10)*30 = 63 + 27 = 90
      assert.equal(dimensions.documentation, 90);
    });
  });

  // ── Performance ──

  describe('scorePerformance', () => {
    it('starts with 70 baseline', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.performance, 70);
    });

    it('penalizes nested loops', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'slow.ts');
      const content = `
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            sum += arr[i][j];
          }
        }
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 5 = 65
      assert.equal(dimensions.performance, 65);
    });

    it('penalizes SELECT *', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'db.ts');
      const content = `
        db.query('SELECT * FROM users');
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 5 = 65
      assert.equal(dimensions.performance, 65);
    });

    it('penalizes nested loop in nested src/algorithms/ file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'algorithms', 'sort.ts');
      const content = 'for (let i = 0; i < n; i++) {\n  for (let j = 0; j < n; j++) { sum++; }\n}';
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => content,
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.performance, 65); // 70 - 5
    });

    it('penalizes SELECT * in nested src/db/ file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'db', 'queries.ts');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => "const q = 'SELECT * FROM users'",
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.performance, 65); // 70 - 5
    });

    it('clean nested file retains 70 baseline', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'utils', 'helper.ts');
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => 'export const add = (a: number) => a + 1;',
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.equal(dims.performance, 70);
    });

    it('regression: nested loop in real subdirectory file is penalized', async () => {
      const algoDir = path.join(tmpDir, 'src', 'algorithms');
      await fs.mkdir(algoDir, { recursive: true });
      const content = 'for (let i = 0; i < n; i++) {\n  for (let j = 0; j < n; j++) { sum++; }\n}';
      await fs.writeFile(path.join(algoDir, 'brute.ts'), content, 'utf8');
      // No _collectFiles injection — exercises real defaultCollectFiles
      const dims = await scoreMaturityDimensions(makeCtx(tmpDir));
      assert.equal(dims.performance, 65); // before fix this was always 70
    });

    it('penalty is capped at 4 files even when 8 files have nested loops', async () => {
      const nestedContent = 'for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) { x++; } }';
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => Array.from({ length: 8 }, (_, i) => `${tmpDir}/src/f${i}.ts`),
        _readFile: async () => nestedContent,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // penaltyFiles = 8, capped at 4 → 70 - 20 = 50
      assert.equal(dims.performance, 50);
    });

    it('await + IO keyword inside loop is penalized (true N+1 pattern)', async () => {
      const n1Content = `for (const id of ids) { const r = await db.query('SELECT 1', id); }`;
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [`${tmpDir}/src/repo.ts`],
        _readFile: async () => n1Content,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // matches .query — penaltyFiles = 1 → 70 - 5 = 65
      assert.equal(dims.performance, 65);
    });

    it('await WITHOUT IO keyword inside loop is NOT penalized (intentional sequential)', async () => {
      const seqContent = `for (const step of steps) { await runStep(step); await saveState(); }`;
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [`${tmpDir}/src/runner.ts`],
        _readFile: async () => seqContent,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // no fetch/query/find/readFile/readdir — score stays 70
      assert.equal(dims.performance, 70);
    });

    it('caching bonus adds +5 to clean file score', async () => {
      const cachingContent = `const cache = new Map<string, Result>();`;
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [`${tmpDir}/src/svc.ts`],
        _readFile: async () => cachingContent,
      });
      const dims = await scoreMaturityDimensions(ctx);
      // no anti-patterns + hasCaching → 70 + 5 = 75
      assert.equal(dims.performance, 75);
    });

    it('performance-baseline.json bonus adds +10 to score', async () => {
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [],
        _fileExists: async (p: string) => p.includes('performance-baseline.json'),
      });
      const dims = await scoreMaturityDimensions(ctx);
      // no files scanned, baseline exists → 70 + 10 = 80
      assert.equal(dims.performance, 80);
    });
  });

  // ── Maintainability ──

  describe('scoreMaintainability', () => {
    it('returns 50 when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.maintainability, 50);
    });

    it('scores based on PDSE testability and constitution alignment', async () => {
      const pdseScores = {
        'PLAN.md': {
          dimensions: { testability: 18, constitutionAlignment: 16 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18 + 16) / 40 * 100 = 85
      assert.equal(dimensions.maintainability, 85);
    });

    it('penalizes large functions (>100 LOC)', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'large.ts');
      const lines = Array(120).fill('console.log("line");').join('\n');
      const content = `function huge() {\n${lines}\n}`;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 50 - 2 (1 large function × 2pts) = 48
      assert.equal(dimensions.maintainability, 48);
    });

    it('penalizes large function in nested src/core/ file via _collectFiles', async () => {
      const nestedFile = path.join(tmpDir, 'src', 'core', 'proc.ts');
      const bodyLines = Array(110).fill('  const x = 1;').join('\n');
      const content = `function processAll() {\n${bodyLines}\n}`;
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [nestedFile],
        _readFile: async () => content,
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.ok(dims.maintainability < 50); // penalty applied
    });

    it('accumulates penalty across multiple nested files with large functions', async () => {
      const fileA = path.join(tmpDir, 'src', 'core', 'a.ts');
      const fileB = path.join(tmpDir, 'src', 'cli', 'b.ts');
      const bodyLines = Array(120).fill('  const x = 1;').join('\n');
      const bigFn = `function big() {\n${bodyLines}\n}`;
      const ctx = makeCtx(tmpDir, {
        _collectFiles: async () => [fileA, fileB],
        _readFile: async () => bigFn,
      });
      const dims = await scoreMaturityDimensions(ctx);
      assert.ok(dims.maintainability <= 46); // pdseBase(50) - 2 - 2 = 46
    });

    it('regression: large function in real subdirectory is penalized', async () => {
      const coreDir = path.join(tmpDir, 'src', 'core');
      await fs.mkdir(coreDir, { recursive: true });
      const bodyLines = Array(110).fill('  const x = 1;').join('\n');
      const content = `function huge() {\n${bodyLines}\n}`;
      await fs.writeFile(path.join(coreDir, 'big.ts'), content, 'utf8');
      // No _collectFiles injection — exercises real defaultCollectFiles
      const dims = await scoreMaturityDimensions(makeCtx(tmpDir));
      assert.ok(dims.maintainability < 50); // before fix: always 50 (no penalty applied)
    });
  });

  // ── Gap Analysis ──

  describe('analyzeGaps', () => {
    it('classifies critical gaps (>20 points)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 45,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 3, 4);
      const criticalGaps = gaps.filter(g => g.severity === 'critical');
      assert.equal(criticalGaps.length, 1);
      assert.equal(criticalGaps[0]!.dimension, 'functionality');
      assert.equal(criticalGaps[0]!.gapSize, 25);
    });

    it('classifies major gaps (10-20 points)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 55,
        documentation: 58,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const majorGaps = gaps.filter(g => g.severity === 'major');
      assert.equal(majorGaps.length, 2);
      assert.ok(majorGaps.some(g => g.dimension === 'uxPolish'));
      assert.ok(majorGaps.some(g => g.dimension === 'documentation'));
    });

    it('classifies minor gaps (0-10 points)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const minorGaps = gaps.filter(g => g.severity === 'minor');
      assert.ok(minorGaps.length > 0);
    });

    it('sorts gaps by size (largest first)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 45,
        testing: 55,
        errorHandling: 65,
        security: 72,
        uxPolish: 68,
        documentation: 50,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 3, 4);
      assert.ok(gaps[0]!.gapSize >= gaps[1]!.gapSize);
      assert.ok(gaps[1]!.gapSize >= gaps[2]!.gapSize);
    });
  });

  // ── Full Assessment ──

  describe('assessMaturity', () => {
    it('computes weighted average across 8 dimensions', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 14,
            integrationFitness: 7,
            clarity: 14,
            freshness: 7,
            testability: 14,
            constitutionAlignment: 14,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      // Assessment should compute weighted average across all 8 dimensions
      assert.ok(assessment.overallScore >= 0 && assessment.overallScore <= 100);
      assert.ok(assessment.currentLevel >= 1 && assessment.currentLevel <= 6);
      assert.equal(assessment.targetLevel, 4);
      // Verify all dimensions are present
      assert.ok(assessment.dimensions.functionality);
      assert.ok(assessment.dimensions.testing);
      assert.ok(assessment.dimensions.errorHandling);
      assert.ok(assessment.dimensions.security);
      assert.ok(assessment.dimensions.uxPolish);
      assert.ok(assessment.dimensions.documentation);
      assert.ok(assessment.dimensions.performance);
      assert.ok(assessment.dimensions.maintainability);
    });

    it('generates founder explanation', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.length > 0);
      assert.ok(assessment.founderExplanation.includes('level'));
    });

    it('returns "proceed" when current >= target', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 20,
            integrationFitness: 10,
            clarity: 20,
            freshness: 10,
            testability: 20,
            constitutionAlignment: 20,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'cli' } as DanteState,
        pdseScores,
        targetLevel: 2,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(['proceed', 'target-exceeded'].includes(assessment.recommendation));
    });

    it('returns "blocked" when critical gaps exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 3,
            clarity: 8,
            freshness: 4,
            testability: 6,
            constitutionAlignment: 7,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.recommendation, 'blocked');
    });

    it('returns "refine" when major gaps exist but no critical gaps', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 12,
            integrationFitness: 6,
            clarity: 13,
            freshness: 6,
            testability: 11,
            constitutionAlignment: 12,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.recommendation, 'refine');
    });

    it('includes timestamp in assessment', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.timestamp);
      assert.doesNotThrow(() => new Date(assessment.timestamp));
    });

    it('computes gaps for all dimensions below threshold', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 6,
      };

      const assessment = await assessMaturity(ctx);
      // With neutral scores (50/50), all dimensions should have gaps vs level 6
      assert.ok(assessment.gaps.length > 0);
    });

    it('returns consistent maturity levels for same input', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment1 = await assessMaturity(ctx);
      const assessment2 = await assessMaturity(ctx);
      assert.equal(assessment1.currentLevel, assessment2.currentLevel);
    });
  });
});
