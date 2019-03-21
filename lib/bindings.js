/*!
 * bindings.js - binding resolution for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Parts of this software are based on TooTallNate/node-bindings:
 *   Copyright (c) 2012, Nathan Rajlich <nathan@tootallnate.net>
 *   https://github.com/TooTallNate/node-bindings
 */

'use strict';

const assert = require('assert');
const {extname, join} = require('path');

/*
 * Constants
 */

const DEFAULTS = {
  compiled: process.env.NODE_BINDINGS_COMPILED_DIR || 'compiled',
  platform: process.platform,
  arch: process.arch,
  nodePreGyp:
    `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
  version: process.versions.node,
  bindings: 'bindings.node'
};

const PATHS = [
  // node-gyp's linked version in the "build" dir
  ['root', 'build', 'bindings'],
  // node-waf and gyp_addon (a.k.a node-gyp)
  ['root', 'build', 'Debug', 'bindings'],
  ['root', 'build', 'Release', 'bindings'],
  // Debug files, for development (legacy behavior)
  ['root', 'out', 'Debug', 'bindings'],
  ['root', 'Debug', 'bindings'],
  // Release files, but manually compiled (legacy behavior)
  ['root', 'out', 'Release', 'bindings'],
  ['root', 'Release', 'bindings'],
  // Legacy from node-waf, node <= 0.4.x
  ['root', 'build', 'default', 'bindings'],
  // Production "Release" buildtype binary (meh...)
  ['root', 'compiled', 'version', 'platform', 'arch', 'bindings'],
  // node-qbs builds
  ['root', 'addon-build', 'release', 'install-root', 'bindings'],
  ['root', 'addon-build', 'debug', 'install-root', 'bindings'],
  ['root', 'addon-build', 'default', 'install-root', 'bindings'],
  // node-pre-gyp path ./lib/binding/{node_abi}-{platform}-{arch}
  ['root', 'lib', 'binding', 'nodePreGyp', 'bindings']
];

/*
 * Bindings
 */

async function bindings(resolve, options) {
  assert(typeof resolve === 'function');
  assert(options && typeof options === 'object');

  options = Object.assign({}, options);

  for (const key of Object.keys(DEFAULTS)) {
    if (options[key] == null)
      options[key] = DEFAULTS[key];
  }

  if (!options.root || typeof options.root !== 'string')
    throw new Error('Module root required.');

  if (!options.bindings || typeof options.bindings !== 'string')
    throw new Error('Bindings required.');

  if (extname(options.bindings) !== '.node')
    options.bindings += '.node';

  for (const rawParts of PATHS) {
    const parts = [];

    for (const part of rawParts)
      parts.push(options[part] || part);

    const path = join(...parts);

    try {
      return await resolve(path);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
    }
  }

  throw new Error('Could not locate the bindings file: '
                  + `${JSON.stringify(options.bindings)}.`);
}

/*
 * Expose
 */

module.exports = bindings;
