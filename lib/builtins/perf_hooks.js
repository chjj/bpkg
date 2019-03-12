/*!
 * perf_hooks.js - node perf_hooks for javascript
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

/* global performance */
/* eslint no-var: "off" */

'use strict';

var hooks = exports;
var boot = Number(new Date());

/*
 * Helpers
 */

function noop() {};

function hasPerformance() {
  try {
    return performance.now() === 'number';
  } catch (e) {
    return false;
  }
}

/*
 * API
 */

hooks.constants = {
  NODE_PERFORMANCE_GC_MAJOR: 2,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_INCREMENTAL: 4,
  NODE_PERFORMANCE_GC_WEAKCB: 8
};

if (hasPerformance()) {
  hooks.performance = performance;
} else {
  hooks.performance = {
    clearMarks: noop,
    mark: noop,
    measure: noop,
    nodeTiming: undefined,
    now: function() {
      var now = Number(new Date()) - boot;

      if (now < 0) {
        boot = Number(new Date());
        now = 0;
      }

      return now;
    },
    timeOrigin: boot,
    timerify: undefined
  };
}

hooks.PerformanceObserver = undefined;
