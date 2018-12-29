/*!
 * uglify-es.js - uglify-es plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const {resolve} = require('path');

/*
 * UglifyES
 */

class UglifyES {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.uglify = null;
  }

  async open() {
    this.uglify = require('../../vendor/uglify-es');
  }

  async final(code) {
    const options = Object.assign({}, this.options, {
      parse: Object.assign({}, this.options.parse, {
        bare_returns: true,
        shebang: true
      })
    });

    let hashbang;

    code = code.replace(/^#![^\n]*/, (line) => {
      hashbang = line;
      return '';
    });

    const out = this.uglify.minify(code, options);

    if (out.error)
      throw out.error;

    code = out.code;

    if (hashbang)
      code = hashbang + '\n' + code;

    return code.trim() + '\n';
  }
}

/*
 * Expose
 */

module.exports = UglifyES;
