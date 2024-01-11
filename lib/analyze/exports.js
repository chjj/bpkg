/*!
 * exports.js - builtin dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

/*
 * Exports
 */

if (require.main !== module)
  throw new Error('Must be called directly');

{
  const module = require(process.argv[2]);
  const keys = Object.keys(module);
  const exports = [];

  for (const key of keys) {
    if (!/^[$A-Za-z_][$\w]*$/.test(key))
      continue;

    if (key === 'default' ||
        key === '__proto__' ||
        key === '__esModule') {
      continue;
    }

    exports.push(key);
  }

  process.stdout.write(JSON.stringify(exports) + '\n');
}
