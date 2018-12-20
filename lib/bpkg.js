/*!
 * bpkg.js - minimal bundler for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const Path = require('path');
const mod = require('module');
const os = require('os');
const bindings = require('../vendor/bindings');
const acorn = require('../vendor/acorn');
const walk = require('../vendor/walk');
const builtins = require('./builtins');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep
} = Path;

/*
 * Constants
 */

const CWD = process.cwd();

const WRAPPER = [
  'function(exports, require, module, __filename, __dirname) {',
  '}'
];

/**
 * Bundler
 */

class Bundler {
  constructor() {
    this.files = new Map();
    this.root = null;
    this.modules = [];
    this.id = 0;
    this.bindings = new Set();
    this.env = 'node';
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.tmp = os.tmpdir();
    this.hasBindings = false;
    this.hasTimers = false;
    this.hasProcess = false;
    this.hasBuffer = false;
    this.hasConsole = false;
  }

  module(parent, path, location) {
    if (!this.files.has(path)) {
      const file = new Module(this, parent, path, location);

      if (!this.root)
        this.root = file;

      this.files.set(path, file);
      this.modules.push(file);

      file.init();
    }

    return this.files.get(path);
  }

  bundle(file) {
    const path = resolve(CWD, file);
    const tmp = resolve(this.tmp, '.') + sep;
    const root = this.module(null, path, null);
    const modules = [];

    let timers = null;
    let _process = null;
    let buffer = null;
    let console = null;

    if (this.env === 'browser') {
      if (this.hasTimers)
        timers = this.module(root, builtins.timers, 'timers').id;

      if (this.hasProcess)
        _process = this.module(root, builtins._process, 'process').id;

      if (this.hasBuffer)
        buffer = this.module(root, builtins.buffer, 'buffer').id;

      if (this.hasConsole)
        console = this.module(root, builtins.console, 'console').id;
    }

    for (const {id, location, code} of this.modules)
      modules.push(`  [/* ${id} */ ${stringify(location)}, ${code}]`);

    let out = '';

    if (this.env === 'browser') {
      out = template('browser.js', {
        timers,
        process: _process,
        buffer,
        console,
        modules: modules.join(',\n')
      });
    } else {
      out = template('node.js', {
        hashbang: root.hashbang,
        modules: modules.join(',\n'),
        bindings: this.hasBindings,
        tmp: stringify(tmp)
      });
    }

    return out.trim();
  }
}

/**
 * Module
 */

class Module {
  constructor(bundler, parent, path_, location) {
    const browser = bundler.env === 'browser' || bundler.browserField;
    const {path, root, pkg, resolve} = requirify(path_, browser);

    if (location == null)
      location = readJSON(pkg).name || 'root';

    if (parent) {
      if (location[0] === '/')
        ;
      else if (location[0] === '.')
        location = Path.resolve(parent.location, location);
      else
        location = '/' + location;
    } else {
      location = '/' + location;
    }

    this.bundler = bundler;
    this.id = this.bundler.id++;
    this.parent = parent;
    this.path = path;
    this.dir = dirname(path);
    this.name = basename(path);
    this.ext = extname(path);
    this.location = location;
    this.type = this.getType();
    this.root = root;
    this.pkg = pkg;
    this.resolve = resolve;
    this.hashbang = '';
    this.code = '';
  }

  init() {
    this.code = this.compile();
    return this;
  }

  getType() {
    switch (this.ext) {
      case '.json':
        return 'json';
      case '.node':
        return 'binding';
      case '':
        return 'bin';
      default:
        return 'lib';
    }
  }

  makeError(str) {
    return `__${this.bundler.env}_error__(${stringify(str)})`;
  }

  makeRequire(id) {
    if (this.bundler.env === 'browser')
      return `__browser_require__(${id}, module)`;
    return `__node_require__(${id})`;
  }

  makeRawRequire(path) {
    return `require(${stringify(path)})`;
  }

  makeOpen(path) {
    const name = basename(path);
    const b64 = fs.readFileSync(path).toString('base64');

    return '__node_dlopen__(module, '
         + `${stringify(name)},`
         + `${stringifyBig(b64)});`
         + '\n';
  }

