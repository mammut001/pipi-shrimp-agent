/**
 * Jest mock for react-markdown
 * Renders raw markdown content as a simple div for testing.
 */
const React = require('react');

function ReactMarkdown({ children, components, remarkPlugins, rehypePlugins, ...props }) {
  return React.createElement('div', { 'data-testid': 'markdown', ...props }, children);
}

module.exports = ReactMarkdown;
module.exports.default = ReactMarkdown;
