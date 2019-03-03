/*!
 * bfile@0.1.4 - Filesystem wrapper for node.js
 * Copyright (c) 2019, Christopher Jeffrey (MIT)
 * https://github.com/bcoin-org/bfile
 *
 * License for bfile@0.1.4:
 *
 * This software is licensed under the MIT License.
 *
 * Copyright (c) 2014-2019, Christopher Jeffrey (https://github.com/chjj)
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
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var __node_modules__ = [
[/* 0 */ 'bfile', '/lib/bfile.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * bfile.js - promisified fs module
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

/*
 * Expose
 */

module.exports = __node_require__(1 /* './fs' */);
}],
[/* 1 */ 'bfile', '/lib/fs.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * fs.js - promisified fs module for bcoin
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const fs = __node_require__(2 /* './backend' */);
const extra = __node_require__(9 /* './extra' */);
const features = __node_require__(3 /* './features' */);

/*
 * Extra
 */

fs.copy = extra.copy;
fs.copySync = extra.copySync;
fs.exists = extra.exists;
fs.existsSync = extra.existsSync;
fs.lstatTry = extra.lstatTry;
fs.lstatTrySync = extra.lstatTrySync;
fs.mkdirp = extra.mkdirp;
fs.mkdirpSync = extra.mkdirpSync;
fs.rimraf = extra.rimraf;
fs.rimrafSync = extra.rimrafSync;
fs.statTry = extra.statTry;
fs.statTrySync = extra.statTrySync;
fs.stats = extra.stats;
fs.statsSync = extra.statsSync;
fs.statsTry = extra.statsTry;
fs.statsTrySync = extra.statsTrySync;
fs.traverse = extra.traverse;
fs.traverseSync = extra.traverseSync;
fs.walk = extra.walk;
fs.walkSync = extra.walkSync;

/*
 * Promises
 */

if (features.HAS_STABLE_PROMISES) {
  const native = fs.realpath.native;

  fs.access = fs.promises.access;
  fs.appendFile = fs.promises.appendFile;
  fs.chmod = fs.promises.chmod;
  fs.chown = fs.promises.chown;
  fs.copyFile = fs.promises.copyFile;
  fs.lchmod = fs.promises.lchmod;
  fs.lchown = fs.promises.lchown;
  fs.link = fs.promises.link;
  fs.lstat = fs.promises.lstat;
  fs.mkdir = fs.promises.mkdir;
  fs.mkdtemp = fs.promises.mkdtemp;
  fs.handle = fs.promises.open;
  fs.readdir = fs.promises.readdir;
  fs.readFile = fs.promises.readFile;
  fs.readlink = fs.promises.readlink;
  fs.realpath = fs.promises.realpath;
  fs.rename = fs.promises.rename;
  fs.rmdir = fs.promises.rmdir;
  fs.stat = fs.promises.stat;
  fs.symlink = fs.promises.symlink;
  fs.truncate = fs.promises.truncate;
  fs.unlink = fs.promises.unlink;
  fs.utimes = fs.promises.utimes;
  fs.writeFile = fs.promises.writeFile;

  // fs.realpath.native does not
  // currently exist for promises.
  if (!fs.realpath.native) {
    fs.realpath = function realpath(...args) {
      return fs.promises.realpath(...args);
    };
    fs.realpath.native = native;
  }
} else {
  let compat = null;

  Object.defineProperty(fs, 'handle', {
    configurable: true,
    enumerable: false,
    get() {
      if (!compat)
        compat = __node_require__(8 /* './compat' */);

      return compat.promises.open;
    }
  });
}

/*
 * Info
 */

fs.features = features;
fs.unsupported = false;

/*
 * Expose
 */

module.exports = fs;
}],
[/* 2 */ 'bfile', '/lib/backend.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * backend.js - backend selection for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const features = __node_require__(3 /* './features' */);

/*
 * Expose
 */

if (features.HAS_ALL)
  module.exports = __node_require__(4 /* './modern' */);
else
  module.exports = __node_require__(7 /* './legacy' */);
}],
[/* 3 */ 'bfile', '/lib/features.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * features.js - feature detection for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/file
 */

'use strict';

const fs = require('fs');

/*
 * Features
 */

const hasOwnProperty = Object.prototype.hasOwnProperty;
const parts = process.version.split(/[^\d]/);
const version = (0
  + (parts[1] & 0xff) * 0x10000
  + (parts[2] & 0xff) * 0x00100
  + (parts[3] & 0xff) * 0x00001);

// fs.Stats got millisecond times in 8.1.0.
let HAS_STAT_NUMBERS = version >= 0x080100;

// fs.copyFile{,Sync} was added in 8.5.0.
let HAS_COPY_FILE = version >= 0x080500;
let HAS_COPY_FILE_IMPL = typeof fs.copyFile === 'function';

// fs.realpath{,Sync}.native was added in 9.2.0.
let HAS_REALPATH_NATIVE = version >= 0x090200;
let HAS_REALPATH_NATIVE_IMPL = typeof fs.realpath.native === 'function';

// fs.{Read,Write}Stream got a `ready` event in 9.11.0.
let HAS_RW_READY = version >= 0x090b00;

// fs.FSWatcher got a `close` event in 10.0.0.
let HAS_WATCHER_CLOSE = version >= 0x0a0000;

// Experimental promise support was added in 10.0.0.
let HAS_PROMISES = version >= 0x0a0000;
let HAS_PROMISES_IMPL = hasOwnProperty.call(fs, 'promises');

// fs.{,l,f}stat{,Sync} got an options parameter to allow for bigints in 10.5.0.
let HAS_STAT_BIGINTS = version >= 0x0a0500;

// fs.lchown{,Sync} is no longer deprecated as of 10.6.0.
let HAS_DEPRECATED_LCHOWN = version <= 0x0a0600;

// fs.readdir and fs.readdirSync got a `withFileTypes` option in 10.10.0.
let HAS_DIRENT = version >= 0x0a0a00;
let HAS_DIRENT_IMPL = typeof fs.Dirent === 'function';

// fs.read{,Sync},fs.write{,File}{,Sync} have typed array support as of 10.10.0.
let HAS_RW_TYPED_ARRAY = version >= 0x0a0a00;

// fs.mkdir{,Sync} got an options parameter to allow for recursion in 10.12.0.
let HAS_RECURSIVE_MKDIR = version >= 0x0a0c00;

// The flags parameter is optional for fs.open{,Sync} as of 11.1.0.
let HAS_OPTIONAL_FLAGS = version >= 0x0b0100;

// fs.WriteStream got a `pending` property in 11.2.0.
let HAS_WRITE_PENDING = version >= 0x0b0200;

// For whenever promises are marked non-experimental.
let HAS_STABLE_PROMISES = false;

// The current highest modern version (11.2.0).
let HAS_ALL = HAS_WRITE_PENDING
           && HAS_COPY_FILE_IMPL
           && HAS_REALPATH_NATIVE_IMPL
           && HAS_PROMISES_IMPL
           && HAS_DIRENT_IMPL;

// Force stable promises with an env variable.
if (process.env.BFILE_FORCE_STABLE === '1')
  HAS_STABLE_PROMISES = true;

// Force compat mode with an env variable.
if (process.env.BFILE_FORCE_COMPAT === '1') {
  HAS_STAT_NUMBERS = false;
  HAS_COPY_FILE = false;
  HAS_COPY_FILE_IMPL = false;
  HAS_REALPATH_NATIVE = false;
  HAS_REALPATH_NATIVE_IMPL = false;
  HAS_RW_READY = false;
  HAS_WATCHER_CLOSE = false;
  HAS_PROMISES = false;
  HAS_PROMISES_IMPL = false;
  HAS_STAT_BIGINTS = false;
  HAS_DEPRECATED_LCHOWN = false;
  HAS_DIRENT = false;
  HAS_DIRENT_IMPL = false;
  HAS_RW_TYPED_ARRAY = false;
  HAS_RECURSIVE_MKDIR = false;
  HAS_OPTIONAL_FLAGS = false;
  HAS_WRITE_PENDING = false;
  HAS_STABLE_PROMISES = false;
  HAS_ALL = false;
}

/*
 * Expose
 */

exports.VERSION = version;
exports.HAS_STAT_NUMBERS = HAS_STAT_NUMBERS;
exports.HAS_COPY_FILE = HAS_COPY_FILE;
exports.HAS_COPY_FILE_IMPL = HAS_COPY_FILE_IMPL;
exports.HAS_REALPATH_NATIVE = HAS_REALPATH_NATIVE;
exports.HAS_REALPATH_NATIVE_IMPL = HAS_REALPATH_NATIVE_IMPL;
exports.HAS_RW_READY = HAS_RW_READY;
exports.HAS_WATCHER_CLOSE = HAS_WATCHER_CLOSE;
exports.HAS_PROMISES = HAS_PROMISES;
exports.HAS_PROMISES_IMPL = HAS_PROMISES_IMPL;
exports.HAS_STAT_BIGINTS = HAS_STAT_BIGINTS;
exports.HAS_DEPRECATED_LCHOWN = HAS_DEPRECATED_LCHOWN;
exports.HAS_DIRENT = HAS_DIRENT;
exports.HAS_DIRENT_IMPL = HAS_DIRENT_IMPL;
exports.HAS_RW_TYPED_ARRAY = HAS_RW_TYPED_ARRAY;
exports.HAS_RECURSIVE_MKDIR = HAS_RECURSIVE_MKDIR;
exports.HAS_OPTIONAL_FLAGS = HAS_OPTIONAL_FLAGS;
exports.HAS_WRITE_PENDING = HAS_WRITE_PENDING;
exports.HAS_STABLE_PROMISES = HAS_STABLE_PROMISES;
exports.HAS_ALL = HAS_ALL;
}],
[/* 4 */ 'bfile', '/lib/modern.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * modern.js - modern backend for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

/* eslint prefer-arrow-callback: "off" */

'use strict';

const fs = require('fs');
const {promisify} = __node_require__(5 /* './util' */);

/*
 * Constants
 */

let promises = null;

/*
 * Expose
 */

exports.access = promisify(fs.access);
exports.accessSync = fs.accessSync;
exports.appendFile = promisify(fs.appendFile);
exports.appendFileSync = fs.appendFileSync;
exports.chmod = promisify(fs.chmod);
exports.chmodSync = fs.chmodSync;
exports.chown = promisify(fs.chown);
exports.chownSync = fs.chownSync;
exports.close = promisify(fs.close);
exports.closeSync = fs.closeSync;
exports.constants = fs.constants;
exports.copyFile = promisify(fs.copyFile);
exports.copyFileSync = fs.copyFileSync;
exports.createReadStream = fs.createReadStream;
exports.createWriteStream = fs.createWriteStream;
exports.exists = null;
exports.existsSync = fs.existsSync;
exports.fchmod = promisify(fs.fchmod);
exports.fchmodSync = fs.fchmodSync;
exports.fchown = promisify(fs.fchown);
exports.fchownSync = fs.fchownSync;
exports.fdatasync = promisify(fs.fdatasync);
exports.fdatasyncSync = fs.fdatasyncSync;
exports.fstat = promisify(fs.fstat);
exports.fstatSync = fs.fstatSync;
exports.fsync = promisify(fs.fsync);
exports.fsyncSync = fs.fsyncSync;
exports.ftruncate = promisify(fs.ftruncate);
exports.ftruncateSync = fs.ftruncateSync;
exports.futimes = promisify(fs.futimes);
exports.futimesSync = fs.futimesSync;
exports.lchmod = promisify(fs.lchmod);
exports.lchmodSync = fs.lchmodSync;
exports.lchown = promisify(fs.lchown);
exports.lchownSync = fs.lchownSync;
exports.link = promisify(fs.link);
exports.linkSync = fs.linkSync;
exports.lstat = promisify(fs.lstat);
exports.lstatSync = fs.lstatSync;
exports.mkdir = promisify(fs.mkdir);
exports.mkdirSync = fs.mkdirSync;
exports.mkdtemp = promisify(fs.mkdtemp);
exports.mkdtempSync = fs.mkdtempSync;
exports.open = promisify(fs.open);
exports.openSync = fs.openSync;
exports.read = null;
exports.readSync = fs.readSync;
exports.readdir = promisify(fs.readdir);
exports.readdirSync = fs.readdirSync;
exports.readFile = promisify(fs.readFile);
exports.readFileSync = fs.readFileSync;
exports.readlink = promisify(fs.readlink);
exports.readlinkSync = fs.readlinkSync;
exports.realpath = promisify(fs.realpath);
exports.realpath.native = promisify(fs.realpath.native);
exports.realpathSync = fs.realpathSync;
exports.rename = promisify(fs.rename);
exports.renameSync = fs.renameSync;
exports.rmdir = promisify(fs.rmdir);
exports.rmdirSync = fs.rmdirSync;
exports.stat = promisify(fs.stat);
exports.statSync = fs.statSync;
exports.symlink = promisify(fs.symlink);
exports.symlinkSync = fs.symlinkSync;
exports.truncate = promisify(fs.truncate);
exports.truncateSync = fs.truncateSync;
exports.unlink = promisify(fs.unlink);
exports.unlinkSync = fs.unlinkSync;
exports.unwatchFile = fs.unwatchFile;
exports.utimes = promisify(fs.utimes);
exports.utimesSync = fs.utimesSync;
exports.watch = fs.watch;
exports.watchFile = fs.watchFile;
exports.write = null;
exports.writeSync = fs.writeSync;
exports.writeFile = promisify(fs.writeFile);
exports.writeFileSync = fs.writeFileSync;

exports.exists = function exists(file) {
  return new Promise(function(resolve, reject) {
    try {
      fs.exists(file, resolve);
    } catch (e) {
      reject(e);
    }
  });
};

exports.read = function read(fd, buffer, offset, length, position) {
  return new Promise(function(resolve, reject) {
    const cb = function(err, bytes, buffer) {
      if (err) {
        reject(err);
        return;
      }
      resolve(bytes);
    };

    try {
      fs.read(fd, buffer, offset, length, position, cb);
    } catch (e) {
      reject(e);
    }
  });
};

exports.write = function write(fd, buffer, offset, length, position) {
  return new Promise(function(resolve, reject) {
    const cb = function(err, bytes, buffer) {
      if (err) {
        reject(err);
        return;
      }
      resolve(bytes);
    };

    if (typeof buffer === 'string') {
      // fs.write(fd, string[, position[, encoding]], callback);
      if (length == null)
        length = 'utf8';

      try {
        fs.write(fd, buffer, offset, length, cb);
      } catch (e) {
        reject(e);
      }
    } else {
      // fs.write(fd, buffer[, offset[, length[, position]]], callback);
      try {
        fs.write(fd, buffer, offset, length, position, cb);
      } catch (e) {
        reject(e);
      }
    }
  });
};

exports.F_OK = fs.F_OK || 0;
exports.R_OK = fs.R_OK || 0;
exports.W_OK = fs.W_OK || 0;
exports.X_OK = fs.X_OK || 0;

exports.Dirent = fs.Dirent;
exports.Stats = fs.Stats;

Object.defineProperties(exports, {
  ReadStream: {
    get() {
      return fs.ReadStream;
    },
    set(val) {
      fs.ReadStream = val;
    }
  },
  WriteStream: {
    get() {
      return fs.WriteStream;
    },
    set(val) {
      fs.WriteStream = val;
    }
  },
  FileReadStream: {
    get() {
      return fs.FileReadStream;
    },
    set(val) {
      fs.FileReadStream = val;
    }
  },
  FileWriteStream: {
    get() {
      return fs.FileWriteStream;
    },
    set(val) {
      fs.FileWriteStream = val;
    }
  },
  promises: {
    configurable: true,
    enumerable: false,
    get() {
      if (!promises) {
        const emit = process.emitWarning;

        process.emitWarning = () => {};

        try {
          promises = fs.promises;
        } finally {
          process.emitWarning = emit;
        }
      }

      return promises;
    }
  }
});
}],
[/* 5 */ 'bfile', '/lib/util.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * util.js - utils for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

/* global SharedArrayBuffer */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const {resolve} = require('path');
const url = require('url');
const {ArgError} = __node_require__(6 /* './error' */);

/*
 * Constants
 */

const WINDOWS = process.platform === 'win32';
const HAS_SHARED_ARRAY_BUFFER = typeof SharedArrayBuffer === 'function';

/*
 * Utils
 */

function call(func, args) {
  return new Promise(function(resolve, reject) {
    const cb = function(err, res) {
      if (err)
        reject(err);
      else
        resolve(res);
    };

    try {
      func(...args, cb);
    } catch (e) {
      reject(e);
    }
  });
}

function promisify(func) {
  if (!func)
    return undefined;

  return function promisified(...args) {
    return new Promise(function(resolve, reject) {
      const cb = function(err, res) {
        if (err)
          reject(err);
        else
          resolve(res);
      };

      try {
        func(...args, cb);
      } catch (e) {
        reject(e);
      }
    });
  };
}

function isPath(path) {
  return typeof path === 'string'
      || Buffer.isBuffer(path)
      || ((path instanceof url.URL)
          && path.protocol === 'file:');
}

function fromPath(path) {
  if (typeof path === 'string')
    return path;

  if (Buffer.isBuffer(path))
    return path.toString('utf8');

  if (path instanceof Uint8Array)
    return toBuffer(path).toString('utf8');

  if (path instanceof url.URL)
    return fileURLToPath(path.href);

  throw new ArgError('path', path, ['string', 'Buffer', 'URL']);
}

function toBuffer(data) {
  if (Buffer.isBuffer(data))
    return data;

  if (ArrayBuffer.isView(data))
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);

  if (isArrayBuffer(data))
    return Buffer.from(data, 0, data.byteLength);

  throw new ArgError('data', data, ['Buffer',
                                    'TypedArray',
                                    'DataView',
                                    'ArrayBuffer',
                                    'SharedArrayBuffer']);
}

