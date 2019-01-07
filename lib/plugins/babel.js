/*!
 * babel.js - babel plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Parts of this software are based on babel/babelify:
 *   Copyright (c) 2015 Sebastian McKenzie (MIT License)
 *   https://github.com/babel/babelify
 *
 * Resources:
 *   https://github.com/babel/babelify/blob/master/index.js
 *   https://babeljs.io/docs/en/babel-core
 *   https://babeljs.io/docs/en/options
 */

'use strict';

const assert = require('assert');
const {basename, dirname} = require('path');

/**
 * Babel
 */

class Babel {
  constructor(bundle, options) {
    this.name = '@babel';
    this.core = '@babel/core';
    this.bundle = bundle;
    this.options = options;
    this.path = bundle.root;
    this.babel = null;
    this.resolve = bundle.resolve;
  }

  async load() {
    this.bundle.addExtension([
      '.js',
      '.jsx',
      '.es6',
      '.es',
      '.mjs',
      '.ts',
      '.tsx'
    ]);
  }

  async open() {
    try {
      this.path = await this.bundle.resolve(this.core);
      this.babel = require(this.path);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        throw new Error('Babel was not found. Be sure to use babel 7.x.');
      throw e;
    }

    if (this.babel.version.startsWith('6.'))
      throw new Error('Babel 7.x or above is required.');

    this.resolve = this.bundle.resolver({
      root: dirname(this.path),
      npm: true
    });
  }

  async compile(module, raw) {
    if (this.shouldIgnore(module))
      return raw;

    const [options, opts] = this.getOptions(module);
    const config = this.babel.loadPartialConfig(options);

    if (config.options.sourceMaps == null)
      config.options.sourceMaps = false;

    if (config.options.sourceMaps !== false)
      config.options.sourceMaps = 'inline';

    if (opts.defaults || opts.targets || opts.loose != null) {
      // https://babeljs.io/docs/en/babel-preset-env
      this.mergePreset(config, 'env', {
        targets: opts.targets || 'last 2 versions', // Non-default.
        spec: false,
        loose: opts.loose != null ? opts.loose : true, // Non-default.
        modules: 'auto',
        debug: false,
        include: [],
        exclude: [],
        useBuiltIns: 'usage', // Non-default.
        forceAllTransforms: false,
        configPath: process.cwd(),
        ignoreBrowserslistConfig: false,
        shippedProposals: false
      });

      // https://babeljs.io/docs/en/babel-plugin-transform-runtime
      this.mergePlugin(config, 'transform-runtime', {
        corejs: false,
        helpers: true,
        regenerator: true,
        useESModules: false
      });

      // https://babeljs.io/docs/en/next/babel-plugin-syntax-bigint.html
      // https://github.com/babel/proposals/issues/2
      // https://github.com/babel/babel/pull/6015
      try {
        this.mergePlugin(config, 'syntax-bigint', {});
      } catch (e) {
        ;
      }
    }

    const code = raw.toString('utf8');

    return new Promise((resolve, reject) => {
      const cb = (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result ? result.code : code);
      };

      try {
        this.babel.transform(code, config.options, cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  async rewrite(module, path) {
    if (path.endsWith('.ts'))
      return path.slice(0, -3) + '.js';

    if (path.endsWith('.tsx'))
      return path.slice(0, -4) + '.js';

    if (path.endsWith('.jsx'))
      return path.slice(0, -4) + '.js';

    return path;
  }

  async redirect(location, from) {
    if (location.startsWith('regenerator-runtime'))
      return this.resolve(location);

    if (location.startsWith('core-js'))
      return this.resolve(location);

    return location;
  }

  getOptions(module) {
    // Mimic babelify.
    const opts = Object.assign({}, this.options);
    const {defaults, targets, loose} = opts;
    const sourceMapsAbsolute = opts.sourceMapsAbsolute;

    delete opts.extensions;
    delete opts.defaults;
    delete opts.targets;
    delete opts.loose;
    delete opts.sourceMapsAbsolute;

    const options = Object.assign(opts, {
      cwd: opts.cwd || this.bundle.root,
      caller: Object.assign({
        name: 'bpkg',
        supportsStaticESM: true
      }, opts.caller),
      filename: module.path,
      sourceFileName: sourceMapsAbsolute
        ? basename(module.path)
        : undefined,
      code: true,
      ast: false
    });

    return [options, { defaults, targets, loose }];
  }

  shouldIgnore(module) {
    assert(isObject(module));

    if (module.pkg.name.startsWith('@babel/'))
      return true;

    const parent = dirname(module.pkg.root);

    if (basename(parent) === 'babylonia')
      return true;

    if (module.pkg.name === 'regenerator-runtime')
      return true;

    if (module.pkg.name === 'core-js')
      return true;

    let extensions = this.babel.DEFAULT_EXTENSIONS;
    let found = false;

    if (Array.isArray(this.options.extensions))
      extensions = this.options.extensions;

    for (const ext of extensions) {
      if (module.path.endsWith(ext)) {
        found = true;
        break;
      }
    }

    if (!found)
      return true;

    return false;
  }

  item(config, type, name, dirname) {
    assert(isObject(config));
    assert(typeof type === 'string');
    assert(typeof name === 'string');
    assert(dirname == null || typeof dirname === 'string');

    return this.babel.createConfigItem([name, Object.create(null)], {
      dirname: dirname || config.cwd,
      type
    });
  }

  getItem(config, type, items, name) {
    assert(typeof type === 'string');
    assert(Array.isArray(items));
    assert(typeof name === 'string');

    for (let i = 0; i < items.length; i++) {
      let item = items[i];

      if (!item.file)
        continue;

      const {request} = item.file;

      if (typeof request !== 'string')
        continue;

      if (request === `${this.name}/${name}`
          || request === `${this.name}/${type}-${name}`) {
        if (item.options == null || typeof item.options !== 'object') {
          item = this.item(config, type, request, item.dirname);
          items[i] = item;
        }

        return item.options;
      }
    }

    const item = this.item(config, type, `${this.name}/${name}`);

    items.push(item);

    return item.options;
  }

  mergeItem(config, type, items, name, options) {
    assert(isObject(options));

    const item = this.getItem(config, type, items, name);

    for (const key of Object.keys(options)) {
      if (item[key] == null)
        item[key] = options[key];
    }

    return item;
  }

  mergePreset(config, name, options) {
    assert(isObject(config));
    const {presets} = config.options;
    return this.mergeItem(config, 'preset', presets, name, options);
  }

  mergePlugin(config, name, options) {
    assert(isObject(config));
    const {plugins} = config.options;
    return this.mergeItem(config, 'plugin', plugins, name, options);
  }
}

/*
 * Helpers
 */

function isObject(obj) {
  if (obj == null)
    return false;

  return typeof obj === 'object';
}

/*
 * Expose
 */

module.exports = Babel;
