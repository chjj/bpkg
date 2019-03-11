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

'use strict';

var apply = Function.prototype.apply;

var setTimeout = global.setTimeout;
var clearTimeout = global.clearTimeout;
var setInterval = global.setInterval;
var clearInterval = global.clearInterval;
var setImmediate = global.setImmediate;
var clearImmediate = global.clearImmediate;

function Timeout(id, clearFn) {
  this._id = id;
  this._clearFn = clearFn;
}

Timeout.prototype.unref = Timeout.prototype.ref = function() {};

Timeout.prototype.close = function() {
  this._clearFn.call(global, this._id);
};

exports.setTimeout = function() {
  return new Timeout(apply.call(setTimeout, global, arguments), clearTimeout);
};

exports.setInterval = function() {
  return new Timeout(apply.call(setInterval, global, arguments), clearInterval);
};

exports.setImmediate = function() {
  return new Timeout(apply.call(setImmediate, global, arguments), clearImmediate);
};

exports.clearTimeout =
exports.clearInterval =
exports.clearImmediate = function(timeout) {
  if (timeout)
    timeout.close();
};

// Does not start the time, just sets up the members needed.
exports.enroll = function(item, msecs) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = msecs;
};

exports.unenroll = function(item) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = -1;
};

exports._unrefActive = exports.active = function(item) {
  clearTimeout(item._idleTimeoutId);

  var msecs = item._idleTimeout;
  if (msecs >= 0) {
    item._idleTimeoutId = setTimeout(function onTimeout() {
      if (item._onTimeout)
        item._onTimeout();
    }, msecs);
  }
};

;(function() {
  if (global.setImmediate)
    return;

  var nextHandle = 1; // Spec says greater than zero
  var tasksByHandle = {};
  var currentlyRunningATask = false;
  var doc = global.document;
  var registerImmediate;

  function _setImmediate(callback) {
    // Callback can either be a function or a string
    if (typeof callback !== 'function')
      callback = new Function('' + callback);

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
    if (global.postMessage && !global.importScripts) {
      var postMessageIsAsynchronous = true;
      var oldOnMessage = global.onmessage;
      global.onmessage = function() {
        postMessageIsAsynchronous = false;
      };
      global.postMessage('', '*');
      global.onmessage = oldOnMessage;
      return postMessageIsAsynchronous;
    }
  }

  function installPostMessageImplementation() {
    var messagePrefix = 'setImmediate$' + Math.random() + '$';

    var onGlobalMessage = function(event) {
      if (event.source === global
          && typeof event.data === 'string'
          && event.data.indexOf(messagePrefix) === 0) {
        runIfPresent(+event.data.slice(messagePrefix.length));
      }
    };

    if (global.addEventListener)
      global.addEventListener('message', onGlobalMessage, false);
    else
      global.attachEvent('onmessage', onGlobalMessage);

    registerImmediate = function(handle) {
      global.postMessage(messagePrefix + handle, '*');
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
  } else if (global.MessageChannel) {
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

  global.setImmediate = _setImmediate;
  global.clearImmediate = _clearImmediate;
})();
