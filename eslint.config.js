import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['**/dist/**', '**/coverage/**', '**/worker-configuration.d.ts'] },
  eslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { projectService: true },
      globals: { ...globals.browser, ...globals.node, ...globals.worker }
    },
    plugins: { '@typescript-eslint': tseslint, 'react-hooks': hooks },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error'
    }
  }
];
