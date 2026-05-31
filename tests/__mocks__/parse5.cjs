/**
 * Jest mock for parse5 8.x (ESM-only)
 * Provides minimal CJS-compatible stubs for the functions jsdom uses.
 * parse5 is used by jsdom for HTML parsing/serialization.
 */

function parse(html, options) {
  // Return a minimal document tree
  return {
    nodeName: '#document',
    childNodes: [],
    mode: 'quirks',
  };
}

function parseFragment(fragmentContext, html, options) {
  return {
    nodeName: '#document-fragment',
    childNodes: [],
  };
}

function serialize(node, options) {
  return '';
}

function serializeOuter(node, options) {
  return '';
}

const defaultTreeAdapter = {
  createDocument() { return { nodeName: '#document', childNodes: [], mode: 'quirks' }; },
  createDocumentFragment() { return { nodeName: '#document-fragment', childNodes: [] }; },
  createElement(tagName, namespaceURI, attrs) { return { nodeName: tagName, tagName, attrs, childNodes: [], parentNode: null }; },
  createTextNode(data) { return { nodeName: '#text', data, parentNode: null }; },
  createCommentNode(data) { return { nodeName: '#comment', data, parentNode: null }; },
  appendChild(parentNode, newNode) { newNode.parentNode = parentNode; (parentNode.childNodes || []).push(newNode); },
  insertBefore(parentNode, newNode, referenceNode) { newNode.parentNode = parentNode; const idx = (parentNode.childNodes || []).indexOf(referenceNode); if (idx >= 0) parentNode.childNodes.splice(idx, 0, newNode); else parentNode.childNodes.push(newNode); },
  detachNode(node) { if (node.parentNode) { const idx = node.parentNode.childNodes.indexOf(node); if (idx >= 0) node.parentNode.childNodes.splice(idx, 1); node.parentNode = null; } },
  setDocumentType(document, name, publicId, systemId) {},
  setQuirksMode(document) { document.mode = 'quirks'; },
  isQuirksMode(document) { return document.mode === 'quirks'; },
  adoptAttributes(target, attrs) {},
  getFirstChild(node) { return (node.childNodes || [])[0]; },
  getChildNodes(node) { return node.childNodes || []; },
  getParentNode(node) { return node.parentNode; },
  getAttrList(node) { return node.attrs || []; },
  getTagName(node) { return node.tagName || ''; },
  getNamespaceURI(node) { return 'http://www.w3.org/1999/xhtml'; },
  getTextNodeContent(node) { return node.data || ''; },
  getCommentNodeContent(node) { return node.data || ''; },
  getDocumentTypeNodeName(node) { return node.name || ''; },
  getDocumentTypeNodePublicId(node) { return node.publicId || ''; },
  getDocumentTypeNodeSystemId(node) { return node.systemId || ''; },
  isTextNode(node) { return node.nodeName === '#text'; },
  isCommentNode(node) { return node.nodeName === '#comment'; },
  isDocumentTypeNode(node) { return node.nodeName === '#documentType'; },
  isElementNode(node) { return !!node.tagName; },
};

module.exports = {
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  defaultTreeAdapter,
  Parser: class Parser {},
  Tokenizer: class Tokenizer {},
  TokenizerMode: {},
  ErrorCodes: {},
  foreignContent: {},
  html: {},
  Token: {},
};
