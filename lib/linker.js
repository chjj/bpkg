/*!
 * linker.js - linker for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const scope = require('./analyze/scope');
const cmake = require('./cmake');
const bindings = require('./bindings');
const builtins = require('./builtins');
const gyp = require('./gyp');
const utils = require('./utils');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep
} = path;

const {
  getIdent,
  getString,
  isAccess,
  isString,
  isTopLevel,
  string
} = utils;

/*
 * Constants
 */

const importTypes = {
  REQUIRE: 0,
  IMPORT: 1,
  IMPORT_AWAIT: 2, // Non-toplevel `await import()`.
  IMPORT_EXPR: 3
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
    this.globalRefs = new Set();
    this.hasBindings = false;
    this.hasLoady = false;
    this.hasCmake = false;
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
      if (module.isAsync())
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

  makeRawRequire(specifier, flag, attrs = null) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));
    assert(attrs == null || typeof attrs === 'string');

    if (flag === importTypes.REQUIRE) {
      if (this.bundle.env === 'browser')
        return this.makeError(specifier, flag);

      return `require(${string(specifier)})`;
    }

    if (flag === importTypes.IMPORT_EXPR) {
      if (attrs != null)
        return `import(${string(specifier)}, ${attrs})`;
      return `import(${string(specifier)})`;
    }

    if (this.bundle.target !== 'esm' && flag === importTypes.IMPORT) {
      this.warning('cannot import module: %s.', specifier);
      return this.makeError(specifier, flag);
    }

    if (attrs != null)
      return `await import(${string(specifier)}, ${attrs})`;

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

    const root = this.module.parse(code);

    this.globalRefs = scope.analyze(root).globalRefs;

    const out = await this.module._replace(root, code, this, {
      AwaitExpression: this.AwaitExpression,
      ImportExpression: this.ImportExpression,
      CallExpression: this.CallExpression,
      MemberExpression: this.MemberExpression,
      Identifier: this.Identifier
    });

    return out;
  }

  async require(specifier, flag, attrs = null) {
    assert(typeof specifier === 'string');
    assert(isImportType(flag));
    assert(attrs == null || typeof attrs === 'string');

    const isImport = flag !== importTypes.REQUIRE;

    if (specifier === 'bindings')
      this.hasBindings = true;
    else if (specifier === 'loady')
      this.hasLoady = true;
    else if (specifier === 'cmake-node')
      this.hasCmake = true;

    if (this.resolver.isExternal(specifier, isImport)) {
      this.warning('ignoring external module: %s.', specifier);
      return this.makeRawRequire(specifier, flag, attrs);
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

      return this.makeRawRequire(specifier, flag, attrs);
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

    if (!isString(node.arguments[0])) {
      this.warning('cannot resolve dynamic require: %s',
                   code.substring(node.start, node.end));
      return false;
    }

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

    if (!isString(node.source)) {
      this.warning('cannot resolve dynamic import: %s',
                   code.substring(node.start, node.end));
      return false;
    }

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

    const childArg = getString(child.arguments[0]);

    if (childArg !== 'bindings' && childArg !== 'loady')
      return false;

    if (node.arguments.length < 1)
      return false;

    if (!isString(node.arguments[0])) {
      this.warning('cannot resolve dynamic bindings: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    return true;
  }

  isMemberBindings(node, code) {
    // e.g.
    // require('cmake-node').load('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
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

    const childArg = getString(child.arguments[0]);

    if (childArg !== 'cmake-node')
      return false;

    if (node.callee.computed) {
      if (getString(node.callee.property) !== 'load')
        return false;
    } else {
      if (node.callee.property.type !== 'Identifier')
        return false;

      if (node.callee.property.name !== 'load')
        return false;
    }

    if (node.arguments.length < 1)
      return false;

    if (!isString(node.arguments[0])) {
      this.warning('cannot resolve dynamic bindings: %s',
                   code.substring(node.start, node.end));
      return false;
    }

    return true;
  }

  isModuleBindings(node, code) {
    // e.g.
    // import bindings from 'bindings';
    // bindings('foo')
    if (node.type !== 'CallExpression')
      return false;

    if ((this.hasBindings && getIdent(node.callee) === 'bindings') ||
        (this.hasLoady && getIdent(node.callee) === 'loady') ||
        (this.hasCmake && isAccess(node.callee, 'cmake', 'load'))) {
      if (node.arguments.length < 1)
        return false;

      if (!isString(node.arguments[0])) {
        this.warning('cannot resolve dynamic bindings: %s',
                     code.substring(node.start, node.end));
        return false;
      }

      return true;
    }

    return false;
  }

  isResolve(node) {
    // e.g.
    // require.resolve('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (!isAccess(node.callee, 'require', 'resolve'))
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

    const callee = node.callee;

    if (!isAccess(callee.object, 'require', 'resolve'))
      return false;

    if (callee.computed) {
      if (getString(callee.property) !== 'paths')
        return false;
    } else {
      if (callee.property.type !== 'Identifier')
        return false;

      if (callee.property.name !== 'paths')
        return false;
    }

    if (node.arguments.length < 1)
      return false;

    return true;
  }

  isBufferCheck(node) {
    // e.g.
    // Buffer.isBuffer(obj)
    if (node.type !== 'CallExpression')
      return false;

    if (!isAccess(node.callee, 'Buffer', 'isBuffer'))
      return false;

    if (node.arguments.length > 1)
      return false;

    if (!this.globalRefs.has(node.callee.object))
      return false;

    return true;
  }

  isProcessBrowser(node) {
    // process.browser
    if (!isAccess(node, 'process', 'browser'))
      return false;

    if (!this.globalRefs.has(node.object))
      return false;

    return true;
  }

  isProcessPlatform(node) {
    // process.platform
    if (!isAccess(node, 'process', 'platform'))
      return false;

    if (!this.globalRefs.has(node.object))
      return false;

    return true;
  }

  isProcessCwd(node) {
    // process.cwd()
    if (node.type !== 'CallExpression')
      return false;

    if (!isAccess(node.callee, 'process', 'cwd'))
      return false;

    if (node.arguments.length !== 0)
      return false;

    if (!this.globalRefs.has(node.callee.object))
      return false;

    return true;
  }

  async AwaitExpression(node, code, ancestors) {
    // await import(path)
    if (!this.isImportExpression(node.argument, code))
      return null;

    const arg = getString(node.argument.source);
    const attrs = maybeSlice(node.argument.options, code);

    if (!isTopLevel(ancestors))
      return [node, await this.require(arg, importTypes.IMPORT_AWAIT, attrs)];

    return [node, await this.require(arg, importTypes.IMPORT, attrs)];
  }

  async ImportExpression(node, code) {
    // import(path).then(...);
    if (!this.isImportExpression(node, code))
      return null;

    const arg = getString(node.source);
    const attrs = maybeSlice(node.options, code);

    return [node, await this.require(arg, importTypes.IMPORT_EXPR, attrs)];
  }

  async CallExpression(node, code) {
    if (this.isRequire(node, code)) {
      const arg = getString(node.arguments[0]);
      return [node, await this.require(arg, importTypes.REQUIRE)];
    }

    if (this.isImport(node, code)) {
      const arg = getString(node.arguments[0]);
      const attrs = maybeSlice(node.arguments[1], code);
      return [node, await this.require(arg, importTypes.IMPORT, attrs)];
    }

    if (this.isBindings(node, code)) {
      const arg = getString(node.arguments[0]);
      const flag = importTypes.REQUIRE;

      if (this.bundle.env === 'browser')
        return [node, this.makeError(arg, flag)];

      if (this.bundle.ignoreBindings) {
        this.warning('ignoring binding: %s.', arg);
        return [node, this.makeError(arg, flag)];
      }

      let path = await this.tryBinding(arg);

      if (!path) {
        if (this.bundle.ignoreMissing) {
          this.warning('ignoring missing binding: %s.', arg);
          return [node, this.makeError(arg, flag)];
        }
        throw new Error(`Cannot find binding: '${arg}'`);
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
        if (node.arguments.length === 0)
          return [node, '(false)'];

        const arg = node.arguments[0];
        const obj = code.substring(arg.start, arg.end);

        this.bundle.hasIsBuffer = true;

        return [node, `__is_buffer__(${obj})`];
      }

      if (this.isProcessCwd(node))
        return [node, string('/')];
    }

    return null;
  }

  async MemberExpression(node, code, ancestors, override) {
    if (override !== 'Expression')
      return null;

    if (this.bundle.env === 'browser') {
      if (this.isProcessBrowser(node))
        return [node, '(true)'];

      if (this.isProcessPlatform(node))
        return [node, string('browser')];
    }

    return null;
  }

  async Identifier(node, code, ancestors, override) {
    if (override !== 'Expression')
      return null;

    if (!this.globalRefs.has(node))
      return null;

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

function maybeSlice(node, code) {
  if (!node)
    return null;

  return code.substring(node.start, node.end);
}

/*
 * Expose
 */

module.exports = Linker;
