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
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib'
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
    this.redirect = async (x, y) => x;

    this.cache = Object.create(null);
    this.require = this.require.bind(this);
    this.resolve = this.resolve.bind(this);
    this.resolvePath = this.resolvePath.bind(this);
    this.normalize = this.normalize.bind(this);
    this.directory = this.directory.bind(this);
    this.unresolve = this.unresolve.bind(this);
    this.isCore = this.isCore.bind(this);
    this.isLocal = this.isLocal.bind(this);
    this.isExternal = this.isExternal.bind(this);

    this.init(options);
  }

  static create(options) {
    const resolver = new this(options);
    const {require, resolve} = resolver;

    Object.assign(require, resolver);
    Object.assign(resolve, resolver);

    return resolve;
  }

  get browser() {
    return this.field === 'browser';
  }

  set browser(value) {
    this.field = value ? 'browser' : null;
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

    if (options.redirect != null) {
      assert(typeof options.redirect === 'function');
      this.redirect = options.redirect;
    }

    return this;
  }

  async require(location) {
    const path = await this.resolve(location);
    return this.requireFunc(path);
  }

  async directory(location) {
    assert(typeof location === 'string');

    if (location === ''
        || location === '.'
        || location === '..'
        || location.startsWith('/')
        || location.startsWith('./')
        || location.startsWith('../')
        || isFileURL(location)) {
      const err = new Error(`Cannot find module: '${location}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    while (location.endsWith('/'))
      location = location.slice(0, -1);

    let path;

    try {
      path = await this.resolve(`${location}/package.json`);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
      path = await this.resolve(`${location}/index`);
    }

    return dirname(path);
  }

  async resolve(location) {
    const path = await this.resolvePath(location, this.root);

    if (path == null) {
      const err = new Error(`Cannot find module: '${location}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    return path;
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

  async resolvePath(x, y) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');

    // Convert URL to path.
    if (isFileURL(x)) {
      x = fromFileURL(x);

      if (x == null)
        return null;
    }

    const yy = `${y}`;

    // Hit the cache for start directory.
    if (hasOwnProperty(this.cache, yy)) {
      y = this.cache[yy];
    } else {
      // Ensure y is absolute.
      y = resolve(y);

      // Ensure y is a directory.
      // Note that module.createRequireFromPath
      // _always_ seems to go one directory up.
      if ((await stat(y)) === 0)
        y = dirname(y);

      this.cache[yy] = y;
    }

    const xy = `${x}\0${y}`;

    // Hit the resolution cache next.
    if (hasOwnProperty(this.cache, xy))
      return this.cache[xy];

    // Possible redirection.
    x = await this.redirect(x, y);

    if (x == null) {
      this.cache[xy] = null;
      return null;
    }

    if (typeof x !== 'string')
      throw new TypeError('Redirection must return a string.');

    // Resolve path.
    let z = await this.requireX(x, y);

    if (z == null) {
      this.cache[xy] = null;
      return null;
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

  // REQUIRE(X) from module at path Y
  // 1. If X is a core module,
  //    a. return the core module
  //    b. STOP
  // 2. If X begins with '/'
  //    a. set Y to be the filesystem root
  // 3. If X begins with './' or '/' or '../'
  //    a. LOAD_AS_FILE(Y + X)
  //    b. LOAD_AS_DIRECTORY(Y + X)
  // 4. LOAD_NODE_MODULES(X, dirname(Y))
  // 5. THROW "not found"

  async requireX(x, y) {
    assert(typeof x === 'string');
    assert(typeof y === 'string');
    assert(isAbsolute(y));

    if (x.length === 0 || y.length === 0)
      return null;

    if (x === '.' || x === '..')
      return null;

    if (CORE_MODULES.has(x))
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
    }

    // Early exit unless we want `/foo` to
    // be able to resolve to `/node_modules/foo`.
    if (x[0] === '/')
      return null;

    // Supposed to do dirname(y), but our
    // nodeModulePaths function is different (?).
    const z = await this.loadNodeModules(x, y);

    if (z)
      return z;

    return null;
  }

  // LOAD_AS_FILE(X)
  // 1. If X is a file, load X as JS text. STOP
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
  //    b. let M = X + (json main field)
  //    c. LOAD_AS_FILE(M)
  //    d. LOAD_INDEX(M)
  // 2. LOAD_INDEX(X)

  async loadAsDirectory(x) {
    assert(typeof x === 'string');
    assert(isAbsolute(x));

    const xp = join(x, 'package.json');

    if ((await stat(xp)) === 0) {
      const main = await this.readMain(xp);

      if (main) {
        const m = join(x, main);
        const c = await this.loadAsFile(m);

        if (c)
          return c;

        const d = await this.loadIndex(m);

        if (d)
          return d;
      }
    }

    return this.loadIndex(x);
  }

  // LOAD_NODE_MODULES(X, START)
  // 1. let DIRS = NODE_MODULES_PATHS(START)
  // 2. for each DIR in DIRS:
  //    a. LOAD_AS_FILE(DIR/X)
  //    b. LOAD_AS_DIRECTORY(DIR/X)

  async loadNodeModules(x, start) {
    assert(typeof x === 'string');
    assert(typeof start === 'string');

    const dirs = this.nodeModulesPaths(start);

    for (const dir of dirs) {
      const dx = join(dir, x);
      const a = await this.loadAsFile(dx);

      if (a)
        return a;

      const b = await this.loadAsDirectory(dx);

      if (b)
        return b;
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

    if (CORE_MODULES.has(x))
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
        const z = await this.resolvePath(x, y);

        if (!z)
          return null;

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

  isExternal(x) {
    assert(typeof x === 'string');

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
    return CORE_MODULES.has(x);
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

  if (!location.startsWith('/')
      && !location.startsWith('./')
      && !location.startsWith('../')) {
    return './' + location;
  }

  return location;
}

function unresolve(x, y) {
  x = resolve(x);
  y = resolve(y);
  return prepend(unix(relative(y, x)));
}

async function stat(file) {
  assert(typeof file === 'string');

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
  assert(typeof file === 'string');

  try {
    return await fs.realpath(file);
  } catch (e) {
    return resolve(file);
  }
}

async function readJSON(file) {
  assert(typeof file === 'string');
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
  assert(typeof uri === 'string');
  try {
    return fileURLToPath(uri);
  } catch (e) {
    return null;
  }
}

function fileURLToPath(uri) {
  assert(typeof uri === 'string');

  if (url.fileURLToPath)
    return resolve(url.fileURLToPath(uri), '.');

  try {
    uri = url.parse(uri);
  } catch (e) {
    const err = new TypeError(`Invalid URL: ${uri}`);
    err.code = 'ERR_INVALID_URL';
    throw err;
  }

  if (uri.protocol !== 'file:') {
    const err = new TypeError('The URL must be of scheme file');
    err.code = 'ERR_INVALID_URL_SCHEME';
    throw err;
  }

  if (uri.port != null) {
    const err = new TypeError(`Invalid URL: ${uri.href}`);
    err.code = 'ERR_INVALID_URL';
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
  return typeof obj === 'object' && obj !== null;
}

function isString(str) {
  return typeof str === 'string' && str.length > 0;
}

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/*
 * Expose
 */

module.exports = Resolver;
