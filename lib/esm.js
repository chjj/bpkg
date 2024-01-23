/*!
 * esm.js - esm implementation for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const esm = require('./analyze/esm');
const scope = require('./analyze/scope');
const utils = require('./utils');
const {dot, getIdents, getName, string} = utils;

/**
 * ESM
 */

class ESM {
  constructor(module) {
    this.module = module;
    this.bundle = module.bundle;
    this.filename = module.filename;
    this.resolver = module.resolver;
    this.hasMeta = false;
    this.hasFlag = false;
    this.consts = new Set();
    this.exports = new Set();
    this.constExports = new Set();
    this.suspectedEsModule = false;
    this.children = new Map();
    this.scope = {
      vars: new Map(),
      imports: new Map()
    };
    this.tmp = 0;
  }

  warning(...args) {
    this.module.warning(...args);
  }

  async isRealImport(specifier) {
    assert(typeof specifier === 'string');

    if (!this.bundle.isAsync)
      return false;

    if (this.resolver.isExternal(specifier, true))
      return true;

    if (this.bundle.env === 'browser')
      return false;

    if (this.bundle.ignoreMissing) {
      if (!await this.module.tryResolve(specifier, true))
        return true;
    }

    return false;
  }

  async needsStarWrapper(specifier) {
    if (await this.isRealImport(specifier))
      return false;

    const path = await this.module.tryResolve(specifier, true);

    if (!path)
      return false; // Just an error.

    const format = await this.resolver.format(path);

    if (format === 'builtin')
      return false;

    return format !== 'module' && format !== 'wasm';
  }

  makeRequire(specifier) {
    return `__esm_import__(${string(specifier)})`;
  }

  makeStrict() {
    return '\'use strict\';\n\n';
  }

  makeTempName(name) {
    return `__bpkg_${name}_${this.tmp++}__`;
  }

  makeVar(name, value) {
    return `var ${name} = ${value};\n`;
  }

  async makeDefault(name, source) {
    if (await this.isRealImport(source)) {
      // From a real import() call.
      return `${name}['default']`;
    }

    const path = await this.module.tryResolve(source, true);

    if (!path)
      return `${name}`; // Just an error.

    switch (await this.resolver.format(path)) {
      case 'addon':
      case 'builtin':
      case 'json': {
        return `${name}`;
      }
      case 'module':
      case 'wasm': {
        return `${name}['default']`;
      }
      case 'commonjs': {
        const snapshot = await this.analyzeModule(source);
        if (snapshot.suspectedEsModule === false)
          return `${name}`;
        break;
      }
    }

    this.bundle.hasImportDefault = true;

    // From required compiled module.
    return `__esm_default__(${name})`;
  }

  async isSafe(source) {
    // Safer version of `cannotRecurse`. Ensures:
    //   1. Modules cannot recurse.
    //   2. Modules do not have any dynamic exports (getters).
    if (this.bundle.loose)
      return true;

    if (await this.isRealImport(source)) {
      // From a real import() call.
      return false;
    }

    const path = await this.module.tryResolve(source, true);

    if (!path)
      return true; // Just an error.

    switch (await this.resolver.format(path)) {
      case 'addon':
      case 'builtin':
      case 'json': {
        return true;
      }
      case 'commonjs': {
        const snapshot = await this.analyzeModule(source);
        return snapshot.suspectedEsModule === false;
      }
    }

    return false;
  }

  async cannotRecurse(source) {
    // Ensures module cannot recurse.
    if (this.bundle.loose)
      return true;

    if (await this.isRealImport(source)) {
      // From a real import() call.
      return true;
    }

    const path = await this.module.tryResolve(source, true);

    if (!path)
      return true; // Just an error.

    switch (await this.resolver.format(path)) {
      case 'module':
      case 'wasm':
        return false;
    }

    return true;
  }

