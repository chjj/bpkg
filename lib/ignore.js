/*!
 * ignore.js - ignore list
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/pkg-verify
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const Path = require('path');

const {
  basename,
  join,
  relative,
  resolve,
} = Path;

/*
 * Constants
 */

const CWD = process.cwd();

const DEFAULT_IGNORE = new Set([
  '.airtap.yml',
  '.babelrc',
  '.circleci',
  '.dntrc',
  '.editorconfig',
  '.eslintfiles',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.git',
  '.gitattributes',
  '.gitconfig',
  '.gitignore',
  '.jscsrc',
  '.jshintrc',
  '.npmignore',
  '.travis.yml',
  '.zuul.yml',
  'CHANGELOG',
  'CHANGELOG.md',
  'ChangeLog',
  'CONTRIBUTING.md',
  'float.patch',
  'GOVERNANCE.md',
  'History.md',
  'INSTALL',
  'NEWS',
  'README',
  'readme',
  'README.md',
  'readme.md',
  'TODO.md',
  'TODO',
  'bench',
  'browser',
  'build',
  'doc',
  'docs',
  'example',
  'examples',
  'jsdoc.json',
  'karma.conf.js',
  'Makefile',
  'migrate',
  'node_modules',
  'npm-debug.log',
  'package-lock.json',
  'package-lock.json.1909017369',
  'scripts', // XXX
  'snap',
  'test',
  'test.js',
  'tools',
  'webpack.app.js',
  'webpack.browser.js',
  'webpack.compat.js',
  'webpack.config.js',
  'yarn.lock'
]);


/**
 * IgnoreList
 */

class IgnoreList {
  constructor() {
    this.map = new Set();
    this.globs = [];
  }

  read(dir) {
    assert(typeof dir === 'string');

    this._read(dir, '.npmignore');
    this._read(dir, '.gitignore');
  }

  _read(dir, name) {
    assert(typeof dir === 'string');
    assert(typeof name === 'string');

    const file = resolve(dir, name);

    let text;

    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT')
        return this;

      throw e;
    }

    const lines = text.trim().split(/(\r\n|\r|\n)+/);

    for (const line of lines)
      this.add(line);

    return this;
  }

  add(line) {
    assert(typeof line === 'string');

    const rule = line.trim().replace(/^\/+|\/+$/g, '');

    if (rule.indexOf('*') !== -1) {
      let rx = line;

      // **
      rx = rx.replace(/\/\*\*\//g, '/?[^\\s\\S]*?/?');
      rx = rx.replace(/\*\*\//g, '[^\\s\\S]*?/?');
      rx = rx.replace(/\/\*\*/g, '/?[^\\s\\S]*?');
      rx = rx.replace(/\*\*/g, '[^\\s\\S]*?');

      // *
      rx = rx.replace(/\/\*/g, '/?[^/]*?');
      rx = rx.replace(/\*/g, '[^/]*');

      // escaping
      rx = rx.replace(/\./g, '\\.');

      this.globs.push(new RegExp('^' + rx + '$'));
    } else {
      if (rule.length > 0)
        this.map.add(rule);
    }

    return this;
  }

  has(name) {
    assert(typeof name === 'string');

    if (this.map.has(name))
      return true;

    for (const glob of this.globs) {
      if (glob.test(name))
        return true;
    }

    if (DEFAULT_IGNORE.has(name))
      return true;

    return false;
  }

  static copy(src, dest) {
    assert(typeof src === 'string');
    assert(typeof dest === 'string');

    const flags = fs.constants.COPYFILE_EXCL;
    const ignore = new IgnoreList();

    src = resolve(CWD, src);

    ignore.read(src);

    console.log(`Copying module: ${basename(src)}.`);

    copySync(src, dest, flags, (path) => {
      path = relative(src, path);
      return !ignore.has(path);
    });
  }
}

/*
 * Helpers
 */

function copySync(src, dest, flags, filter) {
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

  const overwrite = (flags & fs.constants.COPYFILE_EXCL) === 0;
  const sstat = fs.lstatSync(src);

  let dstat = null;

  try {
    dstat = fs.lstatSync(dest);
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  let ret = 0;

  if (!overwrite && dstat)
    throw new Error('Cannot overwrite file.');

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw new Error('Cannot copy file into itself.');
  }

  if (!filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = fs.readdirSync(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new Error('Directory already exists.');
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
        throw new Error('Cannot symlink over existing symlink.');
      }

      fs.unlinkSync(dest);
    }

    fs.symlinkSync(dest, fs.readlinkSync(src));

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new Error('Cannot overwrite file.');
      }

      if (!dstat.isFile())
        fs.unlinkSync(dest);
    }

    fs.copyFileSync(src, dest, flags);

    return ret;
  }

  return ret + 1;
}

/*
 * Expose
 */

module.exports = IgnoreList;
