import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'node_modules/**',
    'backups/**',
    'output/**',
    'tmp/**',
    'coverage/**',
    '.agents/**',
    '.codex-*',
    '.codex*/**',
  ]),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.js', '*.cjs'],
    extends: [
      js.configs.recommended,
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      'no-constant-binary-expression': 'warn',
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'warn',
      'no-unreachable': 'warn',
      'no-unused-vars': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
])
