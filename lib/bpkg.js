/*!
 * bpkg.js - bundler for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const Bundle = require('./bundle');
const Resolver = require('./resolver');

/*
 * Expose
 */

module.exports = Bundle.build.bind(Bundle);
module.exports.bundle = Bundle.bundle.bind(Bundle);
module.exports.release = Bundle.release.bind(Bundle);
module.exports.build = Bundle.build.bind(Bundle);
module.exports.Resolver = Resolver;
