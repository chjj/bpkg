/*!
 * bpkg.js - minimal bundler for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const Path = require('path');
const Module_ = require('module');
const os = require('os');
const cp = require('child_process');
const bindings = require('../vendor/bindings');
const acorn = require('../vendor/acorn');
const walk = require('../vendor/walk');
const builtins = require('./builtins');
const traverse = require('./traverse');

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

if (!acorn.Parser.extend) {
  acorn.Parser.extend = function extend(...plugins) {
    let parser = this;
    for (const plugin of plugins)
      parser = plugin(parser);
    return parser;
  };
}

if (!acorn.Parser.parse) {
  acorn.Parser.parse = function parse(input, options) {
    return new this(options, input).parse();
  };
}

const Parser = acorn.Parser.extend(
  require('../vendor/acorn-bigint'),
  require('../vendor/acorn-export-ns-from'),
  require('../vendor/acorn-import-meta'),
  require('../vendor/acorn-dynamic-import')
);

walk.base.Import = () => {};

/*
 * Constants
 */

const CWD = process.cwd();

const WRAPPER = [
  'function(exports, require, module, __filename, __dirname) {',
  '}'
];

const COPYFILE_FLAGS = 0;

const RECURSIVE = {
  recursive: true,
  mode: 0o755
};

const PREFIX = resolve(os.homedir(), '.bpkg');

/**
 * Bundler
 */

class Bundler {
  constructor() {
    this.packageMap = new Map();
    this.packages = [];
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
    this.hasLicense = false;
    this.env = 'node';
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.excludeSource = false;
    this.noLicense = false;
    this.multi = false;
    this.single = false;
    this.tmp = os.tmpdir();
  }

