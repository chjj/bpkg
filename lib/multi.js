/*!
 * multi.js - package verifier and builder
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/pkg-verify
 */

'use strict';

const fs = require('fs');
const Path = require('path');
const os = require('os');
const cp = require('child_process');
const semver = require('../vendor/semver');

/*
 * Constants
 */

const cwd = process.cwd();

const fields = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies'
];

const PREFIX = Path.resolve(os.homedir(), '.pkg-verify');

const defaultIgnore = new Set([
  '.airtap.yml',
  '.babelrc',
  '.circleci',
  '.dntrc',
  '.editorconfig',
  '.eslintfiles',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.git',
  '.gitattributes',
  '.gitconfig',
  '.gitignore',
  '.jscsrc',
  '.jshintrc',
  '.npmignore',
  '.travis.yml',
  '.zuul.yml',
  'CHANGELOG',
  'CHANGELOG.md',
  'ChangeLog',
  'CONTRIBUTING.md',
  'float.patch',
  'GOVERNANCE.md',
  'History.md',
  'INSTALL',
  'NEWS',
  'README',
  'readme',
  'README.md',
  'readme.md',
  'TODO.md',
  'TODO',
  'bench',
  'browser',
  'build',
  'doc',
  'docs',
  'example',
  'examples',
  'jsdoc.json',
  'karma.conf.js',
  'Makefile',
  'migrate',
  'node_modules',
  'npm-debug.log',
  'package-lock.json',
  'package-lock.json.1909017369',
  'scripts', // XXX
  'snap',
  'test',
  'test.js',
  'tools',
  'webpack.app.js',
  'webpack.browser.js',
  'webpack.compat.js',
  'webpack.config.js',
  'yarn.lock'
]);

/**
 * Verifier
 */

class Verifier {
  constructor(options) {
    this.options = options || {};
    this.cache = Object.create(null);
    this.bindings = Object.create(null);
  }

  getPaths() {
    return Object.keys(this.cache);
  }

  getBindings() {
    return Object.keys(this.bindings);
  }

  debug(msg) {
    console.error(`pkg-verify: ${msg}`);
  }

  error(msg) {
    const err = new Error(msg);

    err.name = 'PackageVerifyError';
    err.type = 'PackageVerifyError';
    err.code = 'ERR_PKGVERIFY';

    if (Error.captureStackTrace)
      Error.captureStackTrace(err, this.error);

    throw err;
  }

  verify(name, dirname) {
    const moddir = resolve(name, dirname);

    if (!moddir) {
      this.error('Missing package.json!');
      return this;
    }

    this.debug(`Opening main package.json in ${moddir}.`);

    const pkg = read(moddir);

    if (pkg === -1) {
      this.error('Could not open package.json!');
      return this;
    }

    if (pkg === -2) {
      this.error('Malformed package.json!');
      return this;
    }

    if (pkg.name !== name) {
      this.error(`Package name mismatch: ${name} != ${pkg.name}.`);
      return this;
    }

    if (!pkg || typeof pkg !== 'object') {
      this.error('Missing package.json!');
      return this;
    }

    this.debug(`Opened package.json for ${pkg.name}.`);

    this.verifyPackage(pkg, moddir);

    return this;
  }

  verifyPackage(pkg, dirname) {
    if (this.cache[dirname])
      return;

    this.cache[dirname] = true;

    if (hasBinding(dirname))
      this.bindings[Path.basename(dirname)] = true;

    this.debug(`Verifying package ${pkg.name} at ${dirname}.`);

    for (const field of fields) {
      const deps = pkg[field];

      if (!deps)
        continue;

      if (typeof deps !== 'object') {
        this.error(`Invalid field in package.json: ${field}.`);
        continue;
      }

      this.verifyDeps(field, deps, dirname);
    }

    this.debug(`Package ${pkg.name} is valid!`);
  }

