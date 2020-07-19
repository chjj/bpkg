/*!
 * cmk.js - cmake binding for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const cp = require('child_process');

/*
 * API
 */

async function build(root) {
  assert(typeof root === 'string');
  return exec(root, ['node-cmk', 'build']);
}

async function rebuild(root) {
  assert(typeof root === 'string');
  return exec(root, ['node-cmk', 'rebuild']);
}

/*
 * Helpers
 */

async function exec(cwd, args) {
  assert(typeof cwd === 'string');
  assert(Array.isArray(args));
  assert(args.length >= 1);

  const file = args.shift();
  const options = { cwd };

  return new Promise((resolve, reject) => {
    const cb = (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve([stdout, stderr]);
    };

    try {
      cp.execFile(file, args, options, cb);
    } catch (e) {
      reject(e);
    }
  });
}

/*
 * Expose
 */

exports.build = build;
exports.rebuild = rebuild;
