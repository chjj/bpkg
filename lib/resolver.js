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
const {unix} = require('./utils');
const {URL} = url;
const {sep} = path;

const {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve
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
  '.mjs',
  '.cjs',
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

/*
 * Import Function
 */

let importFunc = null;

try {
  importFunc = Function('name', 'return import(name);');
  assert(importFunc('./builtins/empty.js') instanceof Promise);
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
    this.field = null;
    this.requireFunc = require;
    this.importFunc = importFunc;
    this.redirect = async (x, y, isImport) => x;
    this.cache = Object.create(null);

    this.init(options);
  }

  get browser() {
    return this.field === 'browser';
  }

  set browser(value) {
    this.field = value ? 'browser' : null;
  }

  _conditions(esm) {
    return [this.browser ? 'browser' : 'node',
                     esm ? 'import' : 'require'];
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

    if (options.browser != null) {
      assert(typeof options.browser === 'boolean');
      this.browser = options.browser;
    }

    if (options.field != null) {
      assert(typeof options.field === 'string');
      this.field = options.field;
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

    return this;
  }

  async require(location, isImport = false) {
    const path = await this.resolve(location, isImport);

    return isImport ? this.importFunc(path)
                    : this.requireFunc(path);
  }

  async directory(location, isImport = false) {
    assert(typeof location === 'string');
    assert(typeof isImport === 'boolean');

    if (location === ''
        || location === '.'
        || location === '..'
        || location.startsWith('/')
        || location.startsWith('./')
        || location.startsWith('../')
        || location.startsWith('file:')
        || location.startsWith('node:')
        || location.includes('\\')) {
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', location);
    }

    const path = await this.resolve(location, isImport);
    const root = await findRoot(path);

    if (root == null)
      throw new ModuleError('MODULE_NOT_FOUND', location);

    return root;
  }

  async format(location, isImport = false) {
    const path = await this.resolve(location, isImport);

    if (!isAbsolute(path))
      return 'builtin';

    if (isImport)
      return this.esmFileFormat(path);

    switch (extname(path)) {
      case '.js': {
        const type = await this.readPackageType(path);
        return type || 'commonjs';
      }
      case '.mjs': {
        return 'module';
      }
      case '.cjs': {
        return 'commonjs';
      }
      case '.json': {
        return 'json';
      }
      case '.node': {
        return 'addon';
      }
      default: {
        return 'unknown';
      }
    }
  }

  async resolve(location, isImport = false) {
    return this.resolvePath(location, this.root, isImport);
  }

  // RESOLVE(X) from module at path Y
  // 1. If X is a file URL.
  //    a. Convert to path.
  // 2. If X is in cache.
  //    a. return cache value
  //    b. STOP
  // 3. Y = resolve(Y)
  // 4. If Y is a regular file.
  //    Y = dirname(Y)
  // 5. Z = require(X, Y)
  // 6. If Z is null.
  //    a. Enter null into cache.
  //    b. STOP
  // 7. Enter Z into cache.
  //    a. STOP

  async resolvePath(x, y, isImport) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');
    assert(typeof isImport === 'boolean');

    const xx = x;
    const yy = y;

    // Convert URL to path.
    if (isFileURL(x)) {
      x = fromFileURL(x);

      if (x == null)
        throw new ModuleError('ERR_INVALID_FILE_URL_PATH', xx);
    }

    // Hit the cache for start directory.
    if (hasOwnProperty(this.cache, yy)) {
      y = this.cache[yy];
    } else {
      // Ensure y is absolute.
      y = resolve(y);

      // Ensure y is a directory. Note:
      // module.createRequire _always_
      // seems to go one directory up.
      if ((await stat(y)) === 0)
        y = dirname(y);

      this.cache[yy] = y;
    }

    const xy = `${x}\0${y}\0${isImport | 0}`;

    // Hit the resolution cache next.
    if (hasOwnProperty(this.cache, xy)) {
      if (this.cache[xy] == null)
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

    // Resolve path.
    let z;

    try {
      z = isImport ? (await this.esmResolve(x, y))
                   : (await this.requireX(x, y));
    } catch (e) {
      this.cache[xy] = null;
      throw e;
    }

    // An actual path (not a core module).
    if (isAbsolute(z)) {
      // Normalize.
      z = resolve(z, '.');
      y = dirname(z);
    }

    // Possible field aliases.
    z = await this.alias(z, y);

    // Get realpath and normalize.
    if (isAbsolute(z)) {
      if (!this.preserve)
        z = await realpath(z);
      z = resolve(z, '.');
    }

    this.cache[xy] = z;

    return z;
  }

  // require(X) from module at path Y
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

    if (x === '.' || x === '..')
      x += '/';

    if (x.startsWith('node:')) {
      x = x.substring(5);

      if (CORE_MODULES.has(x))
        return NODE_ONLY.has(x) ? `node:${x}` : x;

      throw new ModuleError('ERR_UNKNOWN_BUILTIN_MODULE', xx);
    }

    if (CORE_MODULES.has(x) && !NODE_ONLY.has(x))
      return x;

    // Allow lookups like `C:\foobar` on windows.
    if (WINDOWS && isAbsolute(x) && x[0] !== '/') {
      y = x; // Gets set to root below.
      x = unix(x);
    }

    if (x[0] === '/')
      y = WINDOWS ? parse(y).root : '/';

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

    if ((await stat(x)) === 0)
      return x;

    for (const ext of this.extensions) {
      const xe = `${x}${ext}`;

      if ((await stat(xe)) === 0)
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

      if ((await stat(xi)) === 0)
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

    if ((await stat(xp)) === 0) {
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

        return null;
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
  // 3. let DIRS = [GLOBAL_FOLDERS]
  // 4. while I >= 0,
  //    a. if PARTS[I] = "node_modules" CONTINUE
  //    b. DIR = path join(PARTS[0 .. I] + "node_modules")
  //    c. DIRS = DIRS + DIR
  //    d. let I = I - 1
  // 5. return DIRS

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
      if (start.charCodeAt(start.length - 1) === 92
          && start.charCodeAt(start.length - 2) === 58) {
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

    if (x === pkg.name || x.startsWith(pkg.name + sep)) {
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
  // 2. If field was passed
  //    a. M = READ_FIELD(X, J)
  //    b. if M is not null, return
  // 3. Look for "main" field in J
  //    a. If "main" is present and a valid string, return

  async readMain(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    const j = await readJSON(x);

    if (!isObject(j))
      return null;

    if (this.field) {
      const m = await this.fieldMain(x, j);

      if (m)
        return m;
    }

    if (!isString(j.main))
      return null;

    return j.main;
  }

  // FIELD_MAIN(X, J)
  // 1. Look for FIELD field in J
  //    a. If FIELD is false, return EMPTY
  //    b. If FIELD is a valid string, return
  // 2. If "main" is not a valid string and
  //    FIELD is not an object, return null
  // 3. Let Y = dirname(X)
  // 4. Let M = NORMALIZE(main, Y)
  // 5. If "main" is present in the normalized
  //    FIELD table, return the corresponding
  //    normalized value.
  // 6. Return null

  async fieldMain(x, j) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));
    assert(isObject(j));

    const y = dirname(x);
    const b = j[this.field];

    if (b === false || isString(b))
      return this.normalize(b, y);

    if (isString(j.main) && isObject(b)) {
      const m = await this.normalize(j.main, y);

      if (!m)
        return null;

      for (const k of Object.keys(b)) {
        const v = b[k];

        if (v !== false && !isString(v))
          continue;

        const x = await this.normalize(k, y);

        if (x && m === x)
          return this.normalize(v, y);
      }
    }

    return null;
  }

  // NORMALIZE(X, Y)
  // 1.  If X is false, return relative(EMPTY)
  // 2.  If X is not a string, return null
  // 3.  If X is a core module, return X
  // 4.  If X does not being with '/', './', or '../'
  //     a. Let F = LOAD_AS_FILE(Y + X)
  //     b. If F is null, continue
  //     c. Let Z = RESOLVE(X, Y)
  //     d. If Z is null, return null
  //     e. Return prepend(relative(Y, Z))
  // 5.  If X is zero length, return null
  // 6.  X = posix_normalize(X)
  // 7.  If X is the root directory, return
  // 8.  If X begins with '/', X = X[1:]
  // 9.  If X ends with '/', X = X[:-1]
  // 10. If extname(X) == ''
  //     a. Let Z = LOAD_AS_FILE(Y + X)
  //     b. If Z is null, continue
  //     c. X += extname(Z)
  // 11. Return prepend(X)

  async normalize(x, y) {
    assert(typeof y === 'string');
    assert(isAbsolute(y));

    if (x === false)
      return unresolve(EMPTY, y);

    if (typeof x !== 'string')
      return null;

    if (x.startsWith('node:')) {
      x = x.substring(5);

      if (CORE_MODULES.has(x))
        return NODE_ONLY.has(x) ? `node:${x}` : x;

      return null;
    }

    if (CORE_MODULES.has(x) && !NODE_ONLY.has(x))
      return x;

    if (x.length > 0
        && x !== '.'
        && x !== '..'
        && !x.startsWith('/')
        && !x.startsWith('./')
        && !x.startsWith('../')) {
      const yx = join(y, x);

      if (!await this.loadAsFile(yx)) {
        // Could do require here
        // to avoid recursive loops.
        let z;

        try {
          z = await this.resolvePath(x, y, false);
        } catch (e) {
          if (!(e instanceof ModuleError))
            throw e;
          return null;
        }

        return unresolve(z, y);
      }
    }

    if (x.length === 0)
      return null;

    if (x === '.' || x === '..')
      return null;

    x = unix(normalize(x));

    if (x === '/')
      return null;

    if (x[0] === '/')
      x = x.substring(1);

    if (x[x.length - 1] === '/')
      x = x.substring(0, x.length - 1);

    if (extname(x) === '') {
      const yx = join(y, x);
      const z = await this.loadAsFile(yx);

      if (z)
        x += extname(z);
    }

    x = prepend(x);

    return x;
  }

  // ALIAS(X, Y)
  // 1. If no field was passed, return X
  // 2. Let Z = FIND_ROOT(Y)
  // 3. If Z is null, return X
  // 4. Let B = GET_FIELD(Z)
  // 5. If B is null, return X
  // 6. If X is not absolute
  //    a. If X is present in B, return B[X]
  //    b. return X
  // 7. Let K = prepend(relative(Z, X))
  // 8. If X is present in B, return B[X]
  // 9. Return X

  async alias(x, y) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');
    assert(isAbsolute(y));

    if (!this.field)
      return x;

    const z = await findRoot(y);

    if (!z)
      return x;

    const b = await this.getField(z);

    if (!b)
      return x;

    if (!isAbsolute(x)) {
      if (b[x])
        return resolve(z, b[x]);
      return x;
    }

    const k = unresolve(x, z);

    if (b[k])
      return resolve(z, b[k]);

    return x;
  }

  // GET_FIELD(Z)
  // 1. Let X = Z/package.json
  // 2. Let J = READ_JSON(X)
  // 3. If J is null, return null
  // 4. Let M = J["main"]
  // 5. Let B = J[FIELD]
  // 6. M = NORMALIZE(M, Z)
  // 7. foreach K, V in B
  //    a. K = NORMALIZE(K, V)
  //    b. V = NORMALIZE(K, V)
  //    c. B[K] = V
  // 8. Return B

  async getField(z) {
    assert(typeof z === 'string');
    assert(isAbsolute(z));
    assert(this.field);

    const x = join(z, 'package.json');
    const j = await readJSON(x);

    if (!isObject(j))
      return null;

    let m = j.main;
    let b = j[this.field];

    if (isString(m))
      m = await this.normalize(m, z);

    if (b === false && isString(m)) {
      b = Object.create(null);
      b[m] = false;
    }

    if (isString(b) && isString(m)) {
      b = Object.create(null);
      b[m] = j[this.field];
    }

    if (!isObject(b))
      return null;

    for (let k of Object.keys(b)) {
      let v = b[k];

      delete b[k];

      k = await this.normalize(k, z);

      if (!k)
        continue;

      v = await this.normalize(v, z);

      if (!v)
        continue;

      b[k] = v;
    }

    return b;
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

    if (specifier.length === 0)
      throw new ModuleError('ERR_INVALID_MODULE_SPECIFIER', specifier);

    if (!isAbsolute(parentDir))
      throw new ModuleError('ERR_INVALID_FILE_URL_PATH', parentDir);

    if (!isFileURL(specifier)) {
      // Allow lookups like `C:\foobar` on windows.
      if (WINDOWS && isAbsolute(specifier) && specifier[0] !== '/') {
        parentDir = specifier; // Gets set to root below.
        specifier = unix(specifier);
      }

      if (specifier[0] === '/')
        parentDir = WINDOWS ? parse(parentDir).root : '/';
    }

    // 1
    let resolved = undefined;

    // 2, 3, 4, 5
    if (isFileURL(specifier)) {
      resolved = fileURLToPath(specifier);
    } else if (specifier[0] === '/' ||
               specifier.startsWith('./') ||
               specifier.startsWith('../')) {
      resolved = resolve(parentDir, specifier);
    } else if (specifier[0] === '#') {
      const conditions = this._conditions(true);

      resolved = await this.packageImportsResolve(specifier,
                                                  parentDir,
                                                  conditions);
    } else {
      const conditions = this._conditions(true);

      resolved = await this.packageResolve(specifier,
                                           parentDir,
                                           conditions);
    }

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

      // 7.4
      resolved = await realpath(resolved);
      resolved = resolve(resolved, '.');
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
  //        concatenated with `packageSpecifier`, relative to `parentURL`.
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
    let x = packageSpecifier;

    if (x.startsWith('node:')) {
      x = x.substring(5);

      if (CORE_MODULES.has(x))
        return NODE_ONLY.has(x) ? `node:${x}` : x;

      throw new ModuleError('ERR_UNKNOWN_BUILTIN_MODULE', packageSpecifier);
    }

    if (CORE_MODULES.has(x) && !NODE_ONLY.has(x))
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
      const packageDir = join(parentDir, 'node_modules', packageSpecifier);

      // 11.3
      if ((await stat(packageDir)) !== 1) {
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
      if (packageSubpath === '.') {
        if (pjson != null && isString(pjson.main))
          return resolve(packageDir, pjson.main);
      }

      return resolve(packageDir, packageSubpath);
    }

    // 12
    throw new ModuleError('MODULE_NOT_FOUND', packageSpecifier);
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
        const start = parts.indexOf('.');

        if (start >= 0) {
          for (let i = start + 1; i < parts.length; i++) {
            const part = parts[i];

            if (part === '' ||
                part === '.' ||
                part === '..' ||
                part === 'node_modules') {
              throw new ModuleError('ERR_INVALID_PACKAGE_TARGET', t, target);
            }
          }
        }
      }

      // 1.3
      const resolvedTarget = resolve(packageDir, target);

      // 1.4
      assert(resolvedTarget.includes(packageDir));

      // 1.5
      if (patternMatch == null)
        return resolvedTarget;

      // 1.6
      {
        const parts = patternMatch.split(/[\/\\]/);

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];

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
      let lastError = null;

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

      return null;
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
    assert((await stat(file)) === 0);

    const ext = extname(file);

    if (ext === '.mjs')
      return 'module';

    if (ext === '.cjs')
      return 'commonjs';

    if (ext === '.json')
      return 'json';

    if (ext === '.wasm')
      return 'wasm';

    const packageType = await this.readPackageType(file);

    if (ext === '.js') {
      if (packageType != null)
        return packageType;

      // Possible syntax analysis.

      return 'commonjs';
    }

    if (ext === '') {
      if (packageType === 'module' && (await isWasm(file)))
        return 'wasm';

      if (packageType != null)
        return packageType;

      // Possible syntax analysis.

      return 'commonjs';
    }

    return 'unknown';
  }

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

    if ((await stat(path)) === 0)
      path = dirname(path);

    for (;;) {
      if (path.endsWith(sep + 'node_modules'))
        return null;

      const pjsonFile = join(path, 'package.json');

      if ((await stat(pjsonFile)) === 0)
        return path;

      const next = dirname(path);

      if (next === path)
        return null;

      path = next;
    }
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

    const pjsonFile = join(packageDir, 'package.json');

    let json = null;

    try {
      json = await fs.readJSON(pjsonFile);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR')
        return null;
    }

    if (!isObject(json))
      throw new ModuleError('ERR_INVALID_PACKAGE_CONFIG', packageDir);

    return json;
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

      if ((await stat(y)) === 0)
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
 * Helpers
 */

function prepend(location) {
  assert(typeof location === 'string');

  if (location === '.')
    return './';

  if (location === '..')
    return '../';

  if (!location.startsWith('/') &&
      !location.startsWith('./') &&
      !location.startsWith('../')) {
    return './' + location;
  }

  return location;
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

  let s;

  try {
    s = await fs.stat(file);
  } catch (e) {
    if ((e.errno | 0) < 0)
      return e.errno | 0;

    return -1;
  }

  return s.isDirectory() ? 1 : 0;
}

async function realpath(file) {
  assert(pathOrUrl(file));

  try {
    return await fs.realpath(file);
  } catch (e) {
    return resolve(file);
  }
}

async function readJSON(file) {
  assert(pathOrUrl(file));

  try {
    return await fs.readJSON(file);
  } catch (e) {
    return null;
  }
}

async function findRoot(path) {
  assert(typeof path === 'string');

  path = resolve(path);

  if ((await stat(path)) === 0)
    path = dirname(path);

  let dir = path;

  for (;;) {
    if (dir.endsWith(sep + 'node_modules'))
      return null;

    const loc = join(dir, 'package.json');

    if ((await stat(loc)) === 0)
      return dir;

    const next = dirname(dir);

    if (next === dir)
      return null;

    dir = next;
  }
}

function isFileURL(path) {
  assert(typeof path === 'string');
  return path.startsWith('file:');
}

function fromFileURL(uri) {
  assert(pathOrUrl(uri));

  try {
    return fileURLToPath(uri);
  } catch (e) {
    return null;
  }
}

function fileURLToPath(uri) {
  assert(pathOrUrl(uri));

  if (url.fileURLToPath)
    return resolve(url.fileURLToPath(uri), '.');

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

    return resolve(path, '.');
  }

  for (let i = 0; i < pathname.length - 2; i++) {
    if (pathname[i] === '%') {
      const third = pathname.codePointAt(i + 2) | 0x20;

      if ((pathname[i + 1] === '2' && third === 102)
          || (pathname[i + 1] === '5' && third === 99)) {
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
    return resolve(`//${domainToUnicode(hostname)}${path}`, '.');

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

  return resolve(path.substring(1), '.');
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

// eslint-disable-next-line
async function isWasm(file) {
  assert(typeof file === 'string');

  const fd = await fs.open(file);

  try {
    return await _isWasm(fd);
  } finally {
    await fs.close(fd);
  }
}

async function _isWasm(fd) {
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
  ERR_INVALID_RETURN_VALUE: 'Redirection must be a string or null, got %s'
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
