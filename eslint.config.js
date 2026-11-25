import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/', 'blob-report/'] },

  js.configs.recommended,

  {
    rules: {
      // `_`-prefixed names are deliberately unused: destructured-away fields
      // ({ grounded: _g, ...rest }) and required-but-unused parameters.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },

  // Node: the API, the Vercel entry points, scripts, config and the backend tests.
  {
    files: [
      'backend/**/*.js',
      'api/**/*.js',
      'scripts/**/*.{js,mjs}',
      'e2e/**/*.js',
      '*.config.js',
      'frontend/vite.config.js',
    ],
    languageOptions: { globals: globals.node },
  },

  // The React app.
  {
    files: ['frontend/src/**/*.{js,jsx}', 'frontend/tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Props are documented in JSDoc; this codebase doesn't use PropTypes.
      'react/prop-types': 'off',
    },
  },

  // Frontend tests also run in Node (Vitest).
  {
    files: ['frontend/tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // Formatting is Prettier's job; turn off every stylistic rule that would fight it.
  prettier,
];
