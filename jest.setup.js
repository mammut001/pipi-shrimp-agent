// Jest setup - provides browser globals and module mocks missing in Node.js test environment
(function() {
  if (typeof globalThis.localStorage === 'undefined') {
    var store = {};
    globalThis.localStorage = {
      getItem: function(key) { return key in store ? store[key] : null; },
      setItem: function(key, value) { store[key] = String(value); },
      removeItem: function(key) { delete store[key]; },
      clear: function() { Object.keys(store).forEach(function(k) { delete store[k]; }); },
      get length() { return Object.keys(store).length; },
      key: function(i) { var keys = Object.keys(store); return i < keys.length ? keys[i] : null; }
    };
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    var sstore = {};
    globalThis.sessionStorage = {
      getItem: function(key) { return key in sstore ? sstore[key] : null; },
      setItem: function(key, value) { sstore[key] = String(value); },
      removeItem: function(key) { delete sstore[key]; },
      clear: function() { Object.keys(sstore).forEach(function(k) { delete sstore[k]; }); },
      get length() { return Object.keys(sstore).length; },
      key: function(i) { var keys = Object.keys(sstore); return i < keys.length ? keys[i] : null; }
    };
  }
})();

// Global i18n mock
jest.mock('@/i18n', () => ({
  getCurrentLocale: () => 'en-US',
  setLocale: jest.fn(),
  t: (key) => key,
  addLocaleChangeListener: jest.fn(() => jest.fn()),
  getSupportedLocales: () => [
    { value: 'zh-CN', label: 'Chinese', flag: 'CN' },
    { value: 'en-US', label: 'English', flag: 'US' },
  ],
  convertOldLanguageCode: (code) => (code === 'en' ? 'en-US' : 'zh-CN'),
  convertToOldLanguageCode: (locale) => (locale === 'en-US' ? 'en' : 'zh'),
}));

// Global Tauri API mocks
jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn().mockResolvedValue(undefined),
  transformCallback: jest.fn(() => 'cb-0'),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn().mockResolvedValue(jest.fn()),
  once: jest.fn().mockResolvedValue(jest.fn()),
  emit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: jest.fn().mockResolvedValue(jest.fn()),
    onCloseRequested: jest.fn().mockResolvedValue(jest.fn()),
    close: jest.fn().mockResolvedValue(undefined),
    setTitle: jest.fn().mockResolvedValue(undefined),
    show: jest.fn().mockResolvedValue(undefined),
    hide: jest.fn().mockResolvedValue(undefined),
    minimize: jest.fn().mockResolvedValue(undefined),
    maximize: jest.fn().mockResolvedValue(undefined),
    unmaximize: jest.fn().mockResolvedValue(undefined),
    isMaximized: jest.fn().mockResolvedValue(false),
    setFullscreen: jest.fn().mockResolvedValue(undefined),
    innerSize: jest.fn().mockResolvedValue({ width: 800, height: 600 }),
    outerSize: jest.fn().mockResolvedValue({ width: 800, height: 600 }),
    setSize: jest.fn().mockResolvedValue(undefined),
    setPosition: jest.fn().mockResolvedValue(undefined),
    setResizable: jest.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: jest.fn().mockResolvedValue(undefined),
    startDragging: jest.fn().mockResolvedValue(undefined),
    onResized: jest.fn().mockResolvedValue(jest.fn()),
    label: 'main',
    scaleFactor: jest.fn().mockResolvedValue(1),
  }),
  getAllWindows: jest.fn().mockResolvedValue([]),
}));