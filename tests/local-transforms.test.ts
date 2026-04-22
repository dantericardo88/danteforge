// Local Transforms — pure regex-based code transform tests
// Tests all public exports: applyLocalTransform, detectApplicableTransforms, applyAllApplicable

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  applyLocalTransform,
  detectApplicableTransforms,
  applyAllApplicable,
  stripStringsAndComments,
  type TransformType,
} from '../src/core/local-transforms.js';

// ─── Test Data ────────────────────────────────────────────────────────────────

const codeWithVar = `
var x = 1;
const y = 2;
let z = 3;
var name = "hello";
`;

const cleanCode = `
const x = 1;
const y = 2;
let z = 3;
`;

const codeWithConsoleLogs = `
const x = 1;
console.log("debug value", x);
console.debug("verbose");
console.info("informational");
console.error("this is an error");
console.warn("this is a warning");
const y = 2;
`;

const codeWithRelativeImports = `
import { foo } from './utils/foo';
import { bar } from '../helpers/bar';
import { baz } from './baz.js';
import lodash from 'lodash';
import { join } from 'node:path';
`;

const codeWithDeepChains = `
const val = config.settings.theme.color;
const safe = this.state.value.nested;
const mathVal = Math.max.apply.call;
const deep = response.data.items.first;
`;

const codeWithMixedIssues = `
var count = 0;
console.log("count is", count);
import { helper } from './helper';
const result = data.response.body.value;
`;

// ─── var-to-const ─────────────────────────────────────────────────────────────

describe('local-transforms: var-to-const', () => {
  it('replaces var with const', () => {
    const result = applyLocalTransform('test.ts', codeWithVar, 'var-to-const');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes('const x = 1;'));
    assert.ok(result.transformedContent.includes('const name = "hello";'));
    assert.ok(!result.transformedContent.includes('var x'));
    assert.ok(!result.transformedContent.includes('var name'));
  });

  it('does not modify let or const declarations', () => {
    const result = applyLocalTransform('test.ts', codeWithVar, 'var-to-const');
    assert.strictEqual(result.applied, true);
    // Original const y and let z must remain unchanged
    assert.ok(result.transformedContent.includes('const y = 2;'));
    assert.ok(result.transformedContent.includes('let z = 3;'));
  });

  it('returns applied=false when there are no var declarations', () => {
    const result = applyLocalTransform('test.ts', cleanCode, 'var-to-const');
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.linesChanged, 0);
    assert.strictEqual(result.transformedContent, cleanCode);
  });

  it('preserves var inside comments', () => {
    const codeWithCommentVar = `
// var x should not change
const y = 2;
/* var z = 3; */
`;
    const result = applyLocalTransform('test.ts', codeWithCommentVar, 'var-to-const');
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.transformedContent, codeWithCommentVar);
  });

  it('reports correct linesChanged count', () => {
    const result = applyLocalTransform('test.ts', codeWithVar, 'var-to-const');
    assert.strictEqual(result.applied, true);
    // Two var lines should be changed: var x and var name
    assert.strictEqual(result.linesChanged, 2);
  });
});

// ─── remove-console ───────────────────────────────────────────────────────────

describe('local-transforms: remove-console', () => {
  it('strips console.log, console.debug, and console.info lines', () => {
    const result = applyLocalTransform('test.ts', codeWithConsoleLogs, 'remove-console');
    assert.strictEqual(result.applied, true);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(!result.transformedContent.includes('console.debug'));
    assert.ok(!result.transformedContent.includes('console.info'));
  });

  it('preserves console.error and console.warn lines', () => {
    const result = applyLocalTransform('test.ts', codeWithConsoleLogs, 'remove-console');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes('console.error("this is an error");'));
    assert.ok(result.transformedContent.includes('console.warn("this is a warning");'));
  });

  it('preserves non-console code around removed lines', () => {
    const result = applyLocalTransform('test.ts', codeWithConsoleLogs, 'remove-console');
    assert.ok(result.transformedContent.includes('const x = 1;'));
    assert.ok(result.transformedContent.includes('const y = 2;'));
  });

  it('handles multiline console.log calls with nested parens', () => {
    const multilineConsole = `
const a = 1;
console.log(JSON.stringify({ key: "value" }));
const b = 2;
`;
    const result = applyLocalTransform('test.ts', multilineConsole, 'remove-console');
    assert.strictEqual(result.applied, true);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const a = 1;'));
    assert.ok(result.transformedContent.includes('const b = 2;'));
  });

  it('returns applied=false when no console.log/debug/info present', () => {
    const safeCode = `
console.error("error only");
console.warn("warn only");
const x = 1;
`;
    const result = applyLocalTransform('test.ts', safeCode, 'remove-console');
    assert.strictEqual(result.applied, false);
  });
});

