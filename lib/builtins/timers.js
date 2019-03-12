/*!
 * timers-browserify@2.0.10 - timers module for browserify
 * Copyright (c) 2019, J. Ryan Stinnett
 * https://github.com/jryans/timers-browserify
 *
 * License for timers-browserify@2.0.10:
 *
 * # timers-browserify
 *
 * This project uses the [MIT](http://jryans.mit-license.org/) license:
 *
 * Copyright © 2012 J. Ryan Stinnett <jryans@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * # lib/node
 *
 * The `lib/node` directory borrows files from joyent/node which uses the
 * following license:
 *
 * Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * License for setimmediate@1.0.5:
 *
 * Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic
 * Denicola
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* global MessageChannel */
/* eslint no-var: "off" */

'use strict';

var timers = exports;
var self = global;
var apply = Function.prototype.apply;
var slice = Array.prototype.slice;

/*
 * Globals
 */

var setTimeout = self.setTimeout;
var clearTimeout = self.clearTimeout;
var setInterval = self.setInterval;
var clearInterval = self.clearInterval;
var setImmediate = self.setImmediate;
var clearImmediate = self.clearImmediate;

/*
 * Helpers
 */

function _false() {
  return false;
}

function _this() {
  return this;
}

/*
 * Timeout
 */

function Timeout(set, clear, args) {
  this._id = apply.call(set, self, args);
  this._set = set;
  this._clear = clear;
  this._args = args;
}

Timeout.prototype.hasRef = _false;
Timeout.prototype.ref = _this;
Timeout.prototype.unref = _this;

Timeout.prototype.refresh = function() {
  this._clear.call(self, this._id);
  this._id = apply.call(this._set, self, this._args);
  return this;
};

Timeout.prototype.close = function() {
  this._clear.call(self, this._id);
  return this;
};

/*
 * Immediate
 */

function Immediate(id) {
  this._id = id;
}

Immediate.prototype.hasRef = _false;
Immediate.prototype.ref = _this;
Immediate.prototype.unref = _this;

/*
 * API
 */

timers.setTimeout = function() {
  var args = slice.call(arguments, 0);
  return new Timeout(setTimeout, clearTimeout, args);
};

timers.clearTimeout = function(timeout) {
  if (timeout instanceof Timeout)
    timeout.close();
};

timers.setInterval = function() {
  var args = slice.call(arguments, 0);
  return new Timeout(setInterval, clearInterval, args);
};

timers.clearInterval = timers.clearTimeout;

timers.setImmediate = function() {
  return new Immediate(apply.call(setImmediate, self, arguments));
};

timers.clearImmediate = function(immediate) {
  if (immediate instanceof Immediate)
    clearImmediate(immediate._id);
};

/*
 * setImmediate
 */

;(function() {
  if (self.setImmediate)
    return;

  var nextHandle = 1; // Spec says greater than zero
  var tasksByHandle = {};
  var currentlyRunningATask = false;
  var doc = self.document;
  var registerImmediate;

  function _setImmediate(callback) {
    // Callback can either be a function or a string
    if (typeof callback !== 'function')
      callback = new Function(String(callback));

    // Copy function arguments
    var args = new Array(arguments.length - 1);
    for (var i = 0; i < args.length; i++)
      args[i] = arguments[i + 1];

    // Store and register the task
    var task = { callback: callback, args: args };
    tasksByHandle[nextHandle] = task;
    registerImmediate(nextHandle);
    return nextHandle++;
  }

  function _clearImmediate(handle) {
    delete tasksByHandle[handle];
  }

  function run(task) {
    var callback = task.callback;
    var args = task.args;
    switch (args.length) {
      case 0:
        callback();
        break;
      case 1:
        callback(args[0]);
        break;
      case 2:
        callback(args[0], args[1]);
        break;
      case 3:
        callback(args[0], args[1], args[2]);
        break;
      default:
        callback.apply(undefined, args);
        break;
    }
  }

  function runIfPresent(handle) {
    if (currentlyRunningATask) {
      setTimeout(runIfPresent, 0, handle);
    } else {
      var task = tasksByHandle[handle];
      if (task) {
        currentlyRunningATask = true;
        try {
          run(task);
        } finally {
          _clearImmediate(handle);
          currentlyRunningATask = false;
        }
      }
    }
  }

  function canUsePostMessage() {
    if (self.postMessage && !self.importScripts) {
      var postMessageIsAsynchronous = true;
      var oldOnMessage = self.onmessage;
      self.onmessage = function() {
        postMessageIsAsynchronous = false;
      };
      self.postMessage('', '*');
      self.onmessage = oldOnMessage;
      return postMessageIsAsynchronous;
    }
    return false;
  }

  function installPostMessageImplementation() {
    var messagePrefix = 'setImmediate$' + Math.random() + '$';

    var onGlobalMessage = function(event) {
      if (event.source === self
          && typeof event.data === 'string'
          && event.data.indexOf(messagePrefix) === 0) {
        runIfPresent(event.data.slice(messagePrefix.length));
      }
    };

    if (self.addEventListener)
      self.addEventListener('message', onGlobalMessage, false);
    else
      self.attachEvent('onmessage', onGlobalMessage);

    registerImmediate = function(handle) {
      self.postMessage(messagePrefix + handle, '*');
    };
  }

  function installMessageChannelImplementation() {
    var channel = new MessageChannel();

    channel.port1.onmessage = function(event) {
      var handle = event.data;
      runIfPresent(handle);
    };

    registerImmediate = function(handle) {
      channel.port2.postMessage(handle);
    };
  }

  function installReadyStateChangeImplementation() {
    var html = doc.documentElement;

    registerImmediate = function(handle) {
      var script = doc.createElement('script');

      script.onreadystatechange = function () {
        runIfPresent(handle);
        script.onreadystatechange = null;
        html.removeChild(script);
        script = null;
      };

      html.appendChild(script);
    };
  }

  function installSetTimeoutImplementation() {
    registerImmediate = function(handle) {
      setTimeout(runIfPresent, 0, handle);
    };
  }

  if (canUsePostMessage()) {
    // For non-IE10 modern browsers
    installPostMessageImplementation();
  } else if (self.MessageChannel) {
    // For web workers, where supported
    installMessageChannelImplementation();
  } else if (doc && 'onreadystatechange' in doc.createElement('script')) {
    // For IE 6–8
    installReadyStateChangeImplementation();
  } else {
    // For older browsers
    installSetTimeoutImplementation();
  }

  setImmediate = _setImmediate;
  clearImmediate = _clearImmediate;
})();
