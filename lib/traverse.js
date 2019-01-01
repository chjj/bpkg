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
  basename,
  isAbsolute,
  join,
  relative,
  resolve
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
  constructor(root, parent = null) {
    assert(typeof root === 'string');
    assert(parent == null || (parent instanceof IgnoreList));

    this.root = resolve(root);
    this.parent = parent || null;
    this.rules = [];
  }

  async init() {
    for (const name of ['.bpkgignore',
                        'package.json',
                        '.npmignore',
                        '.gitignore']) {
      if (await this.read(name))
        break;
    }

    return this;
  }

  async pkg(name) {
    assert(typeof name === 'string');
    assert(!isAbsolute(name));

    const file = join(this.root, name);

    let text;
    let json;

    try {
      text = await fs.readFile(file, 'utf8');
      json = JSON.parse(text);
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      return false;
    }

    if (json == null || typeof json !== 'object')
      return false;

    if (typeof json.main === 'string')
      this.push(`!${json.main}`);

    if (typeof json.browser === 'string')
      this.push(`!${json.browser}`);

    if (Array.isArray(json.files)) {
      this.push('*');

      for (const file of json.files) {
        if (typeof file !== 'string')
          continue;

        const naked = file.replace(/\/+$/, '');

        this.push(`!${file}`);
        this.push(`!${naked}/**`);
      }

      return true;
    }

    return false;
  }

  async read(name) {
    assert(typeof name === 'string');
    assert(!isAbsolute(name));

    if (name === 'package.json')
      return this.pkg(name);

    const file = join(this.root, name);

    let text;

    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      return false;
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

    return true;
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

    if (rule.match(`/${file}`))
      return true;

    if (rule.match(file))
      return true;

    if (directory) {
      if (rule.match(`/${file}/`))
        return true;

      if (rule.match(`${file}/`))
        return true;
    }

    if (directory && rule.negate) {
      if (rule.match(`/${file}`, true))
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

    // Always include package.json.
    if (!directory) {
      if (basename(file) === 'package.json')
        return true;
    }

    let included = true;

    if (this.parent)
      included = this.parent.include(path, directory);

    for (const rule of this.rules) {
      if (rule.negate === included)
        continue;

      const match = this.match(rule, file, directory);

      if (match)
        included = rule.negate;
    }

    return included;
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

  await (async function next(path, ignore) {
    const stat = await fs.lstat(path);
    const directory = stat.isDirectory();

    if (!ignore.include(path, directory))
      return;

    if (directory) {
      const list = await fs.readdir(path);
      const child = new IgnoreList(path, ignore);

      if (list.includes('.bpkgignore')
          || list.includes('package.json')
          || list.includes('.npmignore')
          || list.includes('.gitignore')) {
        await child.init();
      }

      for (const name of list)
        await next(join(path, name), child);

      return;
    }

    if (stat.isFile() || stat.isSymbolicLink()) {
      const file = relative(root, path);
      await cb(file, stat);
      return;
    }
  })(root, ignore);
}

/*
 * Expose
 */

module.exports = traverse;
