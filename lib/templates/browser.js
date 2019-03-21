/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint semi: "off" */
/* eslint wrap-iife: "off" */
/* eslint prefer-arrow-callback: "off" */
/* eslint no-shadow-restricted-names: "off" */
/* global window, self, define */

/*
  global __HEADER__
  global __PREFIX__
  global __TIMERS__
  global __MICROTASK__
  global __PROCESS__
  global __BUFFER__
  global __CONSOLE__
  global __ENV__
  global __GLOBALS__
  global __REQUIRES__
  global __MODULES__
  global __NAME__
  global __EXPORTS__
*/

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

function __browser_error__(location) {
  var err = new Error('Cannot find module \'' + location + '\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

function __fake_require__(location) {
  __browser_error__(location);
}

__fake_require__.cache = { __proto__: null };

__fake_require__.extensions = { __proto__: null };

__fake_require__.main = null;

__fake_require__.resolve = __browser_error__;

__fake_require__.resolve.paths = __browser_error__;

function __browser_require__(id, parent) {
  if ((id >>> 0) !== id || id > __browser_modules__.length)
    return __browser_error__(id);

  if (parent != null && !parent.children)
    return __browser_error__(id);

  while (__browser_cache__.length <= id)
    __browser_cache__.push(null);

  var cache = __browser_cache__[id];

  if (cache)
    return cache.exports;

  var mod = __browser_modules__[id];
  var name = mod[0];
  var path = mod[1];
  var func = mod[2];

  var filename = path;
  var dirname = filename.split('/').slice(0, -1).join('/') || '/';
  var meta;

// if __META__
  meta = { __proto__: null, url: 'file://' + encodeURI(filename) };
// endif

  var _require = __fake_require__;
  var _exports = {};

  var _module = {
    id: '/' + name + path,
    exports: _exports,
    parent: parent,
    filename: filename,
    loaded: false,
    children: [],
    paths: ['/'],
    require: _require
  };

  if (parent)
    parent.children.push(_module);

  if (id === 0)
    _require.main = _module;

// if __PROCESS__
  if (id === 0)
    process.mainModule = _module;
// endif

  __browser_cache__[id] = _module;

  try {
    func.call(_exports, _exports, _require,
              _module, filename, dirname, meta);
  } catch (e) {
    __browser_cache__[id] = null;
    throw e;
  }

  __browser_modules__[id] = null;

  _module.loaded = true;

  return _module.exports;
}

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
;(function() {
  var requires = __REQUIRES__;

  for (var i = 0; i < requires.length; i++)
    __browser_require__(requires[i], null);
})();
// endif

// if !__ESM__
var __browser_main__ = __browser_require__(0, null);
// endif

// if __UMD__
if (typeof define === 'function' && define.amd) {
  define(__NAME__, [], function() {
    return __browser_main__;
  });
} else if ((typeof module === 'object' && module)
        && (typeof module.exports === 'object' && module.exports)) {
  module.exports = __browser_main__;
} else {
  global[__NAME__] = __browser_main__;
}
// endif

// if __ESM__
return __browser_require__;
// endif
})(function() {
/*
 * From core-js. See:
 *   https://github.com/zloirock/core-js/blob/0b49818/packages/core-js/internals/global.js
 *   https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
 */

  if (typeof window !== 'undefined' && window.Math === Math)
    return window;

  if (typeof self !== 'undefined' && self.Math === Math)
    return self;

  return Function('return this')();
}());

// if __ESM__
__EXPORTS__
// endif
