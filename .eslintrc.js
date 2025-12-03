module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    browser: true,
    webextensions: true,
    es2020: true
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-namespace': 'off', // Needed for Chrome extension type augmentation
    'no-console': ['warn', { allow: ['warn', 'error'] }]
  },
  overrides: [
    {
      // Type declaration files need relaxed rules
      files: ['src/types/*.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off' // Type declarations may not be directly used
      }
    }
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '!.eslintrc.js']
};