  makeESMFlag() {
    if (this.hasFlag)
      return '';

    this.hasFlag = true;

    if (this.bundle.loose)
      return '__exports.__esModule = true;\n';

    this.bundle.hasSetFlag = true;

    return '__esm_set_flag__(__exports);\n';
  }

  makeAssign(key, value) {
    return `__exports${dot(key)} = ${value};\n`;
  }

  _makeExpose(key, value) {
    if (this.bundle.loose)
      return this.makeAssign(key, value);

    this.bundle.hasExpose = true;

    const expr = `function() { return ${value}; }`;

    return `__esm_expose__(__exports, ${string(key)}, ${expr});\n`;
  }

  makeExpose(key, value) {
    if (this.constExports.has(key))
      return this.makeAssign(key, value);

    return this._makeExpose(key, value);
  }

  maybeExpose(key, value) {
    if (this.consts.has(value))
      return this.makeAssign(key, value);

    return this._makeExpose(key, value);
  }

  makeProxy(dkey, src, skey, safe) {
    const dst = '__exports';

    if (this.bundle.loose || this.constExports.has(dkey))
      return this.makeAssign(dkey, `${src}${dot(skey)}`);

    if (!safe)
      return this._makeExpose(dkey, `${src}${dot(skey)}`);

    if (skey === dkey) {
      this.bundle.hasProxy = true;
      return `__esm_proxy__(${dst}, ${src}, ${string(skey)});\n`;
    }

    const dk = string(dkey);
    const sk = string(skey);

    this.bundle.hasAssign = true;

    return `__esm_assign__(${dst}, ${dk}, ${src}, ${sk});\n`;
  }

  makeImportStar(src) {
    this.bundle.hasImportStar = true;
    return `__esm_import_star__(${src})`;
  }

  makeExportStar(src) {
    this.bundle.hasExportStar = true;
    return `__esm_export_star__(__exports, ${src})`;
  }

  makeExports() {
    const exports = this.exports;
    const env = this.bundle.env;
    const expr = this.module.linker.makeRequire0();

    if (this.bundle.target !== 'esm')
      return expr + ';';

    if (!this.module.isModule())
      return `export default ${expr};`;

    if (this.exports.size === 0)
      return expr + ';';

    const default_ = exports.has('default');
    const size = exports.size - Number(default_);
    const keys = [];

    if (size === 0) {
      assert(default_);
      return `export default (${expr})['default'];\n`;
    }

    let name = expr;
    let out = '';

    if (default_) {
      name = `__${env}_main__`;
      out += `var ${name} = ${expr};\n\n`;
    }

    out += 'export const {\n';

    for (const key of exports) {
      if (key !== 'default')
        keys.push(`  ${key}`);
    }

    out += keys.join(',\n') + '\n';
    out += `} = ${name};\n`;

    if (default_) {
      out += '\n';
      out += `export default ${name}['default'];\n`;
    }

    return out;
  }

  async getExports(specifier) {
    const snapshot = await this.analyzeModule(specifier);
    const {format} = snapshot;

    if (format !== 'module' && format !== 'wasm')
      return null;

    return snapshot;
  }

  async analyzeModule(specifier) {
    assert(typeof specifier === 'string');

    if (await this.isRealImport(specifier)) {
      // From a real import() call.
      return Snapshot.TRUE;
    }

    if (this.resolver.isExternal(specifier, true))
      return Snapshot.FALSE; // Just an error.

    if (this.bundle.env === 'browser') {
      if (specifier === 'bindings' ||
          specifier === 'loady' ||
          specifier === 'cmake-node' ||
          specifier === 'node-gyp-build') {
        return Snapshot.FALSE; // Just an error.
      }
    }

    const path = await this.module.tryResolve(specifier, true);

    if (!path)
      return Snapshot.FALSE; // Just an error.

    if (this.children.has(path))
      return this.children.get(path);

    if (path === this.filename) {
      const file = this.module.relative;
      throw new Error(`Cannot import self (${file}).`);
    }

    const format = await this.resolver.format(path);

    if (format === 'addon') {
      const file = this.module.relative;
      throw new Error(`Cannot import addon (${file}).`);
    }

    if (format === 'builtin')
      return Snapshot.FALSE;

    const module = await this.bundle.analyzeModule(path);
    const snapshot = Snapshot.fromModule(module);

    this.children.set(path, snapshot);

    return snapshot;
  }

