/*!
 * esm.js - es module dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../../vendor/bfile');
const acorn = require('../../vendor/acorn');
const utils = require('../utils');
const {getIdents, getName, getString, isString, isTopLevel} = utils;
const {walk} = acorn;

/*
 * Analyze
 */

function analyze(root) {
  assert(root && root.type === 'Program');

  const state = {
    sources: new Set(),
    imports: new Map(),
    exports: new Map(),
    reexports: new Set()
  };

  for (const node of root.body)
    visitor(node, state);

  return state;
}

function visitor(node, state) {
  if (node.type === 'ImportDeclaration') {
    const source = node.source.value;

    for (const {type, imported, local} of node.specifiers) {
      switch (type) {
        case 'ImportNamespaceSpecifier':
          // import * as foo from 'module';
          state.imports.set(local.name, [null, source]);
          break;
        case 'ImportDefaultSpecifier':
          // import foo from 'module';
          state.imports.set(local.name, ['default', source]);
          break;
        case 'ImportSpecifier':
          // import { bar as foo } from 'module';
          state.imports.set(local.name, [getName(imported), source]);
          break;
        default:
          throw new Error(`Unexpected token: ${type}.`);
      }
    }

    state.sources.add(source);

    return;
  }

  if (node.type === 'ExportAllDeclaration') {
    const source = node.source.value;
    if (node.exported) {
      // export * as foo from 'module';
      state.exports.set(getName(node.exported), [null, source]);
    } else {
      // export * from 'foo';
      state.reexports.add(source);
    }
    state.sources.add(source);
    return;
  }

  if (node.type === 'ExportDefaultDeclaration') {
    // export default foo;
    const decl = node.declaration;

    if (decl.type === 'Identifier')
      state.exports.set('default', state.imports.get(decl.name) || null);
    else
      state.exports.set('default', null);

    return;
  }

  if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;

      switch (decl.type) {
        case 'VariableDeclaration': {
          // export var/let foo;
          // export var/let/const foo = 1;
          // export var/let/const {foo} = {};
          // export var/let/const [foo] = [];
          for (const name of getIdents(decl))
            state.exports.set(name, null);
          break;
        }

        case 'FunctionDeclaration':
        case 'ClassDeclaration': {
          // export function foo() {}
          // export class foo {}
          state.exports.set(decl.id.name, null);
          break;
        }

        default: {
          throw new Error(`Unexpected token: ${decl.type}.`);
        }
      }

      return;
    }

    // export { foo as bar } from 'module';
    // export { foo as bar };
    const source = node.source ? node.source.value : null;

    for (const {type, local, exported} of node.specifiers) {
      if (type !== 'ExportSpecifier')
        throw new Error(`Unexpected token: ${type}.`);

      const localName = getName(local);
      const exportedName = getName(exported);

      if (source)
        state.exports.set(exportedName, [localName, source]);
      else
        state.exports.set(exportedName, state.imports.get(localName) || null);
    }

    if (source)
      state.sources.add(source);
  }
}

/*
 * Top-level Await
 */

function hasTLA(root) {
  assert(root && root.type === 'Program');

  try {
    walk.fullAncestor(root, visitAwait, walk.base, null);
  } catch (e) {
    if (e instanceof Found)
      return true;
    throw e;
  }

  return false;
}

function visitAwait(node, state, ancestors, type) {
  if (node.type !== 'AwaitExpression')
    return;

  // Exclude `await import('./module.js')`.
  if (node.argument.type === 'ImportExpression') {
    if (isString(node.argument.source))
      return;
  }

  if (!isTopLevel(ancestors))
    return;

  throw new Found(node, state);
}

/*
 * Import Expressions
 */

function getImportExprs(root) {
  assert(root && root.type === 'Program');

  const state = new Set();

  walk.fullAncestor(root, visitImport, walk.base, state);

  return state;
}

function visitImport(node, state, ancestors, type) {
  if (node.type !== 'AwaitExpression')
    return;

  if (node.argument.type !== 'ImportExpression')
    return;

  const source = node.argument.source;

  if (!isString(source))
    return;

  if (!isTopLevel(ancestors))
    return;

  state.add(getString(source));
}

/*
 * Strict Mode
 */

function hasStrict(root) {
  assert(root && root.type === 'Program');

  if (root.body.length === 0)
    return false;

  const node = root.body[0];

  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'Literal')
    return false;

  if (typeof expr.value !== 'string')
    return false;

  if (expr.value !== 'use strict')
    return false;

  return true;
}

/*
 * Module Syntax
 */

const CJS_SCOPE = [
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname'
];

function hasModuleSyntax(code) {
  assert(typeof code === 'string');

  let root;

  try {
    root = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: false, // We assume the hashbang has already been stripped.
      allowReturnOutsideFunction: false
    });
  } catch (e) {
    return false;
  }

  for (const node of root.body) {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        return true;
      case 'VariableDeclaration':
        if (node.kind !== 'var') {
          for (const id of getIdents(node)) {
            if (CJS_SCOPE.includes(id))
              return true;
          }
        }
        break;
      case 'ClassDeclaration':
        if (CJS_SCOPE.includes(node.id.name))
          return true;
        break;
    }
  }

  try {
    walk.fullAncestor(root, visitEsmNodes, walk.base, null);
  } catch (e) {
    if (e instanceof Found)
      return true;
    throw e;
  }

  return false;
}

function visitEsmNodes(node, state, ancestors, type) {
  if (node.type === 'MetaProperty') {
    if (node.meta.name === 'import' && node.property.name === 'meta')
      throw new Found(node, state);
  } else if (node.type === 'AwaitExpression') {
    if (isTopLevel(ancestors))
      throw new Found(node, state);
  }
}

/*
 * Helpers
 */

class Found {
  constructor(node, state) {
    this.node = node;
    this.state = state;
  }
}

function parse(code, filename = null) {
  assert(typeof code === 'string');
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      allowReturnOutsideFunction: false
    });
  } catch (e) {
    if (filename)
      e.message += ` (${filename})`;
    throw e;
  }
}

async function getExports(filename) {
  const code = await fs.readFile(filename, 'utf8');
  const root = parse(code, filename);
  const {exports} = analyze(root);
  return new Set([...exports.keys()]);
}

/*
 * Expose
 */

exports.analyze = analyze;
exports.hasTLA = hasTLA;
exports.getImportExprs = getImportExprs;
exports.hasStrict = hasStrict;
exports.parse = parse;
exports.getExports = getExports;
exports.hasModuleSyntax = hasModuleSyntax;
