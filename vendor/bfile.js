/*!
 * fs.js - promisified fs module for bcoin
 * Copyright (c) 2014-2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

/* eslint prefer-arrow-callback: "off" */

'use strict';

const fs = require('fs');
const Path = require('path');

/*
 * Constants
 */

const hasOwnProperty = Object.prototype.hasOwnProperty;
const hasPromises = hasOwnProperty.call(fs, 'promises');
const parts = process.version.split(/[^\d]/);
const version = (0
  + (parts[1] & 0xff) * 0x10000
  + (parts[2] & 0xff) * 0x00100
  + (parts[3] & 0xff) * 0x00001);

let promises_ = null;

/*
 * Helpers
 */

function promisify(func) {
  if (!func)
    return undefined;

  if (func === fs.read) {
    return function read(fd, buffer, offset, length, position) {
      return new Promise(function(resolve, reject) {
        const cb = function(err, bytes, buf) {
          if (err) {
            reject(err);
            return;
          }
          resolve(bytes);
        };

        try {
          func(fd, buffer, offset, length, position, cb);
        } catch (e) {
          reject(e);
        }
      });
    };
  }

  if (func === fs.write) {
    return function write(fd, buffer, offset, length, position) {
      return new Promise(function(resolve, reject) {
        const cb = function(err, bytes, buf) {
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
            func(fd, buffer, offset, length, cb);
          } catch (e) {
            reject(e);
          }
        } else {
          // fs.write(fd, buffer[, offset[, length[, position]]], callback);
          try {
            func(fd, buffer, offset, length, position, cb);
          } catch (e) {
            reject(e);
          }
        }
      });
    };
  }

  return function promisified(...args) {
    return new Promise(function(resolve, reject) {
      const cb = function(err, result) {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      };

      try {
        func(...args, cb);
      } catch (e) {
        reject(e);
      }
    });
  };
}

function fsError(options) {
  const code = options.code || 'EPERM';
  const errno = options.errno || -1;
  const message = options.message;
  const syscall = options.syscall;
  const path = options.path;
  const start = options.start || fsError;

  let msg = `${code}:`;

  if (message)
    msg += ` ${message},`;

  if (syscall)
    msg += ` ${syscall}`;

  if (path)
    msg += ` ${path}`;

  const err = new Error(msg);

  err.code = code;
  err.errno = errno;

  if (syscall != null)
    err.syscall = syscall;

  if (path != null)
    err.path = path;

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, start);

  return err;
}

function errorExist(syscall, path) {
  return fsError({
    code: 'EEXIST',
    errno: -17,
    message: 'file already exists',
    syscall,
    path,
    start: errorExist
  });
}

function errorIO(syscall, path) {
  return fsError({
    code: 'EIO',
    errno: -5,
    message: 'I/O error',
    syscall,
    path,
    start: errorIO
  });
}

function errorNotDir(syscall, path) {
  return fsError({
    code: 'ENOTDIR',
    errno: -20,
    message: 'not a directory',
    syscall,
    path,
    start: errorNotDir
  });
}

function errorPerm(message, syscall, path) {
  return fsError({
    code: 'EPERM',
    errno: -1,
    message,
    syscall,
    path,
    start: errorPerm
  });
}

/*
 * Expose
 */

