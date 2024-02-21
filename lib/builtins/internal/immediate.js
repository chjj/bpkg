/*!
 * setimmediate@1.0.5 - shim for the setImmediate efficient script yielding API
 * Copyright (c) 2012 Barnesandnoble.com, Donavon West, Domenic Denicola
 * https://github.com/yuzujs/setImmediate
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

/* eslint no-var: "off" */

'use strict';

var _setTimeout = global.setTimeout;
var IOS_RE = /(?:ipad|iphone|ipod).*applewebkit/i;

/*
 * SetImmediate
 */

function installSetImmediate(global) {
  var doc = global.document;
  var loc = global.location;
  var nav = global.navigator;
  var nextHandle = 1; // Spec says greater than zero
  var tasksByHandle = {};
  var currentlyRunningATask = false;
  var registerImmediate;

  // eslint-disable-next-line func-name-matching
  var _setImmediate = function setImmediate(callback) {
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
  };

  // eslint-disable-next-line func-name-matching
  var _clearImmediate = function clearImmediate(handle) {
    delete tasksByHandle[handle];
  };

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
      _setTimeout.call(global, runIfPresent, 0, handle);
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

  function canUseMessageChannel() {
    if (!global.MessageChannel)
      return false;

    if (global.importScripts)
      return true;

    if (!loc || loc.protocol === 'file:' || loc.protocol === 'data:')
      return true;

    if (!nav || typeof nav.userAgent !== 'string')
      return true;

    return !IOS_RE.test(nav.userAgent);
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

  function targetOrigin() {
    return loc.protocol + '//' + loc.host;
  }

  function canUsePostMessage() {
    var isURL = loc && loc.protocol !== 'file:' && loc.protocol !== 'data:';
    if (global.postMessage && !global.importScripts && isURL) {
      var postMessageIsAsynchronous = true;
      var oldOnMessage = global.onmessage;
      global.onmessage = function() {
        postMessageIsAsynchronous = false;
      };
      try {
        global.postMessage('', targetOrigin());
      } catch (e) {
        postMessageIsAsynchronous = false;
      }
      global.onmessage = oldOnMessage;
      return postMessageIsAsynchronous;
    }
    return false;
  }

  function installPostMessageImplementation() {
    var messagePrefix = 'setImmediate$' + Math.random() + '$';
    var startsWith;

    if (''.startsWith) {
      startsWith = function(x, y) {
        return x.startsWith(y);
      };
    } else {
      startsWith = function(x, y) {
        return x.length >= y.length && x.slice(0, y.length) === y;
      };
    }

    var onGlobalMessage = function(event) {
      if (event.source === global &&
          typeof event.data === 'string' &&
          startsWith(event.data, messagePrefix)) {
        // eslint-disable-next-line no-implicit-coercion
        runIfPresent(+event.data.slice(messagePrefix.length));
      }
    };

    if (global.addEventListener)
      global.addEventListener('message', onGlobalMessage, false);
    else
      global.attachEvent('onmessage', onGlobalMessage);

    registerImmediate = function(handle) {
      global.postMessage(messagePrefix + handle, targetOrigin());
    };
  }

  function canUseReadyStateChange() {
    if (doc && doc.createElement)
      return 'onreadystatechange' in doc.createElement('script');
    return false;
  }

  function installReadyStateChangeImplementation() {
    var html = doc.documentElement;

    registerImmediate = function(handle) {
      var script = doc.createElement('script');

      script.onreadystatechange = function() {
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
      _setTimeout.call(global, runIfPresent, 0, handle);
    };
  }

  if (canUseMessageChannel()) {
    // For non-iOS modern browsers
    installMessageChannelImplementation();
  } else if (canUsePostMessage()) {
    // For non-IE10 modern browsers
    installPostMessageImplementation();
  } else if (canUseReadyStateChange()) {
    // For IE 6–8
    installReadyStateChangeImplementation();
  } else {
    // For older browsers
    installSetTimeoutImplementation();
  }

  exports.setImmediate = _setImmediate;
  exports.clearImmediate = _clearImmediate;
}

/*
 * Expose
 */

if (global.setImmediate && global.clearImmediate) {
  exports.setImmediate = global.setImmediate;
  exports.clearImmediate = global.clearImmediate;
} else {
  installSetImmediate(global);
}
