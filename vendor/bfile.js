/*!
 * bfile@0.2.3 - Filesystem wrapper for node.js
 * Copyright (c) 2024, Christopher Jeffrey (MIT)
 * https://github.com/bcoin-org/bfile
 *
 * License for bfile@0.2.3:
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
[/* 0 */ 'bfile', '/lib/bfile.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * bfile.js - promisified fs module
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

/*
 * Expose
 */

const fs = __node_require__(1 /* './fs' */, 0);

module.exports = fs;
}],
[/* 1 */ 'bfile', '/lib/fs.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * fs.js - promisified fs module for bcoin
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const fs = __node_require__(2 /* './backend' */, 0);
const extra = __node_require__(9 /* './extra' */, 0);
const features = __node_require__(3 /* './features' */, 0);

/*
 * Extra
 */

fs.copy = extra.copy;
fs.copySync = extra.copySync;
fs.empty = extra.empty;
fs.emptySync = extra.emptySync;
fs.exists = extra.exists;
fs.existsSync = extra.existsSync;
fs.lstatTry = extra.lstatTry;
fs.lstatTrySync = extra.lstatTrySync;
fs.mkdirp = extra.mkdirp;
fs.mkdirpSync = extra.mkdirpSync;
fs.move = extra.move;
fs.moveSync = extra.moveSync;
fs.outputFile = extra.outputFile;
fs.outputFileSync = extra.outputFileSync;
fs.readJSON = extra.readJSON;
fs.readJSONSync = extra.readJSONSync;
fs.remove = extra.remove;
fs.removeSync = extra.removeSync;
fs.rimraf = extra.remove; // Compat.
fs.rimrafSync = extra.removeSync; // Compat.
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
fs.writeJSON = extra.writeJSON;
fs.writeJSONSync = extra.writeJSONSync;

/*
 * Promises
 */

if (features.USE_STABLE_PROMISES) {
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
  fs.opendir = fs.promises.opendir;
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
        compat = __node_require__(8 /* './compat' */, 0);

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
[/* 2 */ 'bfile', '/lib/backend.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * backend.js - backend selection for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const features = __node_require__(3 /* './features' */, 0);

/*
 * Expose
 */

if (features.HAS_ALL)
  module.exports = __node_require__(4 /* './modern' */, 0);
else
  module.exports = __node_require__(7 /* './legacy' */, 0);
}],
[/* 3 */ 'bfile', '/lib/features.js', 0, function(exports, require, module, __filename, __dirname) {
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

// Promises are considered stable as of 11.14.0.
let HAS_STABLE_PROMISES = version >= 0x0b0e00;

// Whether to actually use stable promises.
let USE_STABLE_PROMISES = HAS_STABLE_PROMISES
                       && process.env.BFILE_USE_STABLE === '1';

// fs.writev{,Sync} was added in 12.9.0.
let HAS_WRITEV = version >= 0x0c0900;
let HAS_WRITEV_IMPL = typeof fs.writev === 'function';

// Stats objects have nanosecond precision as of 12.10.0.
let HAS_STAT_NANO = version >= 0x0c0a00;

// fs.rmdir{,Sync} got an options parameter to allow for recursion in 12.10.0.
let HAS_RECURSIVE_RMDIR = version >= 0x0c0a00;

// fs.opendir{,Sync} are present as of 12.12.0.
let HAS_OPENDIR = version >= 0x0c0c00;
let HAS_OPENDIR_IMPL = typeof fs.opendir === 'function';

// The current highest modern version (12.12.0).
let HAS_ALL = HAS_OPENDIR
           && HAS_COPY_FILE_IMPL
           && HAS_REALPATH_NATIVE_IMPL
           && HAS_PROMISES_IMPL
           && HAS_DIRENT_IMPL
           && HAS_WRITEV_IMPL
           && HAS_OPENDIR_IMPL;

// Force stable promises with an env variable.
if (process.env.BFILE_FORCE_STABLE === '1' && HAS_PROMISES_IMPL)
  USE_STABLE_PROMISES = true;

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
  USE_STABLE_PROMISES = false;
  HAS_WRITEV = false;
  HAS_WRITEV_IMPL = false;
  HAS_STAT_NANO = false;
  HAS_RECURSIVE_RMDIR = false;
  HAS_OPENDIR = false;
  HAS_OPENDIR_IMPL = false;
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
exports.USE_STABLE_PROMISES = USE_STABLE_PROMISES;
exports.HAS_WRITEV = HAS_WRITEV;
exports.HAS_WRITEV_IMPL = HAS_WRITEV_IMPL;
exports.HAS_STAT_NANO = HAS_STAT_NANO;
exports.HAS_RECURSIVE_RMDIR = HAS_RECURSIVE_RMDIR;
exports.HAS_OPENDIR = HAS_OPENDIR;
exports.HAS_OPENDIR_IMPL = HAS_OPENDIR_IMPL;
exports.HAS_ALL = HAS_ALL;
}],
[/* 4 */ 'bfile', '/lib/modern.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * modern.js - modern backend for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

/* eslint prefer-arrow-callback: "off" */

'use strict';

const fs = require('fs');
const {promisify} = __node_require__(5 /* './util' */, 0);

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
exports.opendir = promisify(fs.opendir);
exports.opendirSync = fs.opendirSync;
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
exports.writev = promisify(fs.writev);
exports.writevSync = fs.writevSync;

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

exports.F_OK = fs.constants.F_OK || 0;
exports.R_OK = fs.constants.R_OK || 0;
exports.W_OK = fs.constants.W_OK || 0;
exports.X_OK = fs.constants.X_OK || 0;

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
  promises: {
    configurable: true,
    enumerable: false,
    get() {
      return fs.promises;
    }
  }
});
}],
[/* 5 */ 'bfile', '/lib/util.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * util.js - utils for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

/* eslint prefer-arrow-callback: "off" */

'use strict';

const {resolve} = require('path');
const {ArgError} = __node_require__(6 /* './error' */, 0);

/*
 * Constants
 */

const WINDOWS = process.platform === 'win32';
const HAS_SHARED_ARRAY_BUFFER = typeof SharedArrayBuffer === 'function';

let url = null;

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
    return null;

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
      || (path instanceof Uint8Array)
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

  if (!url)
    url = require('url');

  if (path instanceof url.URL)
    return fileURLToPath(path);

  throw new ArgError('path', path, ['string', 'Buffer', 'URL']);
}