exports.unsupported = false;
exports.version = version;
exports.hasPromises = hasPromises;
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
exports.read = promisify(fs.read);
exports.readSync = fs.readSync;
exports.readdir = promisify(fs.readdir);
exports.readdirSync = fs.readdirSync;
exports.readFile = promisify(fs.readFile);
exports.readFileSync = fs.readFileSync;
exports.readlink = promisify(fs.readlink);
exports.readlinkSync = fs.readlinkSync;
exports.realpath = promisify(fs.realpath);
if (fs.realpath)
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
exports.write = promisify(fs.write);
exports.writeSync = fs.writeSync;
exports.writeFile = promisify(fs.writeFile);
exports.writeFileSync = fs.writeFileSync;

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
      if (!promises_) {
        if (hasPromises) {
          const emit = process.emitWarning;
          process.emitWarning = () => {};
          try {
            promises_ = fs.promises;
          } finally {
            process.emitWarning = emit;
          }
        } else {
          promises_ = {
            access: exports.access,
            appendFile: exports.appendFile,
            chmod: exports.chmod,
            chown: exports.chown,
            copyFile: exports.copyFile,
            lchmod: exports.lchmod,
            lchown: exports.lchown,
            link: exports.link,
            lstat: exports.lstat,
            mkdir: exports.mkdir,
            mkdtemp: exports.mkdtemp,
            open: exports.openHandle,
            readdir: exports.readdir,
            readFile: exports.readFile,
            readlink: exports.readlink,
            realpath: exports.realpath,
            rename: exports.rename,
            rmdir: exports.rmdir,
            stat: exports.stat,
            symlink: exports.symlink,
            truncate: exports.truncate,
            unlink: exports.unlink,
            utimes: exports.utimes,
            writeFile: exports.writeFile
          };
        }

        promises_ = Object.assign(Object.create(exports), promises_);

        ({ __proto__: promises_ });
      }

      return promises_;
    }
  }
});

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

  get compat() {
    return true;
  }

  appendFile(data, options) {
    return exports.appendFile(this._fd, data, options);
  }

  chmod(mode) {
    return exports.fchmod(this._fd, mode);
  }

  chown(uid, gid) {
    return exports.fchown(this._fd, uid, gid);
  }

  close() {
    return exports.close(this._fd);
  }

  datasync() {
    return exports.fdatasync(this._fd);
  }

  async read(buffer, offset, length, position) {
    const bytesRead = await exports.read(this._fd, buffer,
                                         offset, length,
                                         position);
    return { bytesRead, buffer };
  }

  readFile(options) {
    return exports.readFile(this._fd, options);
  }

  stat(options) {
    if (options != null)
      return exports.fstat(this._fd, options);
    return exports.fstat(this._fd);
  }

  sync() {
    return exports.fsync(this._fd);
  }

  truncate(len) {
    return exports.ftruncate(this._fd, len);
  }

  utimes(atime, mtime) {
    return exports.futimes(this._fd, atime, mtime);
  }

  async write(buffer, offset, length, position) {
    const bytesWritten = await exports.write(this._fd, buffer,
                                             offset, length,
                                             position);
    return { bytesWritten, buffer };
  }

  writeFile(data, options) {
    return exports.writeFile(this._fd, options);
  }
}

exports.openHandle = async function openHandle(...args) {
  const fd = await exports.open(...args);
  return new FileHandle(fd);
};

exports.openFile = function openFile(...args) {
  return exports.promises.open(...args);
};

/*
 * Extra
 */

exports.copy = async function copy(src, dest, flags, filter) {
  if (typeof flags === 'function')
    [flags, filter] = [filter, flags];

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = async (src, stat) => true;

  if (typeof src !== 'string')
    throw new TypeError('"src" must be a path.');

  if (typeof dest !== 'string')
    throw new TypeError('"dest" must be a path.');

  if ((flags >>> 0) !== flags)
    throw new TypeError('"flags" must be an integer.');

  if (typeof filter !== 'function')
    throw new TypeError('"filter" must be a function.');

  const overwrite = (flags & exports.constants.COPYFILE_EXCL) === 0;
  const sstat = await exports.lstat(src);
  const dstat = await exports.lstatTry(dest);

  let ret = 0;

  if (!overwrite && dstat)
    throw errorExist('copy', dest);

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw errorPerm('cannot copy file into itself', 'copy', dest);
  }

  if (!await filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = await exports.readdir(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw errorExist('mkdir', dest);
    } else {
      await exports.mkdir(dest, sstat.mode);
    }

    for (const name of list) {
      ret += await exports.copy(Path.join(src, name),
                                Path.join(dest, name),
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
        throw errorExist('symlink', dest);
      }

      await exports.unlink(dest);
    }

    await exports.symlink(await exports.readlink(src), dest);

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw errorExist('open', dest);
      }

      if (!dstat.isFile())
        await exports.unlink(dest);
    }

    await exports.copyFile(src, dest, flags);

    return ret;
  }

  return ret + 1;
};

