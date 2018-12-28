#!/usr/bin/env node

/*!
 * __NAME__@__VERSION__ build
 * Bundled by bpkg on __TIME__
 */

/*
  global __MODULES__
  global __LINKS__
  global __ENGINE__
  global __ENCODED__
*/

'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const log = console.log.bind(console);
const error = console.error.bind(console);
const chdir = process.chdir.bind(process);
const exit = process.exit.bind(process);
const {version} = process;
const {basename, dirname, extname, join} = path;

/*
 * Constants
 */

const NAME = '__NAME__';
const VERSION = '__VERSION__';
const PKG = join(NAME, 'package.json');
const CWD = __dirname;

const MODULES = __MODULES__;

const LINKS = __LINKS__;

const ENGINE = __ENGINE__;
const ENCODED = __ENCODED__;

/*
 * Main
 */

function main() {
  chdir(CWD);

  if (!fs.existsSync(PKG)) {
    error(`Error: wrong directory for ${NAME} install!`);
    exit(1);
  }

  log(`Building ${NAME}@${VERSION}...`);
  log('');

// if __ENGINE__
  const parts = version.split(/[^\d]/);
  const num = (0
    + (parts[1] & 0xff) * 0x10000
    + (parts[2] & 0xff) * 0x00100
    + (parts[3] & 0xff) * 0x00001);

  if (num < ENGINE) {
    error(`Error: ${NAME} requires node@${ENCODED}!`);
    exit(1);
  }
// endif

// if __GYP__
  try {
    cp.execFileSync('node-gyp', ['--version'], {
      cwd: CWD,
      stdio: 'ignore'
    });
  } catch (e) {
    error('Error: node-gyp is not installed!');
    exit(1);
  }
// endif

  for (const [name, dir, install, optional] of MODULES) {
    log(`Building "${name}"...`);

    try {
      cp.execSync(install, {
        cwd: join(CWD, dir),
        stdio: 'inherit'
      });
    } catch (e) {
      if (!optional) {
        error(e.message + '\n');
        exit(1);
      }

      log(`Warning: build failed for optional dependency "${name}"!`);
      log('');

      continue;
    }

    // Cleanup.
    if (install.includes('node-gyp'))
      rimraf(join(CWD, dir, 'build'));

    log('');
  }

  log('');
  log(`${NAME}@${VERSION} successfully built!`);
  log('');
  log('If you are an OS package maintainer, you may now');
  log(`package the "${NAME}" directory in its entirety.`);
  log('Note that node.js packages typically reside in');
  log('/usr/lib/node_modules or /usr/local/lib/node_modules.');

  if (LINKS.length > 0) {
    log('');
    log('Here are some necessary symlinks:');
    log('');

    for (const [, from, to] of LINKS)
      log(`  ${to} -> ${from}`);

    log('');
  }

  exit(0);
}

/*
 * Helpers
 */

function rimraf(path) {
  if (typeof path !== 'string')
    throw new TypeError('"path" must be a path.');

  let stat = null;

  try {
    stat = fs.lstatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES')
      return;
    throw e;
  }

  if (stat.isDirectory()) {
    let list = null;

    try {
      list = fs.readdirSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES')
        return;
      throw e;
    }

    for (const name of list)
      rimraf(join(path, name));

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
    const dir = dirname(path);

    // Always delete obj.target.
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

/*
 * Execute
 */

main();