function fromPaths(paths) {
  if (!Array.isArray(paths))
    return [fromPath(paths)];

  const out = [];

  for (const path of paths)
    out.push(fromPath(path));

  return out;
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
  if (!url)
    url = require('url');

  if (url.fileURLToPath)
    return resolve(url.fileURLToPath(uri), '.');

  if (typeof uri === 'string')
    uri = new url.URL(uri);

  if (!(uri instanceof url.URL))
    throw new ArgError('uri', uri, 'URL');

  if (uri.protocol !== 'file:') {
    const err = new TypeError('The URL must be of scheme file');
    err.code = 'ERR_INVALID_URL_SCHEME';
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
exports.fromPaths = fromPaths;
exports.toBuffer = toBuffer;
}],
[/* 6 */ 'bfile', '/lib/error.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * error.js - errors for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

/**
 * ArgError
 */

const ArgError = class TypeError extends global.TypeError {
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
    this.name = `${this.name} [${this.code}]`;
    this.stack;

    delete this.name;
  }

  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
};

/**
 * FSError
 */

const FSError = class Error extends global.Error {
  constructor(desc, ...args) {
    let message, syscall, path;

    if (desc == null || typeof desc !== 'object')
      throw new TypeError('invalid arguments for fs error');

    message = desc.message;

    if (args.length === 3)
      [message, syscall, path] = args;
    else if (args.length === 2)
      [syscall, path] = args;
    else if (args.length === 1)
      [syscall] = args;

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
  }
};

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
[/* 7 */ 'bfile', '/lib/legacy.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * legacy.js - legacy backend for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const compat = __node_require__(8 /* './compat' */, 0);
const features = __node_require__(3 /* './features' */, 0);
const fs = __node_require__(4 /* './modern' */, 0);

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
    || !features.HAS_STAT_BIGINTS
    || !features.HAS_STAT_NANO) {
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

if (!features.HAS_OPTIONAL_FLAGS) {
  fs.open = compat.open;
  fs.openSync = compat.openSync;
}

if (!features.HAS_WRITEV_IMPL) {
  fs.writev = compat.writev;
  fs.writevSync = compat.writevSync;
}

if (!features.HAS_RECURSIVE_RMDIR) {
  fs.rmdir = compat.rmdir;
  fs.rmdirSync = compat.rmdirSync;
}

if (!features.HAS_OPENDIR_IMPL) {
  fs.opendir = compat.opendir;
  fs.opendirSync = compat.opendirSync;
  fs.Dir = compat.Dir;
}

// A few things still need patching even if we have native promises.
if (features.HAS_PROMISES_IMPL && !features.HAS_OPENDIR_IMPL) {
  const getter = Object.getOwnPropertyDescriptor(fs, 'promises').get;

  const getPromises = () => {
    if (features.HAS_STABLE_PROMISES)
      return getter();

    const emit = process.emitWarning;

    process.emitWarning = () => {};

    try {
      return getter();
    } finally {
      process.emitWarning = emit;
    }
  };

  let promises = null;

  Object.defineProperty(fs, 'promises', {
    configurable: true,
    enumerable: false,
    get() {
      if (promises)
        return promises;

      promises = compat.clonePromises(getPromises());

      if (!features.HAS_STAT_BIGINTS
          || !features.HAS_STAT_NANO) {
        promises.stat = compat.promises.stat;
        compat.patchStat(promises);
      }

      if (!features.HAS_DIRENT_IMPL)
        promises.readdir = compat.promises.readdir;

      if (!features.HAS_RW_TYPED_ARRAY) {
        promises.writeFile = compat.promises.writeFile;
        compat.patchTypedArray(promises);
      }

      if (!features.HAS_RECURSIVE_MKDIR)
        promises.mkdir = compat.promises.mkdir;

      if (!features.HAS_OPTIONAL_FLAGS)
        compat.patchOpenFlags(promises);

      if (!features.HAS_WRITEV_IMPL)
        compat.patchWritev(promises);

      if (!features.HAS_RECURSIVE_RMDIR)
        promises.rmdir = compat.promises.rmdir;

      if (!features.HAS_OPENDIR_IMPL)
        promises.opendir = compat.promises.opendir;

      return promises;
    }
  });
}

/*
 * Expose
 */

module.exports = fs;
}],
[/* 8 */ 'bfile', '/lib/compat.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * compat.js - compat functions for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {ArgError, FSError} = __node_require__(6 /* './error' */, 0);
const features = __node_require__(3 /* './features' */, 0);
const util = __node_require__(5 /* './util' */, 0);
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

  let rfd = null;
  let stat = null;
  let wfd = null;
  let pos = 0;
  let slab = null;

  try {
    rfd = fs.openSync(src, 'r');
    stat = fs.fstatSync(rfd);
    wfd = fs.openSync(dest, flag, stat.mode);

    // Maximum size of `off_t` on linux.
    if (stat.size > 0x7ffff000)
      throw new FSError(EIO, 'read', fromPath(src));

    slab = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size));

    while (pos < stat.size) {
      const length = Math.min(stat.size - pos, slab.length);
      const bytesRead = fs.readSync(rfd, slab, 0, length, pos);

      if (bytesRead !== length)
        throw new FSError(EIO, 'read', fromPath(src));

      const bytesWritten = fs.writeSync(wfd, slab, 0, length, null);

      if (bytesWritten !== length)
        throw new FSError(EIO, 'write', fromPath(src));

      pos += length;
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
 * opendir()
 */

async function opendir(path, options) {
  if (typeof options === 'string')
    options = { encoding: options };

  const list = await readdir(path, {
    encoding: options ? options.encoding : undefined,
    withFileTypes: true
  });

  return new Dir(path, list);
}

function opendirSync(path, options) {
  if (typeof options === 'string')
    options = { encoding: options };

  const list = readdirSync(path, {
    encoding: options ? options.encoding : undefined,
    withFileTypes: true
  });

  return new Dir(path, list);
}

/**
 * Dir
 */

class Dir {
  constructor(path, list) {
    this.path = path;
    this._list = list;
    this._index = 0;
  }

  _error() {
    const err = new Error('Directory handle was closed');

    err.code = 'ERR_DIR_CLOSED';
    err.name = `Error [${err.code}]`;

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, this._error);

    return err;
  }

  async close(callback) {
    if (typeof callback === 'function') {
      try {
        this.closeSync();
      } catch (e) {
        callback(e);
        return;
      }
      callback();
      return;
    }

    this.closeSync();
  }

  closeSync() {
    if (this._index === -1)
      throw this._error();

    this._index = -1;
  }

  async read(callback) {
    if (typeof callback === 'function') {
      let item;
      try {
        item = this.readSync();
      } catch (e) {
        callback(e);
        return undefined;
      }
      callback(null, item);
      return undefined;
    }

    return this.readSync();
  }

  readSync() {
    if (this._index === -1)
      throw this._error();

    if (this._index === this._list.length)
      return null;

    return this._list[this._index++];
  }

  entries() {
    return {
      next: async () => {
        let item;

        try {
          item = this.readSync();
        } catch (e) {
          item = null;
        }

        if (item === null) {
          this._index = -1;
          return { value: undefined, done: true };
        }

        return { value: item, done: false };
      }
    };
  }

  [Symbol.asyncIterator || 'asyncIterator']() {
    return this.entries();
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
 * rmdir()
 */

async function rmdir(path, options) {
  if (options && options.recursive) {
    path = fromPath(path);

    let {maxRetries, retryDelay} = options;

    if (maxRetries == null)
      maxRetries = 0;

    if (retryDelay == null)
      retryDelay = 100;

    if ((maxRetries >>> 0) !== maxRetries)
      throw new ArgError('maxRetries', maxRetries, 'integer');

    if ((retryDelay >>> 0) !== retryDelay)
      throw new ArgError('retryDelay', retryDelay, 'integer');

    let tries = 0;

    for (;;) {
      try {
        await _rmdir(path);
      } catch (e) {
        const retry = e.code === 'EBUSY'
                   || e.code === 'ENOTEMPTY'
                   || e.code === 'EPERM'
                   || e.code === 'EMFILE'
                   || e.code === 'ENFILE';

        if (retry && tries < maxRetries) {
          tries += 1;
          await wait(tries * retryDelay);
          continue;
        }

        throw e;
      }

      break;
    }

    return undefined;
  }

  return call(fs.rmdir, [path]);
}

async function _rmdir(path) {
  let stat = null;

  try {
    stat = await safeStat(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  }

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = await call(fs.readdir, [path]);
    } catch (e) {
      if (e.code === 'ENOENT')
        return;
      throw e;
    }

    for (const name of list)
      await _rmdir(join(path, name));

    try {
      await call(fs.rmdir, [path]);
    } catch (e) {
      if (e.code === 'ENOENT')
        return;
      throw e;
    }

    return;
  }

  try {
    await call(fs.unlink, [path]);
  } catch (e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  }
}

function rmdirSync(path, options) {
  if (options && options.recursive) {
    path = fromPath(path);

    let {maxRetries} = options;

    if (maxRetries == null)
      maxRetries = 0;

    if ((maxRetries >>> 0) !== maxRetries)
      throw new ArgError('maxRetries', maxRetries, 'integer');

    let tries = 0;

    for (;;) {
      try {
        _rmdirSync(path, maxRetries);
      } catch (e) {
        const retry = e.code === 'EBUSY'
                   || e.code === 'ENOTEMPTY'
                   || e.code === 'EPERM'
                   || e.code === 'EMFILE'
                   || e.code === 'ENFILE';

        if (retry && tries < maxRetries) {
          tries += 1;
          continue;
        }

        throw e;
      }

      break;
    }

    return;
  }

  fs.rmdirSync(path);
}

function _rmdirSync(path, maxRetries) {
  let stat = null;

  try {
    stat = safeStatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  }

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = fs.readdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT')
        return;
      throw e;
    }

    for (const name of list)
      _rmdirSync(join(path, name), maxRetries);

    let tries = 0;

    for (;;) {
      try {
        fs.rmdirSync(path);
      } catch (e) {
        if (e.code === 'ENOENT')
          return;

        if (e.code === 'ENOTEMPTY' && process.platform === 'win32') {
          if (tries < maxRetries + 1) {
            tries += 1;
            continue;
          }
        }

        throw e;
      }

      break;
    }

    return;
  }

  try {
    fs.unlinkSync(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  }
}

