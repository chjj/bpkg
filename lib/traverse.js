/*!
 * traverse.js - module traverser
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/pkg-verify
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const Path = require('path');
const {Minimatch} = require('../vendor/minimatch');

const {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve
} = Path;

/*
 * Constants
 * @see https://docs.npmjs.com/misc/developers
 */

const ALWAYS_IGNORE = new Set([
  '.airtap.yml',
  '.appveyor.yml',
  'appveyor.yml',
  '.babelignore',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
  '.bpkgignore',
  '.circleci',
  'config.gypi', // NPM Default
  'CVS', // NPM Default
  '.dntrc',
  '.DS_Store', // NPM Default
  '.editorconfig',
  '.eslintfiles',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.git', // NPM Default
  '.gitattributes',
  '.gitconfig',
  '.gitignore',
  '.gitmodules',
  '.hg', // NPM Default
  '.jscsrc',
  '.jscsrc.js',
  '.jscsrc.json',
  '.jscsrc.yaml',
  'jsdoc.json',
  'jsdoc.js',
  '.jshintrc',
  'karma.conf.coffee',
  'karma.conf.js',
  'karma.conf.ts',
  '.lock-wscript', // NPM Default
  'node_modules', // NPM Default
  '.npmignore',
  '.npmrc', // NPM Default
  'npm-debug.log', // NPM Default
  'package-lock.json',
  '.svn', // NPM Default
  '.travis.yml',
  'webpack.app.js',
  'webpack.browser.js',
  'webpack.compat.js',
  'webpack.config.js',
  'yarn.lock',
  '.zuul.yml'
]);

// Note: case insensitive.
const NEVER_IGNORE = new Set([
  'changelog',
  'changelog.md',
  'changelog.txt',
  'copying',
  'copying.md',
  'copying.txt',
  'licence',
  'licence.md',
  'licence.txt',
  'license',
  'license.md',
  'license.txt',
  'package.json',
  'readme',
  'readme.md',
  'readme.txt'
]);

/**
 * IgnoreList
 */

class IgnoreList {
  constructor(root) {
    assert(typeof root === 'string');

    this.root = resolve(root);
    this.globs = [];
  }

  async init() {
    await this.read('.bpkgignore');
    await this.read('.gitignore');
    await this.read('.npmignore');
    return this;
  }

  async read(name, prefix) {
    assert(typeof name === 'string');
    assert(prefix == null || typeof prefix === 'string');

    const file = resolve(this.root, name);

    let text;

    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      return this;
    }

    return this.add(text, prefix);
  }

  add(text, prefix) {
    assert(typeof text === 'string');
    assert(prefix == null || typeof prefix === 'string');

    text = text.replace(/^\ufeff/, '');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');
    text = text.replace(/#[^\n]*$/gm, '');
    text = text.trim();

    const lines = text.split(/\n+/);

    for (const line of lines) {
      let pattern = line.trim();

      if (pattern.length === 0)
        continue;

      if (prefix)
        pattern = prefix + pattern;

      this.push(pattern);
    }

    return this;
  }

  push(pattern) {
    assert(typeof pattern === 'string');

    let glob;

    try {
      glob = new Minimatch(pattern, { matchBase: true });
      glob.match('/foo');
    } catch (e) {
      glob = null;
    }

    if (glob)
      this.globs.push(glob);

    return this;
  }

  has(path, directory = false) {
    assert(typeof path === 'string');
    assert(typeof directory === 'boolean');

    let file = relative(this.root, path);

    if (file.length === 0)
      return false;

    const name = basename(path);

    if (name.startsWith('.')) {
      // Ignore `._*` (NPM Default).
      if (name.startsWith('._'))
        return true;

      // Ignore `.*.swp` (NPM Default).
      if (extname(name) === '.swp')
        return true;
    }

    // Default ignores.
    if (ALWAYS_IGNORE.has(name))
      return true;

    // Never ignore certain files (NPM behavior).
    if (NEVER_IGNORE.has(name.toLowerCase()))
      return false;

    if (directory)
      file += '/';

    for (const glob of this.globs) {
      if (glob.match(file))
        return true;
    }

    return false;
  }
}

/*
 * Traverse
 */

async function traverse(path, cb) {
  assert(typeof path === 'string');
  assert(typeof cb === 'function');

  const root = resolve(path);
  const stat = await fs.lstatTry(root);

  if (!stat || !stat.isDirectory())
    return;

  const ignore = new IgnoreList(root);

  await ignore.init();

  await (async function next(path) {
    const stat = await fs.lstat(path);
    const file = relative(root, path);
    const dir = dirname(file);

    if (dir !== '.') {
      switch (basename(file)) {
        case '.bpkgignore':
        case '.gitignore':
        case '.npmignore':
          await ignore.read(file, dir + '/');
          break;
      }
    }

    if (ignore.has(path, stat.isDirectory()))
      return;

    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)))
        await next(join(path, name));
      return;
    }

    if (stat.isFile() || stat.isSymbolicLink()) {
      await cb(file, stat);
      return;
    }
  })(root);
}

/*
 * Expose
 */

module.exports = traverse;
