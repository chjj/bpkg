/*!
 * esm.js - es module dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');

/*
 * Analyze
 */

async function analyze(root, resolve) {
  assert(root && root.type === 'Program');
  assert(typeof resolve === 'function');

  const state = {
    exports: new Set()
  };

  for (const node of root.body)
    await visitor(node, state, resolve);

  return state.exports;
}

async function visitor(node, state, resolve) {
  if (node.type === 'ExportAllDeclaration') {
    if (node.exported) {
      // export * as foo from 'module';
      state.exports.add(node.exported.name);
    } else {
      // export * from 'foo';
      for (const key of await resolve(node.source.value)) {
        if (key !== 'default')
          state.exports.add(key);
      }
    }
    return;
  }

  if (node.type === 'ExportDefaultDeclaration') {
    // export default foo;
    state.exports.add('default');
    return;
  }

  if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;

      switch (decl.type) {
        case 'VariableDeclaration': {
          // export var/let/const foo = 1;
          for (const {id} of decl.declarations) {
            if (id.type === 'ArrayPattern') {
              for (const el of id.elements) {
                if (el)
                  state.exports.add(el.name);
              }
            } else if (id.type === 'ObjectPattern') {
              for (const {value} of id.properties)
                state.exports.add(value.name);
            } else {
              state.exports.add(id.name);
            }
          }
          break;
        }

        case 'FunctionDeclaration':
        case 'ClassDeclaration': {
          // export function foo() {}
          // export class foo {}
          state.exports.add(id.name);
          break;
        }

        default: {
          throw new Error(`Unexpected token: ${type}.`);
        }
      }
    }

    // export { foo as bar };
    for (const {exported} of node.specifiers)
      state.exports.add(exported.name);
  }
}

/*
 * Expose
 */

exports.analyze = analyze;

/*
 * Test
 */

if (!module.parent) {
  const fs = require('fs');
  const acorn = require('../../vendor/acorn');
  const code = fs.readFileSync(process.argv[2], 'utf8');

  const root = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    allowReturnOutsideFunction: false
  });

  const resolve = x => Promise.resolve([x]);

  analyze(root, resolve).then(console.log);
}
