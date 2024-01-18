'use strict';

const assert = require('assert');
const acorn = require('../../vendor/acorn');
const base = acorn.walk.base;
const skipThrough = base.Statement;

/**
 * Scope
 */

class Scope {
  constructor(node, parent = null, depth = 0) {
    this.node = node;
    this.parent = parent;
    this.depth = depth;
    this.vars = new Map();
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
}

/**
 * ScopeAnalyzer
 */

class ScopeAnalyzer {
  constructor(root, options = null) {
    assert(root && root.type === 'Program');

    this.root = root;
    this.scope = new Scope(root);
    this.imports = new Map();
    this.refs = new Set();
    this.ctr = 0;

    if (options != null)
      this.init(options);
  }

  init(options) {
    assert(options && typeof options === 'object');

    if (options.vars != null) {
      assert(options.vars instanceof Map);
      this.scope.vars = options.vars;
    }

    if (options.imports != null) {
      assert(options.imports instanceof Map);
      this.imports = options.imports;
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
      imports: this.imports,
      refs: this.refs
    };
  }

  addImportRef(node) {
    const result = this.scope.findVar(node.name);

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

  block(node, type) {
    if (!node)
      return;

    if (node.type === 'BlockStatement') {
      for (const child of node.body)
        this.walk(child, 'Statement');
    } else {
      this.walk(node, type);
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
              break;
            case 'ImportDefaultSpecifier':
              // import foo from 'module';
              scope.vars.set(local.name, 'default');
              this.imports.set(local.name, `${name}['default']`);
              break;
            case 'ImportSpecifier':
              // import { bar as foo } from 'module';
              scope.vars.set(local.name, 'import');
              this.imports.set(local.name, `${name}.${imported.name}`);
              break;
            default:
              throw new Error(`Unexpected token: ${type}.`);
          }
        }

        break;
      }

      case 'FunctionDeclaration': {
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
        this.hoist(node.body);
        break;
      }

      case 'BlockStatement':
      case 'StaticBlock': {
        for (const child of node.body)
          this.hoist(child);
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

  walk(node, override = null) {
    const {scope} = this;

    if (!node)
      return;

    switch (node.type) {
      case 'Program': {
        this.hoist(node);
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

      case 'CatchClause': {
        const child = scope.child(node);

        this.push(child);

        this.add(child, node.param, 'param');
        // this.walk(node.param, 'Pattern');
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

        for (const child of node.body)
          this.walk(child, 'Statement');

        this.pop();

        break;
      }

      case 'VariableDeclaration': {
        if (node.kind !== 'var') {
          for (const {id} of node.declarations)
            this.add(scope, id, 'var');
        }

        for (const child of node.declarations)
          this.walk(child);

        break;
      }

      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          this.walk(node.declaration, 'Statement');
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