/*!
 * terser.js - terser plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

/**
 * Terser
 */

class Terser {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.terser = null;
  }

  async open() {
    this.terser = require('../../vendor/terser');
  }

  async final(module, code) {
    // https://github.com/terser/terser?tab=readme-ov-file#minify-options
    const options = Object.assign({}, this.options, {
      // https://github.com/terser/terser?tab=readme-ov-file#parse-options
      parse: Object.assign({}, this.options.parse, {
        bare_returns: true,
        shebang: false
      }),
      // https://github.com/terser/terser?tab=readme-ov-file#mangle-options
      mangle: Object.assign({}, this.options.mangle, {
        reserved: this.bundle.env === 'node'
          ? ['module', 'exports', 'require']
          : []
      })
    });

    const out = await this.terser.minify(code, options);

    if (out.error)
      throw out.error;

    return out.code.trim() + '\n';
  }
}

/*
 * Expose
 */

module.exports = Terser;