/*
 * Helpers
 */

function fileURLToPath(uri) {
  if (url.fileURLToPath)
    return resolve(url.fileURLToPath(uri), '.');

  if (typeof uri !== 'string')
    throw new ArgError('uri', uri, 'string');

  try {
    uri = url.parse(uri);
  } catch (e) {
    const err = new TypeError(`Invalid URL: ${uri}`);
    err.code = 'ERR_INVALID_URL';
    throw err;
  }

  if (uri.protocol !== 'file:') {
    const err = new TypeError('The URL must be of scheme file');
    err.code = 'ERR_INVALID_URL_SCHEME';
    throw err;
  }

  if (uri.port != null) {
    const err = new TypeError(`Invalid URL: ${uri.href}`);
    err.code = 'ERR_INVALID_URL';
    throw err;
  }

  const {hostname, pathname} = uri;

  if (!WINDOWS) {
    if (hostname !== '' && hostname !== 'localhost') {
      const err = new TypeError('File URL host be "localhost" or empty');
      err.code = 'ERR_INVALID_FILE_URL_HOST';
      throw err;
    }

    for (let i = 0; i < pathname.length - 2; i++) {
      if (pathname[i] === '%') {
        const third = pathname.codePointAt(i + 2) | 0x20;

        if (pathname[i + 1] === '2' && third === 102) {
          const err = new TypeError('File URL path must '
                                  + 'not include encoded '
                                  + '/ characters');
          err.code = 'ERR_INVALID_FILE_URL_PATH';
          throw err;
        }
      }
    }

    const path = decodeURIComponent(pathname);

    if (path.length === 0)
      return '/';

    return resolve(path, '.');
  }

  for (let i = 0; i < pathname.length - 2; i++) {
    if (pathname[i] === '%') {
      const third = pathname.codePointAt(i + 2) | 0x20;

      if ((pathname[i + 1] === '2' && third === 102)
          || (pathname[i + 1] === '5' && third === 99)) {
        const err = new TypeError('File URL path must '
                                + 'not include encoded '
                                + '\\ or / characters');
        err.code = 'ERR_INVALID_FILE_URL_PATH';
        throw err;
      }
    }
  }

  const path = decodeURIComponent(pathname);

  if (hostname !== '') {
    const punycode = require('punycode');
    return resolve(`//${punycode.toUnicode(hostname)}${path}`, '.');
  }

  let letter = 0x00;
  let sep = 0x00;

  if (path.length >= 3) {
    letter = path.codePointAt(1) | 0x20;
    sep = path.charCodeAt(2);
  }

  if (letter < 0x61 || letter > 0x7a || sep !== 0x3a) {
    const err = new TypeError('File URL path must be absolute');
    err.code = 'ERR_INVALID_FILE_URL_PATH';
    throw err;
  }

  return resolve(path.substring(1), '.');
}

