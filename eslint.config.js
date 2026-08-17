import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const IGNORES = [
  '**/node_modules/**',
  'client/dist/**',
  'server/data/**',
  'assets/**'
];

const SHARED_RULES = {
  'no-unused-vars': ['error', {
    args: 'none',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    ignoreRestSiblings: true
  }],
  'no-undef': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-binary-expression': 'error',
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-promise-executor-return': ['error', { allowVoid: true }],
  'require-atomic-updates': 'off',
  'no-control-regex': 'off',
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'eqeqeq': ['error', 'always', { null: 'ignore' }]
};

export default [
  { ignores: IGNORES },
  js.configs.recommended,

  {
    files: ['client/src/**/*.{js,jsx}', 'client/scripts/**/*.mjs', 'client/test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...SHARED_RULES,
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react/no-unknown-property': ['error', { ignore: ['css'] }],
      'react/jsx-no-target-blank': ['error', { allowReferrer: false }],
      'react/jsx-key': 'error',
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }]
    }
  },

  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: SHARED_RULES
  },

  {
    files: ['*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: SHARED_RULES
  }
];
