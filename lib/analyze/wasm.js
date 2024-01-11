'use strict';

const fs = require('../../vendor/bfile');

async function _exports(path) {
  const source = await fs.readFile(path);
  const compiled = await WebAssembly.compile(source);
  const exports = WebAssembly.Module.exports(compiled);

  return new Set(exports.map(x => x.name));
}

exports.exports = _exports;
