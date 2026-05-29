/**
 * Jest mock for @tauri-apps/api/image
 */
class MockImage {
  static fromPath() { return Promise.resolve(new MockImage()); }
  static fromBytes() { return Promise.resolve(new MockImage()); }
  static fromResource() { return Promise.resolve(new MockImage()); }
  static rgba() { return new MockImage(); }
  async close() {}
  async size() { return { width: 0, height: 0 }; }
  async toRgba() { return new Uint8Array(0); }
  async toPng() { return new Uint8Array(0); }
  async toJpeg() { return new Uint8Array(0); }
  async toIco() { return new Uint8Array(0); }
}

module.exports = {
  Image: MockImage,
  default: MockImage,
  Transform: {},
};
