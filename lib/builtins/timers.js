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
 */

/* eslint no-var: "off" */

'use strict';

var timers = exports;
var self = global;
var apply = Function.prototype.apply;
var slice = Array.prototype.slice;

/*
 * Globals
 */

var imm = require('./internal/immediate');
var _setTimeout = self.setTimeout;
var _clearTimeout = self.clearTimeout;
var _setInterval = self.setInterval;
var _clearInterval = self.clearInterval;
var _setImmediate = imm.setImmediate;
var _clearImmediate = imm.clearImmediate;

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

timers.setTimeout = function setTimeout() {
  var args = slice.call(arguments, 0);
  return new Timeout(_setTimeout, _clearTimeout, args);
};

timers.clearTimeout = function clearTimeout(timeout) {
  if (timeout instanceof Timeout)
    timeout.close();
};

timers.setInterval = function setInterval() {
  var args = slice.call(arguments, 0);
  return new Timeout(_setInterval, _clearInterval, args);
};

timers.clearInterval = function clearInterval(timeout) {
  if (timeout instanceof Timeout)
    timeout.close();
};

timers.setImmediate = function setImmediate() {
  return new Immediate(apply.call(_setImmediate, self, arguments));
};

timers.clearImmediate = function clearImmediate(immediate) {
  if (immediate instanceof Immediate)
    _clearImmediate.call(self, immediate._id);
};
