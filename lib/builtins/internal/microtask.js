/*!
 * microtask.js - queueMicrotask shim for javascript
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Parts of this software are based on GoogleChromeLabs/idlize:
 *   Copyright 2018 Google Inc. All Rights Reserved.
 *   https://github.com/GoogleChromeLabs/idlize/blob/master/lib/queueMicrotask.mjs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* global queueMicrotask, MutationObserver, document */
/* eslint no-var: "off" */

'use strict';

/*
 * Microtask
 */

function createQueueMicrotaskViaPromises() {
  return function(microtask) {
    if (typeof microtask !== 'function')
      throw new TypeError('Microtask must be a function');

    Promise.resolve().then(microtask);
  };
}

function createQueueMicrotaskViaMutationObserver() {
  var queue = [];

  var observer = new MutationObserver(function() {
    var tasks = queue;

    queue = [];

    for (var j = 0; j < tasks.length; j++)
      tasks[j]();
  });

  var node = document.createTextNode('');
  var i = 0;

  observer.observe(node, { characterData: true });

  return function(microtask) {
    if (typeof microtask !== 'function')
      throw new TypeError('Microtask must be a function');

    queue.push(microtask);
    node.data = String(++i % 2);
  };
}

function createQueueMicrotaskViaSetTimeout() {
  var self = global;
  var setTimeout = self.setTimeout;
  var queue = [];

  var drain = function() {
    var tasks = queue;

    queue = [];

    for (var j = 0; j < tasks.length; j++)
      tasks[j]();
  };

  return function(microtask) {
    if (typeof microtask !== 'function')
      throw new TypeError('Microtask must be a function');

    queue.push(microtask);

    if (queue.length === 1)
      setTimeout.call(self, drain, 0);
  };
}

/*
 * Expose
 */

if (typeof queueMicrotask === 'function') {
  module.exports = queueMicrotask;
} else if (typeof Promise === 'function'
           && Promise.toString().indexOf('[native code]') !== -1) {
  module.exports = createQueueMicrotaskViaPromises();
} else if (typeof MutationObserver === 'function') {
  module.exports = createQueueMicrotaskViaMutationObserver();
} else {
  module.exports = createQueueMicrotaskViaSetTimeout();
}
