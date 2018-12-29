/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/*
  global __HASHBANG__
  global __LICENSE__
  global __REQUIRES__
  global __MODULES__
  global __BINDINGS__
*/

__HASHBANG__

// if __LICENSE__
__LICENSE__
// endif

var __node_modules__ = [
__MODULES__
];

var __node_cache__ = [];

function __node_error__(location) {
  var err = new Error('Cannot find module \'' + location + '\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

function __node_require__(id) {
  if ((id >>> 0) !== id || id > __node_modules__.length)
    return __node_error__(id);

  while (__node_cache__.length <= id)
    __node_cache__.push(null);

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
      loaded: false,
      children: [],
      paths: module.paths.slice(),
      require: module.require.bind(module)
    };
  }

  __node_cache__[id] = _module;

  try {
    func.call(_exports, _exports, require, _module, __filename, __dirname);
  } catch (e) {
    delete __node_cache__[id];
    throw e;
  }

  if (id !== 0)
    _module.loaded = true;

  return _module.exports;
}

// if __BINDINGS__
function __node_dlopen__(module, name, raw) {
  if (module == null
      || typeof module !== 'object'
      || typeof name !== 'string'
      || typeof raw !== 'string') {
    __node_error__(name);
    return;
  }

  var fs = require('fs');
  var os = require('os');
  var join = require('path').join;

  var x = (Math.random() * 0x100000000) >>> 0;
  var y = (Math.random() * 0x100000000) >>> 0;
  var prefix = x.toString(32) + y.toString(32);
  var file = prefix + '-' + name;
  var path = join(os.tmpdir(), file);
  var b64 = raw.replace(/\s+/g, '');

  fs.writeFileSync(path, b64, {
    encoding: 'base64',
    mode: 448,
    flag: 'wx'
  });

  try {
    process.dlopen(module, path);
  } finally {
    fs.unlinkSync(path);
  }
}
// endif

// if __REQUIRES__
;(function() {
  var requires = __REQUIRES__;
  for (var i = 0; i < requires.length; i++)
    __node_require__(requires[i]);
})();
// endif

__node_require__(0);
