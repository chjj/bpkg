/*!
 * bpkg.js - bundler for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

/* eslint new-cap: "off" */

'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('../vendor/bfile');
const os = require('os');
const Path = require('path');
const acorn = require('../vendor/acorn');
const tar = require('../vendor/tar');
const bindings = require('./bindings');
const builtins = require('./builtins');
const plugins = require('./plugins');
const Resolver = require('./resolver');
const traverse = require('./traverse');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve
} = Path;

/*
 * Constants
 */

const CWD = process.cwd();

const WRAPPER = [
  'function(exports, require, module, __filename, __dirname, __meta) {',
  '}'
];

const COPYFILE_FLAGS = 0;

const RECURSIVE = {
  recursive: true,
  mode: 0o755
};

const PREFIX = resolve(os.homedir(), '.bpkg');
const DUMMY = '_stream_0.js'; // Browserify style.

/**
 * Bundle
 */

class Bundle {
  constructor(options) {
    this.Resolver = Resolver;
    this.stream = process.stdout;
    this.input = CWD;
    this.output = null;
    this.code = null;
    this.env = 'node';
    this.extensions = ['.js', '.mjs'];
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.excludeSource = false;
    this.noLicense = false;
    this.multi = false;
    this.single = false;
    this.exports = false;
    this.global = false;
    this.name = null;
    this.plugins = [];
    this.environment = Object.create(null);
    this.globals = Object.create(null);
    this.requires = [];
    this.verbose = false;

    this.tarball = null;
    this.version = '0.0.0';
    this.path = join(CWD, 'package.json');
    this.root = CWD;
    this.resolve = this.resolver(CWD);
    this.require = this.resolve.require;

    this.pkg = null;
    this.pkgID = 0;
    this.pkgMap = new Map();
    this.pkgs = [];
    this.engine = 0;

    this.module = null;
    this.moduleID = 0;
    this.moduleMap = new Map();
    this.modules = [];

    this.bindings = new Set();
    this.installs = [];

    this.running = [];

    this.hasBindings = false;
    this.hasMeta = false;
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

    if (options.stream && typeof options.stream.write === 'function')
      this.stream = options.stream;

    if (typeof options.input === 'string')
      this.input = resolve(CWD, options.input);

    if (typeof options.output === 'string')
      this.output = resolve(CWD, options.output);

    if (options.code != null) {
      if (typeof options.code === 'string')
        this.code = Buffer.from(options.code, 'utf8');
      else if (Buffer.isBuffer(options.code))
        this.code = options.code;
      else
        throw new TypeError('`code` must be a buffer or string.');

      if (typeof options.input !== 'string')
        this.input = resolve(CWD, DUMMY);
    }

    if (typeof options.env === 'string')
      this.env = options.env;

    if (Array.isArray(options.extensions))
      this.addExtension(options.extensions);

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

    if (typeof options.exports === 'boolean')
      this.exports = options.exports;

    if (typeof options.global === 'boolean')
      this.global = options.global;

    if (typeof options.name === 'string')
      this.name = options.name;

    if (Array.isArray(options.plugins))
      this.plugins = options.plugins;

    if (options.environment && typeof options.environment === 'object')
      this.environment = options.environment;

    if (options.globals && typeof options.globals === 'object')
      this.globals = options.globals;

    if (Array.isArray(options.requires))
      this.requires = options.requires;

    if (typeof options.verbose === 'boolean')
      this.verbose = options.verbose;

    return this;
  }

  log(msg) {
    if (this.verbose)
      this.stream.write(msg + '\n');
  }

  resolver(path) {
    const extensions = this.extensions;
    const browser = this.env === 'browser'
                 || this.browserField;

    return Resolver.create({
      root: path,
      extensions,
      npm: true,
      browser
    });
  }

  addExtension(exts) {
    if (!Array.isArray(exts))
      exts = [exts];

    assert(Array.isArray(exts));

    for (const ext of exts) {
      assert(typeof ext === 'string');

      if (this.extensions.indexOf(ext) !== -1)
        continue;

      if (ext === '.json' || ext === '.node')
        continue;

      this.extensions.push(ext);
    }

    return this;
  }

  hasExtension(file) {
    assert(typeof file === 'string');

    for (const ext of this.extensions) {
      if (file.endsWith(ext))
        return true;
    }

    return false;
  }

  async getPackage(root) {
    assert(typeof root === 'string');

    if (!this.pkgMap.has(root)) {
      const pkg = new Package(this, root);

      await pkg.init();

      if (!this.pkg)
        this.pkg = pkg;

      if (pkg.engine > this.engine)
        this.engine = pkg.engine;

      this.pkgMap.set(root, pkg);
      this.pkgs.push(pkg);
    }

    return this.pkgMap.get(root);
  }

