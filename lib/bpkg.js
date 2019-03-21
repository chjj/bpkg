/*!
 * bpkg.js - bundler for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

/* eslint new-cap: "off" */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const util = require('util');
const acorn = require('../vendor/acorn');
const builtins = require('./builtins');
const ESM = require('./esm');
const gyp = require('./gyp');
const Linker = require('./linker');
const OutputFile = require('./output');
const plugins = require('./plugins');
const Resolver = require('./resolver');
const template = require('./template');
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
} = path;

/*
 * Constants
 */

const NODE_WRAPPER = [
  'function(exports, module, __filename, __dirname, __meta) {',
  '}'
];

const BROWSER_WRAPPER = [
  'function(exports, require, module, __filename, __dirname, __meta) {',
  '}'
];

/**
 * Bundle
 */

class Bundle {
  constructor(options) {
    this.Resolver = Resolver;
    this.stream = process.stderr;
    this.env = 'node';
    this.extensions = ['.js', '.mjs', '.cjs'];
    this.external = new Set();
    this.localOnly = false;
    this.browserField = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.ignoreBindings = false;
    this.excludeSource = false;
    this.noHeader = false;
    this.noLicense = false;
    this.time = new Date();
    this.multi = false;
    this.esm = null;
    this.loose = false;
    this.standalone = false;
    this.name = null;
    this.plugins = [];
    this.environment = Object.create(null);
    this.globals = Object.create(null);
    this.requires = [];
    this.verbose = false;

    this.tarball = null;
    this.version = '0.0.0';
    this.root = process.cwd();
    this.resolve = this.resolver(this.root);
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
    this.hasMicrotask = false;
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

    if (typeof options.env === 'string')
      this.env = options.env;

    if (Array.isArray(options.extensions))
      this.addExtension(options.extensions);

    if (options.external != null)
      this.external = new Set([...options.external]);

    if (typeof options.localOnly === 'boolean')
      this.localOnly = options.localOnly;

    if (typeof options.browserField === 'boolean')
      this.browserField = options.browserField;

    if (typeof options.ignoreMissing === 'boolean')
      this.ignoreMissing = options.ignoreMissing;

    if (typeof options.collectBindings === 'boolean')
      this.collectBindings = options.collectBindings;

    if (typeof options.ignoreBindings === 'boolean')
      this.ignoreBindings = options.ignoreBindings;

    if (typeof options.excludeSource === 'boolean')
      this.excludeSource = options.excludeSource;

    if (typeof options.noHeader === 'boolean')
      this.noHeader = options.noHeader;

    if (typeof options.noLicense === 'boolean')
      this.noLicense = options.noLicense;

    if (options.time instanceof Date)
      this.time = options.time;

    if (typeof options.esm === 'boolean')
      this.esm = options.esm;

    if (typeof options.loose === 'boolean')
      this.loose = options.loose;

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

    const redirect = this.redirect.bind(this);
    const { extensions,
            external,
            localOnly } = this;

    let field = this.env;

    if (this.multi)
      field = null;

    if (this.browserField)
      field = 'browser';

    return Resolver.create({
      root: path,
      extensions,
      external,
      localOnly,
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

      if (!this.pkg) {
        this.pkg = pkg;

        // Expose some properties for plugins.
        if (!this.name)
          this.name = pkg.name;

        this.version = pkg.version;
        this.root = pkg.root;
        this.resolve = pkg.resolve;
        this.require = pkg.resolve.require;
      }

      if (pkg.engine > this.engine)
        this.engine = pkg.engine;

      this.pkgMap.set(root, pkg);
      this.pkgs.push(pkg);
    }

    return this.pkgMap.get(root);
  }

  async getModule(path) {
    assert(typeof path === 'string');

    if (!this.moduleMap.has(path)) {
      const module = new Module(this, path);

      await module.init();

      this.log('Loaded module: %s%s (%d).',
               module.pkg.name,
               module.location,
               module.id);

      if (!this.module)
        this.module = module;

      if (this.esm == null)
        this.esm = this.multi || module.sourceType() === 'module';

      this.moduleMap.set(path, module);
      this.modules.push(module);

      await module.open();
    }

    return this.moduleMap.get(path);
  }

  createModule(path) {
    return new Module(this, path);
  }

  async getID(path) {
    return (await this.getModule(path)).id;
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

    for (const plugin of this.running) {
      if (typeof plugin.rewrite !== 'function')
        continue;

      path = await plugin.rewrite(module, path);

      if (typeof path !== 'string')
        throw new TypeError('plugin.rewrite() must return a string!');
    }

    path = await module.esm.rewrite(path);

    return path;
  }

  async compile(module, code) {
    assert(module instanceof Module);
    assert(typeof code === 'string');

    for (const plugin of this.running) {
      if (typeof plugin.compile !== 'function')
        continue;

      code = await plugin.compile(module, code);

      if (typeof code !== 'string')
        throw new TypeError('plugin.compile() must return a string!');
    }

    return code;
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

  async bundle(input, output) {
    assert(typeof input === 'string');
    assert(output == null || typeof output === 'string');

    // Initialize plugins.
    await this.load();

    input = resolve(input);

    // Load the root package.
    // Try to find a package.json.
    // Will fail with a sentinel.
    const root = await findRoot(input);
    const pkg = await this.getPackage(root);

    // Get the correct file extension.
    input = await pkg.resolve(input);

    this.log('Bundling root package "%s" from %s.',
             pkg.name, input);

    const dest = new OutputFile(output, pkg.name, pkg.version);

    let out;

    await this.open();
    await dest.open();

    try {
      out = await this._bundle(input, dest.file);
    } finally {
      await dest.close();
    }

    await this.close();

    this.log('Build complete.');

    if (output)
      this.log('Output at: %s.', output);

    return out;
  }

  async _bundle(input, output) {
    assert(typeof input === 'string');
    assert(output == null || typeof output === 'string');

    const module = await this.getModule(input);
    const modules = [];

    let out = '';
    let header = [];
    let timers = null;
    let microtask = null;
    let process = null;
    let buffer = null;
    let console = null;

    const environment = [];
    const globals = [];
    const requires = [];

    if (this.env === 'browser') {
      if (this.hasTimers)
        timers = await this.getID(builtins.timers);

      if (this.hasMicrotask)
        microtask = await this.getID(builtins._microtask);

      if (this.hasProcess)
        process = await this.getID(builtins.process);

      if (this.hasBuffer)
        buffer = await this.getID(builtins.buffer);

      if (this.hasConsole)
        console = true;
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
        && !this.hasMeta
        && !this.esm) {
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
          esm: this.esm,
          prefix: this.esm
            ? 'var __browser_require__ = '
            : ';',
          timers,
          microtask,
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
          standalone: this.standalone && !this.esm,
          name: string(this.name),
          modules: modules.join(',\n'),
          exports: module.esm.makeExports()
        });
      } else {
        out = await template('node.js', {
          hashbang: module.hashbang,
          header,
          esm: this.esm,
          url: 'import.meta.url',
          meta: this.hasMeta && !this.esm,
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
          bindings: this.hasBindings,
          exports: module.esm.makeExports()
        });
      }
    }