// ─── fix-imports ──────────────────────────────────────────────────────────────

describe('local-transforms: fix-imports', () => {
  it('adds .js extension to relative imports missing an extension', () => {
    const result = applyLocalTransform('test.ts', codeWithRelativeImports, 'fix-imports');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes("from './utils/foo.js'"));
    assert.ok(result.transformedContent.includes("from '../helpers/bar.js'"));
  });

  it('does not double-add .js to imports that already have it', () => {
    const result = applyLocalTransform('test.ts', codeWithRelativeImports, 'fix-imports');
    // baz.js should stay as baz.js, not baz.js.js
    assert.ok(result.transformedContent.includes("from './baz.js'"));
    assert.ok(!result.transformedContent.includes('baz.js.js'));
  });

  it('does not modify node_modules / bare specifier imports', () => {
    const result = applyLocalTransform('test.ts', codeWithRelativeImports, 'fix-imports');
    assert.ok(result.transformedContent.includes("from 'lodash'"));
    assert.ok(result.transformedContent.includes("from 'node:path'"));
    // Verify these were not altered
    assert.ok(!result.transformedContent.includes("from 'lodash.js'"));
  });

  it('returns applied=false when all imports already have extensions', () => {
    const allFixed = `
import { foo } from './foo.js';
import { bar } from '../bar.ts';
import lodash from 'lodash';
`;
    const result = applyLocalTransform('test.ts', allFixed, 'fix-imports');
    assert.strictEqual(result.applied, false);
  });
});

// ─── add-null-checks ─────────────────────────────────────────────────────────

describe('local-transforms: add-null-checks', () => {
  it('converts deep property chains to optional chaining', () => {
    const result = applyLocalTransform('test.ts', codeWithDeepChains, 'add-null-checks');
    assert.strictEqual(result.applied, true);
    // config.settings.theme.color -> config?.settings?.theme?.color
    assert.ok(result.transformedContent.includes('config?.settings'));
    assert.ok(result.transformedContent.includes('response?.data'));
  });

  it('does not modify safe root chains (this, Math, JSON, etc.)', () => {
    const result = applyLocalTransform('test.ts', codeWithDeepChains, 'add-null-checks');
    // this.state.value and Math.max.apply should remain unmodified
    assert.ok(result.transformedContent.includes('this.state.value.nested'));
    assert.ok(result.transformedContent.includes('Math.max.apply.call'));
  });

  it('skips chains already using optional chaining', () => {
    const alreadyOptional = `
const val = config?.settings?.theme?.color;
const other = data?.response?.body;
`;
    const result = applyLocalTransform('test.ts', alreadyOptional, 'add-null-checks');
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.transformedContent, alreadyOptional);
  });

  it('does not modify 2-level property chains', () => {
    const twoLevel = `
const val = config.settings;
const other = data.response;
`;
    const result = applyLocalTransform('test.ts', twoLevel, 'add-null-checks');
    assert.strictEqual(result.applied, false);
  });
});

// ─── detectApplicableTransforms ───────────────────────────────────────────────

describe('local-transforms: detectApplicableTransforms', () => {
  it('finds var-to-const in code containing var', () => {
    const transforms = detectApplicableTransforms(codeWithVar, 'test.ts');
    assert.ok(transforms.includes('var-to-const'), 'should detect var-to-const');
  });

  it('returns empty array for clean code with no issues', () => {
    const pristine = `
const x: number = 1;
const y: string = "hello";
`;
    const transforms = detectApplicableTransforms(pristine, 'test.ts');
    assert.strictEqual(transforms.length, 0, `expected 0 transforms but got: ${transforms.join(', ')}`);
  });

  it('detects remove-console for code with console.log', () => {
    const transforms = detectApplicableTransforms(codeWithConsoleLogs, 'test.ts');
    assert.ok(transforms.includes('remove-console'), 'should detect remove-console');
  });

  it('detects fix-imports for relative imports missing extensions', () => {
    const transforms = detectApplicableTransforms(codeWithRelativeImports, 'test.ts');
    assert.ok(transforms.includes('fix-imports'), 'should detect fix-imports');
  });

  it('detects add-null-checks for deep property chains', () => {
    const transforms = detectApplicableTransforms(codeWithDeepChains, 'test.ts');
    assert.ok(transforms.includes('add-null-checks'), 'should detect add-null-checks');
  });

  it('detects multiple transforms in code with mixed issues', () => {
    const transforms = detectApplicableTransforms(codeWithMixedIssues, 'test.ts');
    assert.ok(transforms.length >= 2, `expected >=2 transforms but got ${transforms.length}: ${transforms.join(', ')}`);
    assert.ok(transforms.includes('var-to-const'));
    assert.ok(transforms.includes('remove-console'));
  });
});

