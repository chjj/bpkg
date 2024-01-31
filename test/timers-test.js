/* eslint-env mocha */

'use strict';

const assert = require('assert');
const timers = require('node:timers/promises');

describe('Timers', function() {
  this.timeout(2 * 1000);

  it('should run on next tick', (cb) => {
    let x = 0;
    process.nextTick(() => {
      x = 1;
      cb();
    });
    assert(x === 0);
  });

  it('should run task', (cb) => {
    let x = 0;
    const timer = setImmediate(() => {
      x = 1;
      cb();
    });
    assert(typeof timer.ref === 'function');
    assert(x === 0);
  });

  it('should not run task', (cb) => {
    const timer = setImmediate(() => {
      cb(new Error('failure'));
    });
    clearImmediate(timer);
    cb();
  });

  it('should run microtask', (cb) => {
    let x = 0;
    queueMicrotask(() => {
      x = 1;
      cb();
    });
    assert(x === 0);
  });

  it('should await immediate', async () => {
    const value = {};
    assert(await timers.setImmediate() === undefined);
    assert(await timers.setImmediate(value) === value);
  });

  it('should await timeout', async () => {
    const value = {};
    assert(await timers.setTimeout(100) === undefined);
    assert(await timers.setTimeout(100, value) === value);
  });

  if (typeof AbortController === 'function') {
    it('should not await timeout', async () => {
      const controller = new AbortController();
      const options = { signal: controller.signal };
      const promise = timers.setTimeout(500, null, options);

      await timers.setTimeout(10);

      controller.abort();

      let err = null;

      try {
        await promise;
      } catch (e) {
        err = e;
      }

      assert(err != null);
      assert(err.code === 'ABORT_ERR');
    });

    it('should iterate interval', async () => {
      const controller = new AbortController();
      const options = { signal: controller.signal };
      const value = {};

      let i = 0;

      try {
        for await (const result of timers.setInterval(250, value, options)) {
          assert(result === value);
          if (++i === 3)
            controller.abort();
        }
      } catch (e) {
        assert(e.code === 'ABORT_ERR');
        assert(i === 3);
      }
    });
  }
});
