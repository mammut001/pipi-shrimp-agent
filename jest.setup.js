// Jest setup - provides browser globals missing in Node.js test environment
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
