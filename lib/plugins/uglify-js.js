/*!
 * uglify-js.js - uglify-js plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

/**
 * UglifyJS
 */

class UglifyJS {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.uglify = null;
  }

  async open() {
    this.uglify = require('../../vendor/uglify-js');
  }

  async final(module, code) {
    // https://github.com/mishoo/UglifyJS?tab=readme-ov-file#minify-options
    const options = Object.assign({}, this.options, {
      // https://github.com/mishoo/UglifyJS?tab=readme-ov-file#parse-options
      parse: Object.assign({}, this.options.parse, {
        bare_returns: true,
        shebang: false
      }),
      // https://github.com/mishoo/UglifyJS?tab=readme-ov-file#mangle-options
      mangle: {
        reserved: this.bundle.env === 'node'
          ? ['module', 'exports', 'require']
          : []
      }
    });

    const out = this.uglify.minify(code, options);

    if (out.error)
      throw out.error;

    return out.code.trim() + '\n';
  }
}

/*
 * Expose
 */

module.exports = UglifyJS;
