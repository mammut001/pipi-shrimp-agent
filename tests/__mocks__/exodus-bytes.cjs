/**
 * Jest mock for @exodus/bytes
 * Provides CJS-compatible stubs for the functions used by jsdom/html-encoding-sniffer.
 */

// Minimal stubs — these are only needed for jsdom's HTML encoding sniffing
// which is not exercised in most tests.

function getBOMEncoding() {
  return null;
}

function labelToName() {
  return null;
}

function normalizeEncoding(enc) {
  return enc;
}

function isomorphicDecode(buf) {
  return typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
}

function isomorphicEncode(str) {
  return new TextEncoder().encode(str);
}

module.exports = {
  getBOMEncoding,
  labelToName,
  normalizeEncoding,
  isomorphicDecode,
  isomorphicEncode,
  TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder,
  TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : require('util').TextEncoder,
};
