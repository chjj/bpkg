/*!
 * fs.js - static fs plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../../vendor/bfile');
const Module = require('module');
const path = require('path');
const url = require('url');
const vm = require('vm');
const utils = require('../utils');
const {URL, fileURLToPath, pathToFileURL} = url;
const {base64, multiline} = utils;

let {createRequire} = Module;

if (!createRequire)
  createRequire = Module.createRequireFromPath;

/**
 * FS
 */

class FS {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
  }

  async compile(module, code) {
    const ctx = new FSContext(module);
    return ctx.transform(code);
  }
}

/**
 * FSContext
 */

class FSContext {
  constructor(module) {
    this.bundle = module.bundle;
    this.module = module;
    this.filename = module.filename;
    this.dirname = module.dirname;
  }

  log(...args) {
    this.module.log(...args);
  }

  warning(...args) {
    this.module.warning(...args);
  }

  async transform(code) {
    assert(typeof code === 'string');

    const [, out] = await this.module.replace(code, this, {
      CallExpression: this.CallExpression
    });

    return out;
  }

  isReadFile(node) {
    if (node.type !== 'CallExpression')
      return false;

    const {callee} = node;
    const args = node.arguments;

    let id = null;

    if (callee.type === 'Identifier') {
      id = callee;
    } else if (callee.type === 'MemberExpression') {
      if (callee.object.type !== 'Identifier')
        return false;

      if (callee.object.name !== 'fs')
        return false;

      if (callee.property.type !== 'Identifier')
        return false;

      id = callee.property;
    }

    if (!id)
      return false;

    if (id.name === 'readFileSync') {
      if (args.length < 1 || args.length > 2)
        return false;

      if (args.length === 2) {
        const arg = args[1];

        if (arg.type !== 'Literal')
          return false;

        if (typeof arg.value !== 'string')
          return false;
      }

      return true;
    }

    if (id.name === 'readJSONSync') {
      if (args.length !== 1)
        return false;
      return true;
    }

    return false;
  }

  async readFile(node, code) {
    const {callee} = node;
    const args = node.arguments;
    const method = callee.type === 'MemberExpression'
                 ? callee.property.name
                 : callee.name;

    const arg = args[0];
    const expr = code.substring(arg.start, arg.end);

    let encoding = undefined;

    if (method === 'readFileSync') {
      if (args.length === 2)
        encoding = args[1].value;
    }

    this.log('Reading file: %s(%s)', method, expr);

    const file = this.evalExpression(expr);

    let data = null;

    if (method === 'readFileSync')
      data = await fs.readFile(file, encoding);
    else
      data = await fs.readJSON(file);

    return data;
  }

  evalExpression(expr) {
    const sandbox = {
      require: {
        resolve: createRequire(this.filename).resolve
      },
      __filename: this.filename,
      __dirname: this.dirname,
      __meta: { url: pathToFileURL(this.filename).href },
      url,
      URL,
      fileURLToPath,
      pathToFileURL,
      Path: path,
      path,
      basename: path.basename,
      dirname: path.dirname,
      extname: path.extname,
      join: path.join,
      parse: path.parse,
      resolve: path.resolve
    };

    // Hack.
    expr = expr.replace(/import\.meta\.url/g, '__meta.url');

    return vm.runInNewContext(expr, sandbox, {
      filename: this.filename,
      displayErrors: true,
      timeout: 3000
    });
  }

  async CallExpression(node, code) {
    if (this.isReadFile(node)) {
      let data = null;

      try {
        data = await this.readFile(node, code);
      } catch (e) {
        this.warning('readFile failed with: %s', e.message);
        return null;
      }

      if (typeof data === 'string')
        return [node, multiline(data)];

      if (Buffer.isBuffer(data)) {
        const isDeprecated = this.bundle.env === 'node'
                          && this.bundle.target === 'esm';

        const Buffer = isDeprecated
          ? 'require(\'buffer\').Buffer'
          : 'Buffer';

        return [node, `${Buffer}.from(${base64(data)}, 'base64')`];
      }

      return [node, JSON.stringify(data, null, 2)];
    }

    return null;
  }
}

/*
 * Expose
 */

module.exports = FS;
