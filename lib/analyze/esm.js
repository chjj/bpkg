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
const {getName, getString, isString} = utils;
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
          for (const {id} of decl.declarations)
            setExport(state, id);
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

      const exportedName = getName(exported);

      if (source)
        state.exports.set(exportedName, [local.name, source]);
      else
        state.exports.set(exportedName, state.imports.get(local.name) || null);
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

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return;
    }
  }

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

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return;
    }
  }

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
 * Helpers
 */

function setExport(state, node) {
  if (node.type === 'Identifier') {
    state.exports.set(node.name, null);
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties)
      setExport(state, prop);
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements)
      if (el) setExport(state, el); // eslint-disable-line
  } else if (node.type === 'Property') {
    setExport(state, node.value);
  } else if (node.type === 'AssignmentPattern') {
    setExport(state, node.left);
  } else if (node.type === 'RestElement') {
    setExport(state, node.argument);
  } else {
    throw Error(`Unexpected token: ${node.type}.`);
  }
}

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
