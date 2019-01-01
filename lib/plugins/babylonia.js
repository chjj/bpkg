/*!
 * babylonia.js - babylonia plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const Babel = require('./babel');

/**
 * Babylonia
 */

class Babylonia extends Babel {
  constructor(bundle, options) {
    super(bundle, options);
    this.name = 'babylonia';
  }
}

/*
 * Expose
 */

module.exports = Babylonia;
