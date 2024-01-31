/*!
 * timers/promises.js - promisified timers for javascript
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

/* eslint no-var: "off", prefer-arrow-callback: "off" */

'use strict';

var self = global;
var global_ = global;
var imm = require('../internal/immediate');
var _setTimeout = self.setTimeout;
var _clearTimeout = self.clearTimeout;
var _setInterval = self.setInterval;
var _clearInterval = self.clearInterval;
var _setImmediate = imm.setImmediate;
var _clearImmediate = imm.clearImmediate;

/*
 * Timers
 */

// eslint-disable-next-line func-name-matching
var setTimeoutP = function setTimeout(delay, value, options) {
  if (options && options.signal)
    return signalWrap(_setTimeout, _clearTimeout, delay, value, options);

  return new Promise(function(resolve) {
    _setTimeout.call(self, resolve, delay, value);
  });
};

// eslint-disable-next-line func-name-matching
var setIntervalP = function setInterval(delay, value, options) {
  return new Iterator(delay, value, options);
};

// eslint-disable-next-line func-name-matching
var setImmediateP = function setImmediate(value, options) {
  if (options && options.signal)
    return signalWrap(_setImmediate, _clearImmediate, null, value, options);

  return new Promise(function(resolve) {
    _setImmediate.call(self, resolve, value);
  });
};

/*
 * Scheduler
 */

var scheduler = {
  'yield': function yield_() {
    return setImmediateP(undefined, undefined);
  },
  wait: function wait(delay, options) {
    return setTimeoutP(delay, undefined, options);
  }
};

/*
 * Helpers
 */

function signalWrap(setTimer, clearTimer, delay, value, options) {
  var signal = options.signal;

  if (signal.aborted)
    return Promise.reject(new AbortError(signal));

  var timer, errback;

  var promise = new Promise(function(resolve, reject) {
    if (setTimer === _setTimeout)
      timer = setTimer.call(self, resolve, delay, value);
    else
      timer = setTimer.call(self, resolve, value);

    errback = reject;
  });

  var onCancel = function() {
    if (timer != null) {
      clearTimer.call(self, timer);
      timer = null;
      errback(new AbortError(signal));
    }
  };

  signal.addEventListener('abort', onCancel);

  return promise['finally'](function() {
    signal.removeEventListener('abort', onCancel);
  });
}

/*
 * Interval Iterator
 */

function Iterator(delay, value, options) {
  this.delay = delay;
  this.value = value;
  this.signal = options && options.signal ? options.signal : null;
  this.pending = 0;
  this.timer = null;
  this.resolve = null;
  this.reject = null;
  this.onCancel = null;
  this.init();
}

Iterator.prototype.init = function init() {
  var self = this;

  if (this.signal && this.signal.aborted)
    return;

  this.timer = _setInterval.call(global_, function() {
    if (self.resolve) {
      self.resolve({ value: self.value, done: false });
      self.resolve = null;
      self.reject = null;
    } else {
      self.pending++;
    }
  }, this.delay);

  if (this.signal) {
    this.onCancel = function() {
      if (self.timer != null) {
        _clearInterval.call(global_, self.timer);
        self.timer = null;
      }

      if (self.reject) {
        self.reject(new AbortError(self.signal));
        self.resolve = null;
        self.reject = null;
      }

      self.signal.removeEventListener('abort', self.onCancel);
      self.onCancel = null;
    };

    this.signal.addEventListener('abort', this.onCancel, { once: true });
  }
};

if (typeof Symbol === 'function' && Symbol.asyncIterator) {
  Iterator.prototype[Symbol.asyncIterator] = function() {
    return this;
  };
}

Iterator.prototype.next = function next() {
  if (this.signal && this.signal.aborted)
    return Promise.reject(new AbortError(this.signal));

  if (this.pending === 0) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.resolve = resolve;
      self.reject = reject;
    });
  }

  this.pending--;

  return Promise.resolve({ value: this.value, done: false });
};

/*
 * Errors
 */

function AbortError(signal) {
  var err = new Error('The operation was aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  err.cause = signal.reason;
  if (Error.captureStackTrace)
    Error.captureStackTrace(err, AbortError);
  return err;
}

/*
 * Expose
 */

exports.setTimeout = setTimeoutP;
exports.setInterval = setIntervalP;
exports.setImmediate = setImmediateP;
exports.scheduler = scheduler;
