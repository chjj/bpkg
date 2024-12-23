/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/* eslint wrap-iife: "off" */
/* eslint prefer-arrow-callback: "off" */
/* eslint no-shadow-restricted-names: "off" */
/* global window, self, define */

/* global __HEADER__ */
/* global __PREFIX__ */
/* global __TIMERS__ */
/* global __MICROTASK__ */
/* global __PROCESS__ */
/* global __BUFFER__ */
/* global __CONSOLE__ */
/* global __ENV__ */
/* global __GLOBALS__ */
/* global __REQUIRES__ */
/* global __MODULES__ */
/* global __REQUIRE0__ */
/* global __NAME__ */
/* global __EXPORTS__ */
/* global __CONDITIONS__ */
/* global __browser_require__ */

// if __HEADER__
__HEADER__
// endif

__PREFIX__(function(global) {
var globalThis = global;
var undefined;

// if __TIMERS__
var setTimeout = global.setTimeout;
var clearTimeout = global.clearTimeout;
var setInterval = global.setInterval;
var clearInterval = global.clearInterval;
var setImmediate = global.setImmediate;
var clearImmediate = global.clearImmediate;
// endif

// if __MICROTASK__
var queueMicrotask = global.queueMicrotask;
// endif

// if __PROCESS__
var process;
// endif

// if __BUFFER__
var Buffer;
// endif

// if __CONSOLE__
var console = global.console;
// endif

var __browser_modules__ = [
__MODULES__
];

var __browser_cache__ = [];

function __browser_error__(specifier) {
  var err = new Error('Cannot find module \'' + specifier + '\'');
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

function __browser_throw__(specifier) {
  throw __browser_error__(specifier);
}

function __browser_reject__(specifier) {
  return Promise.reject(__browser_error__(specifier));
}

function __fake_require__(specifier) {
  __browser_throw__(specifier);
}

__fake_require__.cache = { __proto__: null };

__fake_require__.extensions = { __proto__: null };

__fake_require__.main = null;

__fake_require__.resolve = __browser_throw__;

__fake_require__.resolve.paths = __browser_throw__;

function __browser_require__(id, flag, parent) {
  while (__browser_cache__.length <= id)
    __browser_cache__.push(null);

  var cache = __browser_cache__[id];

// if __ASYNC__
  if (cache && cache._promise)
    return flag ? cache._promise : Promise.resolve(cache.exports);
// endif

  if (cache)
    return cache.exports;

  var mod = __browser_modules__[id];
  var path = mod[1];
  var esm = mod[2];
  var func = mod[3];

  var filename = path;
  var dirname = filename.split('/').slice(0, -1).join('/') || '/';
  var meta;

// if __META__
  meta = {
    __proto__: null,
    url: 'file://' + encodeURI(filename),
    filename: filename,
    dirname: dirname,
    resolve: __browser_throw__
  };
// endif

  var _require = __fake_require__;
  var _exports = esm ? { __proto__: null } : {};

  var _module = {
    id: id === 0 ? '.' : filename,
    path: dirname,
    exports: _exports,
    parent: null,
    filename: filename,
    isPreloading: false,
    loaded: false,
    children: [],
    paths: ['/'],
    require: _require
  };

  if (parent && parent.require === _require) {
    _module.parent = parent;
    parent.children.push(_module);
  }

  if (id === 0)
    _require.main = _module;

// if __PROCESS__
  if (id === 0)
    process.mainModule = _module;
// endif

  __browser_cache__[id] = _module;

// if __ASYNC__
  if (esm === 2) {
    _module._promise = new Promise(function(resolve, reject) {
      var promise = func.call(void 0, _exports, meta, _module);

      promise.then(function() {
        __browser_modules__[id] = null;
        _module.loaded = true;
        resolve(_module.exports);
      }).catch(function(err) {
        __browser_cache__[id] = null;
        reject(err);
      });
    });

    return _module._promise;
  }

  _module._promise = null;
// endif

  try {
    if (esm) {
      func.call(void 0, _exports, meta, _module);
    } else {
      func.call(_exports, _exports, _require,
                _module, filename, dirname);
    }
  } catch (e) {
    __browser_cache__[id] = null;
    throw e;
  }

  __browser_modules__[id] = null;

  _module.loaded = true;

  return _module.exports;
}

// if __IMPORT_DEFAULT__
function __esm_default__(src) {
  return src && src.__esModule ? src['default'] : src;
}
// endif

// if __HAS_SET_FLAG__
function __esm_set_flag__(dst) {
  if (Object.defineProperty)
    Object.defineProperty(dst, '__esModule', { value: true });
  else
    dst.__esModule = true;
}
// endif

// if __HAS_ASSIGN__
function __esm_assign__(dst, dkey, src, skey) {
  if (Object.getOwnPropertyDescriptor) {
    Object.defineProperty(dst, dkey,
      Object.getOwnPropertyDescriptor(src, skey));
  } else {
    dst[dkey] = src[skey];
  }
}
// endif

// if __HAS_PROXY__
function __esm_proxy__(dst, src, key) {
  if (Object.getOwnPropertyDescriptor) {
    Object.defineProperty(dst, key,
      Object.getOwnPropertyDescriptor(src, key));
  } else {
    dst[key] = src[key];
  }
}
// endif

// if __HAS_EXPOSE__
function __esm_expose__(dst, key, get) {
  if (Object.defineProperty) {
    Object.defineProperty(dst, key, {
      configurable: true,
      enumerable: true,
      get: get
    });
  } else {
    dst[key] = get();
  }
}
// endif

// if __IMPORT_STAR__
var __star_cache__ = typeof WeakMap === 'function' ? new WeakMap() : null;

function __esm_import_star__(src) {
  if (src && src.__esModule)
    return src;

  if (!(src && typeof src === 'object' && !(src instanceof Array))) {
    return {
      __proto__: null,
      __esModule: true,
      'default': src,
      'module.exports': src
    };
  }

  if (__star_cache__) {
    var cache = __star_cache__.get(src);

    if (cache)
      return cache;
  }

  var dst = { __proto__: null };

  for (var key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key))
      continue;

    if (key === 'default' || key === 'module.exports' || key === '__proto__')
      continue;

    if (Object.getOwnPropertyDescriptor) {
      Object.defineProperty(dst, key,
        Object.getOwnPropertyDescriptor(src, key));
    } else {
      dst[key] = src[key];
    }
  }

  if (Object.defineProperty)
    Object.defineProperty(dst, '__esModule', { value: true });
  else
    dst.__esModule = true;

  dst['default'] = src;
  dst['module.exports'] = src;

  if (__star_cache__)
    __star_cache__.set(src, dst);

  return dst;
}
// endif

// if __EXPORT_STAR__
function __esm_export_star__(dst, src) {
  if (!(src && typeof src === 'object' && !(src instanceof Array)))
    return;

  for (var key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key))
      continue;

    if (key === 'default' ||
        key === 'module.exports' ||
        key === '__proto__' ||
        key === '__esModule') {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(dst, key))
      continue;

    if (Object.getOwnPropertyDescriptor) {
      Object.defineProperty(dst, key,
        Object.getOwnPropertyDescriptor(src, key));
    } else {
      dst[key] = src[key];
    }
  }
}
// endif

