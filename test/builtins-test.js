/* global window */
/* eslint-env mocha */

'use strict';

const assert = require('assert');
const os = require('os');
const hooks = require('perf_hooks');

describe('Builtins', () => {
  it('should have global', () => {
    assert(globalThis === window);
    assert(global === window);
    assert(undefined === void 0);
  });

  it('should have console', () => {
    assert(console && typeof console.log === 'function');
  });

  it('should have setTimeout', (cb) => {
    let timer = null;
    let i = 0;

    const onTimeout = () => {
      i += 1;
      if (i === 1) {
        timer.refresh();
      } else if (i === 2) {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, 10);
      } else {
        cb();
      }
    };

    timer = setTimeout(onTimeout, 10);
  });

  it('should have setInterval', (cb) => {
    const timer = setInterval(() => {
      timer.close();
      cb();
    }, 10);
  });

  it('should have setImmediate', (cb) => {
    setImmediate(cb).unref();
  });

  it('should have queueMicrotask', (cb) => {
    let done = false;
    queueMicrotask(() => {
      assert(done);
      cb();
    });
    done = true;
  });

  it('should have process.nextTick', (cb) => {
    let done = false;
    process.nextTick(() => {
      assert(done);
      cb();
    });
    done = true;
  });

  it('should have buffer', () => {
    assert(typeof Buffer === 'function');
  });

  it('should have os', () => {
    assert(os.homedir() === '/');
  });

  it('should have perf_hooks', () => {
    assert(hooks && hooks.performance);
    assert(typeof hooks.performance.now() === 'number');
  });
});
