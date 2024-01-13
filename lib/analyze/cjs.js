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
    imports: new Map(),
    exports: new Map(),
    reexports: new Set(),
    alias: new Set(['exports'])
  };

  const inner = pluckWrapper(root);

  if (inner) {
    root = inner;
  } else {
    for (const node of root.body) {
      const mod = extractModule(node);

      if (mod) {
        root = mod;
        break;
      }
    }
  }

  for (const node of root.body)
    visitor(node, state);

  return state;
}

/*
 * Visitor
 */

function visitor(node, state) {
  // const foo = require('bar');
  if (isSingleRequire(node)) {
    const decl = node.declarations[0];
    const name = decl.id.name;
    const source = decl.init.arguments[0].value;

    state.imports.set(name, ['default', source]);

    return;
  }

  // const {foo, bar} = require('baz');
  if (isMultiRequire(node)) {
    const decl = node.declarations[0];
    const source = decl.init.arguments[0].value;
    const pattern = decl.id;

    for (const {key, value} of pattern.properties) {
      const imported = getPropertyName(key);
      state.imports.set(value.name, [imported, source]);
    }

    return;
  }

  // const {foo, bar} = baz;
  // TODO: const foo = baz.foo;
  if (isIdentRequire(node, state.imports)) {
    const decl = node.declarations[0];
    const source = state.imports.get(decl.init.name)[1];
    const pattern = decl.id;

    for (const {key, value} of pattern.properties) {
      const imported = getPropertyName(key);
      state.imports.set(value.name, [imported, source]);
    }

    return;
  }

  // const foo = require('bar').baz;
  // const foo = require('bar')['baz'];
  if (isMemberRequire(node)) {
    const decl = node.declarations[0];
    const name = decl.id.name;
    const source = decl.init.object.arguments[0].value;
    const imported = getPropertyName(decl.init.property);

    state.imports.set(name, [imported, source]);

    return;
  }

  // var foo = exports;
  // var foo = module.exports;
  const alias = isVariableAlias(node, state.alias);

  if (alias) {
    state.alias.add(alias);
    return;
  }

  // foo = exports;
  // foo = module.exports;
  if (isAssignmentAlias(node, state.alias)) {
    state.alias.add(node.expression.left.name);
    return;
  }

  // foo = 'something else';
  if (isAliasReassign(node, state.alias)) {
    state.alias.delete(node.expression.left.name);
    return;
  }

  // exports.foo = bar;
  // exports['foo'] = bar;
  if (isExportsAssign(node, state.alias)) {
    const key = getPropertyName(node.expression.left.property);
    setExport(state, key, node.expression.right);
    return;
  }

  // Object.defineProperty(exports, 'foo', bar);
  if (isExportsDefine(node, state.alias)) {
    const key = node.expression.arguments[1];
    state.exports.set(key.value, null);
    return;
  }

  // module.exports.foo = bar;
  // module.exports['foo'] = bar;
  // module['exports']['foo'] = bar;
  if (isModuleExportsAssign(node)) {
    const key = getPropertyName(node.expression.left.property);
    setExport(state, key, node.expression.right);
    return;
  }

  // Object.defineProperty(module.exports, 'foo', bar);
  // Object.defineProperty(module['exports'], 'foo', bar);
  if (isModuleExportsDefine(node)) {
    const key = node.expression.arguments[1];
    state.exports.set(key.value, null);
    return;
  }

  // if (foo) module.exports = bar; else module.exports = baz;
  // if (node.type === 'IfStatement') {
  //   acorn.walk.full(node, (child) => {
  //     if (isModuleExportsOverwrite(child))
  //       node = child;
  //   });
  // }

  // module.exports = { a, b, c };
  // module['exports'] = { a, b, c };
  // module.exports = foo;
  // module['exports'] = foo;
  if (isModuleExportsOverwrite(node)) {
    const rhs = node.expression.right;

    if (rhs.type === 'Identifier')
      state.alias.add(rhs.name);

    if (rhs.type === 'ObjectExpression') {
      for (const prop of rhs.properties) {
        const key = getPropertyName(prop.key);
        setExport(state, key, prop.value);
      }
    } else {
      setExport(state, 'default', rhs);
    }

    return;
  }
}

