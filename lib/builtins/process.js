/*!
 * process.js - node process for javascript
 * Copyright (c) 2018-2019, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Parts of this software are based on defunctzombie/node-process:
 *   Copyright (c) 2013, Roman Shtylman <shtylman@gmail.com>
 *   https://github.com/defunctzombie/node-process
 *
 * (The MIT License)
 *
 * Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/* global BigInt */
/* eslint no-var: "off" */

'use strict';

var process = exports;
var self = global;
var setTimeout = self.setTimeout;
var clearTimeout = self.clearTimeout;
var boot = Number(new Date());
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

/*
 * Helpers
 */

function _array() {
  return [];
}

function _boolean() {
  return false;
}

function _noop() {}

function _number() {
  return 0;
}

function _string() {
  return '';
}

function _this() {
  return this;
}

/*
 * Timers
 */

function cleanUpNextTick() {
  if (!draining || !currentQueue)
    return;

  draining = false;

  if (currentQueue.length > 0)
    queue = currentQueue.concat(queue);
  else
    queueIndex = -1;

  if (queue.length > 0)
    drainQueue();
}

function drainQueue() {
  if (draining)
    return;

  var timeout = setTimeout.call(self, cleanUpNextTick, 0);
  var len = queue.length;

  draining = true;

  while (len > 0) {
    currentQueue = queue;
    queue = [];

    while (++queueIndex < len) {
      if (currentQueue)
        currentQueue[queueIndex].run();
    }

    queueIndex = -1;
    len = queue.length;
  }

  currentQueue = null;
  draining = false;

  clearTimeout.call(self, timeout);
}

/*
 * Item
 */

function Item(func, array) {
  this.func = func;
  this.array = array;
}

Item.prototype.run = function() {
  this.func.apply(null, this.array);
};

/*
 * Process
 */

process.allowedNodeEnvironmentFlags =
  typeof Set === 'function' ? new Set() : undefined;
process.arch = 'javascript';
process.argv = ['/usr/bin/node'];
process.argv0 = 'node';
process.browser = true;
process.channel = undefined;
process.config = {};
process.connected = undefined;
process.debugPort = 9229;
process.env = { __proto__: null };
process.env.PATH = '/usr/bin';
process.env.HOME = '/';
process.execArgv = [];
process.execPath = '/usr/bin/node';
process.exitCode = undefined;
process.mainModule = null;
process.noDeprecation = false;
process.pid = 1;
process.platform = 'browser';
process.ppid = 1;
process.release = { name: 'browser' };
process.report = {};
process.stdin = null;
process.stdout = null;
process.stderr = null;
process.throwDeprecation = false;
process.title = 'browser';
process.traceDeprecation = false;
process.version = 'v0.0.0';
process.versions = { node: '0.0.0' };

/*
 * Events
 */

process._events = { __proto__: null };
process._eventsCount = 0;
process._maxListeners = 0;

process.addListener = _this;
process.emit = _boolean;
process.eventNames = _array;
process.getMaxListeners = _number;
process.listenerCount = _number;
process.listeners = _array;
process.off = _this;
process.on = _this;
process.once = _this;
process.prependListener = _this;
process.prependOnceListener = _this;
process.removeAllListeners = _this;
process.removeListener = _this;
process.setMaxListeners = _this;
process.rawListeners = _array;

/*
 * Methods
 */

process.abort = function() {
  throw new Error('Process aborted.');
};

process.binding = function(name) {
  throw new Error('process.binding is not supported.');
};

process.chdir = function(directory) {
  throw new Error('process.chdir is not supported.');
};

process.cpuUsage = function(previousValue) {
  return { user: 0, system: 0 };
};

process.cwd = function() {
  return '/';
};

process.dlopen = function(module, filename, flags) {
  throw new Error('process.dlopen is not supported.');
};

process.emitWarning = function(warning, options) {
  var text = 'Warning: ' + warning;

  if (console.warn)
    console.warn(text);
  else if (console.error)
    console.error(text);
  else
    console.log(text);
};

process.exit = function(code) {
  if (code == null)
    code = process.exitCode;

  code >>>= 0;

  throw new Error('Exit code: ' + code + '.');
};

process.getegid = _number;
process.geteuid = _number;
process.getgid = _number;
process.getgroups = _array;
process.getuid = _number;
process.hasUncaughtExceptionCaptureCallback = _boolean;

process.hrtime = function(time) {
  var now = Number(new Date()) - boot;
  var mod, sec, ms, ns;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  if (time) {
    sec = time[0];
    ns = time[1];
    ms = sec * 1000 + Math.floor(ns / 1000000);

    now -= ms;

    if (!isFinite(now))
      now = 0;

    if (now < 0)
      now = 0;
  }

  mod = now % 1000;
  sec = (now - mod) / 1000;
  ns = mod * 1000000;

  return [sec, ns];
};

process.hrtime.bigint = function() {
  if (typeof BigInt !== 'function')
    throw new Error('BigInt is unsupported.');

  var now = Number(new Date()) - boot;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  return BigInt(now) * BigInt(1000000);
};

process.initgroups = _noop;
process.kill = _noop;

process.memoryUsage = function() {
  return {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  };
};

process.nextTick = function(callback) {
  if (typeof callback !== 'function')
    throw new TypeError('Callback must be a function');

  var args = new Array(arguments.length - 1);
  var i;

  if (arguments.length > 1) {
    for (i = 1; i < arguments.length; i++)
      args[i - 1] = arguments[i];
  }

  queue.push(new Item(callback, args));

  if (queue.length === 1 && !draining)
    setTimeout.call(self, drainQueue, 0);
};

process.report.getReport = _string;
process.report.setOptions = _noop;
process.report.triggerReport = _string;

process.send = undefined;
process.setegid = _noop;
process.seteuid = _noop;
process.setgid = _noop;
process.setgroups = _noop;
process.setuid = _noop;
process.setUncaughtExceptionCaptureCallback = _noop;
process.umask = _number;

process.uptime = function() {
  var now = Number(new Date()) - boot;

  if (now < 0) {
    boot = Number(new Date());
    now = 0;
  }

  return now / 1000;
};
