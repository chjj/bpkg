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
    this.renv = null;
    this.extensions = ['.js'];
    this.external = new Set();
    this.localOnly = false;
    this.ignoreMissing = false;
    this.collectBindings = false;
    this.ignoreBindings = false;
    this.excludeSource = false;
    this.noHeader = false;
    this.noLicense = false;
    this.time = new Date();
    this.target = null;
    this.loose = false;
    this.es2015 = false;
    this.name = null;
    this.plugins = [];
    this.environment = Object.create(null);
    this.globals = Object.create(null);
    this.requires = [];
    this.fields = [];
    this.conditions = [];
    this.entryType = null;
    this.wasmModules = false;
    this.detectModule = true;
    this.defaultType = null;
    this.stripTypes = false;
    this.transformTypes = false;
    this.verbose = false;

    this.version = '0.0.0';
    this.root = process.cwd();
    this.resolver = null;

    this.pkg = null;
    this.pkgID = 0;
    this.pkgMap = new Map();
    this.pkgs = [];
    this.engine = 0;

    this.module = null;
    this.moduleID = 0;
    this.moduleMap = new Map();
    this.modules = [];
    this.codeCache = new Map();

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
    this.hasWasm = false;
    this.hasWorkers = false;

    this.hasSetFlag = false;
    this.hasAssign = false;
    this.hasProxy = false;
    this.hasExpose = false;
    this.hasImportDefault = false;
    this.hasImportStar = false;
    this.hasExportStar = false;
    this.hasIsBuffer = false;

    this.init(options);

    this.resolver = this.createResolver(this.root, true);
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

    if (typeof options.renv === 'string')
      this.renv = options.renv;

    if (Array.isArray(options.extensions))
      this.addExtension(options.extensions);

    if (options.external != null)
      this.external = new Set([...options.external]);

    if (typeof options.localOnly === 'boolean')
      this.localOnly = options.localOnly;

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

    if (typeof options.target === 'string') {
      assert(options.target === 'cjs' ||
             options.target === 'umd' ||
             options.target === 'esm');

      this.target = options.target;
    }

    if (typeof options.loose === 'boolean')
      this.loose = options.loose;

    if (typeof options.es2015 === 'boolean')
      this.es2015 = options.es2015;

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

    if (Array.isArray(options.fields))
      this.fields = options.fields;

    if (Array.isArray(options.conditions))
      this.conditions = options.conditions;

    if (typeof options.entryType === 'string')
      this.entryType = options.entryType;

    if (typeof options.wasmModules === 'boolean')
      this.wasmModules = options.wasmModules;

    if (typeof options.detectModule === 'boolean')
      this.detectModule = options.detectModule;

    if (typeof options.defaultType === 'string')
      this.defaultType = options.defaultType;

    if (typeof options.stripTypes === 'boolean')
      this.stripTypes = options.stripTypes;

    if (typeof options.transformTypes === 'boolean')
      this.transformTypes = options.transformTypes;

    if (typeof options.verbose === 'boolean')
      this.verbose = options.verbose;

    if (this.target === 'esm')
      this.es2015 = true;

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

  createResolver(path, resolveDirs = false) {
    if (path && typeof path === 'object' && !Array.isArray(path))
      return new Resolver(path);

    assert(typeof path === 'string');
    assert(typeof resolveDirs === 'boolean');

    return new Resolver({
      root: path,
      extensions: this.extensions,
      external: this.external,
      localOnly: this.localOnly,
      npm: !this.resolver,
      env: this.renv || this.env,
      fields: this.fields,
      conditions: this.conditions,
      addons: !this.ignoreBindings,
      resolveDirs,
      wasmModules: this.wasmModules,
      detectModule: this.detectModule,
      defaultType: this.defaultType,
      stripTypes: this.stripTypes,
      transformTypes: this.transformTypes,
      redirect: this.redirect.bind(this),
      parent: this.resolver
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
        this.resolver = pkg.resolver;
      }

      if (pkg.engine > this.engine)
        this.engine = pkg.engine;

      this.pkgMap.set(root, pkg);
      this.pkgs.push(pkg);
    }

    return this.pkgMap.get(root);
  }

  async analyzeModule(path) {
    assert(typeof path === 'string');
    assert(!Resolver.isCore(path));

    if (!this.moduleMap.has(path)) {
      const module = new Module(this, path);

      await module.init();

      this.log('Loaded module: %s%s (%d).',
               module.pkg.name,
               module.subpath,
               module.id);

      if (!this.module)
        this.module = module;

      if (this.target == null) {
        this.target = module.isModule() ? 'esm' : 'cjs';
        if (this.target === 'esm')
          this.es2015 = true;
      }

      this.moduleMap.set(path, module);
      this.modules.push(module);

      await module.analyze();
    }

    return this.moduleMap.get(path);
  }

  async getModule(path) {
    const module = await this.analyzeModule(path);

    if (this.loose && module.isModule()) {
      if (module.opening && !module.opened)
        throw new Error(`Recursive import: ${module.relative}`);
    }

    if (!module.opening)
      await module.open();

    return module;
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
        if (plugins[func]) {
          func = require(plugins[func]);
        } else if (await Resolver.hasImport()) {
          const obj = await this.resolver.require(func, true);
          func = obj['default'] || obj;
        } else {
          func = await this.resolver.require(func, false);
        }
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

      if (typeof plugin !== 'function' &&
          typeof plugin !== 'object') {
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

  async redirect(specifier, from, isImport) {
    assert(typeof specifier === 'string');
    assert(typeof from === 'string');
    assert(typeof isImport === 'boolean');

    for (const plugin of this.running) {
      if (typeof plugin.redirect !== 'function')
        continue;

      specifier = await plugin.redirect(specifier, from, isImport);

      if (typeof specifier !== 'string')
        throw new TypeError('plugin.redirect() must return a string!');
    }

    return specifier;
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

    let isImport = null;

    if (this.entryType != null)
      isImport = this.entryType === 'module';

    const path = await this.resolver.resolveFile(input, isImport);

    // Load the root package.
    // Try to find a package.json.
    // Will fail with a sentinel.
    const root = await Resolver.mustFindRoot(path);
    const pkg = await this.getPackage(root);

    this.log('Bundling root package "%s" from %s.', pkg.name, path);

    const dest = new OutputFile(output, pkg.name, pkg.version);

    await this.open();
    await dest.open();

    let out;

    try {
      out = await this._bundle(path, dest.file);
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
    let isAsync = module.isAsync();
    let isAsyncReq = false;

    const environment = [];
    const globals = [];
    const requires = [];
    const conditions = this.conditions;

    for (const name of this.requires) {
      const path = await this.resolver.resolveRequire(name);
      const module = await this.getModule(path);

      if (module.isAsync()) {
        isAsync = true;
        isAsyncReq = true;
      }

      requires.push(module.id);
    }

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

    if (!this.noHeader && this.pkg.json) {
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

    if (module.userscript) {
      if (header != null)
        header = module.userscript + '\n\n' + header;
      else
        header = module.userscript;
    }

    if (this.env === 'node' &&
        this.modules.length === 1 &&
        this.bindings.size === 0 &&
        environment.length === 0 &&
        globals.length === 0 &&
        requires.length === 0 &&
        this.target !== 'esm' &&
        !module.isModule()) {
      if (module.hashbang)
        out += module.hashbang + '\n';

      if (header) {
        if (out)
          out += '\n';
        out += header + '\n';
      }

      if (out)
        out += '\n';

      out += module.code;
    } else {
      for (const module of this.modules) {
        const {id, pkg, subpath, code} = module;

        const item = [
          string(pkg.name),
          string(subpath),
          module.getFlag(),
          module.wrap(code)
        ];

        modules.push(`[/* ${id} */ ${item.join(', ')}]`);
      }

      if (module.needsLexerFix()) {
        const id = this.moduleID;
        const {pkg} = module;

        const item = [
          string(pkg.name),
          string('/cjs-module-lexer-fix.js'),
          '0',
          module.generateLexerFix()
        ];

        modules.push(`[/* ${id} */ ${item.join(', ')}]`);
      }

      if (this.env === 'browser') {
        out = await template('browser.js', {
          header,
          prefix: this.target === 'esm' ? 'var __browser_require__ = ' : ';',
          cjs: this.target === 'cjs',
          umd: this.target === 'umd',
          esm: this.target === 'esm',
          'async': isAsync,
          timers,
          microtask,
          process,
          buffer,
          console,
          meta: this.hasMeta,
          meta_cjs: this.hasMeta && this.target !== 'esm',
          meta_esm: this.hasMeta && this.target === 'esm',
          wasm: this.hasWasm,
          wasm_sync: this.hasWasm && !isAsync,
          wasm_async: this.hasWasm && isAsync,
          has_set_flag: this.hasSetFlag,
          has_assign: this.hasAssign,
          has_proxy: this.hasProxy,
          has_expose: this.hasExpose,
          import_default: this.hasImportDefault,
          import_star: this.hasImportStar,
          export_star: this.hasExportStar,
          isbuffer: this.hasIsBuffer,
          env: this.hasProcess && environment.length > 0
            ? indent(stringify(environment, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, 2), 1)
            : null,
          requires: requires.length > 0
            ? stringify(requires)
            : null,
          require_sync: requires.length > 0 && !isAsyncReq,
          require_async: requires.length > 0 && isAsyncReq,
          conditions: process != null && conditions.length > 0
            ? JSON.stringify(['-C', conditions.join(',')])
            : null,
          require0: module.linker.makeRequire0(),
          name: string(this.name),
          modules: modules.join(',\n'),
          exports: module.esm.makeExports()
        });
      } else {
        out = await template('node.js', {
          hashbang: module.hashbang,
          header,
          esm: this.target === 'esm',
          'async': isAsync,
          meta: this.hasMeta,
          meta_cjs: this.hasMeta && this.target !== 'esm',
          meta_esm: this.hasMeta && this.target === 'esm',
          wasm_sync: this.hasWasm && !isAsync,
          wasm_async: this.hasWasm && isAsync,
          has_set_flag: this.hasSetFlag,
          has_assign: this.hasAssign,
          has_proxy: this.hasProxy,
          has_expose: this.hasExpose,
          import_default: this.hasImportDefault,
          import_star: this.hasImportStar,
          export_star: this.hasExportStar,
          env: environment.length > 0
            ? indent(stringify(environment, 2), 1)
            : null,
          globals: globals.length > 0
            ? indent(stringify(globals, 2), 1)
            : null,
          requires: requires.length > 0
            ? stringify(requires)
            : null,
          require_sync: requires.length > 0 && !isAsyncReq,
          require_async: requires.length > 0 && isAsyncReq,
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
    const [code, cmake] = await this.createBuild(output);

    await fs.writeFile(file, code, {
      mode: 0o755
    });

    if (cmake) {
      await fs.mkdir(join(output, 'cmake-node'));

      for (const name of ['bin',
                          'cmake',
                          'include',
                          'lib',
                          'src',
                          'package.json']) {
        await fs.copy(join(cmake, name), join(output, 'cmake-node', name));
      }
    }
  }

  async createBuild(output) {
    const {name, version} = this.pkg;
    const {installs, engine} = this;

    let gyp = false;
    let cmake = false;
    let cmakePath = null;

    for (const [pkg] of installs) {
      if (pkg.install.includes('node-gyp'))
        gyp = true;
      else if (pkg.install.includes('cmake-node'))
        cmake = true;
    }

    if (cmake) {
      try {
        cmakePath = await this.resolver.directory('cmake-node');
      } catch (e) {
        cmake = false;
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

    const code = await template('build.js', {
      name,
      version,
      time: this.time.toISOString(),
      modules: stringify(modules, 2),
      links: stringify(links, 2),
      engine: engine || null,
      encoded: string(encoded),
      gyp,
      cmake
    });

    return [code, cmakePath];
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

  /*
   * API
   */

  static async bundle(input, output, options) {
    return new this(options).bundle(input, output);
  }

  static async release(input, output, options) {
    return new this(options).release(input, output);
  }

  static async build(options) {
    assert(options && typeof options === 'object');

    const {input, output} = options;

    if (options.release)
      return this.release(input, output, options);

    return this.bundle(input, output, options);
  }
}

/*
 * Expose
 */

module.exports = Bundle;