    out = out.trim() + '\n';
    out = await this.final(this.module, out);

    if (this.collectBindings) {
      if (!output)
        throw new Error('No output directory specified.');

      const name = module.hashbang
        ? this.name
        : 'index.js';

      const dir = this.bindings.size > 0
        ? resolve(output, 'bindings')
        : output;

      await fs.mkdirp(dir);

      for (const binding of this.bindings) {
        const path = resolve(output, 'bindings', basename(binding));

        await fs.copyFile(binding, path);
      }

      await fs.writeFile(resolve(output, name), out, {
        mode: module.hashbang ? 0o755 : 0o644
      });

      return null;
    }

    if (output) {
      await fs.writeFile(output, out, {
        mode: module.hashbang ? 0o755 : 0o644
      });

      return null;
    }

    return out;
  }

  async release(input, output) {
    assert(typeof input === 'string');
    assert(output == null || typeof output === 'string');

    this.multi = true;

    // Initialize plugins.
    await this.load();

    input = resolve(input);

    // Load the root package.
    const pkg = await this.getPackage(input);

    if (!pkg.json) {
      const err = new Error(`Cannot find module: '${this.input}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    this.log('Building root package "%s" from %s.',
             pkg.name, input);

    const dest = new OutputFile(output, pkg.name, pkg.version);

    if (!dest.file)
      throw new Error('No output directory specified.');

    await this.open();
    await dest.open();

    try {
      await this._release(dest.file);
    } finally {
      await dest.close();
    }

    await this.close();

    this.log('Build complete.');
    this.log('Output at: %s.', output);
  }

  async _release(output) {
    assert(typeof output === 'string');

    // First path: multi. Traverse package
    // and its dependents recursively,
    // copying all package files along the
    // way.
    await this.pkg.multify(output);
    await this.writeBuild(output);
    await this.writeInstall(output);
  }

  async writeBuild(output) {
    const file = resolve(output, 'build');
    const code = await this.createBuild(output);

    return fs.writeFile(file, code, {
      mode: 0o755
    });
  }

  async createBuild(output) {
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
      const dir = relative(output, path);

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

  async writeInstall(output) {
    const file = resolve(output, 'install');
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

  async transpile(files, output) {
    if (typeof files === 'string')
      files = [files];

    assert(Array.isArray(files));
    assert(output == null || typeof output === 'string');

    this.multi = true;

    // Initialize plugins.
    await this.load();

    const dest = new OutputFile(output);

    if (!dest.file)
      throw new Error('No output directory specified.');

    await this.open();
    await dest.open();

    try {
      await this._transpile(files, dest.file);
    } finally {
      await dest.close();
    }

    await this.close();

    this.log('Build complete.');
    this.log('Output at: %s.', output);
  }

  async _transpile(files, output) {
    assert(Array.isArray(files));
    assert(typeof output === 'string');

    const options = {
      dirs: false,
      follow: false,
      throws: true,
      filter: (path, stat) => {
        const name = basename(path);
        return name !== '.git' && name !== 'node_modules';
      }
    };

    let dir = await isDirectory(output);

    if (!dir) {
      if (files.length === 1)
        dir = await isDirectory(files[0]);
      else
        dir = files.length > 1;
    }

    await fs.traverse(files, options, async (from, stat, depth) => {
      let to = output;

      if (dir) {
        const name = resolve(from)
                    .split(path.sep)
                    .slice(-(depth || 1))
                    .join(path.sep);

        to = join(output, name);
      }

      const toDir = dirname(to);

      if (!await isDirectory(toDir))
        await fs.mkdirp(toDir);

      if (stat.isSymbolicLink()) {
        await fs.symlink(await fs.readlink(from), to);
        return;
      }

      if (!stat.isFile())
        return;

      await this.transpileFile(from, to);
    });
  }

  async transpileFile(from, to) {
    assert(typeof from === 'string');
    assert(typeof to === 'string');

    let isCode = this.hasExtension(from);

    if (extname(from) === '')
      isCode = await isHashbang(from);

    if (!isCode) {
      await fs.copyFile(from, to);
      return;
    }

    const module = new Module(this, from);

    await module.init();
    await module.open();

    let code = await this.final(module, module.code);
    let mode = 0o644;

    if (module.hashbang) {
      code = module.hashbang + '\n' + code;
      mode = 0o755;
    }

    const outFile = await this.rewrite(module, to);

    await fs.writeFile(outFile, code, { mode });
  }

  /*
   * API
   */

  static async bundle(input, output, options) {
    return new this(options).bundle(input, output);
  }

  static async release(input, output, options) {
    return new this(options).release(input, output);
  }

  static async transpile(files, output, options) {
    return new this(options).transpile(files, output);
  }

  static async build(options) {
    assert(options && typeof options === 'object');

    const {input, output, files} = options;

    if (options.release)
      return this.release(input, output, options);

    if (options.transpile)
      return this.transpile(files, output, options);

    return this.bundle(input, output, options);
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
    this.filename = resolve(root, 'package.json');
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

  log(...args) {
    this.bundle.log(...args);
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

    this.log('Copying package: %s@%s -> %s.',
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
          this.log('Warning: ignoring missing module: %s.', path);
          continue;
        }

        const err = new Error(`Cannot find module: '${dep.name}'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      let next = resolve(root, 'node_modules', pkg.name);

      if (await isDirectory(next)) {
        const file = resolve(next, 'package.json');
        const json = await fs.readJSON(file);

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
      await fs.mkdirp(dest);

    await this.traverse(async (file, stat) => {
      const name = basename(file);
      const ext = extname(file);
      const from = resolve(this.root, file);
      const to = resolve(dest, file);
      const fromDir = dirname(from);
      const toDir = dirname(to);

      if (stat.isSymbolicLink()) {
        if (!await isDirectory(toDir))
          await fs.mkdirp(toDir);

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

          this.log('Building binding: %s.', fromDir);

          try {
            await gyp.build(fromDir);
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
              await fs.mkdirp(toDir);

            await fs.copyFile(from, to);
          });
        }
      }

      if (!await isDirectory(toDir))
        await fs.mkdirp(toDir);

      if (name === 'package.json') {
        const json = await fs.readJSON(from);

        // Get rid of all the npm crap.
        if (cleanPackage(json)) {
          const out = stringify(json, 2);
          await fs.writeFile(to, out + '\n');
          return;
        }
      }

      await this.bundle.transpileFile(from, to);
    });
  }
}