  verifyDeps(field, deps, dirname) {
    for (const name of Object.keys(deps)) {
      if (name.length === 0) {
        this.error(`Invalid name in ${field}.`);
        continue;
      }

      if (name[0] === '@')
        continue;

      if (name.indexOf('://') !== -1)
        continue;

      const expect = deps[name];

      if (typeof expect !== 'string') {
        this.error(`Invalid field in ${field}: ${name}.`);
        continue;
      }

      const moddir = resolve(name, dirname);

      if (!moddir) {
        if (field === 'optionalDependencies')
          this.debug(`Missing optional dependency: ${name}@${expect}.`);
        else
          this.error(`Missing dependency: ${name}@${expect}.`);
        continue;
      }

      this.debug(`Opening sub package.json in ${moddir}.`);

      const pkg = read(moddir);

      if (pkg === -1) {
        this.error(`Cannot access package.json: ${name}@${expect}.`);
        continue;
      }

      if (pkg === -2) {
        this.error(`Malformed package.json: ${name}@${expect}.`);
        continue;
      }

      if (!pkg || typeof pkg.version !== 'string') {
        this.error(`No version in package.json: ${name}@${expect}.`);
        continue;
      }

      const {version} = pkg;

      if (!semver.valid(version))
        this.error(`Invalid version for ${name}@${expect}: ${version}.`);
      else if (!semver.satisfies(version, expect))
        this.error(`Unmet dependency version ${name}@${expect}: ${version}.`);

      this.debug(`Valid version: ${name}@${version} satisfies ${expect}.`);

      this.verifyPackage(pkg, moddir);
    }
  }

  static build(path, tarball) {
    const name = Path.basename(path);
    const dirname = Path.dirname(path);
    const prefix = Path.resolve(PREFIX, name + '-' + Date.now().toString(16));
    const dest = Path.resolve(prefix, name);

    mkdirpSync(prefix);

    const v = new Verifier();

    v.verify(name, dirname);

    const paths = v.getPaths();
    const moddir = paths.shift();

    copyModule(moddir, dest);
    mkdirSync(Path.resolve(dest, 'node_modules'));

    for (const path of paths) {
      const modname = Path.basename(path);
      const newdest = Path.resolve(dest, 'node_modules', modname);

      copyModule(path, newdest);
    }

    writeBuild(v.getBindings(), dest);

    tarify(tarball, dest);
  }
}

/**
 * IgnoreList
 */

class IgnoreList {
  constructor() {
    this.map = new Set();
    this.globs = [];
  }

  read(dir) {
    this._read(dir, '.npmignore');
    this._read(dir, '.gitignore');
  }

  _read(dir, name) {
    const file = Path.resolve(dir, name);

    let text;

    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT')
        return this;

      throw e;
    }

    const lines = text.trim().split(/(\r\n|\r|\n)+/);

    for (const line of lines)
      this.add(line);

