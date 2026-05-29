/**
 * Jest noop mock for ESM-only remark/rehype plugins.
 */
module.exports = function noop() { return (tree) => tree; };
module.exports.default = module.exports;