/**
 * Module
 */

class Module {
  constructor(bundle, filename) {
    assert(bundle instanceof Bundle);
    assert(typeof filename === 'string');

    this.bundle = bundle;
    this.id = bundle.moduleID++;
    this.filename = filename;
    this.dirname = dirname(filename);
    this.name = basename(filename);
    this.ext = extname(filename);
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.code = '';
    this.resolve = bundle.resolver(filename);
    this.esm = null;
    this.linker = null;
  }

  log(...args) {
    this.bundle.log(...args);
  }

  warning(log, ...args) {
    this.log(`Warning (%s): ${log}`,
      relative(process.cwd(), this.filename),
      ...args);
  }

  get location() {
    return '/' + unix(relative(this.root, this.filename));
  }

  get path() {
    return this.filename;
  }

  async init() {
    this.root = await findRoot(this.dirname);
    this.pkg = await this.bundle.getPackage(this.root);
    this.esm = new ESM(this);
    this.linker = new Linker(this);
    return this;
  }

  async open(link) {
    this.code = await this.compile(link);
    return this;
  }

  sourceType() {
    if (this.filename.endsWith('.mjs'))
      return 'module';

    if (this.filename.endsWith('.cjs'))
      return 'script';

    if (this.pkg.json && this.pkg.json.type === 'module')
      return 'module';

    return 'script';
  }