/*
 * stat()
 */

function wrapStat(statter) {
  if (features.HAS_STAT_BIGINTS) {
    return async function stat(file, options) {
      if (options == null)
        options = {};
      return convertStat(await call(statter, [file, options]), options);
    };
  }
  return async function stat(file, options) {
    return convertStat(await call(statter, [file]), options);
  };
}

function wrapStatSync(statter) {
  if (features.HAS_STAT_BIGINTS) {
    return function statSync(file, options) {
      if (options == null)
        options = {};
      return convertStat(statter(file, options), options);
    };
  }
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
      throw new Error('BigInt is not supported.');

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

  if (bigint && stats.atimeNs == null) {
    if (typeof BigInt !== 'function')
      throw new Error('BigInt is not supported.');

    stats.atimeNs = stats.atimeMs * BigInt(1000000);
    stats.mtimeNs = stats.mtimeMs * BigInt(1000000);
    stats.ctimeNs = stats.ctimeMs * BigInt(1000000);
    stats.birthtimeNs = stats.birthtimeMs * BigInt(1000000);
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

/*
 * writev()
 */

async function writev(fd, buffers, position) {
  if (!Array.isArray(buffers))
    throw new ArgError('buffers', buffers, 'ArrayBufferView[]');

  let written = 0;

  for (const array of buffers) {
    const buf = toBuffer(array);
    const bytes = await call(fs.write, [fd, buf, 0, buf.length, position]);

    if (bytes !== buf.length)
      throw new FSError(EIO, 'writev');

    if (typeof position === 'number')
      position += bytes;

    written += bytes;
  }

  return written;
}

function writevSync(fd, buffers, position) {
  if (!Array.isArray(buffers))
    throw new ArgError('buffers', buffers, 'ArrayBufferView[]');

  let written = 0;

  for (const array of buffers) {
    const buf = toBuffer(array);
    const bytes = fs.writeSync(fd, buf, 0, buf.length, position);

    if (bytes !== buf.length)
      throw new FSError(EIO, 'writev');

    if (typeof position === 'number')
      position += bytes;

    written += bytes;
  }

  return written;
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

  async writev(...args) {
    return {
      bytesWritten: await writev(this._fd, ...args),
      buffers: args[0]
    };
  }
}

/*
 * Promises
 */

const promises = {
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
  opendir,
  readdir,
  readFile: promisify(fs.readFile),
  readlink: promisify(fs.readlink),
  realpath,
  rename: promisify(fs.rename),
  rmdir,
  stat,
  symlink: promisify(fs.symlink),
  truncate: promisify(fs.truncate),
  unlink: promisify(fs.unlink),
  utimes: promisify(fs.utimes),
  writeFile
};

/*
 * Promise Patches
 */

function clonePromises(promises) {
  return {
    access: promises.access,
    appendFile: promises.appendFile,
    chmod: promises.chmod,
    chown: promises.chown,
    copyFile: promises.copyFile,
    lchmod: promises.lchmod,
    lchown: promises.lchown,
    link: promises.link,
    lstat: promises.lstat,
    mkdir: promises.mkdir,
    mkdtemp: promises.mkdtemp,
    open: promises.open,
    opendir: promises.opendir,
    readdir: promises.readdir,
    readFile: promises.readFile,
    readlink: promises.readlink,
    realpath: promises.realpath,
    rename: promises.rename,
    rmdir: promises.rmdir,
    stat: promises.stat,
    symlink: promises.symlink,
    truncate: promises.truncate,
    unlink: promises.unlink,
    utimes: promises.utimes,
    writeFile: promises.writeFile
  };
}

function patchHandle(name, promises, callback) {
  const key = `__patch_${name}`;
  const {open} = promises;

  // Insanity? Maybe.
  //
  // I don't like changing anything global.
  // May be worth wrapping FileHandle with
  // a new class in order to patch it.
  let inject = (handle) => {
    const FileHandle = handle.constructor;

    if (!FileHandle[key]) {
      callback(FileHandle.prototype);
      FileHandle[key] = true;
    }

    inject = x => x;

    return handle;
  };

  // eslint-disable-next-line
  promises.open = async function _open(...args) {
    return inject(await open(...args));
  };
}

function patchStat(promises) {
  patchHandle('stat', promises, (proto) => {
    const {stat} = proto;

    // eslint-disable-next-line
    proto.stat = async function _stat(options) {
      return convertStat(await stat.call(this, options), options);
    };
  });
}

function patchTypedArray(promises) {
  patchHandle('typedArray', promises, (proto) => {
    const {read, write, writeFile} = proto;

    // eslint-disable-next-line
    proto.read = function _read(...args) {
      args[0] = toBuffer(args[0]);
      return read.call(this, ...args);
    };

    // eslint-disable-next-line
    proto.write = function _write(...args) {
      if (typeof args[0] !== 'string')
        args[0] = toBuffer(args[0]);

      return write.call(this, ...args);
    };

    // eslint-disable-next-line
    proto.writeFile = function _writeFile(...args) {
      if (typeof args[0] !== 'string')
        args[0] = toBuffer(args[0]);

      return writeFile.call(this, ...args);
    };
  });
}

function patchOpenFlags(promises) {
  const {open} = promises;

  // eslint-disable-next-line
  promises.open = async function _open(...args) {
    if (args[1] == null)
      args[1] = 'r';
    return open(...args);
  };
}

function patchWritev(promises) {
  patchHandle('writev', promises, (proto) => {
    proto.writev = async function writev(buffers, position) {
      if (!Array.isArray(buffers))
        throw new ArgError('buffers', buffers, 'ArrayBufferView[]');

      let written = 0;

      for (const array of buffers) {
        const buf = toBuffer(array);
        const {bytesWritten} = await this.write(buf, 0, buf.length, position);

        if (bytesWritten !== buf.length)
          throw new FSError(EIO, 'writev');

        if (typeof position === 'number')
          position += bytesWritten;

        written += bytesWritten;
      }

      return {
        bytesWritten: written,
        buffers
      };
    };
  });
}

/*
 * Helpers
 */

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeStat(path) {
  try {
    return await call(fs.lstat, [path]);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') {
      try {
        await call(fs.chmod, [path, 0o666]);
      } catch (e) {
        ;
      }
      return call(fs.lstat, [path]);
    }
    throw e;
  }
}

function safeStatSync(path) {
  try {
    return fs.lstatSync(path);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') {
      try {
        fs.chmodSync(path, 0o666);
      } catch (e) {
        ;
      }
      return fs.lstatSync(path);
    }
    throw e;
  }
}

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
exports.opendir = opendir;
exports.opendirSync = opendirSync;
exports.Dir = Dir;
exports.realpath = realpath;
exports.realpathSync = realpathSync;
exports.rmdir = rmdir;
exports.rmdirSync = rmdirSync;
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
exports.writev = writev;
exports.writevSync = writevSync;
exports.promises = promises;
exports.clonePromises = clonePromises;
exports.patchStat = patchStat;
exports.patchTypedArray = patchTypedArray;
exports.patchOpenFlags = patchOpenFlags;
exports.patchWritev = patchWritev;
}],
[/* 9 */ 'bfile', '/lib/extra.js', 0, function(exports, require, module, __filename, __dirname) {
/*!
 * extra.js - extra functions for bfile
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bfile
 */

'use strict';

const path = require('path');
const error = __node_require__(6 /* './error' */, 0);
const fs = __node_require__(2 /* './backend' */, 0);
const util = __node_require__(5 /* './util' */, 0);
const {dirname, join, resolve} = path;
const {ArgError, FSError} = error;
const {fromPath, fromPaths} = util;
const {EEXIST, EPERM} = FSError;

/*
 * Constants
 */

const ASYNC_ITERATOR = Symbol.asyncIterator || 'asyncIterator';
const PARSED_OPTIONS = Symbol('PARSED_OPTIONS');
const DEFAULT_STRINGIFY_OPTIONS = [null, 2, '\n'];

/*
 * Copy
 */

async function copy(src, dest, options) {
  return _copy(fromPath(src),
               fromPath(dest),
               copyOptions(options),
               new Set(),
               0);
}

async function _copy(src, dest, options, seen, depth) {
  const sstat = await stats(src, options.stats);
  const dstat = await lstatTry(dest);

  let ret = 0;

  if (!options.overwrite && dstat)
    throw new FSError(EEXIST, 'copy', dest);

  if (dstat && sstat.dev === dstat.dev && sstat.ino === dstat.ino)
    throw new FSError(EPERM, 'cannot copy file into itself', 'copy', dest);

  if (options.filter) {
    if (!await options.filter(src, sstat, depth))
      return ret + 1;
  }

  if (sstat.isDirectory()) {
    if (options.follow) {
      let real = resolve(src);

      try {
        real = await fs.realpath(real);
      } catch (e) {
        if (!isIgnorable(e))
          throw e;
      }

      if (seen.has(real))
        return ret;

      seen.add(real);
    }

    const list = await fs.readdir(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new FSError(EEXIST, 'mkdir', dest);
    } else {
      await fs.mkdir(dest, sstat.mode);
    }

    if (options.timestamps)
      await fs.utimes(dest, sstat.atime, sstat.mtime);

    for (const name of list) {
      ret += await _copy(join(src, name),
                         join(dest, name),
                         options,
                         seen,
                         depth + 1);
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

    if (options.timestamps)
      await fs.utimes(dest, sstat.atime, sstat.mtime);

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

    await fs.copyFile(src, dest, options.flags);

    if (options.timestamps)
      await fs.utimes(dest, sstat.atime, sstat.mtime);

    return ret;
  }

  return ret + 1;
}

function copySync(src, dest, options) {
  return _copySync(fromPath(src),
                   fromPath(dest),
                   copyOptions(options),
                   new Set(),
                   0);
}

function _copySync(src, dest, options, seen, depth) {
  const sstat = statsSync(src, options.stats);
  const dstat = lstatTrySync(dest);

  let ret = 0;

  if (!options.overwrite && dstat)
    throw new FSError(EEXIST, 'copy', dest);

  if (dstat && sstat.dev === dstat.dev && sstat.ino === dstat.ino)
    throw new FSError(EPERM, 'cannot copy file into itself', 'copy', dest);

  if (options.filter) {
    if (!options.filter(src, sstat, depth))
      return ret + 1;
  }

  if (sstat.isDirectory()) {
    if (options.follow) {
      let real = resolve(src);

      try {
        real = fs.realpathSync(real);
      } catch (e) {
        if (!isIgnorable(e))
          throw e;
      }

      if (seen.has(real))
        return ret;

      seen.add(real);
    }

    const list = fs.readdirSync(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new FSError(EEXIST, 'mkdir', dest);
    } else {
      fs.mkdirSync(dest, sstat.mode);
    }

    if (options.timestamps)
      fs.utimesSync(dest, sstat.atime, sstat.mtime);

    for (const name of list) {
      ret += _copySync(join(src, name),
                       join(dest, name),
                       options,
                       seen,
                       depth + 1);
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

    if (options.timestamps)
      fs.utimesSync(dest, sstat.atime, sstat.mtime);

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

    fs.copyFileSync(src, dest, options.flags);

    if (options.timestamps)
      fs.utimesSync(dest, sstat.atime, sstat.mtime);

    return ret;
  }

  return ret + 1;
}

async function empty(path, mode) {
  const dir = fromPath(path);

  let list = null;

  try {
    list = await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT')
      return mkdirp(dir, mode);
    throw e;
  }

  for (const name of list)
    await remove(join(dir, name));

  return undefined;
}

function emptySync(path, mode) {
  const dir = fromPath(path);

  let list = null;

  try {
    list = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT')
      return mkdirpSync(dir, mode);
    throw e;
  }

  for (const name of list)
    removeSync(join(dir, name));

  return undefined;
}

async function exists(file, mode) {
  if (mode == null)
    mode = fs.constants.F_OK;

  try {
    await fs.access(file, mode);
    return true;
  } catch (e) {
    if (isIgnorable(e))
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
    if (isIgnorable(e))
      return false;
    throw e;
  }
}

async function lstatTry(...args) {
  try {
    return await fs.lstat(...args);
  } catch (e) {
    if (isIgnorable(e))
      return null;
    throw e;
  }
}

function lstatTrySync(...args) {
  try {
    return fs.lstatSync(...args);
  } catch (e) {
    if (isIgnorable(e))
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

async function move(src, dest) {
  try {
    await fs.rename(src, dest);
    return;
  } catch (e) {
    if (e.code !== 'EXDEV')
      throw e;
  }

  await copy(src, dest, { timestamps: true });
  await remove(src);
}

function moveSync(src, dest) {
  try {
    fs.renameSync(src, dest);
    return;
  } catch (e) {
    if (e.code !== 'EXDEV')
      throw e;
  }

  copySync(src, dest, { timestamps: true });
  removeSync(src);
}

async function outputFile(path, data, options) {
  if (options == null)
    options = {};

  if (typeof options === 'string')
    options = { encoding: options };

  const file = fromPath(path);
  const dir = dirname(file);

  let mode = options.mode;

  if ((mode & 0o777) === mode)
    mode |= (mode & 0o444) >>> 2;

  await mkdirp(dir, mode);
  await fs.writeFile(file, data, options);
}

function outputFileSync(path, data, options) {
  if (options == null)
    options = {};

  if (typeof options === 'string')
    options = { encoding: options };

  const file = fromPath(path);
  const dir = dirname(file);

  let mode = options.mode;

  if ((mode & 0o777) === mode)
    mode |= (mode & 0o444) >>> 2;

  mkdirpSync(dir, mode);
  fs.writeFileSync(file, data, options);
}

async function readJSON(path, options) {
  const [reviver, opt] = readJSONOptions(options);
  const text = await fs.readFile(path, opt);

  return decodeJSON(text, reviver);
}

function readJSONSync(path, options) {
  const [reviver, opt] = readJSONOptions(options);
  const text = fs.readFileSync(path, opt);

  return decodeJSON(text, reviver);
}

async function remove(paths, options) {
  paths = fromPaths(paths);
  options = removeOptions(options);

  let ret = 0;
  let error = null;

  for (const path of paths) {
    let tries = 0;

    for (;;) {
      try {
        ret += await _remove(path, options, 0);
      } catch (e) {
        const retry = e.code === 'EBUSY'
                   || e.code === 'ENOTEMPTY'
                   || e.code === 'EPERM'
                   || e.code === 'EMFILE'
                   || e.code === 'ENFILE';

        if (retry && tries < options.maxRetries) {
          tries += 1;
          await wait(tries * options.retryDelay);
          continue;
        }

        if (!error)
          error = e;
      }

      break;
    }
  }

  if (error)
    throw error;

  return ret;
}

async function _remove(path, options, depth) {
  let ret = 0;
  let stat = null;

  try {
    stat = await safeStat(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return ret;
    throw e;
  }

  if (options.filter) {
    if (!await options.filter(path, stat, depth))
      return ret + 1;
  }

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = await fs.readdir(path);
    } catch (e) {
      if (e.code === 'ENOENT')
        return ret;
      throw e;
    }

    for (const name of list)
      ret += await _remove(join(path, name), options, depth + 1);

    if (ret === 0) {
      try {
        await fs.rmdir(path);
      } catch (e) {
        if (e.code === 'ENOENT')
          return ret;
        throw e;
      }
    }

    return ret;
  }

  try {
    await fs.unlink(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return ret;
    throw e;
  }

  return ret;
}

function removeSync(paths, options) {
  paths = fromPaths(paths);
  options = removeOptions(options);

  let ret = 0;
  let error = null;

  for (const path of paths) {
    let tries = 0;

    for (;;) {
      try {
        ret += _removeSync(path, options, 0);
      } catch (e) {
        const retry = e.code === 'EBUSY'
                   || e.code === 'ENOTEMPTY'
                   || e.code === 'EPERM'
                   || e.code === 'EMFILE'
                   || e.code === 'ENFILE';

        if (retry && tries < options.maxRetries) {
          tries += 1;
          continue;
        }

        if (!error)
          error = e;
      }

      break;
    }
  }

  if (error)
    throw error;

  return ret;
}

function _removeSync(path, options, depth) {
  let ret = 0;
  let stat = null;

  try {
    stat = safeStatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return ret;
    throw e;
  }

  if (options.filter) {
    if (!options.filter(path, stat, depth))
      return ret + 1;
  }

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = fs.readdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT')
        return ret;
      throw e;
    }

    for (const name of list)
      ret += _removeSync(join(path, name), options, depth + 1);

    if (ret === 0) {
      let tries = 0;

      for (;;) {
        try {
          fs.rmdirSync(path);
        } catch (e) {
          if (e.code === 'ENOENT')
            return ret;

          if (e.code === 'ENOTEMPTY' && process.platform === 'win32') {
            if (tries < options.maxRetries + 1) {
              tries += 1;
              continue;
            }
          }

          throw e;
        }

        break;
      }
    }

    return ret;
  }

  try {
    fs.unlinkSync(path);
  } catch (e) {
    if (e.code === 'ENOENT')
      return ret;
    throw e;
  }

  return ret;
}

async function statTry(...args) {
  try {
    return await fs.stat(...args);
  } catch (e) {
    if (isIgnorable(e))
      return null;
    throw e;
  }
}

function statTrySync(...args) {
  try {
    return fs.statSync(...args);
  } catch (e) {
    if (isIgnorable(e))
      return null;
    throw e;
  }
}

async function stats(file, options) {
  options = statsOptions(options);

  if (options.follow) {
    try {
      return await fs.stat(file, options.stat);
    } catch (e) {
      if (!isIgnorable(e))
        throw e;
    }
  }

  return fs.lstat(file, options.stat);
}

function statsSync(file, options) {
  options = statsOptions(options);

  if (options.follow) {
    try {
      return fs.statSync(file, options.stat);
    } catch (e) {
      if (!isIgnorable(e))
        throw e;
    }
  }

  return fs.lstatSync(file, options.stat);
}

async function statsTry(file, options) {
  try {
    return await stats(file, options);
  } catch (e) {
    if (isIgnorable(e))
      return null;
    throw e;
  }
}

function statsTrySync(file, options) {
  try {
    return statsSync(file, options);
  } catch (e) {
    if (isIgnorable(e))
      return null;
    throw e;
  }
}

/*
 * Traversal
 */

async function traverse(paths, options, cb) {
  if (typeof options === 'function'
      && typeof cb !== 'function') {
    [options, cb] = [cb, options];
  }

  if (typeof cb !== 'function')
    throw new ArgError('callback', cb, 'function');

  const iter = walk(paths, options);

  for (;;) {
    const {value, done} = await iter.next();

    if (done)
      break;

    const [file, stat, depth] = value;

    if ((await cb(file, stat, depth)) === false)
      break;
  }
}

function traverseSync(paths, options, cb) {
  if (typeof options === 'function'
      && typeof cb !== 'function') {
    [options, cb] = [cb, options];
  }

  if (typeof cb !== 'function')
    throw new ArgError('callback', cb, 'function');

  for (const [file, stat, depth] of walkSync(paths, options)) {
    if (cb(file, stat, depth) === false)
      break;
  }
}

function walk(paths, options) {
  paths = fromPaths(paths);
  options = walkOptions(options);

  return new AsyncWalker(paths, options);
}

function* walkSync(paths, options) {
  paths = fromPaths(paths);
  options = walkOptions(options);

  for (const path of paths)
    yield* syncWalker(path, options);
}

async function writeJSON(path, json, options) {
  const [args, opt] = writeJSONOptions(options);
  const text = encodeJSON(json, args);

  return fs.writeFile(path, text, opt);
}

function writeJSONSync(path, json, options) {
  const [args, opt] = writeJSONOptions(options);
  const text = encodeJSON(json, args);

  fs.writeFileSync(path, text, opt);
}

/**
 * AsyncWalker
 */

class AsyncWalker {
  constructor(paths, options) {
    this.stack = [paths.reverse()];
    this.dirs = options.dirs;
    this.files = options.files;
    this.filter = options.filter;
    this.follow = options.follow;
    this.maxDepth = options.maxDepth;
    this.stats = options.stats;
    this.statter = options.throws ? stats : statsTry;
    this.seen = new Set();
    this.depth = 0;
  }

  [ASYNC_ITERATOR]() {
    return this;
  }

  push(items) {
    this.stack.push(items);
    this.depth += 1;
  }

  pop() {
    for (;;) {
      if (this.stack.length === 0)
        return null;

      const items = this.stack[this.stack.length - 1];

      if (items.length === 0) {
        this.stack.pop();
        this.depth -= 1;
        if (this.depth === 0)
          this.seen.clear();
        continue;
      }

      return items.pop();
    }
  }

  async read(path, dir, depth) {
    if (!dir || depth === this.maxDepth)
      return;

    if (this.follow) {
      let real = resolve(path);

      try {
        real = await fs.realpath(real);
      } catch (e) {
        if (!isIgnorable(e))
          throw e;
      }

      if (this.seen.has(real))
        return;

      this.seen.add(real);
    }

    let list = null;

    try {
      list = await fs.readdir(path);
    } catch (e) {
      if (isIgnorable(e))
        return;
      throw e;
    }

    const items = new Array(list.length);

    for (let i = 0; i < list.length; i++)
      items[i] = join(path, list[list.length - 1 - i]);

    this.push(items);
  }

  async next() {
    const path = this.pop();
    const depth = this.depth;

    if (path == null)
      return { value: undefined, done: true };

    const stat = await this.statter(path, this.stats);
    const dir = stat ? stat.isDirectory() : false;

    if (this.filter) {
      if (!await this.filter(path, stat, depth))
        return this.next();
    }

    await this.read(path, dir, depth);

    if (!shouldShow(this, dir))
      return this.next();

    return { value: [path, stat, depth], done: false };
  }
}

/*
 * SyncWalker
 */

function* syncWalker(path, options) {
  const statter = options.throws ? statsSync : statsTrySync;
  const seen = new Set();

  yield* (function* next(path, depth) {
    const stat = statter(path, options.stats);
    const dir = stat ? stat.isDirectory() : false;

    if (options.filter) {
      if (!options.filter(path, stat, depth))
        return;
    }

    if (shouldShow(options, dir))
      yield [path, stat, depth];

    if (!dir || depth === options.maxDepth)
      return;

    if (options.follow) {
      let real = resolve(path);

      try {
        real = fs.realpathSync(real);
      } catch (e) {
        if (!isIgnorable(e))
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
      if (isIgnorable(e))
        return;
      throw e;
    }

    for (const name of list)
      yield* next(join(path, name), depth + 1);
  })(path, 0);
}

/*
 * Options Parsing
 */

function copyOptions(options) {
  if (options == null)
    options = 0;

  if (typeof options === 'function')
    options = { filter: options };
  else if (typeof options === 'boolean')
    options = { follow: options };
  else if (typeof options === 'number')
    options = { flags: options };

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'function',
                                            'boolean',
                                            'number',
                                            'object']);
  }

  let {flags, filter, follow, overwrite, timestamps} = options;

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = null;

  if (follow == null)
    follow = false;

  if (overwrite == null)
    overwrite = (flags & fs.constants.COPYFILE_EXCL) === 0;

  if (timestamps == null)
    timestamps = false;

  if ((flags >>> 0) !== flags)
    throw new ArgError('flags', flags, 'integer');

  if (filter != null && typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  if (typeof follow !== 'boolean')
    throw new ArgError('follow', follow, 'boolean');

  if (typeof overwrite !== 'boolean')
    throw new ArgError('overwrite', overwrite, 'boolean');

  if (typeof timestamps !== 'boolean')
    throw new ArgError('timestamps', timestamps, 'boolean');

  if (overwrite)
    flags &= ~fs.constants.COPYFILE_EXCL;
  else
    flags |= fs.constants.COPYFILE_EXCL;

  return {
    flags,
    filter,
    follow,
    overwrite,
    stats: statsOptions(follow),
    timestamps
  };
}

function readJSONOptions(options) {
  if (options == null)
    return [undefined, 'utf8'];

  if (typeof options === 'string')
    return [undefined, options];

  if (typeof options === 'function')
    return [options, 'utf8'];

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'string',
                                            'object']);
  }

  let {reviver} = options;

  if (reviver == null)
    reviver = undefined;

  if (reviver != null && typeof reviver !== 'function')
    throw new ArgError('reviver', reviver, 'function');

  options = prepareOptions(options);

  return [reviver, options];
}

