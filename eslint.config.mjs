import parser from '@typescript-eslint/parser';
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'backups/**'] },
  {
    files: ['apps/**/*.{ts,tsx}'],
    languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'constructor-super': 'error',
      'no-unreachable': 'error',
    },
  },
];
