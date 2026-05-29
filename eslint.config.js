import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '.codex-*']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
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