  async getModule(path, code) {
    assert(typeof path === 'string');

    if (!this.moduleMap.has(path)) {
      const module = new Module(this, path, code);

      await module.init();

      if (!this.module)
        this.module = module;

      this.moduleMap.set(path, module);
      this.modules.push(module);

      await module.open();
    }

    return this.moduleMap.get(path);
  }

  async getID(path) {
    return (await this.getModule(path, null)).id;
  }

  async load() {
    for (let item of this.plugins) {
      if (!Array.isArray(item))
        item = [item];

      assert(Array.isArray(item));
      assert(item.length >= 1);

      let [func, options] = item;

      if (typeof func === 'string') {
        if (plugins[func])
          func = require(plugins[func]);
        else
          func = require(await this.resolve(func));
      }

      assert(typeof func === 'function');

      if (options == null)
        options = Object.create(null);

      if (typeof options !== 'object')
        throw new TypeError('Invalid plugin options.');

      const plugin = func.prototype !== undefined
        ? new func(this, options)
        : func(this, options);

      if (!plugin)
        throw new Error('Invalid plugin.');

      if (typeof plugin !== 'function'
          && typeof plugin !== 'object') {
        throw new Error('Invalid plugin.');
      }

      if (typeof plugin.load === 'function')
        await plugin.load();

      this.running.push(plugin);
    }

    return this;
  }

  async open() {
    for (const plugin of this.running) {
      if (typeof plugin.open !== 'function')
        continue;

      await plugin.open(this.pkg);
    }
  }

  async rewrite(module, path) {
    assert(typeof path === 'string');

    if (path.endsWith('.mjs'))
      path = path.slice(0, -4) + '.js';

    for (const plugin of this.running) {
      if (typeof plugin.rewrite !== 'function')
        continue;

      path = await plugin.rewrite(module, path);

      if (typeof path !== 'string')
        throw new TypeError('plugin.rewrite() must return a string!');
    }

    return path;
  }

  async compile(module, code) {
    assert(module instanceof Module);
    assert(Buffer.isBuffer(code));

    for (const plugin of this.running) {
      if (typeof plugin.compile !== 'function')
        continue;

      code = await plugin.compile(module, code);

      if (typeof code === 'string')
        code = Buffer.from(code, 'utf8');

      if (!Buffer.isBuffer(code))
        throw new TypeError('plugin.compile() must return a buffer!');
    }

    return code.toString('utf8');
  }

  async transform(module, code) {
    assert(module instanceof Module);
    assert(typeof code === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.transform !== 'function')
        continue;

      code = await plugin.transform(module, code);

      if (typeof code !== 'string')
        throw new TypeError('plugin.transform() must return a string!');
    }

