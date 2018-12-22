/*!
 * bpkg.js - minimal bundler for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('../vendor/bfile');
const os = require('os');
const Path = require('path');
const acorn = require('../vendor/acorn');
const uglify = require('../vendor/uglify-es');
const bindings = require('./bindings');
const builtins = require('./builtins');
const Resolver = require('./resolver');
const traverse = require('./traverse');

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
  constructor(options) {
    this.env = 'node';
    this.extensions = ['.js', '.mjs'];
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.excludeSource = false;
    this.noLicense = false;
    this.multi = false;
    this.single = false;
    this.minify = false;
    this.exports = false;
    this.global = false;
    this.name = null;
    this.plugins = [];
    this.tmp = os.tmpdir();

    this.src = null;
    this.dest = null;
    this.root = null;
    this.resolve = this.resolver(CWD);

    this.rootModule = null;
    this.moduleID = 0;
    this.moduleMap = new Map();
    this.modules = [];

    this.rootPkg = null;
    this.packageID = 0;
    this.packageMap = new Map();
    this.packages = [];

    this.bindings = new Set();

    this.running = [];

    this.hasBindings = false;
    this.hasTimers = false;
    this.hasProcess = false;
    this.hasBuffer = false;
    this.hasConsole = false;
    this.hasLicense = false;

    this.init(options);
  }

  init(options) {
    if (options == null)
      return this;

    if (typeof options !== 'object')
      throw new TypeError('Invalid options.');

    if (typeof options.env === 'string')
      this.env = options.env;

    if (Array.isArray(options.extensions))
      this.extensions = options.extensions;

    if (typeof options.browserField === 'boolean')
      this.browserField = options.browserField;

    if (typeof options.ignoreMissing === 'boolean')
      this.ignoreMissing = options.ignoreMissing;

    if (typeof options.collectBindings === 'boolean')
      this.collectBindings = options.collectBindings;

    if (typeof options.excludeSource === 'boolean')
      this.excludeSource = options.excludeSource;

    if (typeof options.noLicense === 'boolean')
      this.noLicense = options.noLicense;

    if (typeof options.multi === 'boolean')
      this.multi = options.multi;

    if (typeof options.single === 'boolean')
      this.single = options.single;

    if (typeof options.minify === 'boolean')
      this.minify = options.minify;

    if (typeof options.exports === 'boolean')
      this.exports = options.exports;

    if (typeof options.global === 'boolean')
      this.global = options.global;

    if (typeof options.name === 'string')
      this.name = options.name;

    if (Array.isArray(options.plugins))
      this.plugins = options.plugins;

    if (typeof options.tmp === 'string')
      this.tmp = options.tmp;

    return this;
  }

  resolver(path) {
    const extensions = this.extensions;
    const browser = this.env === 'browser'
                 || this.browserField;

    return Resolver.create(path, extensions, browser);
  }

  hasExtension(file) {
    assert(typeof file === 'string');

    for (const ext of this.extensions) {
      if (file.endsWith(ext))
        return true;
    }

    return false;
  }

  async pkg(root) {
    assert(typeof root === 'string');

    if (!this.packageMap.has(root)) {
      const pkg = new Package(this, root);

      await pkg.init();

      if (!this.rootPkg)
        this.rootPkg = pkg;

      this.packageMap.set(root, pkg);
      this.packages.push(pkg);
    }

    return this.packageMap.get(root);
  }

  async module(path, code) {
    assert(typeof path === 'string');

    if (!this.moduleMap.has(path)) {
      const module = new Module(this, path, code);

      await module.init();

      if (!this.rootModule)
        this.rootModule = module;

      this.moduleMap.set(path, module);
      this.modules.push(module);

      await module.open();
    }

    return this.moduleMap.get(path);
  }

  async bundleCode(code, file) {
    assert(typeof code === 'string');
    assert(!file || typeof file === 'string');
    assert(!this.multi);

    const path = resolve(CWD, file || '_stream_0.js');

    return this._bundle(path, null, code);
  }

  async bundle(src, dest) {
    assert(typeof src === 'string');
    assert(!dest || typeof dest === 'string');

    src = resolve(CWD, src);
    dest = dest ? resolve(CWD, dest) : null;

    if (dest) {
      const parent = dirname(dest);

      if (!await isDirectory(parent))
        await fs.mkdir(parent, RECURSIVE);

      if (dest.endsWith('.tar.gz')) {
        const name = basename(dest.slice(0, -7));
        const tmp = resolve(PREFIX, `${name}-${Date.now()}`);
        const output = resolve(tmp, name);

        if (!await fs.exists(tmp))
          await fs.mkdir(tmp, RECURSIVE);

        const code = await this._bundle(src, output);

        await tar(output, dest);

        // Guard for the rimraf.
        assert(output.startsWith(PREFIX));
        await fs.rimraf(output);

        await fs.rmdir(tmp);

        return code;
      }
    }

    return this._bundle(src, dest);
  }

  async _bundle(src, dest, code) {
    assert(typeof src === 'string');
    assert(!dest || typeof dest === 'string');

    // Try to find a package.json.
    // Will fail with a sentinel.
    const root = await findRoot(src);
    const pkg = await this.pkg(root);

    // Expose some properties for plugins.
    this.src = src;
    this.dest = dest;
    this.root = root;
    this.resolve = pkg.resolve;

    // Initialize plugins.
    await this.pluginInit(src, dest);

    // First path: multi. Traverse package
    // and its dependents recursively,
    // copying all package files along the
    // way.
    if (this.multi) {
      if (!dest)
        throw new Error('No output directory specified.');

      const pkg = await this.pkg(src);

      if (!pkg.json)
        throw new Error('Package not found.');

      await pkg.copy(dest);

      return null;
    }

    // Second path: bundle. Compile all
    // source files into a single file,
    // suitable for node.js or the browser.
    const path = code == null ? await pkg.resolve(src) : src;
    const tmp = resolve(this.tmp, '.') + sep;
    const module = await this.module(path, code);
    const modules = [];

    let out = '';
    let license = null;
    let timers = null;
    let process = null;
    let buffer = null;
    let console = null;

    if (this.env === 'browser') {
      if (this.hasTimers)
        timers = (await this.module(builtins.timers)).id;

      if (this.hasProcess)
        process = (await this.module(builtins._process)).id;

      if (this.hasBuffer)
        buffer = (await this.module(builtins.buffer)).id;

      if (this.hasConsole)
        console = (await this.module(builtins.console)).id;
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

      license = license.replace(/ +$/gm, '');
      license += ' */';
    }

    if (this.env === 'node'
        && this.modules.length === 1
        && this.bindings.size === 0) {
      if (module.hashbang)
        out += module.hashbang + '\n';

      if (license) {
        out += '\n';
        out += license + '\n';
      }

      out += '\n';
      out += module.code;
    } else {
      for (const {id, location, wrapped} of this.modules)
        modules.push(`  [/* ${id} */ ${stringify(location)}, ${wrapped}]`);

      if (this.env === 'browser') {
        const name = this.name || pkg.name;

        out = await template('browser.js', {
          license,
          timers,
          process,
          buffer,
          console,
          exports: this.exports,
          global: this.global,
          name: stringify(name),
          modules: modules.join(',\n')
        });
      } else {
        out = await template('node.js', {
          hashbang: module.hashbang,
          license,
          modules: modules.join(',\n'),
          bindings: this.hasBindings,
          tmp: stringify(tmp)
        });
      }
    }

    out = out.trim() + '\n';
    out = await this.pluginFinal(out);

    if (this.minify)
      out = minify(out);

    if (this.collectBindings) {
      if (!dest)
        throw new Error('No output directory specified.');

      const name = module.hashbang
        ? basename(src)
        : 'index.js';

      const dir = this.bindings.size > 0
        ? resolve(dest, 'bindings')
        : dest;

      await fs.mkdir(dir, RECURSIVE);

      for (const binding of this.bindings) {
        const path = resolve(dest, 'bindings', basename(binding));

        await fs.copyFile(binding, path);
      }

      await fs.writeFile(resolve(dest, name), out);

      if (module.hashbang)
        await fs.chmod(resolve(dest, name), 0o755);

      return null;
    }

    if (dest) {
      await fs.writeFile(dest, out);

      if (module.hashbang)
        await fs.chmod(dest, 0o755);

      return null;
    }

    return out;
  }

  /*
   * Plugins
   */

  async pluginInit(src, dest) {
    assert(typeof src === 'string');
    assert(!dest || typeof dest === 'string');

    this.running.length = 0;

    for (let item of this.plugins) {
      if (!Array.isArray(item))
        item = [item];

      assert(Array.isArray(item));
      assert(item.length >= 1);

      let [func, options] = item;

      if (typeof func === 'string')
        func = require(await this.resolve(func));

      assert(typeof func === 'function');

      if (options == null)
        options = Object.create(null);

      const plugin = await func(this, options);

      if (!plugin)
        throw new Error('Invalid plugin.');

      if (typeof plugin !== 'function'
          && typeof plugin !== 'object') {
        throw new Error('Invalid plugin.');
      }

      this.running.push(plugin);
    }

    return this;
  }

  async pluginTransform(module, code) {
    assert(module instanceof Module);
    assert(typeof code === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.transform === 'function')
        code = await plugin.transform(module, code);
    }

    return code;
  }

  async pluginFinal(code) {
    assert(typeof code === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.final === 'function')
        code = await plugin.final(code);
    }

    return code;
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
    this.id = bundler.packageID++;
    this.root = root;
    this.path = resolve(root, 'package.json');
    this.json = null;
    this.name = 'root';
    this.version = '0.0.0';
    this.main = null;
    this.deps = [];
    this.license = null;
    this.resolve = bundler.resolver(this.root);
  }

  async init() {
    const {root} = this;
    const path = resolve(root, 'package.json');
    const pkg = await readJSON(path);

    if (pkg == null) {
      this.name = basename(root);
      return this;
    }

    if (pkg == null || typeof pkg !== 'object')
      throw new Error('Invalid package.json.');

    if (pkg.name == null)
      pkg.name = basename(root);

    if (!pkg.name || typeof pkg.name !== 'string')
      throw new Error('Invalid package.name.');

    if (pkg.version == null)
      pkg.version = '0.0.0';

    if (!pkg.version || typeof pkg.version !== 'string')
      throw new Error('Invalid package.version.');

    if (pkg.main == null)
      pkg.main = null;

    if (pkg.main != null && typeof pkg.main !== 'string')
      throw new Error('Invalid package.main.');

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

        if (!version || typeof version !== 'string')
          throw new Error('Invalid package version.');

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
                        'LICENCE',
                        'licence',
                        'LICENCE.md',
                        'licence.md',
                        'COPYING',
                        'copying',
                        'COPYING.md',
                        'copying.md']) {
      const path = resolve(root, name);

      if (await isFile(path)) {
        this.bundler.hasLicense = true;
        license = await fs.readFile(path, 'utf8');
        license = license.trim();
        license = license.replace(/\r\n/g, '\n');
        license = license.replace(/\r/g, '\n');
        license = license.replace(/\t/g, '  ');
        break;
      }
    }

    this.json = pkg;
    this.name = pkg.name;
    this.version = pkg.version;
    this.main = pkg.main;
    this.deps = deps;
    this.license = license;

    return this;
  }

  traverse() {
    return traverse(this.root);
  }

  async resolveModule(name) {
    assert(typeof name === 'string');

    let path;
    try {
      path = await this.resolve(`${name}/package.json`);
    } catch (e) {
      return null;
    }

    return resolve(path, '..');
  }

  async copy(dest, root) {
    assert(typeof dest === 'string');
    assert(!root || typeof root === 'string');

    if (root == null)
      root = resolve(dest, 'node_modules');

    await this._copy(dest);

    for (const dep of this.deps) {
      if (dep.type === 'dev')
        continue;

      const path = await this.resolveModule(dep.name);

      const pkg = path
        ? (await this.bundler.pkg(path))
        : null;

      if (!pkg || !pkg.json) {
        if (this.bundler.ignoreMissing)
          continue;

        throw new Error('Package not found.');
      }

      const next = resolve(root, pkg.name);

      if (await isDirectory(next))
        continue;

      await pkg.copy(next, root);
    }
  }

  async _copy(dest) {
    assert(typeof dest === 'string');

    if (!await isDirectory(dest))
      await fs.mkdir(dest, RECURSIVE);

    for (const [file, stat] of (await this.traverse())) {
      const name = basename(file);
      const ext = extname(file);
      const from = resolve(this.root, file);
      const to = resolve(dest, file);
      const fromDir = dirname(from);
      const toDir = dirname(to);

      if (stat.isSymbolicLink()) {
        if (!await isDirectory(toDir))
          await fs.mkdir(toDir, RECURSIVE);

        await fs.symlink(to, await fs.readlink(from));
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

          await gypBuild(fromDir);

          for (const [file, stat] of (await traverse(buildFrom))) {
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

            if (!await isDirectory(toDir))
              await fs.mkdir(toDir, RECURSIVE);

            await fs.copyFile(from, to, COPYFILE_FLAGS);
          }
        }
      }

      if (!await isDirectory(toDir))
        await fs.mkdir(toDir, RECURSIVE);

      let code = null;
      let hashbang = false;

      if (this.bundler.hasExtension(from)) {
        code = await fs.readFile(from, 'utf8');
      } else if (ext === '') {
        code = await fs.readFile(from, 'utf8');
        hashbang = /^#!.*?node.*?$/m.test(code);

        if (!hashbang)
          code = null;
      }

      if (code == null) {
        await fs.copyFile(from, to, COPYFILE_FLAGS);
        continue;
      }

      const module = new Module(this.bundler, from);

      await module.init();

      code = await this.bundler.pluginTransform(module, code);
      code = await module.transform(code);
      code = await this.bundler.pluginFinal(code);

      if (this.bundler.minify)
        code = minify(code);

      await fs.writeFile(to, code);

      if (hashbang)
        await fs.chmod(to, 0o755);
    }
  }
}