/*
 * AST Helpers
 */

function setExport(state, key, node) {
  if (isIdentifier(node)) {
    state.exports.set(key, state.imports.get(node.name) || null);
  } else if (isRequire(node)) {
    state.exports.set(key, ['default', node.arguments[0].value]);
  } else if (isRequireDot(node)) {
    const source = node.object.arguments[0].value;
    const imported = getPropertyName(node.property);

    state.exports.set(key, [imported, source]);
  } else {
    state.exports.set(key, null);
  }
}

function isSingleRequire(node) {
  // const foo = require('bar');
  if (node.type !== 'VariableDeclaration')
    return false;

  if (node.kind !== 'const')
    return false;

  if (node.declarations.length !== 1)
    return false;

  const [decl] = node.declarations;

  if (decl.type !== 'VariableDeclarator')
    return false;

  if (decl.id.type !== 'Identifier')
    return false;

  if (decl.init == null)
    return false;

  return isRequire(decl.init);
}

function isMultiRequire(node) {
  // const {foo, bar} = require('baz');
  if (node.type !== 'VariableDeclaration')
    return false;

  if (node.kind !== 'const')
    return false;

  if (node.declarations.length !== 1)
    return false;

  const [decl] = node.declarations;

  if (decl.type !== 'VariableDeclarator')
    return false;

  if (decl.id.type !== 'ObjectPattern')
    return false;

  if (decl.init == null)
    return false;

  return isRequire(decl.init);
}

function isIdentRequire(node, imports) {
  // const {foo, bar} = baz;
  if (node.type !== 'VariableDeclaration')
    return false;

  if (node.kind !== 'const')
    return false;

  if (node.declarations.length !== 1)
    return false;

  const [decl] = node.declarations;

  if (decl.type !== 'VariableDeclarator')
    return false;

  if (decl.id.type !== 'ObjectPattern')
    return false;

  if (decl.init == null)
    return false;

  if (decl.init.type !== 'Identifier')
    return false;

  const desc = imports.get(decl.init.name);

  return desc && desc[0] === 'default';
}

function isMemberRequire(node) {
  // const foo = require('bar').baz;
  // const foo = require('bar')['baz'];
  if (node.type !== 'VariableDeclaration')
    return false;

  if (node.kind !== 'const')
    return false;

  if (node.declarations.length !== 1)
    return false;

  const [decl] = node.declarations;

  if (decl.type !== 'VariableDeclarator')
    return false;

  if (decl.id.type !== 'Identifier')
    return false;

  if (decl.init == null)
    return false;

  return isRequireDot(decl.init);
}

function isRequire(node) {
  // require('foo')
  if (node.type !== 'CallExpression')
    return false;

  if (node.callee.type !== 'Identifier')
    return false;

  if (node.callee.name !== 'require')
    return false;

  if (node.arguments.length !== 1)
    return false;

  return isStringLiteral(node.arguments[0]);
}

function isRequireDot(node) {
  // require('bar').baz
  // require('bar')['baz']
  if (node.type !== 'MemberExpression')
    return false;

  if (!isRequire(node.object))
    return false;

  return isProperty(node.property);
}

function isVariableAlias(node, alias) {
  // var foo = exports;
  // var foo = module.exports;
  if (node.type !== 'VariableDeclaration')
    return null;

  for (const {id, init} of node.declarations) {
    if (!isIdentifier(id))
      continue;

    if (init == null)
      continue;

    if (isExportsIdentifier(init, alias))
      return id.name;

    if (isMemberAccess(init, 'module', 'exports'))
      return id.name;
  }

  return null;
}

function isAssignmentAlias(node, alias) {
  // foo = exports;
  // foo = module.exports;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (!isAssignment(expr))
    return false;

  if (!isIdentifier(expr.left))
    return false;

  if (isExportsIdentifier(expr.right, alias))
    return true;

  if (isMemberAccess(expr.right, 'module', 'exports'))
    return true;

  return false;
}

