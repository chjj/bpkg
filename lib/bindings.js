/*!
 * bindings.js - binding resolution for node.js
 * Copyright (c) 2018-2023, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const fs = require('fs');
const path = require('path');

/*
 * Constants
 */

const types = [
  'Debug',
  'Release',
  'MinSizeRel',
  'RelWithDebInfo'
];

/**
 * Resolve
 */

async function resolve(name, root) {
  if (typeof name !== 'string')
    throw new TypeError('"name" must be a string.');

  if (typeof root !== 'string')
    throw new TypeError('"root" must be a string.');

  if (path.extname(name) !== '.node')
    name += '.node';

  root = path.resolve(root);

  if (isPath(name)) {
    const file = path.resolve(root, name);

    if (!await exists(file))
      throw moduleError(file);

    return file;
  }

  for (;;) {
    if (path.basename(root) === 'node_modules')
      break;

    const build = path.join(root, 'build');

    if (await exists(build)) {
      const files = [path.join(build, name)];

      for (const type of types)
        files.push(path.join(build, type, name));

      for (const file of files) {
        if (await exists(file))
          return file;
      }
    }

    const next = path.dirname(root);

    if (next === root)
      break;

    root = next;
  }

  throw moduleError(name);
}

/*
 * Helpers
 */

function isPath(str) {
  if (process.platform === 'win32')
    str = str.replace('\\', '/');

  return str[0] === '/'
      || str.startsWith('./')
      || str.startsWith('../');
}

function exists(file) {
  return new Promise((resolve, reject) => {
    const cb = (err) => {
      if (err) {
        if (err.code === 'ENOENT' ||
            err.code === 'EACCES' ||
            err.code === 'EPERM' ||
            err.code === 'ELOOP') {
          resolve(false);
        } else {
          reject(err);
        }
      } else {
        resolve(true);
      }
    };

    try {
      fs.access(file, fs.constants.F_OK, cb);
    } catch (e) {
      reject(e);
    }
  });
}

function moduleError(name) {
  const err = new Error(`Cannot find module '${name}'`);
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

/*
 * Expose
 */

module.exports = resolve;