function removeOptions(options) {
  if (options == null)
    options = {};

  if (typeof options === 'function')
    options = { filter: options };

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'function',
                                            'object']);
  }

  let {filter, maxRetries, retryDelay} = options;

  if (filter == null)
    filter = null;

  if (maxRetries == null)
    maxRetries = 3;

  if (retryDelay == null)
    retryDelay = 100;

  if (filter != null && typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  if ((maxRetries >>> 0) !== maxRetries)
    throw new ArgError('maxRetries', maxRetries, 'integer');

  if ((retryDelay >>> 0) !== retryDelay)
    throw new ArgError('retryDelay', retryDelay, 'integer');

  return { filter, maxRetries, retryDelay };
}

function statsOptions(options) {
  if (options && options[PARSED_OPTIONS])
    return options;

  if (options == null)
    options = true;

  if (typeof options === 'boolean')
    options = { follow: options };

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'boolean',
                                            'object']);
  }

  let {follow, bigint} = options;

  if (follow == null)
    follow = true;

  if (bigint == null)
    bigint = false;

  if (typeof follow !== 'boolean')
    throw new ArgError('follow', follow, 'boolean');

  if (typeof bigint !== 'boolean')
    throw new ArgError('bigint', bigint, 'boolean');

  return {
    [PARSED_OPTIONS]: true,
    follow,
    stat: {
      bigint
    }
  };
}