  makeJSON(path) {
    const code = fs.readFileSync(path, 'utf8');
    const json = JSON.parse(code);

    return `module.exports = ${stringify(json, null, 2)};\n`;
  }

  readCode() {
    if (this.type === 'binding')
      return this.makeOpen(this.path);

    if (this.type === 'json')
      return this.makeJSON(this.path);

    return fs.readFileSync(this.path, 'utf8');
  }

  compile() {
    let code = this.readCode();

    if (this.type === 'bin' || this.type === 'lib') {
      code = code.replace(/^#![^\n]*/, (hashbang) => {
        this.hashbang = hashbang;
        return '';
      });

      code = this.transform(code);
    }

    return [
      WRAPPER[0],
      indent(code.trim(), 2),
      indent(WRAPPER[1], 1)
    ].join('\n');
  }

  transform(code) {
    const root = acorn.parse(code, {
      ecmaVersion: 10,
      sourceType: 'module',
      allowHashBang: true
    });

    let out = '';
    let offset = 0;
    let id = 0;

    walk.full(root, (node) => {
      let filter;

      switch (node.type) {
        case 'CallExpression':
          filter = this.CallExpression;
          break;
        case 'ImportDeclaration':
          filter = this.ImportDeclaration;
          id += 1;
          break;
        case 'ExportAllDeclaration':
          filter = this.ExportAllDeclaration;
          break;
        case 'ExportDefaultDeclaration':
          filter = this.ExportDefaultDeclaration;
          break;
        case 'ExportNamedDeclaration':
          filter = this.ExportNamedDeclaration;
          id += 1;
          break;
        case 'Identifier':
          filter = this.Identifier;
          break;
      }

      if (!filter)
        return;

      const result = filter.call(this, node, code, id);

      if (!result)
        return;

      const [{ start, end }, value] = result;

      out += code.substring(offset, start);
      out += value;

      offset = end;
    });

    out += code.substring(offset);

    return out;
  }

  require(location) {
    let path;

    try {
      path = this.resolve(location);
    } catch (e) {
      if (this.bundler.ignoreMissing) {
        if (this.bundler.env === 'browser')
          return this.makeError('Not found.');
        return this.makeRawRequire(location);
      }
      throw e;
    }

    if (extname(path) === '.node') {
      if (this.bundler.env === 'browser')
        return this.makeError('Not found.');

      if (this.bundler.collectBindings) {
        this.bundler.bindings.add(path);
        return this.makeRawRequire(`./${basename(path)}`);
      }

      this.bundler.hasBindings = true;
    }

    if (this.bundler.env === 'browser') {
      if (!isAbsolute(path)) {
        path = builtins[path];

        if (!path) {
          if (this.bundler.ignoreMissing)
            return this.makeError('Not found.');

          throw new Error(`Could not resolve module: ${path}.`);
        }
      }
    }

    if (isAbsolute(path)) {
      const file = this.bundler.module(this, path, location);

      return this.makeRequire(file.id);
    }

    return this.makeRawRequire(location);
  }

  isRequire(node) {
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'Identifier')
      return false;

    if (node.callee.name !== 'require')
      return false;

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal')
      return false;

    if (typeof arg.value !== 'string')
      return false;

    if (arg.value === 'bindings')
      return false;

    return true;
  }

  isBindings(node) {
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'CallExpression')
      return false;

    const child = node.callee;

    if (child.callee.type !== 'Identifier')
      return false;

    if (child.callee.name !== 'require')
      return false;

    if (child.arguments.length < 1)
      return false;

    const childArg = child.arguments[0];

    if (childArg.type !== 'Literal')
      return false;

    if (childArg.value !== 'bindings')
      return false;

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal')
      return false;

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  CallExpression(node) {
    if (this.isBindings(node)) {
      const arg = node.arguments[0];

      let path;
      try {
        path = bindings({ resolve: this.resolve }, {
          bindings: arg.value,
          path: true,
          module_root: this.root
        });
      } catch (e) {
        if (this.bundler.ignoreMissing)
          return this.makeError('Not found.');
        throw e;
      }

      path = relative(this.dir, path);

      if (path[0] !== '.')
        path = './' + path;

      return [node, this.require(path)];
    }

    if (this.isRequire(node)) {
      const arg = node.arguments[0];
      return [node, this.require(arg.value)];
    }

    return null;
  }

  ImportDeclaration(node, code, id) {
    const file = node.source.value;
    const imports = [];

    let default_ = null;
    let namespace = null;
    let out = '';

    if (node.specifiers.length === 0) {
      // import 'module';
      out = this.require(file) + ';\n';
      return [node, out];
    }

    for (const {type, imported, local} of node.specifiers) {
      switch (type) {
        case 'ImportDefaultSpecifier':
          // import foo from 'module';
          default_ = local.name;
          break;
        case 'ImportNamespaceSpecifier':
          // import * as foo from 'module';
          namespace = local.name;
          break;
        case 'ImportSpecifier':
          // import { bar as foo } from 'module';
          imports.push([imported.name, local.name]);
          break;
      }
    }

    const name = `__bundle_import_${id}__`;

    out += `var ${name} = `
        + this.require(file)
        + ';\n';

    if (default_) {
      out += `var ${default_} = ${name}.__esm\n`
           + `  ? ${name}.default\n`
           + `  : ${name};\n`;
    }

    if (namespace)
      out += `var ${namespace} = ${name};\n`;

    for (const [imported, local] of imports)
      out += `var ${local} = ${name}.${imported};\n`;

    return [node, out];
  }

  ExportAllDeclaration(node) {
    // export * from 'foo';
    let out = '';
    out += 'module.exports = exports = '
        + this.require(node.source.value)
        + ';\n';
    return [node, out];
  }

  ExportDefaultDeclaration(node, code) {
    // export default foo;
    const {start, end} = node.declaration;
    let out = '';
    out += 'exports.default = '
         + code.substring(start, end)
         + ';\n';
    out += 'exports.__esm = true;\n';
    return [node, out];
  }

  ExportNamedDeclaration(node, code, id) {
    const declarations = [];
    const exports = [];

    let source = null;
    let out = '';

    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;
      const {type, id, start, end} = decl;

      switch (type) {
        case 'VariableDeclaration':
          // export var/let/const foo = 1;
          for (const {id, init} of decl.declarations)
            declarations.push([id.name, init.raw]);
          break;
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
          // export function foo() {}
          // export class foo {}
          declarations.push([id.name, code.substring(start, end)]);
          break;
      }
    }

    for (const {type, exported, local} of node.specifiers) {
      switch (type) {
        case 'ExportSpecifier':
          // export { foo as bar };
          if (local.name === 'default')  {
            // Should have source:
            // export { default as foo } from 'module';
            // export { default } from 'module';
            assert(node.source);
          } else if (exported.name === 'default') {
            // Can have source or not.
            // export { foo as default };
            // export { foo as default } from 'module';
          }
          exports.push([local.name, exported.name]);
          break;
      }
    }

    if (node.source)  {
      // export { foo } from 'bar';
      source = node.source.value;
    }

    if (source) {
      const name = `__bundle_export_${id}__`;

      out += `var ${name} = `
          + this.require(source)
          + ';\n';

      for (const [value, key] of exports) {
        if (value === 'default') {
          out += `exports.${key} = ${name}.__esm\n`
               + `  ? ${name}.default\n`
               + `  : ${name};\n`;
          continue;
        }
        out += `exports.${key} = ${name}.${value};\n`;
      }
    } else {
      for (const [key, value] of declarations)
        out += `exports.${key} = ${value};\n`;

      for (const [value, key] of exports)
        out += `exports.${key} = ${value};\n`;
    }

    out += 'exports.__esm = true;\n';

    return [node, out];
  }

  Identifier(node) {
    switch (node.name) {
      case 'setTimeout':
      case 'clearTimeout':
      case 'setInterval':
      case 'clearInterval':
      case 'setImmediate':
      case 'clearImmediate':
        this.bundler.hasTimers = true;
        break;
      case 'process':
        this.bundler.hasProcess = true;
        break;
      case 'Buffer':
        this.bundler.hasBuffer = true;
        break;
      case 'console':
        this.bundler.hasConsole = true;
        break;
    }
    return null;
  }
}

