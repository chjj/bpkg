/*!
 * cjs.js - commonjs dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const {walk} = require('../../vendor/acorn');

/*
 * Analyze
 */

function analyze(root, exports = new Set()) {
  assert(root && root.type === 'Program');
  assert(exports instanceof Set);

  const state = {
    alias: null,
    exports
  };

  outer: for (const node of root.body) {
    if (isBrowserWrapper(node)) {
      const func = node.expression.callee;

      for (const child of func.body.body) {
        const mod = extractModule(child);

        if (mod) {
          root = mod;
          break outer;
        }
      }
    } else {
      const mod = extractModule(node);

      if (mod) {
        root = mod;
        break;
      }
    }
  }

  walk.fullAncestor(root, visitor, walk.base, state);

  return exports;
}

/*
 * Visitor
 */

function visitor(node, state, ancestors, type) {
  if (!isTopLevel(ancestors))
    return;

  // var foo = exports;
  const alias = isExportsAlias(node);

  if (alias) {
    state.alias = alias;
    return;
  }

  // exports.foo = bar;
  // exports['foo'] = bar;
  if (isExportsAssign(node, state.alias)) {
    const key = getPropertyName(node.expression.left.property);
    state.exports.add(key);
    return;
  }

  // module.exports.foo = bar;
  // module.exports['foo'] = bar;
  if (isModuleExportsAssign(node)) {
    const key = getPropertyName(node.expression.left.property);
    state.exports.add(key);
    return;
  }

  // if (foo) module.exports = bar; else module.exports = baz;
  if (node.type === 'IfStatement') {
    walk.full(node, (child) => {
      if (isModuleExportsOverwrite(child))
        node = child;
    });
  }

  // module.exports = { a, b, c };
  // module['exports'] = { a, b, c };
  // module.exports = foo;
  // module['exports'] = foo;
  if (isModuleExportsOverwrite(node)) {
    const rhs = node.expression.right;

    if (rhs.type === 'ObjectExpression') {
      for (const {key} of rhs.properties) {
        if (isProperty(key))
          state.exports.add(getPropertyName(key));
      }
    } else {
      state.exports.add('default');
    }

    return;
  }
}

/*
 * AST Helpers
 */

function isExportsAlias(node) {
  // var foo = exports;
  if (node.type !== 'VariableDeclaration')
    return false;

  for (const {id, init} of node.declarations) {
    if (id.type !== 'Identifier')
      continue;

    if (!init)
      continue;

    if (init.type !== 'Identifier')
      continue;

    if (init.name !== 'exports')
      continue;

    return id.name;
  }

  return false;
}

function isExportsAssign(node, alias) {
  // exports.foo = bar;
  // exports['foo'] = bar;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'AssignmentExpression')
    return false;

  if (expr.operator !== '=')
    return false;

  if (expr.left.type !== 'MemberExpression')
    return false;

  return isExportsAccess(expr.left, alias);
}

function isExportsAccess(node, alias) {
  // exports.foo
  // exports['foo']
  if (node.type !== 'MemberExpression')
    return false;

  const {object, property} = node;

  if (!isExportsIdentifier(object, alias))
    return false;

  return isProperty(property);
}

function isModuleExportsAssign(node) {
  // module.exports.foo = bar;
  // module.exports['foo'] = bar;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'AssignmentExpression')
    return false;

  if (expr.operator !== '=')
    return false;

  if (expr.left.type !== 'MemberExpression')
    return false;

  return isModuleExportsAccess(expr.left);
}

function isModuleExportsAccess(node) {
  // module.exports.foo
  // module.exports['foo']
  if (node.type !== 'MemberExpression')
    return false;

  if (node.object.type !== 'MemberExpression')
    return false;

  const {object, property} = node.object;

  if (!isIdentifierName(object, 'module'))
    return false;

  if (!isPropertyName(property, 'exports'))
    return false;

  return isProperty(node.property);
}

function isModuleExportsOverwrite(node) {
  // module.exports = { a, b, c };
  // module['exports'] = { a, b, c };
  // module.exports = foo;
  // module['exports'] = foo;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'AssignmentExpression')
    return false;

  if (expr.operator !== '=')
    return false;

  if (expr.left.type !== 'MemberExpression')
    return false;

  const {object, property} = expr.left;

  if (!isIdentifierName(object, 'module'))
    return false;

  if (!isPropertyName(property, 'exports'))
    return false;

  return true;
}

function isExportsIdentifier(node, alias = null) {
  if (!isIdentifier(node))
    return false;

  if (alias != null && node.name === alias)
    return true;

  return node.name === 'exports';
}

function isIdentifier(node) {
  return node.type === 'Identifier';
}

function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

function isProperty(node) {
  return isIdentifier(node) || isStringLiteral(node);
}

function isIdentifierName(node, name) {
  return isIdentifier(node) && node.name === name;
}

function isPropertyName(node, name) {
  if (isIdentifier(node))
    return node.name === name;

  if (isStringLiteral(node))
    return node.value === name;

  return false;
}

function getPropertyName(node) {
  return isIdentifier(node) ? node.name : node.value;
}

function isTopLevel(ancestors) {
  return ancestors.length === 2 && ancestors[0].type === 'Program';
}

function isBrowserWrapper(node) {
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'CallExpression')
    return false;

  const func = expr.callee;

  if (func.type !== 'FunctionExpression')
    return false;

  if (func['async'])
    return false;

  if (func.params.length !== 1)
    return false;

  if (func.params[0].name !== 'global')
    return false;

  if (func.body.type !== 'BlockStatement')
    return false;

  for (const child of func.body.body) {
    if (node.type === 'VariableDeclaration' &&
        node.declarations.length === 1 &&
        node.declarations[0].id.name === '__browser_modules__') {
      return true;
    }
  }

  return false;
}

function extractModule(node) {
  if (node.type !== 'VariableDeclaration')
    return null;

  if (node.declarations.length !== 1)
    return null;

  const {id, init} = node.declarations[0];

  if (id.name !== '__node_modules__' &&
      id.name !== '__browser_modules__') {
    return null;
  }

  if (!init || init.type !== 'ArrayExpression')
    return null;

  if (init.elements.length === 0)
    return null;

  const mod = init.elements[0];

  if (mod.type !== 'ArrayExpression')
    return null;

  if (mod.elements.length === 0)
    return null;

  const func = mod.elements[mod.elements.length - 1];

  if (func.type !== 'FunctionExpression')
    return null;

  if (func['async'])
    return null;

  if (func.body.type !== 'BlockStatement')
    return null;

  return {
    type: 'Program',
    start: func.body.start,
    end: func.body.end,
    body: func.body.body
  };
}

/*
 * Expose
 */

exports.analyze = analyze;

if (!module.parent) {
  const fs = require('fs');
  const acorn = require('../../vendor/acorn');
  const code = fs.readFileSync(process.argv[2], 'utf8');

  const root = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true,
    allowReturnOutsideFunction: true
  });

  console.log(analyze(root));
}