function walkOptions(options) {
  if (options == null)
    options = true;

  if (typeof options === 'function')
    options = { filter: options };
  else if (typeof options === 'boolean')
    options = { follow: options };
  else if (typeof options === 'number')
    options = { maxDepth: options };

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'function',
                                            'boolean',
                                            'number',
                                            'object']);
  }

  let {dirs, files, filter, follow, maxDepth, throws} = options;

  if (options.noDirs != null)
    dirs = !options.noDirs;

  if (options.noFiles != null)
    files = !options.noFiles;

  if (dirs == null)
    dirs = true;

  if (files == null)
    files = true;

  if (filter == null)
    filter = null;

  if (follow == null)
    follow = true;

  if (maxDepth == null)
    maxDepth = -1;

  if (throws == null)
    throws = false;

  if (filter != null && typeof filter !== 'function')
    throw new ArgError('filter', filter, 'function');

  if (typeof dirs !== 'boolean')
    throw new ArgError('dirs', dirs, 'boolean');

  if (typeof files !== 'boolean')
    throw new ArgError('files', files, 'boolean');

  if (typeof follow !== 'boolean')
    throw new ArgError('follow', follow, 'boolean');

  if (maxDepth !== -1 && (maxDepth >>> 0) !== maxDepth)
    throw new ArgError('maxDepth', maxDepth, 'integer');

  if (typeof throws !== 'boolean')
    throw new ArgError('throws', throws, 'boolean');

  if (!dirs && !files)
    throw new Error('`dirs` and `files` cannot both be false.');

  return {
    dirs,
    files,
    filter,
    follow,
    maxDepth,
    stats: statsOptions({
      bigint: options.bigint,
      follow
    }),
    throws
  };
}

