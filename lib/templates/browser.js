/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* eslint wrap-iife: "off" */
/* global window, self */

/*
  global __LICENSE__
  global __TIMERS__
  global __PROCESS__
  global __BUFFER__
  global __CONSOLE__
  global __ENV__
  global __GLOBALS__
  global __REQUIRES__
  global __MODULES__
  global __NAME__
*/

// if __LICENSE__
__LICENSE__
// endif

;(function(global) {
// if __TIMERS__
var setTimeout = global.setTimeout;
var clearTimeout = global.clearTimeout;
var setInterval = global.setInterval;
var clearInterval = global.clearInterval;
var setImmediate = global.setImmediate;
var clearImmediate = global.clearImmediate;
// endif

// if __PROCESS__
var process = undefined;
// endif

// if __BUFFER__
var Buffer = undefined;
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

__fake_require__.resolve = __browser_error__;

__fake_require__.main = null;

__fake_require__.extensions = { __proto__: null };

__fake_require__.cache = { __proto__: null };

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
  var meta = { __proto__: null, uri: 'file://' + encodeURI(filename) };

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

  __browser_cache__[id] = _module;

  try {
    func.call(_exports, _exports, _require,
              _module, filename, dirname, meta);
  } catch (e) {
    delete __browser_cache__[id];
    throw e;
  }

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

// if __PROCESS__
process = __browser_require__(__PROCESS__, null);
// endif

// if __BUFFER__
Buffer = __browser_require__(__BUFFER__, null).Buffer;
// endif

// if __CONSOLE__
console = __browser_require__(__CONSOLE__, null);
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

var __browser_main__ = __browser_require__(0, null);

// if __EXPORTS__
if ((typeof module === 'object' && module)
    && (typeof module.exports === 'object' && module.exports)) {
  module.exports = __browser_main__;
}
// endif

// if __GLOBAL__
global[__NAME__] = __browser_main__;
// endif
})(function() {
  // From core-js: https://github.com/zloirock/core-js/blob/0b49818/packages/core-js/internals/global.js
  if (typeof window !== 'undefined' && window.Math === Math)
    return window;

  if (typeof self !== 'undefined' && self.Math === Math)
    return self;

  return Function('return this')();
}());
