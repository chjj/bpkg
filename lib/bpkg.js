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
const cp = require('child_process');
const bindings = require('../vendor/bindings');
const acorn = require('../vendor/acorn');
const walk = require('../vendor/walk');
const builtins = require('./builtins');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
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

const RECURSIVE = {
  recursive: true,
  mode: 0o755
};

const CACHE = new Map();

/**
 * Bundler
 */

class Bundler {
  constructor() {
    this.pkgMap = new Map();
    this.moduleMap = new Map();
    this.modules = [];
    this.bindings = new Set();
    this.root = null;
    this.id = 0;
    this.hasBindings = false;
    this.hasTimers = false;
    this.hasProcess = false;
    this.hasBuffer = false;
    this.hasConsole = false;
    this.env = 'node';
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.multi = false;
    this.tmp = os.tmpdir();
  }

  pkg(root) {
    assert(typeof root === 'string');

    if (!this.pkgMap.has(root)) {
      const pkg = new Package(this, root);

      this.pkgMap.set(root, pkg);

      pkg.init();
    }

    return this.pkgMap.get(root);
  }

  module(path) {
    assert(typeof path === 'string');

    if (!this.moduleMap.has(path)) {
      const file = new Module(this, path);

      if (!this.root)
        this.root = file;

      this.moduleMap.set(path, file);
      this.modules.push(file);

      file.init();
    }

    return this.moduleMap.get(path);
  }