  async analyze(root) {
    assert(root && root.type === 'Program');
    assert(this.module.format === 'module');

    scope.analyze(root, {
      consts: this.consts,
      exports: this.exports
    });

    for (const node of root.body) {
      switch (node.type) {
        case 'ImportDeclaration': {
          const source = node.source.value;
          const safe = await this.isSafe(source);
          const snapshot = await this.analyzeModule(source);

          for (const {type, imported, local} of node.specifiers) {
            switch (type) {
              case 'ImportNamespaceSpecifier': {
                this.consts.add(local.name);
                break;
              }

              case 'ImportDefaultSpecifier': {
                if (safe || snapshot.constExports.has('default'))
                  this.consts.add(local.name);
                break;
              }

              case 'ImportSpecifier': {
                const importedName = getName(imported);

                if (safe || snapshot.constExports.has(importedName))
                  this.consts.add(local.name);

                break;
              }

              default: {
                throw new Error(`Unexpected token: ${type}.`);
              }
            }
          }

          break;
        }

        case 'ExportAllDeclaration': {
          const source = node.source.value;
          const snapshot = await this.analyzeModule(source);
          const {excluded} = snapshot;

          if (node.exported) {
            // export * as foo from 'module';
            const exportedName = getName(node.exported);

            this.exports.add(exportedName);
            this.constExports.add(exportedName);
          } else {
            // export * from 'foo';
            for (const key of snapshot.exports) {
              if (key !== 'default' && !this.exports.has(key))
                this.exports.add(key);
              else
                excluded.add(key);
            }

            for (const key of snapshot.constExports) {
              if (key !== 'default' && !excluded.has(key))
                this.constExports.add(key);
            }
          }

          break;
        }

        case 'ExportDefaultDeclaration': {
          // export default foo;
          this.exports.add('default');
          this.constExports.add('default');
          break;
        }

        case 'ExportNamedDeclaration': {
          if (node.declaration) {
            // export [statement];
            const decl = node.declaration;

            switch (decl.type) {
              case 'VariableDeclaration': {
                // export var/let foo;
                // export var/let/const foo = 1;
                // export var/let/const {foo} = {};
                // export var/let/const [foo] = [];
                for (const key of getIdents(decl)) {
                  this.exports.add(key);

                  if (this.consts.has(key))
                    this.constExports.add(key);
                  else
                    this.constExports.delete(key);
                }

                break;
              }

              case 'FunctionDeclaration':
              case 'ClassDeclaration': {
                // export function foo() {}
                // export class foo {}
                this.exports.add(decl.id.name);

                if (this.consts.has(decl.id.name))
                  this.constExports.add(decl.id.name);
                else
                  this.constExports.delete(decl.id.name);

                break;
              }

              default: {
                throw new Error(`Unexpected token: ${decl.type}.`);
              }
            }

            break;
          }

          if (node.source) {
            // export { foo as bar } from 'module';
            const source = node.source.value;
            const safe = await this.isSafe(source);
            const snapshot = await this.analyzeModule(source);

            for (const {local, exported} of node.specifiers) {
              const localName = getName(local);
              const exportedName = getName(exported);

              this.exports.add(exportedName);

              if (safe || snapshot.constExports.has(localName))
                this.constExports.add(exportedName);
              else
                this.constExports.delete(exportedName);
            }
          } else {
            // export { foo as bar };
            for (const {local, exported} of node.specifiers) {
              const exportedName = getName(exported);

              this.exports.add(exportedName);

              if (this.consts.has(local.name))
                this.constExports.add(exportedName);
              else
                this.constExports.delete(exportedName);
            }
          }

          break;
        }
      }
    }
  }

