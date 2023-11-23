'use strict';

const builtinModules = [];

function createRequire(filename) {
  return __fake_require__;
}

function createRequireFromPath(filename) {
  return __fake_require__;
}

function isBuiltin(moduleName) {
  return builtinModules.indexOf(moduleName) !== -1;
}

function syncBuiltinESMExports() {
  return;
}

module.exports = {
  createRequire,
  createRequireFromPath,
  isBuiltin,
  syncBuiltinESMExports
};
