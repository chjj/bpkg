/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/* eslint prefer-arrow-callback: "off" */
/* global __HASHBANG__ */
/* global __HEADER__ */
/* global __ENV__ */
/* global __GLOBALS__ */
/* global __REQUIRES__ */
/* global __MODULES__ */
/* global __BINDINGS__ */
/* global __EXPORTS__ */

__HASHBANG__

// if __HEADER__
__HEADER__
// endif

// if __ESM__
import __module__ from 'module';
import __path__ from 'path';
import __url__ from 'url';

var __filename = __url__.fileURLToPath(import.meta.url);
var __dirname = __path__.dirname(__filename);
var require = __module__.createRequire
  ? __module__.createRequire(__filename)
  : __module__.createRequireFromPath(__filename);
var exports = {};
var module = {
  id: __filename,
  path: __dirname,
  exports: exports,
  parent: null,
  filename: __filename,
  isPreloading: false,
  loaded: false,
  children: [],
  paths: [],
  require: require
};
// endif

var __node_modules__ = [
__MODULES__
];

// if __META__
var __node_filename__ = process.platform === 'win32'
  ? '/' + __filename.replace(/\\/g, '/')
  : __filename;

var __node_url__ = 'file://' + encodeURI(__node_filename__);
// endif

var __node_cache__ = [];

function __node_error__(specifier) {
  var err = new Error('Cannot find module \'' + specifier + '\'');
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

function __node_throw__(specifier) {
  throw __node_error__(specifier);
}

function __node_reject__(specifier) {
  return Promise.reject(__node_error__(specifier));
}

function __node_require__(id) {
  if ((id >>> 0) !== id || id > __node_modules__.length)
    return __node_throw__(id);

  while (__node_cache__.length <= id)
    __node_cache__.push(null);

  var cache = __node_cache__[id];

// if __ESM__
  if (id !== 0 && cache && cache._promise)
    return cache._promise;
// endif

  if (cache)
    return cache.exports;

  var mod = __node_modules__[id];
  var name = mod[0];
  var path = mod[1];
  var esm = mod[2];
  var func = mod[3];
  var meta;

// if __ESM__
  meta = {
    __proto__: null,
    url: import.meta.url,
    filename: import.meta.filename,
    dirname: import.meta.dirname,
    resolve: import.meta.resolve
  };
// endif

// if __META__
  meta = {
    __proto__: null,
    url: __node_url__,
    filename: __filename,
    dirname: __dirname,
    resolve: require.resolve
  };
// endif

  var _exports = exports;
  var _module = module;

  if (id !== 0) {
    _exports = {};
    _module = {
      id: '/' + name + path,
      path: ('/' + name + path).split('/').slice(0, -1).join('/'),
      exports: _exports,
      parent: module.parent,
      filename: module.filename,
      isPreloading: false,
      loaded: false,
      children: module.children,
      paths: module.paths,
      require: require
    };
  }

  __node_cache__[id] = _module;

// if __ESM__
  if (esm) {
    var _promise = new Promise(function(resolve, reject) {
      var promise = func.call(void 0, _exports, meta, _module);

      promise.then(function() {
        __node_modules__[id] = null;
        if (id !== 0)
          _module.loaded = true;
        resolve(_module.exports);
      }).catch(function(err) {
        __node_cache__[id] = null;
        reject(err);
      });
    });

    if (id !== 0)
      _module._promise = _promise;

    return _promise;
  }

  if (id !== 0)
    _module._promise = null;
// endif

  try {
    if (esm) {
      func.call(void 0, _exports, meta, _module);
    } else {
      func.call(_exports, _exports, require,
                _module, __filename, __dirname);
    }
  } catch (e) {
    __node_cache__[id] = null;
    throw e;
  }

  __node_modules__[id] = null;

  if (id !== 0)
    _module.loaded = true;

  return _module.exports;
}

// if __BINDINGS__
function __node_dlopen__(module, name, raw) {
  var fs = require('fs');
  var os = require('os');
  var join = require('path').join;

  var x = (Math.random() * 0x100000000) >>> 0;
  var y = (Math.random() * 0x100000000) >>> 0;
  var prefix = x.toString(32) + y.toString(32);
  var file = process.pid + '-' + prefix + '-' + name;
  var path = join(os.tmpdir(), file);

  fs.writeFileSync(path, raw, {
    encoding: 'base64',
    mode: 448,
    flag: 'wx'
  });

  try {
    process.dlopen(module, path);
  } finally {
    try {
      fs.unlinkSync(path);
    } catch (e) {
      ;
    }
  }
}
// endif

// if __WASMESM__
async function __node_compile_esm__(name, raw, imports) {
  if (typeof WebAssembly !== 'function')
    throw new Error('WebAssembly not supported.');

  var source = Buffer.from(raw, 'base64');
  var result = await WebAssembly.instantiate(source, imports);

  return result.instance.exports;
}
// endif

// if __WASMCJS__
function __node_compile_cjs__(name, raw, imports) {
  if (typeof WebAssembly !== 'function')
    throw new Error('WebAssembly not supported.');

  var source = Buffer.from(raw, 'base64');
  var compiled = new WebAssembly.Module(source);
  var instance = new WebAssembly.Instance(compiled, imports);

  return instance.exports;
}
// endif

// if __ENV__
;(function() {
  var env = __ENV__;

  for (var i = 0; i < env.length; i++)
    process.env[env[i][0]] = env[i][1];
})();
// endif

// if __GLOBALS__
;(function() {
  var globals = __GLOBALS__;

  for (var i = 0; i < globals.length; i++)
    global[globals[i][0]] = globals[i][1];
})();
// endif

// if __REQUIRES__
await (async function() {
  var requires = __REQUIRES__;

  for (var i = 0; i < requires.length; i++)
    await __node_require__(requires[i]);
})();
// endif

__EXPORTS__
