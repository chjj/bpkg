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
  isAbsolute,
  join,
  relative,
  resolve
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

    if (DEFAULT_IGNORE.has(name))
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
 * Traverse
 */

async function *traverse(root) {
  assert(typeof root === 'string');

  const ignore = new IgnoreList();

  ignore.read(root);

  if (!isAbsolute(root))
    root = resolve(CWD, root);

  yield* await (async function *next(path) {
    const stat = await fs.lstat(path);
    const file = relative(root, path);

    if (ignore.has(file))
      return;

    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)))
        yield* await next(join(path, name));
      return;
    }

    if (stat.isFile() || stat.isSymbolicLink()) {
      yield [file, stat];
      return;
    }
  })(root);
}

/*
 * Expose
 */

module.exports = traverse;