exports.copySync = function copySync(src, dest, flags, filter) {
  if (typeof flags === 'function')
    [flags, filter] = [filter, flags];

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = (src, stat) => true;

  if (typeof src !== 'string')
    throw new TypeError('"src" must be a path.');

  if (typeof dest !== 'string')
    throw new TypeError('"dest" must be a path.');

  if ((flags >>> 0) !== flags)
    throw new TypeError('"flags" must be an integer.');

  if (typeof filter !== 'function')
    throw new TypeError('"filter" must be a function.');

  const overwrite = (flags & exports.constants.COPYFILE_EXCL) === 0;
  const sstat = exports.lstatSync(src);
  const dstat = exports.lstatTrySync(dest);

  let ret = 0;

  if (!overwrite && dstat)
    throw errorExist('copy', dest);

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw errorPerm('cannot copy file into itself', 'copy', dest);
  }

  if (!filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = exports.readdirSync(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw errorExist('mkdir', dest);
    } else {
      exports.mkdirSync(dest, sstat.mode);
    }

    for (const name of list) {
      ret += exports.copySync(Path.join(src, name),
                              Path.join(dest, name),
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
        throw errorExist('symlink', dest);
      }

      exports.unlinkSync(dest);
    }

    exports.symlinkSync(exports.readlinkSync(src), dest);

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw errorExist('open', dest);
      }

      if (!dstat.isFile())
        exports.unlinkSync(dest);
    }

    exports.copyFileSync(src, dest, flags);

    return ret;
  }

  return ret + 1;
};

