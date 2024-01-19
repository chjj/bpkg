/*!
 * wasm.js - wasm module dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const fs = require('../../vendor/bfile');

/*
 * WASM
 */

async function getExports(path) {
  const source = await fs.readFile(path);
  const compiled = await WebAssembly.compile(source);
  const exports = WebAssembly.Module.exports(compiled);
  const result = new Set();

  for (const {name} of exports)
    result.add(name);

  return result;
}

/*
 * Expose
 */

exports.getExports = getExports;
