/**
 * Jest mock for @tauri-apps/api/window
 * Provides a minimal getCurrentWindow() that works in Node.js test environment.
 */
const noop = async () => () => {};

module.exports = {
  getCurrentWindow: () => ({
    listen: noop,
    once: noop,
    onClose: noop,
    close: noop,
    setFocus: noop,
    minimize: noop,
    maximize: noop,
    unmaximize: noop,
    show: noop,
    hide: noop,
    center: noop,
    setTitle: noop,
    isMaximized: async () => false,
    isMinimized: async () => false,
    isVisible: async () => true,
    innerSize: async () => ({ width: 800, height: 600 }),
    outerSize: async () => ({ width: 800, height: 600 }),
    label: 'main',
  }),
  Window: class MockWindow {},
  PhysicalSize: class MockPhysicalSize {},
  LogicalSize: class MockLogicalSize {},
  PhysicalPosition: class MockPhysicalPosition {},
  LogicalPosition: class MockLogicalPosition {},
  UserAttentionType: { Critical: 1, Informational: 2 },
  Effect: {},
  Effects: {},
};
