/*!
 * bpkg.js - bundler for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const Bundle = require('./bundle');
const Resolver = require('./resolver');

/*
 * API
 */

const bpkg = Bundle.build.bind(Bundle);

bpkg.bundle = Bundle.bundle.bind(Bundle);
bpkg.release = Bundle.release.bind(Bundle);
bpkg.transpile = Bundle.transpile.bind(Bundle);
bpkg.build = bpkg;
bpkg.Resolver = Resolver;

/*
 * Expose
 */

module.exports = bpkg;