function isArrayBuffer(data) {
  if (data instanceof ArrayBuffer)
    return true;

  if (HAS_SHARED_ARRAY_BUFFER) {
    if (data instanceof SharedArrayBuffer)
      return true;
  }

  return false;
}

/*
 * Expose
 */

exports.call = call;
exports.promisify = promisify;
exports.isPath = isPath;
exports.fromPath = fromPath;
exports.toBuffer = toBuffer;
}],
[/* 6 */ 'bfile', '/lib/error.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * error.js - errors for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

/**
 * ArgError
 */

class ArgError extends TypeError {
  constructor(name, value, expect) {
    let msg;

    if (Array.isArray(expect) && expect.length === 1)
      [expect] = expect;

    if (Array.isArray(expect)) {
      const last = expect.pop();

      msg = `The "${name}" argument must be one of type `
          + `${expect.join(', ')}, or ${last}. `
          + `Received type ${typeof value}`;
    } else {
      msg = `The "${name}" argument must be of type ${expect}. `
          + `Received type ${typeof value}`;
    }

    super(msg);

    this.code = 'ERR_INVALID_ARG_TYPE';

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * FSError
 */

class FSError extends Error {
  constructor(desc, ...args) {
    let message, syscall, path;

    if (desc == null || typeof desc !== 'object')
      throw new TypeError('invalid arguments for fs error');

    if (args.length === 2)
      [message, syscall, path] = [desc.message, ...args];
    else if (args.length === 3)
      [message, syscall, path] = args;
    else
      throw new TypeError('invalid arguments for fs error');

    let msg = `${desc.code}:`;

    if (message)
      msg += ` ${message},`;

    if (syscall)
      msg += ` ${syscall}`;

    if (path)
      msg += ` ${path}`;

    super(msg);

    this.code = desc.code;
    this.errno = desc.errno;

    if (syscall)
      this.syscall = syscall;

    if (path)
      this.path = path;

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, this.constructor);
  }
}

/*
 * Errors
 */

FSError.EPERM = {
  code: 'EPERM',
  errno: -1,
  message: 'operation not permitted'
};

FSError.ENOENT = {
  code: 'ENOENT',
  errno: -2,
  message: 'no such file or directory'
};

FSError.EIO = {
  code: 'EIO',
  errno: -5,
  message: 'I/O error'
};

FSError.EBADF = {
  code: 'EBADF',
  errno: -9,
  message: 'bad file descriptor'
};

FSError.EACCES = {
  code: 'EACCES',
  errno: -13,
  message: 'permission denied'
};

FSError.EEXIST = {
  code: 'EEXIST',
  errno: -17,
  message: 'file already exists'
};

FSError.ENOTDIR = {
  code: 'ENOTDIR',
  errno: -20,
  message: 'not a directory'
};

FSError.EISDIR = {
  code: 'EISDIR',
  errno: -21,
  message: 'file is a directory'
};

/*
 * Expose
 */

exports.ArgError = ArgError;
exports.FSError = FSError;
}],
[/* 7 */ 'bfile', '/lib/legacy.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * legacy.js - legacy backend for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const compat = __node_require__(8 /* './compat' */);
const features = __node_require__(3 /* './features' */);
const fs = __node_require__(4 /* './modern' */);

/*
 * Helpers
 */

let cloned = false;

// Future proofing:
const clone = () => {
  if (!cloned) {
    fs.constants = Object.assign(Object.create(null), fs.constants);
    cloned = true;
  }
};

/*
 * Legacy
 */

if (!features.HAS_STAT_NUMBERS
    || !features.HAS_STAT_BIGINTS) {
  fs.fstat = compat.fstat;
  fs.fstatSync = compat.fstatSync;
  fs.stat = compat.stat;
  fs.statSync = compat.statSync;
  fs.lstat = compat.lstat;
  fs.lstatSync = compat.lstatSync;
}

if (!features.HAS_COPY_FILE_IMPL) {
  clone();
  fs.constants.COPYFILE_EXCL = compat.COPYFILE_EXCL;
  fs.constants.COPYFILE_FICLONE = compat.COPYFILE_FICLONE;
  fs.constants.COPYFILE_FICLONE_FORCE = compat.COPYFILE_FICLONE_FORCE;
  fs.copyFile = compat.copyFile;
  fs.copyFileSync = compat.copyFileSync;
}

if (!features.HAS_REALPATH_NATIVE_IMPL) {
  fs.realpath = compat.realpath;
  fs.realpathSync = compat.realpathSync;
}

if (!features.HAS_PROMISES_IMPL) {
  Object.defineProperty(fs, 'promises', {
    configurable: true,
    enumerable: false,
    get() {
      return compat.promises;
    }
  });
}

if (!features.HAS_DIRENT_IMPL) {
  fs.readdir = compat.readdir;
  fs.readdirSync = compat.readdirSync;
  fs.Dirent = compat.Dirent;
}

if (!features.HAS_RW_TYPED_ARRAY) {
  fs.read = compat.read;
  fs.readSync = compat.readSync;
  fs.write = compat.write;
  fs.writeSync = compat.writeSync;
  fs.writeFile = compat.writeFile;
  fs.writeFileSync = compat.writeFileSync;
}

if (!features.HAS_RECURSIVE_MKDIR) {
  fs.mkdir = compat.mkdir;
  fs.mkdirSync = compat.mkdirSync;
}

if (!features.HAS_OPTIONAL_FLAGS)
  fs.open = compat.open;

/*
 * Expose
 */

module.exports = fs;
}],
[/* 8 */ 'bfile', '/lib/compat.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * compat.js - compat functions for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

/* global BigInt */

'use strict';

const fs = require('fs');
const path = require('path');
const {ArgError, FSError} = __node_require__(6 /* './error' */);
const util = __node_require__(5 /* './util' */);
const {EIO, ENOTDIR} = FSError;

const {
  dirname,
  join,
  normalize
} = path;

const {
  call,
  promisify,
  fromPath,
  toBuffer
} = util;

/*
 * Constants
 */

const COPYFILE_EXCL = 1 << 0;
const COPYFILE_FICLONE = 1 << 1;
const COPYFILE_FICLONE_FORCE = 1 << 2;

/*
 * copyFile()
 */

async function copyFile(src, dest, flags) {
  if (flags == null)
    flags = 0;

  if ((flags >>> 0) !== flags)
    throw new ArgError('flags', flags, 'integer');

  const writer = fs.createWriteStream(dest, {
    flags: (flags & COPYFILE_EXCL) ? 'wx' : 'w',
    mode: (await call(fs.stat, [src])).mode
  });

  const reader = fs.createReadStream(src);

  return new Promise((resolve, reject) => {
    let called = false;
    let onError;
    let onClose;

    const cleanup = () => {
      if (called)
        return false;

      called = true;

      writer.removeListener('error', onError);
      writer.removeListener('close', onClose);

      reader.removeListener('error', onError);

      try {
        writer.destroy();
      } catch (e) {
        ;
      }

      try {
        reader.destroy();
      } catch (e) {
        ;
      }

      return true;
    };

    onError = (err) => {
      if (cleanup())
        reject(err);
    };

    onClose = () => {
      if (cleanup())
        resolve();
    };

    writer.on('error', onError);
    writer.on('close', onClose);

    reader.on('error', onError);

    try {
      reader.pipe(writer);
    } catch (e) {
      reject(e);
    }
  });
}

function copyFileSync(src, dest, flags) {
  if (flags == null)
    flags = 0;

  if ((flags >>> 0) !== flags)
    throw new ArgError('flags', flags, 'integer');

  const flag = (flags & COPYFILE_EXCL) ? 'wx' : 'w';
  const slab = Buffer.allocUnsafe(64 * 1024);

  let rfd = null;
  let stat = null;
  let wfd = null;
  let pos = 0;

  try {
    rfd = fs.openSync(src, 'r');
    stat = fs.fstatSync(rfd);
    wfd = fs.openSync(dest, flag, stat.mode);

    while (pos < stat.size) {
      const length = Math.min(stat.size - pos, slab.length);
      const bytes = fs.readSync(rfd, slab, 0, length, pos);

      if (bytes !== length)
        throw new FSError(EIO, 'read', fromPath(src));

      fs.writeSync(wfd, slab, 0, length, null);
      pos += bytes;
    }
  } finally {
    try {
      if (wfd != null)
        fs.closeSync(wfd);
    } finally {
      if (rfd != null)
        fs.closeSync(rfd);
    }
  }
}

/*
 * mkdir()
 */

function getPaths(path) {
  const paths = [];

  let dir = normalize(fromPath(path));

  for (;;) {
    paths.push(dir);

    const next = dirname(dir);

    if (next === dir)
      break;

    dir = next;
  }

  return paths.reverse();
}

async function mkdirp(dir, mode) {
  if (mode == null)
    mode = 0o777;

  if ((mode >>> 0) !== mode)
    throw new ArgError('mode', mode, 'integer');

  for (const path of getPaths(dir)) {
    try {
      const stat = await call(fs.stat, [path]);
      if (!stat.isDirectory())
        throw new FSError(ENOTDIR, 'mkdir', path);
    } catch (e) {
      if (e.code === 'ENOENT')
        await call(fs.mkdir, [path, mode]);
      else
        throw e;
    }
  }
}

function mkdirpSync(dir, mode) {
  if (mode == null)
    mode = 0o777;

  if ((mode >>> 0) !== mode)
    throw new ArgError('mode', mode, 'integer');

  for (const path of getPaths(dir)) {
    try {
      const stat = fs.statSync(path);
      if (!stat.isDirectory())
        throw new FSError(ENOTDIR, 'mkdir', path);
    } catch (e) {
      if (e.code === 'ENOENT')
        fs.mkdirSync(path, mode);
      else
        throw e;
    }
  }
}

function mkdirArgs(path, options) {
  let mode = null;
  let recursive = false;

  if (options != null) {
    if (typeof options === 'object') {
      if (options.mode != null)
        mode = options.mode;

      if (options.recursive != null)
        recursive = options.recursive;
    } else {
      mode = options;
    }
  }

  if (mode != null && (mode >>> 0) !== mode)
    throw new ArgError('mode', mode, 'integer');

  if (typeof recursive !== 'boolean')
    throw new ArgError('recursive', recursive, 'boolean');

  if (mode != null)
    return [[path, mode], recursive];

  return [[path], recursive];
}

async function mkdir(path, options) {
  const [args, recursive] = mkdirArgs(path, options);

  if (recursive)
    return mkdirp(...args);

  return call(fs.mkdir, args);
}

function mkdirSync(path, options) {
  const [args, recursive] = mkdirArgs(path, options);

  if (recursive)
    return mkdirpSync(...args);

  return fs.mkdirSync(...args);
}

/*
 * open()
 */

async function open(...args) {
  if (args[1] == null)
    args[1] = 'r';

  return call(fs.open, args);
}

function openSync(...args) {
  if (args[1] == null)
    args[1] = 'r';

  return fs.openSync(...args);
}

/*
 * read()
 */

async function read(...args) {
  args[1] = toBuffer(args[1]);
  return call(fs.read, args);
}

function readSync(...args) {
  args[1] = toBuffer(args[1]);
  return fs.readSync(...args);
}

/*
 * readdir()
 */

async function readdir(...args) {
  const [dir, options] = args;
  const withFileTypes = options && options.withFileTypes;
  const list = await call(fs.readdir, args);

  if (!withFileTypes || fs.Dirent)
    return list;

  const out = [];
  const root = fromPath(dir);

  for (const name of list) {
    const file = join(root, fromPath(name));
    const stat = await call(fs.lstat, [file]);

    out.push(new Dirent(name, stat));
  }

  return out;
}

function readdirSync(...args) {
  const [dir, options] = args;
  const withFileTypes = options && options.withFileTypes;
  const list = fs.readdirSync(...args);

  if (!withFileTypes || fs.Dirent)
    return list;

  const out = [];
  const root = fromPath(dir);

  for (const name of list) {
    const file = join(root, fromPath(name));
    const stat = fs.lstatSync(file);

    out.push(new Dirent(name, stat));
  }

  return out;
}

/**
 * Dirent
 */

class Dirent {
  constructor(name, stat) {
    this.name = name;
    this.stat = stat;
  }

  isBlockDevice() {
    return this.stat.isBlockDevice();
  }

  isCharacterDevice() {
    return this.stat.isCharacterDevice();
  }

  isDirectory() {
    return this.stat.isDirectory();
  }

  isFIFO() {
    return this.stat.isFIFO();
  }

  isFile() {
    return this.stat.isFile();
  }

  isSocket() {
    return this.stat.isSocket();
  }

  isSymbolicLink() {
    return this.stat.isSymbolicLink();
  }
}

/*
 * realpath.native()
 */

function realpath(...args) {
  return call(fs.realpath, args);
}

realpath.native = async function(...args) {
  return call(fs.realpath, args);
};

function realpathSync(...args) {
  return fs.realpathSync(...args);
}

realpathSync.native = function(...args) {
  return fs.realpathSync(...args);
};

/*
 * stat()
 */

function wrapStat(statter) {
  return async function stat(file, options) {
    return convertStat(await call(statter, [file]), options);
  };
}

function wrapStatSync(statter) {
  return function statSync(file, options) {
    return convertStat(statter(file), options);
  };
}

function convertStat(stats, options) {
  const bigint = options && options.bigint;

  if (stats.atimeMs == null) {
    stats.atimeMs = stats.atime.getTime();
    stats.mtimeMs = stats.mtime.getTime();
    stats.ctimeMs = stats.ctime.getTime();
    stats.birthtimeMs = stats.birthtime.getTime();
  }

  // eslint-disable-next-line
  if (bigint && typeof stats.atimeMs !== 'bigint') {
    if (typeof BigInt !== 'function')
      throw new Error('Bigint is not supported.');

    stats.dev = BigInt(stats.dev);
    stats.ino = BigInt(stats.ino);
    stats.mode = BigInt(stats.mode);
    stats.nlink = BigInt(stats.nlink);
    stats.uid = BigInt(stats.uid);
    stats.gid = BigInt(stats.gid);
    stats.rdev = BigInt(stats.rdev);
    stats.size = BigInt(stats.size);
    stats.blksize = BigInt(stats.blksize);
    stats.blocks = BigInt(stats.blocks);
    stats.atimeMs = BigInt(Math.floor(stats.atimeMs));
    stats.mtimeMs = BigInt(Math.floor(stats.mtimeMs));
    stats.ctimeMs = BigInt(Math.floor(stats.ctimeMs));
    stats.birthtimeMs = BigInt(Math.floor(stats.birthtimeMs));
  }

  return stats;
}

const fstat = wrapStat(fs.fstat);
const fstatSync = wrapStatSync(fs.fstatSync);
const stat = wrapStat(fs.stat);
const statSync = wrapStatSync(fs.statSync);
const lstat = wrapStat(fs.lstat);
const lstatSync = wrapStatSync(fs.lstatSync);

/*
 * write()
 */

async function write(...args) {
  if (typeof args[1] !== 'string')
    args[1] = toBuffer(args[1]);

  return call(fs.write, args);
}

function writeSync(...args) {
  if (typeof args[1] !== 'string')
    args[1] = toBuffer(args[1]);

  return fs.writeSync(...args);
}

/*
 * writeFile()
 */

async function writeFile(...args) {
  if (typeof args[1] !== 'string')
    args[1] = toBuffer(args[1]);

  return call(fs.writeFile, args);
}

function writeFileSync(...args) {
  if (typeof args[1] !== 'string')
    args[1] = toBuffer(args[1]);

  return fs.writeFileSync(...args);
}

/**
 * FileHandle
 */

class FileHandle {
  constructor(fd) {
    this._fd = fd;
  }

  getAsyncId() {
    return -1;
  }

  get fd() {
    return this._fd;
  }

  appendFile(...args) {
    return call(fs.appendFile, [this._fd, ...args]);
  }

  chmod(...args) {
    return call(fs.fchmod, [this._fd, ...args]);
  }

  chown(...args) {
    return call(fs.fchown, [this._fd, ...args]);
  }

  close() {
    return call(fs.close, [this._fd]);
  }

  datasync() {
    return call(fs.fdatasync, [this._fd]);
  }

  async read(...args) {
    return {
      bytesRead: await read(this._fd, ...args),
      buffer: args[0]
    };
  }

  readFile(...args) {
    return call(fs.readFile, [this._fd, ...args]);
  }

  stat(...args) {
    return fstat(this._fd, ...args);
  }

  sync() {
    return call(fs.fsync, [this._fd]);
  }

  truncate(...args) {
    return call(fs.ftruncate, [this._fd, ...args]);
  }

  utimes(...args) {
    return call(fs.futimes, [this._fd, ...args]);
  }

  async write(...args) {
    return {
      bytesWritten: await write(this._fd, ...args),
      buffer: args[0]
    };
  }

  writeFile(...args) {
    return writeFile(this._fd, ...args);
  }
}

/*
 * Promises
 */

const promises = {
  FileHandle,
  access: promisify(fs.access),
  appendFile: promisify(fs.appendFile),
  chmod: promisify(fs.chmod),
  chown: promisify(fs.chown),
  copyFile,
  lchmod: promisify(fs.lchmod),
  lchown: promisify(fs.lchown),
  link: promisify(fs.link),
  lstat,
  mkdir,
  mkdtemp: promisify(fs.mkdtemp),
  // eslint-disable-next-line
  open: async function _open(...args) {
    return new FileHandle(await open(...args));
  },
  readdir,
  readFile: promisify(fs.readFile),
  readlink: promisify(fs.readlink),
  realpath,
  rename: promisify(fs.rename),
  rmdir: promisify(fs.rmdir),
  stat,
  symlink: promisify(fs.symlink),
  truncate: promisify(fs.truncate),
  unlink: promisify(fs.unlink),
  utimes: promisify(fs.utimes),
  writeFile
};

/*
 * Expose
 */

exports.COPYFILE_EXCL = COPYFILE_EXCL;
exports.COPYFILE_FICLONE = COPYFILE_FICLONE;
exports.COPYFILE_FICLONE_FORCE = COPYFILE_FICLONE_FORCE;
exports.copyFile = copyFile;
exports.copyFileSync = copyFileSync;
exports.mkdir = mkdir;
exports.mkdirSync = mkdirSync;
exports.open = open;
exports.openSync = openSync;
exports.read = read;
exports.readSync = readSync;
exports.readdir = readdir;
exports.readdirSync = readdirSync;
exports.Dirent = Dirent;
exports.realpath = realpath;
exports.realpathSync = realpathSync;
exports.fstat = fstat;
exports.fstatSync = fstatSync;
exports.stat = stat;
exports.statSync = statSync;
exports.lstat = lstat;
exports.lstatSync = lstatSync;
exports.write = write;
exports.writeSync = writeSync;
exports.writeFile = writeFile;
exports.writeFileSync = writeFileSync;
exports.promises = promises;
}],
[/* 9 */ 'bfile', '/lib/extra.js', function(exports, require, module, __filename, __dirname, __meta) {
/*!
 * extra.js - extra functions for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const path = require('path');
const {ArgError, FSError} = __node_require__(6 /* './error' */);
const fs = __node_require__(2 /* './backend' */);
const {fromPath} = __node_require__(5 /* './util' */);
const {join, resolve} = path;
const {EEXIST, EPERM} = FSError;

/*
 * Constants
 */

const ASYNC_ITERATOR = Symbol.asyncIterator || 'asyncIterator';

/*
 * Extra
 */

async function copy(src, dest, flags, filter) {
  if (typeof flags === 'function')
    [flags, filter] = [filter, flags];

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = async (src, stat) => true;

  src = fromPath(src);
  dest = fromPath(dest);

  if ((flags >>> 0) !== flags)
    throw new ArgError('flags', flags, 'integer');

  if (typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  const overwrite = (flags & fs.constants.COPYFILE_EXCL) === 0;
  const sstat = await fs.lstat(src);
  const dstat = await lstatTry(dest);

  let ret = 0;

  if (!overwrite && dstat)
    throw new FSError(EEXIST, 'copy', dest);

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw new FSError(EPERM, 'cannot copy file into itself', 'copy', dest);
  }

  if (!await filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = await fs.readdir(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new FSError(EEXIST, 'mkdir', dest);
    } else {
      await fs.mkdir(dest, sstat.mode);
    }

    for (const name of list) {
      ret += await copy(join(src, name),
                        join(dest, name),
                        flags,
                        filter);
    }

    return ret;
  }

  if (sstat.isSymbolicLink()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new FSError(EEXIST, 'symlink', dest);
      }

      await fs.unlink(dest);
    }

    await fs.symlink(await fs.readlink(src), dest);

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new FSError(EEXIST, 'open', dest);
      }

      if (!dstat.isFile())
        await fs.unlink(dest);
    }

    await fs.copyFile(src, dest, flags);

    return ret;
  }

  return ret + 1;
}