    return this;
  }

  add(line) {
    const rule = line.trim().replace(/^\/+|\/+$/g, '');

    if (rule.indexOf('*') !== -1) {
      let rx = line;

      // **
      rx = rx.replace(/\/\*\*\//g, '/?[^\\s\\S]*?/?');
      rx = rx.replace(/\*\*\//g, '[^\\s\\S]*?/?');
      rx = rx.replace(/\/\*\*/g, '/?[^\\s\\S]*?');
      rx = rx.replace(/\*\*/g, '[^\\s\\S]*?');

      // *
      rx = rx.replace(/\/\*/g, '/?[^/]*?');
      rx = rx.replace(/\*/g, '[^/]*');

      // escaping
      rx = rx.replace(/\./g, '\\.');

      this.globs.push(new RegExp('^' + rx + '$'));
    } else {
      if (rule.length > 0)
        this.map.add(rule);
    }

    return this;
  }

  has(name) {
    if (this.map.has(name))
      return true;

    for (const glob of this.globs) {
      if (glob.test(name))
        return true;
    }

    if (defaultIgnore.has(name))
      return true;

    return false;
  }
}

/*
 * Helpers
 */

const getModulePaths = (() => {
  const globalPaths = (() => {
    const windows = process.platform === 'win32';

    let home, prefix;
    if (windows) {
      home = process.env.USERPROFILE;
      prefix = Path.resolve(process.execPath, '..');
    } else {
      home = process.env.HOME;
      prefix = Path.resolve(process.execPath, '..', '..');
    }

    let paths = [Path.resolve(prefix, 'lib', 'node')];

    if (home) {
      paths.unshift(Path.resolve(home, '.node_libraries'));
      paths.unshift(Path.resolve(home, '.node_modules'));
    }

    const node = process.env['NODE_PATH'];

    if (node) {
      let parts = node.split(Path.delimiter);
      parts = parts.filter(p => Boolean(p));
      paths = parts.concat(paths);
    }

    return paths;
  })();

  const nmChars = [115, 101, 108, 117, 100, 111, 109, 95, 101, 100, 111, 110];
  const nmLen = 12;

  if (process.platform === 'win32') {
    return function getModulePaths(from) {
      from = Path.resolve(from);

      if (from.charCodeAt(from.length - 1) === 92 &&
          from.charCodeAt(from.length - 2) === 58)
        return [from + 'node_modules'].concat(globalPaths);

      const paths = [];

      let last = from.length;
      let p = 0;

      for (let i = from.length - 1; i >= 0; --i) {
        const code = from.charCodeAt(i);
        if (code === 92 || code === 47 || code === 58) {
          if (p !== nmLen)
            paths.push(from.slice(0, last) + '\\node_modules');
          last = i;
          p = 0;
        } else if (p !== -1) {
          if (nmChars[p] === code)
            p += 1;
          else
            p = -1;
        }
      }

      return paths.concat(globalPaths);
    };
  }

  return function getModulePaths(from) {
    from = Path.resolve(from);

    if (from === '/')
      return ['/node_modules'].concat(globalPaths);

    const paths = [];

    let last = from.length;
    let p = 0;

    for (let i = from.length - 1; i >= 0; --i) {
      const code = from.charCodeAt(i);
      if (code === 47) {
        if (p !== nmLen)
          paths.push(from.slice(0, last) + '/node_modules');
        last = i;
        p = 0;
      } else if (p !== -1) {
        if (nmChars[p] === code)
          p += 1;
        else
          p = -1;
      }
    }

    paths.push('/node_modules');

    return paths.concat(globalPaths);
  };
})();

function stat(filename) {
  let s;

  try {
    s = fs.statSync(filename);
  } catch (e) {
    return e.errno || -1;
  }

  return s.isDirectory() ? 1 : 0;
}

function resolve(name, dirname) {
  if (name.length > 0) {
    if (name[0] === '.' || name[0] === '/') {
      const base = Path.resolve(dirname, name);
      if (stat(base) < 0)
        return null;
      return base;
    }
  }

  const paths = getModulePaths(dirname);

  for (const path of paths) {
    if (stat(path) < 1)
      continue;

    const base = Path.resolve(path, name);

    if (stat(base) < 0)
      continue;

    return base;
  }

  return null;
}

function read(moddir) {
  const filename = Path.resolve(moddir, 'package.json');

  let data;
  try {
    data = fs.readFileSync(filename, 'utf8');
  } catch (e) {
    return -1;
  }

  try {
    return JSON.parse(data);
  } catch (e) {
    return -2;
  }
}

function hasBinding(moddir) {
  const filename = Path.resolve(moddir, 'binding.gyp');

  let stat;
  try {
    stat = fs.lstatSync(filename, 'utf8');
  } catch (e) {
    return false;
  }

  return stat.isFile();
}

function mkdirSync(dirname) {
  fs.mkdirSync(dirname, 0o755);
}

function mkdirpSync(dirname) {
  fs.mkdirSync(dirname, { recursive: true, mode: 0o755 });
}

function tarify(tarball, dir) {
  const name = Path.basename(dir);

  const args = [
    '-czf',
    Path.resolve(cwd, tarball),
    name
  ];

  const options = {
    stdio: 'inherit',
    cwd: Path.resolve(dir, '..')
  };

  console.log(`Creating tarball: ${tarball}.`);

  cp.execFileSync('tar', args, options);
}

function copyModule(src, dest) {
  const flags = fs.constants.COPYFILE_EXCL;
  const ignore = new IgnoreList();

  src = Path.resolve(cwd, src);

  ignore.read(src);

  console.log(`Copying module: ${Path.basename(src)}.`);

  copySync(src, dest, flags, (path) => {
    path = Path.relative(src, path);
    return !ignore.has(path);
  });
}

function copySync(src, dest, flags, filter) {
  if (typeof flags === 'function')
    [flags, filter] = [filter, flags];

  if (flags == null)
    flags = 0;

  if (filter == null)
    filter = (src, stat) => true;

  if (typeof src !== 'string')
    throw new TypeError('"src" must be a path.');

  if (typeof dest !== 'string')
    throw new TypeError('"dest" must be a path.');

  if ((flags >>> 0) !== flags)
    throw new TypeError('"flags" must be an integer.');

  if (typeof filter !== 'function')
    throw new TypeError('"filter" must be a function.');

  const overwrite = (flags & fs.constants.COPYFILE_EXCL) === 0;
  const sstat = fs.lstatSync(src);

  let dstat = null;

  try {
    dstat = fs.lstatSync(dest);
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  let ret = 0;

  if (!overwrite && dstat)
    throw new Error('Cannot overwrite file.');

  if (dstat
      && sstat.dev === dstat.dev
      && sstat.ino === dstat.ino
      && sstat.rdev === dstat.rdev) {
    throw new Error('Cannot copy file into itself.');
  }

  if (!filter(src, sstat))
    return ret + 1;

  if (sstat.isDirectory()) {
    const list = fs.readdirSync(src);

    if (dstat) {
      if (!dstat.isDirectory())
        throw new Error('Directory already exists.');
    } else {
      fs.mkdirSync(dest, sstat.mode);
    }

    for (const name of list) {
      ret += copySync(Path.join(src, name),
                      Path.join(dest, name),
                      flags,
                      filter);
    }

    return ret;
  }

  if (sstat.isSymbolicLink()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new Error('Cannot symlink over existing symlink.');
      }

      fs.unlinkSync(dest);
    }

    fs.symlinkSync(dest, fs.readlinkSync(src));

    return ret;
  }

  if (sstat.isFile()) {
    if (dstat) {
      if (!dstat.isFIFO()
          && !dstat.isFile()
          && !dstat.isSocket()
          && !dstat.isSymbolicLink()) {
        throw new Error('Cannot overwrite file.');
      }

      if (!dstat.isFile())
        fs.unlinkSync(dest);
    }

    fs.copyFileSync(src, dest, flags);

    return ret;
  }

  return ret + 1;
}

function createBuild(modules, dir) {
  const name = Path.basename(dir);

  let str = '';

  str += '#!/bin/bash\n';
  str += '\n';
  str += 'set -ex\n';
  str += '\n';
  str += 'if test ! -e build.sh || test ! -e package.json; then\n';
  str += '  echo "Wrong directory for build!" >& 2\n';
  str += '  exit 1\n';
  str += 'fi\n';

  for (const mod of modules) {
    str += '\n';

    if (mod === name) {
      str += 'if test -e binding.gyp; then\n';
      str += '  node-gyp rebuild\n';
      str += 'fi\n';
    } else {
      str += `if test -e node_modules/${mod}/binding.gyp; then\n`;
      str += `  pushd node_modules/${mod}\n`;
      str += '  node-gyp rebuild\n';
      str += '  popd\n';
      str += 'fi\n';
    }
  }

  return str;
}

function writeBuild(modules, dir) {
  const file = Path.resolve(dir, 'build.sh');
  const txt = createBuild(modules, dir);

  fs.writeFileSync(file, txt, {
    encoding: 'utf8',
    mode: 0o755
  });
}

/*
 * Expose
 */

module.exports = Verifier;
