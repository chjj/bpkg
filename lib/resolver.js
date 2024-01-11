/*!
 * resolver.js - module resolver for javascript
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Parts of this software are based on nodejs/node:
 *   Copyright Node.js contributors. All rights reserved.
 *   https://github.com/nodejs/node
 *
 * Resources:
 *   https://nodejs.org/api/modules.html
 *   https://nodejs.org/api/modules.html#modules_all_together
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const url = require('url');
const utils = require('./utils');
const {URL} = url;

const {
  stripBOM,
  stripHashbang,
  unix
} = utils;

const {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} = path;

let punycode = null;

/*
 * Constants
 */

const EMPTY = resolve(__dirname, 'builtins', 'empty.js');

const CORE_MODULES = new Set([
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'test', // Only works with `node:` prefix.
  'test/reporters', // Only works with `node:` prefix.
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib'
]);

const NODE_ONLY = new Set([
  'test',
  'test/reporters'
]);

const DEFAULT_EXTENSIONS = [
  '.js',
  '.json',
  '.node'
];

const WINDOWS = process.platform === 'win32';
const ROOT = WINDOWS ? parse(__dirname).root : '/';

const PREFIX = WINDOWS
  ? resolve(process.execPath, '..')
  : resolve(process.execPath, '..', '..');

const GLOBAL_PATHS = (() => {
  const paths = [];

  // NODE_PATH environment variable first.
  const {NODE_PATH} = process.env;

  if (NODE_PATH) {
    for (const path of NODE_PATH.split(delimiter)) {
      if (path !== '')
        paths.push(path);
    }
  }

  // Home dot directories next.
  const HOME = WINDOWS
    ? process.env.USERPROFILE
    : process.env.HOME;

  if (HOME) {
    paths.push(
      resolve(HOME, '.node_modules'),
      resolve(HOME, '.node_libraries')
    );
  }

  // Finally, the global system directory.
  paths.push(resolve(PREFIX, 'lib', 'node'));

  return paths;
})();

const NPM_PATHS = (() => {
  const paths = [...GLOBAL_PATHS];

  if (WINDOWS) {
    const {APPDATA} = process.env;
    if (APPDATA)
      paths.push(resolve(APPDATA, 'npm', 'node_modules'));
  } else {
    paths.push(join(PREFIX, 'lib', 'node_modules'));
  }

  return paths;
})();

const NM_CHARS = [115, 101, 108, 117, 100, 111, 109, 95, 101, 100, 111, 110];
const NM_LEN = 12;

const CJS_SCOPE = [
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname'
];

// https://github.com/nodejs/node/blob/ed5cb37/src/node_contextify.cc#L1406
const MODULE_ERRORS = [
  'Cannot use import statement outside a module', // `import` statements
  'Unexpected token \'export\'',                  // `export` statements
  'Cannot use \'import.meta\' outside a module'   // `import.meta` references
];

/*
 * Import Function
 */

let importFunc = null;
let hasImport = false;

try {
  importFunc = new Function('name', 'return import(name);');
  assert(importFunc('./builtins/empty.js') instanceof Promise);
  hasImport = true;
} catch (e) {
  importFunc = () => {
    throw new Error('Import unsupported.');
  };
}

/**
 * Resolver
 * @see https://nodejs.org/api/modules.html#modules_all_together
 */

class Resolver {
  constructor(options) {
    this.root = ROOT;
    this.extensions = [...DEFAULT_EXTENSIONS];
    this.paths = [];
    this.external = new Set();
    this.localOnly = false;
    this.preserve = false;
    this.npm = false;
    this.env = 'node';
    this.fields = [];
    this.conditions = [];
    this.resolveDirs = false;
    this.wasmModules = false;
    this.detectModule = false;
    this.requireFunc = require;
    this.importFunc = importFunc;
    this.redirect = async (x, y, isImport) => x;
    this.cache = Object.create(null);
    this.pkgCache = Object.create(null);
    this.shimCache = Object.create(null);

    this.init(options);
  }

  _conditions(esm) {
    const imports = esm ? 'import' : 'require';
    return [this.env, imports, ...this.conditions];
  }

  init(options) {
    if (options == null)
      options = {};

    if (typeof options === 'string')
      options = { root: options };

    assert(typeof options === 'object');

    if (options.root != null) {
      assert(typeof options.root === 'string');
      this.root = options.root;
    }

    if (options.extensions != null) {
      assert(Array.isArray(options.extensions));

      this.extensions.length = 0;

      for (const ext of options.extensions) {
        assert(typeof ext === 'string');
        this.extensions.push(ext);
      }

      if (!this.extensions.includes('.json'))
        this.extensions.push('.json');

      if (!this.extensions.includes('.node'))
        this.extensions.push('.node');
    }

    if (options.paths != null) {
      assert(Array.isArray(options.paths));

      this.paths.length = 0;

      for (const ext of options.paths) {
        assert(typeof ext === 'string');
        this.paths.push(ext);
      }
    }

    if (options.external != null) {
      assert(options.external instanceof Set);
      this.external = options.external;
    }

    if (options.localOnly != null) {
      assert(typeof options.localOnly === 'boolean');
      this.localOnly = options.localOnly;
    }

    if (options.preserve != null) {
      assert(typeof options.preserve === 'boolean');
      this.preserve = options.preserve;
    }

    if (options.npm != null) {
      assert(typeof options.npm === 'boolean');
      this.npm = options.npm;
    }

    if (options.env != null) {
      assert(typeof options.env === 'string');
      this.env = options.env;
    }

    if (options.fields != null) {
      assert(Array.isArray(options.fields));
      this.fields = options.fields;
    }

    if (options.conditions != null) {
      assert(Array.isArray(options.conditions));
      this.conditions = options.conditions;
    }

    if (options.addons != null)
      assert(typeof options.addons === 'boolean');

    if (options.resolveDirs != null) {
      assert(typeof options.resolveDirs === 'boolean');
      this.resolveDirs = options.resolveDirs;
    }

    if (options.wasmModules != null) {
      assert(typeof options.wasmModules === 'boolean');
      this.wasmModules = options.wasmModules;
    }

    if (options.detectModule != null) {
      assert(typeof options.detectModule === 'boolean');
      this.detectModule = options.detectModule;
    }

    if (options.require != null) {
      assert(typeof options.require === 'function');
      this.requireFunc = options.require;
    }

    if (options.importer != null) {
      assert(typeof options.importer === 'function');
      this.importFunc = options.importer;
    }

    if (options.redirect != null) {
      assert(typeof options.redirect === 'function');
      this.redirect = options.redirect;
    }

    if (options.parent != null) {
      assert(options.parent instanceof Resolver);
      this.pkgCache = options.parent.pkgCache;
      this.shimCache = options.parent.shimCache;
    }

    {
      const items = new Set(this.fields);

      if (this.env === 'browser') {
        this.fields = !items.has('browser')
                    ? ['browser', ...items]
                    : [...items];
      } else {
        items.delete('browser');
        this.fields = [...items];
      }
    }

    // https://nodejs.org/docs/v21.5.0/api/packages.html#community-conditions-definitions
    // https://runtime-keys.proposal.wintercg.org/
    {
      const items = new Set(this.conditions);

      items.delete(this.env);
      items.delete('import');
      items.delete('require');
      items.delete('default');

      if (this.env === 'node') {
        if (options.addons === false)
          items.delete('node-addons');
        else
          items.add('node-addons');
      }

      this.conditions = [...items];
    }

    return this;
  }

  async require(specifier, isImport = false) {
    const path = await this.resolve(specifier, isImport);

    return isImport ? this.importFunc(path)
                    : this.requireFunc(path);
  }

  async directory(specifier) {
    assert(typeof specifier === 'string');

    if (specifier === '' ||
        specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('/') ||
        specifier.startsWith('./') ||
        specifier.startsWith('../') ||
        specifier.startsWith('file:') ||
        specifier.startsWith('data:') ||
        specifier.startsWith('http:') ||
        specifier.startsWith('https:') ||
        specifier.startsWith('node:') ||
        specifier.startsWith('#') ||
        specifier.includes('\\')) {
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);
    }

