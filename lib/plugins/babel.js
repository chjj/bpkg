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

const {basename, join} = require('path');

/*
 * Babel
 */

class Babel {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.babel = null;
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
      this.babel = await this.bundle.require('@babel/core');
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        throw new Error('Babel was not found. Be sure to use babel 7.x.');
      throw e;
    }

    if (this.babel.version.startsWith('6.'))
      throw new Error('Babel 7.x or above is required.');
  }

  async compile(module, raw) {
    const options = this.getOptions(module);

    if (!options)
      return raw;

    const config = this.babel.loadPartialConfig(options);

    if (config.options.sourceMaps == null)
      config.options.sourceMaps = false;

    if (config.options.sourceMaps !== false)
      config.options.sourceMaps = 'inline';

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

  async rewrite(path) {
    if (path.endsWith('.ts'))
      return path.slice(0, -3) + '.js';

    if (path.endsWith('.tsx'))
      return path.slice(0, -4) + '.js';

    if (path.endsWith('.jsx'))
      return path.slice(0, -4) + '.js';

    return path;
  }

  getOptions(module) {
    // Mimic babelify.
    const opts = Object.assign({}, this.options);
    const extensions = opts.extensions || this.babel.DEFAULT_EXTENSIONS;
    const sourceMapsAbsolute = opts.sourceMapsAbsolute;

    delete opts.extensions;
    delete opts.sourceMapsAbsolute;

    let found = false;

    for (const ext of extensions) {
      if (module.path.endsWith(ext)) {
        found = true;
        break;
      }
    }

    if (!found)
      return null;

    return Object.assign(opts, {
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
  }
}

/*
 * Expose
 */

module.exports = Babel;
