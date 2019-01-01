/*!
 * traverse.js - module traverser
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Resources:
 *   https://github.com/npm/ignore-walk/blob/master/index.js
 *   https://github.com/npm/npm-packlist/blob/master/index.js
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const {Minimatch} = require('../vendor/minimatch');

const {
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} = path;

/*
 * Constants
 * @see https://docs.npmjs.com/misc/developers
 */

const DEFAULT_RULES = [
  '._*', // NPM Default
  '*.orig', // NPM Default
  '.*.swp', // NPM Default
  '.airtap.yml',
  '.appveyor.yml',
  'appveyor.yml',
  'archived-packages/**', // NPM Default
  '.babelignore',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
  '.bpkgignore',
  '.circleci/',
  '/build/config.gypi', // NPM Default
  '**/CVS', // NPM Default
  '**/CVS/**', // NPM Default
  '.dntrc',
  '.DS_Store', // NPM Default
  '.editorconfig',
  '.eslintfiles',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '**/.git', // NPM Default
  '**/.git/**', // NPM Default
  '.gitattributes',
  '.gitconfig',
  '.gitignore', // NPM Default
  '.gitkeep',
  '.gitmodules',
  '**/.hg', // NPM Default
  '**/.hg/**', // NPM Default
  'isolate-*-v8.log',
  '.jscsrc',
  '.jscsrc.js',
  '.jscsrc.json',
  '.jscsrc.yaml',
  'jsdoc.json',
  'jsdoc.js',
  '.jshintrc',
  '.karma/',
  'karma.conf.coffee',
  'karma.conf.js',
  'karma.conf.ts',
  '/.lock-wscript', // NPM Default
  '/node_modules', // NPM Default
  '.npmignore', // NPM Default
  '**/.npmrc', // NPM Default
  'npm-debug.log', // NPM Default
  '.nyc_output/',
  'package-lock.json', // NPM default
  '**/.svn', // NPM Default
  '**/.svn/**', // NPM Default
  '.travis.yml',
  'v8.log',
  '/.wafpickle-*', // NPM Default
  'webpack.app.js',
  'webpack.browser.js',
  'webpack.compat.js',
  'webpack.config.js',
  'yarn.lock',
  '.yarnignore',
  'yarn-error.log',
  'yarn-debug.log',
  '.zuul.yml',

  // Always include (NPM Default)
  '!@(readme|copying|license|licence|notice|changes|changelog|history){,.*}'
];

/**
 * IgnoreList
 */

class IgnoreList {
  constructor(root) {
    assert(typeof root === 'string');

    this.root = resolve(root);
    this.rules = [];
    this.children = new Map();
  }

  async init() {
    await this.read('.bpkgignore');
    await this.read('.gitignore');
    await this.read('.npmignore');
    return this;
  }

  async read(name) {
    assert(typeof name === 'string');
    assert(!isAbsolute(name));

    const file = join(this.root, name);

    let text;

    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      return this;
    }

    return this.add(text);
  }

  add(text) {
    assert(typeof text === 'string');

    text = text.replace(/^\ufeff/, '');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');
    text = text.replace(/^#.*$/gm, '');
    text = text.trim();

    const lines = text.split(/\n+/);

    for (const line of lines) {
      const pattern = line.trim();

      if (pattern.length === 0)
        continue;

      this.push(pattern);
    }

    return this;
  }

  push(pattern) {
    assert(typeof pattern === 'string');

    let rule;

    try {
      rule = new Minimatch(pattern, {
        matchBase: true,
        dot: true,
        flipNegate: true,
        nocase: true
      });
      rule.match('/foo');
    } catch (e) {
      rule = null;
    }

    if (rule)
      this.rules.push(rule);

    return this;
  }

  match(rule, file, directory) {
    assert(rule instanceof Minimatch);
    assert(typeof file === 'string');
    assert(typeof directory === 'boolean');
    assert(!isAbsolute(file));

    if (rule.match('/' + file))
      return true;

    if (rule.match(file))
      return true;

    if (directory) {
      if (rule.match('/' + file + '/'))
        return true;

      if (rule.match(file + '/'))
        return true;
    }

    if (directory && rule.negate) {
      if (rule.match('/' + file, true))
        return true;

      if (rule.match(file, true))
        return true;
    }

    return false;
  }

  include(path, directory = false) {
    assert(typeof path === 'string');
    assert(typeof directory === 'boolean');
    assert(isAbsolute(path));

    const file = relative(this.root, path);

    if (file.length === 0)
      return true;

    let included = true;

    for (const rule of this.rules) {
      if (rule.negate === included)
        continue;

      const match = this.match(rule, file, directory);

      if (match)
        included = rule.negate;
    }

    if (included) {
      for (const child of this.children.values()) {
        if (!path.startsWith(child.root + sep))
          continue;

        if (!child.include(path, directory))
          return false;
      }
    }

    return included;
  }

  async child(root) {
    assert(typeof root === 'string');
    assert(isAbsolute(root));

    if (this.root === root)
      return;

    if (this.children.has(root))
      return;

    const child = new this.constructor(root);
    await child.init();

    this.children.set(root, child);
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

  for (const pattern of DEFAULT_RULES)
    ignore.push(pattern);

  await ignore.init();

  await (async function next(path) {
    const stat = await fs.lstat(path);
    const directory = stat.isDirectory();

    if (!ignore.include(path, directory))
      return;

    if (directory) {
      const list = await fs.readdir(path);

      if (list.includes('.bpkgignore')
          || list.includes('.gitignore')
          || list.includes('.npmignore')) {
        await ignore.child(path);
      }

      for (const name of list)
        await next(join(path, name));

      return;
    }

    if (stat.isFile() || stat.isSymbolicLink()) {
      const file = relative(root, path);
      await cb(file, stat);
      return;
    }
  })(root);
}

/*
 * Expose
 */

module.exports = traverse;
