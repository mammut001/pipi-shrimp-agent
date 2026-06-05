module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: { esModuleInterop: true },
    }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\.{1,2}/.*)\.js$': '$1',
    '^@tauri-apps/api/window$': '<rootDir>/tests/__mocks__/tauri-window.cjs',
    '^@tauri-apps/api/image$': '<rootDir>/tests/__mocks__/tauri-image.cjs',
    '^react-markdown$': '<rootDir>/tests/__mocks__/react-markdown.cjs',
    '^remark-gfm$': '<rootDir>/tests/__mocks__/noop.cjs',
    '^rehype-raw$': '<rootDir>/tests/__mocks__/noop.cjs',
    '^@exodus/bytes(/.*)?$': '<rootDir>/tests/__mocks__/exodus-bytes.cjs',
    '^parse5$': '<rootDir>/tests/__mocks__/parse5.cjs',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(react-markdown|remark-gfm|rehype-raw|mdast-util-.*|micromark.*|unified|bail|is-plain-obj|trough|vfile.*|unist-.*|hast-.*|property-information|comma-separated-tokens|space-separated-tokens|decode-named-character-reference|character-entities|ccount|escape-string-regexp|trim-lines|rehype-.*|web-namespaces|zwitch|html-void-elements|stringify-entities|character-entities-html4|devlop|@exodus|whatwg-.*|html-encoding-sniffer)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.node.cjs'],
};