  bundle(file, output) {
    assert(typeof file === 'string');
    assert(!output || typeof output === 'string');

    if (this.multi) {
      if (this.env !== 'node')
        throw new Error('Multi must be used with node environment.');

      if (!output)
        throw new Error('No output directory specified.');

      const root = findRoot(file);
      const pkg = this.pkg(root, this.browserField);

      for (const location of pkg.modules)
        this.module(resolve(root, location));

      const packages = new Map();

      for (const module of this.modules) {
        packages.set(module.root, {
          pkg: module.pkg,
          root: module.root,
          output: module.outputRoot(output)
        });
      }

      const dir = this.bindings.size > 0
        ? resolve(output, 'bindings')
        : output;

      fs.mkdirSync(dir, RECURSIVE);

      for (const binding of this.bindings) {
        const path = resolve(output, 'bindings', basename(binding));

        fs.copyFileSync(binding, path);
      }

      for (const {type, location, code} of this.modules) {
        const path = resolve(output, location);

        fs.mkdirSync(dirname(path), RECURSIVE);
        fs.writeFileSync(path, code);

        if (type === 'bin')
          fs.chmodSync(path, 0o755);
      }

      for (const {pkg, root, output} of packages.values()) {
        for (const file of pkg.copy) {
          fs.mkdirSync(resolve(output, dirname(file)), RECURSIVE);
          fs.copyFileSync(resolve(root, file), resolve(output, file));
        }
      }

      return null;
    }

    const path = resolve(CWD, file);
    const tmp = resolve(this.tmp, '.') + sep;
    const root = this.module(path);
    const modules = [];

    let timers = null;
    let process = null;
    let buffer = null;
    let console = null;

    if (this.env === 'browser') {
      if (this.hasTimers)
        timers = this.module(builtins.timers).id;

      if (this.hasProcess)
        process = this.module(builtins._process).id;

      if (this.hasBuffer)
        buffer = this.module(builtins.buffer).id;

      if (this.hasConsole)
        console = this.module(builtins.console).id;
    }

    for (const {id, location, code} of this.modules)
      modules.push(`  [/* ${id} */ ${stringify(location)}, ${code}]`);

    let out = '';

    if (this.env === 'browser') {
      out = template('browser.js', {
        timers,
        process,
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

    out = out.trim();

    if (this.collectBindings) {
      if (!output)
        throw new Error('No output directory specified.');

      const dir = this.bindings.size > 0
        ? resolve(output, 'bindings')
        : output;

      fs.mkdirSync(dir, RECURSIVE);

      for (const binding of this.bindings) {
        const path = resolve(output, 'bindings', basename(binding));

        fs.copyFileSync(binding, path);
      }

      fs.writeFileSync(resolve(output, name), out);

      if (root.hashbang)
        fs.chmodSync(resolve(output, name), 0o755);

      return null;
    }

    if (output) {
      fs.writeFileSync(output, out);

      if (root.hashbang)
        fs.chmodSync(output, 0o755);

      return null;
    }

    return out;
  }
}

/**
 * Package
 */

class Package {
  constructor(bundler, root) {
    assert(bundler instanceof Bundler);
    assert(typeof root === 'string');

    this.bundler = bundler;
    this.root = root;
    this.path = resolve(root, 'package.json');
    this.json = null;
    this.name = 'root';
    this.version = '0.0.0';
    this.main = './index.js';
    this.bin = {};
    this.browser = {};
    this.deps = [];
    this.modules = [];
    this.copy = [];
    this.license = null;
    this.resolve = mod.createRequireFromPath(this.root);
  }

  get isBrowser() {
    const bundler = this.bundler;
    return bundler.env === 'browser'
        || bundler.browserField;
  }

  init() {
    const {root} = this;
    const path = resolve(root, 'package.json');
    const pkg = readJSON(path);

    if (pkg == null) {
      this.name = dirname(root);
      return this;
    }

    if (pkg == null || typeof pkg !== 'object')
      throw new Error('No package.json found.');

    if (!pkg.name || typeof pkg.name !== 'string')
      throw new Error('No package.json found.');

    if (pkg.version == null)
      pkg.version = '0.0.0';

    if (!pkg.version || typeof pkg.version !== 'string')
      throw new Error('No package.json found.');

    if (pkg.main == null)
      pkg.main = './index';

    if (!pkg.main || typeof pkg.main !== 'string')
      throw new Error('No package.json found.');

    if (!pkg.bin)
      pkg.bin = Object.create(null);

    if (typeof pkg.bin === 'string')
      pkg.bin = { __proto__: null, [pkg.name]: pkg.bin };

    if (typeof pkg.bin !== 'object')
      throw new Error('No package.json found.');

    if (pkg.browser === false)
      pkg.browser = { __proto__: null, [pkg.main]: false };

    if (pkg.browser == null)
      pkg.browser = Object.create(null);

    if (typeof pkg.browser === 'string')
      pkg.browser = { __proto__: null, [pkg.main]: pkg.browser };

    if (typeof pkg.browser !== 'object')
      throw new Error('No package.json found.');

    const normalize = (location) => {
      assert(typeof location === 'string');

      if (location.length === 0)
        throw new Error('Invalid location.');

      if (location[0] === '/')
        location = '.' + location;

      if (!location.startsWith('./')) {
        if (!exists(resolve(root, location)))
          return location;
      }

      location = resolve(root, location);

      return './' + relative(root, require.resolve(location));
    };

    pkg.main = normalize(pkg.main);

    for (const key of Object.keys(pkg.bin))
      pkg.bin[key] = normalize(pkg.bin[key]);

    for (const key of Object.keys(pkg.browser)) {
      if (pkg.browser[key] === false) {
        pkg.browser[key] = './' + relative(root, builtins.empty);
        continue;
      }
      pkg.browser[normalize(key)] = normalize(pkg.browser[key]);
      delete pkg.browser[key];
    }

    if (this.isBrowser) {
      if (pkg.browser[pkg.main])
        pkg.main = pkg.browser[pkg.main];

      for (const key of Object.keys(pkg.bin)) {
        const location = pkg.bin[key];

        if (pkg.browser[location])
          pkg.bin[key] = pkg.browser[location];
      }
    }

    const deps = [];

    for (const fieldName of ['dependencies',
                             'optionalDependencies',
                             'peerDependencies',
                             'devDependencies']) {
      const field = pkg[fieldName];

      if (!field || typeof field !== 'object')
        continue;

      for (const name of Object.keys(field)) {
        const version = field[name];

        assert(version && typeof version === 'string');

        let type = 'normal';

        switch (fieldName) {
          case 'optionalDependencies':
            type = 'optional';
            break;
          case 'peerDependencies':
            type = 'peer';
            break;
          case 'devDependencies':
            type = 'dev';
            break;
        }

        deps.push({
          name,
          type,
          version
        });
      }
    }

    const modules = [];
    const copy = [];

    let license = null;

    copy.push('./package.json');

    modules.push(pkg.main);

    for (const key of Object.keys(pkg.bin)) {
      const location = pkg.bin[key];
      const path = resolve(root, location);
      const text = fs.readFileSync(path, 'utf8');

      if (!text.startsWith('#!')) {
        modules.push(location);
        continue;
      }

      if (!text.startsWith('#!/usr/bin/env node\n')) {
        copy.push(location);
        continue;
      }

      modules.push(location);
    }

    for (const name of ['LICENSE',
                        'license',
                        'LICENSE.md',
                        'license.md',
                        'COPYING',
                        'copying',
                        'COPYING.md',
                        'copying.md']) {
      const path = resolve(root, name);

      if (exists(path)) {
        license = './' + name;
        copy.push(license);
        break;
      }
    }

    this.json = pkg;
    this.name = pkg.name;
    this.version = pkg.version;
    this.main = pkg.main;
    this.bin = pkg.bin;
    this.browser = pkg.browser;
    this.deps = deps;
    this.modules = modules;
    this.copy = copy;
    this.license = license;

    return this;
  }

  recurse() {
    for (const dep of this.deps) {
      const path = this.resolve(dep.name);
      const pkg = this.bundler.pkg(path);

      if (!pkg.json)
        throw new Error('Package not found.');
    }
  }
}

/**
 * Module
 */

class Module {
  constructor(bundler, path) {
    assert(bundler instanceof Bundler);
    assert(typeof path === 'string');

    this.bundler = bundler;
    this.id = bundler.id++;
    this.path = path;
    this.dir = dirname(path);
    this.name = basename(path);
    this.ext = extname(path);
    this.root = findRoot(path);
    this.pkg = bundler.pkg(this.root);
    this.type = this.getType();
    this.resolve = this.requirify();
    this.hashbang = '';
    this.code = '';
  }

  get location() {
    const rel = './' + relative(this.root, this.path);
    const {root} = this.bundler;

    if (!root || root === this)
      return rel;

    if (this.pkg.name === root.pkg.name)
      return rel;

    return './' + join('node_modules', this.pkg.name, rel);
  }

  outputRoot(output) {
    assert(typeof output === 'string');

    const {root} = this.bundler;

    if (!root || root.root === this.root)
      return basename(output);

    return resolve(root.outputRoot(output),
                   'node_modules',
                   basename(this.root));
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

  requirify() {
    const {pkg} = this;

    let browser = null;

    if (pkg.isBrowser) {
      if (Object.keys(pkg.browser).length > 0) {
        const full = require.resolve(this.path);
        const base = './' + relative(this.root, full);

        if (pkg.browser[base]) {
          this.path = resolve(this.root, pkg.browser[base]);
          this.root = findRoot(this.path);
        }

        browser = pkg.browser;
      } else {
        browser = null;
      }
    }

    const pathRequire = mod.createRequireFromPath(path);
    const {path, root} = this;

    return (location) => {
      const path = pathRequire.resolve(location);

      if (!browser)
        return path;

      if (!isAbsolute(path)) {
        if (browser[path])
          return resolve(root, browser[path]);
        return path;
      }

      const file = './' + relative(root, path);

      if (browser[file])
        return resolve(root, browser[file]);

      return path;
    }
  }

  makeError(str) {
    assert(typeof str === 'string');
    return `__${this.bundler.env}_error__(${stringify(str)})`;
  }

  makeRequire(id) {
    assert(typeof id === 'number');

    if (this.bundler.env === 'browser')
      return `__browser_require__(${id}, module)`;

    return `__node_require__(${id})`;
  }

  makeRawRequire(path) {
    assert(typeof path === 'string');
    return `require(${stringify(path)})`;
  }

  makeOpen(path) {
    assert(typeof path === 'string');
    assert(!this.bundler.multi);

    const name = basename(path);
    const b64 = fs.readFileSync(path).toString('base64');

    return '__node_dlopen__(module, '
         + `${stringify(name)},`
         + `${stringifyBig(b64)});`
         + '\n';
  }

  makeJSON(path) {
    assert(typeof path === 'string');

    const code = fs.readFileSync(path, 'utf8');

    if (this.multi)
      return code;

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
      if (!this.bundler.multi) {
        code = code.replace(/^#![^\n]*/, (hashbang) => {
          this.hashbang = hashbang;
          return '';
        });
      }

      code = this.transform(code);
    }

    if (this.bundler.multi)
      return code.trim() + '\n';

    return [
      WRAPPER[0],
      indent(code.trim(), 2),
      indent(WRAPPER[1], 1)
    ].join('\n');
  }

  transform(code) {
    assert(typeof code === 'string');

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
    assert(typeof location === 'string');

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

    if (isAbsolute(path) && extname(path) === '.node') {
      if (this.bundler.env === 'browser')
        return this.makeError('Not found.');

      if (this.bundler.multi) {
        const {root} = this.bundler;
        const newPath = './' + join('bindings', basename(path));
        const location = './' + relative(dirname(this.location), newPath);

        this.bundler.bindings.add(path);

        return this.makeRawRequire(location);
      }

      if (this.bundler.collectBindings) {
        this.bundler.bindings.add(path);
        return this.makeRawRequire(`./bindings/${basename(path)}`);
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
      const file = this.bundler.module(path);

      if (this.bundler.multi)
        return this.makeRawRequire(location);

      return this.makeRequire(file.id);
    }

    return this.makeRawRequire(location);
  }

  bindings(location) {
    assert(typeof location === 'string');

    try {
      return bindings({ resolve: this.resolve }, {
        bindings: location,
        path: true,
        module_root: this.root
      });
    } catch (e) {
      return null;
    }
  }

  tryBinding(location) {
    const path = this.bindings(location);

    if (path)
      return path;

    const gypFile = resolve(this.root, 'binding.gyp');

    if (!isFile(gypFile))
      return null;

    cp.execFileSync('node-gyp', ['rebuild'], {
      stdio: 'inherit',
      cwd: this.root
    });

    return this.bindings(location);
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

      if (this.bundler.env === 'browser')
        return [node, this.makeError('Not found.')];

      let path = this.tryBinding(arg.value);

      if (!path) {
        if (this.bundler.ignoreMissing)
          return [node, this.makeError('Not found.')];
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
  assert(typeof path === 'string');

  const {root} = parse(__dirname);
  const base = dirname(path);

  let dir = base;

  for (;;) {
    const loc = resolve(dir, 'package.json');

    if (isFile(loc))
      return dir;

    if (dir === root)
      return base;

    dir = resolve(dir, '..');
  }
}

/*
 * Helpers
 */

function exists(file) {
  assert(typeof file === 'string');

  try {
    return fs.statSync(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

function isFile(file) {
  assert(typeof file === 'string');

  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

function isDirectory(file) {
  assert(typeof file === 'string');

  try {
    return fs.statSync(file).isDirectory();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

function readJSON(file) {
  assert(typeof file === 'string');

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
  assert(typeof str === 'string');

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
            .replace(/^[ \t]+$/gm, '');
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
