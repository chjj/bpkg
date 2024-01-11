/*!
 * cjs.js - commonjs dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../../vendor/bfile');
const acorn = require('../../vendor/acorn');

/*
 * Analyze
 */

function analyze(root) {
  assert(root && root.type === 'Program');

  const state = {
    exports: new Set(),
    alias: new Set(['exports'])
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

  for (const node of root.body)
    visitor(node, state);

  return state.exports;
}

/*
 * Visitor
 */

function visitor(node, state) {
  // var foo = exports;
  const alias = isExportsAlias(node);

  if (alias) {
    state.alias.add(alias);
    return;
  }

  // exports.foo = bar;
  // exports['foo'] = bar;
  if (isExportsAssign(node, state.alias)) {
    const key = getPropertyName(node.expression.left.property);
    state.exports.add(key);
    return;
  }

  // Object.defineProperty(exports, 'foo', bar);
  if (isExportsDefine(node, state.alias)) {
    const key = node.expression.arguments[1];
    state.exports.add(key.value);
    return;
  }

  // module.exports.foo = bar;
  // module.exports['foo'] = bar;
  // module['exports']['foo'] = bar;
  if (isModuleExportsAssign(node)) {
    const key = getPropertyName(node.expression.left.property);
    state.exports.add(key);
    return;
  }

  // Object.defineProperty(module.exports, 'foo', bar);
  // Object.defineProperty(module['exports'], 'foo', bar);
  if (isModuleExportsDefine(node)) {
    const key = node.expression.arguments[1];
    state.exports.add(key.value);
    return;
  }

  // if (foo) module.exports = bar; else module.exports = baz;
  if (node.type === 'IfStatement') {
    acorn.walk.full(node, (child) => {
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

    if (rhs.type === 'Identifier')
      state.alias.add(rhs.name);

    if (rhs.type === 'ObjectExpression') {
      for (const {key} of rhs.properties)
        state.exports.add(getPropertyName(key));
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

    if (init == null)
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

function isExportsDefine(node, alias) {
  // Object.defineProperty(exports, 'foo', bar);
  if (!isDefineProperty(node))
    return false;

  const [arg] = node.expression.arguments;

  return isExportsIdentifier(arg, alias);
}

function isModuleExportsAssign(node) {
  // module.exports.foo = bar;
  // module.exports['foo'] = bar;
  // module['exports']['foo'] = bar;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'AssignmentExpression')
    return false;

  if (expr.operator !== '=')
    return false;

  return isModuleExportsAccess(expr.left);
}

function isModuleExportsAccess(node) {
  // module.exports.foo
  // module.exports['foo']
  if (node.type !== 'MemberExpression')
    return false;

  if (!isMemberAccess(node.object, 'module', 'exports'))
    return false;

  return isProperty(node.property);
}

function isModuleExportsDefine(node) {
  // Object.defineProperty(module.exports, 'foo', bar);
  // Object.defineProperty(module['exports'], 'foo', bar);
  if (!isDefineProperty(node))
    return false;

  const [arg] = node.expression.arguments;

  return isMemberAccess(arg, 'module', 'exports');
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

  return isMemberAccess(expr.left, 'module', 'exports');
}

function isExportsIdentifier(node, alias = null) {
  if (!isIdentifier(node))
    return false;

  if (alias)
    return alias.has(node.name);

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

function isMemberAccess(node, ident, prop) {
  if (node.type !== 'MemberExpression')
    return false;

  if (!isIdentifierName(node.object, ident))
    return false;

  if (!isPropertyName(node.property, prop))
    return false;

  return true;
}

function isDefineProperty(node) {
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'CallExpression')
    return false;

  if (!isMemberAccess(expr.callee, 'Object', 'defineProperty'))
    return false;

  if (expr.arguments.length !== 3)
    return false;

  return isStringLiteral(expr.arguments[1]);
}

function isFunctionWrapper(node) {
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (expr.type !== 'CallExpression')
    return false;

  const func = expr.callee;

  if (func.type !== 'FunctionExpression')
    return false;

  if (func.generator || func['async'])
    return false;

  if (func.body.type !== 'BlockStatement')
    return false;

  return true;
}

function isBrowserWrapper(node) {
  if (!isFunctionWrapper(node))
    return false;

  const func = node.expression.callee;

  if (func.params.length !== 1)
    return false;

  if (func.params[0].name !== 'global')
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
 * Helpers
 */

function parse(code, filename = null) {
  assert(typeof code === 'string');
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: true,
      allowReturnOutsideFunction: true
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
  return analyze(root);
}

/*
 * Expose
 */

exports.analyze = analyze;
exports.getExports = getExports;

/*
 * Test
 */

if (require.main === module)
  getExports(process.argv[2]).then(console.log);
