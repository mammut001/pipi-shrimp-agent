const { TextDecoder, TextEncoder } = require('node:util');
module.exports = {
  TextDecoder,
  TextEncoder,
  TextDecoderStream: typeof TextDecoderStream !== 'undefined' ? TextDecoderStream : undefined,
  TextEncoderStream: typeof TextEncoderStream !== 'undefined' ? TextEncoderStream : undefined,
  normalizeEncoding: (enc) => String(enc || 'utf-8').toLowerCase().replace(/[-_]/g, ''),
  getBOMEncoding: () => null,
  labelToName: (label) => String(label || 'utf-8').toLowerCase().replace(/[-_]/g, ''),
  legacyHookDecode: (input) => input,
  isomorphicDecode: (input) => input,
};