  async transform(root, code) {
    assert(root && root.type === 'Program');
    assert(typeof code === 'string');

    if (this.module.format !== 'module')
      return code;

    if (!this.bundle.isAsync && esm.hasTLA(root)) {
      const file = this.module.relative;
      throw new Error(`Top-level await without async output (${file}).`);
    }

    let out = await this.module._replace(root, code, this, {
      CallExpression: this.CallExpression,
      ExportAllDeclaration: this.ExportAllDeclaration,
      ExportDefaultDeclaration: this.ExportDefaultDeclaration,
      ExportNamedDeclaration: this.ExportNamedDeclaration,
      ImportDeclaration: this.ImportDeclaration,
      MetaProperty: this.MetaProperty
    });

    if (!this.bundle.loose) {
      root = this.module.parse(out);
      out = scope.replace(root, out, this.scope);
    }

    if (this.bundle.target !== 'esm' && !esm.hasStrict(root))
      return this.makeStrict() + out;

    return out;
  }

  isMetaResolve(node) {
    // e.g.
    // import.meta.resolve('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'MemberExpression')
      return false;

    if (node.callee.computed)
      return false;

    const {object, property} = node.callee;

    if (object.type !== 'MetaProperty')
      return false;

    if (object.meta.name !== 'import')
      return false;

    if (object.property.name !== 'meta')
      return false;

    if (property.type !== 'Identifier')
      return false;

    if (property.name !== 'resolve')
      return false;

    if (node.arguments.length < 1)
      return false;

    return true;
  }

  async CallExpression(node, code) {
    if (this.isMetaResolve(node)) {
      this.warning('cannot handle resolve call: %s',
                   code.substring(node.start, node.end));
      return null;
    }

    return null;
  }

  async ExportAllDeclaration(node, code) {
    const source = node.source.value;

    let out = this.makeESMFlag();

    if (node.exported) {
      // export * as foo from 'module';
      const exportedName = getName(node.exported);
      const expr = this.makeRequire(source);

      if (await this.needsStarWrapper(source))
        out += this.makeAssign(exportedName, this.makeImportStar(expr));
      else
        out += this.makeAssign(exportedName, expr);

      return [node, out];
    }

    // export * from 'foo';
    const snapshot = await this.getExports(source);

    if (snapshot) {
      const {exports, excluded} = snapshot;
      const safe = await this.cannotRecurse(source);
      const name = this.makeTempName('export');

      out += this.makeVar(name, this.makeRequire(source));

      for (const key of exports) {
        if (key !== 'default' && !excluded.has(key))
          out += this.makeProxy(key, name, key, safe);
      }
    } else {
      out += this.makeExportStar(this.makeRequire(source));
    }

    return [node, out];
  }

  async ExportDefaultDeclaration(node, code) {
    // export default foo;
    const decl = node.declaration;
    const {start, end} = decl;

    let out = this.makeESMFlag();

    switch (decl.type) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (decl.id) {
          out += code.substring(start, end) + '\n';
          out += this.makeAssign('default', decl.id.name);
          break;
        }
        // fallthrough
      default:
        out += this.makeAssign('default', code.substring(start, end));
        break;
    }

