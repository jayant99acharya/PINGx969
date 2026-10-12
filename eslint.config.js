import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'e2e/report/**', 'e2e/.data/**', 'test-results/**', '.spike/**', 'data/**', 'fixtures/**', 'release/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser }, ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['apps/web/src/**/*.tsx', 'apps/extension/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['apps/extension/**/*.ts', 'apps/extension/**/*.tsx'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
);