    if (specifier[0] === '@') {
      const slash = specifier.indexOf('/');

      if (slash < 0 || specifier.indexOf('/', slash + 1) >= 0)
        throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);
    } else if (specifier.includes('/')) {
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);
    }

    let root = this.root;

    if (hasOwnProperty(this.cache, root)) {
      root = this.cache[root];
    } else {
      root = resolve(root);

      if (await stat(root) === 0)
        root = dirname(root);

      this.cache[this.root] = root;
    }

    const key = `${specifier}\0${root}\0${2}`;

    if (hasOwnProperty(this.cache, key)) {
      if (this.cache[key] === null)
        throw new ModuleError('MODULE_NOT_FOUND', specifier);

      return this.cache[key];
    }

    let result = null;

    for (const path of this.nodeModulesPaths(root)) {
      const file = join(path, specifier, 'package.json');

      if (await stat(file) === 0) {
        result = dirname(file);
        break;
      }
    }

    if (!result) {
      this.cache[key] = null;
      throw new ModuleError('MODULE_NOT_FOUND', specifier);
    }

    if (!this.preserve)
      result = await realpath(result);

    result = resolve(result, '.');

    this.cache[key] = result;

    return result;
  }

  async format(resolved) {
    assert(typeof resolved === 'string');

    if (!isAbsolute(resolved)) {
      assert(this.isCore(resolved));
      return 'builtin';
    }

    return this.esmFileFormat(resolved);
  }

  async resolve(specifier, isImport = false) {
    return this.resolvePath(specifier, this.root, isImport);
  }

  // RESOLVE(X) from module at path Y
  // 1. If X is in cache,
  //    a. return cache value
  //    b. STOP
  // 2. If Y is a regular file,
  //    a. Y = dirname(Y)
  // 3. If X is an ESM specifier,
  //    a. let Z = ESM_RESOLVE(X, Y)
  // 4. Otherwise,
  //    a. let Z = REQUIRE(X, Y)
  // 5. If step 3 or 4 throws,
  //    a. enter null into cache
  //    b. STOP
  // 6. Otherwise,
  //    a. enter Z into cache
  //    b. STOP

  async resolvePath(x, y, isImport) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');
    assert(typeof isImport === 'boolean');

    const xx = x;
    const yy = y;

    // Hit the cache for start directory.
    if (hasOwnProperty(this.cache, yy)) {
      y = this.cache[yy];
    } else {
      // Ensure y is absolute.
      y = resolve(y);

      // Ensure y is a directory. Note:
      // module.createRequire _always_
      // seems to go one directory up.
      if (await stat(y) === 0)
        y = dirname(y);

      this.cache[yy] = y;
    }

    const xy = `${x}\0${y}\0${isImport | 0}`;

    // Hit the resolution cache next.
    if (hasOwnProperty(this.cache, xy)) {
      if (this.cache[xy] === null)
        throw new ModuleError('MODULE_NOT_FOUND', xx);

      return this.cache[xy];
    }

    // Possible redirection.
    x = await this.redirect(x, y, isImport);

    if (x === null) {
      this.cache[xy] = null;
      throw new ModuleError('MODULE_NOT_FOUND', xx);
    }

    if (typeof x !== 'string')
      throw new ModuleError('ERR_INVALID_RETURN_VALUE', typeof x);

    // Possible field alias.
    x = await this.aliasSpecifier(x, y, isImport);

    // Resolve path.
    let z;

    try {
      z = isImport ? await this.esmResolve(x, y)
                   : await this.requireX(x, y);
    } catch (e) {
      if (e instanceof ModuleError)
        this.cache[xy] = null;
      throw e;
    }

    // An actual path (not a core module).
    if (isAbsolute(z)) {
      // Normalize.
      z = resolve(z, '.');
      y = dirname(z);
    }

    // Possible field alias.
    z = await this.aliasFile(z, y);

    // Get realpath and normalize.
    if (isAbsolute(z)) {
      if (!this.preserve)
        z = await realpath(z);
      z = resolve(z, '.');
    }

    this.cache[xy] = z;

    return z;
  }

  // REQUIRE(X) from module at path Y
  // 1. If X is a core module,
  //    a. return the core module
  //    b. STOP
  // 2. If X begins with '/'
  //    a. set Y to be the file system root
  // 3. If X begins with './' or '/' or '../'
  //    a. LOAD_AS_FILE(Y + X)
  //    b. LOAD_AS_DIRECTORY(Y + X)
  //    c. THROW "not found"
  // 4. If X begins with '#'
  //    a. LOAD_PACKAGE_IMPORTS(X, dirname(Y))
  // 5. LOAD_PACKAGE_SELF(X, dirname(Y))
  // 6. LOAD_NODE_MODULES(X, dirname(Y))
  // 7. THROW "not found"

  async requireX(x, y) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');

    const xx = x;

    if (x.length === 0)
      throw new ModuleError('ERR_INVALID_ARG_VALUE', 'id', x);

    if (y.length === 0 || !isAbsolute(y))
      throw new ModuleError('ERR_INVALID_ARG_VALUE', 'root', y);

    x = normalizeSpecifier(x);

    if (this.isCore(x))
      return x;

    // Allow lookups like `C:\foobar` on windows.
    if (WINDOWS && isAbsolute(x) && x[0] !== '/') {
      y = x; // Gets set to root below.
      x = unix(x);
    }

    if (x[0] === '/')
      y = WINDOWS ? parse(y).root : '/';

    if (x === '.' || x === '..')
      x += '/';

    if (x[0] === '/' || x.startsWith('./') || x.startsWith('../')) {
      const yx = join(y, x);
      const a = await this.loadAsFile(yx);

      if (a)
        return a;

      const b = await this.loadAsDirectory(yx);

      if (b)
        return b;

      throw new ModuleError('MODULE_NOT_FOUND', xx);
    }

    if (x[0] === '#')
      return this.loadPackageImports(x, y);

    const s = await this.loadPackageSelf(x, y);

    if (s)
      return s;

    const z = await this.loadNodeModules(x, y);

    if (z)
      return z;

    throw new ModuleError('MODULE_NOT_FOUND', xx);
  }

  // LOAD_AS_FILE(X)
  // 1. If X is a file, load X as its file extension format. STOP
  // 2. If X.js is a file, load X.js as JS text. STOP
  // 3. If X.json is a file, parse X.json to a JS Object. STOP
  // 4. If X.node is a file, load X.node as binary addon. STOP

  async loadAsFile(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    if (await stat(x) === 0)
      return x;

    for (const ext of this.extensions) {
      const xe = `${x}${ext}`;

      if (await stat(xe) === 0)
        return xe;
    }

    return null;
  }

  // LOAD_INDEX(X)
  // 1. If X/index.js is a file, load X/index.js as JS text. STOP
  // 2. If X/index.json is a file, parse X/index.json to a JS object. STOP
  // 3. If X/index.node is a file, load X/index.node as binary addon. STOP

  async loadIndex(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    for (const ext of this.extensions) {
      const xi = join(x, `index${ext}`);

      if (await stat(xi) === 0)
        return xi;
    }

    return null;
  }

  // LOAD_AS_DIRECTORY(X)
  // 1. If X/package.json is a file,
  //    a. Parse X/package.json, and look for "main" field.
  //    b. If "main" is a falsy value, GOTO 2.
  //    c. let M = X + (json main field)
  //    d. LOAD_AS_FILE(M)
  //    e. LOAD_INDEX(M)
  //    f. LOAD_INDEX(X) DEPRECATED
  //    g. THROW "not found"
  // 2. LOAD_INDEX(X)

  async loadAsDirectory(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    const xp = join(x, 'package.json');

    if (await stat(xp) === 0) {
      const main = await this.readMain(xp);

      if (main) {
        const m = join(x, main);
        const d = await this.loadAsFile(m);

        if (d)
          return d;

        const e = await this.loadIndex(m);

        if (e)
          return e;

        // Deprecated.
        const f = await this.loadIndex(x);

        if (f)
          return f;

        throw new ModuleError('MODULE_NOT_FOUND', x);
      }
    }

    return this.loadIndex(x);
  }

  // LOAD_NODE_MODULES(X, START)
  // 1. let DIRS = NODE_MODULES_PATHS(START)
  // 2. for each DIR in DIRS:
  //    a. LOAD_PACKAGE_EXPORTS(X, DIR)
  //    b. LOAD_AS_FILE(DIR/X)
  //    c. LOAD_AS_DIRECTORY(DIR/X)

  async loadNodeModules(x, start) {
    assert(typeof x === 'string');
    assert(typeof start === 'string');

    const dirs = this.nodeModulesPaths(start);

    for (const dir of dirs) {
      const dx = join(dir, x);
      const a = await this.loadPackageExports(x, dir);

      if (a)
        return a;

      const b = await this.loadAsFile(dx);

      if (b)
        return b;

      const c = await this.loadAsDirectory(dx);

      if (c)
        return c;
    }

    return null;
  }

  // NODE_MODULES_PATHS(START)
  // 1. let PARTS = path split(START)
  // 2. let I = count of PARTS - 1
  // 3. let DIRS = []
  // 4. while I >= 0,
  //    a. if PARTS[I] = "node_modules" CONTINUE
  //    b. DIR = path join(PARTS[0 .. I] + "node_modules")
  //    c. DIRS = DIRS + DIR
  //    d. let I = I - 1
  // 5. return DIRS + GLOBAL_FOLDERS

  nodeModulesPaths(start) {
    assert(typeof start === 'string');
    assert(isAbsolute(start));

    const paths = [];

    let globalPaths = this.npm ? NPM_PATHS : GLOBAL_PATHS;

    if (this.paths.length > 0)
      globalPaths = this.paths.concat(globalPaths);

    let last = start.length;
    let p = 0;

    if (WINDOWS) {
      if (start.charCodeAt(start.length - 1) === 92 &&
          start.charCodeAt(start.length - 2) === 58) {
        return [start + 'node_modules'].concat(globalPaths);
      }

      for (let i = start.length - 1; i >= 0; i--) {
        const code = start.charCodeAt(i);

        if (code === 92 || code === 47 || code === 58) {
          if (p !== NM_LEN)
            paths.push(start.slice(0, last) + '\\node_modules');
          last = i;
          p = 0;
        } else if (p !== -1) {
          if (NM_CHARS[p] === code)
            p += 1;
          else
            p = -1;
        }
      }

      return paths.concat(globalPaths);
    }

    if (start === '/')
      return ['/node_modules'].concat(globalPaths);

    for (let i = start.length - 1; i >= 0; i--) {
      const code = start.charCodeAt(i);

      if (code === 47) {
        if (p !== NM_LEN)
          paths.push(start.slice(0, last) + '/node_modules');
        last = i;
        p = 0;
      } else if (p !== -1) {
        if (NM_CHARS[p] === code)
          p += 1;
        else
          p = -1;
      }
    }

    paths.push('/node_modules');

    return paths.concat(globalPaths);
  }

  // LOAD_PACKAGE_IMPORTS(X, DIR)
  // 1. Find the closest package scope SCOPE to DIR.
  // 2. If no scope was found, return.
  // 3. If the SCOPE/package.json "imports" is null or undefined, return.
  // 4. let MATCH = PACKAGE_IMPORTS_RESOLVE(X, pathToFileURL(SCOPE),
  //                                        ["node", "require"])
  // 5. RESOLVE_ESM_MATCH(MATCH).

  async loadPackageImports(x, dir) {
    const conditions = this._conditions(false);
    return this.packageImportsResolve(x, dir, conditions);
  }

  // LOAD_PACKAGE_EXPORTS(X, DIR)
  // 1. Try to interpret X as a combination of NAME and SUBPATH where the name
  //    may have a @scope/ prefix and the subpath begins with a slash (`/`).
  // 2. If X does not match this pattern or DIR/NAME/package.json is not a file,
  //    return.
  // 3. Parse DIR/NAME/package.json, and look for "exports" field.
  // 4. If "exports" is null or undefined, return.
  // 5. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(DIR/NAME),
  //                                        "." + SUBPATH,
  //                                        `package.json` "exports",
  //                                        ["node", "require"])
  // 6. RESOLVE_ESM_MATCH(MATCH)

  async loadPackageExports(x, dir) {
    let slash = x.indexOf('/');

    if (x[0] === '@') {
      if (slash < 0)
        return null;

      slash = x.indexOf('/', slash + 1);
    }

    let name = x;

    if (slash >= 0)
      name = x.substring(0, slash);

    if (name[0] === '.' ||
        name.includes('\\') ||
        name.includes('%')) {
      return null;
    }

    const subpath = '.' + x.substring(name.length);

    if (subpath[subpath.length - 1] === '/')
      return null;

    const scope = join(dir, name);
    const pkg = await this.readPackageJson(scope);

    if (pkg != null && pkg.exports != null) {
      const conditions = this._conditions(false);

      return this.packageExportsResolve(scope,
                                        subpath,
                                        pkg.exports,
                                        conditions);
    }

    return null;
  }

  // LOAD_PACKAGE_SELF(X, DIR)
  // 1. Find the closest package scope SCOPE to DIR.
  // 2. If no scope was found, return.
  // 3. If the SCOPE/package.json "exports" is null or undefined, return.
  // 4. If the SCOPE/package.json "name" is not the first segment of X, return.
  // 5. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(SCOPE),
  //                                        "." + X.slice("name".length),
  //                                        `package.json` "exports",
  //                                        ["node", "require"])
  // 6. RESOLVE_ESM_MATCH(MATCH)

  async loadPackageSelf(x, dir) {
    const scope = await this.lookupPackageScope(dir);

    if (scope == null)
      return null;

    const pkg = await this.readPackageJson(scope);

    if (pkg == null || pkg.exports == null)
      return null;

    if (typeof pkg.name !== 'string')
      return null;

    if (x === pkg.name || x.startsWith(pkg.name + '/')) {
      const conditions = this._conditions(false);
      const subpath = '.' + x.substring(pkg.name.length);

      return this.packageExportsResolve(scope,
                                        subpath,
                                        pkg.exports,
                                        conditions);
    }

    return null;
  }

  // READ_MAIN(X)
  // 1. Parse X as JSON.
  //    a. If contents of X is not valid JSON, STOP
  //    b. Otherwise, let J = contents of X
  // 2. Look for "main" field in J
  //    a. If "main" is present and a valid string, return

  async readMain(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    const j = await readJSON(x, this.pkgCache);

    if (!isObject(j))
      return null;

    if (!isString(j.main))
      return null;

    return j.main;
  }

  // ALIAS_SPECIFIER(X) from package.json at path Y
  // 1. If X begins with './' or '/' or '../'
  //    a. let YX = RESOLVE(Y, X)
  //    b. let SHIMS = GET_SHIMS(YX)
  //    c. If YX is present in SHIMS, return SHIMS[YX]
  //    d. Otherwise, return X
  // 2. let SHIMS = GET_SHIMS(Y)
  // 3. If X is present in SHIMS, return SHIMS[X]
  // 4. Otherwise, return X

  async aliasSpecifier(x, y, isImport) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');
    assert(typeof isImport === 'boolean');

    const xx = x;
    const yy = y;

    if (this.fields.length === 0)
      return xx;

    if (x.length === 0 || isUnsupportedURL(x) || !isAbsolute(y))
      return xx;

    if (isImport && isFileURL(x))
      x = resolve(fileURLToPath(x), '.');

    if (WINDOWS && isAbsolute(x) && x[0] !== '/') {
      y = parse(x).root;
      x = unix(x);
    }

    if (x === '.' || x === '..')
      x += '/';

    if (x[0] === '/' || x.startsWith('./') || x.startsWith('../')) {
      const yx = resolve(y, x);
      const shims = await this.getShims(yx);
      return shims[yx] || xx;
    }

    x = normalizeSpecifier(x);

    const shims = await this.getShims(yy);

    return shims[x] || xx;
  }

  // ALIAS_FILE(X, DIR)
  // 1. let SHIMS = GET_SHIMS(DIR)
  // 2. If X is not present in SHIMS, return X
  // 3. If SHIMS[X] is not an absolute path,
  //    a. THROW "invalid package shim"
  // 4. LOAD_AS_FILE(SHIMS[X])
  // 5. THROW "not found"

  async aliasFile(x, dir) {
    assert(typeof x === 'string');
    assert(typeof dir === 'string');
    assert(isAbsolute(dir));

    const shims = await this.getShims(dir);
    const shim = shims[x];

    if (shim == null)
      return x;

    if (!isAbsolute(shim))
      throw new ModuleError('ERR_INVALID_PACKAGE_SHIM', shim);

    const file = await this.loadAsFile(shim);

    if (!file)
      throw new ModuleError('MODULE_NOT_FOUND', shim);

    return file;
  }

  // GET_SHIMS(DIR)
  // 1. Let SHIMS be an empty object.
  // 2. Find the closest package scope SCOPE to DIR.
  // 3. Return SHIMS under the following conditions,
  //    a. No scope was found.
  //    b. SCOPE/package.json is not a file.
  //    c. SCOPE/package.json is not valid json.
  //    d. FIELD is not present in parsed json.
  // 4. Treat the parsed json of SCOPE/package.json as JSON.
  // 5. Let REPLACEMENTS be FIELD in JSON.
  // 6. Let MAIN be "main" in JSON.
  // 7. If REPLACEMENTS and MAIN are strings, then
  //    a. let KEY = SAFE_RESOLVE(SCOPE, MAIN)
  //    b. SHIMS[key] = SAFE_RESOLVE(SCOPE, REPLACEMENTS)
  //    c. Goto 10
  // 8. If REPLACEMENTS is not an object, return SHIMS.
  // 9. for each key K in REPLACEMENTS:
  //    a. let KEY = MAYBE_RESOLVE(SCOPE, K)
  //    b. let VAL = REPLACEMENTS[K]
  //    c. if VAL is false, set SHIMS[KEY] = empty file
  //    d. if VAL is a string, set SHIMS[KEY] = MAYBE_RESOLVE(SCOPE, VAL)
  // 10. for each key KEY in SHIMS and each extension EXT in EXTENSIONS:
  //     a. if KEY is not an absolute path, continue
  //     b. if SHIMS[KEY+EXT] is undefined, set SHIMS[KEY+EXT] = SHIMS[KEY]
  // 11. Return SHIMS
  //
  // See: https://github.com/browserify/browser-resolve/blob/v2.0.0/index.js#L28

  async getShims(dir) {
    assert(typeof dir === 'string');
    assert(isAbsolute(dir));

    const shims = Object.create(null);

    if (this.fields.length === 0)
      return shims;

    const scope = await findRoot(dir);

    if (scope == null)
      return shims;

    const file = join(scope, 'package.json');
    const cache = this.shimCache[file];

    if (cache)
      return cache;

    const json = await readJSON(file, this.pkgCache);

    if (!isObject(json))
      return shims;

    const main = json.main || 'index.js';

    for (const field of this.fields) {
      const replacements = json[field];

      if (isString(replacements) && isString(main)) {
        const key = safeResolve(scope, main, 'main');
        shims[key] = safeResolve(scope, replacements, field);
      } else if (isObject(replacements)) {
        for (const k of Object.keys(replacements)) {
          const key = maybeResolve(scope, k, field);
          const val = replacements[k];

          if (val === false)
            shims[key] = EMPTY;
          else if (isString(val))
            shims[key] = maybeResolve(scope, val, field);
        }
      }
    }

    for (const key of Object.keys(shims)) {
      const val = shims[key];

      if (!isAbsolute(key))
        continue;

      const kext = extname(key);

      if (this.extensions.includes(kext))
        continue;

      if (isAbsolute(val)) {
        const vext = extname(val);

        if (this.extensions.includes(vext)) {
          if (shims[key + vext] == null) {
            shims[key + vext] = shims[key];
            continue;
          }
        }
      }

      for (const ext of this.extensions) {
        if (shims[key + ext] == null)
          shims[key + ext] = shims[key];
      }
    }

    this.shimCache[file] = shims;

    return shims;
  }

  /*
   * ESM
   */

  // ESM_RESOLVE(specifier, parentURL)
  // 1. Let `resolved` be undefined.
  // 2. If `specifier` is a valid URL, then
  //    1. Set `resolved` to the result of parsing and reserializing
  //       `specifier` as a URL.
  // 3. Otherwise, if `specifier` starts with "/", "./", or "../", then
  //    1. Set `resolved` to the URL resolution of `specifier` relative to
  //       `parentURL`.
  // 4. Otherwise, if `specifier` starts with "#", then
  //    1. Set `resolved` to the result of
  //       PACKAGE_IMPORTS_RESOLVE(specifier,
  //       parentURL, defaultConditions).
  // 5. Otherwise,
  //    1. Note: `specifier` is now a bare specifier.
  //    2. Set `resolved` the result of
  //       PACKAGE_RESOLVE(specifier, parentURL).
  // 6. Let `format` be undefined.
  // 7. If `resolved` is a "file:" URL, then
  //    1. If `resolved` contains any percent encodings of "/" or "\" ("%2F"
  //       and "%5C" respectively), then
  //       1. Throw an "Invalid Module Specifier" error.
  //    2. If the file at `resolved` is a directory, then
  //       1. Throw an "Unsupported Directory Import" error.
  //    3. If the file at `resolved` does not exist, then
  //       1. Throw a "Module Not Found" error.
  //    4. Set `resolved` to the real path of `resolved`, maintaining the
  //       same URL querystring and fragment components.
  //    5. Set `format` to the result of ESM_FILE_FORMAT(resolved).
  // 8. Otherwise,
  //    1. Set `format` the module format of the content type associated with
  //       the URL `resolved`.
  // 9. Return `format` and `resolved` to the loading phase

  async esmResolve(specifier, parentDir) {
    assert(typeof specifier === 'string');
    assert(typeof parentDir === 'string');

    if (specifier.length === 0 || isUnsupportedURL(specifier))
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);

    if (!isAbsolute(parentDir))
      throw new ModuleError('ERR_INVALID_FILE_URL_PATH', parentDir);

    // Allow lookups like `C:\foobar` on windows.
    if (WINDOWS && isAbsolute(specifier) && specifier[0] !== '/')
      specifier = pathToFileURL(specifier).toString();

    // Load default conditions.
    const conditions = this._conditions(true);

    // 1
    let resolved = undefined;
    let isPath = false;

    // 2, 3, 4, 5
    if (isFileURL(specifier)) {
      try {
        resolved = resolve(fileURLToPath(specifier), '.');
        isPath = true;
      } catch (e) {
        throw new ModuleError('ERR_INVALID_FILE_URL_PATH', specifier);
      }
    } else if (specifier[0] === '/' ||
               specifier.startsWith('./') ||
               specifier.startsWith('../')) {
      resolved = resolve(parentDir, specifier);
      isPath = true;
    } else if (specifier[0] === '#') {
      resolved = await this.packageImportsResolve(specifier,
                                                  parentDir,
                                                  conditions);
    } else {
      resolved = await this.packageResolve(specifier,
                                           parentDir,
                                           conditions);
    }

    // Non-standard.
    if (this.resolveDirs && isPath && await stat(resolved) === 1)
      resolved = await this.directoryResolve(resolved, conditions);

    // 7
    if (isAbsolute(resolved)) {
      // 7.1
      if (/(?:%2F|%5C)/i.test(resolved))
        throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);

      // 7.2 & 7.3
      switch (await stat(resolved)) {
        case 0:
          break;
        case 1:
          throw new ModuleError('ERR_UNSUPPORTED_DIR_IMPORT', resolved);
        default:
          throw new ModuleError('MODULE_NOT_FOUND', specifier);
      }

      // 7.4 (realpath computed in resolvePath)
      // resolved = await realpath(resolved);
      // resolved = resolve(resolved, '.');
    }

    return resolved;
  }

  // PACKAGE_RESOLVE(packageSpecifier, parentURL)
  // 1. Let `packageName` be undefined.
  // 2. If `packageSpecifier` is an empty string, then
  //    1. Throw an "Invalid Module Specifier" error.
  // 3. If `packageSpecifier` is a Node.js builtin module name, then
  //    1. Return the string "node:" concatenated with `packageSpecifier`.
  // 4. If `packageSpecifier` does not start with "@", then
  //    1. Set `packageName` to the substring of `packageSpecifier` until the
  //       first "/" separator or the end of the string.
  // 5. Otherwise,
  //    1. If `packageSpecifier` does not contain a "/" separator, then
  //       1. Throw an "Invalid Module Specifier" error.
  //    2. Set `packageName` to the substring of `packageSpecifier`
  //       until the second "/" separator or the end of the string.
  // 6. If `packageName` starts with "." or contains "\" or "%", then
  //    1. Throw an "Invalid Module Specifier" error.
  // 7. Let `packageSubpath` be "." concatenated with the substring of
  //    `packageSpecifier` from the position at the length of `packageName`.
  // 8. If `packageSubpath` ends in "/", then
  //    1. Throw an "Invalid Module Specifier" error.
  // 9. Let `selfUrl` be the result of
  //    PACKAGE_SELF_RESOLVE(packageName, packageSubpath, parentURL).
  // 10. If `selfUrl` is not undefined, return `selfUrl`.
  // 11. While `parentURL` is not the file system root,
  //     1. Let `packageURL` be the URL resolution of "node_modules/"
  //        concatenated with `packageName`, relative to `parentURL`.
  //     2. Set `parentURL` to the parent folder URL of `parentURL`.
  //     3. If the folder at `packageURL` does not exist, then
  //        1. Continue the next loop iteration.
  //     4. Let `pjson` be the result of READ_PACKAGE_JSON(packageURL).
  //     5. If `pjson` is not null and `pjson.exports` is not null or
  //        undefined, then
  //        1. Return the result of PACKAGE_EXPORTS_RESOLVE(packageURL,
  //           packageSubpath, pjson.exports, defaultConditions).
  //     6. Otherwise, if `packageSubpath` is equal to ".", then
  //        1. If `pjson.main` is a string, then
  //           1. Return the URL resolution of `main` in `packageURL`.
  //     7. Otherwise,
  //        1. Return the URL resolution of `packageSubpath` in `packageURL`.
  // 12. Throw a "Module Not Found" error.

  async packageResolve(packageSpecifier, parentDir, conditions) {
    assert(typeof packageSpecifier === 'string');
    assert(typeof parentDir === 'string');
    assert(isAbsolute(parentDir));
    assert(isArray(conditions));

    // 1
    let packageName = undefined;

    // 2
    if (packageSpecifier.length === 0)
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', packageSpecifier);

    // 3
    const x = normalizeSpecifier(packageSpecifier);

    if (this.isCore(x))
      return x;

    // 4 & 5
    let slash = packageSpecifier.indexOf('/');

    if (packageSpecifier[0] === '@') {
      if (slash < 0)
        throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', packageSpecifier);

      slash = packageSpecifier.indexOf('/', slash + 1);
    }

    if (slash >= 0)
      packageName = packageSpecifier.substring(0, slash);
    else
      packageName = packageSpecifier;

    // 6
    if (packageName[0] === '.' ||
        packageName.includes('\\') ||
        packageName.includes('%')) {
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', packageSpecifier);
    }

    // 7
    const packageSubpath = '.' + packageSpecifier.substring(packageName.length);

    // 8
    if (packageSubpath[packageSubpath.length - 1] === '/')
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', packageSpecifier);

    // 9
    const selfDir = await this.packageSelfResolve(packageName,
                                                  packageSubpath,
                                                  parentDir,
                                                  conditions);

    // 10
    if (selfDir !== undefined)
      return selfDir;

    // 11
    for (;;) {
      // 11.1
      const packageDir = join(parentDir, 'node_modules', packageName);

      // 11.3
      if (await stat(packageDir) !== 1) {
        const next = dirname(parentDir);

        if (next === parentDir)
          break;

        // 11.2
        parentDir = next;

        continue;
      }

      // 11.4
      const pjson = await this.readPackageJson(packageDir);

      // 11.5
      if (pjson != null && pjson.exports != null) {
        return this.packageExportsResolve(packageDir,
                                          packageSubpath,
                                          pjson.exports,
                                          conditions);
      }

      // 11.6
      if (packageSubpath === '.')
        return this.resolveMain(packageDir, pjson);

      return resolve(packageDir, packageSubpath);
    }

    // 12
    throw new ModuleError('MODULE_NOT_FOUND', packageSpecifier);
  }

  // RESOLVE_MAIN(packageURL, pjson)
  // 1. If `pjson?.main` is a string, then
  //    1. Let `resolved` be the URL resolution of the
  //       concatenation of `packageURL` and `pjson.main`.
  //    2. If `resolved` is a file, return `resolved`.
  // 2. Throw a "Module Not Found" error.

  async resolveMain(packageDir, pjson) {
    assert(typeof packageDir === 'string');
    assert(isAbsolute(packageDir));

    if (pjson != null && isString(pjson.main)) {
      const resolved = join(packageDir, pjson.main);

      if (await stat(resolved) === 0)
        return resolve(resolved);
    }

    throw new ModuleError('MODULE_NOT_FOUND', packageDir);
  }

  // PACKAGE_SELF_RESOLVE(packageName, packageSubpath, parentURL)
  // 1. Let `packageURL` be the result of LOOKUP_PACKAGE_SCOPE(parentURL).
  // 2. If `packageURL` is null, then
  //    1. Return undefined.
  // 3. Let `pjson` be the result of READ_PACKAGE_JSON(packageURL).
  // 4. If `pjson` is null or if `pjson.exports` is null or
  //    undefined, then
  //    1. Return undefined.
  // 5. If `pjson.name` is equal to `packageName`, then
  //    1. Return the result of PACKAGE_EXPORTS_RESOLVE(packageURL,
  //       packageSubpath, pjson.exports, defaultConditions).
  // 6. Otherwise, return undefined.

  async packageSelfResolve(packageName, packageSubpath, parentDir, conditions) {
    assert(typeof packageName === 'string');
    assert(typeof packageSubpath === 'string');
    assert(typeof parentDir === 'string');
    assert(isAbsolute(parentDir));
    assert(isArray(conditions));

    // 1
    const packageDir = await this.lookupPackageScope(parentDir);

    // 2
    if (packageDir == null)
      return undefined;

    // 3
    const pjson = await this.readPackageJson(packageDir);

    if (pjson == null || pjson.exports == null)
      return undefined;

    if (pjson.name === packageName) {
      return this.packageExportsResolve(packageDir,
                                        packageSubpath,
                                        pjson.exports,
                                        conditions);
    }

    return undefined;
  }

  // PACKAGE_EXPORTS_RESOLVE(packageURL, subpath, exports, conditions)
  // 1. If `exports` is an Object with both a key starting with "." and a key
  //    not starting with ".", throw an "Invalid Package Configuration" error.
  // 2. If `subpath` is equal to ".", then
  //    1. Let `mainExport` be undefined.
  //    2. If `exports` is a String or Array, or an Object containing no keys
  //       starting with ".", then
  //       1. Set `mainExport` to `exports`.
  //    3. Otherwise if `exports` is an Object containing a "." property, then
  //       1. Set `mainExport` to `exports["."]`.
  //    4. If `mainExport` is not undefined, then
  //       1. Let `resolved` be the result of PACKAGE_TARGET_RESOLVE(
  //          packageURL, mainExport, null, false, conditions).
  //       2. If `resolved` is not null or undefined, return `resolved`.
  // 3. Otherwise, if `exports` is an Object and all keys of `exports` start
  //    with ".", then
  //    1. Assert: `subpath` begins with "./".
  //    2. Let `resolved` be the result of PACKAGE_IMPORTS_EXPORTS_RESOLVE(
  //       subpath, exports, packageURL, false, conditions).
  //    3. If resolved is not null or undefined, return resolved.
  // 4. Throw a "Package Path Not Exported" error.

  async packageExportsResolve(packageDir, subpath, exports, conditions) {
    assert(typeof packageDir === 'string');
    assert(isAbsolute(packageDir));
    assert(typeof subpath === 'string');
    assert(isArray(conditions));

    let hasDots = null;

    // 1
    if (isObject(exports)) {
      const keys = Object.getOwnPropertyNames(exports);

      let dots = 0;

      for (const key of keys) {
        const dot = Number(key.length > 0 && key[0] === '.');

        dots |= (dot ^ 0) << 0;
        dots |= (dot ^ 1) << 1;
      }

      if (dots === 3)
        throw new ModuleError('ERR_INVALID_PACKAGE_CONFIG', packageDir);

      hasDots = Boolean(dots & 1);
    }

    // 2
    if (subpath === '.') {
      // 2.1
      let mainExport = undefined;

      // 2.2 and 2.3
      if (hasDots === false || isString(exports) || isArray(exports))
        mainExport = exports;
      else if (hasDots === true)
        mainExport = exports['.'];

      // 2.4
      if (mainExport !== undefined) {
        // 2.4.1
        const resolved = await this.packageTargetResolve(packageDir,
                                                         mainExport,
                                                         null,
                                                         false,
                                                         conditions);

        // 2.4.2
        if (resolved != null)
          return resolved;
      }
    }

    // 3
    if (hasDots === true) {
      // 3.1
      assert(subpath.startsWith('./'));

      // 3.2
      const resolved = await this.packageImportsExportsResolve(subpath,
                                                               exports,
                                                               packageDir,
                                                               false,
                                                               conditions);

      // 3.3
      if (resolved != null)
        return resolved;
    }

    throw new ModuleError('ERR_PACKAGE_PATH_NOT_EXPORTED', subpath, packageDir);
  }

  // PACKAGE_IMPORTS_RESOLVE(specifier, parentURL, conditions)
  // 1. Assert: `specifier` begins with "#".
  // 2. If `specifier` is exactly equal to "#" or starts with "#/", then
  //    1. Throw an "Invalid Module Specifier" error.
  // 3. Let `packageURL` be the result of LOOKUP_PACKAGE_SCOPE(parentURL).
  // 4. If `packageURL` is not null, then
  //    1. Let `pjson` be the result of READ_PACKAGE_JSON(packageURL).
  //    2. If `pjson.imports` is a non-null Object, then
  //       1. Let `resolved` be the result of
  //          PACKAGE_IMPORTS_EXPORTS_RESOLVE(
  //          specifier, pjson.imports, packageURL, true, conditions).
  //       2. If `resolved` is not null or undefined, return `resolved`.
  // 5. Throw a "Package Import Not Defined" error.

  async packageImportsResolve(specifier, parentDir, conditions) {
    assert(typeof specifier === 'string');
    assert(typeof parentDir === 'string');
    assert(isAbsolute(parentDir));
    assert(isArray(conditions));

    // 1
    assert(specifier.length > 0);
    assert(specifier[0] === '#');

    // 2
    if (specifier === '#' || specifier.startsWith('#/'))
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);

    // 3
    const packageDir = await this.lookupPackageScope(parentDir);

    // 4
    if (packageDir != null) {
      // 4.1
      const pjson = await this.readPackageJson(packageDir);

      // 4.2
      if (pjson != null && isObject(pjson.imports)) {
        // 4.2.1
        const resolved = await this.packageImportsExportsResolve(specifier,
                                                                 pjson.imports,
                                                                 packageDir,
                                                                 true,
                                                                 conditions);

        // 4.2.2
        if (resolved != null)
          return resolved;
      }
    }

    throw new ModuleError('ERR_PACKAGE_IMPORT_NOT_DEFINED', specifier,
                                                            parentDir);
  }

  // PACKAGE_IMPORTS_EXPORTS_RESOLVE(matchKey, matchObj, packageURL,
  //                                 isImports, conditions)
  // 1. If `matchKey` is a key of `matchObj` and does not contain "*", then
  //    1. Let `target` be the value of `matchObj[matchKey]`.
  //    2. Return the result of PACKAGE_TARGET_RESOLVE(packageURL,
  //       target, null, isImports, conditions).
  // 2. Let `expansionKeys` be the list of keys of `matchObj` containing only a
  //    single "*", sorted by the sorting function PATTERN_KEY_COMPARE
  //    which orders in descending order of specificity.
  // 3. For each key `expansionKey` in `expansionKeys`, do
  //    1. Let `patternBase` be the substring of `expansionKey` up to but
  //       excluding the first "*" character.
  //    2. If `matchKey` starts with but is not equal to `patternBase`, then
  //       1. Let `patternTrailer` be the substring of `expansionKey` from the
  //          index after the first "*" character.
  //       2. If `patternTrailer` has zero length, or if `matchKey` ends with
  //          `patternTrailer` and the length of `matchKey` is greater than or
  //          equal to the length of `expansionKey`, then
  //          1. Let `target` be the value of `matchObj[expansionKey]`.
  //          2. Let `patternMatch` be the substring of `matchKey` starting at
  //             the index of the length of `patternBase` up to the length of
  //             `matchKey` minus the length of `patternTrailer`.
  //          3. Return the result of PACKAGE_TARGET_RESOLVE(packageURL,
  //             target, patternMatch, isImports, conditions).
  // 4. Return null.

  async packageImportsExportsResolve(matchKey,
                                     matchObj,
                                     packageDir,
                                     isImports,
                                     conditions) {
    assert(typeof matchKey === 'string');
    assert(isObject(matchObj));
    assert(typeof packageDir === 'string');
    assert(isAbsolute(packageDir));
    assert(typeof isImports === 'boolean');
    assert(isArray(conditions));

    // 1
    if (matchObj[matchKey] != null && !matchKey.includes('*')) {
      const target = matchObj[matchKey];
      return this.packageTargetResolve(packageDir,
                                       target,
                                       null,
                                       isImports,
                                       conditions);
    }

    // 2
    const keys = Object.getOwnPropertyNames(matchObj);
    const expansionKeys = [];

    for (const key of keys) {
      const i = key.indexOf('*');
      const j = key.lastIndexOf('*');

      if (i >= 0 && i === j)
        expansionKeys.push(key);
    }

    expansionKeys.sort(this.patternKeyCompare);

    // 3
    for (const expansionKey of expansionKeys) {
      // 3.1
      const i = expansionKey.indexOf('*');
      const patternBase = expansionKey.substring(0, i);

      // 3.2
      if (matchKey.startsWith(patternBase) && matchKey !== patternBase) {
        // 3.2.1
        const patternTrailer = expansionKey.substring(i + 1);

        // 3.2.2
        if (patternTrailer.length === 0 ||
            (matchKey.endsWith(patternTrailer) &&
             matchKey.length >= expansionKey.length)) {
          // 3.2.2.1
          const target = matchObj[expansionKey];

          // 3.2.2.2
          const patternMatch = matchKey.substring(
            patternBase.length,
            matchKey.length - patternTrailer.length
          );

          // 3.2.2.3
          return this.packageTargetResolve(packageDir,
                                           target,
                                           patternMatch,
                                           isImports,
                                           conditions);
        }
      }
    }

    // 4
    return null;
  }

  // PATTERN_KEY_COMPARE(keyA, keyB)
  // 1. Assert: `keyA` ends with "/" or contains only a single "*".
  // 2. Assert: `keyB` ends with "/" or contains only a single "*".
  // 3. Let `baseLengthA` be the index of "*" in `keyA` plus one, if `keyA`
  //    contains "*", or the length of `keyA` otherwise.
  // 4. Let `baseLengthB` be the index of "*" in `keyB` plus one, if `keyB`
  //    contains `"*"`, or the length of `keyB` otherwise.
  // 5. If `baseLengthA` is greater than `baseLengthB`, return -1.
  // 6. If `baseLengthB` is greater than `baseLengthA`, return 1.
  // 7. If `keyA` does not contain "*", return 1.
  // 8. If `keyB` does not contain "*", return -1.
  // 9. If the length of `keyA` is greater than the length of `keyB`, return -1.
  // 10. If the length of `keyB` is greater than the length of `keyA`, return 1.
  // 11. Return 0.

  patternKeyCompare(a, b) {
    assert(typeof a === 'string');
    assert(typeof b === 'string');

    const aIndex = a.indexOf('*');
    const bIndex = b.indexOf('*');

    const baseLenA = aIndex === -1 ? a.length : aIndex + 1;
    const baseLenB = bIndex === -1 ? b.length : bIndex + 1;

    if (baseLenA > baseLenB)
      return -1;

    if (baseLenB > baseLenA)
      return 1;

    if (aIndex === -1)
      return 1;

    if (bIndex === -1)
      return -1;

    if (a.length > b.length)
      return -1;

    if (b.length > a.length)
      return 1;

    return 0;
  }

  // PACKAGE_TARGET_RESOLVE(packageURL, target, patternMatch,
  //                        isImports, conditions)
  // 1. If `target` is a String, then
  //    1. If `target` does not start with "./", then
  //       1. If `isImports` is false, or if `target` starts with "../" or
  //          "/", or if `target` is a valid URL, then
  //          1. Throw an "Invalid Package Target" error.
  //       2. If `patternMatch` is a String, then
  //          1. Return PACKAGE_RESOLVE(`target` with every instance of "*"
  //             replaced by `patternMatch`, packageURL + "/").
  //       3. Return PACKAGE_RESOLVE(target, packageURL + "/").
  //    2. If `target` split on "/" or "\" contains any "", ".", "..",
  //       or "node_modules" segments after the first "." segment, case
  //       insensitive and including percent encoded variants, throw an "Invalid
  //       Package Target" error.
  //    3. Let `resolvedTarget` be the URL resolution of the concatenation of
  //       `packageURL` and `target`.
  //    4. Assert: `packageURL` is contained in `resolvedTarget`.
  //    5. If `patternMatch` is null, then
  //       1. Return `resolvedTarget`.
  //    6. If `patternMatch` split on "/" or "\" contains any "", ".",
  //       "..", or "node_modules" segments, case insensitive and including
  //       percent encoded variants, throw an "Invalid Module Specifier" error.
  //    7. Return the URL resolution of `resolvedTarget` with every instance of
  //       "*" replaced with `patternMatch`.
  // 2. Otherwise, if `target` is a non-null Object, then
  //    1. If `target` contains any index property keys, as defined in ECMA-262
  //       6.1.7 Array Index, throw an "Invalid Package Configuration" error.
  //    2. For each property `p` of `target`, in object insertion order as,
  //       1. If `p` equals "default" or `conditions` contains an entry for `p`,
  //          then
  //          1. Let `targetValue` be the value of the `p` property in `target`.
  //          2. Let `resolved` be the result of PACKAGE_TARGET_RESOLVE(
  //             packageURL, targetValue, patternMatch, isImports,
  //             conditions).
  //          3. If `resolved` is equal to undefined, continue the loop.
  //          4. Return `resolved`.
  //    3. Return undefined.
  // 3. Otherwise, if `target` is an Array, then
  //    1. If `target.length` is zero, return null.
  //    2. For each item `targetValue` in `target`, do
  //       1. Let `resolved` be the result of PACKAGE_TARGET_RESOLVE(
  //          packageURL, targetValue, patternMatch, isImports,
  //          conditions), continuing the loop on any "Invalid Package Target"
  //          error.
  //       2. If `resolved` is undefined, continue the loop.
  //       3. Return `resolved`.
  //    3. Return or throw the last fallback resolution null return or error.
  // 4. Otherwise, if `target` is `null`, return null.
  // 5. Otherwise throw an "Invalid Package Target" error.

  async packageTargetResolve(packageDir,
                             target,
                             patternMatch,
                             isImports,
                             conditions) {
    assert(typeof packageDir === 'string');
    assert(isAbsolute(packageDir));
    assert(typeof isImports === 'boolean');
    assert(isArray(conditions));

    const t = isImports ? 'imports' : 'exports';

    // 1
    if (isString(target)) {
      // 1.1
      if (!target.startsWith('./')) {
        // 1.1.1
        if (!isImports || target.startsWith('../') || target[0] === '/')
          throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', t, target);

        // 1.1.2
        if (isString(patternMatch)) {
          const spec = target.replace(/\*/g, patternMatch);
          return this.packageResolve(spec, packageDir, conditions);
        }

        // 1.1.3
        return this.packageResolve(target, packageDir, conditions);
      }

      // 1.2
      {
        const parts = target.split(/[\/\\]/);

        for (let i = 1; i < parts.length; i++) {
          const part = parts[i].toLowerCase();

          if (part === '' ||
              part === '.' ||
              part === '..' ||
              part === 'node_modules') {
            throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', t, target);
          }
        }
      }

      // 1.3
      const resolvedTarget = resolve(packageDir, target);

      // 1.4
      if (!resolvedTarget.startsWith(packageDir + sep))
        throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', t, target);

      // 1.5
      if (patternMatch == null)
        return resolvedTarget;

      // 1.6
      {
        const parts = patternMatch.split(/[\/\\]/);

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].toLowerCase();

          if (part === '' ||
              part === '.' ||
              part === '..' ||
              part === 'node_modules') {
            throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', patternMatch);
          }
        }
      }

      // 1.7
      return resolvedTarget.replace(/\*/g, patternMatch);
    }

    // 2
    if (isObject(target)) {
      const keys = Object.getOwnPropertyNames(target);

      // 2.1
      for (const key of keys) {
        if (/^\d{1,10}$/.test(key)) {
          const num = Number(key);

          if ((num >>> 0) === num && key === num.toString(10))
            throw new ModuleError('ERR_INVALID_PACKAGE_CONFIG', packageDir);
        }
      }

      // 2.2
      for (const p of keys) {
        // 2.2.1
        if (p === 'default' || conditions.includes(p)) {
          const targetValue = target[p];
          const resolved = await this.packageTargetResolve(packageDir,
                                                           targetValue,
                                                           patternMatch,
                                                           isImports,
                                                           conditions);

          if (resolved === undefined)
            continue;

          return resolved;
        }
      }

      // 2.3
      return undefined;
    }

    // 3
    if (isArray(target)) {
      // 3.1
      if (target.length === 0)
        return null;

      // 3.2
      let lastError = undefined;

      for (const targetValue of target) {
        let resolved;

        try {
          resolved = await this.packageTargetResolve(packageDir,
                                                     targetValue,
                                                     patternMatch,
                                                     isImports,
                                                     conditions);
        } catch (e) {
          if (e.code === 'ERR_INVALID_PACKAGE_TARGET') {
            lastError = e;
            continue;
          }
          throw e;
        }

        if (resolved === undefined)
          continue;

        if (resolved === null) {
          lastError = null;
          continue;
        }

        return resolved;
      }

      // 3.3
      if (lastError)
        throw lastError;

      return lastError;
    }

    // 4
    if (target === null)
      return null;

    // 5
    throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', t, typeof target);
  }

  // ESM_FILE_FORMAT(url)
  // 1. Assert: `url` corresponds to an existing file.
  // 2. If `url` ends in ".mjs", then
  //    1. Return "module".
  // 3. If `url` ends in ".cjs", then
  //    1. Return "commonjs".
  // 4. If `url` ends in ".json", then
  //    1. Return "json".
  // 5. If `--experimental-wasm-modules` is enabled and `url` ends in
  //    ".wasm", then
  //    1. Return "wasm".
  // 6. Let `packageURL` be the result of LOOKUP_PACKAGE_SCOPE(url).
  // 7. Let `pjson` be the result of READ_PACKAGE_JSON(packageURL).
  // 8. Let `packageType` be null.
  // 9. If `pjson?.type` is "module" or "commonjs", then
  //    1. Set `packageType` to `pjson.type`.
  // 10. If `url` ends in ".js", then
  //     1. If `packageType` is not null, then
  //        1. Return `packageType`.
  //     2. If `--experimental-detect-module` is enabled and the source of
  //        module contains static import or export syntax, then
  //        1. Return "module".
  //     3. Return "commonjs".
  // 11. If `url` does not have any extension, then
  //     1. If `packageType` is "module" and `--experimental-wasm-modules` is
  //        enabled and the file at `url` contains the header for a WebAssembly
  //        module, then
  //        1. Return "wasm".
  //     2. If `packageType` is not null, then
  //        1. Return `packageType`.
  //     3. If `--experimental-detect-module` is enabled and the source of
  //        module contains static import or export syntax, then
  //        1. Return "module".
  //     4. Return "commonjs".
  // 12. Return undefined (will throw during load phase).

  async esmFileFormat(file) {
    assert(typeof file === 'string');
    assert(isAbsolute(file));

    switch (await stat(file)) {
      case 0:
        break;
      case 1:
        throw new ModuleError('ERR_UNSUPPORTED_DIR_IMPORT', file);
      default:
        throw new ModuleError('MODULE_NOT_FOUND', file);
    }

    const ext = extname(file);

    if (ext === '.mjs')
      return 'module';

    if (ext === '.cjs')
      return 'commonjs';

    if (ext === '.json')
      return 'json';

    // --experimental-wasm-modules
    if (this.wasmModules) {
      if (ext === '.wasm')
        return 'wasm';
    }

    if (ext === '.node')
      return 'addon'; // Non-standard for ESM.

    const packageType = await this.readPackageType(file);

    if (ext === '.js') {
      if (packageType != null)
        return packageType;

      // --experimental-detect-module
      if (this.detectModule) {
        if (await isModuleSyntax(file))
          return 'module';
      }

      return 'commonjs';
    }

    if (ext === '') {
      // --experimental-wasm-modules
      if (this.wasmModules) {
        if (packageType === 'module' && await isWasm(file))
          return 'wasm';
      }

      if (packageType != null)
        return packageType;

      // --experimental-detect-module
      if (this.detectModule) {
        if (await isModuleSyntax(file))
          return 'module';
      }

      return 'commonjs';
    }

    throw new ModuleError('ERR_UNKNOWN_MODULE_FORMAT', ext, file);
  }

  // READ_PACKAGE_TYPE(url)
  // 1. Let `packageURL` be the result of LOOKUP_PACKAGE_SCOPE(url).
  // 2. Let `pjson` be the result of READ_PACKAGE_JSON(packageURL).
  // 3. Let `packageType` be null.
  // 4. If `pjson?.type` is "module" or "commonjs", then
  //    1. Set `packageType` to `pjson.type`.
  // 5. Return `packageType`.

  async readPackageType(file) {
    const scope = await this.lookupPackageScope(file);

    if (scope == null)
      return null;

    const pkg = await this.readPackageJson(scope);

    if (pkg == null)
      return null;

    if (pkg.type === 'module' || pkg.type === 'commonjs')
      return pkg.type;

    return null;
  }

  // LOOKUP_PACKAGE_SCOPE(url)
  // 1. Let `scopeURL` be `url`.
  // 2. While `scopeURL` is not the file system root,
  //    1. Set `scopeURL` to the parent URL of `scopeURL`.
  //    2. If `scopeURL` ends in a "node_modules" path segment, return null.
  //    3. Let `pjsonURL` be the resolution of "package.json" within
  //       `scopeURL`.
  //    4. if the file at `pjsonURL` exists, then
  //       1. Return `scopeURL`.
  // 3. Return null.

  async lookupPackageScope(path) {
    assert(typeof path === 'string');
    assert(isAbsolute(path));

    path = resolve(path);

    if (await stat(path) === 0)
      path = dirname(path);

    for (;;) {
      if (basename(path) === 'node_modules')
        break;

      const pjsonFile = join(path, 'package.json');

      if (await stat(pjsonFile) === 0)
        return path;

      const next = dirname(path);

      if (next === path)
        break;

      path = next;
    }

    return null;
  }

  // READ_PACKAGE_JSON(packageURL)
  // 1. Let `pjsonURL` be the resolution of "package.json" within `packageURL`.
  // 2. If the file at `pjsonURL` does not exist, then
  //    1. Return null.
  // 3. If the file at `packageURL` does not parse as valid JSON, then
  //    1. Throw an "Invalid Package Configuration" error.
  // 4. Return the parsed JSON source of the file at `pjsonURL`.

  async readPackageJson(packageDir) {
    assert(typeof packageDir === 'string');
    assert(isAbsolute(packageDir));

    const pjsonFile = resolve(packageDir, 'package.json');
    const cache = this.pkgCache[pjsonFile];

    if (cache)
      return cache;

    let json = null;

    try {
      json = await fs.readJSON(pjsonFile);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR')
        return null;
    }

    if (!isObject(json))
      throw new ModuleError('ERR_INVALID_PACKAGE_CONFIG', packageDir);

    this.pkgCache[pjsonFile] = json;

    return json;
  }

  // DIRECTORY_RESOLVE(resolved, conditions)
  // 1. Assert: `resolved` corresponds to an existing directory.
  // 2. Let `pjson` be the result of READ_PACKAGE_JSON(resolved).
  // 4. If `pjson?.exports` is not null or undefined, then
  //    1. Return the result of PACKAGE_EXPORTS_RESOLVE(resolved,
  //       '.', pjson.exports, conditions).
  // 5. Otherwise, if `pjson?.main` is a string, then
  //    1. Return the URL resolution of `main` in `resolved`.
  // 6. Otherwise,
  //    1. Throw a "Module Not Found" error.

  async directoryResolve(resolved, conditions) {
    assert(typeof resolved === 'string');
    assert(isAbsolute(resolved));
    assert(isArray(conditions));

    const pjson = await this.readPackageJson(resolved);

    if (pjson != null && pjson.exports != null) {
      return this.packageExportsResolve(resolved,
                                        '.',
                                        pjson.exports,
                                        conditions);
    }

    return this.resolveMain(resolved, pjson);
  }

  /*
   * Helpers
   */

  async unresolve(x) {
    let y = this.root;

    if (hasOwnProperty(this.cache, y)) {
      y = this.cache[y];
    } else {
      y = resolve(y);

      if (await stat(y) === 0)
        y = dirname(y);
    }

    return unresolve(x, y);
  }

  isCore(x) {
    return Resolver.isCore(x);
  }

  isLocal(x) {
    return Resolver.isLocal(x);
  }

  isExternal(x, isImport) {
    assert(typeof x === 'string');
    assert(typeof isImport === 'boolean');

    if (isImport) {
      if (x.startsWith('http:') ||
          x.startsWith('https:') ||
          x.startsWith('data:')) {
        return true;
      }
    }

    if (this.isLocal(x))
      return false;

    if (this.external.size > 0) {
      if (this.external.has(x))
        return true;

      if (this.external.has(x.split('/')[0]))
        return true;
    }

    if (this.isCore(x))
      return false;

    if (this.localOnly)
      return true;

    return false;
  }

  static unresolve(x, y) {
    return unresolve(x, y);
  }

  static isCore(x) {
    assert(typeof x === 'string');

    if (x.startsWith('node:'))
      return CORE_MODULES.has(x.substring(5));

    return CORE_MODULES.has(x) && !NODE_ONLY.has(x);
  }

  static isLocal(x) {
    assert(typeof x === 'string');

    if (x === '' || x === '.' || x === '..')
      return true;

    if (WINDOWS && isAbsolute(x) && x[0] !== '/')
      x = unix(x);

    if (x[0] === '/' || x.startsWith('./') || x.startsWith('../'))
      return true;

    return false;
  }

  static async findRoot(path) {
    return findRoot(path);
  }
}