    return [node, out];
  }

  async ExportNamedDeclaration(node, code) {
    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;

      let out = this.makeESMFlag();

      switch (decl.type) {
        case 'VariableDeclaration': {
          // export var/let foo;
          // export var/let/const foo = 1;
          // export var/let/const {foo} = {};
          // export var/let/const [foo] = [];
          const {kind, start, end} = decl;
          const expr = code.substring(start, end);

          out += expr + '\n';

          for (const key of getIdents(decl)) {
            if (kind === 'const')
              assert(this.consts.has(key));

            out += this.maybeExpose(key, key);
          }

          break;
        }

        case 'FunctionDeclaration':
        case 'ClassDeclaration': {
          // export function foo() {}
          // export class foo {}
          const {id, start, end} = decl;
          const expr = code.substring(start, end);

          out += expr + '\n';
          out += this.maybeExpose(id.name, id.name);

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${decl.type}.`);
        }
      }

      return [node, out];
    }

    let out = this.makeESMFlag();

    if (node.source) {
      // export { foo as bar } from 'module';
      const source = node.source.value;
      const safe = await this.cannotRecurse(source);
      const name = this.makeTempName('export');

      out += this.makeVar(name, this.makeRequire(source));

      for (const {local, exported} of node.specifiers) {
        const localName = getName(local);
        const exportedName = getName(exported);

        if (localName === 'default') {
          const expr = await this.makeDefault(name, source);
          out += this.makeExpose(exportedName, expr);
        } else {
          out += this.makeProxy(exportedName, name, localName, safe);
        }
      }
    } else {
      // export { foo as bar };
      for (const {local, exported} of node.specifiers) {
        const exportedName = getName(exported);

        out += this.maybeExpose(exportedName, local.name);
      }
    }

    return [node, out];
  }

  async ImportDeclaration(node, code) {
    const source = node.source.value;

    let out = '';

    if (node.specifiers.length === 0) {
      // import 'module';
      out += this.makeRequire(source) + ';\n';
      return [node, out];
    }

    const name = this.makeTempName('import');

    out += this.makeVar(name, this.makeRequire(source));

    for (const {type, imported, local} of node.specifiers) {
      switch (type) {
        case 'ImportNamespaceSpecifier': {
          // import * as foo from 'module';
          if (await this.needsStarWrapper(source))
            out += this.makeVar(local.name, this.makeImportStar(name));
          else
            out += this.makeVar(local.name, name);

          break;
        }

        case 'ImportDefaultSpecifier': {
          // import foo from 'module';
          const expr = await this.makeDefault(name, source);

          if (this.bundle.loose || this.consts.has(local.name)) {
            out += this.makeVar(local.name, expr);
          } else {
            this.scope.vars.set(local.name, 'default');
            this.scope.imports.set(local.name, expr);
          }

          break;
        }

        case 'ImportSpecifier': {
          // import { bar as foo } from 'module';
          const importedName = getName(imported);
          const expr = `${name}${dot(importedName)}`;

          if (this.bundle.loose || this.consts.has(local.name)) {
            out += this.makeVar(local.name, expr);
          } else {
            this.scope.vars.set(local.name, 'import');
            this.scope.imports.set(local.name, expr);
          }

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${type}.`);
        }
      }
    }

    return [node, out];
  }

  async MetaProperty(node) {
    // import.meta;
    if (node.meta.name !== 'import')
      return null;

    if (node.property.name !== 'meta')
      return null;

    this.hasMeta = true;
    this.bundle.hasMeta = true;

    return [node, '__meta'];
  }
}

/**
 * Snapshot
 */

class Snapshot {
  constructor() {
    this.format = null;
    this.exports = null;
    this.excluded = null;
    this.constExports = null;
    this.suspectedEsModule = false;
  }

  fromBool(value) {
    this.format = null;
    this.exports = new Set();
    this.excluded = new Set();
    this.constExports = new Set();
    this.suspectedEsModule = value;
    return this;
  }

  fromModule(module) {
    this.format = module.format;
    this.exports = new Set([...module.esm.exports]);
    this.excluded = new Set();
    this.constExports = new Set([...module.esm.constExports]);
    this.suspectedEsModule = module.esm.suspectedEsModule;
    return this;
  }

  static fromBool(value) {
    return new this().fromBool(value);
  }

  static fromModule(module) {
    return new this().fromModule(module);
  }
}

Snapshot.TRUE = Snapshot.fromBool(true);
Snapshot.FALSE = Snapshot.fromBool(false);

/*
 * Expose
 */

module.exports = ESM;
