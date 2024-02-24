/*!
 * scope.js - scope analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const acorn = require('../../vendor/acorn');
const utils = require('../utils');
const base = acorn.walk.base;
const skipThrough = base.Statement;
const {dot, getIdents, getName} = utils;

/**
 * Scope
 */

class Scope {
  constructor(node, parent = null, depth = 0) {
    this.node = node;
    this.parent = parent;
    this.depth = depth;
    this.strict = false;
    this.vars = new Map();
    this._init(node, parent, depth);
  }

  _init(node, parent, depth) {
    assert((node.type === 'Program') === !parent);
    assert((depth === 0) === !parent);

    if (parent && parent.strict) {
      this.strict = true;
      return;
    }

    this.strict = isStrict(node);
  }

  child(node) {
    return new Scope(node, this, this.depth + 1);
  }

  *scopes() {
    for (let scope = this; scope; scope = scope.parent)
      yield scope;
  }

  findVar(name) {
    for (const scope of this.scopes()) {
      const result = scope.vars.get(name);

      if (result != null)
        return result;
    }

    return null;
  }

  isTopLevel(name) {
    for (const scope of this.scopes()) {
      const result = scope.vars.get(name);

      if (result != null)
        return scope.depth === 0;
    }

    return false;
  }

  isFunctionScope() {
    for (const {node} of this.scopes()) {
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          return true;
      }
    }
    return false;
  }
}

/**
 * ScopeAnalyzer
 */

class ScopeAnalyzer {
  constructor(root, options = null) {
    assert(root && root.type === 'Program');

    this.root = root;
    this.scope = new Scope(root);
    this.globalRefs = new Set();
    this.imports = new Map();
    this.exports = new Set();
    this.reexports = new Set();
    this.refs = new Set();
    this.consts = new Set();
    this.tla = false;
    this.ctr = 0;

    if (options != null)
      this.init(options);
  }

  init(options) {
    assert(options && typeof options === 'object');

    if (options.strict != null) {
      assert(typeof options.strict === 'boolean');
      this.scope.strict = options.strict;
    }

    if (options.vars != null) {
      assert(options.vars instanceof Map);
      this.scope.vars = options.vars;
    }

    if (options.imports != null) {
      assert(options.imports instanceof Map);
      this.imports = options.imports;
    }

    if (options.exports != null) {
      assert(options.exports instanceof Set);
      this.exports = options.exports;
    }

    if (options.consts != null) {
      assert(options.consts instanceof Set);
      this.consts = options.consts;
    }
  }

  push(child) {
    assert(child.parent === this.scope);
    this.scope = child;
  }

  pop() {
    assert(this.scope.parent);
    this.scope = this.scope.parent;
  }

  analyze() {
    this.walk(this.root);

    return {
      globalRefs: this.globalRefs,
      imports: this.imports,
      exports: this.exports,
      reexports: this.reexports,
      refs: this.refs,
      consts: this.consts,
      tla: this.tla
    };
  }

  addImportRef(node) {
    const result = this.scope.findVar(node.name);

    if (result == null) {
      this.globalRefs.add(node);
      return;
    }

    switch (result) {
      case 'default':
      case 'import':
        this.refs.add(node);
        break;
    }
  }

  add(scope, node, type) {
    if (!node)
      return;

    if (node.type === 'Identifier') {
      scope.vars.set(node.name, type);
      if (scope.depth === 0)
        this.consts.add(node.name);
    } else if (node.type === 'ObjectPattern') {
      for (const prop of node.properties)
        this.add(scope, prop, type);
    } else if (node.type === 'ArrayPattern') {
      for (const el of node.elements)
        this.add(scope, el, type);
    } else if (node.type === 'Property') {
      this.add(scope, node.value, type);
    } else if (node.type === 'AssignmentPattern') {
      this.add(scope, node.left, type);
    } else if (node.type === 'RestElement') {
      this.add(scope, node.argument, type);
    }
  }