  parse(code) {
    assert(typeof code === 'string');

    let type = this.sourceType();
    let root;

    try {
      root = parseCode(code, type, this.filename);
    } catch (e) {
      if (type === 'module')
        throw e;

      // Try again as a module.
      type = 'module';
      root = parseCode(code, type, this.filename);
    }

    return [type, root];
  }

  async walk(root, filter) {
    const base = acorn.walk.base;
    const ancestors = [null];

    await (async function next(node, override) {
      const type = override || node.type;
      const isNew = node !== ancestors[ancestors.length - 1];

      // Note: acorn checks that `override`
      // is falsey during the full walk.
      if (isNew) {
        const result = await filter(node, ancestors);

        if (result === false)
          return;
      }

      const children = [];

      base[type](node, null, (child, state, override) => {
        children.push([child, override]);
      });

      if (isNew)
        ancestors.push(node);

      for (const [child, override] of children)
        await next(child, override);

      if (isNew)
        ancestors.pop();
    })(root, null, [null]);
  }

  async replace(code, ctx, visitors) {
    const [type, root] = this.parse(code);

    assert(visitors);

    let out = '';
    let offset = 0;

    await this.walk(root, async (node, ancestors) => {
      const visitor = visitors[node.type];

      if (!visitor)
        return true;

      const result = await visitor.call(ctx, node, code, ancestors);

      if (result == null)
        return true;

      assert(Array.isArray(result) && result.length === 2);
      assert(result[0] && typeof result[0] === 'object');
      assert(typeof result[1] === 'string');

      const [{start, end}, value] = result;

      out += code.substring(offset, start);
      out += value;

      offset = end;

      return false;
    });

    out += code.substring(offset);

    return [type, out];
  }

