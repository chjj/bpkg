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
    this.resolver = module.resolver;
    this.filename = module.filename;
    this.dirname = module.dirname;
    this.threads = null;
  }

  log(...args) {
    this.module.log(...args);
  }

  warning(...args) {
    this.module.warning(...args);
  }

  async tryResolve(specifier, isImport) {
    try {
      return await this.resolver.resolve(specifier, isImport);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND')
        return null;
      throw e;
    }
  }

  async transform(code) {
    assert(typeof code === 'string');

    return this.module.replace(code, this, {
      CallExpression: this.CallExpression,
      ImportExpression: this.ImportExpression,
      ImportDeclaration: this.ImportDeclaration,
      NewExpression: this.NewExpression
    });
  }

  isRequire(node, code) {
    return this.module.linker.isRequire(node, code);
  }

  isImport(node, code) {
    return this.module.linker.isImportExpression(node, code);
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

    if (callee.object.name !== 'bthreads' &&
        callee.object.name !== 'threads') {
      return false;
    }

    if (callee.property.type !== 'Identifier')
      return false;

    const id = callee.property;

    if (id.name !== 'Thread' && id.name !== 'Pool')
      return false;

    if (args.length < 1)
      return false;

    const arg = args[0];

    if (arg.type === 'Identifier') {
      if (arg.name === '__filename')
        return true;
      return false;
    }

    if (arg.type === 'MemberExpression') {
      if (arg.property.type !== 'Identifier')
        return false;

      if (arg.object.type === 'MetaProperty')
        return arg.property.name === 'url';

      if (arg.object.type !== 'Identifier')
        return false;

      if (arg.object.name === 'global' ||
          arg.object.name === 'globalThis' ||
          arg.object.name === 'window' ||
          arg.object.name === 'self') {
        return arg.property.name === 'location';
      }

      if (arg.object.name !== 'bthreads' &&
          arg.object.name !== 'threads') {
        return false;
      }

      return arg.property.name === 'location'
          || arg.property.name === 'filename';
    }

    if (arg.type !== 'Literal')
      return false;

    if (typeof arg.value !== 'string')
      return false;

    if (!arg.value.includes('/'))
      return false;

    if (arg.value.includes('\r'))
      return false;

    if (arg.value.includes('\n'))
      return false;

    return true;
  }

  async CallExpression(node, code) {
    if (this.isRequire(node, code)) {
      const specifier = node.arguments[0].value;

      if (isThreads(specifier))
        this.threads = await this.tryResolve(specifier, false);
    }

    return null;
  }

  async ImportExpression(node, code) {
    if (!this.isImportExpression(node, code))
      return null;

    const specifier = node.source.value;

    if (isThreads(specifier))
      this.threads = await this.tryResolve(specifier, true);

    return null;
  }

  async ImportDeclaration(node, code) {
    if (node.source.type !== 'Literal' ||
        typeof node.source.value !== 'string') {
      return null;
    }

    const specifier = node.source.value;

    if (isThreads(specifier))
      this.threads = await this.tryResolve(specifier, true);

    return null;
  }

  async NewExpression(node, code) {
    if (this.isWorker(node)) {
      const arg = node.arguments[0];

      const specifier = arg.type !== 'Literal'
        ? this.module.filename
        : arg.value;

      let path;

      try {
        path = await this.resolver.resolve(specifier);
      } catch (e) {
        this.warning('Missing worker: %s (%s)', e.message, specifier);
        return null;
      }

      if (!isAbsolute(path)) {
        this.warning('Non-absolute worker: %s (%s)', path, specifier);
        return null;
      }

      const id = await this.bundle.getID(path);

      if (this.threads && !this.bundle.hasWorkers)
        this.bundle.requires.push(this.threads);

      this.bundle.hasProcess = true;
      this.bundle.hasWorkers = true;

      return [arg, `'bthreads-worker@${id}' /* ${string(specifier)} */`];
    }

    return null;
  }
}

/*
 * Helpers
 */

function isThreads(specifier) {
  assert(typeof specifier === 'string');

  if (specifier === 'bthreads')
    return true;

  if (!specifier.startsWith('bthreads/'))
    return false;

  const count = specifier.split('/').length - 1;

  if (count > 1)
    return false;

  return true;
}

/*
 * Expose
 */

module.exports = Worker;
