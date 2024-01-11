'use strict';

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
