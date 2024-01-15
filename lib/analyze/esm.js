/*!
 * esm.js - es module dependency analysis for bpkg
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
        case 'ImportDefaultSpecifier':
          // import foo from 'module';
          state.imports.set(local.name, ['default', source]);
          break;
        case 'ImportNamespaceSpecifier':
          // import * as foo from 'module';
          state.imports.set(local.name, ['*', source]);
          break;
        case 'ImportSpecifier':
          // import { bar as foo } from 'module';
          state.imports.set(local.name, [imported.name, source]);
          break;
        default:
          throw new Error(`Unexpected token: ${type}.`);
      }
    }

    return;
  }

  if (node.type === 'ExportAllDeclaration') {
    const source = node.source.value;
    if (node.exported) {
      // export * as foo from 'module';
      state.exports.set(node.exported.name, ['*', source]);
    } else {
      // export * from 'foo';
      state.reexports.add(source);
    }
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
          for (const {id} of decl.declarations) {
            if (id.type === 'Identifier') {
              state.exports.set(id.name, null);
            } else if (id.type === 'ObjectPattern') {
              for (const {value} of id.properties)
                state.exports.set(value.name, null);
            } else if (id.type === 'ArrayPattern') {
              for (const el of id.elements) {
                if (el)
                  state.exports.set(el.name, null);
              }
            }
          }
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
    }

    // export { foo as bar };
    // export { foo as bar } from 'module';
    const source = node.source ? node.source.value : null;

    for (const {exported, local} of node.specifiers) {
      if (source)
        state.exports.set(exported.name, [local.name, source]);
      else
        state.exports.set(exported.name, state.imports.get(local.name) || null);
    }
  }
}

/*
 * Helpers
 */

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
  return analyze(root).exports;
}

/*
 * Expose
 */

exports.analyze = analyze;
exports.parse = parse;
exports.getExports = getExports;

/*
 * Test
 */

if (require.main === module)
  getExports(process.argv[2]).then(console.log);
