'use strict';

var builtinModules = [];

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

exports.createRequire = createRequire;
exports.createRequireFromPath = createRequireFromPath;
exports.isBuiltin = isBuiltin;
exports.syncBuiltinESMExports = syncBuiltinESMExports;
