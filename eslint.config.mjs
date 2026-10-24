import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'off',
      'no-var': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      'out/**',
      'dist/**',
      'archive/**',
      'src/webview/vendor/**',
      'src/webview/*.js',
      'src/webview/*.map',
      'vitest.config.*',
      'legacy-stub/**',
      'legacy-stub-interactive/**',
    ],
  }
);
