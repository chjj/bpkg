/*!
 * browserify.js - browserify plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const {StringDecoder} = require('string_decoder');

/**
 * Browserify
 */

class Browserify {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.transforms = normalize(options.t || options.transform);
  }

  async open(pkg) {
    if (!pkg.json || !pkg.json.browserify)
      return;

    const {transform} = pkg.json.browserify;

    this.transforms.push(...normalize(transform));
  }

  async _transform(module, code, transform, options) {
    assert(typeof code === 'string');
    assert(typeof transform === 'string'
        || typeof transform === 'function');
    assert(options && typeof options === 'object');

    if (typeof transform === 'string')
      transform = await this.bundle.require(transform);

    const stream = transform(module.filename, Object.assign({}, options));

    if (!stream || typeof stream.write !== 'function')
      throw new TypeError('Transform must return a stream.');

    return new Promise((resolve, reject) => {
      const decoder = new StringDecoder('utf8');

      let out = '';

      stream.on('data', (data) => {
        out += decoder.write(data);
      });

      stream.on('error', err => reject(err));
      stream.on('end', () => {
        out += decoder.end();
        resolve(out);
      });

      try {
        stream.write(code, 'utf8');
        stream.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  async compile(module, code) {
    for (const [transform, options] of this.transforms)
      code = await this._transform(module, code, transform, options);

    return code;
  }
}

/*
 * Helpers
 */

function normalize(transforms) {
  if (transforms == null)
    return [];

  if (typeof transforms === 'string'
      || typeof transforms === 'function') {
    transforms = [transforms];
  }

  if (!Array.isArray(transforms))
    throw new TypeError('Transforms must be an array.');

  const out = [];

  for (let item of transforms) {
    if (typeof item === 'string'
        || typeof item === 'function') {
      item = [item];
    }

    if (!Array.isArray(item))
      throw new TypeError('Transform must be an array.');

    let [transform, options] = item;

    if (typeof transform !== 'string'
        && typeof transform !== 'function') {
      throw new TypeError('Transform must be a string or function.');
    }

    if (options == null)
      options = Object.create(null);

    if (typeof options !== 'object')
      throw new TypeError('Transform options must be an object.');

    out.push([transform, options]);
  }

  return out;
}

/*
 * Expose
 */

module.exports = Browserify;