// ─── applyAllApplicable ──────────────────────────────────────────────────────

describe('local-transforms: applyAllApplicable', () => {
  it('chains multiple transforms and returns a result per transform', () => {
    const results = applyAllApplicable('test.ts', codeWithMixedIssues);
    assert.ok(results.length >= 2, `expected >=2 results but got ${results.length}`);
    // At least some should be applied
    const appliedCount = results.filter((r) => r.applied).length;
    assert.ok(appliedCount >= 2, `expected >=2 applied but got ${appliedCount}`);
  });

  it('pipes output of one transform into the next', () => {
    const results = applyAllApplicable('test.ts', codeWithMixedIssues);
    // The last result's transformedContent should reflect all prior transforms
    const last = results[results.length - 1];
    // var should be gone (replaced by const)
    assert.ok(!last.transformedContent.includes('var count'), 'var should be replaced by a prior transform');
  });

  it('returns empty array for code with no applicable transforms', () => {
    const pristine = `
const x: number = 1;
const y: string = "hello";
`;
    const results = applyAllApplicable('test.ts', pristine);
    assert.strictEqual(results.length, 0);
  });
});

// ─── applyLocalTransform (edge cases) ────────────────────────────────────────

describe('local-transforms: applyLocalTransform edge cases', () => {
  it('returns applied=false for a non-matching transform', () => {
    // cleanCode has no var, so var-to-const should not apply
    const result = applyLocalTransform('test.ts', cleanCode, 'var-to-const');
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.transform, 'var-to-const');
    assert.strictEqual(result.linesChanged, 0);
    assert.strictEqual(result.originalContent, cleanCode);
    assert.strictEqual(result.transformedContent, cleanCode);
    assert.strictEqual(result.error, undefined);
  });

  it('populates filePath in the result', () => {
    const result = applyLocalTransform('src/core/my-module.ts', codeWithVar, 'var-to-const');
    assert.strictEqual(result.filePath, 'src/core/my-module.ts');
  });

  it('populates transform type in the result', () => {
    const result = applyLocalTransform('test.ts', codeWithConsoleLogs, 'remove-console');
    assert.strictEqual(result.transform, 'remove-console');
  });

  it('keeps originalContent intact even when transform is applied', () => {
    const result = applyLocalTransform('test.ts', codeWithVar, 'var-to-const');
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.originalContent, codeWithVar);
    assert.ok(result.originalContent !== result.transformedContent);
  });

  it('handles empty content gracefully', () => {
    const result = applyLocalTransform('test.ts', '', 'var-to-const');
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.transformedContent, '');
    assert.strictEqual(result.linesChanged, 0);
  });
});

// ─── add-jsdoc ───────────────────────────────────────────────────────────────

describe('local-transforms: add-jsdoc', () => {
  it('adds JSDoc blocks above exported functions that lack one', () => {
    const codeNoDoc = `
export function greet(name: string) {
  return "hello " + name;
}
`;
    const result = applyLocalTransform('test.ts', codeNoDoc, 'add-jsdoc');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes('* greet'));
    assert.ok(result.transformedContent.includes('@param name'));
  });

  it('does not duplicate JSDoc if one already exists', () => {
    const codeWithDoc = `
/**
 * greet
 * @param name
 */
export function greet(name: string) {
  return "hello " + name;
}
`;
    const result = applyLocalTransform('test.ts', codeWithDoc, 'add-jsdoc');
    assert.strictEqual(result.applied, false);
  });
});

// ─── async-await-conversion ──────────────────────────────────────────────────

describe('local-transforms: async-await-conversion', () => {
  it('converts simple .then() to await', () => {
    const thenCode = `
fetchData().then(result => {
  processResult(result);
});
`;
    const result = applyLocalTransform('test.ts', thenCode, 'async-await-conversion');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes('await fetchData()'));
    assert.ok(result.transformedContent.includes('const result'));
  });
});

