/*!
 * esm.js - esm implementation for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const esm = require('./analyze/esm');
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
      return false;

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

  makeVar(name, value, kind = 'var') {
    return `${kind} ${name} = ${value};\n`;
  }

  async makeDefault(name, source) {
    if (await this.isRealImport(source)) {
      // From real import() call.
      return `${name}['default']`;
    }

    this.bundle.hasImportDefault = true;

    // From required compiled module.
    return `__esm_default__(${name})`;
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

  makeProxy(dkey, src, skey) {
    const dst = '__exports';
    const dk = string(dkey);
    const sk = string(skey);

    if (this.bundle.loose)
      return `${dst}[${dk}] = ${src}[${sk}];\n`;

    if (skey === dkey) {
      this.bundle.hasProxy = true;
      return `__esm_proxy__(${dst}, ${src}, ${sk});\n`;
    }

    this.bundle.hasAssign = true;

    return `__esm_assign__(${dst}, ${dk}, ${src}, ${sk});\n`;
  }

  makeExpose(key, value) {
    if (this.bundle.loose)
      return `__exports[${string(key)}] = ${value};\n`;

    this.bundle.hasExpose = true;

    const expr = `function() { return ${value}; }`;

    return `__esm_expose__(__exports, ${string(key)}, ${expr});\n`;
  }

  makeAssign(key, value) {
    return `__exports[${string(key)}] = ${value};\n`;
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

    const path = await this.module.tryResolve(specifier, true);

    if (!path)
      return new Set();

    const format = await this.resolver.format(path);

    if (format === 'module' || format === 'wasm') {
      if (path === this.filename)
        return new Set();

      return this.bundle.getExports(path);
    }

    return new Set();
  }

  async analyze(root) {
    assert(root && root.type === 'Program');

    if (this.module.format !== 'module')
      return;

    const {exports, reexports} = esm.analyze(root);

    for (const name of exports.keys()) {
      if (name !== '__esModule')
        this.exports.add(name);
    }

    for (const source of reexports) {
      if (!await this.module.tryResolve(source, true))
        continue;

      const resolved = await this.getExports(source);

      for (const key of resolved) {
        if (key !== 'default' && !this.exports.has(key))
          this.exports.add(key);
      }
    }
  }

  async transform(root, code) {
    assert(root && root.type === 'Program');
    assert(typeof code === 'string');

    if (this.module.format !== 'module') {
      if (this.bundle.target === 'esm') {
        return this.module._replace(root, code, this, {
          ExpressionStatement: this.ExpressionStatement
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

    let out = '';

    out += this.makeESMFlag();

    if (node.exported) {
      // export * as foo from 'module';
      const {exported} = node;

      if (exported.type !== 'Identifier')
        throw new Error(`Unexpected token: ${exported.type}.`);

      const expr = this.makeRequire(source);

      if (await this.needsStarWrapper(source))
        out += this.makeAssign(exported.name, this.makeImportStar(expr));
      else
        out += this.makeAssign(exported.name, expr);

      return [node, out];
    }

    // export * from 'foo';
    out += this.makeExportStar(this.makeRequire(source));

    return [node, out];
  }

  async ExportDefaultDeclaration(node, code) {
    // export default foo;
    const decl = node.declaration;
    const {start, end} = decl;

    let out = '';
    let exposed = false;

    switch (decl.type) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        exposed = true;
        break;
    }

    out += this.makeESMFlag();

    if (exposed && decl.id && decl.id.name) {
      out += code.substring(start, end) + '\n';
      out += this.makeExpose('default', decl.id.name);
    } else if (decl.type === 'Identifier' || decl.type === 'MemberExpression') {
      out += this.makeExpose('default', code.substring(start, end));
    } else {
      out += this.makeAssign('default', code.substring(start, end));
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
              out += this.makeAssign(key, key);
            else
              out += this.makeExpose(key, key);
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
          out += this.makeExpose(id.name, id.name);

          break;
        }

        default: {
          throw new Error(`Unexpected token: ${decl.type}.`);
        }
      }

      return [node, out];
    }

    // export { foo as bar } from 'module';
    // export { foo as bar };
    let out = this.makeESMFlag();

    if (node.source) {
      const name = this.makeTempName('export');
      const source = node.source.value;

      out += this.makeVar(name, this.makeRequire(source));

      for (const {exported, local} of node.specifiers) {
        const key = exported.name;
        const value = local.name;

        if (value === 'default')
          out += this.makeExpose(key, await this.makeDefault(name, source));
        else
          out += this.makeProxy(key, name, value);
      }
    } else {
      for (const {exported, local} of node.specifiers)
        out += this.makeExpose(exported.name, local.name);
    }

    return [node, out];
  }

  async ImportDeclaration(node, code) {
    const source = node.source.value;
    const imports = [];

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

    const name = this.makeTempName('import');
    const needsWrapper = await this.needsStarWrapper(source);

    out += this.makeVar(name, this.makeRequire(source));

    for (const [imported, local] of imports) {
      if (imported === 'default') {
        out += this.makeVar(local, await this.makeDefault(name, source));
      } else if (imported === '*') {
        if (needsWrapper)
          out += this.makeVar(local, this.makeImportStar(name));
        else
          out += this.makeVar(local, name);
      } else {
        out += this.makeVar(local, `${name}[${string(imported)}]`);
      }
    }

    return [node, out];
  }

  async ExpressionStatement(node, code, ancestors) {
    const expr = node.expression;

    if (expr.type !== 'Literal')
      return null;

    if (typeof expr.value !== 'string')
      return null;

    if (expr.value !== 'use strict')
      return null;

    if (ancestors.length !== 1)
      return null;

    if (ancestors[0].type !== 'Program')
      return null;

    return [node, ''];
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

function getIdents(node) {
  assert(node && node.type === 'VariableDeclaration');

  const idents = [];

  for (const {id} of node.declarations)
    pushIdent(idents, id);

  return idents;
}

function pushIdent(idents, node) {
  if (node.type === 'Identifier') {
    idents.push(node.name);
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties)
      pushIdent(idents, prop);
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements)
      if (el) pushIdent(idents, el); // eslint-disable-line
  } else if (node.type === 'Property') {
    pushIdent(idents, node.value);
  } else if (node.type === 'AssignmentPattern') {
    pushIdent(idents, node.left);
  } else if (node.type === 'RestElement') {
    pushIdent(idents, node.argument);
  } else {
    throw Error(`Unexpected token: ${node.type}.`);
  }
}

/*
 * Expose
 */

module.exports = ESM;
