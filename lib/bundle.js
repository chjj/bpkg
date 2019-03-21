/*!
 * bundle.js - bundle object for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

/* eslint new-cap: "off" */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const util = require('util');
const builtins = require('./builtins');
const Module = require('./module');
const OutputFile = require('./output');
const Package = require('./package');
const plugins = require('./plugins');
const Resolver = require('./resolver');
const template = require('./template');
const utils = require('./utils');

const {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve
} = path;

const {
  cmpString,
  encodeVersion,
  indent,
  string,
  stringify
} = utils;

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
    const root = await Module.findRoot(input);
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
      const err = new Error(`Cannot find module: '${input}'`);
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

    return null;
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

    return null;
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

/*
 * Helpers
 */

async function isDirectory(file) {
  const stat = await fs.statTry(file);

  return stat != null && stat.isDirectory();
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

/*
 * Expose
 */

module.exports = Bundle;
