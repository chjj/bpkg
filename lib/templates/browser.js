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

function __browser_require__(id, parent) {
  if ((id >>> 0) !== id || id > __browser_modules__.length)
    return __browser_throw__(id);

  if (parent != null && !parent.children)
    return __browser_throw__(id);

  while (__browser_cache__.length <= id)
    __browser_cache__.push(null);

  var cache = __browser_cache__[id];

// if __ASYNC__
  if (cache && cache._promise)
    return cache._promise;
// endif

  if (cache)
    return cache.exports;

  var mod = __browser_modules__[id];
  var name = mod[0];
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
    parent: parent,
    filename: filename,
    isPreloading: false,
    loaded: false,
    children: [],
    paths: ['/'],
    require: _require
  };

  if (parent && parent.require === _require)
    parent.children.push(_module);

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

// if __IMPORTDEFAULT__
function __esm_default__(src) {
  return src && src.__esModule ? src['default'] : src;
}
// endif

// if __HASSETFLAG__
function __esm_set_flag__(dst) {
  if (Object.defineProperty)
    Object.defineProperty(dst, '__esModule', { value: true });
  else
    dst.__esModule = true;
}
// endif

// if __HASASSIGN__
function __esm_assign__(dst, dkey, src, skey) {
  if (Object.getOwnPropertyDescriptor) {
    Object.defineProperty(dst, dkey,
      Object.getOwnPropertyDescriptor(src, skey));
  } else {
    dst[dkey] = src[skey];
  }
}
// endif

// if __HASPROXY__
function __esm_proxy__(dst, src, key) {
  if (Object.getOwnPropertyDescriptor) {
    Object.defineProperty(dst, key,
      Object.getOwnPropertyDescriptor(src, key));
  } else {
    dst[key] = src[key];
  }
}
// endif

// if __HASEXPOSE__
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

// if __IMPORTSTAR__
var __star_cache__ = typeof WeakMap === 'function' ? new WeakMap() : null;

function __esm_import_star__(src) {
  var Array = ([]).constructor;

  if (src && src.__esModule)
    return src;

  if (!(src && typeof src === 'object' && !(src instanceof Array))) {
    return {
      __esModule: true,
      'default': src
    };
  }

  if (__star_cache__) {
    var cache = __star_cache__.get(src);

    if (cache)
      return cache;
  }

  var Object = ({}).constructor;
  var dst = {};
  var key;

  for (key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key))
      continue;

    if (key === 'default' || key === '__proto__')
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

  if (__star_cache__)
    __star_cache__.set(src, dst);

  return dst;
}
// endif

// if __EXPORTSTAR__
function __esm_export_star__(dst, src) {
  var Array = ([]).constructor;
  var Object = ({}).constructor;
  var key;

  if (!(src && typeof src === 'object' && !(src instanceof Array)))
    return;

  for (key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key))
      continue;

    if (key === 'default' ||
        key === '__proto__' ||
        key === '__esModule') {
      continue;
    }

    if (Object.getOwnPropertyDescriptor) {
      Object.defineProperty(dst, key,
        Object.getOwnPropertyDescriptor(src, key));
    } else {
      dst[key] = src[key];
    }
  }
}
// endif

// if __WASMESM__
async function __browser_compile_esm__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || typeof fetch !== 'function')
    throw new Error('WebAssembly not supported.');

  var uri = 'data:application/wasm;base64,' + raw;
  var result;

  if (WebAssembly.instantiateStreaming) {
    result = await WebAssembly.instantiateStreaming(fetch(uri), imports);
  } else {
    var response = await fetch(uri);
    var source = await response.arrayBuffer();

    result = await WebAssembly.instantiate(source, imports);
  }

  return result.instance.exports;
}
// endif

// if __WASMCJS__
function __browser_compile_cjs__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || WebAssembly === null)
    throw new Error('WebAssembly not supported.');

  var data = Buffer.from(raw, 'base64');
  var source = new Uint8Array(data.buffer,
                              data.byteOffset,
                              data.byteLength);
  var compiled = new WebAssembly.Module(source);
  var instance = new WebAssembly.Instance(compiled, imports);

  return instance.exports;
}
// endif

// if __TIMERS__
;(function() {
  var timers = __browser_require__(__TIMERS__, null);

  setTimeout = timers.setTimeout;
  clearTimeout = timers.clearTimeout;
  setInterval = timers.setInterval;
  clearInterval = timers.clearInterval;
  setImmediate = timers.setImmediate;
  clearImmediate = timers.clearImmediate;
})();
// endif

// if __MICROTASK__
queueMicrotask = __browser_require__(__MICROTASK__, null);
// endif

// if __PROCESS__
process = __browser_require__(__PROCESS__, null);
// endif

// if __CONDITIONS__
process.execArgv = __CONDITIONS__;
// endif

// if __BUFFER__
Buffer = __browser_require__(__BUFFER__, null).Buffer;
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
(function() {
  var requires = __REQUIRES__;

  for (var i = 0; i < requires.length; i++)
    __browser_require__(requires[i], null);
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

// if __ESM__
__EXPORTS__
// endif
