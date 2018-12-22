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
const Path = require('path');

const {
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve
} = Path;

/*
 * Constants
 */

const CORE_MODULES = new Set([
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
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
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
  '.json',
  '.node'
];

const WINDOWS = process.platform === 'win32';

const GLOBAL_PATHS = (() => {
  let home, prefix;

  if (WINDOWS) {
    home = process.env.USERPROFILE;
    prefix = resolve(process.execPath, '..');
  } else {
    home = process.env.HOME;
    prefix = resolve(process.execPath, '..', '..');
  }

  let paths = [resolve(prefix, 'lib', 'node')];

  if (home) {
    paths.unshift(resolve(home, '.node_libraries'));
    paths.unshift(resolve(home, '.node_modules'));
  }

  const node = process.env.NODE_PATH;

  if (node) {
    let parts = node.split(delimiter);
    parts = parts.filter(p => Boolean(p));
    paths = parts.concat(paths);
  }

  return paths;
})();

const NM_CHARS = [115, 101, 108, 117, 100, 111, 109, 95, 101, 100, 111, 110];
const NM_LEN = 12;

/*
 * Require Logic
 * @see https://nodejs.org/api/modules.html#modules_all_together
 */

// require(X) from module at path Y
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

async function resolveX(x, y, extensions) {
  assert(typeof x === 'string');
  assert(typeof y === 'string');
  assert(Array.isArray(extensions));

  if (x.length === 0 || y.length === 0)
    throw new Error('Module not found.');

  if (CORE_MODULES.has(x))
    return x;

  if (x[0] === '/')
    y = '/';

  if (x[0] === '/' || x.startsWith('./') || x.startsWith('../')) {
    const yx = join(y, x);
    const a = await loadAsFile(yx, extensions);

    if (a)
      return a;

    const b = await loadAsDirectory(yx, extensions);

    if (b)
      return b;
  }

  const ret = await loadNodeModules(x, dirname(y), extensions);

  if (ret)
    return ret;

  return null;
}

// LOAD_AS_FILE(X)
// 1. If X is a file, load X as JavaScript text.  STOP
// 2. If X.js is a file, load X.js as JavaScript text.  STOP
// 3. If X.json is a file, parse X.json to a JavaScript Object.  STOP
// 4. If X.node is a file, load X.node as binary addon.  STOP

async function loadAsFile(x, extensions) {
  if ((await stat(x)) === 0)
    return x;

  for (const ext of extensions) {
    const xe = `${x}${ext}`;

    if ((await stat(xe)) === 0)
      return xe;
  }

  return null;
}

// LOAD_INDEX(X)
// 1. If X/index.js is a file, load X/index.js as JavaScript text.  STOP
// 2. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
// 3. If X/index.node is a file, load X/index.node as binary addon.  STOP

async function loadIndex(x, extensions) {
  for (const ext of extensions) {
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

async function loadAsDirectory(x, extensions) {
  const xp = join(x, 'package.json');

  if ((await stat(xp)) === 0) {
    const main = await readMain(xp);

    if (main) {
      const m = join(x, main);
      const c = await loadAsFile(m, extensions);

      if (c)
        return c;

      const d = await loadIndex(m, extensions);

      if (d)
        return d;
    }
  }

  return loadIndex(x, extensions);
}

// LOAD_NODE_MODULES(X, START)
// 1. let DIRS = NODE_MODULES_PATHS(START)
// 2. for each DIR in DIRS:
//    a. LOAD_AS_FILE(DIR/X)
//    b. LOAD_AS_DIRECTORY(DIR/X)

async function loadNodeModules(x, start, extensions) {
  const dirs = nodeModulesPaths(start);

  for (const dir of dirs) {
    const dx = join(dir, x);
    const a = await loadAsFile(dx, extensions);

    if (a)
      return a;

    const b = await loadAsDirectory(dx, extensions);

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

function nodeModulesPaths(start) {
  start = resolve(start);

  const paths = [];

  let last = start.length;
  let p = 0;

  if (WINDOWS) {
    if (start.charCodeAt(start.length - 1) === 92
        && start.charCodeAt(start.length - 2) === 58) {
      return [start + 'node_modules'].concat(GLOBAL_PATHS);
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

    return paths.concat(GLOBAL_PATHS);
  }

  if (start === '/')
    return ['/node_modules'].concat(GLOBAL_PATHS);

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

  return paths.concat(GLOBAL_PATHS);
}

/*
 * API
 */

function create(filename, custom) {
  if (custom == null)
    custom = DEFAULT_EXTENSIONS;

  assert(typeof filename === 'string');
  assert(Array.isArray(custom));

  // Module.createRequireFromPath seems
  // to call dirname for some reason.
  const start = dirname(resolve(filename));
  const extensions = [...custom];
  const cache = Object.create(null);

  // Always include .json and .node.
  if (extensions.indexOf('.json') === -1)
    extensions.push('.json');

  if (extensions.indexOf('.node') === -1)
    extensions.push('.node');

  return async (location) => {
    assert(typeof location === 'string');

    if (hasOwnProperty(cache, location))
      return cache[location];

    let path = await resolveX(location, start, extensions);

    if (path == null) {
      const err = new Error(`Could not find module: ${location}.`);
      err.code = 'MODULE_NOT_FOUND';
      cache[location] = null;
      throw err;
    }

    // Normalize.
    if (isAbsolute(path))
      path = resolve(path, '.');

    cache[location] = path;

    return path;
  };
}

/*
 * Helpers
 */

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

async function readJSON(file) {
  assert(typeof file === 'string');

  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function readMain(file) {
  const json = await readJSON(file);

  if (!json || typeof json !== 'object')
    return null;

  if (typeof json.main !== 'string')
    return null;

  if (json.main.length === 0)
    return null;

  return json.main;
}

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/*
 * Expose
 */

module.exports = create;