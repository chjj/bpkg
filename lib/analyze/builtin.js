/*!
 * builtin.js - builtin dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const {join} = require('path');

/*
 * Builtin
 */

function getExports(specifier) {
  assert(typeof specifier === 'string');

  const cp = require('child_process');
  const node = process.execPath || process.argv[0];
  const file = join(__dirname, 'exports.js');
  const args = ['--no-warnings', file, specifier];

  const result = cp.spawnSync(node, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });

  if (result.error)
    throw result.error;

  if (result.signal) {
    const cmd = [node, ...args].join(' ');
    throw new Error(`${cmd} exited with signal ${result.signal}.`);
  }

  if (result.status)
    throw new Error(result.stderr);

  return new Set(JSON.parse(result.stdout));
}

/*
 * Expose
 */

exports.getExports = getExports;

/*
 * Test
 */

if (require.main === module)
  console.log(getExports(process.argv[2]));