exports.exists = async (file) => {
  try {
    await exports.stat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
};

exports.existsSync = (file) => {
  try {
    exports.statSync(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
};

exports.lstatTry = async function lstatTry(file) {
  try {
    return await exports.lstat(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
};

exports.lstatTrySync = function lstatTrySync(file) {
  try {
    return exports.lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
};

exports.mkdirp = async function mkdirp(dir, mode) {
  if (mode == null)
    mode = 0o777;

  return exports.mkdir(dir, { mode, recursive: true });
};

exports.mkdirpSync = function mkdirpSync(dir, mode) {
  if (mode == null)
    mode = 0o777;

  return exports.mkdirSync(dir, { mode, recursive: true });
};

exports.rimraf = async function rimraf(path, filter) {
  if (filter == null)
    filter = async (path, stat) => true;

  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  if (typeof filter !== 'function')
    throw new TypeError('"filter" must be a function.');

  let ret = 0;
  let stat = null;

  try {
    stat = await exports.lstat(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return ret + 1;
    throw e;
  }

  if (!await filter(path, stat))
    return ret + 1;

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = await exports.readdir(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES')
        return ret + 1;
      throw e;
    }

    for (const name of list)
      ret += await exports.rimraf(Path.join(path, name), filter);

    try {
      await exports.rmdir(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOTEMPTY')
        return ret + 1;
      throw e;
    }

    return ret;
  }

  try {
    await exports.unlink(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return ret + 1;
    throw e;
  }

  return ret;
};

exports.rimrafSync = function rimrafSync(path, filter) {
  if (filter == null)
    filter = (path, stat) => true;

  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  if (typeof filter !== 'function')
    throw new TypeError('"filter" must be a function.');

  let ret = 0;
  let stat = null;

  try {
    stat = exports.lstatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return ret + 1;
    throw e;
  }

  if (!filter(path, stat))
    return ret + 1;

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = exports.readdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES')
        return ret + 1;
      throw e;
    }

    for (const name of list)
      ret += exports.rimrafSync(Path.join(path, name), filter);

    try {
      exports.rmdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOTEMPTY')
        return ret + 1;
      throw e;
    }

    return ret;
  }

  try {
    exports.unlinkSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return ret + 1;
    throw e;
  }

  return ret;
};

exports.statTry = async function statTry(file) {
  try {
    return await exports.stat(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
};

exports.statTrySync = function statTrySync(file) {
  try {
    return exports.statSync(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
};

/*
 * Compat
 */

if (!exports.copyFile) {
  exports.constants = Object.assign({}, exports.constants);
  exports.constants.COPYFILE_EXCL = 1 << 0;
  exports.constants.COPYFILE_FICLONE = 1 << 1;
  exports.constants.COPYFILE_FICLONE_FORCE = 1 << 2;

  exports.copyFile = async function copyFile(src, dest, flags) {
    if (flags == null)
      flags = 0;

    if (typeof src !== 'string')
      throw new TypeError('"src" must be a path.');

    if (typeof dest !== 'string')
      throw new TypeError('"dest" must be a path.');

    if ((flags >>> 0) !== flags)
      throw new TypeError('"flags" must be an integer.');

    const writer = exports.createWriteStream(dest, {
      flags: (flags & exports.constants.COPYFILE_EXCL) ? 'wx' : 'w',
      mode: (await exports.stat(src)).mode
    });

    const reader = exports.createReadStream(src);

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

      reader.pipe(writer);
    });
  };

  exports.copyFileSync = function copyFileSync(src, dest, flags) {
    if (flags == null)
      flags = 0;

    if (typeof src !== 'string')
      throw new TypeError('"src" must be a path.');

    if (typeof dest !== 'string')
      throw new TypeError('"dest" must be a path.');

    if ((flags >>> 0) !== flags)
      throw new TypeError('"flags" must be an integer.');

    const flag = (flags & exports.constants.COPYFILE_EXCL) ? 'wx' : 'w';
    const slab = Buffer.allocUnsafe(64 * 1024);

    let rfd = null;
    let stat = null;
    let wfd = null;
    let pos = 0;

    try {
      rfd = exports.openSync(src, 'r');
      stat = exports.fstatSync(rfd);
      wfd = exports.openSync(dest, flag, stat.mode);

      while (pos < stat.size) {
        const length = Math.min(stat.size - pos, slab.length);
        const bytes = exports.readSync(rfd, slab, 0, length, pos);

        if (bytes !== length)
          throw errorIO('read', src);

        exports.writeSync(wfd, slab, 0, length, null);
        pos += bytes;
      }
    } finally {
      try {
        if (wfd != null)
          exports.closeSync(wfd);
      } finally {
        if (rfd != null)
          exports.closeSync(rfd);
      }
    }
  };
}

if (version < 0x0a0c00) {
  const _mkdir = exports.mkdir;
  const _mkdirSync = exports.mkdirSync;

  const getPaths = (path) => {
    const paths = [];

    let dir = Path.normalize(path);

    for (;;) {
      paths.push(dir);

      const next = Path.dirname(dir);

      if (next === dir)
        break;

      dir = next;
    }

    return paths.reverse();
  };

  const mkdirp = async (dir, mode) => {
    if (mode == null)
      mode = 0o777;

    if (typeof dir !== 'string')
      throw new TypeError('"dir" must be a path.');

    if ((mode >>> 0) !== mode)
      throw new TypeError('"mode" must be an integer.');

    for (const path of getPaths(dir)) {
      try {
        const stat = await exports.stat(path);
        if (!stat.isDirectory())
          throw errorNotDir('mkdir', path);
      } catch (e) {
        if (e.code === 'ENOENT')
          await _mkdir(path, mode);
        else
          throw e;
      }
    }
  };

  const mkdirpSync = (dir, mode) => {
    if (mode == null)
      mode = 0o777;

    if (typeof dir !== 'string')
      throw new TypeError('"dir" must be a path.');

    if ((mode >>> 0) !== mode)
      throw new TypeError('"mode" must be an integer.');

    for (const path of getPaths(dir)) {
      try {
        const stat = exports.statSync(path);
        if (!stat.isDirectory())
          throw errorNotDir('mkdir', path);
      } catch (e) {
        if (e.code === 'ENOENT')
          _mkdirSync(path, mode);
        else
          throw e;
      }
    }
  };

  const mkdirArgs = (path, options) => {
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
      throw new TypeError('"mode" must be an integer.');

    if (typeof recursive !== 'boolean')
      throw new TypeError('"recursive" must be a boolean.');

    if (mode != null)
      return [[path, mode], recursive];

    return [[path], recursive];
  };

  exports.mkdir = async function mkdir(path, options) {
    const [args, recursive] = mkdirArgs(path, options);
    const func = recursive ? mkdirp : _mkdir;
    return func(...args);
  };

  exports.mkdirSync = function mkdirSync(path, options) {
    const [args, recursive] = mkdirArgs(path, options);
    const func = recursive ? mkdirpSync : _mkdirSync;
    return func(...args);
  };
}
