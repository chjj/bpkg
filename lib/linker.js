/*!
 * linker.js - linker for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const cmake = require('./cmake');
const bindings = require('./bindings');
const builtins = require('./builtins');
const gyp = require('./gyp');
const {string} = require('./utils');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep
} = path;

/*
 * Constants
 */

const importTypes = {
  REQUIRE: 0,
  IMPORT: 1,
  IMPORT_EXPR: 2
};

/**
 * Linker
 */

class Linker {
  constructor(module) {
    this.module = module;
    this.bundle = module.bundle;
    this.dirname = module.dirname;
    this.root = module.root;
    this.resolver = module.resolver;
  }

  log(...args) {
    this.module.log(...args);
  }

  warning(...args) {
    this.module.warning(...args);
  }

  makeError(specifier, flag) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));

    if (flag === importTypes.IMPORT_EXPR)
      return `__${this.bundle.env}_reject__(${string(specifier)})`;

    return `__${this.bundle.env}_throw__(${string(specifier)})`;
  }

  _makeRequire0() {
    const expr = this.bundle.env === 'browser'
      ? '__browser_require__(0, 0, null)'
      : '__node_require__(0, 0)';

    if (this.bundle.hasWorkers) {
      const env = 'process.env.BTHREADS_WORKER_INLINE';
      const exec = expr.replace(/0/, `${env} >>> 0`);

      return `(${env} != null\n  ? ${exec}\n  : ${expr})`;
    }

    return expr;
  }

  makeRequire0() {
    assert(this.module.id === 0);

    if (this.module.isAsync())
      return 'await ' + this._makeRequire0();

    return this._makeRequire0();
  }

  _makeRequire(id, specifier, flag) {
    const spec = string(specifier);
    const expr = Number(flag === importTypes.IMPORT_EXPR);

    if (this.bundle.env === 'browser') {
      const parent = this.module.isModule() ? '__module' : 'module';
      return `__browser_require__(${id} /* ${spec} */, ${expr}, ${parent})`;
    }

    return `__node_require__(${id} /* ${spec} */, ${expr})`;
  }

  makeRequire(module, specifier, flag) {
    assert(typeof module === 'object' && module != null);
    assert(typeof specifier === 'string');
    assert(isImportType(flag));

    const call = this._makeRequire(module.id, specifier, flag);

    if (flag === importTypes.REQUIRE) {
      if (module.isModule())
        throw new Error(`Cannot require() ES module: ${string(specifier)}`);

      return call;
    }

    if (module.isAsync()) {
      if (flag === importTypes.IMPORT_EXPR)
        return call;

      return `await ${call}`;
    }

    if (flag === importTypes.IMPORT_EXPR)
      return `Promise.resolve(${call})`;

    return call;
  }

  makeRawRequire(specifier, flag) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));

    if (flag === importTypes.REQUIRE) {
      if (this.bundle.env === 'browser')
        return this.makeError(specifier, flag);

      return `require(${string(specifier)})`;
    }

    if (flag === importTypes.IMPORT_EXPR)
      return `import(${string(specifier)})`;

    if (this.bundle.target !== 'esm') {
      this.warning('cannot import module: %s.', specifier);
      return this.makeError(specifier, flag);
    }

    return `await import(${string(specifier)})`;
  }

  makeBuiltinRequire(specifier, flag) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));

    if (this.bundle.env === 'browser')
      return this.makeError(specifier, flag);

    const call = `require(${string(specifier)})`;

    if (flag === importTypes.IMPORT_EXPR)
      return `Promise.resolve(${call})`;

    return call;
  }

  async transform(code) {
    assert(typeof code === 'string');

    const out = await this.module.replace(code, this, {
      AwaitExpression: this.AwaitExpression,
      ImportExpression: this.ImportExpression,
      CallExpression: this.CallExpression,
      Identifier: this.Identifier
    });

    return out;
  }

  async require(specifier, flag) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));

    const isImport = flag !== importTypes.REQUIRE;

    if (this.resolver.isExternal(specifier, isImport)) {
      this.warning('ignoring external module: %s.', specifier);
      return this.makeRawRequire(specifier, flag);
    }

    if (this.bundle.env === 'browser') {
      if (specifier === 'bindings' ||
          specifier === 'loady' ||
          specifier === 'cmake-node' ||
          specifier === 'node-gyp-build') {
        return this.makeError(specifier, flag);
      }
    }

    let path = await this.module.tryResolve(specifier, isImport);

    if (!path) {
      this.warning('ignoring missing module: %s.', specifier);

      if (this.bundle.env === 'browser')
        return this.makeError(specifier, flag);

      return this.makeRawRequire(specifier, flag);
    }

    if (!isImport && isAbsolute(path) && extname(path) === '.node') {
      if (this.bundle.env === 'browser')
        return this.makeError(specifier, flag);

      if (this.bundle.collectBindings) {
        this.bundle.bindings.add(path);
        return this.makeRawRequire(`./bindings/${basename(path)}`, flag);
      }

      this.bundle.hasBindings = true;
    }

    if (this.bundle.env === 'browser') {
      if (!isAbsolute(path)) {
        path = builtins[path];

        if (!path) {
          if (this.bundle.ignoreMissing) {
            this.warning('ignoring missing builtin: %s.', specifier);
            return this.makeError(specifier, flag);
          }

          throw new Error(`Could not resolve module: ${path}.`);
        }
      }
    }

    if (isAbsolute(path)) {
      const module = await this.bundle.getModule(path);
      return this.makeRequire(module, specifier, flag);
    }

    return this.makeBuiltinRequire(specifier, flag);
  }

  async bindings(specifier) {
    assert(typeof specifier === 'string');

    try {
      return await bindings(specifier, this.dirname);
    } catch (e) {
      return null;
    }
  }

  async tryBinding(specifier) {
    const path = await this.bindings(specifier);

    if (path)
      return path;

    const file = await findBuildFile(this.dirname);

    if (!file || !file.startsWith(this.root + sep))
      return null;

    const binding = basename(file) === 'binding.gyp' ? gyp : cmake;
    const root = dirname(file);

    this.log('Rebuilding binding: %s.', root);

    await binding.rebuild(root);

    return this.bindings(specifier);
  }

  isRequireLike(node, code, name) {
    // e.g.
    // require('foo')
    // __esm_import__('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'Identifier')
      return false;

    if (node.callee.name !== name)
      return false;

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal') {
      this.warning('cannot resolve dynamic require: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  isRequire(node, code) {
    return this.isRequireLike(node, code, 'require');
  }

  isImport(node, code) {
    return this.isRequireLike(node, code, '__esm_import__');
  }

  isImportExpression(node, code) {
    if (node.type !== 'ImportExpression')
      return false;

    const arg = node.source;

    if (arg.type !== 'Literal') {
      this.warning('cannot resolve dynamic import: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  isBindings(node, code) {
    return this.isScriptBindings(node, code)
        || this.isMemberBindings(node, code)
        || this.isModuleBindings(node, code);
  }

  isScriptBindings(node, code) {
    // e.g.
    // require('bindings')('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'CallExpression')
      return false;

    const child = node.callee;

    if (child.callee.type !== 'Identifier')
      return false;

    if (child.callee.name !== 'require')
      return false;

    if (child.arguments.length < 1)
      return false;

    const childArg = child.arguments[0];

    if (childArg.type !== 'Literal')
      return false;

    if (childArg.value !== 'bindings'
        && childArg.value !== 'loady') {
      return false;
    }

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal') {
      this.warning('cannot resolve dynamic bindings: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  isMemberBindings(node, code) {
    // e.g.
    // require('cmake-node').load('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
      return false;

    if (node.callee.computed)
      return false;

    if (node.callee.object.type !== 'CallExpression')
      return false;

    const child = node.callee.object;

    if (child.callee.type !== 'Identifier')
      return false;

    if (child.callee.name !== 'require')
      return false;

    if (child.arguments.length < 1)
      return false;

    const childArg = child.arguments[0];

    if (childArg.type !== 'Literal')
      return false;

    if (childArg.value !== 'cmake-node')
      return false;

    if (node.callee.property.type !== 'Identifier')
      return false;

    if (node.callee.property.name !== 'load')
      return false;

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal') {
      this.warning('cannot resolve dynamic bindings: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  isModuleBindings(node, code) {
    // e.g.
    // import bindings from 'bindings';
    // bindings('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type === 'MemberExpression') {
      if (node.callee.computed)
        return false;

      if (node.callee.object.type !== 'Identifier')
        return false;

      if (node.callee.property.type !== 'Identifier')
        return false;

      if (node.callee.object.name !== 'cmake')
        return false;

      if (node.callee.property.name !== 'load')
        return false;
    } else {
      if (this.module.sourceType() !== 'module')
        return false;

      if (node.callee.type !== 'Identifier')
        return false;

      if (node.callee.name !== 'bindings'
          && node.callee.name !== 'loady') {
        return false;
      }
    }

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal') {
      this.warning('cannot resolve dynamic bindings: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  isResolve(node) {
    // e.g.
    // require.resolve('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
      return false;

    if (node.callee.computed)
      return false;

    const callee = node.callee;

    if (callee.object.type !== 'Identifier')
      return false;

    if (callee.property.type !== 'Identifier')
      return false;

    if (callee.object.name !== 'require')
      return false;

    if (callee.property.name !== 'resolve')
      return false;

    if (node.arguments.length < 1)
      return false;

    return true;
  }

  isResolvePaths(node) {
    // e.g.
    // require.resolve.paths('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
      return false;

    if (node.callee.computed)
      return false;

    const callee = node.callee;

    if (callee.object.type !== 'MemberExpression')
      return false;

    if (callee.object.computed)
      return false;

    if (callee.object.object.type !== 'Identifier')
      return false;

    if (callee.object.property.type !== 'Identifier')
      return false;

    if (callee.property.type !== 'Identifier')
      return false;

    if (callee.object.object.name !== 'require')
      return false;

    if (callee.object.property.name !== 'resolve')
      return false;

    if (callee.property.name !== 'paths')
      return false;

    if (node.arguments.length < 1)
      return false;

    return true;
  }

  isBufferCheck(node) {
    // e.g.
    // Buffer.isBuffer(obj)
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
      return false;

    if (node.callee.computed)
      return false;

    const callee = node.callee;

    if (callee.object.type !== 'Identifier')
      return false;

    if (callee.property.type !== 'Identifier')
      return false;

    if (callee.object.name !== 'Buffer')
      return false;

    if (callee.property.name !== 'isBuffer')
      return false;

    if (node.arguments.length < 1)
      return true;

    const arg = node.arguments[0];

    switch (arg.type) {
      case 'Identifier':
      case 'Literal':
      case 'MemberExpression':
        return true;
    }

    return false;
  }

  async AwaitExpression(node, code) {
    // await import(path)
    if (!this.isImportExpression(node.argument, code))
      return null;

    const arg = node.argument.source;

    return [node, await this.require(arg.value, importTypes.IMPORT)];
  }

  async ImportExpression(node, code) {
    // import(path).then(...);
    if (!this.isImportExpression(node, code))
      return null;

    const arg = node.source;

    return [node, await this.require(arg.value, importTypes.IMPORT_EXPR)];
  }

  async CallExpression(node, code) {
    if (this.isRequire(node, code)) {
      const arg = node.arguments[0];
      return [node, await this.require(arg.value, importTypes.REQUIRE)];
    }

    if (this.isImport(node, code)) {
      const arg = node.arguments[0];
      return [node, await this.require(arg.value, importTypes.IMPORT)];
    }

    if (this.isBindings(node, code)) {
      const arg = node.arguments[0];
      const flag = importTypes.REQUIRE;

      if (this.bundle.env === 'browser')
        return [node, this.makeError(arg.value, flag)];

      if (this.bundle.ignoreBindings) {
        this.warning('ignoring binding: %s.', arg.value);
        return [node, this.makeError(arg.value, flag)];
      }

      let path = await this.tryBinding(arg.value);

      if (!path) {
        if (this.bundle.ignoreMissing) {
          this.warning('ignoring missing binding: %s.', arg.value);
          return [node, this.makeError(arg.value, flag)];
        }
        throw new Error(`Cannot find binding: '${arg.value}'`);
      }

      path = await this.resolver.unresolve(path);

      return [node, await this.require(path, flag)];
    }

    if (this.isResolve(node)) {
      this.warning('cannot handle resolve call: %s',
                   code.substring(node.start, node.end));
      return null;
    }

    if (this.isResolvePaths(node)) {
      this.warning('cannot handle resolve.paths call: %s',
                   code.substring(node.start, node.end));
      return null;
    }

    if (this.bundle.env === 'browser') {
      // Don't allow Buffer.isBuffer to
      // trigger requiring the buffer module.
      if (this.isBufferCheck(node)) {
        const arg = node.arguments[0];

        if (!arg || arg.type === 'Literal')
          return [node, '(false)'];

        const obj = code.substring(arg.start, arg.end);
        const out = `(${obj} != null && ${obj}._isBuffer === true)`;

        return [node, out];
      }
    }

    return null;
  }

  async Identifier(node) {
    switch (node.name) {
      case 'setTimeout':
      case 'clearTimeout':
      case 'setInterval':
      case 'clearInterval':
      case 'setImmediate':
      case 'clearImmediate':
        this.bundle.hasTimers = true;
        break;
      case 'queueMicrotask':
        this.bundle.hasMicrotask = true;
        break;
      case 'process':
        this.bundle.hasProcess = true;
        break;
      case 'Buffer':
        this.bundle.hasBuffer = true;
        break;
      case 'console':
        this.bundle.hasConsole = true;
        break;
    }

    return null;
  }
}

/*
 * Helpers
 */

function isImportType(flag) {
  if (typeof flag !== 'number')
    return false;

  if ((flag >>> 0) !== flag)
    return false;

  return flag <= importTypes.IMPORT_EXPR;
}

async function findBuildFile(root) {
  root = resolve(root);

  for (;;) {
    if (basename(root) === 'node_modules')
      break;

    const files = [
      join(root, 'binding.gyp'),
      join(root, 'CMakeLists.txt')
    ];

    for (const file of files) {
      if (await fs.exists(file))
        return file;
    }

    const next = dirname(root);

    if (next === root)
      break;

    root = next;
  }

  return null;
}

/*
 * Expose
 */

module.exports = Linker;
