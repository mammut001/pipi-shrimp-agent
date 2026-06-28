const isWin32 = process.platform === 'win32';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // AutoResearch integration tests share a process-global store and shell out heavily;
  // parallel workers on Windows cause flaky metrics.jsonl / store races.
  // AutoResearch integration tests share global store state; keep workers low on
  // Windows (historical flakes) and macOS (parallel tmp-dir races).
  ...(isWin32 || process.platform === 'darwin' ? { maxWorkers: 1 } : {}),
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/?(*.)+(spec|test).{ts,tsx}'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: { esModuleInterop: true },
    }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@exodus/bytes|html-encoding-sniffer)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
};