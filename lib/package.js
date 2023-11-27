/*!
 * package.js - package object for node.js
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const cmake = require('./cmake');
const gyp = require('./gyp');
const traverse = require('./traverse');
const utils = require('./utils');

const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve
} = path;

const {
  cleanPackage,
  decodeVersion,
  stringify,
  wrapText
} = utils;

/**
 * Package
 */

class Package {
  constructor(bundle, root) {
    assert(bundle && typeof bundle === 'object');
    assert(typeof root === 'string');

    this.bundle = bundle;
    this.id = bundle.pkgID++;
    this.root = root;
    this.filename = resolve(root, 'package.json');
    this.json = null;
    this.name = basename(root);
    this.version = '0.0.0';
    this.description = null;
    this.author = null;
    this.homepage = null;
    this.license = null;
    this.main = null;
    this.deps = [];
    this.bin = [];
    this.man = [];
    this.install = null;
    this.engine = 0;
    this.licenseFile = null;
    this.licenseText = null;
    this.resolver = bundle.createResolver(this.root);
  }

  log(...args) {
    this.bundle.log(...args);
  }

  async init() {
    const {root} = this;
    const path = resolve(root, 'package.json');
    const json = await readJSON(path);
    const deps = [];
    const bin = [];
    const man = [];

    let install = null;
    let engine = 0;
    let licenseFile = null;
    let licenseText = null;

    if (json == null)
      return this;

    if (json == null || typeof json !== 'object')
      throw new Error(`Invalid package.json (${path}).`);

    if (json.name == null)
      json.name = this.name;

    if (!json.name || typeof json.name !== 'string')
      throw new Error(`Invalid package.name (${path}).`);

    if (json.version == null)
      json.version = '0.0.0';

    if (!json.version || typeof json.version !== 'string')
      throw new Error(`Invalid package.version (${path}).`);

    if (typeof json.description !== 'string')
      json.description = null;

    if (json.author && typeof json.author === 'object') {
      const {author} = json;

      if (typeof author.name === 'string'
          && typeof author.email === 'string') {
        json.author = `${author.name} <${author.email}>`;
      } else if (typeof author.name === 'string') {
        json.author = author.name;
      } else if (typeof author.email === 'string') {
        json.author = `<${author.email}>`;
      }
    }

    if (typeof json.author !== 'string')
      json.author = null;

    if (typeof json.homepage !== 'string')
      json.homepage = null;

    if (typeof json.license !== 'string')
      json.license = null;

    if (json.main == null)
      json.main = null;

    if (json.main != null && typeof json.main !== 'string')
      throw new Error(`Invalid package.main (${path}).`);

    for (const fieldName of ['dependencies',
                             'optionalDependencies',
                             'peerDependencies',
                             'devDependencies']) {
      const field = json[fieldName];

      if (!field || typeof field !== 'object')
        continue;

      for (const name of Object.keys(field)) {
        let version = field[name];

        if (typeof version !== 'string')
          throw new Error(`Invalid package version (${path}).`);

        if (version.length === 0)
          version = '*';

        let type = 'normal';

        switch (fieldName) {
          case 'optionalDependencies':
            type = 'optional';
            break;
          case 'peerDependencies':
            type = 'peer';
            break;
          case 'devDependencies':
            type = 'dev';
            break;
        }

        deps.push({
          name,
          type,
          version
        });
      }
    }

    if (json.bin && typeof json.bin === 'string') {
      json.bin = Object.create(null);
      json.bin[json.name] = json.bin;
    }

    if (json.bin && typeof json.bin === 'object') {
      for (const cmd of Object.keys(json.bin)) {
        if (cmd.length === 0)
          continue;

        const path = json.bin[cmd];

        if (path && typeof path === 'string')
          bin.push([cmd, path]);
      }
    }

    if (json.man && typeof json.man === 'string')
      json.man = [json.man];

    if (Array.isArray(json.man)) {
      for (const file of json.man) {
        if (typeof file !== 'string')
          continue;

        if (/.\.\d$/.test(file))
          man.push(file);
      }
    }

    if (json.scripts && typeof json.scripts === 'object') {
      const {scripts} = json;

      if (scripts.install && typeof scripts.install === 'string')
        install = scripts.install;
    }

    if (json.engines && typeof json.engines === 'object')
      engine = decodeVersion(json.engines.node);

    for (const name of (await fs.readdir(root))) {
      if (!/^(licen[cs]e|copying)/i.test(name))
        continue;

      const path = resolve(root, name);

      if (await isFile(path)) {
        licenseFile = name;
        licenseText = await fs.readFile(path, 'utf8');
        licenseText = wrapText(licenseText, 77);
        break;
      }
    }

    this.json = json;
    this.name = json.name;
    this.version = json.version;
    this.description = json.description;
    this.author = json.author;
    this.homepage = json.homepage;
    this.license = json.license;
    this.main = json.main;
    this.deps = deps;
    this.bin = bin;
    this.man = man;
    this.install = install;
    this.engine = engine;
    this.licenseFile = licenseFile;
    this.licenseText = licenseText;

    return this;
  }

  isBuiltin() {
    return resolve(this.root, '.') === resolve(__dirname, '..');
  }