function writeJSONOptions(options) {
  const defaults = DEFAULT_STRINGIFY_OPTIONS;

  if (options == null)
    return [defaults, 'utf8'];

  if (typeof options === 'string')
    return [defaults, options];

  if (typeof options === 'function') {
    const [, spaces, eol] = defaults;
    return [[options, spaces, eol], 'utf8'];
  }

  if ((options >>> 0) === options) {
    const [replacer, , eol] = defaults;
    return [[replacer, options, eol], 'utf8'];
  }

  if (typeof options !== 'object') {
    throw new ArgError('options', options, ['null',
                                            'string',
                                            'function',
                                            'integer',
                                            'object']);
  }

  let {replacer, spaces, eol} = options;

  if (replacer == null)
    replacer = defaults[0];

  if (spaces == null)
    spaces = defaults[1];

  if (eol == null)
    eol = defaults[2];

  if (replacer != null && typeof replacer !== 'function')
    throw new ArgError('replacer', replacer, 'function');

  if ((spaces >>> 0) !== spaces)
    throw new ArgError('spaces', spaces, 'integer');

  if (typeof eol !== 'string')
    throw new ArgError('eol', eol, 'string');

  options = prepareOptions(options);

  return [[replacer, spaces, eol], options];
}

/*
 * Helpers
 */

