#!/usr/bin/env node

/*!
 * __NAME__@__VERSION__ build
 * Bundled by bpkg on __TIME__
 */

/* eslint "no-var": "off" */
/* eslint "no-unused-vars": "off" */

/* global __MODULES__ */
/* global __LINKS__ */
/* global __ENGINE__ */
/* global __ENCODED__ */

'use strict';

var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var env = process.env;
var basename = path.basename;
var dirname = path.dirname;
var extname = path.extname;
var join = path.join;
var normalize = path.normalize;
var resolve = path.resolve;

/*
 * Constants
 */

var PREFIX = process.platform === 'win32'
  ? resolve(process.execPath, '..')
  : resolve(process.execPath, '..', '..');

var NAME = '__NAME__';
var VERSION = '__VERSION__';
var PKG = join(NAME, 'package.json');
var CWD = __dirname;

var MODULES = __MODULES__;

var LINKS = __LINKS__;

var ENGINE = __ENGINE__;
var ENCODED = __ENCODED__;

/*
 * Main
 */

function parseArgs() {
  var options = {
    shell: true
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
        console.log('  Usage: ./build [options]');
        console.log('');
        console.log('  Options:');
        console.log('');
        console.log('    -s, --shell <path>  path to shell');
        console.log('    -h, --help          output usage information');
        console.log('');
        process.exit(0);
        break;
      }

      case '-s':
      case '--shell': {
        if (!next || next[0] === '-')
          throw new Error('Invalid option for: ' + arg + '.');

        options.shell = next;
        i += 1;

        break;
      }

      default: {
        throw new Error('Invalid argument: ' + arg + '.');
      }
    }
  }

  return options;
}

function main() {
  var options;

  try {
    options = parseArgs();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  process.chdir(CWD);

  if (!fs.existsSync(PKG)) {
    console.error('Error: wrong directory for %s install!', NAME);
    process.exit(1);
  }

  console.log('Building %s@%s...', NAME, VERSION);
  console.log('');

// if __ENGINE__
  var parts = process.version.split(/[^\d]/);
  var version = (0
    + (parts[1] & 0xff) * 0x10000
    + (parts[2] & 0xff) * 0x00100
    + (parts[3] & 0xff) * 0x00001);

  if (version < ENGINE) {
    console.error('Error: %s requires node@%s!', NAME, ENCODED);
    process.exit(1);
  }
// endif

// if __GYP__
  try {
    cp.execFileSync('node-gyp', ['--version'], {
      cwd: CWD,
      stdio: 'ignore'
    });
  } catch (e) {
    console.error('Error: node-gyp is not installed!');
    process.exit(1);
  }
// endif

  for (var i = 0; i < MODULES.length; i++) {
    var mod = MODULES[i];
    var name = mod[0];
    var dir = mod[1];
    var install = mod[2];
    var optional = mod[3];

    console.log('Building "%s"...', name);
    console.log('');

    try {
// if __CMAKE__
      if (install.indexOf('cmake-node') !== -1) {
        var node = process.execPath || process.argv[0];
        var cmake = resolve(CWD, 'cmake-node', 'bin', 'cmake-node');

        cp.spawnSync(node, [cmake, 'rebuild', '-fp'], {
          cwd: resolve(CWD, dir),
          stdio: 'inherit'
        });

        continue;
      }
// endif

      cp.execSync(install, {
        cwd: resolve(CWD, dir),
        stdio: 'inherit',
        shell: options.shell
      });
    } catch (e) {
      if (!optional) {
        console.error(e.message);
        process.exit(1);
      }

      console.log('Warning: build failed for optional dependency "%s"!', name);
      console.log('');

      continue;
    }

// if __GYP__
    if (install.indexOf('node-gyp') !== -1)
      rimraf(resolve(CWD, dir, 'build'));
// endif

    console.log('');
  }

  console.log('%s@%s successfully built!', NAME, VERSION);
  console.log('');
  console.log('If you are an OS package maintainer, you may now');
  console.log('package the "%s" directory in its entirety.', NAME);
  console.log('Note that node.js packages typically reside in:');
  console.log('');

  if (process.platform === 'win32') {
    // Global paths:
    console.log('  - %PROGRAMFILES\\lib\\node');
    console.log('  - %PROGRAMFILES(X86)\\lib\\node');
    // NPM install paths:
    console.log('  - %APPDATA\\npm\\node_modules');
    console.log('');
    console.log('Current system paths:');
    console.log('');
    console.log('  - %s', resolve(PREFIX, 'lib', 'node'));
    if (env.APPDATA)
      console.log('  - %s', resolve(env.APPDATA, 'npm', 'node_modules'));
  } else {
    // Global paths:
    console.log('  - $PREFIX/lib/node');
    // NPM install paths:
    console.log('  - $PREFIX/lib/node_modules');
    console.log('');
    console.log('Current system paths:');
    console.log('');
    console.log('  - %s', resolve(PREFIX, 'lib', 'node'));
    console.log('  - %s', resolve(PREFIX, 'lib', 'node_modules'));
  }

  if (LINKS.length > 0) {
    console.log('');
    console.log('Here are some necessary symlinks:');
    console.log('');

    for (var j = 0; j < LINKS.length; j++) {
      var link = LINKS[j];
      var from = normalize(link[1]);
      var to = normalize(link[2]);

      console.log('  %s -> %s', to, from);
    }
  }

  console.log('');

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

// if __GYP__
function rimraf(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  var stat = null;

  try {
    stat = fs.lstatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return;
    throw e;
  }

  if (stat.isDirectory()) {
    var list = null;

    try {
      list = fs.readdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES')
        return;
      throw e;
    }

    for (var i = 0; i < list.length; i++) {
      var name = list[i];
      rimraf(join(path, name));
    }

    try {
      fs.rmdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOTEMPTY')
        return;
      throw e;
    }

    return;
  }

  if (extname(path) === '.node') {
    var dir = dirname(path);

    if (basename(dir) !== 'obj.target')
      return;
  }

  try {
    fs.unlinkSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return;
    throw e;
  }
}
// endif

/*
 * Execute
 */

main();