/*
 * Static
 */

Resolver.hasImport = hasImport;

/*
 * Helpers
 */

function normalizeSpecifier(specifier) {
  assert(typeof specifier === 'string');

  if (specifier.startsWith('node:')) {
    const name = specifier.substring(5);

    if (!CORE_MODULES.has(name))
      throw new ModuleError('ERR_UNKNOWN_BUILTIN_MODULE', specifier);

    return NODE_ONLY.has(name) ? specifier : name;
  }

  return specifier;
}

function safeResolve(scope, specifier, field) {
  const result = resolve(scope, specifier);

  if (!result.startsWith(scope + sep) && result !== scope)
    throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', field, specifier);

  return result;
}

function maybeResolve(scope, specifier, field) {
  if (Resolver.isLocal(specifier))
    return safeResolve(scope, specifier, field);

  return normalizeSpecifier(specifier);
}

function prepend(specifier) {
  assert(typeof specifier === 'string');

  if (specifier === '.' || specifier === '..')
    return specifier + '/';

  if (specifier.startsWith('/') ||
      specifier.startsWith('./') ||
      specifier.startsWith('../')) {
    return specifier;
  }

  return './' + specifier;
}

function unresolve(x, y) {
  x = resolve(x);
  y = resolve(y);
  return prepend(unix(relative(y, x)));
}

