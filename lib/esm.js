/*!
 * esm.js - esm implementation for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
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
    this.hasExports = false;
    this.exports = new Set();
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

    this.exports.add(key);

    if (this.bundle.loose)
      return `__exports[${k}] = ${target}[${p}];\n`;

    return `Object.defineProperty(__exports, ${k}, \n`
         + `  Object.getOwnPropertyDescriptor(${target}, ${p}));\n`;
  }

  makeExpose(key, value) {
    this.exports.add(key);

    if (this.bundle.loose)
      return `__exports[${string(key)}] = ${value};\n`;

    return `Object.defineProperty(__exports, ${string(key)}, {\n`
         + '  configurable: true,\n'
         + '  enumerable: true,\n'
         + `  get: function() { return ${value}; }\n`
         + '});\n';
  }

  makeAssign(key, value) {
    this.exports.add(key);
    return `__exports[${string(key)}] = ${value};\n`;
  }

  makeExports() {
    const exports = this.exports;
    const env = this.bundle.env;
    const expr = this.module.linker.makeRequire0();

    if (this.bundle.target !== 'esm')
      return expr + ';';

    if (this.exports.size === 0) {
      if (this.hasExports)
        return `export default ${expr};`;
      return expr + ';';
    }

    const default_ = exports.has('default');
    const size = exports.size - Number(default_);

    let name = expr;
    let out = '';
    let i = 0;

    if (size === 0 && default_)
      name = `(${expr})`;

    if (size > 0) {
      if (default_) {
        name = `__${env}_main__`;
        out += `var ${name} = ${expr};\n\n`;
      }

      out += 'export const {\n';

      for (const key of exports) {
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

    if (default_)
      out += `export default ${name}['default'];\n`;

    return out;
  }

  async getExports(specifier) {
    assert(typeof specifier === 'string');

    let path;

    try {
      path = await this.resolver.resolve(specifier, true);
    } catch (e) {
      return new Set();
    }

    const format = await this.resolver.format(path);

    if (format === 'module') {
      if (path === this.filename)
        return new Set();

      // Do some static analysis on the exports.
      const module = this.bundle.createModule(path);

      await module.init();
      await module.compile(false);

      return module.esm.exports;
    }

    if (format === 'wasm') {
      const source = await fs.readFile(path);
      const compiled = await WebAssembly.compile(source);
      const exports = WebAssembly.Module.exports(compiled);

      return new Set(exports.map(x => x.name));
    }

    if (format !== 'builtin')
      return new Set();

    // Core modules get special treatment.
    // They're all CJS, and it's a pain to
    // statically analyze them, so we just
    // require them directly.
    if (this.bundle.env === 'browser') {
      path = builtins[path];

      if (!path)
        return new Set();
    }

    // Could use:
    // https://github.com/nodejs/node/tree/ed5cb37/deps/cjs-module-lexer
    // https://github.com/nodejs/cjs-module-lexer
    const module = await this.resolver.require(path);
    const keys = Object.getOwnPropertyNames(module);
    const exports = new Set();

    for (const key of keys) {
      if (key.length === 0)
        continue;

      if (/[^\$\w]/.test(key))
        continue;

      if (/^\d/.test(key))
        continue;

      if (key === 'default' ||
          key === '__proto__' ||
          key === '__esModule') {
        continue;
      }

      exports.add(key);
    }

    return exports;
  }

  async transform(code) {
    assert(typeof code === 'string');

    if (this.module.format !== 'module') {
      return this.module.replace(code, this, {
        Identifier: this.Identifier,
        MemberExpression: this.MemberExpression,
        Literal: this.bundle.target === 'esm' ? this.Literal : null
      });
    }

    const out = await this.module.replace(code, this, {
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

  isModuleExports(node) {
    // e.g.
    // module.exports
    // module['exports']
    if (node.type !== 'MemberExpression')
      return false;

    if (node.object.type !== 'Identifier')
      return false;

    if (node.property.type !== 'Identifier') {
      if (node.property.type !== 'Literal')
        return false;

      if (typeof node.property.value !== 'string')
        return false;
    }

    if (node.object.name !== 'module')
      return false;

    if (node.property.type === 'Identifier') {
      if (node.property.name !== 'exports')
        return false;
    } else {
      if (node.property.value !== 'exports')
        return false;
    }

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

    for (const key of exports) {
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
                if (key.type !== 'Identifier')
                  throw new Error(`Unexpected token: ${key.type}.`);

                if (value.type !== 'Identifier')
                  throw new Error(`Unexpected token: ${value.type}.`);

                declarations.push([
                  value.name,
                  `${name}[${string(key.name)}]`,
                  1
                ]);
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

  async Identifier(node) {
    if (node.name === 'exports')
      this.hasExports = true;

    return null;
  }

  async ImportDeclaration(node, code) {
    const source = node.source.value;
    const imports = [];

    if (node.source.type !== 'Literal' ||
        typeof node.source.value !== 'string') {
      throw new Error(`Unexpected token: ${node.source.type}.`);
    }

    let default_ = null;
    let namespace = null;
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
          default_ = local.name;
          break;
        case 'ImportNamespaceSpecifier':
          // import * as foo from 'module';
          namespace = local.name;
          break;
        case 'ImportSpecifier':
          // import { bar as foo } from 'module';
          imports.push([imported.name, local.name]);
          break;
        default:
          throw new Error(`Unexpected token: ${type}.`);
      }
    }

    const name = this.makeTempName('import');

    out += this.makeVar(name, this.makeRequire(source));

    if (default_)
      out += this.makeVar(default_, await this.makeDefault(name, source));

    if (namespace)
      out += this.makeVar(namespace, name);

    for (const [imported, local] of imports)
      out += this.makeVar(local, `${name}[${string(imported)}]`);

    return [node, out];
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

  async MemberExpression(node) {
    if (this.isModuleExports(node)) {
      this.hasExports = true;
      return null;
    }

    return null;
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
