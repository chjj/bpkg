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
const util = require('util');
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

const NODE_WRAPPER = [
  'function(exports, module, __filename, __dirname, __meta) {',
  '}'
];

const BROWSER_WRAPPER = [
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
    this.stream = process.stderr;
    this.input = CWD;
    this.output = null;
    this.code = null;
    this.env = 'node';
    this.extensions = ['.js', '.mjs'];
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.excludeSource = false;
    this.noHeader = false;
    this.noLicense = false;
    this.time = new Date();
    this.multi = false;
    this.standalone = false;
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

    if (typeof options.noHeader === 'boolean')
      this.noHeader = options.noHeader;

    if (typeof options.noLicense === 'boolean')
      this.noLicense = options.noLicense;

    if (options.time instanceof Date)
      this.time = options.time;

    if (typeof options.multi === 'boolean')
      this.multi = options.multi;

    if (typeof options.standalone === 'boolean')
      this.standalone = options.standalone;

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
    if (!this.verbose)
      return this;

    if (typeof msg === 'string') {
      msg = util.format.apply(util, arguments);
    } else {
      msg = util.inspect(msg, {
        depth: 5,
        colors: Boolean(this.stream.isTTY),
        customInspect: true,
        breakLength: Infinity,
        compact: false
      });
    }

    this.stream.write(msg + '\n');

    return this;
  }

  resolver(path) {
    if (typeof path !== 'string')
      return Resolver.create(path);

    const extensions = this.extensions;
    const redirect = this.redirect.bind(this);

    let field = this.env;

    if (this.multi)
      field = null;

    if (this.browserField)
      field = 'browser';

    return Resolver.create({
      root: path,
      extensions,
      npm: true,
      field,
      redirect
    });
  }

  addExtension(exts) {
    if (!Array.isArray(exts))
      exts = [exts];

    assert(Array.isArray(exts));

    for (const ext of exts) {
      assert(typeof ext === 'string');

      if (this.extensions.includes(ext))
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

      this.log('Loaded package: %s@%s (%d) at %s.',
               pkg.name, pkg.version, pkg.id, pkg.root);

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

      this.log('Loaded module: %s%s (%d).',
               module.pkg.name,
               module.location,
               module.id);

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

      this.log('Loading plugin: %s.', String(func.name).toLowerCase());

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

  async redirect(location, from) {
    assert(typeof location === 'string');
    assert(typeof from === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.redirect !== 'function')
        continue;

      location = await plugin.redirect(location, from);

      if (typeof location !== 'string')
        throw new TypeError('plugin.redirect() must return a string!');
    }

    return location;
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
    const {name, version} = this.pkg;
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
      time: this.time.toISOString(),
      modules: stringify(modules, 2),
      links: stringify(links, 2),
      engine: engine || null,
      encoded: string(encoded),
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
    const {name, version} = this.pkg;
    const links = this.pkg.getLinks();

    return template('install.js', {
      name,
      version,
      time: this.time.toISOString(),
      links: stringify(links, 2)
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
    this.log('Building with options:');
    this.log({
      input: this.input,
      output: this.output,
      code: this.code,
      env: this.env,
      extensions: this.extensions,
      browserField: this.browserField,
      ignoreMissing: this.ignoreMissing,
      collectBindings: this.collectBindings,
      excludeSource: this.excludeSource,
      noHeader: this.noHeader,
      noLicense: this.noLicense,
      time: this.time,
      multi: this.multi,
      standalone: this.standalone,
      name: this.name,
      plugins: this.plugins,
      environment: this.environment,
      globals: this.globals,
      requires: this.requires,
      verbose: this.verbose
    });

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

    this.log('Building root package "%s" from %s.',
             pkg.name, this.input);

    if (this.output) {
      let base = basename(this.output);

      // Expand variables.
      base = base.replace(/\{\}/, '%f');
      base = base.replace(/%f/, '%n-%v');
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
        const wrapper = base.replace(/\.tar(?:\.gz)?$/, '');

        // Switch.
        this.tarball = this.output;
        this.output = resolve(tmp, wrapper);

        await fs.mkdir(this.output, RECURSIVE);
      }

      this.log('Outputting to: %s.', this.output);

      if (this.tarball)
        this.log('Tarball: %s.', this.tarball);
    }

    // Open plugins.
    await this.open();

    let out;

    if (this.tarball) {
      const {output, tarball} = this;
      const tmp = resolve(output, '..');

      try {
        out = await this._build();
        await this.tarify(tmp, tarball, this.time);
      } finally {
        assert(tmp.startsWith(PREFIX));
        await fs.rimraf(tmp);
      }
    } else {
      out = await this._build();
    }

    await this.close();

    this.log('Build complete.');

    if (this.output)
      this.log('Output at: %s.', this.tarball || this.output);

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
    let header = [];
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

    if (!this.noHeader) {
      const {pkg} = this;
      const {name, version, homepage} = pkg;
      const year = this.time.getFullYear();

      let description = '';
      let author = '';
      let license = '';

      if (pkg.description && pkg.description.length < 50)
        description = ` - ${pkg.description}`;

      if (pkg.author)
        author = pkg.author.split(' <')[0];

      if (pkg.license)
        license = ` (${pkg.license})`;

      header.push(`${name}@${version}${description}`);

      if (author)
        header.push(`Copyright (c) ${year}, ${author}${license}`);

      if (homepage)
        header.push(homepage);
    }

    if (!this.noLicense) {
      if (header.length > 0)
        header.push('');

      for (const pkg of this.pkgs) {
        if (!pkg.licenseText)
          continue;

        if (pkg.isBuiltin())
          continue;

        header.push(`License for ${pkg.name}@${pkg.version}:`);
        header.push('');

        for (const line of pkg.licenseText.split('\n'))
          header.push(line);

        header.push('');
      }

      header.pop();
    }

    if (header.length > 0) {
      let str = '';

      str += '/*!\n';

      for (const line of header) {
        if (line.length === 0)
          str += ' *\n';
        else
          str += ` * ${line}\n`;
      }

      str += ' */';

      header = str;
    } else {
      header = null;
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

      if (header) {
        out += '\n';
        out += header + '\n';
      }

      out += '\n';
      out += module.code;
    } else {
      for (const module of this.modules) {
        const {id, pkg, location, code} = module;

        const item = [
          string(pkg.name),
          string(location),
          module.wrap(code)
        ];

        modules.push(`[/* ${id} */ ${item.join(', ')}]`);
      }

      if (this.env === 'browser') {
        out = await template('browser.js', {
          header,
          timers,
          process,
          buffer,
          console,
          meta: this.hasMeta,
          env: this.hasProcess && environment.length > 0
            ? indent(stringify(environment, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, 2), 1)
            : null,
          requires: requires.length > 0
            ? stringify(requires)
            : null,
          standalone: this.standalone,
          name: string(this.name),
          modules: modules.join(',\n')
        });
      } else {
        out = await template('node.js', {
          hashbang: module.hashbang,
          header,
          meta: this.hasMeta,
          env: environment.length > 0
            ? indent(stringify(environment, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, 2), 1)
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

    this.log('Creating tarball: %s.', dest);

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
    this.name = basename(root);
    this.version = '0.0.0';
    this.description = null;
    this.author = null;
    this.homepage = null;
    this.license = null;
    this.main = null;
    this.deps = [];
    this.bin = [];
    this.man = [];
    this.install = null;
    this.engine = 0;
    this.licenseFile = null;
    this.licenseText = null;
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
    let licenseFile = null;
    let licenseText = null;

    if (json == null)
      return this;

    if (json == null || typeof json !== 'object')
      throw new Error(`Invalid package.json (${path}).`);

    if (json.name == null)
      json.name = this.name;

    if (!json.name || typeof json.name !== 'string')
      throw new Error(`Invalid package.name (${path}).`);

    if (json.version == null)
      json.version = '0.0.0';

    if (!json.version || typeof json.version !== 'string')
      throw new Error(`Invalid package.version (${path}).`);

    if (typeof json.description !== 'string')
      json.description = null;

    if (json.author && typeof json.author === 'object') {
      const {author} = json;

      if (typeof author.name === 'string'
          && typeof author.email === 'string') {
        json.author = `${author.name} <${author.email}>`;
      } else if (typeof author.name === 'string') {
        json.author = author.name;
      } else if (typeof author.email === 'string') {
        json.author = `<${author.email}>`;
      }
    }

    if (typeof json.author !== 'string')
      json.author = null;

    if (typeof json.homepage !== 'string')
      json.homepage = null;

    if (typeof json.license !== 'string')
      json.license = null;

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

    for (const name of (await fs.readdir(root))) {
      if (!/^(licen[cs]e|copying)/i.test(name))
        continue;

      const path = resolve(root, name);

      if (await isFile(path)) {
        licenseFile = name;
        licenseText = await fs.readFile(path, 'utf8');
        licenseText = wrapText(licenseText, 77);
        break;
      }
    }

    this.json = json;
    this.name = json.name;
    this.version = json.version;
    this.description = json.description;
    this.author = json.author;
    this.homepage = json.homepage;
    this.license = json.license;
    this.main = json.main;
    this.deps = deps;
    this.bin = bin;
    this.man = man;
    this.install = install;
    this.engine = engine;
    this.licenseFile = licenseFile;
    this.licenseText = licenseText;

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

    if (this.licenseFile) {
      const from = join('$NODE_MODULES', this.name, this.licenseFile);
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

    try {
      return await this.resolve.directory(name);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        return null;
      throw e;
    }
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

    this.bundle.log('Copying package: %s@%s -> %s.',
                    this.name, this.version, dest);

    await this._replicate(dest, optional);

    for (const dep of this.deps) {
      if (dep.type === 'dev')
        continue;

      const path = await this.resolveModule(dep.name);

      const pkg = path
        ? (await this.bundle.getPackage(path))
        : null;

      if (!pkg || !pkg.json) {
        if (this.bundle.ignoreMissing) {
          this.bundle.log('Warning: ignoring missing module: %s.', path);
          continue;
        }

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

          this.bundle.log('Building binding: %s.', fromDir);

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

        // Get rid of all the npm crap.
        if (cleanPackage(json)) {
          const out = stringify(json, 2);
          await fs.writeFile(to, out + '\n');
          return;
        }
      }

      let isCode = this.bundle.hasExtension(from);

      if (ext === '')
        isCode = await isHashbang(from);

      if (!isCode) {
        await fs.copyFile(from, to, COPYFILE_FLAGS);
        return;
      }

      const module = new Module(this.bundle, from);

      await module.init();
      await module.open();

      let code = await this.bundle.final(module, module.code);
      let mode = 0o644;

      if (module.hashbang) {
        code = module.hashbang + '\n' + code;
        mode = 0o755;
      }

      const outFile = await this.bundle.rewrite(module, to);

      await fs.writeFile(outFile, code, { mode });
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
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.strict = false;
    this.esm = false;
    this.meta = false;
    this.code = '';
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
    return this;
  }

  isBuiltin() {
    return this.pkg.isBuiltin();
  }

  makeError(location) {
    assert(typeof location === 'string');

    if (this.bundle.multi) {
      const err = new Error(`Cannot find module: '${location}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    return `__${this.bundle.env}_error__(${string(location)})`;
  }

  makeRequire(id, location) {
    assert(!this.bundle.multi);
    assert(typeof id === 'number');
    assert(typeof location === 'string');

    if (this.bundle.env === 'browser')
      return `__browser_require__(${id} /* ${string(location)} */, module)`;

    return `__node_require__(${id} /* ${string(location)} */)`;
  }

  makeRawRequire(path) {
    assert(typeof path === 'string');
    return `require(${string(path)})`;
  }

  makeStrict() {
    return '\'use strict\';\n\n';
  }

  makeMeta() {
    let out = '';

    out += 'var __meta_filename = process.platform === \'win32\'\n';
    out += '  ? \'/\' + __filename.replace(/\\\\/g, \'/\')\n';
    out += '  : __filename;\n';
    out += '\n';
    out += 'var __meta_url = \'file://\' + encodeURI(__meta_filename);\n';
    out += '\n';
    out += 'var __meta = { __proto__: null, url: __meta_url };\n';
    out += '\n';

    return out;
  }

  async makeJSON(path) {
    assert(!this.bundle.multi);
    assert(typeof path === 'string');

    const code = await fs.readFile(path, 'utf8');
    const json = JSON.parse(code);

    if (basename(path) === 'package.json')
      cleanPackage(json);

    return `module.exports = ${stringify(json, 2)};\n`;
  }

  async makeOpen(path) {
    assert(!this.bundle.multi);
    assert(typeof path === 'string');

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${string(name)}, `
         + `${buffer(raw)});`
         + '\n';
  }

  async compile() {
    if (this.ext === '.json')
      return this.makeJSON(this.path);

    if (this.ext === '.node')
      return this.makeOpen(this.path);

    let code = this.rawCode;

    if (!code)
      code = await fs.readFile(this.path);

    code = await this.bundle.compile(this, code);
    code = await this.transform(code);
    code = await this.bundle.transform(this, code);

    return code;
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

    code = stripBOM(code);

    [this.hashbang, code] = stripHashbang(code);

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

    if (this.bundle.multi && this.meta)
      out = this.makeMeta() + out;

    if (this.esm && !this.strict)
      out = this.makeStrict() + out;

    if (!this.bundle.multi) {
      out = out.replace(/\r\n/g, '\n');
      out = out.replace(/\r/g, '\n');
    }

    return out;
  }

  async require(location) {
    assert(typeof location === 'string');

    if (this.bundle.multi)
      return this.makeRawRequire(location);

    let path;

    try {
      path = await this.resolve(location);
    } catch (e) {
      if (this.bundle.ignoreMissing) {
        this.bundle.log('Warning: ignoring missing module: %s.', location);

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
          if (this.bundle.ignoreMissing) {
            this.bundle.log('Warning: ignoring missing builtin: %s.', location);
            return this.makeError(location);
          }

          throw new Error(`Could not resolve module: ${path}.`);
        }
      }
    }

    if (isAbsolute(path)) {
      const id = await this.bundle.getID(path);
      return this.makeRequire(id, location);
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

    this.bundle.log('Rebuilding binding: %s.', this.root);

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

    if (this.bundle.multi)
      return null;

    if (this.isBindings(node)) {
      const arg = node.arguments[0];

      if (this.bundle.env === 'browser')
        return [node, this.makeError(arg.value)];

      let path = await this.tryBinding(arg.value);

      if (!path) {
        if (this.bundle.ignoreMissing) {
          this.bundle.log('Warning: ignoring missing binding: %s.', arg.value);
          return [node, this.makeError(arg.value)];
        }
        throw new Error(`Cannot find binding: '${arg.value}'`);
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
      out += `var ${local} = ${name}[${string(imported)}];\n`;

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

  async ExportDefaultDeclaration(node, code, _id) {
    // export default foo;
    const {type, id, start, end} = node.declaration;

    let out = '';

    if (_id === 0)
      out += 'exports._esModule = true;\n';

    let exposed = false;

    switch (type) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        exposed = true;
        break;
    }

    if (exposed && id && id.name) {
      out += code.substring(start, end) + '\n';
      out += `exports['default'] = ${id.name};\n`;
    } else {
      out += 'exports[\'default\'] = '
           + code.substring(start, end)
           + ';\n';
    }

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
        out += `exports[${string(namespace)}] = ${name};\n`;

      for (const [value, key] of exports) {
        if (value === 'default') {
          out += `exports[${string(key)}] = ${name}._esModule\n`
               + `  ? ${name}['default']\n`
               + `  : ${name};\n`;
          continue;
        }
        out += `exports[${string(key)}] = ${name}[${string(value)}];\n`;
      }
    } else {
      for (const [key, value] of declarations) {
        out += `var ${key} = ${value};\n`;
        out += `exports.${key} = ${key};\n`;
      }

      for (const [value, key] of exports)
        out += `exports[${string(key)}] = ${value};\n`;
    }

    return [node, out];
  }

  async MetaProperty(node) {
    // import.meta;
    this.meta = true;
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

  wrap(code) {
    assert(typeof code === 'string');

    const wrapper = this.bundle.env === 'browser'
      ? BROWSER_WRAPPER
      : NODE_WRAPPER;

    return [
      wrapper[0],
      code.trim(),
      wrapper[1]
    ].join('\n');
  }
}

/*
 * Resolution
 */

async function findRoot(path) {
  assert(typeof path === 'string');

  path = resolve(path);

  if (await isFile(path))
    path = dirname(path);

  let dir = path;

  for (;;) {
    const loc = join(dir, 'package.json');

    if (await isFile(loc))
      return dir;

    const next = dirname(dir);

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

function string(str) {
  assert(typeof str === 'string');
  str = JSON.stringify(str).slice(1, -1);
  str = str.replace(/\\"/g, '"');
  str = str.replace(/'/g, '\\\'');
  return `'${str}'`;
}

function buffer(raw) {
  assert(Buffer.isBuffer(raw));

  const str = raw.toString('base64');

  let out = '\'\\\n';

  for (let i = 0; i < str.length; i += 64) {
    out += str.substring(i, i + 64);
    out += '\\';
    out += '\n';
  }

  out += '\'';

  return out;
}

function stringify(value, indent) {
  if (indent != null) {
    assert((indent >>> 0) === indent);
    return JSON.stringify(value, null, indent);
  }

  return JSON.stringify(value);
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

const NPM_KEYS = new Set([
  '_from',
  '_id',
  '_inBundle',
  '_integrity',
  '_location',
  '_phantomChildren',
  '_requested',
  '_requiredBy',
  '_resolved',
  '_shasum',
  '_spec',
  '_where'
]);

function cleanPackage(json) {
  if (!json || typeof json !== 'object')
    return false;

  let changed = false;

  // Get rid of all the NPM crap.
  for (const key of Object.keys(json)) {
    if (NPM_KEYS.has(key)) {
      delete json[key];
      changed = true;
    }
  }

  return changed;
}

/*
 * Parsing
 */

function stripBOM(code) {
  assert(typeof code === 'string');

  // UTF-16 BOM (also slices UTF-8 BOM).
  if (code.charCodeAt(0) === 0xfeff)
    code = code.substring(1);

  return code;
}

function stripHashbang(code) {
  assert(typeof code === 'string');

  if (code.length < 2
      || code.charCodeAt(0) !== 0x23
      || code.charCodeAt(1) !== 0x21) {
    return ['', code];
  }

  let i = 2;
  let j = 1;

  for (; i < code.length; i++) {
    const ch = code.charCodeAt(i);

    // LF
    if (ch === 0x0a)
      break;

    // CR
    if (ch === 0x0d) {
      // CRLF
      if (i + 1 < code.length) {
        if (code.charCodeAt(i + 1) === 0x0a)
          j = 2;
      }

      break;
    }
  }

  if (i === code.length)
    return [code, ''];

  return [code.substring(0, i), code.substring(i + j)];
}

async function isHashbang(file) {
  assert(typeof file === 'string');

  const fd = await fs.open(file);

  try {
    return await _isHashbang(fd);
  } finally {
    await fs.close(fd);
  }
}

async function _isHashbang(fd) {
  assert(fd != null);

  const slab = Buffer.allocUnsafe(1024);
  const stat = await fs.fstat(fd);
  const length = Math.min(stat.size, slab.length);
  const bytes = await fs.read(fd, slab, 0, length, 0);
  const data = slab.slice(0, bytes);

  return hasHashbang(data);
}

function hasHashbang(raw) {
  assert(Buffer.isBuffer(raw));

  if (raw.length < 3)
    return false;

  // UTF-8 and UTF-16 BOMs.
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    raw = raw.slice(3);
  else if (raw[0] === 0xfe && raw[1] === 0xff)
    raw = raw.slice(2);

  if (raw.length < 6
      || raw[0] !== 0x23
      || raw[1] !== 0x21) {
    return false;
  }

  // Limit at 1024 bytes so we don't end up
  // parsing a 100mb file of god-knows-what.
  let i = 2;

  for (; i < raw.length && i < 1024; i++) {
    const ch = raw[i];

    if (ch === 0x0a || ch === 0x0d)
      break;
  }

  const line = raw.toString('utf8', 2, i);

  // Should also catch other "nodes"
  // (e.g. ts-node and babel-node).
  return line.includes('node');
}

function parseCode(code, type, path) {
  assert(typeof code === 'string');
  assert(typeof type === 'string');
  assert(typeof path === 'string');
  assert(type === 'script' || type === 'module');

  try {
    return acorn.parse(code, {
      ecmaVersion: 10,
      sourceType: type,
      allowHashBang: false,
      allowReturnOutsideFunction: true
    });
  } catch (e) {
    e.message += ` (${path})`;
    throw e;
  }
}

/*
 * Text Formatting
 */

function wrapText(text, width) {
  assert(typeof text === 'string');
  assert((width >>> 0) === width);
  assert(width > 0);

  text = stripBOM(text);

  if (/<\/\w+>/.test(text)) {
    text = text.replace(/&copy;/g, '(c)');
    text = text.replace(/<!--[\s\S]+?-->/g, '');
    text = text.replace(/<[^<>]+>/g, '');
  }

  text = text.trim();
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\r/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/\t/g, ' ');
  text = text.replace(/^ +/gm, '');
  text = text.replace(/ +$/gm, '');

  const lines = text.split('\n');

  let isLong = false;

  for (const line of lines) {
    if (line.length > width) {
      isLong = true;
      break;
    }
  }

  if (!isLong)
    return text;

  const chunks = [];
  const chunk = [];

  for (const line of lines) {
    if (line === '') {
      chunks.push(chunk.join(' '));
      chunk.length = 0;
    } else {
      chunk.push(line);
    }
  }

  if (chunk.length > 0)
    chunks.push(chunk.join(' '));

  let out = '';

  for (const chunk of chunks) {
    if (chunk.length <= width) {
      out += chunk + '\n\n';
      continue;
    }

    const parts = chunk.split(' ');
    const line = [];

    let len = 0;

    for (const part of parts) {
      if (len + part.length > width) {
        out += line.join(' ') + '\n';
        line.length = 0;
        len = 0;
      }

      line.push(part);
      len += part.length + 1;
    }

    if (line.length > 0)
      out += line.join(' ') + '\n';

    out += '\n';
  }

  return out.trim();
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
