/*!
 * traverse.js - module traverser
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/pkg-verify
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const Path = require('path');

const {
  basename,
  isAbsolute,
  join,
  relative,
  resolve
} = Path;

/*
 * Constants
 */

const CWD = process.cwd();

const IGNORE_ALL = new Set([
  '.airtap.yml',
  '.babelrc',
  '.bpkgignore',
  '.circleci',
  '.dntrc',
  '.DS_Store',
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
  'ChangeLog.md',
  'CONTRIBUTING',
  'CONTRIBUTING.md',
  'Contributing',
  'Contributing.md',
  'GOVERNANCE',
  'GOVERNANCE.md',
  'Governance',
  'Governance.md',
  'HISTORY',
  'HISTORY.md',
  'History',
  'History.md',
  'INSTALL',
  'INSTALL.md',
  'jsdoc.json',
  'karma.conf.js',
  'Makefile',
  'NEWS',
  'NEWS.md',
  'node_modules',
  'npm-debug.log',
  'package-lock.json',
  'README',
  'README.md',
  'readme',
  'readme.md',
  'TODO',
  'TODO.md',
  'webpack.app.js',
  'webpack.browser.js',
  'webpack.compat.js',
  'webpack.config.js',
  'yarn.lock'
]);

const IGNORE_TOP = new Set([
  'bench',
  'browser',
  'build',
  'doc',
  'docs',
  'example',
  'examples',
  'float.patch',
  'migrate',
  'package-lock.json.1909017369',
  'snap',
  'test',
  'test.js',
  'tools'
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
    this._read(dir, '.bpkgignore');
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

    text = text.trim();
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');

    const lines = text.split(/\n+/);

    for (const line of lines)
      this.add(line);

    return this;
  }

  add(line) {
    assert(typeof line === 'string');

    line = line.replace(/^(\.\/)+/g, '');
    line = line.replace(/^\/+/g, '');
    line = line.replace(/\/+$/g, '');
    line = line.trim();

    if (line.indexOf('*') !== -1) {
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
      if (line.length > 0)
        this.map.add(line);
    }

    return this;
  }

  has(name) {
    assert(typeof name === 'string');

    const base = basename(name);

    if (IGNORE_ALL.has(base))
      return true;

    if (IGNORE_TOP.has(name))
      return true;

    if (this.map.has(name))
      return true;

    for (const glob of this.globs) {
      if (glob.test(name))
        return true;
    }

    return false;
  }
}

/*
 * Traverse (async iterator)
 */

// async function *traverse(root) {
//   assert(typeof root === 'string');
//
//   const ignore = new IgnoreList();
//
//   ignore.read(root);
//
//   if (!isAbsolute(root))
//     root = resolve(CWD, root);
//
//   yield* await (async function *next(path) {
//     const stat = await fs.lstat(path);
//     const file = relative(root, path);
//
//     if (ignore.has(file))
//       return;
//
//     if (stat.isDirectory()) {
//       for (const name of (await fs.readdir(path)))
//         yield* await next(join(path, name));
//       return;
//     }
//
//     if (stat.isFile() || stat.isSymbolicLink()) {
//       yield [file, stat];
//       return;
//     }
//   })(root);
// }

/*
 * Traverse (buffer)
 */

async function traverse(root) {
  assert(typeof root === 'string');

  const ignore = new IgnoreList();
  const out = [];

  ignore.read(root);

  if (!isAbsolute(root))
    root = resolve(CWD, root);

  await (async function next(path) {
    const stat = await fs.lstat(path);
    const file = relative(root, path);

    if (ignore.has(file))
      return;

    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)))
        await next(join(path, name));
      return;
    }

    if (stat.isFile() || stat.isSymbolicLink()) {
      out.push([file, stat]);
      return;
    }
  })(root);

  return out;
}

/*
 * Expose
 */

module.exports = traverse;
