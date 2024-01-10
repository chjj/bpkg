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

    return this.module.replace(code, this, {
      AwaitExpression: this.module.format === 'module'
                     ? this.AwaitExpression
                     : null,
      CallExpression: this.CallExpression
    });
  }

  _isReadFile(node, readFile, readJSON) {
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

    if (id.name === readFile) {
      if (args.length < 1 || args.length > 2)
        return false;

      if (args.length === 2) {
        let arg = args[1];

        if (arg.type === 'ObjectExpression') {
          if (arg.properties.length !== 1)
            return false;

          if (arg.properties[0].key.type !== 'Identifier')
            return false;

          if (arg.properties[0].key.name !== 'encoding')
            return false;

          arg = arg.properties[0].value;
        }

        if (arg.type !== 'Literal')
          return false;

        if (typeof arg.value !== 'string')
          return false;
      }

      return true;
    }

    if (id.name === readJSON) {
      if (args.length !== 1)
        return false;
      return true;
    }

    return false;
  }

  isReadFileSync(node) {
    return this._isReadFile(node, 'readFileSync', 'readJSONSync');
  }

  isReadFile(node) {
    return this._isReadFile(node, 'readFile', 'readJSON');
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

    if (method === 'readFile' || method === 'readFileSync') {
      if (args.length === 2) {
        if (args[1].type === 'ObjectExpression')
          encoding = args[1].properties[0].value.value;
        else
          encoding = args[1].value;
      }
    }

    this.log('Reading file: %s(%s)', method, expr);

    const file = this.evalExpression(expr);

    let data = null;

    if (method === 'readFile' || method === 'readFileSync')
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
      module: {
        filename: this.filename
      },
      __filename: this.filename,
      __dirname: this.dirname,
      __meta: {
        url: pathToFileURL(this.filename).href,
        filename: this.filename,
        dirname: this.dirname
      },
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
    expr = expr.replace(/import\.meta\.filename/g, '__meta.filename');
    expr = expr.replace(/import\.meta\.dirname/g, '__meta.dirname');

    return vm.runInNewContext(expr, sandbox, {
      filename: this.filename,
      displayErrors: true,
      timeout: 3000
    });
  }

  async AwaitExpression(node, code) {
    if (this.isReadFile(node.argument)) {
      const result = await this.tryRead(node.argument, code);

      if (result != null)
        return [node, result];
    }

    return null;
  }

  async CallExpression(node, code) {
    if (this.isReadFileSync(node)) {
      const result = await this.tryRead(node, code);

      if (result != null)
        return [node, result];
    }

    return null;
  }

  async tryRead(node, code) {
    let data = null;

    try {
      data = await this.readFile(node, code);
    } catch (e) {
      this.warning('readFile failed with: %s', e.message);
      return null;
    }

    if (typeof data === 'string')
      return multiline(data);

    if (Buffer.isBuffer(data)) {
      this.bundle.hasBuffer = true;
      return `Buffer.from(${base64(data)}, 'base64')`;
    }

    return JSON.stringify(data, null, 2);
  }
}

/*
 * Expose
 */

module.exports = FS;