  async makeJSON(path) {
    assert(typeof path === 'string');
    assert(!this.bundle.multi);

    const json = await fs.readJSON(path);

    if (basename(path) === 'package.json')
      cleanPackage(json);

    return `module.exports = ${stringify(json, 2)};\n`;
  }

  async makeOpen(path) {
    assert(typeof path === 'string');
    assert(!this.bundle.multi);

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${string(name)}, `
         + `${base64(raw)});`
         + '\n';
  }

  async compile(link = true) {
    assert(typeof link === 'boolean');

    if (this.ext === '.json')
      return this.makeJSON(this.filename);

    if (this.ext === '.node')
      return this.makeOpen(this.filename);

    let code = await fs.readFile(this.filename, 'utf8');

    code = this.prepare(code);
    code = await this.bundle.compile(this, code);
    code = await this.esm.transform(code);

    if (link)
      code = await this.linker.transform(code);

    code = await this.bundle.transform(this, code);

    return code;
  }

  prepare(text) {
    assert(typeof text === 'string');

    let [hashbang, code] = stripHashbang(stripBOM(text));

    if (!this.bundle.multi) {
      code = code.replace(/\r\n/g, '\n');
      code = code.replace(/\r/g, '\n');
    }

    this.hashbang = hashbang;

    return code;
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

  try {
    return await fs.readJSON(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
}

function string(str) {
  assert(typeof str === 'string');
  str = JSON.stringify(str).slice(1, -1);
  str = str.replace(/\\"/g, '"');
  str = str.replace(/'/g, '\\\'');
  return `'${str}'`;
}

function base64(raw) {
  assert(Buffer.isBuffer(raw));

  const str = raw.toString('base64');

  if (str.length < 64)
    return `'${str}'`;

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

function stripBOM(text) {
  assert(typeof text === 'string');

  // UTF-16 BOM (also slices UTF-8 BOM).
  if (text.charCodeAt(0) === 0xfeff)
    text = text.substring(1);

  return text;
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

function parseCode(code, type, filename) {
  assert(typeof code === 'string');
  assert(typeof type === 'string');
  assert(typeof filename === 'string');
  assert(type === 'script' || type === 'module');

  try {
    return acorn.parse(code, {
      ecmaVersion: 10,
      sourceType: type,
      allowHashBang: false,
      allowReturnOutsideFunction: true
    });
  } catch (e) {
    e.message += ` (${filename})`;
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
 * API
 */

const bpkg = Bundle.build.bind(Bundle);

bpkg.bundle = Bundle.bundle.bind(Bundle);
bpkg.release = Bundle.release.bind(Bundle);
bpkg.transpile = Bundle.transpile.bind(Bundle);
bpkg.build = bpkg;
bpkg.Bundle = Bundle;
bpkg.Package = Package;
bpkg.Module = Module;
bpkg.Resolver = Resolver;

/*
 * Expose
 */

module.exports = bpkg;
