import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'gitnexus/vendor/**',
      'gitnexus-web/src/vendor/**',
      'gitnexus/test/fixtures/**',
      'gitnexus-web/test/fixtures/**',
      'gitnexus-web/playwright-report/**',
      'gitnexus-web/test-results/**',
      '**/*.d.ts',
      '.claude/**',
      '.history/**',
    ],
  },

  // Base TypeScript config for all packages
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // Unused imports — auto-fixable
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],

      // TypeScript quality
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports plugin
      'no-unused-vars': 'off', // handled by unused-imports plugin
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General quality
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // CLI/server packages — `console.log` IS the contract (CLI tool data output
  // on stdout, e.g. `gitnexus query | jq`; server pretty-printed banners).
  // Diagnostic logging (`warn`/`error`/`debug`/`info`) goes through pino like
  // the rest of the codebase.
  {
    files: ['gitnexus/src/cli/**/*.ts', 'gitnexus/src/server/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['log'] }],
    },
  },

  // Forcing function for the pino migration. Severity is `error` — the
  // codebase-wide migration is complete; new `console.*` in core source
  // must fail lint. CLI/server are exempt above (legitimate stdout output).
  // Tests, bin scripts, and the logger module itself remain exempt.
  {
    files: ['gitnexus/src/**/*.ts'],
    ignores: ['gitnexus/src/cli/**', 'gitnexus/src/server/**', 'gitnexus/src/core/logger.ts'],
    rules: {
      'no-console': 'error',
    },
  },

  // React-specific rules for gitnexus-web
  {
    files: ['gitnexus-web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Disable formatting rules (prettier handles those)
  prettierConfig,
];