function pathOrUrl(file) {
  return typeof file === 'string' || (file instanceof URL);
}

async function stat(file) {
  assert(pathOrUrl(file));

  let st;

  try {
    st = await fs.stat(file);
  } catch (e) {
    if ((e.errno | 0) < 0)
      return e.errno | 0;

    return -1;
  }

  if (st.isFile())
    return 0;

  if (st.isDirectory())
    return 1;

  return -1;
}

async function realpath(file) {
  assert(pathOrUrl(file));

  try {
    return await fs.realpath(file);
  } catch (e) {
    return resolve(file);
  }
}

async function _readJSON(file) {
  assert(pathOrUrl(file));

  try {
    return await fs.readJSON(file);
  } catch (e) {
    return null;
  }
}

async function readJSON(file, pkgCache) {
  if (file instanceof URL)
    file = file.toString();

  assert(typeof file === 'string');
  assert(isAbsolute(file));
  assert(isObject(pkgCache));

  file = resolve(file);

  const cache = pkgCache[file];

  if (cache)
    return cache;

  const json = await _readJSON(file);

  if (isObject(json))
    pkgCache[file] = json;

  return json;
}

async function findRoot(path) {
  assert(typeof path === 'string');

  path = resolve(path);

  if (await stat(path) === 0)
    path = dirname(path);

  for (;;) {
    if (basename(path) === 'node_modules')
      break;

    const file = join(path, 'package.json');

    if (await stat(file) === 0)
      return path;

    const next = dirname(path);

    if (next === path)
      break;

    path = next;
  }

  return null;
}