function copySync(src, dest, flags, filter) {
  if (typeof flags === 'function')
    [flags, filter] = [filter, flags];

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = (src, stat) => true;

  src = fromPath(src);
  dest = fromPath(dest);

  if ((flags >>> 0) !== flags)
    throw new ArgError('flags', flags, 'integer');

  if (typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  const overwrite = (flags & fs.constants.COPYFILE_EXCL) === 0;
  const sstat = fs.lstatSync(src);
  const dstat = lstatTrySync(dest);

  let ret = 0;

  if (!overwrite && dstat)
    throw new FSError(EEXIST, 'copy', dest);

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw new FSError(EPERM, 'cannot copy file into itself', 'copy', dest);
  }

  if (!filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = fs.readdirSync(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new FSError(EEXIST, 'mkdir', dest);
    } else {
      fs.mkdirSync(dest, sstat.mode);
    }

    for (const name of list) {
      ret += copySync(join(src, name),
                      join(dest, name),
                      flags,
                      filter);
    }

    return ret;
  }

  if (sstat.isSymbolicLink()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new FSError(EEXIST, 'symlink', dest);
      }

      fs.unlinkSync(dest);
    }

    fs.symlinkSync(fs.readlinkSync(src), dest);

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new FSError(EEXIST, 'open', dest);
      }

      if (!dstat.isFile())
        fs.unlinkSync(dest);
    }

    fs.copyFileSync(src, dest, flags);

    return ret;
  }

  return ret + 1;
}