/*
 * Resolution
 */

function findRoot(path) {
  const {root} = parse(__dirname);

  let dir = dirname(path);

  for (;;) {
    const loc = resolve(dir, 'package.json');

    if (exists(loc))
      return [dir, loc];

    if (dir === root)
      throw new Error('Could not find package.json.');

    dir = resolve(dir, '..');
  }
}

function requirify(path, browser) {
  let [root, pkg] = findRoot(path);
  let pathRequire = mod.createRequireFromPath(path);

  const resolveRoot = (location) => {
    if (location[0] === '/')
      return location;

    if (location[0] !== '.')
      return pathRequire.resolve(location);

    const path = resolve(root, location);

    return require.resolve(path);
  };

  if (browser) {
    const json = readJSON(pkg);

    if (!json.browser)
      json.browser = {};

    if (json.browser === false || typeof json.browser === 'string') {
      let main = json.main || './index.js';

      if (main[0] !== '.')
        main = './' + main;

      if (extname(main) === '')
        main += extname(resolveRoot(main));

      json.browser = {
        [main]: json.browser
      };
    }

    if (typeof json.browser !== 'object')
      throw new Error('Invalid browser field.');

    browser = Object.create(null);

    for (let key of Object.keys(json.browser)) {
      let field = json.browser[key];

      if (field !== false && typeof field !== 'string')
        continue;

      if (key.startsWith('./')) {
        if (extname(key) === '')
          key += extname(resolveRoot(key));
      } else {
        if (extname(key) !== '')
          key = './' + key;
      }

      if (field === false) {
        field = builtins.empty;
      } else if (field.startsWith('./')) {
        if (extname(field) === '')
          field += extname(resolveRoot(field));
      } else {
        if (extname(field) !== '')
          field = './' + field;
      }

      browser[key] = field;
    }

    if (Object.keys(browser).length > 0) {
      const full = require.resolve(path);
      const base = './' + relative(root, full);

      if (browser[base]) {
        path = resolveRoot(browser[base]);
        [root, pkg] = findRoot(path);
      }
    } else {
      browser = null;
    }
  }

  pathRequire = mod.createRequireFromPath(path);

  return {
    path,
    root,
    pkg,
    resolve: (location) => {
      const path = pathRequire.resolve(location);

      if (!browser)
        return path;

      if (!isAbsolute(path)) {
        if (path[0] !== '.' && browser[path])
          return resolveRoot(browser[path]);
        return path;
      }

      const file = './' + relative(root, path);

      if (browser[file])
        return resolveRoot(browser[file]);

      return path;
    }
  };
}

