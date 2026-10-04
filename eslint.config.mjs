import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'delivery/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next.map((config) => ({ ...config, files: ['frontend/**/*.{ts,tsx,js,mjs}'] })),
  {
    files: ['frontend/**/*.{ts,tsx,js,mjs}'],
    settings: { next: { rootDir: 'frontend/' } },
    rules: { '@next/next/no-html-link-for-pages': ['error', 'frontend/src/app'] },
  },
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
];