async function exists(file, mode) {
  if (mode == null)
    mode = fs.constants.F_OK;

  try {
    await fs.access(file, mode);
    return true;
  } catch (e) {
    if (isNoEntry(e))
      return false;
    throw e;
  }
}

function existsSync(file, mode) {
  if (mode == null)
    mode = fs.constants.F_OK;

  try {
    fs.accessSync(file, mode);
    return true;
  } catch (e) {
    if (isNoEntry(e))
      return false;
    throw e;
  }
}

async function lstatTry(...args) {
  try {
    return await fs.lstat(...args);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

function lstatTrySync(...args) {
  try {
    return fs.lstatSync(...args);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

async function mkdirp(dir, mode) {
  if (mode == null)
    mode = 0o777;

  return fs.mkdir(dir, { mode, recursive: true });
}

function mkdirpSync(dir, mode) {
  if (mode == null)
    mode = 0o777;

  return fs.mkdirSync(dir, { mode, recursive: true });
}

async function rimraf(path, filter) {
  if (filter == null)
    filter = async (path, stat) => true;

  path = fromPath(path);

  if (typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  let ret = 0;
  let stat = null;

  try {
    stat = await fs.lstat(path);
  } catch (e) {
    if (isNoEntry(e))
      return ret + 1;
    throw e;
  }

  if (!await filter(path, stat))
    return ret + 1;

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = await fs.readdir(path);
    } catch (e) {
      if (isNoEntry(e))
        return ret + 1;
      throw e;
    }

    for (const name of list)
      ret += await rimraf(join(path, name), filter);

    try {
      await fs.rmdir(path);
    } catch (e) {
      if (isNoEntry(e) || e.code === 'ENOTEMPTY')
        return ret + 1;
      throw e;
    }

    return ret;
  }

  try {
    await fs.unlink(path);
  } catch (e) {
    if (isNoEntry(e))
      return ret + 1;
    throw e;
  }

  return ret;
}

function rimrafSync(path, filter) {
  if (filter == null)
    filter = (path, stat) => true;

  path = fromPath(path);

  if (typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  let ret = 0;
  let stat = null;

  try {
    stat = fs.lstatSync(path);
  } catch (e) {
    if (isNoEntry(e))
      return ret + 1;
    throw e;
  }

  if (!filter(path, stat))
    return ret + 1;

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = fs.readdirSync(path);
    } catch (e) {
      if (isNoEntry(e))
        return ret + 1;
      throw e;
    }

    for (const name of list)
      ret += rimrafSync(join(path, name), filter);

    try {
      fs.rmdirSync(path);
    } catch (e) {
      if (isNoEntry(e) || e.code === 'ENOTEMPTY')
        return ret + 1;
      throw e;
    }

    return ret;
  }

  try {
    fs.unlinkSync(path);
  } catch (e) {
    if (isNoEntry(e))
      return ret + 1;
    throw e;
  }

  return ret;
}

async function statTry(...args) {
  try {
    return await fs.stat(...args);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

function statTrySync(...args) {
  try {
    return fs.statSync(...args);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

async function stats(file, options) {
  let [follow, opt] = parseStatsOptions(options);

  // Avoid a bug with
  // option parsing.
  if (opt == null)
    opt = {};

  if (follow) {
    try {
      return await fs.stat(file, opt);
    } catch (e) {
      if (!isNoEntry(e))
        throw e;
    }
  }

  return await fs.lstat(file, opt);
}

function statsSync(file, options) {
  const [follow, opt] = parseStatsOptions(options);

  if (follow) {
    try {
      return fs.statSync(file, opt);
    } catch (e) {
      if (!isNoEntry(e))
        throw e;
    }
  }

  return fs.lstatSync(file, opt);
}

async function statsTry(file, options) {
  try {
    return await stats(file, options);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

function statsTrySync(file, options) {
  try {
    return statsSync(file, options);
  } catch (e) {
    if (isNoEntry(e))
      return null;
    throw e;
  }
}

/*
 * Traversal
 */

async function traverse(root, options, cb) {
  if (Array.isArray(root)) {
    for (const file of root)
      await traverse(fromPath(file), options, cb);
    return;
  }

  const path = fromPath(root);

  if (typeof options === 'function')
    [options, cb] = [null, options];

  if (typeof cb !== 'function')
    throw new ArgError('callback', cb, 'function');

  const [follow, maxDepth] = parseWalkOptions(options);
  const seen = new Set();

  await (async function next(path, depth) {
    const stat = await statsTry(path, options);

    let result = cb(path, stat, depth);

    if (result instanceof Promise)
      result = await result;

    if (result === false)
      return false;

    if (stat && stat.isDirectory()) {
      if (depth === maxDepth)
        return true;

      if (follow) {
        let real = resolve(path);

        try {
          real = await fs.realpath(real);
        } catch (e) {
          if (!isNoEntry(e))
            throw e;
        }

        if (seen.has(real))
          return true;

        seen.add(real);
      }

      let list = null;

      try {
        list = await fs.readdir(path);
      } catch (e) {
        if (isNoEntry(e))
          return true;
        throw e;
      }

      for (const name of list) {
        if (!await next(join(path, name), depth + 1, cb))
          return false;
      }
    }

    return true;
  })(path, 0);
}

function traverseSync(root, options, cb) {
  if (typeof options === 'function')
    [options, cb] = [null, options];

  if (typeof cb !== 'function')
    throw new ArgError('callback', cb, 'function');

  for (const [file, stat, depth] of walkSync(root, options)) {
    if (cb(file, stat, depth) === false)
      break;
  }
}

function walk(root, options) {
  const paths = [];

  if (Array.isArray(root)) {
    for (let i = root.length - 1; i >= 0; i--)
      paths.push(fromPath(root[i]));
  } else {
    paths.push(root);
  }

  const [follow, maxDepth] = parseWalkOptions(options);

  return new AsyncWalker(paths, follow, maxDepth, options);
}

function* walkSync(root, options) {
  if (Array.isArray(root)) {
    for (const file of root)
      yield* walkSync(fromPath(file), options);
    return;
  }

  const path = fromPath(root);
  const [follow, maxDepth] = parseWalkOptions(options);
  const seen = new Set();

  yield* (function* next(path, depth) {
    const stat = statsTrySync(path, options);

    yield [path, stat, depth];

    if (stat && stat.isDirectory()) {
      if (depth === maxDepth)
        return;

      if (follow) {
        let real = resolve(path);

        try {
          real = fs.realpathSync(real);
        } catch (e) {
          if (!isNoEntry(e))
            throw e;
        }

        if (seen.has(real))
          return;

        seen.add(real);
      }

      let list = null;

      try {
        list = fs.readdirSync(path);
      } catch (e) {
        if (isNoEntry(e))
          return;
        throw e;
      }

      for (const name of list)
        yield* next(join(path, name), depth + 1);
    }
  })(path, 0);
}

/**
 * AsyncWalker
 */

class AsyncWalker {
  constructor(paths, follow, maxDepth, options) {
    this.stack = [paths];
    this.follow = follow;
    this.maxDepth = maxDepth;
    this.options = options;
    this.seen = new Set();
    this.depth = 0;
  }

  [ASYNC_ITERATOR]() {
    return this;
  }

  get() {
    if (this.stack.length === 0)
      return null;

    const items = this.stack[this.stack.length - 1];

    if (items.length === 0)
      return null;

    return items.pop();
  }

  pop() {
    if (this.stack.length === 0)
      return;

    const items = this.stack[this.stack.length - 1];

    if (items.length === 0) {
      this.stack.pop();
      this.depth -= 1;
    }
  }

  async read(path, stat) {
    if (!stat || !stat.isDirectory())
      return false;

    if (this.depth === this.maxDepth)
      return false;

    if (this.follow) {
      let real = resolve(path);

      try {
        real = await fs.realpath(real);
      } catch (e) {
        if (!isNoEntry(e))
          throw e;
      }

      if (this.seen.has(real))
        return false;

      this.seen.add(real);
    }

    let list = null;

    try {
      list = await fs.readdir(path);
    } catch (e) {
      if (isNoEntry(e))
        return false;
      throw e;
    }

    if (list.length === 0)
      return false;

    const items = [];

    for (let i = list.length - 1; i >= 0; i--)
      items.push(join(path, list[i]));

    this.stack.push(items);
    this.depth += 1;

    return true;
  }

  async next() {
    this.pop();

    const depth = this.depth;
    const path = this.get();

    if (path == null)
      return { value: undefined, done: true };

    const stat = await statsTry(path, this.options);

    if (!await this.read(path, stat))
      this.pop();

    return { value: [path, stat, depth], done: false };
  }
}

/*
 * Helpers
 */

function isNoEntry(err) {
  if (!err)
    return false;

  return err.code === 'ENOENT'
      || err.code === 'EACCES'
      || err.code === 'EPERM'
      || err.code === 'ELOOP';
}

function parseStatsOptions(options) {
  if (options == null)
    return [false, undefined];

  if (typeof options === 'boolean')
    return [options, undefined];

  if (typeof options !== 'object')
    throw new ArgError('options', options, 'object');

  let {follow, bigint} = options;

  if (follow == null)
    follow = false;

  if (bigint == null)
    bigint = false;

  if (typeof follow !== 'boolean')
    throw new ArgError('follow', follow, 'boolean');

  if (typeof bigint !== 'boolean')
    throw new ArgError('bigint', bigint, 'boolean');

  return [follow, { bigint }];
}

function parseWalkOptions(options) {
  if (options == null)
    return [false, -1];

  if (typeof options === 'boolean')
    return [options, -1];

  if (typeof options !== 'object')
    throw new ArgError('options', options, 'object');

  let {follow, maxDepth} = options;

  if (follow == null)
    follow = false;

  if (maxDepth == null)
    maxDepth = -1;

  if (typeof follow !== 'boolean')
    throw new ArgError('follow', follow, 'boolean');

  if (maxDepth !== -1 && (maxDepth >>> 0) !== maxDepth)
    throw new ArgError('maxDepth', maxDepth, 'integer');

  return [follow, maxDepth];
}

/*
 * Expose
 */

exports.copy = copy;
exports.copySync = copySync;
exports.exists = exists;
exports.existsSync = existsSync;
exports.lstatTry = lstatTry;
exports.lstatTrySync = lstatTrySync;
exports.mkdirp = mkdirp;
exports.mkdirpSync = mkdirpSync;
exports.rimraf = rimraf;
exports.rimrafSync = rimrafSync;
exports.statTry = statTry;
exports.statTrySync = statTrySync;
exports.stats = stats;
exports.statsSync = statsSync;
exports.statsTry = statsTry;
exports.statsTrySync = statsTrySync;
exports.traverse = traverse;
exports.traverseSync = traverseSync;
exports.walk = walk;
exports.walkSync = walkSync;
}]
];

var __node_cache__ = [];

function __node_error__(location) {
  var err = new Error('Cannot find module \'' + location + '\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

function __node_require__(id) {
  if ((id >>> 0) !== id || id > __node_modules__.length)
    return __node_error__(id);

  while (__node_cache__.length <= id)
    __node_cache__.push(null);

  var cache = __node_cache__[id];

  if (cache)
    return cache.exports;

  var mod = __node_modules__[id];
  var name = mod[0];
  var path = mod[1];
  var func = mod[2];

  var filename = __filename;
  var dirname = __dirname;
  var meta;

  var _require = require;
  var _exports = exports;
  var _module = module;

  if (id !== 0) {
    _exports = {};
    _module = {
      id: '/' + name + path,
      exports: _exports,
      parent: module.parent,
      filename: filename,
      loaded: false,
      children: module.children,
      paths: module.paths,
      require: _require
    };
  }

  __node_cache__[id] = _module;

  try {
    func.call(_exports, _exports, _require,
              _module, filename, dirname, meta);
  } catch (e) {
    __node_cache__[id] = null;
    throw e;
  }

  if (id !== 0)
    _module.loaded = true;

  return _module.exports;
}

__node_require__(0);