/*
 * Helpers
 */

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

function readJSON(file) {
  let text;

  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }

  return JSON.parse(text);
}

function stringify(...args) {
  return JSON.stringify(...args);
}

function stringifyBig(str) {
  let out = '`\n';

  for (let i = 0; i < str.length; i += 64) {
    out += '  ';
    out += str.substring(i, i + 64);
    out += '\n';
  }

  out += '`';

  return out;
}

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str;

  let spaces = '';

  for (let i = 0; i < depth * 2; i++)
    spaces += ' ';

  return str.replace(/^/gm, spaces)
            .replace(/^[ \t]+$/gm, ''); // TODO: Update bmocha.
}

/*
 * Templating
 */

const COMMENT_RX = /\/\*[\s\S]*?\*\//g;
const SYMBOL_RX = /__([0-9A-Z]+?)__/g;

const IF_RX = new RegExp(''
  + '(?:^|\\n)'
  + '// *if +__([0-9A-Z]+?)__\\n'
  + '([\\s\\S]+?)'
  + '// *endif'
  + '(?:\\n|$)',
  'g');

function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = fs.readFileSync(path, 'utf8');

  text = text.replace(COMMENT_RX, '');

  text = text.replace(IF_RX, (_, name, code) => {
    name = name.toLowerCase();

    if (values[name] == null
        || values[name] === false) {
      return '';
    }

    return '\n' + code;
  });

  text = text.replace(SYMBOL_RX, (_, name) => {
    name = name.toLowerCase();
    return String(values[name]);
  });

  return text;
}

/*
 * Expose
 */

exports.Bundler = Bundler;
