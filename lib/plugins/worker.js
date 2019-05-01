/*!
 * worker.js - static worker plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const {isAbsolute} = require('path');
const {string} = require('../utils');

/**
 * Worker
 */

class Worker {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
  }

  async compile(module, code) {
    const ctx = new WorkerContext(module);
    return ctx.transform(code);
  }
}

/**
 * WorkerContext
 */

class WorkerContext {
  constructor(module) {
    this.bundle = module.bundle;
    this.module = module;
    this.resolve = module.resolve;
    this.filename = module.filename;
    this.dirname = module.dirname;
    this.location = null;
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
      CallExpression: this.CallExpression,
      ImportDeclaration: this.ImportDeclaration,
      NewExpression: this.NewExpression
    });

    return out;
  }

  isRequire(node, code) {
    // e.g.
    // require('bthreads/process')
    if (node.type !== 'CallExpression')
      return false;

    if (node.callee.type !== 'Identifier')
      return false;

    if (node.callee.name !== 'require')
      return false;

    if (node.arguments.length < 1)
      return false;

    const arg = node.arguments[0];

    if (arg.type !== 'Literal')
      return false;

    if (typeof arg.value !== 'string')
      return false;

    if (arg.value !== 'bthreads'
        && !arg.value.startsWith('bthreads/')) {
      return false;
    }

    return true;
  }

  isWorker(node) {
    // e.g. new threads.Thread('./file.js');
    if (node.type !== 'NewExpression')
      return false;

    const {callee} = node;
    const args = node.arguments;

    if (callee.type !== 'MemberExpression')
      return false;

    if (callee.object.type !== 'Identifier')
      return false;

    if (callee.object.name !== 'bthreads'
        && callee.object.name !== 'threads') {
      return false;
    }

    if (callee.object.name.split('/').length > 2)
      return false;

    if (callee.property.type !== 'Identifier')
      return false;

    const id = callee.property;

    if (id.name !== 'Thread' && id.name !== 'Pool')
      return false;

    if (args.length < 1)
      return false;

    const arg = args[0];

    if (arg.type !== 'Literal')
      return false;

    if (typeof arg.value !== 'string')
      return false;

    return true;
  }

  async CallExpression(node, code) {
    if (this.isRequire(node))
      this.location = node.arguments[0].value;

    return null;
  }

  async ImportDeclaration(node, code) {
    const source = node.source.value;

    if (node.source.type !== 'Literal'
        || typeof node.source.value !== 'string') {
      return null;
    }

    if (!source.startsWith('bthreads'))
      return null;

    if (source.split('/').length > 2)
      return null;

    this.location = source;

    return null;
  }

  async NewExpression(node, code) {
    if (this.isWorker(node)) {
      const [arg] = node.arguments;
      const location = arg.value;

      let path;
      try {
        path = await this.resolve(location);
      } catch (e) {
        this.warning('Missing worker: %s (%s)', e.message, location);
        return null;
      }

      if (!isAbsolute(path)) {
        this.warning('Non-absolute worker: %s (%s)', path, location);
        return null;
      }

      const id = await this.bundle.getID(path);

      if (this.location && !this.hasWorkers)
        this.bundle.requires.push(this.location);

      this.bundle.hasProcess = true;
      this.bundle.hasWorkers = true;

      return [arg, `'bthreads-worker@${id}' /* ${string(location)} */`];
    }

    return null;
  }
}

/*
 * Expose
 */

module.exports = Worker;
