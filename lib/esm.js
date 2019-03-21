/*!
 * esm.js - esm implementation for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const path = require('path');
const builtins = require('./builtins');
const {extname, isAbsolute} = path;

/**
 * ESM
 */

class ESM {
  constructor(module) {
    this.module = module;
    this.bundle = module.bundle;
    this.resolve = module.resolve;
    this.hasStrict = false;
    this.hasMeta = false;
    this.hasFlag = false;
    this.hasExports = false;
    this.exports = new Set();
    this.tmp = 0;
  }

  warning(...args) {
    this.module.warning(...args);
  }

  makeRequire(location) {
    return `require(${string(location)})`;
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
    out += 'var __meta = { __proto__: null, url: __meta_url };\n';
    out += '\n';

    return out;
  }

  makeTempName(name) {
    return `__bpkg_${name}_${this.tmp++}__`;
  }

  makeVar(name, value) {
    return `var ${name} = ${value};\n`;
  }

  makeDefault(name) {
    return `${name}.__esModule ? ${name}['default'] : ${name}`;
  }

  makeESMFlag() {
    if (this.hasFlag)
      return '';

    this.hasFlag = true;

    if (this.bundle.loose)
      return 'exports.__esModule = true;\n';

    return 'Object.defineProperty(exports, \'__esModule\', { value: true });\n';
  }

  makeProxy(key, target, prop) {
    const k = string(key);
    const p = string(prop);

    this.exports.add(key);

    if (this.bundle.loose)
      return `exports[${k}] = ${target}[${p}];\n`;

    return `Object.defineProperty(exports, ${k}, \n`
         + `  Object.getOwnPropertyDescriptor(${target}, ${p}));\n`;
  }

  makeExpose(key, value) {
    this.exports.add(key);

    if (this.bundle.loose)
      return `exports[${string(key)}] = ${value};\n`;

    return `Object.defineProperty(exports, ${string(key)}, {\n`
         + '  configurable: true,\n'
         + '  enumerable: true,\n'
         + `  get: function() { return ${value}; }\n`
         + '});\n';
  }

  makeAssign(key, value) {
    this.exports.add(key);
    return `exports[${string(key)}] = ${value};\n`;
  }

