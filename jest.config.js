module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.tsx'
  ],
  moduleNameMapper: {
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@content/(.*)$': '<rootDir>/src/content/$1',
    '^@background/(.*)$': '<rootDir>/src/background/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@platforms/(.*)$': '<rootDir>/src/platforms/$1',
    // Mock environment module for all tests
    '^(\\.\\./)*config/environment$': '<rootDir>/tests/__mocks__/environment.ts'
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/**/*'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testTimeout: 10000,
  verbose: true
};
