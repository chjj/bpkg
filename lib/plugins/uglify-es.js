/*!
 * uglify-es.js - uglify-es plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

/**
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

  async final(module, code) {
    const options = Object.assign({}, this.options, {
      parse: Object.assign({}, this.options.parse, {
        bare_returns: true,
        shebang: false
      })
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

module.exports = UglifyES;