  makeExports() {
    const exports = this.exports;
    const env = this.bundle.env;
    const expr = env === 'browser'
      ? '__browser_require__(0, null)'
      : '__node_require__(0)';

    if (!this.bundle.esm)
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

  async getExports(location) {
    assert(typeof location === 'string');

    let path;

    try {
      path = await this.resolve(location);
    } catch (e) {
      return new Set();
    }

    if (isAbsolute(path)) {
      if (extname(path) === '.json')
        return new Set();

      if (extname(path) === '.node')
        return new Set();

      if (path === this.module.path)
        return new Set();

      // Do some static analysis on the exports.
      const module = this.bundle.createModule(path);

      await module.init();
      await module.compile(false);

      return module.esm.exports;
    }

    // Core modules get special treatment.
    // They're all CJS, and it's a pain to
    // statically analyze them, so we just
    // require them directly.
    if (this.bundle.env === 'browser') {
      path = builtins[path];

      if (!path)
        return new Set();
    }

    const module = await this.resolve.require(path);
    const keys = Object.getOwnPropertyNames(module);
    const exports = new Set();

    for (const key of keys) {
      if (key.length === 0)
        continue;

      if (/[^\$\w]/.test(key))
        continue;

      if (/^\d/.test(key))
        continue;

      if (key === 'default'
          || key === '__proto__'
          || key === '__esModule') {
        continue;
      }

      exports.add(key);
    }

    return exports;
  }

  async rewrite(path) {
    assert(this.bundle.multi);

    if (!this.bundle.esm) {
      if (path.endsWith('.mjs') || path.endsWith('.cjs'))
        path = path.slice(0, -4) + '.js';
    }

    return path;
  }

  async transform(code) {
    assert(typeof code === 'string');

    if (this.bundle.multi && this.bundle.esm)
      return code;

    let [type, out] = await this.module.replace(code, this, {
      CallExpression: this.CallExpression,
      ExportAllDeclaration: this.ExportAllDeclaration,
      ExportDefaultDeclaration: this.ExportDefaultDeclaration,
      ExportNamedDeclaration: this.ExportNamedDeclaration,
      Identifier: this.Identifier,
      ImportDeclaration: this.ImportDeclaration,
      Literal: this.Literal,
      MemberExpression: this.MemberExpression,
      MetaProperty: this.MetaProperty
    });

    if (!this.bundle.esm) {
      if (this.bundle.multi && this.hasMeta)
        out = this.makeMeta() + out;

      if (type === 'module' && !this.hasStrict)
        out = this.makeStrict() + out;
    }

    return out;
  }

  isImport(node) {
    // e.g.
    // import('foo')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'Import')
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

  async CallExpression(node, code) {
    if (this.isImport(node)) {
      // import(path).then(...);
      const arg = node.arguments[0];

      let value = '';

      if (arg.type !== 'Literal' || typeof arg.value !== 'string') {
        this.warning('cannot resolve dynamic import: %s',
                     code.substring(node.start, node.end));

        if (this.bundle.esm)
          return null;

        value = `require(${code.substring(arg.start, arg.end)})`;
      } else {
        value = this.makeRequire(arg.value);
      }

      return [node, `(Promise.resolve(${value}))`];
    }

    return null;
  }

  async ExportAllDeclaration(node, code) {
    // export * from 'foo';
    const name = this.makeTempName('export');
    const source = node.source.value;

    if (node.source.type !== 'Literal'
        || typeof node.source.value !== 'string') {
      throw new Error(`Unexpected token: ${node.source.type}.`);
    }

    let out = '';

    out += this.makeESMFlag();

    out += this.makeVar(name, this.makeRequire(source));

    const exports = await this.getExports(source);

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
      out += this.makeExpose('default', id.name);
    } else {
      out += this.makeAssign('default', code.substring(start, end));
    }

    return [node, out];
  }

  async ExportNamedDeclaration(node, code) {
    const defines = [];
    const declarations = [];
    const exports = [];

    let namespace = null;
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
                  1]);
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

        case 'ExportNamespaceSpecifier': {
          // export * as foo from 'module';
          if (exported.type !== 'Identifier')
            throw new Error(`Unexpected token: ${exported.type}.`);

          namespace = exported.name;

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${type}.`);
        }
      }
    }

    if (node.source)  {
      // export ... from 'bar';
      if (node.source.type !== 'Literal'
          || typeof node.source.value !== 'string') {
        throw new Error(`Unexpected token: ${node.source.type}.`);
      }

      source = node.source.value;
    }

    out += this.makeESMFlag();

    if (source != null) {
      const name = this.makeTempName('export');

      out += this.makeVar(name, this.makeRequire(source));

      if (namespace)
        out += this.makeAssign(namespace, name);

      for (const [value, key] of exports) {
        if (value === 'default')
          out += this.makeExpose(key, this.makeDefault(name));
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

        out += this.makeExpose(key, key);
      }

      for (const [value, key] of exports)
        out += this.makeExpose(key, value);
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

    if (node.source.type !== 'Literal'
        || typeof node.source.value !== 'string') {
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
      out += this.makeVar(default_, this.makeDefault(name));

    if (namespace)
      out += this.makeVar(namespace, name);

    for (const [imported, local] of imports)
      out += this.makeVar(local, `${name}[${string(imported)}]`);

    return [node, out];
  }

  async Literal(node) {
    if (typeof node.value !== 'string')
      return null;

    if (node.value !== 'use strict')
      return null;

    this.hasStrict = true;

    if (!this.bundle.multi && this.bundle.esm)
      return [{ start: node.start, end: node.end + 1 }, ''];

    return null;
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
 * Helpers
 */

function string(str) {
  assert(typeof str === 'string');
  str = JSON.stringify(str).slice(1, -1);
  str = str.replace(/\\"/g, '"');
  str = str.replace(/'/g, '\\\'');
  return `'${str}'`;
}

/*
 * Expose
 */

module.exports = ESM;