// if __WASM__
function __wasm_unbase64__(str) {
  var data = atob(str);
  var arr = new Uint8Array(data.length);

  for (var i = 0; i < data.length; i++)
    arr[i] = data.charCodeAt(i);

  return arr;
}
// endif

// if __WASM_SYNC__
function __wasm_compile_sync__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || WebAssembly === null)
    throw new Error('WebAssembly not supported.');

  var source = __wasm_unbase64__(raw);
  var compiled = new WebAssembly.Module(source);
  var instance = new WebAssembly.Instance(compiled, imports);

  return instance.exports;
}
// endif

// if __WASM_ASYNC__
async function __wasm_compile_async__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || WebAssembly === null)
    throw new Error('WebAssembly not supported.');

  var source = __wasm_unbase64__(raw);
  var result = await WebAssembly.instantiate(source, imports);

  return result.instance.exports;
}
// endif

// if __TIMERS__
;(function() {
  var timers = __browser_require__(__TIMERS__, 0, null);

  setTimeout = timers.setTimeout;
  clearTimeout = timers.clearTimeout;
  setInterval = timers.setInterval;
  clearInterval = timers.clearInterval;
  setImmediate = timers.setImmediate;
  clearImmediate = timers.clearImmediate;
})();
// endif

// if __ISBUFFER__
function __is_buffer__(obj) {
  return obj != null && obj._isBuffer === true;
}
// endif

// if __MICROTASK__
queueMicrotask = __browser_require__(__MICROTASK__, 0, null);
// endif

// if __PROCESS__
process = __browser_require__(__PROCESS__, 0, null);
// endif

// if __CONDITIONS__
process.execArgv = __CONDITIONS__;
// endif

// if __BUFFER__
Buffer = __browser_require__(__BUFFER__, 0, null).Buffer;
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

// if __REQUIRE_SYNC__
;(function() {
  var requires = __REQUIRES__;

  for (var i = 0; i < requires.length; i++)
    __browser_require__(requires[i], 0, null);
})();
// endif

// if __CJS__
__REQUIRE0__;
// endif

// if __UMD__
function __browser_main__() {
  return __REQUIRE0__;
}

if (typeof define === 'function' && define.amd) {
  define(__NAME__, [], __browser_main__);
} else if ((typeof module === 'object' && module) &&
           (typeof module.exports === 'object' && module.exports)) {
  module.exports = __browser_main__();
} else {
  global[__NAME__] = __browser_main__();
}
// endif

// if __ESM__
return __browser_require__;
// endif
})(function() {
  /* https://github.com/zloirock/core-js/issues/86#issuecomment-115759028 */
  /* https://github.com/zloirock/core-js/blob/v3.0.0/packages/core-js/internals/global.js */
  if (typeof window !== 'undefined' && window && window.Math === Math)
    return window;

  if (typeof self !== 'undefined' && self && self.Math === Math)
    return self;

  return Function('return this')();
}());

// if __REQUIRE_ASYNC__
for (const id of __REQUIRES__)
  await __browser_require__(id, 0, null);
// endif

// if __ESM__
__EXPORTS__
// endif