  unconst(scope, node) {
    if (!node)
      return;

    if (node.type === 'Identifier') {
      if (scope.isTopLevel(node.name))
        this.consts.delete(node.name);
    } else if (node.type === 'ObjectPattern') {
      for (const prop of node.properties)
        this.unconst(scope, prop);
    } else if (node.type === 'ArrayPattern') {
      for (const el of node.elements)
        this.unconst(scope, el);
    } else if (node.type === 'Property') {
      this.unconst(scope, node.value);
    } else if (node.type === 'AssignmentPattern') {
      this.unconst(scope, node.left);
    } else if (node.type === 'RestElement') {
      this.unconst(scope, node.argument);
    }
  }

  hoist(node) {
    const {scope} = this;

    if (!node)
      return;

    switch (node.type) {
      case 'Program': {
        for (const child of node.body)
          this.hoist(child);
        break;
      }

      case 'ImportDeclaration': {
        const name = `__bpkg_import_${this.ctr++}__`;

        for (const {type, imported, local} of node.specifiers) {
          switch (type) {
            case 'ImportNamespaceSpecifier':
              // import * as foo from 'module';
              scope.vars.set(local.name, 'namespace');
              this.imports.set(local.name, name);
              // this.consts.add(local.name);
              break;
            case 'ImportDefaultSpecifier':
              // import foo from 'module';
              scope.vars.set(local.name, 'default');
              this.imports.set(local.name, `${name}['default']`);
              // this.consts.add(local.name);
              break;
            case 'ImportSpecifier':
              // import { bar as foo } from 'module';
              scope.vars.set(local.name, 'import');
              this.imports.set(local.name, `${name}${dotName(imported)}`);
              // this.consts.add(local.name);
              break;
            default:
              throw new Error(`Unexpected token: ${type}.`);
          }
        }

        break;
      }

      case 'FunctionDeclaration': {
        if (!scope.strict) // Handled in hoistFuncs.
          this.add(scope, node.id, 'func');
        break;
      }

      case 'ForStatement': {
        this.hoist(node.init);
        this.hoist(node.body);
        break;
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        this.hoist(node.left);
        this.hoist(node.body);
        break;
      }

      case 'WhileStatement':
      case 'DoWhileStatement': {
        this.hoist(node.body);
        break;
      }

      case 'IfStatement': {
        this.hoist(node.consequent);
        this.hoist(node.alternate);
        break;
      }

      case 'SwitchStatement': {
        for (const case_ of node.cases) {
          for (const cons of case_.consequent)
            this.hoist(cons);
        }
        break;
      }

      case 'SwitchCase': {
        for (const cons of node.consequent)
          this.hoist(cons);
        break;
      }

      case 'TryStatement': {
        this.hoist(node.block);
        this.hoist(node.handler);
        this.hoist(node.finalizer);
        break;
      }

      case 'CatchClause': {
        this.hoist(node.body);
        break;
      }

      case 'LabeledStatement': {
        this.hoist(node.body);
        break;
      }

      case 'WithStatement': {
        if (scope.strict)
          throw new Error('Cannot use `with` statement in strict mode.');

        this.hoist(node.body);

        break;
      }

      case 'BlockStatement':
      case 'StaticBlock': {
        for (const child of node.body)
          this.hoist(child);
        break;
      }

      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration': {
        this.hoist(node.declaration);
        break;
      }

      case 'VariableDeclaration': {
        if (node.kind === 'var') {
          for (const {id} of node.declarations)
            this.add(scope, id, 'var');
        }
        break;
      }

      default: {
        break;
      }
    }
  }

  hoistFuncs(node) {
    const {scope} = this;

    if (!scope.strict) // Handled in hoist.
      return;

    switch (node.type) {
      case 'Program': {
        for (const child of node.body) {
          switch (child.type) {
            case 'FunctionDeclaration': {
              this.add(scope, child.id, 'func');
              break;
            }
            case 'ExportDefaultDeclaration':
            case 'ExportNamedDeclaration': {
              const decl = child.declaration;
              if (decl && decl.type === 'FunctionDeclaration')
                this.add(scope, decl.id, 'func');
              break;
            }
          }
        }
        break;
      }
      case 'BlockStatement':
      case 'StaticBlock': {
        for (const child of node.body) {
          if (child.type === 'FunctionDeclaration')
            this.add(scope, child.id, 'func');
        }
        break;
      }
      case 'SwitchStatement': {
        for (const case_ of node.cases) {
          for (const cons of case_.consequent) {
            if (cons.type === 'FunctionDeclaration')
              this.add(scope, cons.id, 'func');
          }
        }
        break;
      }
      default: {
        throw new Error('unreachable');
      }
    }
  }

  block(node, type) {
    if (!node)
      return;

    if (node.type === 'BlockStatement') {
      this.hoistFuncs(node);
      for (const child of node.body)
        this.walk(child, 'Statement');
    } else {
      this.walk(node, type);
    }
  }

  walk(node, override = null) {
    const {scope} = this;

    if (!node)
      return;

    switch (node.type) {
      case 'Program': {
        this.hoist(node);
        this.hoistFuncs(node);
        for (const child of node.body)
          this.walk(child, 'Statement');
        break;
      }

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const child = scope.child(node);

        this.push(child);

        if (node.id) {
          if (node.type === 'FunctionExpression')
            this.add(child, node.id, 'func');
          // this.walk(node.id, 'Pattern');
        }

        for (const param of node.params) {
          this.add(child, param, 'param');
          this.walk(param, 'Pattern');
        }

        this.hoist(node.body);
        this.block(node.body, node.expression ? 'Expression' : 'Statement');

        this.pop();

        break;
      }

      case 'ClassDeclaration': {
        this.add(scope, node.id, 'class');
        // this.walk(node.id, 'Pattern');
        this.walk(node.superClass, 'Expression');
        this.walk(node.body);
        break;
      }

      case 'ForStatement': {
        const child = scope.child(node);

        this.push(child);

        this.walk(node.init, 'ForInit');
        this.walk(node.test, 'Expression');
        this.walk(node.update, 'Expression');
        this.block(node.body, 'Statement');

        this.pop();

        break;
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        const child = scope.child(node);

        this.push(child);

        this.walk(node.left, 'ForInit');
        this.walk(node.right, 'Expression');
        this.block(node.body, 'Statement');

        this.pop();

        break;
      }

      case 'SwitchStatement': {
        const child = scope.child(node);

        this.push(child);

        this.hoistFuncs(node);

        this.walk(node.discriminant, 'Expression');

        for (const case_ of node.cases) {
          this.walk(case_.test, 'Expression');

          for (const cons of case_.consequent)
            this.walk(cons, 'Statement');
        }

        this.pop();

        break;
      }

      case 'CatchClause': {
        const child = scope.child(node);

        this.push(child);

        this.add(child, node.param, 'param');
        this.walk(node.param, 'Pattern');
        this.block(node.body, 'Statement');

        this.pop();

        break;
      }

      case 'BlockStatement':
      case 'StaticBlock': {
        const child = scope.child(node);

        this.push(child);

        if (node.type === 'StaticBlock')
          this.hoist(node);

        this.hoistFuncs(node);

        for (const child of node.body)
          this.walk(child, 'Statement');

        this.pop();

        break;
      }

      case 'VariableDeclaration': {
        if (node.kind !== 'var') {
          for (const {id} of node.declarations)
            this.add(scope, id, node.kind);
        }

        for (const child of node.declarations)
          this.walk(child);

        break;
      }

      case 'AssignmentExpression': {
        this.unconst(scope, node.left);
        this.walk(node.left, 'Pattern');
        this.walk(node.right, 'Expression');
        break;
      }

      case 'AwaitExpression': {
        if (!this.tla && !scope.isFunctionScope())
          this.tla = true;

        this.walk(node.argument, 'Expression');

        break;
      }

      case 'ExportAllDeclaration': {
        if (node.exported) {
          // export * as foo from 'module';
          this.exports.add(getName(node.exported));
        } else {
          // export * from 'foo';
          this.reexports.add(node.source.value);
        }

        this.walk(node.exported);
        this.walk(node.source, 'Expression');

        break;
      }

      case 'ExportDefaultDeclaration': {
        // export default foo;
        this.exports.add('default');

        if (node.declaration.id)
          this.walk(node.declaration, 'Statement');
        else
          this.walk(node.declaration, 'Expression');

        break;
      }

      case 'ExportNamedDeclaration': {
        // export [statement];
        const decl = node.declaration;

        if (decl) {
          if (decl.type === 'VariableDeclaration') {
            for (const key of getIdents(decl))
              this.exports.add(key);
          } else {
            this.exports.add(decl.id.name);
          }
        } else {
          for (const {exported} of node.specifiers)
            this.exports.add(getName(exported));
        }

        if (node.declaration) {
          this.walk(node.declaration, 'Statement');
        } else if (node.source) {
          this.walk(node.source, 'Expression');
        } else {
          for (const {local} of node.specifiers)
            this.addImportRef(local);
        }

        break;
      }

      case 'Identifier': {
        if (override === 'Expression')
          this.addImportRef(node);
        break;
      }

      default: {
        let visitor = base[override || node.type];

        if (visitor === skipThrough)
          visitor = base[node.type];

        visitor(node, this, (child, state, type = null) => {
          state.walk(child, type);
        });

        break;
      }
    }
  }
}

