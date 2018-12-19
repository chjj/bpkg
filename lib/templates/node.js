/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/* global __HASHBANG__, __MODULES__, __TMP__, __BINDINGS__ */

__HASHBANG__

var __node_modules__ = [
__MODULES__
];

var __node_cache__ = Object.create(null);

function __node_require__(id) {
  var cache = __node_cache__[id];

  if (cache)
    return cache.exports;

  var mod = __node_modules__[id];
  var name = mod[0];
  var func = mod[1];

  var _exports = exports;
  var _module = module;

  if (id !== 0) {
    _exports = {};
    _module = {
      id: name,
      exports: _exports,
      parent: module,
      filename: __filename,
      children: [],
      paths: module.paths
    };
  }

  __node_cache__[id] = _module;

  func.call(_exports, _exports, require, _module, __filename, __dirname);

  return _module.exports;
}

// if __BINDINGS__
function __node_dlopen__(module, name, raw) {
  var fs = require('fs');
  var x = (Math.random() * 0x100000000) >>> 0;
  var y = (Math.random() * 0x100000000) >>> 0;

  var prefix = x.toString(32) + y.toString(32);
  var file = prefix + '-' + name;
  var path = __TMP__ + file;

  raw = raw.replace(/\s+/g, '');

  fs.writeFileSync(path, raw, {
    encoding: 'base64',
    mode: 0o700,
    flag: 'wx'
  });

  try {
    process.dlopen(module, path);
  } finally {
    fs.unlinkSync(path);
  }
}
// endif

function __node_error__(msg) {
  throw new Error(msg);
}

__node_require__(0);