function isFileURL(path) {
  assert(typeof path === 'string');
  return path.startsWith('file:');
}

function isUnsupportedURL(path) {
  assert(typeof path === 'string');
  return path.startsWith('data:') ||
         path.startsWith('http:') ||
         path.startsWith('https:');
}

function pathToFileURL(path) {
  assert(typeof path === 'string');

  if (url.pathToFileURL)
    return url.pathToFileURL(path);

  const last = path.charCodeAt(path.length - 1);

  let resolved = resolve(path);

  if ((last === 47 || (WINDOWS && last === 92)) &&
      resolved[resolved.length - 1] !== sep) {
    resolved += '/';
  }

  if (resolved.includes('%'))
    resolved = resolved.replace(/%/g, '%25');

  if (!WINDOWS && resolved.includes('\\'))
    resolved = resolved.replace(/\\/g, '%5C');

  const out = new URL('file://');

  out.pathname = resolved;

  return out;
}

function fileURLToPath(uri) {
  assert(pathOrUrl(uri));

  if (url.fileURLToPath)
    return url.fileURLToPath(uri);

  if (typeof uri === 'string')
    uri = new URL(uri);

  if (uri.protocol !== 'file:') {
    const err = new TypeError('The URL must be of scheme file');
    err.code = 'ERR_INVALID_URL_SCHEME';
    throw err;
  }

  const {hostname, pathname} = uri;

  if (!WINDOWS) {
    if (hostname !== '' && hostname !== 'localhost') {
      const err = new TypeError('File URL host be "localhost" or empty');
      err.code = 'ERR_INVALID_FILE_URL_HOST';
      throw err;
    }

    for (let i = 0; i < pathname.length - 2; i++) {
      if (pathname[i] === '%') {
        const third = pathname.codePointAt(i + 2) | 0x20;

        if (pathname[i + 1] === '2' && third === 102) {
          const err = new TypeError('File URL path must '
                                  + 'not include encoded '
                                  + '/ characters');
          err.code = 'ERR_INVALID_FILE_URL_PATH';
          throw err;
        }
      }
    }

    const path = decodeURIComponent(pathname);

    if (path.length === 0)
      return '/';

    return path;
  }

  for (let i = 0; i < pathname.length - 2; i++) {
    if (pathname[i] === '%') {
      const third = pathname.codePointAt(i + 2) | 0x20;

      if ((pathname[i + 1] === '2' && third === 102) ||
          (pathname[i + 1] === '5' && third === 99)) {
        const err = new TypeError('File URL path must '
                                + 'not include encoded '
                                + '\\ or / characters');
        err.code = 'ERR_INVALID_FILE_URL_PATH';
        throw err;
      }
    }
  }

  const path = decodeURIComponent(pathname);

  if (hostname !== '')
    return `//${domainToUnicode(hostname)}${path}`;

  let letter = 0x00;
  let sep = 0x00;

  if (path.length >= 3) {
    letter = path.codePointAt(1) | 0x20;
    sep = path.charCodeAt(2);
  }

  if (letter < 0x61 || letter > 0x7a || sep !== 0x3a) {
    const err = new TypeError('File URL path must be absolute');
    err.code = 'ERR_INVALID_FILE_URL_PATH';
    throw err;
  }

  return path.substring(1);
}

