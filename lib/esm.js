/*!
 * esm.js - esm implementation for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const builtin = require('./analyze/builtin');
const cjs = require('./analyze/cjs');
const esm = require('./analyze/esm');
const builtins = require('./builtins');
const utils = require('./utils');
const {string} = utils;

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
    this.exports = new Map();
    this.tmp = 0;
  }

  warning(...args) {
    this.module.warning(...args);
  }

  async isRealImport(specifier, expr = false) {
    assert(typeof specifier === 'string');
    assert(typeof expr === 'boolean');

    if (!expr && this.bundle.target !== 'esm')
      return false;

    if (this.resolver.isExternal(specifier, true))
      return true;

    if (this.bundle.env === 'browser')
      return false;

    if (this.bundle.ignoreMissing) {
      try {
        await this.resolver.resolve(specifier, true);
      } catch (e) {
        return true;
      }
    }

    return false;
  }

  makeRequire(specifier) {
    return `__esm_import__(${string(specifier)})`;
  }

  makeStrict() {
    return '\'use strict\';\n\n';
  }

  makeMeta() {
    let out = '';

    out += 'var __meta_filename = process.platform === \'win32\'\n';
    out += '  ? \'/\' + __filename.replace(/\\\\/g, \'/\')\n';
    out += '  : __filename;\n';
    out += '\n';
    out += 'var __meta_url = \'file://\' + encodeURI(__meta_filename);\n';
    out += '\n';
    out += 'var __meta = {\n';
    out += '  __proto__: null,\n';
    out += '  url: __meta_url,\n';
    out += '  filename: __filename,\n';
    out += '  dirname: __dirname,\n';
    out += '  resolve: require.resolve\n';
    out += '};\n';
    out += '\n';

    return out;
  }

  makeTempName(name) {
    return `__bpkg_${name}_${this.tmp++}__`;
  }

  makeVar(name, value) {
    return `var ${name} = ${value};\n`;
  }

  async makeDefault(name, source) {
    if (await this.isRealImport(source)) {
      // From real import() call.
      return `${name}['default']`;
    }

    // From required compiled module.
    return `${name}.__esModule ? ${name}['default'] : ${name}`;
  }

  makeESMFlag() {
    if (this.hasFlag)
      return '';

    this.hasFlag = true;

    if (this.bundle.loose)
      return '__exports.__esModule = true;\n';

    // eslint-disable-next-line max-len
    return 'Object.defineProperty(__exports, \'__esModule\', { value: true });\n';
  }

  makeProxy(key, target, prop) {
    const k = string(key);
    const p = string(prop);

    if (this.bundle.loose)
      return `__exports[${k}] = ${target}[${p}];\n`;

    return `Object.defineProperty(__exports, ${k}, \n`
         + `  Object.getOwnPropertyDescriptor(${target}, ${p}));\n`;
  }

  makeExpose(key, value) {
    if (this.bundle.loose)
      return `__exports[${string(key)}] = ${value};\n`;

    return `Object.defineProperty(__exports, ${string(key)}, {\n`
         + '  configurable: true,\n'
         + '  enumerable: true,\n'
         + `  get: function() { return ${value}; }\n`
         + '});\n';
  }

  makeAssign(key, value) {
    return `__exports[${string(key)}] = ${value};\n`;
  }

  makeExports() {
    const exports = this.exports;
    const env = this.bundle.env;
    const expr = this.module.linker.makeRequire0();

    if (this.bundle.target !== 'esm')
      return expr + ';';

    if (this.exports.size === 0)
      return expr + ';';

    const isModule = this.module.format === 'module';
    const default_ = exports.has('default');
    const size = exports.size - Number(default_);

    let name = expr;
    let out = '';
    let i = 0;

    if (size === 0 && default_ && isModule)
      name = `(${expr})`;

    if (size > 0) {
      if (default_ || !isModule) {
        name = `__${env}_main__`;
        out += `var ${name} = ${expr};\n\n`;
      }

      out += 'export const {\n';

      for (const key of exports.keys()) {
        if (key === 'default')
          continue;

        out += `  ${key}`;

        if (i !== size - 1)
          out += ',';

        out += '\n';
        i += 1;
      }

      out += `} = ${name};\n\n`;
    }

    if (!isModule)
      out += `export default ${name};\n`;
    else if (default_)
      out += `export default ${name}['default'];\n`;

    return out;
  }

  async getExports(specifier) {
    assert(typeof specifier === 'string');

    let path;

    try {
      path = await this.resolver.resolve(specifier, true);
    } catch (e) {
      return new Map();
    }

    const format = await this.resolver.format(path);

    if (format === 'commonjs' || format === 'module') {
      if (path === this.filename)
        return new Map();

      return this.bundle.getExports(path);
    }

    if (format === 'wasm')
      return this.bundle.getExports(path);

    if (format !== 'builtin')
      return new Map();

    if (this.bundle.env === 'browser') {
      path = builtins[path];

      if (!path)
        return new Map();

      return cjs.getExports(path);
    }

    return builtin.getExports(path);
  }

  async analyzeModule(path) {
    const format = await this.resolver.format(path);

    if (format === 'commonjs' || format === 'module') {
      if (path === this.filename)
        return null;

      return this.bundle.analyzeModule(path);
    }

    if (format === 'wasm')
      return this.bundle.analyzeModule(path);

    return null;
  }

  async analyze(root) {
    assert(root && root.type === 'Program');

    const isImport = this.module.format === 'module';
    const backend = isImport ? esm : cjs;
    const {exports, reexports} = backend.analyze(root);

    for (const [name, desc] of exports) {
      this.exports.set(name, null);

      if (!desc)
        continue;

      const [imported, source] = desc;

      if (this.resolver.isExternal(source, isImport))
        continue;

      let path;

      try {
        path = await this.resolver.resolve(source, isImport);
      } catch (e) {
        continue;
      }

      this.exports.set(name, [imported, path]);
    }

    for (const source of reexports) {
      const resolved = await this.getExports(source);

      for (const [key, value] of resolved) {
        if (!this.exports.has(key))
          this.exports.set(key, value);
      }
    }
  }

  async transform(root, code) {
    assert(root && root.type === 'Program');
    assert(typeof code === 'string');

    if (this.module.format !== 'module') {
      if (this.bundle.target === 'esm') {
        return this.module._replace(root, code, this, {
          Literal: this.Literal
        });
      }
      return code;
    }

    const out = await this.module._replace(root, code, this, {
      AwaitExpression: this.bundle.target !== 'esm'
                     ? this.AwaitExpression
                     : null,
      CallExpression: this.CallExpression,
      ExportAllDeclaration: this.ExportAllDeclaration,
      ExportDefaultDeclaration: this.ExportDefaultDeclaration,
      ExportNamedDeclaration: this.ExportNamedDeclaration,
      ImportDeclaration: this.ImportDeclaration,
      MetaProperty: this.MetaProperty
    });

    if (this.bundle.target !== 'esm')
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

    if (node.callee.object.type !== 'MetaProperty')
      return false;

    if (node.callee.property.type !== 'Identifier')
      return false;

    if (node.callee.property.name !== 'resolve')
      return false;

    if (node.arguments.length < 1)
      return false;

    return true;
  }

  async AwaitExpression(node, code, ancestors) {
    assert(this.module.format === 'module');
    assert(this.bundle.target !== 'esm');

    // Exclude `await import('./module.js')`.
    if (node.argument.type === 'ImportExpression') {
      const arg = node.argument.source;

      if (arg.type === 'Literal' && typeof arg.value === 'string') {
        if (!await this.isRealImport(arg.value, true))
          return null;
      }
    }

    for (let i = ancestors.length - 1; i >= 0; i--) {
      const node = ancestors[i];

      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'MethodDefinition':
          return null;
      }
    }

    const file = this.module.relative;

    throw new Error(`Top-level await without ESM output (${file}).`);
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

    if (node.source.type !== 'Literal' ||
        typeof node.source.value !== 'string') {
      throw new Error(`Unexpected token: ${node.source.type}.`);
    }

    let out = '';

    out += this.makeESMFlag();

    if (node.exported) {
      // export * as foo from 'module';
      const {exported} = node;

      if (exported.type !== 'Identifier')
        throw new Error(`Unexpected token: ${exported.type}.`);

      out += this.makeAssign(exported.name, this.makeRequire(source));

      return [node, out];
    }

    // export * from 'foo';
    const exports = await this.getExports(source);
    const name = this.makeTempName('export');

    out += this.makeVar(name, this.makeRequire(source));

    for (const key of exports.keys()) {
      if (key === 'default')
        continue;

      out += this.makeProxy(key, name, key);
    }

    return [node, out];
  }

  async ExportDefaultDeclaration(node, code) {
    // export default foo;
    const {type, id, start, end} = node.declaration;

    let out = '';
    let exposed = false;

    switch (type) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        exposed = true;
        break;
    }

    out += this.makeESMFlag();

    if (exposed && id && id.name) {
      out += code.substring(start, end) + '\n';
      out += this.makeAssign('default', id.name);
    } else {
      out += this.makeAssign('default', code.substring(start, end));
    }

    return [node, out];
  }

  async ExportNamedDeclaration(node, code) {
    const defines = [];
    const declarations = [];
    const exports = [];

    let source = null;
    let out = '';

    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;
      const {type, id, start, end} = decl;

      switch (type) {
        case 'VariableDeclaration': {
          // export var/let/const foo = 1;
          for (const {id, init} of decl.declarations) {
            const {start, end} = init;

            if (id.type === 'ArrayPattern') {
              const name = this.makeTempName('var');

              defines.push([name, code.substring(start, end)]);

              for (let i = 0; i < id.elements.length; i++) {
                const el = id.elements[i];

                if (!el)
                  continue;

                if (el.type !== 'Identifier')
                  throw new Error(`Unexpected token: ${type}.`);

                declarations.push([el.name, `${name}[${i}]`, 1]);
              }

              continue;
            }

            if (id.type === 'ObjectPattern') {
              const name = this.makeTempName('var');

              defines.push([name, code.substring(start, end)]);

              for (const {key, value} of id.properties) {
                if (key.type !== 'Identifier' && key.type !== 'Literal')
                  throw new Error(`Unexpected token: ${key.type}.`);

                if (value.type !== 'Identifier')
                  throw new Error(`Unexpected token: ${value.type}.`);

                const prop = key.type === 'Identifier'
                           ? string(key.name)
                           : key.raw;

                declarations.push([value.name, `${name}[${prop}]`, 1]);
              }

              continue;
            }

            if (id.type !== 'Identifier')
              throw new Error(`Unexpected token: ${id.type}.`);

            declarations.push([id.name, code.substring(start, end), 1]);
          }

          break;
        }

        case 'FunctionDeclaration':
        case 'ClassDeclaration': {
          // export function foo() {}
          // export class foo {}
          if (id.type !== 'Identifier')
            throw new Error(`Unexpected token: ${id.type}.`);

          declarations.push([id.name, code.substring(start, end), 0]);

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${type}.`);
        }
      }
    }

    for (const {type, exported, local} of node.specifiers) {
      switch (type) {
        case 'ExportSpecifier': {
          // export { foo as bar };
          if (local.type !== 'Identifier')
            throw new Error(`Unexpected token: ${local.type}.`);

          if (exported.type !== 'Identifier')
            throw new Error(`Unexpected token: ${exported.type}.`);

          if (local.name === 'default')  {
            // Should have source:
            // export { default as foo } from 'module';
            // export { default } from 'module';
            assert(node.source);
          } else if (exported.name === 'default') {
            // Can have source or not.
            // export { foo as default };
            // export { foo as default } from 'module';
          }

          exports.push([local.name, exported.name]);

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${type}.`);
        }
      }
    }

    if (node.source)  {
      // export ... from 'bar';
      if (node.source.type !== 'Literal' ||
          typeof node.source.value !== 'string') {
        throw new Error(`Unexpected token: ${node.source.type}.`);
      }

      source = node.source.value;
    }

    out += this.makeESMFlag();

    if (source != null) {
      const name = this.makeTempName('export');

      out += this.makeVar(name, this.makeRequire(source));

      for (const [value, key] of exports) {
        if (value === 'default')
          out += this.makeExpose(key, await this.makeDefault(name, source));
        else
          out += this.makeProxy(key, name, value);
      }
    } else {
      for (const [key, value] of defines)
        out += this.makeVar(key, value);

      for (const [key, value, prefix] of declarations) {
        if (prefix)
          out += this.makeVar(key, value);
        else
          out += value + ';\n';

        out += this.makeAssign(key, key);
      }

      for (const [value, key] of exports)
        out += this.makeAssign(key, value);
    }

    return [node, out];
  }

  async ImportDeclaration(node, code) {
    const source = node.source.value;
    const imports = [];

    if (node.source.type !== 'Literal' ||
        typeof node.source.value !== 'string') {
      throw new Error(`Unexpected token: ${node.source.type}.`);
    }

    let out = '';

    if (node.specifiers.length === 0) {
      // import 'module';
      out += this.makeRequire(source) + ';\n';
      return [node, out];
    }

    for (const {type, imported, local} of node.specifiers) {
      switch (type) {
        case 'ImportDefaultSpecifier':
          // import foo from 'module';
          imports.push(['default', local.name]);
          break;
        case 'ImportNamespaceSpecifier':
          // import * as foo from 'module';
          imports.push(['*', local.name]);
          break;
        case 'ImportSpecifier':
          // import { bar as foo } from 'module';
          imports.push([imported.name, local.name]);
          break;
        default:
          throw new Error(`Unexpected token: ${type}.`);
      }
    }

    const sources = new Map();

    for (const [imported, local] of imports) {
      const [name, path] = await this.resolveSymbol(imported, source, true);

      if (!sources.has(path))
        sources.set(path, []);

      sources.get(path).push([name, local]);
    }

    for (const [source, imports] of sources) {
      const name = this.makeTempName('import');

      out += this.makeVar(name, this.makeRequire(source));

      for (const [imported, local] of imports) {
        if (imported === 'default')
          out += this.makeVar(local, await this.makeDefault(name, source));
        else if (imported === '*')
          out += this.makeVar(local, name);
        else
          out += this.makeVar(local, `${name}[${string(imported)}]`);
      }
    }

    return [node, out];
  }

  async resolveSymbol(name, source, isImport) {
    assert(typeof name === 'string');
    assert(typeof source === 'string');
    assert(typeof isImport === 'boolean');

    if (!this.bundle.shake)
      return [name, source];

    if (name === '*')
      return [name, source];

    if (this.resolver.isExternal(source, isImport))
      return [name, source];

    let path;

    try {
      path = await this.resolver.resolve(source, isImport);
    } catch (e) {
      return [name, source];
    }

    const result = await this._resolveSymbol(name, path);

    if (result[1] === path)
      return [name, source];

    return result;
  }

  async _resolveSymbol(name, path) {
    assert(typeof name === 'string');
    assert(typeof path === 'string');

    // module-1: export * as foo from 'module-0';
    // module-2: import { foo } from 'module-1';
    // convert:  import * as foo from 'module-0';
    if (name === '*')
      return [name, path];

    const module = await this.analyzeModule(path);

    if (!module)
      return [name, path];

    const desc = module.esm.exports.get(name);

    if (!desc)
      return [name, path];

    this.module.log('Resolved %s -> %s', path, desc[1]);

    return module.esm._resolveSymbol(desc[0], desc[1]);
  }

  async Literal(node, code, ancestors) {
    if (typeof node.value !== 'string')
      return null;

    if (node.value !== 'use strict')
      return null;

    if (ancestors.length !== 2)
      return null;

    if (ancestors[ancestors.length - 1].type !== 'ExpressionStatement')
      return null;

    if (ancestors[ancestors.length - 2].type !== 'Program')
      return null;

    return [{ start: node.start, end: node.end + 1 }, ''];
  }

  async MetaProperty(node) {
    // import.meta;
    this.hasMeta = true;
    this.bundle.hasMeta = true;
    return [node, '__meta'];
  }
}

/*
 * Expose
 */

module.exports = ESM;
