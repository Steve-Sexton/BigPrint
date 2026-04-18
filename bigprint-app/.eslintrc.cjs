/* ESLint (flat legacy) configuration for BigPrint.
 * Focused on surfacing real bugs — not style — since Prettier handles format.
 */
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    // Enable type-aware rules (no-floating-promises etc.). Uses a dedicated
    // tsconfig that unions the web + node projects with a full lib set so
    // ESLint can resolve every source file without shared-tree DOM errors.
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['out/', 'dist/', 'node_modules/', 'tests/'],
  rules: {
    // The app's UI code builds React elements without importing React directly —
    // react 17+ JSX transform doesn't need it.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    // Strictness on async / promise patterns that bite in an Electron IPC codebase.
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-unused-vars': 'off',                  // superseded by @typescript-eslint/no-unused-vars
    'react-hooks/exhaustive-deps': 'warn',
    'react/display-name': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'smart'],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', '**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
}
