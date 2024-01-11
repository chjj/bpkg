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

const CJS_WRAPPER = [
  'function(exports, require, module, __filename, __dirname) {',
  '}'
];

const ESM_WRAPPER = [
  'function(__exports, __meta, __module) {',
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
    this.format = null;
    this.root = null;
    this.pkg = null;
    this.hashbang = '';
    this.code = '';
    this.resolver = bundle.createResolver(filename);
    this.esm = null;
    this.linker = null;
  }

  log(...args) {
    this.bundle.log(...args);
  }

  warning(log, ...args) {
    this.log(`Warning (%s): ${log}`, this.relative, ...args);
  }

  get subpath() {
    return '/' + unix(relative(this.root, this.filename));
  }

  get path() {
    return this.filename;
  }

  get relative() {
    return relative(process.cwd(), this.filename);
  }

  async init() {
    this.root = await findRoot(this.dirname);
    this.pkg = await this.bundle.getPackage(this.root);
    this.format = await this.resolver.format(this.filename);
    this.esm = new ESM(this);
    this.linker = new Linker(this);
    return this;
  }

  async open(link) {
    this.code = await this.compile(link);
    return this;
  }

  sourceType() {
    switch (this.format) {
      case 'commonjs':
        return 'script';
      case 'module':
        return 'module';
      default:
        throw new Error(`Invalid format for sourceType: ${this.format}`);
    }
  }

  isModule() {
    return this.format === 'module'
        || this.format === 'wasm';
  }

  parse(code) {
    assert(typeof code === 'string');

    try {
      const type = this.sourceType();

      return acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: type,
        allowHashBang: false,
        allowReturnOutsideFunction: type === 'script'
        // Doesn't work the way we want it to.
        // allowAwaitOutsideFunction: type === 'module' &&
        //                            this.bundle.target === 'esm'
      });
    } catch (e) {
      e.message += ` (${this.relative})`;
      throw e;
    }
  }

  async walk(root, filter) {
    assert(root && typeof root.type === 'string');
    assert(typeof filter === 'function');

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
    const root = this.parse(code);
    return this._replace(root, code, ctx, visitors);
  }

  async _replace(root, code, ctx, visitors) {
    assert(root && root.type === 'Program');
    assert(typeof code === 'string');
    assert(visitors && typeof visitors === 'object');

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

    return out;
  }

  async makeJSON(path) {
    assert(typeof path === 'string');

    const json = await fs.readJSON(path);

    if (basename(path) === 'package.json')
      cleanPackage(json);

    return `module.exports = ${stringify(json, 2)};\n`;
  }

  async makeOpen(path) {
    assert(typeof path === 'string');

    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${string(name)}, `
         + `${base64(raw)});`
         + '\n';
  }

  async makeWasm(path, link) {
    assert(typeof path === 'string');
    assert(typeof link === 'boolean');

    const name = basename(path);
    const source = await fs.readFile(path);
    const compiled = await WebAssembly.compile(source);
    const imports = WebAssembly.Module.imports(compiled);
    const exports = WebAssembly.Module.exports(compiled);
    const target = this.bundle.target === 'esm' ? 'esm' : 'cjs';

    for (const {name} of exports)
      this.esm.exports.add(name);

    let code = 'var imports = { __proto__: null };\n';

    if (link && imports.length > 0) {
      const modules = new Set(imports.map(x => x.module));

      code += '\n';

      for (const specifier of modules) {
        const call = await this.linker.require(specifier, 1);

        code += `imports[${string(specifier)}] = ${call};\n`;
      }
    }

    this.bundle.hasWasm = true;

    if (this.bundle.env === 'browser' && this.bundle.target !== 'esm')
      this.bundle.hasBuffer = true;

    code += '\n';
    code += '__module.exports = ';

    if (this.bundle.target === 'esm')
      code += 'await ';

    code += `__${this.bundle.env}_compile_${target}__(`;
    code += string(name) + ', ';
    code += base64(source) + ', ';
    code += 'imports';
    code += ');\n';

    return code;
  }

  async compile(link = true) {
    assert(typeof link === 'boolean');

    if (this.format === 'json')
      return this.makeJSON(this.filename);

    if (this.format === 'addon')
      return this.makeOpen(this.filename);

    if (this.format === 'wasm')
      return this.makeWasm(this.filename, link);

    this.sourceType(); // Fail early.

    let code = await fs.readFile(this.filename, 'utf8');

    code = this.prepare(code);
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

    code = code.replace(/\r\n/g, '\n');
    code = code.replace(/\r/g, '\n');

    this.hashbang = hashbang;

    return code;
  }

  wrap(code) {
    assert(typeof code === 'string');

    if (this.isModule()) {
      const prefix = this.bundle.target === 'esm' ? 'async ' : '';

      return [
        prefix + ESM_WRAPPER[0],
        code.trim(),
        ESM_WRAPPER[1]
      ].join('\n');
    }

    return [
      CJS_WRAPPER[0],
      code.trim(),
      CJS_WRAPPER[1]
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

/*
 * Expose
 */

module.exports = Module;