function isAliasReassign(node, alias) {
  // foo = 'something else';
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (!isAssignment(expr))
    return false;

  if (!isExportsIdentifier(expr.left, alias))
    return false;

  if (expr.left.name === 'exports')
    return false;

  if (isExportsIdentifier(expr.right, alias))
    return false;

  if (isMemberAccess(expr.right, 'module', 'exports'))
    return false;

  return true;
}

function isExportsAssign(node, alias) {
  // exports.foo = bar;
  // exports['foo'] = bar;
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  if (!isAssignment(expr))
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

  if (!isAssignment(expr))
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

  if (!isAssignment(expr))
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

function isAssignment(node) {
  if (node.type !== 'AssignmentExpression')
    return false;

  if (node.operator !== '=')
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

function isUseStrict(node) {
  if (node.type !== 'ExpressionStatement')
    return false;

  const expr = node.expression;

  return isStringLiteral(expr) && expr.value === 'use strict';
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

  if (func.params[0].type !== 'Identifier')
    return false;

  if (func.params[0].name !== 'global')
    return false;

  let found = -1;

  for (let i = 0; i < func.body.body.length; i++) {
    const child = func.body.body[i];

    if (child.type === 'VariableDeclaration' &&
        child.declarations.length === 1 &&
        child.declarations[0].id.type === 'Identifier' &&
        child.declarations[0].id.name === '__browser_modules__') {
      found = i;
      break;
    }
  }

  if (found < 0)
    return false;

  // Check for UMD wrapper.
  for (let i = found + 1; i < func.body.body.length; i++) {
    const child = func.body.body[i];

    if (child.type === 'FunctionDeclaration' &&
        child.id.type === 'Identifier' &&
        child.id.name === '__browser_main__') {
      return true;
    }
  }

  return false;
}

// See: https://rollupjs.org/repl
function isRollupUMD(node) {
  // (function (global, factory) {
  // })(this, (function (exports) {
  // }));
  if (!isFunctionWrapper(node))
    return false;

  const args = node.expression.arguments;
  const p = node.expression.callee.params;

  if (p.length === 0 || args.length === 0)
    return false;

  if (!isIdentifierName(p[p.length - 1], 'factory'))
    return false;

  const func = args[args.length - 1];

  if (func.type !== 'FunctionExpression')
    return false;

  const {params, body} = func;

  if (params.length === 0 || body.type !== 'BlockStatement')
    return false;

  if (!isIdentifierName(params[params.length - 1], 'exports'))
    return false;

  return true;
}

function extractModule(node) {
  if (node.type !== 'VariableDeclaration')
    return null;

  if (node.declarations.length !== 1)
    return null;

  const {id, init} = node.declarations[0];

  if (id.type !== 'Identifier')
    return false;

  if (init == null)
    return false;

  if (id.name !== '__node_modules__' &&
      id.name !== '__browser_modules__') {
    return null;
  }

  if (init.type !== 'ArrayExpression')
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

function pluckWrapper(root) {
  let length = root.body.length;
  let i = 0;

  while (length > 0 && root.body[length - 1].type === 'EmptyStatement')
    length--;

  for (; i < length; i++) {
    const node = root.body[i];

    if (isUseStrict(node))
      continue;

    if (node.type === 'EmptyStatement')
      continue;

    break;
  }

  if (i !== length - 1)
    return null;

  const node = root.body[i];

  if (isBrowserWrapper(node)) {
    const func = node.expression.callee;

    for (const child of func.body.body) {
      const mod = extractModule(child);

      if (mod)
        return mod;
    }

    return null;
  }

  if (isRollupUMD(node)) {
    const args = node.expression.arguments;
    const func = args[args.length - 1];

    return {
      type: 'Program',
      start: func.body.start,
      end: func.body.end,
      body: func.body.body
    };
  }

  if (isFunctionWrapper(node)) {
    const func = node.expression.callee;

    return {
      type: 'Program',
      start: func.body.start,
      end: func.body.end,
      body: func.body.body
    };
  }

  return null;
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
  return analyze(root).exports;
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