  pkg(root) {
    assert(typeof root === 'string');

    if (!this.packageMap.has(root)) {
      const pkg = new Package(this, root);

      this.packageMap.set(root, pkg);
      this.packages.push(pkg);

      pkg.init();
    }

    return this.packageMap.get(root);
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

  bundle(src, dest) {
    assert(typeof src === 'string');
    assert(!dest || typeof dest === 'string');

    src = resolve(CWD, src);
    dest = dest ? resolve(CWD, dest) : null;

    if (dest) {
      const parent = dirname(dest);

      if (!isDirectory(parent))
        fs.mkdirSync(parent, RECURSIVE);

      if (dest.endsWith('.tar.gz')) {
        const name = basename(dest.slice(0, -7));
        const tmp = resolve(PREFIX, `${name}-${Date.now()}`);
        const output = resolve(tmp, name);

        if (!exists(tmp))
          fs.mkdirSync(tmp, RECURSIVE);

        const code = this._bundle(src, output);

        tar(output, dest);

        // Guard for the rimraf.
        assert(output.startsWith(PREFIX));
        rimraf(output);

        fs.rmdirSync(tmp);

        return code;
      }
    }

    return this._bundle(src, dest);
  }

  _bundle(src, dest) {
    assert(typeof src === 'string');
    assert(!dest || typeof dest === 'string');

    if (this.multi) {
      if (!dest)
        throw new Error('No output directory specified.');

      const pkg = this.pkg(src);

      if (!pkg.json)
        throw new Error('Package not found.');

      pkg.copy(dest);

      return null;
    }

    const tmp = resolve(this.tmp, '.') + sep;
    const root = this.module(src);
    const modules = [];

    let out = '';
    let license = null;
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

    if (!this.noLicense && this.hasLicense) {
      license = '';
      license += '/*!\n';

      for (const pkg of this.packages) {
        if (!pkg.license)
          continue;

        license += ` * License for ${pkg.name}@${pkg.version}:\n`;
        license += ' *\n';

        license += (pkg.license + '\n').replace(/^/gm, ' * ');
        license += '\n';
      }

      license += ' */';
    }

    if (this.env === 'node'
        && this.modules.length === 1
        && this.bindings.size === 0) {
      if (root.hashbang)
        out += root.hashbang + '\n';

      if (license) {
        out += '\n';
        out += license + '\n';
      }

      out += '\n';
      out += root.code;
    } else {
      for (const {id, location, wrapped} of this.modules)
        modules.push(`  [/* ${id} */ ${stringify(location)}, ${wrapped}]`);

      if (this.env === 'browser') {
        out = template('browser.js', {
          license,
          timers,
          process,
          buffer,
          console,
          modules: modules.join(',\n')
        });
      } else {
        out = template('node.js', {
          hashbang: root.hashbang,
          license,
          modules: modules.join(',\n'),
          bindings: this.hasBindings,
          tmp: stringify(tmp)
        });
      }
    }

    out = out.trim();

    if (this.collectBindings) {
      if (!dest)
        throw new Error('No output directory specified.');

      const name = root.hashbang
        ? basename(src)
        : 'index.js';

      const dir = this.bindings.size > 0
        ? resolve(dest, 'bindings')
        : dest;

      fs.mkdirSync(dir, RECURSIVE);

      for (const binding of this.bindings) {
        const path = resolve(dest, 'bindings', basename(binding));

        fs.copyFileSync(binding, path);
      }

      fs.writeFileSync(resolve(dest, name), out);

      if (root.hashbang)
        fs.chmodSync(resolve(dest, name), 0o755);

      return null;
    }

    if (dest) {
      fs.writeFileSync(dest, out);

      if (root.hashbang)
        fs.chmodSync(dest, 0o755);

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
    this.license = null;
    this.resolve = createResolver(this.root);
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

      return './' + relative(root, this.resolve(location));
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

    let license = null;

    for (const name of ['LICENSE',
                        'license',
                        'LICENSE.md',
                        'license.md',
                        'COPYING',
                        'copying',
                        'COPYING.md',
                        'copying.md']) {
      const path = resolve(root, name);

      if (isFile(path)) {
        this.bundler.hasLicense = true;
        license = fs.readFileSync(path, 'utf8');
        license = license.trim();
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
    this.license = license;

    return this;
  }

  traverse() {
    return traverse(this.root);
  }

  resolveModule(name) {
    assert(typeof name === 'string');

    let path;
    try {
      path = this.resolve(`${name}/package.json`);
    } catch (e) {
      return null;
    }

    return resolve(path, '..');
  }

  copy(dest) {
    assert(typeof dest === 'string');

    this._copy(dest);

    for (const dep of this.deps) {
      if (dep.type === 'dev')
        continue;

      const path = this.resolveModule(dep.name);
      const pkg = path ? this.bundler.pkg(path) : null;

      if (!pkg || !pkg.json) {
        if (this.bundler.ignoreMissing)
          continue;

        throw new Error('Package not found.');
      }

      pkg.copy(resolve(dest, 'node_modules', pkg.name));
    }
  }

  _copy(dest) {
    assert(typeof dest === 'string');

    if (!isDirectory(dest))
      fs.mkdirSync(dest, RECURSIVE);

    for (const [file, stat] of this.traverse()) {
      const name = basename(file);
      const ext = extname(file);
      const from = resolve(this.root, file);
      const to = resolve(dest, file);
      const fromDir = dirname(from);
      const toDir = dirname(to);

      if (stat.isSymbolicLink()) {
        if (!isDirectory(toDir))
          fs.mkdirSync(toDir, RECURSIVE);

        fs.symlinkSync(to, fs.readlinkSync(from));
        continue;
      }

      if (this.bundler.collectBindings) {
        if (this.bundler.excludeSource) {
          switch (ext) {
            case '.c':
            case '.cc':
            case '.cpp':
            case '.h':
            case '.hh':
            case '.hpp':
            case '.s':
            case '.S':
              if (basename(fromDir) !== 'nan')
                continue;
              break;
          }
        }

        if (name === 'binding.gyp') {
          const buildFrom = resolve(fromDir, 'build');
          const buildTo = resolve(toDir, 'build');

          gypBuild(fromDir);

          for (const [file, stat] of traverse(buildFrom)) {
            if (!stat.isFile())
              continue;

            if (extname(file) !== '.node')
              continue;

            const from = resolve(buildFrom, file);
            const to = resolve(buildTo, file);
            const fromDir = dirname(from);
            const toDir = dirname(to);

            if (basename(fromDir) === 'obj.target')
              continue;

            if (!isDirectory(toDir))
              fs.mkdirSync(toDir, RECURSIVE);

            fs.copyFileSync(from, to, COPYFILE_FLAGS);
          }
        }
      }

      if (!isDirectory(toDir))
        fs.mkdirSync(toDir, RECURSIVE);

      let code = null;
      let hashbang = false;

      if (ext === '.js' || ext === '.mjs') {
        code = fs.readFileSync(from, 'utf8');
      } else if (ext === '') {
        code = fs.readFileSync(from, 'utf8');
        hashbang = /^#!.*?node.*?$/m.test(code);

        if (!hashbang)
          code = null;
      }

      if (code == null) {
        fs.copyFileSync(from, to, COPYFILE_FLAGS);
        continue;
      }

      const module = new Module(this.bundler, from);

      code = module.transform(code);

      fs.writeFileSync(to, code);

      if (hashbang)
        fs.chmodSync(to, 0o755);
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
    this.wrapped = '';
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

  init() {
    this.code = this.compile();
    this.wrapped = this.wrap(this.code);
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
        const full = this.pkg.resolve(this.path);
        const main = './' + relative(this.root, full);

        if (pkg.browser[main]) {
          this.path = resolve(this.root, pkg.browser[main]);
          this.root = findRoot(this.path);
        }

        browser = pkg.browser;
      } else {
        browser = null;
      }
    }

    const {path, root} = this;
    const pathResolve = createResolver(path);

    return (location) => {
      const path = pathResolve(location);

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
    };
  }

  makeError(str) {
    assert(typeof str === 'string');

    if (this.bundler.multi || this.bundler.single)
      throw new Error(str);

    return `(__${this.bundler.env}_error__(${stringify(str)}))`;
  }

  makeRequire(id) {
    assert(!this.bundler.multi);

    assert(typeof id === 'number');

    if (this.bundler.env === 'browser')
      return `(__browser_require__(${id}, module))`;

    return `(__node_require__(${id}))`;
  }

  makeRawRequire(path) {
    assert(typeof path === 'string');
    return `(require(${stringify(path)}))`;
  }

  makeOpen(path) {
    assert(!this.bundler.multi);

    assert(typeof path === 'string');

    const name = basename(path);
    const raw = fs.readFileSync(path);

    return '__node_dlopen__(module, '
         + `${stringify(name)},`
         + `${stringifyBuffer(raw)});`
         + '\n';
  }

  makeJSON(path) {
    assert(!this.bundler.multi);

    assert(typeof path === 'string');

    const code = fs.readFileSync(path, 'utf8');
    const json = JSON.parse(code);

    return `module.exports = ${stringify(json, null, 2)};\n`;
  }

  readCode() {
    assert(!this.bundler.multi);

    if (this.type === 'binding')
      return this.makeOpen(this.path);

    if (this.type === 'json')
      return this.makeJSON(this.path);

    return fs.readFileSync(this.path, 'utf8');
  }

  compile() {
    assert(!this.bundler.multi);

    let code = this.readCode();

    if (this.type === 'bin' || this.type === 'lib') {
      code = code.replace(/^#![^\n]*/, (hashbang) => {
        this.hashbang = hashbang;
        return '';
      });

      code = this.transform(code);
    }

    return code;
  }

  wrap(code) {
    assert(typeof code === 'string');

    return [
      WRAPPER[0],
      indent(code.trim(), 2),
      indent(WRAPPER[1], 1)
    ].join('\n');
  }

  transform(code) {
    assert(typeof code === 'string');

    const root = Parser.parse(code, {
      ecmaVersion: 10,
      sourceType: 'module',
      allowHashBang: true,
      allowReturnOutsideFunction: true
    });

    let out = '';
    let offset = 0;
    let x = 0;
    let y = 0;

    walk.full(root, (node) => {
      let id = 0;
      let filter;

      switch (node.type) {
        case 'CallExpression':
          filter = this.CallExpression;
          break;
        case 'ImportDeclaration':
          filter = this.ImportDeclaration;
          id = x++;
          break;
        case 'ExportAllDeclaration':
          filter = this.ExportAllDeclaration;
          id = y++;
          break;
        case 'ExportDefaultDeclaration':
          filter = this.ExportDefaultDeclaration;
          id = y++;
          break;
        case 'ExportNamedDeclaration':
          filter = this.ExportNamedDeclaration;
          id = y++;
          break;
        case 'MetaProperty':
          filter = this.MetaProperty;
          break;
        case 'Identifier':
          filter = this.Identifier;
          break;
      }

      if (!filter)
        return;

      const result = filter.call(this, node, code, id);

      if (result == null)
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

    if (this.bundler.multi || this.bundler.single)
      return this.makeRawRequire(location);

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

    gypRebuild(this.root);

    return this.bindings(location);
  }

  isImport(node) {
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'Import')
      return false;

    if (node.arguments.length < 1)
      return false;

    return true;
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

  CallExpression(node, code) {
    if (this.isImport(node)) {
      // import(path).then(...);
      const arg = node.arguments[0];

      let value = '';

      if (arg.type !== 'Literal' || typeof arg.value !== 'string')
        value = `require(${code.substring(arg.start, arg.end)})`;
      else
        value = this.require(arg.value);

      return [node, `(Promise.resolve(${value}))`];
    }

    if (this.bundler.multi || this.bundler.single)
      return null;

    if (this.isBindings(node)) {
      const arg = node.arguments[0];

      if (this.bundler.env === 'browser')
        return [node, this.makeError('Not found.')];

      let path = this.tryBinding(arg.value);

      if (!path) {
        if (this.bundler.ignoreMissing)
          return [node, this.makeError('Not found.')];
        throw new Error('Binding not found.');
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

    const name = `__bpkg_import_${id}__`;

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

  ExportDefaultDeclaration(node, code, id) {
    // export default foo;
    const {start, end} = node.declaration;
    let out = '';
    out += 'exports.default = '
         + code.substring(start, end)
         + ';\n';
    if (id === 0)
      out += 'exports.__esm = true;\n';
    return [node, out];
  }

  ExportNamedDeclaration(node, code, id) {
    const declarations = [];
    const exports = [];

    let namespace = null;
    let source = null;
    let out = '';

    if (node.declaration) {
      // export [statement];
      const decl = node.declaration;
      const {type, id, start, end} = decl;

      switch (type) {
        case 'VariableDeclaration':
          // export var/let/const foo = 1;
          for (const {id, init} of decl.declarations) {
            const {start, end} = init;
            declarations.push([id.name, code.substring(start, end)]);
          }
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
        case 'ExportNamespaceSpecifier':
          // export * as foo from 'module';
          namespace = exported.name;
          break;
      }
    }

    if (node.source)  {
      // export ... from 'bar';
      source = node.source.value;
    }

    if (source) {
      const name = `__bpkg_export_${id}__`;

      out += `var ${name} = `
          + this.require(source)
          + ';\n';

      if (namespace)
        out += `exports.${namespace} = ${name};\n`;

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
      for (const [key, value] of declarations) {
        out += `var ${key} = ${value};\n`;
        out += `exports.${key} = ${key};\n`;
      }

      for (const [value, key] of exports)
        out += `exports.${key} = ${value};\n`;
    }

    if (id === 0)
      out += 'exports.__esm = true;\n';

    return [node, out];
  }

  MetaProperty(node) {
    // import.meta;
    return [node, '({url:"file://"+encodeURI(module.filename)})'];
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

function createResolver(path) {
  const require = Module_.createRequireFromPath(path);

  if (!require.extensions['.mjs'])
    require.extensions['.mjs'] = require.extensions['.js'];

  return location => require.resolve(location);
}

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

function exec(cwd, stdio, args) {
  assert(typeof cwd === 'string');
  assert(typeof stdio === 'string');
  assert(Array.isArray(args));

  return cp.execFileSync(args.shift(), args, {
    stdio,
    cwd
  });
}

function tar(src, dest) {
  assert(typeof src === 'string');
  assert(typeof dest === 'string');

  const name = basename(src);
  const dir = dirname(src);

  return exec(dir, 'inherit', ['tar', '-czf', dest, name]);
}

function rimraf(file) {
  assert(typeof file === 'string');
  return exec(CWD, 'inherit', ['rm', '-rf', file]);
}

function gypBuild(root) {
  assert(typeof root === 'string');
  return exec(root, 'ignore', ['node-gyp', 'build']);
}

function gypRebuild(root) {
  assert(typeof root === 'string');
  return exec(root, 'inherit', ['node-gyp', 'rebuild']);
}

function stringify(...args) {
  if (args.length === 1 && typeof args[0] === 'string') {
    let str = args[0];
    str = JSON.stringify(str).slice(1, -1);
    str = str.replace(/\\"/g, '"');
    str = str.replace(/'/g, '\\\'');
    return `'${str}'`;
  }
  return JSON.stringify(...args);
}

function stringifyBuffer(raw) {
  assert(Buffer.isBuffer(raw));

  const str = raw.toString('base64');

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