function domainToUnicode(domain) {
  assert(typeof domain === 'string');

  if (!punycode)
    punycode = require('./builtins/punycode');

  return punycode.toUnicode(domain);
}

function isObject(obj) {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isArray(obj) {
  return Array.isArray(obj);
}

function isString(str) {
  return typeof str === 'string' && str.length > 0;
}

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

async function isModuleSyntax(path) {
  assert(typeof path === 'string');

  let code;

  try {
    code = await fs.readFile(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR')
      return false;
    throw e;
  }

  [, code] = stripHashbang(stripBOM(code));

  const args = [...CJS_SCOPE, code];

  try {
    new Function(...args);
  } catch (e) {
    for (const msg of MODULE_ERRORS) {
      if (e.message.includes(msg))
        return true;
    }
  }

  return false;
}

async function isWasm(file) {
  assert(typeof file === 'string');

  let fd;

  try {
    fd = await fs.open(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR')
      return false;
    throw e;
  }

  try {
    return await _isWasm(fd);
  } finally {
    await fs.close(fd);
  }
}

async function _isWasm(fd) {
  const stat = await fs.fstat(fd);

  if (!stat.isFile())
    return false;

  const data = Buffer.allocUnsafe(4);
  const bytes = await fs.read(fd, data, 0, 4, 0);

  if (bytes !== 4)
    return false;

  return data.readUInt32BE(0) === 0x0061736d;
}

/*
 * Errors
 */

const errors = {
  ERR_INVALID_FILE_URL_PATH: 'File URL path \'%s\'',
  ERR_INVALID_PACKAGE_CONFIG: 'Invalid package config \'%s/package.json\'',
  ERR_INVALID_PACKAGE_TARGET: 'Invalid %s target \'%s\'',
  ERR_INVALID_MODULE_SPECIFIER: 'Invalid module specifier \'%s\'',
  ERR_PACKAGE_IMPORT_NOT_DEFINED:
    'Package import specifier \'%s\' not defined in \'%s/package.json\'',
  ERR_PACKAGE_PATH_NOT_EXPORTED:
    'Package subpath \'%s\' is not defined by "exports" in \'%s/package.json\'',
  MODULE_NOT_FOUND: 'Cannot find module \'%s\'',
  ERR_UNKNOWN_BUILTIN_MODULE: 'No such built-in module: %s',
  ERR_UNSUPPORTED_DIR_IMPORT: 'Directory import \'%s\' is not supported',
  ERR_INVALID_ARG_VALUE: 'The argument %s \'%s\' is invalid',
  ERR_INVALID_RETURN_VALUE: 'Redirection must be a string or null, got %s',
  ERR_UNKNOWN_MODULE_FORMAT: 'Unknown module format: %s for %s',
  ERR_INVALID_PACKAGE_SHIM: 'Invalid shim \'%s\''
};

class ModuleError extends Error {
  constructor(code, ...args) {
    let i = 0;

    const msg = errors[code].replace(/%s/g, () => {
      return String(args[i++] || '');
    });

    super(msg);

    this.code = code;
    this.name = `Error [${code}]`;

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, this.constructor);
  }
}

/*
 * Expose
 */

module.exports = Resolver;