function isIgnorable(err) {
  return err.code === 'ENOENT'
      || err.code === 'EACCES'
      || err.code === 'EPERM'
      || err.code === 'ELOOP';
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeStat(path) {
  try {
    return await fs.lstat(path);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') {
      try {
        await fs.chmod(path, 0o666);
      } catch (e) {
        ;
      }
      return fs.lstat(path);
    }
    throw e;
  }
}

function safeStatSync(path) {
  try {
    return fs.lstatSync(path);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') {
      try {
        fs.chmodSync(path, 0o666);
      } catch (e) {
        ;
      }
      return fs.lstatSync(path);
    }
    throw e;
  }
}

function shouldShow(options, dir) {
  return dir ? options.dirs : options.files;
}

function encodeJSON(json, [replacer, spaces, eol]) {
  let text = JSON.stringify(json, replacer, spaces);

  if (typeof text !== 'string')
    throw new Error(`Cannot stringify JSON of type ${typeof json}.`);

  if (spaces > 0 && eol !== '\n')
    text = text.replace(/\n/g, () => eol);

  return text + eol;
}

function decodeJSON(text, reviver) {
  // UTF-16 BOM (also slices UTF-8 BOM).
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff)
    text = text.substring(1);

  return JSON.parse(text, reviver);
}