    return code;
  }

  async final(module, code) {
    assert(module instanceof Module);
    assert(typeof code === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.final !== 'function')
        continue;

      code = await plugin.final(module, code);

      if (typeof code !== 'string')
        throw new TypeError('plugin.final() must return a string!');
    }

    return code;
  }

  async close() {
    for (const plugin of this.running) {
      if (typeof plugin.close !== 'function')
        continue;

      await plugin.close(this.pkg);
    }

    this.running.length = 0;
  }

  async writeBuild() {
    const file = resolve(this.output, 'build');
    const code = await this.createBuild();

    return fs.writeFile(file, code, {
      mode: 0o755
    });
  }

  async createBuild() {
    const {name, version, mtime} = this.pkg;
    const {installs, engine} = this;

    let gyp = false;

    for (const [pkg] of installs) {
      if (pkg.install.includes('node-gyp')) {
        gyp = true;
        break;
      }
    }

    const encoded = encodeVersion(engine);

    const mods = [...installs].sort(([a], [b]) => {
      return cmpString(a.name, b.name);
    });

    const modules = [];

    for (const [pkg, path, optional] of mods) {
      const {name, install} = pkg;
      const dir = relative(this.output, path);

      modules.push([name, dir, install, optional]);
    }

    const links = this.pkg.getLinks();

    return template('build.js', {
      name,
      version,
      time: mtime.toISOString(),
      modules: stringify(modules, null, 2),
      links: stringify(links, null, 2),
      engine: engine || null,
      encoded: stringify(encoded),
      gyp
    });
  }

  async writeInstall() {
    const file = resolve(this.output, 'install');
    const code = await this.createInstall();

    return fs.writeFile(file, code, {
      mode: 0o755
    });
  }

  async createInstall() {
    const {name, version, mtime} = this.pkg;
    const links = this.pkg.getLinks();

    return template('install.js', {
      name,
      version,
      time: mtime.toISOString(),
      links: stringify(links, null, 2)
    });
  }

  async initPkg() {
    if (this.multi) {
      const pkg = await this.getPackage(this.input);

      // Multi-mode is pretty strict about its input.
      if (!pkg.json) {
        const err = new Error(`Cannot find module: '${this.input}'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      return pkg;
    }

    // Try to find a package.json.
    // Will fail with a sentinel.
    const root = await findRoot(this.input);
    const pkg = await this.getPackage(root);

    // Get the correct file extension.
    if (!this.code || basename(this.input) !== DUMMY)
      this.input = await pkg.resolve(this.input);

    return pkg;
  }

  async build() {
    // Initialize plugins.
    await this.load();

    // Load the root package.
    const pkg = await this.initPkg();

    // Expose some properties for plugins.
    if (!this.name)
      this.name = pkg.name;

    this.version = pkg.version;
    this.path = pkg.path;
    this.root = pkg.root;
    this.resolve = pkg.resolve;
    this.require = pkg.resolve.require;

    if (this.output) {
      let base = basename(this.output);

      // Expand variables.
      base = base.replace(/\{\}/, () => '%f');
      base = base.replace(/%f/, () => '%n-%v');
      base = base.replace(/%n/, () => pkg.name);
      base = base.replace(/%v/, () => pkg.version);

      this.output = resolve(dirname(this.output), base);

      const parent = dirname(this.output);

      if (!await isDirectory(parent))
        await fs.mkdir(parent, RECURSIVE);

      const tarball = this.output.endsWith('.tar')
                   || this.output.endsWith('.tar.gz');

      if (tarball) {
        const base = basename(this.output);
        const tmp = resolve(PREFIX, `${Date.now()}-${base}`);
        const wrapper = base.replace(/\.tar(?:\.[^\.]+)?$/, '');

        // Switch.
        this.tarball = this.output;
        this.output = resolve(tmp, wrapper);

        await fs.mkdir(this.output, RECURSIVE);
      }
    }

    // Open plugins.
    await this.open();

    let out;

    if (this.tarball) {
      const {output, tarball} = this;
      const tmp = resolve(output, '..');

      try {
        out = await this._build();
        await this.tarify(tmp, tarball, pkg.mtime);
      } finally {
        assert(tmp.startsWith(PREFIX));
        await fs.rimraf(tmp);
      }
    } else {
      out = await this._build();
    }

    await this.close();

    return out;
  }

  async _build() {
    // First path: multi. Traverse package
    // and its dependents recursively,
    // copying all package files along the
    // way.
    if (this.multi) {
      if (!this.output)
        throw new Error('No output directory specified.');

      await this.pkg.multify(this.output);
      await this.writeBuild();
      await this.writeInstall();

      return null;
    }

    // Second path: bundle. Compile all
    // source files into a single file,
    // suitable for node.js or the browser.
    const module = await this.getModule(this.input, this.code);
    const modules = [];

    let out = '';
    let license = null;
    let timers = null;
    let process = null;
    let buffer = null;
    let console = null;

    const environment = [];
    const globals = [];
    const requires = [];

    if (this.env === 'browser') {
      if (this.hasTimers)
        timers = await this.getID(builtins.timers);

      if (this.hasProcess)
        process = await this.getID(builtins.process);

      if (this.hasBuffer)
        buffer = await this.getID(builtins.buffer);

      if (this.hasConsole)
        console = await this.getID(builtins.console);
    }

    for (const key of Object.keys(this.environment))
      environment.push([key, String(this.environment[key])]);

    for (const key of Object.keys(this.globals))
      globals.push([key, this.globals[key]]);

    for (const name of this.requires) {
      const path = await this.resolve(name);
      requires.push(await this.getID(path));
    }

    if (!this.noLicense && this.hasLicense) {
      license = '';
      license += '/*!\n';

      for (const pkg of this.pkgs) {
        if (!pkg.licenseText)
          continue;

        if (pkg.isBuiltin())
          continue;

        license += ` * License for ${pkg.name}@${pkg.version}:\n`;
        license += ' *\n';

        license += (pkg.licenseText + '\n').replace(/^/gm, ' * ');
        license += '\n';
      }

      license = license.replace(/ +$/gm, '');
      license += ' */';
    }

    if (this.env === 'node'
        && this.modules.length === 1
        && this.bindings.size === 0
        && environment.length === 0
        && globals.length === 0
        && requires.length === 0
        && !this.hasMeta) {
      if (module.hashbang)
        out += module.hashbang + '\n';

      if (license) {
        out += '\n';
        out += license + '\n';
      }

      out += '\n';
      out += module.code;
    } else {
      for (const {id, pkg, location, wrapped} of this.modules) {
        const item = [
          stringify(pkg.name),
          stringify(location),
          wrapped
        ];

        modules.push(`[/* ${id} */ ${item.join(', ')}]`);
      }

      if (this.env === 'browser') {
        out = await template('browser.js', {
          license,
          timers,
          process,
          buffer,
          console,
          env: environment.length > 0
            ? indent(stringify(environment, null, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, null, 2), 1)
            : null,
          requires: requires.length > 0
            ? stringify(requires)
            : null,
          exports: this.exports,
          global: this.global,
          name: stringify(this.name),
          modules: modules.join(',\n')
        });
      } else {
        out = await template('node.js', {
          hashbang: module.hashbang,
          license,
          env: environment.length > 0
            ? indent(stringify(environment, null, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, null, 2), 1)
            : null,
          requires: requires.length > 0
            ? stringify(requires)
            : null,
          modules: modules.join(',\n'),
          bindings: this.hasBindings
        });
      }
    }

    out = out.trim() + '\n';
    out = await this.final(this.module, out);

    if (this.collectBindings) {
      if (!this.output)
        throw new Error('No output directory specified.');

      const name = module.hashbang
        ? this.name
        : 'index.js';

      const dir = this.bindings.size > 0
        ? resolve(this.output, 'bindings')
        : this.output;

      await fs.mkdir(dir, RECURSIVE);

      for (const binding of this.bindings) {
        const path = resolve(this.output, 'bindings', basename(binding));

        await fs.copyFile(binding, path);
      }

      await fs.writeFile(resolve(this.output, name), out, {
        mode: module.hashbang ? 0o755 : 0o644
      });

      return null;
    }

    if (this.output) {
      await fs.writeFile(this.output, out, {
        mode: module.hashbang ? 0o755 : 0o644
      });

      return null;
    }

    return out;
  }

  /*
   * Helpers
   */

  async tarify(src, dest, time) {
    if (time == null)
      time = new Date();

    assert(typeof src === 'string');
    assert(typeof dest === 'string');
    assert(time instanceof Date);

    const options = {
      cwd: src,
      file: dest,
      gzip: dest.endsWith('.gz'),
      portable: true,
      mode: 0o644,
      follow: false,
      mtime: time,
      onwarn: (msg, data) => {
        this.log('Tarball warning:');
        this.log(msg);
      }
    };

    const names = await fs.readdir(src);

    return new Promise((resolve, reject) => {
      const cb = (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      try {
        tar.create(options, names, cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  /*
   * API
   */

  static async build(options) {
    return new this(options).build();
  }
}

/**
 * Package
 */

class Package {
  constructor(bundle, root) {
    assert(bundle instanceof Bundle);
    assert(typeof root === 'string');

    this.bundle = bundle;
    this.id = bundle.pkgID++;
    this.root = root;
    this.path = resolve(root, 'package.json');
    this.json = null;
    this.name = 'root';
    this.version = '0.0.0';
    this.main = null;
    this.deps = [];
    this.bin = [];
    this.man = [];
    this.install = null;
    this.engine = 0;
    this.license = null;
    this.licenseText = null;
    this.mtime = new Date();
    this.resolve = bundle.resolver(this.root);
  }

  async init() {
    const {root} = this;
    const path = resolve(root, 'package.json');
    const json = await readJSON(path);
    const deps = [];
    const bin = [];
    const man = [];

    let install = null;
    let engine = 0;
    let license = null;
    let licenseText = null;

    if (json == null) {
      this.name = basename(root);
      return this;
    }

    if (json == null || typeof json !== 'object')
      throw new Error(`Invalid package.json (${path}).`);

    if (json.name == null)
      json.name = basename(root);

    if (!json.name || typeof json.name !== 'string')
      throw new Error(`Invalid package.name (${path}).`);

    if (json.version == null)
      json.version = '0.0.0';

    if (!json.version || typeof json.version !== 'string')
      throw new Error(`Invalid package.version (${path}).`);

    if (json.main == null)
      json.main = null;

    if (json.main != null && typeof json.main !== 'string')
      throw new Error(`Invalid package.main (${path}).`);

    for (const fieldName of ['dependencies',
                             'optionalDependencies',
                             'peerDependencies',
                             'devDependencies']) {
      const field = json[fieldName];

      if (!field || typeof field !== 'object')
        continue;

      for (const name of Object.keys(field)) {
        let version = field[name];

        if (typeof version !== 'string')
          throw new Error(`Invalid package version (${path}).`);

        if (version.length === 0)
          version = '*';

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

    if (json.bin && typeof json.bin === 'string') {
      json.bin = Object.create(null);
      json.bin[json.name] = json.bin;
    }

    if (json.bin && typeof json.bin === 'object') {
      for (const cmd of Object.keys(json.bin)) {
        if (cmd.length === 0)
          continue;

        const path = json.bin[cmd];

        if (path && typeof path === 'string')
          bin.push([cmd, path]);
      }
    }

    if (json.man && typeof json.man === 'string')
      json.man = [json.man];

    if (Array.isArray(json.man)) {
      for (const file of json.man) {
        if (typeof file !== 'string')
          continue;

        if (/.\.\d$/.test(file))
          man.push(file);
      }
    }

    if (json.scripts && typeof json.scripts === 'object') {
      const {scripts} = json;

      if (scripts.install && typeof scripts.install === 'string')
        install = scripts.install;
    }

    if (json.engines && typeof json.engines === 'object')
      engine = decodeVersion(json.engines.node);

    for (const name of ['LICENSE',
                        'license',
                        'LICENSE.md',
                        'license.md',
                        'LICENSE.txt',
                        'license.txt',
                        'LICENCE',
                        'licence',
                        'LICENCE.md',
                        'licence.md',
                        'LICENCE.txt',
                        'licence.txt',
                        'COPYING',
                        'copying',
                        'COPYING.md',
                        'copying.md',
                        'COPYING.txt',
                        'copying.txt']) {
      const path = resolve(root, name);

      if (await isFile(path)) {
        license = name;

        licenseText = await fs.readFile(path, 'utf8');
        licenseText = licenseText.trim();
        licenseText = licenseText.replace(/\r\n/g, '\n');
        licenseText = licenseText.replace(/\r/g, '\n');
        licenseText = licenseText.replace(/\t/g, '  ');

        this.bundle.hasLicense = !this.isBuiltin();

        break;
      }
    }

    this.json = json;
    this.name = json.name;
    this.version = json.version;
    this.main = json.main;
    this.deps = deps;
    this.bin = bin;
    this.man = man;
    this.install = install;
    this.engine = engine;
    this.license = license;
    this.licenseText = licenseText;
    this.mtime = (await fs.stat(path)).mtime;

    return this;
  }

  isBuiltin() {
    return resolve(this.root, '.') === resolve(__dirname, '..');
  }

  getLinks() {
    const links = [];

    for (const [cmd, path] of this.bin) {
      const from = join('$NODE_MODULES', this.name, path);
      const to = join('$BIN', cmd);

      links.push(['bin', from, to]);
    }

    for (const file of this.man) {
      const base = basename(file);
      const section = extname(file).substring(1);
      const from = join('$NODE_MODULES', this.name, file);
      const to = join('$MAN', `man${section}`, base);

      links.push(['man', from, to, 'man']);
    }

    if (this.license) {
      const from = join('$NODE_MODULES', this.name, this.license);
      const to = join('$LICENSES', this.name, 'LICENSE');

      links.push(['license', from, to]);
    }

    return links;
  }

  traverse(cb) {
    return traverse(this.root, cb);
  }

  async resolveModule(name) {
    assert(typeof name === 'string');

    let path;
    try {
      path = await this.resolve(`${name}/package.json`);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        return null;
      throw e;
    }

    return resolve(path, '..');
  }

  async multify(dir) {
    assert(typeof dir === 'string');
    return this.copy(resolve(dir, this.name));
  }

  async copy(dest) {
    assert(typeof dest === 'string');

    if (await isDirectory(dest))
      await fs.rimraf(dest);

    return this._copy(dest, dest, false);
  }

  async _copy(root, dest, optional) {
    assert(typeof root === 'string');
    assert(typeof dest === 'string');
    assert(typeof optional === 'boolean');

    if (this.install)
      this.bundle.installs.push([this, dest, optional]);

    await this._replicate(dest, optional);

    for (const dep of this.deps) {
      if (dep.type === 'dev')
        continue;

      const path = await this.resolveModule(dep.name);

      const pkg = path
        ? (await this.bundle.getPackage(path))
        : null;

      if (!pkg || !pkg.json) {
        if (this.bundle.ignoreMissing)
          continue;

        const err = new Error(`Cannot find module: '${dep.name}'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      let next = resolve(root, 'node_modules', pkg.name);

      if (await isDirectory(next)) {
        const file = resolve(next, 'package.json');
        const json = await readJSON(file);

        if (json == null || typeof json !== 'object')
          throw new Error(`Invalid package.json: ${file}.`);

        // Already included same version in root.
        if (json.version === pkg.json.version)
          continue;

        // Delve deeper.
        next = resolve(dest, 'node_modules', pkg.name);

        if (await isDirectory(next))
          continue;
      }

      await pkg._copy(root, next, optional || dep.type === 'optional');
    }
  }

  async _replicate(dest, optional) {
    assert(typeof dest === 'string');
    assert(typeof optional === 'boolean');

    if (!await isDirectory(dest))
      await fs.mkdir(dest, RECURSIVE);

    await this.traverse(async (file, stat) => {
      const name = basename(file);
      const ext = extname(file);
      const from = resolve(this.root, file);
      const to = resolve(dest, file);
      const fromDir = dirname(from);
      const toDir = dirname(to);

      if (stat.isSymbolicLink()) {
        if (!await isDirectory(toDir))
          await fs.mkdir(toDir, RECURSIVE);

        const link = await fs.readlink(from);

        if (!isAbsolute(link))
          await fs.symlink(link, to);

        return;
      }

      if (this.bundle.collectBindings) {
        if (this.bundle.excludeSource) {
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
                return;
              break;
          }
        }

        if (name === 'binding.gyp') {
          const buildFrom = resolve(fromDir, 'build');
          const buildTo = resolve(toDir, 'build');

          try {
            await gypBuild(fromDir);
          } catch (e) {
            if (!optional)
              throw e;
          }

          await traverse(buildFrom, async (file, stat) => {
            if (!stat.isFile())
              return;

            if (extname(file) !== '.node')
              return;

            const from = resolve(buildFrom, file);
            const to = resolve(buildTo, file);
            const fromDir = dirname(from);
            const toDir = dirname(to);

            if (basename(fromDir) === 'obj.target')
              return;

            if (!await isDirectory(toDir))
              await fs.mkdir(toDir, RECURSIVE);

            await fs.copyFile(from, to, COPYFILE_FLAGS);
          });
        }
      }

      if (!await isDirectory(toDir))
        await fs.mkdir(toDir, RECURSIVE);

      if (name === 'package.json') {
        const json = await readJSON(from);

        if (json == null || typeof json !== 'object')
          throw new Error(`Invalid package.json: ${from}.`);

        let changed = false;

        // Get rid of all the npm crap.
        for (const key of Object.keys(json)) {
          if (key[0] === '_') {
            delete json[key];
            changed = true;
          }
        }

        if (changed) {
          const out = stringify(json, null, 2);
          await fs.writeFile(to, out + '\n');
          return;
        }
      }

      let code = null;
      let hashbang = false;

      if (this.bundle.hasExtension(from)) {
        code = await fs.readFile(from);
      } else if (ext === '' && stat.size < (20 << 20)) {
        code = await fs.readFile(from);
        hashbang = code.toString('utf8', 0, 64);
        hashbang = /^#![^\n]*?node/.test(hashbang);

        if (!hashbang)
          code = null;
      }

      if (code == null) {
        await fs.copyFile(from, to, COPYFILE_FLAGS);
        return;
      }

      const module = new Module(this.bundle, from);

      await module.init();

      code = await this.bundle.compile(module, code);
      code = await module.transform(code);
      code = await this.bundle.transform(module, code);
      code = await this.bundle.final(module, code);

      const outFile = await this.bundle.rewrite(module, to);

      await fs.writeFile(outFile, code, {
        mode: hashbang ? 0o755 : 0o644
      });
    });
  }
}

