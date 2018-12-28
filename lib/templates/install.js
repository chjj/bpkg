#!/usr/bin/env node

/*!
 * __NAME__@__VERSION__ install
 * Bundled by bpkg on __TIME__
 */

/* global __LINKS__ */

'use strict';

const fs = require('fs');
const path = require('path');
const log = console.log.bind(console);
const error = console.error.bind(console);
const chdir = process.chdir.bind(process);
const exit = process.exit.bind(process);
const setgid = process.setgid.bind(process);
const setuid = process.setuid.bind(process);
const {argv} = process;

const {
  dirname,
  join,
  isAbsolute,
  normalize,
  relative,
  resolve
} = path;

/*
 * Constants
 */

const NAME = '__NAME__';
const VERSION = '__VERSION__';
const PKG = join(NAME, 'package.json');
const CWD = __dirname;

const LINKS = __LINKS__;

if (argv.length < 3) {
  error('Usage: ./install [prefix] [user] [group]');
  exit(1);
}

const PREFIX = resolve(argv[2]);
const USER = argv.length > 3 ? argv[3] : null;
const GROUP = argv.length > 4 ? argv[4] : null;

const NODE_MODULES = resolve(PREFIX, 'lib', 'node_modules');
const BIN = resolve(PREFIX, 'bin');
const MAN = resolve(PREFIX, 'share', 'man');
const LICENSES = resolve(PREFIX, 'share', 'licenses');

/*
 * Main
 */

function main() {
  if (USER)
    setuid(USER);

  if (GROUP)
    setgid(GROUP);

  chdir(CWD);

  if (!fs.existsSync(PKG)) {
    error(`Error: wrong directory for ${NAME} install!`);
    exit(1);
  }

  log(`Installing ${NAME}@${VERSION}...`);
  log('');

  mkdirp(PREFIX);
  mkdirp(NODE_MODULES);
  mkdirp(BIN);
  mkdirp(MAN);

  log(`  ${NAME} -> ${relative(CWD, resolve(NODE_MODULES, NAME))}`);
  log('');

  copy(NAME, resolve(NODE_MODULES, NAME));

  log(`Linking ${NAME}@${VERSION}...`);
  log('');

  for (const [type, from, to] of LINKS) {
    const src = normalize(replace(from));
    const dest = normalize(replace(to));

    if (type === 'license') {
      if (!isDirectory(LICENSES))
        continue;
    }

    log(`  ${relative(CWD, dest)} -> ${relative(CWD, src)}`);

    if (type !== 'bin')
      mkdirp(dirname(dest));

    symlink(src, dest);
  }

  log('');
  log(`${NAME}@${VERSION} successfully installed!`);
  exit(0);
}

function replace(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a string.');

  return path.replace(/\$[A-Z_]+/g, (name) => {
    switch (name) {
      case '$NODE_MODULES':
        return NODE_MODULES;
      case '$BIN':
        return BIN;
      case '$MAN':
        return MAN;
      case '$LICENSES':
        return LICENSES;
      default:
        throw new Error(`Invalid path: '${path}'`);
    }
  });
}

/*
 * Helpers
 */

function isDirectory(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  try {
    return fs.statSync(path).isDirectory();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

function mkdirp(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  const paths = [];

  let dir = resolve(path);

  for (;;) {
    paths.push(dir);

    const next = resolve(dir, '..');

    if (next === dir)
      break;

    dir = next;
  }

  for (const path of paths.reverse()) {
    if (!isDirectory(path))
      fs.mkdirSync(path, 0o755);
  }
}

function symlink(from, to) {
  if (typeof from !== 'string')
    throw new TypeError('"from" must be a path.');

  if (typeof to !== 'string')
    throw new TypeError('"to" must be a path.');

  from = resolve(from);
  to = resolve(to);

  fs.symlinkSync(relative(dirname(to), from), to);
}

function* traverse(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  const root = resolve(path);

  yield* (function* next(path) {
    const stat = fs.lstatSync(path);
    const file = relative(root, path);

    if (stat.isDirectory()) {
      yield [file, stat];
      for (const name of fs.readdirSync(path))
        yield* next(join(path, name));
      return;
    }

    if (stat.isFile() || stat.isSymbolicLink())
      yield [file, stat];
  })(root);
}

function copy(from, to) {
  if (typeof from !== 'string')
    throw new TypeError('"from" must be a path.');

  if (typeof to !== 'string')
    throw new TypeError('"to" must be a path.');

  from = resolve(from);
  to = resolve(to);

  for (const [file, stat] of traverse(from)) {
    const src = resolve(from, file);
    const dest = resolve(to, file);

    if (stat.isDirectory()) {
      if (!isDirectory(dest))
        fs.mkdirSync(dest, stat.mode);
      continue;
    }

    if (stat.isSymbolicLink()) {
      let link = fs.readlinkSync(src);

      if (isAbsolute(link))
        link = relative(from, link);

      if (fs.existsSync(dest))
        fs.unlinkSync(dest);

      fs.symlinkSync(link, dest);

      continue;
    }

    if (fs.copyFileSync) {
      fs.copyFileSync(src, dest, 0);
      continue;
    }

    const slab = Buffer.allocUnsafe(64 * 1024);

    let rfd = null;
    let st = null;
    let wfd = null;
    let pos = 0;

    try {
      rfd = fs.openSync(src, 'r');
      st = fs.fstatSync(rfd);
      wfd = fs.openSync(dest, 'w', st.mode);

      while (pos < st.size) {
        const length = Math.min(st.size - pos, slab.length);
        const bytes = fs.readSync(rfd, slab, 0, length, pos);

        if (bytes !== length)
          throw new Error('I/O error.');

        fs.writeSync(wfd, slab, 0, length, null);
        pos += bytes;
      }
    } finally {
      try {
        if (wfd != null)
          fs.closeSync(wfd);
      } finally {
        if (rfd != null)
          fs.closeSync(rfd);
      }
    }
  }
}

/*
 * Execute
 */

main();
