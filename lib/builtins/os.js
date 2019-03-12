/*!
 * os-browserify@0.3.0
 * Copyright (c) 2019, CoderPuppy (MIT)
 * https://github.com/CoderPuppy/os-browserify#readme
 *
 * License for os-browserify@0.3.0:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2017 CoderPuppy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* eslint no-var: "off" */
/* global location, navigator */

'use strict';

const BE = typeof Int8Array === 'function'
  ? new Int8Array(new Int16Array([1]).buffer)[0] === 0
  : false;

var os = exports;

os.EOL = '\n';

os.arch = function() {
  return 'javascript';
};

os.constants = {};

os.cpus = function() {
  return [];
};

os.endianness = function() {
  return BE ? 'BE' : 'LE';
};

os.freemem = function() {
  return Number.MAX_VALUE;
};

os.getPriority = function(pid) {
  return 0;
};

os.homedir = function() {
  return '/';
};

os.hostname = function() {
  if (typeof location === 'object' && location !== null) {
    if (typeof location.hostname === 'string')
      return location.hostname;
  }
  return 'localhost';
};

os.loadavg = function() {
  return [];
};

os.networkInterfaces = function() {
  return {};
};

os.getNetworkInterfaces = os.networkInterfaces;

os.platform = function() {
  return 'browser';
};

os.release = function() {
  if (typeof navigator === 'object' && navigator !== null) {
    if (typeof navigator.appVersion === 'string')
      return navigator.appVersion;
  }
  return '';
};

os.setPriority = function(pid, priority) {};

os.tmpdir = function() {
  return '/tmp';
};

os.tmpDir = os.tmpdir;

os.totalmem = function() {
  return Number.MAX_VALUE;
};

os.type = function() {
  return 'Browser';
};

os.uptime = function() {
  return process.uptime();
};

os.userInfo = function(options) {
  return {
    uid: 0,
    gid: 0,
    username: 'root',
    homedir: '/',
    shell: '/bin/sh'
  };
};
