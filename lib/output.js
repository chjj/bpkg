/*!
 * output.js - output file for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const os = require('os');
const path = require('path');
const tar = require('../vendor/tar');

const {
  basename,
  dirname,
  resolve
} = path;

/*
 * Constants
 */

const PREFIX = resolve(os.homedir(), '.bpkg');

/**
 * OutputFile
 */

class OutputFile {
  constructor(file, name, version) {
    assert(file == null || typeof file === 'string');
    assert(name == null || typeof name === 'string');
    assert(version == null || typeof version === 'string');

    this.file = file || null;
    this.name = name || null;
    this.version = version || null;
    this.tarball = null;

    if (file)
      this.init();
  }

  init() {
    let base = basename(this.file);

    // Expand variables.
    if (this.name || this.version) {
      base = base.replace(/\{\}/, '%f');
      base = base.replace(/%f/, '%n-%v');
    }

    if (this.name)
      base = base.replace(/%n/, () => this.name);

    if (this.version)
      base = base.replace(/%v/, () => this.version);

    this.file = resolve(dirname(this.file), base);
  }

  async open() {
    if (!this.file)
      return;

    const parent = dirname(this.file);

    if (!await fs.exists(parent))
      await fs.mkdirp(parent);

    const isTarball = this.file.endsWith('.tar')
                   || this.file.endsWith('.tar.gz');

    if (isTarball) {
      const base = basename(this.file);
      const tmp = resolve(PREFIX, `${Date.now()}-${base}`);
      const wrapper = base.replace(/\.tar(?:\.gz)?$/, '');

      this.tarball = this.file;
      this.file = resolve(tmp, wrapper);

      await fs.mkdirp(this.file);
    }
  }

  async tarify(src, dest, time) {
    if (time == null)
      time = new Date();

    assert(typeof src === 'string');
    assert(typeof dest === 'string');
    assert(time instanceof Date);

    const options = {
      cwd: src,
      file: dest,
      gzip: dest.endsWith('.gz'),
      portable: true,
      mode: 0o644,
      follow: false,
      mtime: time,
      onwarn: (msg, data) => {}
    };

    const names = await fs.readdir(src);

    return new Promise((resolve, reject) => {
      const cb = (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      try {
        tar.create(options, names, cb);
      } catch (e) {
        reject(e);
      }
    });
  }

  async close() {
    if (this.tarball) {
      const tmp = resolve(this.file, '..');

      try {
        await this.tarify(tmp, this.tarball, this.time);
      } finally {
        assert(tmp.startsWith(PREFIX));
        await fs.rimraf(tmp);
      }

      this.file = this.tarball;
      this.tarball = null;
    }
  }
}

/*
 * Expose
 */

module.exports = OutputFile;