/**
 * Module
 */

class Module {
  constructor(bundler, path, rawCode) {
    assert(bundler instanceof Bundler);
    assert(typeof path === 'string');
    assert(!rawCode || typeof rawCode === 'string');

    this.bundler = bundler;
    this.id = bundler.moduleID++;
    this.path = path;
    this.rawCode = rawCode || null;
    this.dir = dirname(path);
    this.name = basename(path);
    this.ext = extname(path);
    this.type = this.getType();
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.code = '';
    this.wrapped = '';
    this.resolve = bundler.resolver(path);
  }

  get location() {
    return '/' + unix(relative(this.root, this.path));
  }

  async init() {
    this.root = await findRoot(this.dir);
    this.pkg = await this.bundler.pkg(this.root);
    return this;
  }

  async open() {
    this.code = await this.compile();
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

  async makeOpen(path) {
    assert(!this.bundler.multi);

    assert(typeof path === 'string');

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${stringify(name)},`
         + `${stringifyBuffer(raw)});`
         + '\n';
  }

  async makeJSON(path) {
    assert(!this.bundler.multi);

    assert(typeof path === 'string');

    const code = await fs.readFile(path, 'utf8');
    const json = JSON.parse(code);

    if (basename(path) === 'package.json') {
      if (json && typeof json === 'object') {
        for (const key of Object.keys(json)) {
          if (key[0] === '_')
            delete json[key];
        }
      }
    }

    return `module.exports = ${stringify(json, null, 2)};\n`;
  }

  async readCode() {
    assert(!this.bundler.multi);

    if (this.rawCode)
      return this.rawCode;

    if (this.type === 'binding')
      return this.makeOpen(this.path);

    if (this.type === 'json')
      return this.makeJSON(this.path);

    return fs.readFile(this.path, 'utf8');
  }

  async compile() {
    assert(!this.bundler.multi);

    let code = await this.readCode();

    if (this.type === 'bin' || this.type === 'lib') {
      code = await this.bundler.pluginTransform(this, code);

      code = code.replace(/^#![^\n]*/, (hashbang) => {
        this.hashbang = hashbang;
        return '';
      });

      code = await this.transform(code);
    }

    return code;
  }

  wrap(code) {
    assert(typeof code === 'string');

    return [
      WRAPPER[0],
      code.trim(),
      WRAPPER[1]
    ].join('\n');
  }

  async transform(code) {
    assert(typeof code === 'string');

    const root = acorn.parse(code, {
      ecmaVersion: 10,
      sourceType: 'module',
      allowHashBang: true,
      allowReturnOutsideFunction: true
    });

    let out = '';
    let offset = 0;
    let x = 0;
    let y = 0;

    for (const node of acorn.walk(root)) {
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
        continue;

      const result = await filter.call(this, node, code, id);

      if (result == null)
        continue;

      const [{ start, end }, value] = result;

      out += code.substring(offset, start);
      out += value;

      offset = end;
    }

    out += code.substring(offset);

    return out;
  }

  async require(location) {
    assert(typeof location === 'string');

    if (this.bundler.multi || this.bundler.single)
      return this.makeRawRequire(location);

    let path;

    try {
      path = await this.resolve(location);
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
      const file = await this.bundler.module(path);

      return this.makeRequire(file.id);
    }

    return this.makeRawRequire(location);
  }

  async bindings(location) {
    assert(typeof location === 'string');

    try {
      return await bindings(this.resolve, {
        root: this.root,
        bindings: location
      });
    } catch (e) {
      return null;
    }
  }

  async tryBinding(location) {
    const path = await this.bindings(location);

    if (path)
      return path;

    const gypFile = resolve(this.root, 'binding.gyp');

    if (!await isFile(gypFile))
      return null;

    await gypRebuild(this.root);

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

  async CallExpression(node, code) {
    if (this.isImport(node)) {
      // import(path).then(...);
      const arg = node.arguments[0];

      let value = '';

      if (arg.type !== 'Literal' || typeof arg.value !== 'string')
        value = `require(${code.substring(arg.start, arg.end)})`;
      else
        value = await this.require(arg.value);

      return [node, `(Promise.resolve(${value}))`];
    }

    if (this.bundler.multi || this.bundler.single)
      return null;

    if (this.isBindings(node)) {
      const arg = node.arguments[0];

      if (this.bundler.env === 'browser')
        return [node, this.makeError('Not found.')];

      let path = await this.tryBinding(arg.value);

      if (!path) {
        if (this.bundler.ignoreMissing)
          return [node, this.makeError('Not found.')];
        throw new Error('Binding not found.');
      }

      path = unix(relative(this.dir, path));

      if (!path.startsWith('../'))
        path = './' + path;

      return [node, await this.require(path)];
    }

    if (this.isRequire(node)) {
      const arg = node.arguments[0];
      return [node, await this.require(arg.value)];
    }

    return null;
  }

  async ImportDeclaration(node, code, id) {
    const file = node.source.value;
    const imports = [];

    let default_ = null;
    let namespace = null;
    let out = '';

    if (node.specifiers.length === 0) {
      // import 'module';
      out = (await this.require(file)) + ';\n';
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
        + (await this.require(file))
        + ';\n';

    if (default_) {
      out += `var ${default_} = ${name}._esModule\n`
           + `  ? ${name}.default\n`
           + `  : ${name};\n`;
    }

    if (namespace)
      out += `var ${namespace} = ${name};\n`;

    for (const [imported, local] of imports)
      out += `var ${local} = ${name}.${imported};\n`;

    return [node, out];
  }

  async ExportAllDeclaration(node, code, id) {
    // export * from 'foo';
    const name = `__bpkg_export_${id}__`;
    const key = `__bpkg_key_${id}__`;
    const source = node.source.value;

    let out = '';

    out += `var ${name} = `
        + (await this.require(source))
        + ';\n';

    out += `for (var ${key} in ${name}) {\n`;
    out += `  if (Object.prototype.hasOwnProperty.call(${name}, ${key}))\n`;
    out += `    exports[${key}] = ${name}[${key}];\n`;
    out += '}\n';
    out += '({ __proto__: exports });\n';

    if (id === 0)
      out += 'exports._esModule = true;\n';

    return [node, out];
  }

  async ExportDefaultDeclaration(node, code, id) {
    // export default foo;
    const {start, end} = node.declaration;
    const name = `__bpkg_default_${id}__`;

    let out = '';

    out += `var ${name} = `
         + code.substring(start, end)
         + ';\n';

    out += `if ((${name} && typeof ${name} === "object")\n`;
    out += `    || typeof ${name} === "function") {\n`;

    if (id !== 0) {
      const k = `__bpkg_key_${id}__`;

      out += `  for (var ${k} in exports) {\n`;
      out += `    if (Object.prototype.hasOwnProperty.call(exports, ${k}))\n`;
      out += `      ${name}[${k}] = exports[${k}];\n`;
      out += '  }\n';
      out += `  ({ __proto__: ${name} });\n`;
    }

    out += `  module.exports = exports = ${name};\n`;
    out += '  exports.default = exports;\n';
    out += '} else {\n';
    out += `  exports.default = ${name};\n`;
    out += '}\n';

    if (id === 0)
      out += 'exports._esModule = true;\n';

    return [node, out];
  }

  async ExportNamedDeclaration(node, code, id) {
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
          + (await this.require(source))
          + ';\n';

      if (namespace)
        out += `exports.${namespace} = ${name};\n`;

      for (const [value, key] of exports) {
        if (value === 'default') {
          out += `exports.${key} = ${name}._esModule\n`
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
      out += 'exports._esModule = true;\n';

    return [node, out];
  }

  async MetaProperty(node) {
    // import.meta;
    return [node, '({url:"file://"+encodeURI(module.filename)})'];
  }

  async Identifier(node) {
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

async function findRoot(path) {
  assert(typeof path === 'string');

  if (await isFile(path))
    path = dirname(path);

  let dir = path;

  for (;;) {
    const loc = resolve(dir, 'package.json');

    if (await isFile(loc))
      return dir;

    const next = resolve(dir, '..');

    if (next === dir)
      return path;

    dir = next;
  }
}

/*
 * Helpers
 */

async function isFile(file) {
  assert(typeof file === 'string');

  try {
    return (await fs.stat(file)).isFile();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

async function isDirectory(file) {
  assert(typeof file === 'string');

  try {
    return (await fs.stat(file)).isDirectory();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

async function readJSON(file) {
  assert(typeof file === 'string');

  let text;

  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }

  return JSON.parse(text);
}

async function exec(cwd, args) {
  assert(typeof cwd === 'string');
  assert(Array.isArray(args));
  assert(args.length >= 1);

  const file = args.shift();

  const options = {
    stdio: 'ignore',
    cwd
  };

  return new Promise((resolve, reject) => {
    const cb = (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve([stdout, stderr]);
    };

    try {
      cp.execFile(file, args, options, cb);
    } catch (e) {
      reject(e);
    }
  });
}

async function tar(src, dest) {
  assert(typeof src === 'string');
  assert(typeof dest === 'string');

  const name = basename(src);
  const dir = dirname(src);

  return exec(dir, ['tar', '-czf', dest, name]);
}

async function gypBuild(root) {
  assert(typeof root === 'string');
  return exec(root, ['node-gyp', 'build']);
}

async function gypRebuild(root) {
  assert(typeof root === 'string');
  return exec(root, ['node-gyp', 'rebuild']);
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

function unix(path) {
  assert(typeof path === 'string');

  if (process.platform !== 'win32')
    return path;

  if (!isAbsolute(path))
    return path.replace(/\\/g, '/');

  const {root} = parse(path);

  path = path.substring(root.length);
  path = path.replace(/\\/g, '/');
  path = '/' + path;

  return path;
}

function minify(code) {
  assert(typeof code === 'string');

  let hashbang;

  code = code.replace(/^#![^\n]*/, (line) => {
    hashbang = line;
    return '';
  });

  const out = uglify.minify(code, { toplevel: true });

  if (out.error)
    throw out.error;

  code = out.code;

  if (hashbang)
    code = hashbang + '\n' + code;

  return code.trim() + '\n';
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

async function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = await fs.readFile(path, 'utf8');

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