function prepareOptions(options) {
  const out = {};

  for (const key of Object.keys(options)) {
    switch (key) {
      case 'replacer':
      case 'reviver':
      case 'spaces':
      case 'eol':
        continue;
    }

    out[key] = options[key];
  }

  if (out.encoding == null)
    out.encoding = 'utf8';

  return out;
}

/*
 * Expose
 */

exports.copy = copy;
exports.copySync = copySync;
exports.empty = empty;
exports.emptySync = emptySync;
exports.exists = exists;
exports.existsSync = existsSync;
exports.lstatTry = lstatTry;
exports.lstatTrySync = lstatTrySync;
exports.mkdirp = mkdirp;
exports.mkdirpSync = mkdirpSync;
exports.move = move;
exports.moveSync = moveSync;
exports.outputFile = outputFile;
exports.outputFileSync = outputFileSync;
exports.readJSON = readJSON;
exports.readJSONSync = readJSONSync;
exports.removeSync = removeSync;
exports.remove = remove;
exports.removeSync = removeSync;
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
exports.writeJSON = writeJSON;
exports.writeJSONSync = writeJSONSync;
}]
];

var __node_cache__ = [];

function __node_error__(specifier) {
  var err = new Error('Cannot find module \'' + specifier + '\'');
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

function __node_throw__(specifier) {
  throw __node_error__(specifier);
}

function __node_reject__(specifier) {
  return Promise.reject(__node_error__(specifier));
}

function __node_require__(id, flag) {
  while (__node_cache__.length <= id)
    __node_cache__.push(null);

  var cache = __node_cache__[id];

  if (cache)
    return cache.exports;

  var mod = __node_modules__[id];
  var esm = mod[2];
  var func = mod[3];
  var meta;

  var _exports = exports;
  var _module = module;

  if (id !== 0) {
    _exports = esm ? { __proto__: null } : {};
    _module = {
      id: __filename,
      path: __dirname,
      exports: _exports,
      parent: module,
      filename: __filename,
      isPreloading: false,
      loaded: false,
      children: module.children,
      paths: module.paths,
      require: require
    };
  } else if (esm) {
    _exports = { __proto__: null };
    _module.exports = _exports;
  }

  __node_cache__[id] = _module;

  try {
    if (esm) {
      func.call(void 0, _exports, meta, _module);
    } else {
      func.call(_exports, _exports, require,
                _module, __filename, __dirname);
    }
  } catch (e) {
    __node_cache__[id] = null;
    throw e;
  }

  __node_modules__[id] = null;

  if (id !== 0)
    _module.loaded = true;

  return _module.exports;
}

__node_require__(0, 0);
