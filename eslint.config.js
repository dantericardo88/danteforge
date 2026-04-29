import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.danteforge/**',
      '.danteforge-worktrees/**',
      'vscode-extension/dist/**',
      'vscode-extension/node_modules/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['scripts/**/*.mjs', 'hooks/**/*.mjs', 'lib/**/*.js'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
];