  getLinks() {
    const links = [];

    for (const [cmd, path] of this.bin) {
      const from = join('$NODE_MODULES', this.name, path);
      const to = join('$BIN', cmd);

      links.push(['bin', from, to]);
    }

    for (const file of this.man) {
      const base = basename(file);
      const section = extname(file).substring(1);
      const from = join('$NODE_MODULES', this.name, file);
      const to = join('$MAN', `man${section}`, base);

      links.push(['man', from, to, 'man']);
    }

    if (this.licenseFile) {
      const from = join('$NODE_MODULES', this.name, this.licenseFile);
      const to = join('$LICENSES', this.name, 'LICENSE');

      links.push(['license', from, to]);
    }

    return links;
  }

  traverse(cb) {
    return traverse(this.root, cb);
  }

  async resolveModule(name) {
    assert(typeof name === 'string');

    try {
      return await this.resolver.directory(name);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        return null;
      throw e;
    }
  }

  async multify(dir) {
    assert(typeof dir === 'string');
    return this.copy(resolve(dir, this.name));
  }

  async copy(dest) {
    assert(typeof dest === 'string');

    if (await isDirectory(dest))
      await fs.rimraf(dest);

    return this._copy(dest, dest, false);
  }

  async _copy(root, dest, optional) {
    assert(typeof root === 'string');
    assert(typeof dest === 'string');
    assert(typeof optional === 'boolean');

    if (this.install)
      this.bundle.installs.push([this, dest, optional]);

    this.log('Copying package: %s@%s -> %s.',
             this.name, this.version, dest);

    await this._replicate(dest, optional);

    for (const dep of this.deps) {
      if (dep.type === 'dev')
        continue;

      const path = await this.resolveModule(dep.name);

      const pkg = path
        ? (await this.bundle.getPackage(path))
        : null;

      if (!pkg || !pkg.json) {
        if (this.bundle.ignoreMissing) {
          this.log('Warning: ignoring missing module: %s.', path);
          continue;
        }

        const err = new Error(`Cannot find module: '${dep.name}'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }

      let next = resolve(root, 'node_modules', pkg.name);

      if (await isDirectory(next)) {
        const file = resolve(next, 'package.json');
        const json = await fs.readJSON(file);

        if (json == null || typeof json !== 'object')
          throw new Error(`Invalid package.json: ${file}.`);

        // Already included same version in root.
        if (json.version === pkg.json.version)
          continue;

        // Delve deeper.
        next = resolve(dest, 'node_modules', pkg.name);

        if (await isDirectory(next))
          continue;
      }

      await pkg._copy(root, next, optional || dep.type === 'optional');
    }
  }

  async _replicate(dest, optional) {
    assert(typeof dest === 'string');
    assert(typeof optional === 'boolean');

    if (!await isDirectory(dest))
      await fs.mkdirp(dest);

    await this.traverse(async (file, stat) => {
      const name = basename(file);
      const ext = extname(file);
      const from = resolve(this.root, file);
      const to = resolve(dest, file);
      const fromDir = dirname(from);
      const toDir = dirname(to);

      if (stat.isSymbolicLink()) {
        if (!await isDirectory(toDir))
          await fs.mkdirp(toDir);

        const link = await fs.readlink(from);

        if (!isAbsolute(link))
          await fs.symlink(link, to);

        return;
      }

      if (this.bundle.collectBindings) {
        if (this.bundle.excludeSource) {
          switch (ext) {
            case '.c':
            case '.cc':
            case '.cpp':
            case '.h':
            case '.hh':
            case '.hpp':
            case '.s':
            case '.S':
              if (basename(fromDir) !== 'nan')
                return;
              break;
          }
        }

        if (name === 'package.json') {
          const buildFrom = resolve(fromDir, 'build');
          const buildTo = resolve(toDir, 'build');
          const gypFile = join(fromDir, 'binding.gyp');
          const cmakeFile = join(fromDir, 'CMakeLists.txt');

          let binding = null;

          if (await fs.exists(gypFile))
            binding = gyp;
          else if (await fs.exists(cmakeFile))
            binding = cmake;

          if (binding) {
            await binding.build(fromDir);

            await traverse(buildFrom, async (file, stat) => {
              if (!stat.isFile())
                return;

              if (extname(file) !== '.node')
                return;

              const from = resolve(buildFrom, file);
              const to = resolve(buildTo, file);
              const fromDir = dirname(from);
              const toDir = dirname(to);

              if (basename(fromDir) === 'obj.target')
                return;

              if (!await isDirectory(toDir))
                await fs.mkdirp(toDir);

              await fs.copyFile(from, to);
            });
          }
        }
      }

      if (!await isDirectory(toDir))
        await fs.mkdirp(toDir);

      if (name === 'package.json') {
        const json = await fs.readJSON(from);

        // Get rid of all the npm crap.
        if (cleanPackage(json)) {
          const out = stringify(json, 2);
          await fs.writeFile(to, out + '\n');
          return;
        }
      }

      await fs.copyFile(from, to);
    });
  }
}

/*
 * Helpers
 */

async function isFile(file) {
  const stat = await fs.statTry(file);

  return stat != null && stat.isFile();
}

async function isDirectory(file) {
  const stat = await fs.statTry(file);

  return stat != null && stat.isDirectory();
}

async function readJSON(file) {
  assert(typeof file === 'string');

  try {
    return await fs.readJSON(file);
  } catch (e) {
    if (e.code === 'ENOENT')
      return null;
    throw e;
  }
}

/*
 * Expose
 */

module.exports = Package;
