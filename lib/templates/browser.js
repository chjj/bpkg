/* eslint strict: "off" */
/* eslint camelcase: "off" */
/* eslint no-unused-vars: "off" */
/* eslint no-var: "off" */
/* global window, self */
/* global __MODULES__, __CONSOLE__, __TIMERS__, __BUFFER__, __PROCESS__ */

;(function(global) {
// if __CONSOLE__
var console = null;
// endif

// if __TIMERS__
var setTimeout = null;
var clearTimeout = null;
var setInterval = null;
var clearInterval = null;
var setImmediate = null;
var clearImmediate = null;
// endif

// if __BUFFER__
var Buffer = null;
// endif

// if __PROCESS__
var process = null;
// endif

var __browser_modules__ = [
__MODULES__
];

function __browser_require__(id, parent) {
  if (typeof id !== 'number')
    throw new Error('Module not found.');

  var cache = __browser_require__.cache[id];

  if (cache)
    return cache.exports;

  var mod = __browser_modules__[id];
  var name = mod[0];
  var func = mod[1];

  var filename = name;
  var dirname = filename.split('/').slice(0, -1).join('/');

  var _require = __browser_require__;
  var _exports = {};

  var _module = {
    id: name,
    exports: _exports,
    parent: parent,
    filename: filename,
    children: [],
    paths: ['/']
  };

  if (parent)
    parent.children.push(_module);

  if (!__browser_require__.main)
    __browser_require__.main = _module;

  __browser_require__.cache[id] = _module;

  func.call(_exports, _exports, _require, _module, filename, dirname);

  return _module.exports;
}

__browser_require__.resolve = function(location) {
  throw new Error('Not implemented.');
};

__browser_require__.main = null;

__browser_require__.extensions = Object.create(null);

__browser_require__.cache = Object.create(null);

function __browser_error__(msg) {
  throw new Error(msg);
}

// if __CONSOLE__
console = __browser_require__(__CONSOLE__, null);
// endif

// if __TIMERS__
(function() {
  var timers = __browser_require__(__TIMERS__, null);

  setTimeout = timers.setTimeout;
  clearTimeout = timers.clearTimeout;
  setInterval = timers.setInterval;
  clearInterval = timers.clearInterval;
  setImmediate = timers.setImmediate;
  clearImmediate = timers.clearImmediate;
})();
// endif

// if __BUFFER__
Buffer = __browser_require__(__BUFFER__, null).Buffer;
// endif

// if __PROCESS__
process = __browser_require__(__PROCESS__, null);
// endif

__browser_require__(0, null);
})((typeof global !== 'undefined' && global)
    || (typeof self !== 'undefined' && self)
    || window);