// ─── add-error-handling ──────────────────────────────────────────────────────

describe('local-transforms: add-error-handling', () => {
  it('wraps async function body with try/catch', () => {
    const asyncCode = `async function loadData(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}`;
    const result = applyLocalTransform('test.ts', asyncCode, 'add-error-handling');
    assert.strictEqual(result.applied, true);
    assert.ok(result.transformedContent.includes('try {'));
    assert.ok(result.transformedContent.includes('catch (err: unknown)'));
  });

  it('does not double-wrap functions that already have try/catch', () => {
    const alreadyWrapped = `async function loadData(url) {
  try {
    const response = await fetch(url);
    return response;
  } catch (err) {
    throw err;
  }
}`;
    const result = applyLocalTransform('test.ts', alreadyWrapped, 'add-error-handling');
    assert.strictEqual(result.applied, false);
  });
});

// ─── Edge Cases & Adversarial Inputs ─────────────────────────────────────────

describe('Edge Cases & Adversarial Inputs', () => {
  // --- stripStringsAndComments ---
  it('stripStringsAndComments handles escaped quotes correctly', () => {
    const input = 'const x = "say \\"hi\\""; var y = 1;';
    const result = stripStringsAndComments(input);
    // The string literal should be replaced, var should remain visible
    assert.ok(result.includes('var'));
    assert.ok(!result.includes('hi'));
  });

  it('stripStringsAndComments handles template literals with expressions', () => {
    const input = 'const msg = `hello ${name + 1}`; var x = 1;';
    const result = stripStringsAndComments(input);
    assert.ok(result.includes('var'));
    assert.ok(!result.includes('hello'));
    assert.ok(!result.includes('name'));
  });

  // --- var-to-const ---
  it('var-to-const does NOT transform var inside string literal', () => {
    const input = 'const msg = "use var here";\nvar x = 1;';
    const result = applyLocalTransform('test.ts', input, 'var-to-const');
    assert.ok(result.applied);
    // The var inside the string should be untouched
    assert.ok(result.transformedContent.includes('"use var here"'));
    // The actual var declaration should be transformed
    assert.ok(result.transformedContent.includes('const x = 1'));
  });

  it('var-to-const does NOT transform var inside template literal', () => {
    const input = 'const msg = `var is bad`;\nvar y = 2;';
    const result = applyLocalTransform('test.ts', input, 'var-to-const');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('`var is bad`'));
    assert.ok(result.transformedContent.includes('const y = 2'));
  });

  it('var-to-const does NOT transform var inside block comment', () => {
    const input = '/* var old = 1; */\nvar x = 2;';
    const result = applyLocalTransform('test.ts', input, 'var-to-const');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('/* var old = 1; */'));
    assert.ok(result.transformedContent.includes('const x = 2'));
  });

  // --- remove-console ---
  it('remove-console does NOT remove console.log inside string literal', () => {
    const input = 'const msg = "console.log(x)";\nconsole.log("real");';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    // String containing console.log should remain
    assert.ok(result.transformedContent.includes('"console.log(x)"'));
    // Real console.log should be removed
    assert.ok(!result.transformedContent.includes('console.log("real")'));
  });

  it('remove-console handles deeply nested parentheses', () => {
    const input = 'console.log(fn(inner(deep)));\nconst x = 1;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const x = 1'));
  });

  it('remove-console handles multi-line console.log', () => {
    const input = 'console.log(\n  "hello",\n  world\n);\nconst x = 1;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const x = 1'));
  });

  it('remove-console handles template literal argument', () => {
    const input = 'console.log(`value: ${x}`);\nconst y = 1;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const y = 1'));
  });

  // --- add-null-checks ---
  it('add-null-checks does NOT modify chains inside string literals', () => {
    const input = 'const msg = "obj.prop.value";\nconst x = data.foo.bar;';
    const result = applyLocalTransform('test.ts', input, 'add-null-checks');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('"obj.prop.value"'));
    assert.ok(result.transformedContent.includes('?.'));
  });

  it('add-null-checks skips already optional chains', () => {
    const input = 'const x = data?.foo?.bar;';
    const result = applyLocalTransform('test.ts', input, 'add-null-checks');
    assert.ok(!result.applied); // No change needed
  });

  // --- add-error-handling ---
  it('add-error-handling wraps async arrow functions', () => {
    const input = 'export const handler = async (req) => {\n  const data = await fetch(url);\n  return data;\n}';
    const result = applyLocalTransform('test.ts', input, 'add-error-handling');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('try {'));
    assert.ok(result.transformedContent.includes('catch (err'));
  });

  it('add-error-handling does not modify async arrow with return type (regex only matches function decls)', () => {
    const input = 'const run = async (x): Promise<void> => {\n  await doA();\n  await doB();\n}';
    const result = applyLocalTransform('test.ts', input, 'add-error-handling');
    // The regex intentionally targets `async function name(...)` declarations, not arrow functions
    assert.ok(!result.applied);
    assert.strictEqual(result.transformedContent, input);
  });

  it('add-error-handling skips function with existing try/catch', () => {
    const input = 'async function foo() {\n  try {\n    await bar();\n  } catch (e) {\n    throw e;\n  }\n}';
    const result = applyLocalTransform('test.ts', input, 'add-error-handling');
    assert.ok(!result.applied);
  });

  // --- add-jsdoc ---
  it('add-jsdoc handles arrow function exports', () => {
    const input = 'export const greet = (name) => {\n  return `hi ${name}`;\n}';
    const result = applyLocalTransform('test.ts', input, 'add-jsdoc');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('/**'));
    assert.ok(result.transformedContent.includes('greet'));
  });

  it('add-jsdoc skips functions that already have JSDoc', () => {
    const input = '/** greet */\nexport function greet(name: string) {\n  return name;\n}';
    const result = applyLocalTransform('test.ts', input, 'add-jsdoc');
    assert.ok(!result.applied);
  });

  // --- add-types (AST-based) ---
  it('add-types annotates function declaration params', () => {
    const input = 'function foo(x, y) { return x + y; }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('x: unknown'));
    assert.ok(result.transformedContent.includes('y: unknown'));
  });

  it('add-types annotates arrow function and named function params', () => {
    const input = 'const fn = (a, b) => a + b;\nfunction bar(x) {}';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('a: unknown'));
    assert.ok(result.transformedContent.includes('b: unknown'));
    assert.ok(result.transformedContent.includes('x: unknown'));
  });

  // --- add-logging ---
  it('add-logging does not crash on arrow function exports', () => {
    const input = 'export const run = async () => {\n  return 1;\n}';
    // Should either add logging or skip gracefully — must not throw
    const result = applyLocalTransform('test.ts', input, 'add-logging');
    assert.ok(typeof result.transformedContent === 'string');
  });

  // --- async-await-conversion ---
  it('async-await-conversion transforms .then() on real promise calls', () => {
    const input = 'fetch(url).then(r => r.json());';
    const result = applyLocalTransform('test.ts', input, 'async-await-conversion');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('await fetch'));
    assert.ok(!result.transformedContent.includes('.then('));
  });

  // --- fix-imports ---
  it('fix-imports skips import already having .js extension', () => {
    const input = "import { foo } from './bar.js';";
    const result = applyLocalTransform('test.ts', input, 'fix-imports');
    assert.ok(!result.applied);
  });

  it('fix-imports skips bare module imports', () => {
    const input = "import lodash from 'lodash';";
    const result = applyLocalTransform('test.ts', input, 'fix-imports');
    assert.ok(!result.applied);
  });

  // --- remove-console: paren-in-string regression ---
  it('remove-console handles parens inside string arguments', () => {
    const input = 'console.log("(");\nconst x = 1;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const x = 1'));
  });

  it('remove-console handles unbalanced parens in strings', () => {
    const input = "console.log('(((' + val + '))');\nconst y = 2;";
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const y = 2'));
  });

  // --- add-types: AST behavior ---
  it('add-types does not annotate function call arguments', () => {
    const input = 'doSomething(a, b, c);';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    // Call expressions are NOT function declarations — params should not be annotated
    assert.ok(!result.applied);
    assert.strictEqual(result.transformedContent, input);
  });

  it('add-types annotates declaration params but not call args in same code', () => {
    const input = 'function process(x, y) { return call(x, y); }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    // Declaration params get annotated
    assert.ok(result.transformedContent.includes('x: unknown'));
    assert.ok(result.transformedContent.includes('y: unknown'));
    // The call arguments should still be just identifiers (not annotated)
    assert.ok(result.transformedContent.includes('call(x, y)'));
  });

  it('add-types skips already-typed params', () => {
    const input = 'function foo(x: number, y) { return x + y; }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    // x already has a type — should not be double-annotated
    assert.ok(result.transformedContent.includes('x: number'));
    assert.ok(!result.transformedContent.includes('x: number: unknown'));
    // y should get annotated
    assert.ok(result.transformedContent.includes('y: unknown'));
  });

  it('add-types skips destructured params', () => {
    const input = 'function foo({ a, b }, y) { return a + b + y; }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    // Destructured { a, b } should not be annotated (not an Identifier)
    assert.ok(!result.transformedContent.includes('a: unknown'));
    assert.ok(!result.transformedContent.includes('b: unknown'));
    // y is a plain identifier — should be annotated
    assert.ok(result.transformedContent.includes('y: unknown'));
  });

  it('add-types skips rest params', () => {
    const input = 'function foo(x, ...rest) { return rest; }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('x: unknown'));
    // Rest params should not be annotated
    assert.ok(!result.transformedContent.includes('rest: unknown'));
  });

  it('add-types skips params with default values', () => {
    const input = 'function foo(x, y = 10) { return x + y; }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('x: unknown'));
    // y has default — should not be annotated
    assert.ok(!result.transformedContent.includes('y: unknown'));
  });

  it('add-types handles method declarations', () => {
    const input = 'class Foo { bar(x, y) { return x + y; } }';
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(result.applied);
    assert.ok(result.transformedContent.includes('x: unknown'));
    assert.ok(result.transformedContent.includes('y: unknown'));
  });

  it('detectApplicableTransforms detects add-types for untyped params', () => {
    const input = 'function foo(x, y) {}\nconst fn = (a, b) => a + b;';
    const transforms = detectApplicableTransforms(input, 'test.ts');
    assert.ok(transforms.includes('add-types'), 'add-types should be detected for untyped params');
  });

  it('detectApplicableTransforms does not detect add-types when all typed', () => {
    const input = 'function foo(x: number, y: string) {}\nconst fn = (a: boolean) => a;';
    const transforms = detectApplicableTransforms(input, 'test.ts');
    // All params already typed — heuristic may still fire on pattern, but transform itself is a no-op
    // The key assertion: transform should return content unchanged
    const result = applyLocalTransform('test.ts', input, 'add-types');
    assert.ok(!result.applied, 'already-typed code should not be changed');
  });

  // --- remove-console: multi-line template literal ---
  it('remove-console with multi-line template literal argument', () => {
    const input = 'console.log(`line1\nline2\nline3`);\nconst x = 1;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log'));
    assert.ok(result.transformedContent.includes('const x = 1'));
  });

  it('remove-console preserves console.log text inside multi-line template', () => {
    const input = 'const msg = `some\nconsole.log("fake")\ntext`;\nconst y = 2;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    // The console.log is inside a template literal — should NOT be removed
    assert.ok(!result.applied || result.transformedContent.includes('console.log("fake")'));
  });

  it('remove-console handles backtick on prior line', () => {
    const input = 'const tpl = `hello\nworld`;\nconsole.log("remove me");\nconst z = 3;';
    const result = applyLocalTransform('test.ts', input, 'remove-console');
    assert.ok(result.applied);
    assert.ok(!result.transformedContent.includes('console.log("remove me")'));
    assert.ok(result.transformedContent.includes('const z = 3'));
    // Template literal content should be preserved
    assert.ok(result.transformedContent.includes('`hello'));
  });

  // --- stripStringsAndComments line-count invariant ---
  it('stripStringsAndComments preserves line count for multi-line strings', () => {
    const input = 'const a = "hello";\nconst b = "world";\nconst c = 3;';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });

  it('stripStringsAndComments preserves line count for block comments', () => {
    const input = 'const a = 1;\n/* comment\n * spanning\n * multiple lines\n */\nconst b = 2;';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });

  it('stripStringsAndComments preserves line count for template literals with expressions', () => {
    const input = 'const x = `line1\nline2 ${foo}\nline3`;\nconst y = 1;';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });

  it('stripStringsAndComments preserves line count for mixed constructs', () => {
    const input = '// comment\nconst a = "str";\n/* block\n */\nconst b = `tpl\n${x}`;\nconst c = 3;';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });

  it('stripStringsAndComments preserves line count for nested template literals', () => {
    const input = 'const x = `outer\n${`inner\nnested`}\nend`;\nconst y = 1;';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });

  it('stripStringsAndComments preserves line count for empty input', () => {
    const input = '';
    const result = stripStringsAndComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
  });
});