/**
 * Module
 */

class Module {
  constructor(bundle, path, rawCode) {
    assert(bundle instanceof Bundle);
    assert(typeof path === 'string');
    assert(!rawCode || Buffer.isBuffer(rawCode));

    this.bundle = bundle;
    this.id = bundle.moduleID++;
    this.path = path;
    this.rawCode = rawCode || null;
    this.dir = dirname(path);
    this.name = basename(path);
    this.ext = extname(path);
    this.type = this.getType();
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.strict = false;
    this.esm = false;
    this.code = '';
    this.wrapped = '';
    this.resolve = bundle.resolver(path);
  }

  get location() {
    return '/' + unix(relative(this.root, this.path));
  }

  async init() {
    this.root = await findRoot(this.dir);
    this.pkg = await this.bundle.getPackage(this.root);
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

  isBuiltin() {
    return this.pkg.isBuiltin();
  }

  makeError(location) {
    assert(typeof location === 'string');

    if (this.bundle.multi || this.bundle.single) {
      const err = new Error(`Cannot find module: '${location}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    return `__${this.bundle.env}_error__(${stringify(location)})`;
  }

  makeRequire(id) {
    assert(!this.bundle.multi);

    assert(typeof id === 'number');

    if (this.bundle.env === 'browser')
      return `__browser_require__(${id}, module)`;

    return `__node_require__(${id})`;
  }

  makeRawRequire(path) {
    assert(typeof path === 'string');
    return `require(${stringify(path)})`;
  }

  async makeOpen(path) {
    assert(!this.bundle.multi);

    assert(typeof path === 'string');

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${stringify(name)},`
         + `${stringifyBuffer(raw)});`
         + '\n';
  }

  async makeJSON(path) {
    assert(!this.bundle.multi);

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
    assert(!this.bundle.multi);

    if (this.rawCode)
      return this.rawCode;

    if (this.type === 'binding')
      return this.makeOpen(this.path);

    if (this.type === 'json')
      return this.makeJSON(this.path);

    return fs.readFile(this.path);
  }

  async compile() {
    assert(!this.bundle.multi);

    let code = await this.readCode();

    if (this.type === 'bin' || this.type === 'lib') {
      code = await this.bundle.compile(this, code);

      code = code.replace(/^#![^\n]*/, (hashbang) => {
        this.hashbang = hashbang;
        return '';
      });

      code = await this.transform(code);
      code = await this.bundle.transform(this, code);
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

  sourceType() {
    if (this.path.endsWith('.mjs'))
      return 'module';

    if (this.pkg.json && this.pkg.json.mode === 'esm')
      return 'module';

    return 'script';
  }

  async transform(code) {
    assert(typeof code === 'string');

    if (this.bundle.multi && this.bundle.requires.length > 0) {
      const requires = [];

      for (const name of this.bundle.requires)
        requires.push(this.makeRawRequire(name) + ';');

      code = requires.join('\n') + code;
    }

    let type = this.sourceType();
    let root;

    try {
      root = parseCode(code, type, this.path);
    } catch (e) {
      if (type === 'module')
        throw e;

      // Try again as a module.
      type = 'module';
      root = parseCode(code, type, this.path);
    }

    this.esm = type === 'module';

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
        case 'Literal':
          filter = this.Literal;
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

    if (this.esm && !this.strict)
      out = '\'use strict\';\n\n' + out;

    return out;
  }

  async require(location) {
    assert(typeof location === 'string');

    if (this.bundle.multi || this.bundle.single)
      return this.makeRawRequire(location);

    let path;

    try {
      path = await this.resolve(location);
    } catch (e) {
      if (this.bundle.ignoreMissing) {
        if (this.bundle.env === 'browser')
          return this.makeError(location);
        return this.makeRawRequire(location);
      }
      throw e;
    }

    if (isAbsolute(path) && extname(path) === '.node') {
      if (this.bundle.env === 'browser')
        return this.makeError(location);

      if (this.bundle.collectBindings) {
        this.bundle.bindings.add(path);
        return this.makeRawRequire(`./bindings/${basename(path)}`);
      }

      this.bundle.hasBindings = true;
    }

    if (this.bundle.env === 'browser') {
      if (!isAbsolute(path)) {
        path = builtins[path];

        if (!path) {
          if (this.bundle.ignoreMissing)
            return this.makeError(location);

          throw new Error(`Could not resolve module: ${path}.`);
        }
      }
    }

    if (isAbsolute(path)) {
      const id = await this.bundle.getID(path);
      return this.makeRequire(id);
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

    if (this.bundle.multi || this.bundle.single)
      return null;

    if (this.isBindings(node)) {
      const arg = node.arguments[0];

      if (this.bundle.env === 'browser')
        return [node, this.makeError(arg.value)];

      let path = await this.tryBinding(arg.value);

      if (!path) {
        if (this.bundle.ignoreMissing)
          return [node, this.makeError(arg.value)];
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
           + `  ? ${name}['default']\n`
           + `  : ${name};\n`;
    }

    if (namespace)
      out += `var ${namespace} = ${name};\n`;

    for (const [imported, local] of imports)
      out += `var ${local} = ${name}[${stringify(imported)}];\n`;

    return [node, out];
  }

  async ExportAllDeclaration(node, code, id) {
    // export * from 'foo';
    const name = `__bpkg_export_${id}__`;
    const key = `__bpkg_key_${id}__`;
    const source = node.source.value;

    let out = '';

    if (id === 0)
      out += 'exports._esModule = true;\n';

    out += `var ${name} = `
        + (await this.require(source))
        + ';\n';

    out += `for (var ${key} in ${name}) {\n`;
    out += `  if (${key} === 'default')\n`;
    out += '    continue;\n';
    out += '\n';
    out += `  if (Object.prototype.hasOwnProperty.call(${name}, ${key}))\n`;
    out += `    exports[${key}] = ${name}[${key}];\n`;
    out += '}\n';
    out += '({ __proto__: exports });\n';

    return [node, out];
  }

  async ExportDefaultDeclaration(node, code, id) {
    // export default foo;
    const {start, end} = node.declaration;

    let out = '';

    if (id === 0)
      out += 'exports._esModule = true;\n';

    out += 'exports[\'default\'] = '
         + code.substring(start, end)
         + ';\n';

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

    if (id === 0)
      out += 'exports._esModule = true;\n';

    if (source) {
      const name = `__bpkg_export_${id}__`;

      out += `var ${name} = `
          + (await this.require(source))
          + ';\n';

      if (namespace)
        out += `exports[${stringify(namespace)}] = ${name};\n`;

      for (const [value, key] of exports) {
        if (value === 'default') {
          out += `exports[${stringify(key)}] = ${name}._esModule\n`
               + `  ? ${name}['default']\n`
               + `  : ${name};\n`;
          continue;
        }
        out += `exports[${stringify(key)}] = ${name}[${stringify(value)}];\n`;
      }
    } else {
      for (const [key, value] of declarations) {
        out += `var ${key} = ${value};\n`;
        out += `exports.${key} = ${key};\n`;
      }

      for (const [value, key] of exports)
        out += `exports[${stringify(key)}] = ${value};\n`;
    }

    return [node, out];
  }

  async MetaProperty(node) {
    // import.meta;
    this.bundle.hasMeta = true;
    return [node, '__meta'];
  }

  async Identifier(node) {
    switch (node.name) {
      case 'setTimeout':
      case 'clearTimeout':
      case 'setInterval':
      case 'clearInterval':
      case 'setImmediate':
      case 'clearImmediate':
        this.bundle.hasTimers = true;
        break;
      case 'process':
        this.bundle.hasProcess = true;
        break;
      case 'Buffer':
        this.bundle.hasBuffer = true;
        break;
      case 'console':
        this.bundle.hasConsole = true;
        break;
    }
    return null;
  }

  async Literal(node) {
    if (typeof node.value !== 'string')
      return null;

    if (node.value !== 'use strict')
      return null;

    this.strict = true;

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
  const options = { cwd };

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

function encodeVersion(num) {
  assert((num >>> 0) === num);

  return [
    (num >>> 16) & 0xff,
    (num >>>  8) & 0xff,
    (num >>>  0) & 0xff
  ].join('.');
}

function decodeVersion(str) {
  if (typeof str !== 'string')
    return 0;

  str = str.replace(/\s+/g, '');
  str = str.replace(/^(?:~|\^|>=)/, '');
  str = str.replace(/^v/, '');

  if (!/^\d+\.\d+\.\d+/.test(str))
    return 0;

  const parts = str.split(/[^\d]/);

  return (0
    + (parts[0] & 0xff) * 0x10000
    + (parts[1] & 0xff) * 0x00100
    + (parts[2] & 0xff) * 0x00001);
}

function cmpString(a, b) {
  assert(typeof a === 'string');
  assert(typeof b === 'string');

  if (a === b)
    return 0;

  return a < b ? -1 : 1;
}

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str;

  return str.replace(/^/gm, ' '.repeat(depth * 2)).trim();
}

/*
 * Parsing
 */

function parseCode(code, type, path) {
  assert(typeof code === 'string');
  assert(typeof type === 'string');
  assert(typeof path === 'string');
  assert(type === 'script' || type === 'module');

  try {
    return acorn.parse(code, {
      ecmaVersion: 10,
      sourceType: type,
      allowHashBang: true,
      allowReturnOutsideFunction: true
    });
  } catch (e) {
    e.message += ` (${path})`;
    throw e;
  }
}

/*
 * Templating
 */

const COMMENT_RX = /\/\*(?!\!)[\s\S]*?\*\/\n{0,2}/g;
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
 * API
 */

const bpkg = Bundle.build.bind(Bundle);

bpkg.build = bpkg;
bpkg.Bundle = Bundle;
bpkg.Package = Package;
bpkg.Module = Module;
bpkg.Resolver = Resolver;

/*
 * Expose
 */

module.exports = bpkg;