/*
 * Helpers
 */

function isStrict(root) {
  let body = null;

  if (root.type === 'Program') {
    assert(root.sourceType != null);

    if (root.sourceType === 'module')
      return true;
  }

  switch (root.type) {
    case 'Program':
      body = root.body;
      break;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      if (root.body.type === 'BlockStatement')
        body = root.body.body;
      break;
  }

  if (!body || body.length === 0)
    return false;

  const node = body[0];

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

function dotName(node) {
  return dot(getName(node));
}

function walkSync(root, state, filter) {
  let last = null;

  (function next(node, state, override) {
    const type = override || node.type;
    const isNew = last !== node;

    last = node;

    if (isNew) {
      const result = filter(node, state);

      if (result === false)
        return;
    }

    base[type](node, state, next);
  })(root, state, null);
}

function replaceSync(root, code, replacer) {
  const results = [];

  walkSync(root, {}, (node) => {
    const result = replacer(node, code);

    if (result == null)
      return true;

    results.push(result);

    return false;
  });

  if (results.length === 0)
    return code;

  let out = '';
  let offset = 0;

  results.sort(([x], [y]) => {
    return x.start - y.start;
  });

  for (const [{start, end}, value] of results) {
    assert(offset <= start);

    out += code.substring(offset, start);
    out += value;

    offset = end;
  }

  out += code.substring(offset);

  return out;
}

/*
 * API
 */

function analyze(root, options) {
  return new ScopeAnalyzer(root, options).analyze();
}

function replace(root, code, options) {
  const {imports, refs} = analyze(root, options);

  return replaceSync(root, code, (node) => {
    if (node.type === 'Property' && node.shorthand) {
      if (refs.has(node.value)) {
        const key = node.value.name;
        const value = imports.get(key);

        assert(value != null);

        return [node, `${key}: ${value}`];
      }

      return null;
    }

    if (!refs.has(node))
      return null;

    const value = imports.get(node.name);

    assert(value != null);

    return [node, value];
  });
}

/*
 * Expose
 */

exports.analyze = analyze;
exports.replace = replace;
