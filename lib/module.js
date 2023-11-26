/*!
 * module.js - module object for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const path = require('path');
const acorn = require('../vendor/acorn');
const ESM = require('./esm');
const Linker = require('./linker');
const Resolver = require('./resolver');
const utils = require('./utils');

const {
  basename,
  dirname,
  extname,
  relative,
  resolve
} = path;

const {
  base64,
  cleanPackage,
  string,
  stringify,
  stripBOM,
  stripHashbang,
  unix
} = utils;

/*
 * Constants
 */

const NODE_WRAPPER = [
  'function(exports, module, __filename, __dirname, __meta) {',
  '}'
];

const BROWSER_WRAPPER = [
  'function(exports, require, module, __filename, __dirname, __meta) {',
  '}'
];

/**
 * Module
 */

class Module {
  constructor(bundle, filename) {
    assert(bundle && typeof bundle === 'object');
    assert(typeof filename === 'string');

    this.bundle = bundle;
    this.id = bundle.moduleID++;
    this.filename = filename;
    this.dirname = dirname(filename);
    this.name = basename(filename);
    this.ext = extname(filename);
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.code = '';
    this.resolver = bundle.createResolver(filename);
    this.esm = null;
    this.linker = null;
    this.topLevelAwait = false;
  }

  log(...args) {
    this.bundle.log(...args);
  }

  warning(log, ...args) {
    this.log(`Warning (%s): ${log}`,
      relative(process.cwd(), this.filename),
      ...args);
  }

  get location() {
    return '/' + unix(relative(this.root, this.filename));
  }

  get path() {
    return this.filename;
  }

  async init() {
    this.root = await findRoot(this.dirname);
    this.pkg = await this.bundle.getPackage(this.root);
    this.esm = new ESM(this);
    this.linker = new Linker(this);
    return this;
  }

  async open(link) {
    this.code = await this.compile(link);
    return this;
  }

  sourceType() {
    if (this.filename.endsWith('.mjs'))
      return 'module';

    if (this.filename.endsWith('.cjs'))
      return 'script';

    if (this.pkg.json && this.pkg.json.type === 'module')
      return 'module';

    return 'script';
  }

  parse(code) {
    assert(typeof code === 'string');

    let type = this.sourceType();
    let root;

    try {
      root = parseCode(code, type, this.filename);
    } catch (e) {
      if (type === 'module')
        throw e;

      // Try again as a module.
      type = 'module';
      root = parseCode(code, type, this.filename);
    }

    return [type, root];
  }

  async walk(root, filter) {
    const base = acorn.walk.base;
    const ancestors = [];

    await (async function next(node, override) {
      const type = override || node.type;
      const isNew = ancestors.length === 0 ||
                    node !== ancestors[ancestors.length - 1];

      // Note: acorn checks that `override`
      // is falsey during the full walk.
      if (isNew) {
        const result = await filter(node, ancestors);

        if (result === false)
          return;
      }

      const children = [];

      base[type](node, null, (child, state, override) => {
        children.push([child, override]);
      });

      if (isNew)
        ancestors.push(node);

      for (const [child, override] of children)
        await next(child, override);

      if (isNew)
        ancestors.pop();
    })(root, null);
  }

  async replace(code, ctx, visitors) {
    const [type, root] = this.parse(code);

    assert(visitors);

    let out = '';
    let offset = 0;

    await this.walk(root, async (node, ancestors) => {
      const visitor = visitors[node.type];

      if (!visitor)
        return true;

      const result = await visitor.call(ctx, node, code, ancestors);

      if (result == null)
        return true;

      assert(Array.isArray(result) && result.length === 2);
      assert(result[0] && typeof result[0] === 'object');
      assert(typeof result[1] === 'string');

      const [{start, end}, value] = result;

      out += code.substring(offset, start);
      out += value;

      offset = end;

      return false;
    });

    out += code.substring(offset);

    return [type, out];
  }

  async makeJSON(path) {
    assert(typeof path === 'string');
    assert(!this.bundle.multi);

    const json = await fs.readJSON(path);

    if (basename(path) === 'package.json')
      cleanPackage(json);

    return `module.exports = ${stringify(json, 2)};\n`;
  }

  async makeOpen(path) {
    assert(typeof path === 'string');
    assert(!this.bundle.multi);

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${string(name)}, `
         + `${base64(raw)});`
         + '\n';
  }

  async analyze(code) {
    const [type, root] = this.parse(code);

    if (type !== 'module')
      return;

    await this.walk(root, (node, ancestors) => {
      if (node.type !== 'AwaitExpression')
        return;

      if (this.topLevelAwait)
        return;

      for (let i = ancestors.length - 1; i >= 0; i--) {
        const node = ancestors[i];

        switch (node.type) {
          case 'FunctionDeclaration':
          case 'FunctionExpression':
          case 'ArrowFunctionExpression':
          case 'MethodDefinition':
            return;
        }
      }

      if (this.bundle.target !== 'esm')
        throw new Error('Top-level await without ESM output.');

      this.topLevelAwait = true;
    });
  }

  async compile(link = true) {
    assert(typeof link === 'boolean');

    if (this.ext === '.json')
      return this.makeJSON(this.filename);

    if (this.ext === '.node')
      return this.makeOpen(this.filename);

    let code = await fs.readFile(this.filename, 'utf8');

    code = this.prepare(code);

    await this.analyze(code);

    code = await this.bundle.compile(this, code);
    code = await this.esm.transform(code);

    if (link)
      code = await this.linker.transform(code);

    code = await this.bundle.transform(this, code);

    return code;
  }

  prepare(text) {
    assert(typeof text === 'string');

    let [hashbang, code] = stripHashbang(stripBOM(text));

    if (!this.bundle.multi) {
      code = code.replace(/\r\n/g, '\n');
      code = code.replace(/\r/g, '\n');
    }

    this.hashbang = hashbang;

    return code;
  }

  wrap(code) {
    assert(typeof code === 'string');

    const wrapper = this.bundle.env === 'browser'
      ? BROWSER_WRAPPER
      : NODE_WRAPPER;

    const prefix = this.bundle.target === 'esm' ? 'async ' : '';

    return [
      prefix + wrapper[0],
      code.trim(),
      wrapper[1]
    ].join('\n');
  }

  static async findRoot(path) {
    return findRoot(path);
  }
}

/*
 * Helpers
 */

async function findRoot(path) {
  const root = await Resolver.findRoot(path);

  if (root == null)
    return resolve(path);

  return root;
}

function parseCode(code, type, filename) {
  assert(typeof code === 'string');
  assert(typeof type === 'string');
  assert(typeof filename === 'string');
  assert(type === 'script' || type === 'module');

  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: type,
      allowHashBang: false,
      allowReturnOutsideFunction: true
    });
  } catch (e) {
    e.message += ` (${filename})`;
    throw e;
  }
}

/*
 * Expose
 */

module.exports = Module;
