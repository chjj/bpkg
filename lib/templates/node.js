/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/* eslint prefer-arrow-callback: "off" */
/* eslint no-inner-declarations: "off" */
/* global __module, __exports, __meta */
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
import {createRequire as __createRequire} from 'module';

/* eslint-disable-next-line */
function require(x) { return {}; };
var __filename, __dirname, exports, module;

if (typeof __module === 'object' && __module &&
    typeof __exports === 'object' && __exports &&
    typeof __meta === 'object' && __meta &&
    __module.exports === __exports) {
  __filename = __module.filename;
  __dirname = __module.path;
  require = __module.require;
  exports = __exports;
  module = __module;
} else {
  const _require = __createRequire(import.meta.url);
  if (import.meta.filename) {
    __filename = import.meta.filename;
    __dirname = import.meta.dirname;
  } else {
    __filename = _require('url').fileURLToPath(import.meta.url);
    __dirname = _require('path').dirname(__filename);
  }
  require = _require;
  exports = {};
  module = {
    id: '.',
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
}
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

// if __ASYNC__
var __node_promise__ = null;
// endif

function __node_require__(id, flag) {
  if ((id >>> 0) !== id || id > __node_modules__.length)
    return __node_throw__(id);

  while (__node_cache__.length <= id)
    __node_cache__.push(null);

  var cache = __node_cache__[id];

// if __ASYNC__
  if (cache) {
    var pending = (id === 0 ? __node_promise__ : cache._promise);

    if (pending)
      return flag ? pending : Promise.resolve(cache.exports);
  }
// endif

  if (cache)
    return cache.exports;

  var mod = __node_modules__[id];
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
    _exports = esm ? { __proto__: null } : {};
    _module = {
      id: __filename,
      path: __dirname,
      exports: _exports,
      parent: module,
      filename: __filename,
      isPreloading: false,
      loaded: false,
      children: module.children,
      paths: module.paths,
      require: require
    };
  } else if (esm) {
    _exports = { __proto__: null };
    _module.exports = _exports;
  }

  __node_cache__[id] = _module;

// if __ASYNC__
  if (esm === 2) {
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
    else
      __node_promise__ = _promise;

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
async function __node_compile_esm__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || WebAssembly === null)
    throw new Error('WebAssembly not supported.');

  var source = Buffer.from(raw, 'base64');
  var result = await WebAssembly.instantiate(source, imports);

  return result.instance.exports;
}
// endif

// if __WASMCJS__
function __node_compile_cjs__(name, raw, imports) {
  if (typeof WebAssembly !== 'object' || WebAssembly === null)
    throw new Error('WebAssembly not supported.');

  var source = Buffer.from(raw, 'base64');
  var compiled = new WebAssembly.Module(source);
  var instance = new WebAssembly.Instance(compiled, imports);

  return instance.exports;
}
// endif

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
    __node_require__(requires[i], 0);
})();
// endif

__EXPORTS__
