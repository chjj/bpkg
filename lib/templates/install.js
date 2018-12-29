#!/usr/bin/env node

/*!
 * __NAME__@__VERSION__ install
 * Bundled by bpkg on __TIME__
 */

/* eslint "no-var": "off" */
/* eslint "no-buffer-constructor": "off" */
/* eslint "prefer-arrow-callback": "off" */

/* global __LINKS__ */

'use strict';

var fs = require('fs');
var path = require('path');
var dirname = path.dirname;
var join = path.join;
var isAbsolute = path.isAbsolute;
var normalize = path.normalize;
var relative = path.relative;
var resolve = path.resolve;

/*
 * Constants
 */

var NAME = '__NAME__';
var VERSION = '__VERSION__';
var PKG = join(NAME, 'package.json');
var CWD = __dirname;

var LINKS = __LINKS__;

/*
 * Main
 */

function parseArgs() {
  var options = {
    prefix: null,
    license: false
  };

  var args = getArgs(process.argv);

  for (var i = 2; i < args.length; i++) {
    var arg = args[i];
    var next = '';

    if (i + 1 < args.length)
      next = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help': {
        console.log('');
        console.log('  Usage: ./install [options] [prefix]');
        console.log('');
        console.log('  Options:');
        console.log('');
        console.log('    -u, --user <name>   setuid to user');
        console.log('    -g, --group <name>  setgid to group');
        console.log('    -l, --license       include license file');
        console.log('    -h, --help          output usage information');
        console.log('');
        process.exit(0);
        break;
      }

      case '-u':
      case '--user': {
        if (!next || next[0] === '-')
          throw new Error('Invalid option for: ' + arg + '.');

        process.setuid(next);
        i += 1;

        break;
      }

      case '-g':
      case '--group': {
        if (!next || next[0] === '-')
          throw new Error('Invalid option for: ' + arg + '.');

        process.setgid(next);
        i += 1;

        break;
      }

      case '-l':
      case '--license': {
        options.license = true;
        break;
      }

      default: {
        if (!arg || arg[0] === '-')
          throw new Error('Invalid prefix.');

        options.prefix = arg;

        break;
      }
    }
  }

  if (!options.prefix)
    throw new Error('No prefix provided.');

  return options;
}

function main() {
  var options;

  try {
    options = parseArgs();
  } catch (e) {
    console.error(e.message + '\n');
    process.exit(1);
  }

  var PREFIX = resolve(options.prefix);
  var NODE_MODULES = resolve(PREFIX, 'lib', 'node_modules');
  var BIN = resolve(PREFIX, 'bin');
  var MAN = resolve(PREFIX, 'share', 'man');
  var LICENSES = resolve(PREFIX, 'share', 'licenses');

  process.chdir(CWD);

  if (!fs.existsSync(PKG)) {
    console.error('Error: wrong directory for %s install!', NAME);
    process.exit(1);
  }

  console.log('Installing %s@%s...', NAME, VERSION);
  console.log('');

  mkdirp(PREFIX);
  mkdirp(NODE_MODULES);
  mkdirp(BIN);
  mkdirp(MAN);

  if (options.license)
    mkdirp(LICENSES);

  console.log('  %s -> %s', NAME, relative(CWD, resolve(NODE_MODULES, NAME)));
  console.log('');

  copy(NAME, resolve(NODE_MODULES, NAME));

  console.log('Linking %s@%s...', NAME, VERSION);
  console.log('');

  var replace = function(path) {
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
          throw new Error('Invalid path: "' + path + '"');
      }
    });
  };

  for (var i = 0; i < LINKS.length; i++) {
    var link = LINKS[i];
    var type = link[0];
    var from = link[1];
    var to = link[2];
    var src = normalize(replace(from));
    var dest = normalize(replace(to));

    if (type === 'license' && !options.license)
      continue;

    console.log('  %s -> %s', relative(CWD, dest), relative(CWD, src));

    if (type !== 'bin')
      mkdirp(dirname(dest));

    symlink(src, dest);
  }

  console.log('');
  console.log('%s@%s successfully installed!', NAME, VERSION);
  process.exit(0);
}

/*
 * Helpers
 */

function getArgs(argv) {
  if (!argv || typeof argv.length !== 'number')
    throw new TypeError('"argv" must be an array.');

  var args = [];

  for (var i = 0; i < argv.length; i++) {
    var arg = argv[i];

    if (typeof arg !== 'string')
      throw new TypeError('"arg" must be a string.');

    if (arg.startsWith('--')) {
      // e.g. --opt
      var index = arg.indexOf('=');
      if (index !== -1) {
        // e.g. --opt=val
        args.push(arg.substring(0, index));
        args.push(arg.substring(index + 1));
      } else {
        args.push(arg);
      }
    } else if (arg.startsWith('-')) {
      if (arg.length > 2) {
        // e.g. -abc
        for (var j = 1; j < arg.length; j++)
          args.push(`-${arg.charAt(j)}`);
      } else {
        // e.g. -a
        args.push(arg);
      }
    } else {
      // e.g. foo
      args.push(arg);
    }
  }

  return args;
}

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

  var paths = [];
  var dir = resolve(path);

  for (;;) {
    paths.push(dir);

    var next = resolve(dir, '..');

    if (next === dir)
      break;

    dir = next;
  }

  paths.reverse();

  for (var i = 0; i < paths.length; i++) {
    path = paths[i];
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

function traverse(path, cb) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  if (typeof cb !== 'function')
    throw new TypeError('"cb" must be a function.');

  var root = resolve(path);

  (function next(path) {
    var stat = fs.lstatSync(path);
    var file = relative(root, path);

    if (stat.isDirectory()) {
      cb(file, stat);

      var list = fs.readdirSync(path);

      for (var i = 0; i < list.length; i++) {
        var name = list[i];
        next(join(path, name), cb);
      }

      return;
    }

    if (stat.isFile() || stat.isSymbolicLink())
      cb(file, stat);
  })(root);
}

function copy(from, to) {
  if (typeof from !== 'string')
    throw new TypeError('"from" must be a path.');

  if (typeof to !== 'string')
    throw new TypeError('"to" must be a path.');

  from = resolve(from);
  to = resolve(to);

  traverse(from, function(file, stat) {
    var src = resolve(from, file);
    var dest = resolve(to, file);

    if (stat.isDirectory()) {
      if (!isDirectory(dest))
        fs.mkdirSync(dest, stat.mode);
      return;
    }

    if (stat.isSymbolicLink()) {
      var link = fs.readlinkSync(src);

      if (isAbsolute(link))
        link = relative(from, link);

      if (fs.existsSync(dest))
        fs.unlinkSync(dest);

      fs.symlinkSync(link, dest);

      return;
    }

    if (fs.copyFileSync) {
      fs.copyFileSync(src, dest, 0);
      return;
    }

    var slab = Buffer.allocUnsafe
      ? Buffer.allocUnsafe(64 * 1024)
      : new Buffer(64 * 1024);

    var rfd = null;
    var st = null;
    var wfd = null;
    var pos = 0;

    try {
      rfd = fs.openSync(src, 'r');
      st = fs.fstatSync(rfd);
      wfd = fs.openSync(dest, 'w', st.mode);

      while (pos < st.size) {
        var length = Math.min(st.size - pos, slab.length);
        var bytes = fs.readSync(rfd, slab, 0, length, pos);

        if (bytes !== length)
          throw new Error('I/O error (readSync).');

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
  });
}

/*
 * Execute
 */

main();
