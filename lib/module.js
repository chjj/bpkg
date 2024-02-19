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
  dot,
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
    this.analyzing = false;
    this.analyzed = false;
    this.opening = false;
    this.opened = false;
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

  async open() {
    this.opening = true;
    this.code = await this.compile();
    this.opened = true;
    return this;
  }

  async tryResolve(specifier, isImport) {
    assert(typeof specifier === 'string');
    assert(typeof isImport === 'boolean');

    try {
      return await this.resolver.resolve(specifier, isImport);
    } catch (e) {
      if (this.bundle.ignoreMissing && e.code === 'MODULE_NOT_FOUND')
        return null;

      if (this.resolver.isExternal(specifier, isImport))
        return null;

      throw e;
    }
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

    let last = null;

    await (async function next(node, override) {
      const type = override || node.type;
      const isNew = ancestors.length === 0 ||
                    node !== ancestors[ancestors.length - 1];

      assert(isNew === (last !== node));

      last = node;

      // Note: acorn checks that `override`
      // is falsey during the full walk.
      if (isNew) {
        const result = await filter(node, ancestors, override);

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

    const results = [];

    await this.walk(root, async (node, ancestors, override) => {
      const visitor = visitors[node.type];

      if (!visitor)
        return true;

      const result = await visitor.call(ctx, node, code, ancestors, override);

      if (result == null)
        return true;

      assert(Array.isArray(result) && result.length === 2);
      assert(result[0] && typeof result[0] === 'object');
      assert(typeof result[1] === 'string');

      results.push(result);

      return false;
    });

    if (results.length === 0)
      return code;

    let out = '';
    let offset = 0;

    results.sort(([x], [y]) => {
      return x.start - y.start;
    });

    for (const [{start, end}, value] of results) {
      assert(offset <= start);

      out += code.substring(offset, start);
      out += value;

      offset = end;
    }

    out += code.substring(offset);

    return out;
  }

  async makeJSON() {
    const path = this.filename;
    const json = await fs.readJSON(path);

    if (basename(path) === 'package.json')
      cleanPackage(json);

    return `module.exports = ${stringify(json, 2)};\n`;
  }

  async makeOpen() {
    const path = this.filename;
    const name = basename(path);
    const raw = await fs.readFile(path);

    return '__node_dlopen__(module, '
         + `${string(name)}, `
         + `${base64(raw)});`
         + '\n';
  }

  async _readWasm() {
    const source = await fs.readFile(this.filename);
    const compiled = await WebAssembly.compile(source);
    const imports = WebAssembly.Module.imports(compiled);
    const exports = WebAssembly.Module.exports(compiled);

    return {
      source,
      compiled,
      imports,
      exports
    };
  }

  async readWasm() {
    const cache = this.bundle.codeCache;
    const path = this.filename;

    if (!cache.has(path))
      cache.set(path, await this._readWasm());

    return cache.get(path);
  }

  async analyzeWasm() {
    const result = await this.readWasm();

    for (const {module} of result.imports)
      await this.esm.analyzeModule(module);

    for (const {name} of result.exports) {
      this.esm.exports.add(name);
      this.esm.constExports.add(name);
    }

    return result;
  }

  async makeWasm() {
    const name = basename(this.filename);
    const {source, imports} = await this.readWasm();
    const target = this.bundle.isAsync ? 'async' : 'sync';

    let code = 'var imports = { __proto__: null };\n';

    if (imports.length > 0) {
      const modules = new Set(imports.map(x => x.module));

      code += '\n';

      for (const specifier of modules) {
        const call = await this.linker.require(specifier, 1);

        code += `imports${dot(specifier)} = ${call};\n`;
      }
    }

    this.bundle.hasWasm = true;

    code += '\n';
    code += '__module.exports = ';

    if (target === 'async')
      code += 'await ';

    code += `__wasm_compile_${target}__(`;
    code += string(name) + ', ';
    code += base64(source) + ', ';
    code += 'imports';
    code += ');\n';

    return code;
  }

  async _readCode() {
    this.sourceType(); // Fail early.

    let code = await fs.readFile(this.filename, 'utf8');
    let hash;

    [code, hash] = prepareCode(code);
    code = await this.bundle.compile(this, code);

    const root = this.parse(code);

    return [root, code, hash];
  }

  async readCode() {
    const cache = this.bundle.codeCache;
    const path = this.filename;

    if (!cache.has(path))
      cache.set(path, await this._readCode());

    return cache.get(path);
  }

  async analyze() {
    this.analyzing = true;

    switch (this.format) {
      case 'addon': {
        break;
      }

      case 'builtin': {
        break;
      }

      case 'commonjs': {
        const [, code] = await this.readCode();
        this.esm.suspectedEsModule = code.includes('__esModule');
        break;
      }

      case 'json': {
        this.esm.exports.add('default');
        this.esm.constExports.add('default');
        break;
      }

      case 'module': {
        const [root] = await this.readCode();
        await this.esm.analyze(root);
        break;
      }

      case 'wasm': {
        await this.analyzeWasm();
        break;
      }

      default: {
        throw new Error('unreachable');
      }
    }

    this.analyzed = true;
  }

  async compile() {
    if (this.format === 'addon')
      return this.makeOpen();

    if (this.format === 'json')
      return this.makeJSON();

    if (this.format === 'wasm')
      return this.makeWasm();

    let [root, code, hash] = await this.readCode();

    this.hashbang = hash;

    code = await this.esm.transform(root, code);
    code = await this.linker.transform(code);
    code = await this.bundle.transform(this, code);

    return code;
  }

  wrap(code) {
    assert(typeof code === 'string');

    if (this.isModule()) {
      const prefix = this.bundle.isAsync ? 'async ' : '';

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

  isAsync() {
    return this.bundle.isAsync && this.isModule();
  }

  needsLexerFix() {
    return this.bundle.target !== 'esm'
        && this.bundle.env === 'node'
        && this.id === 0
        && this.isModule()
        && this.esm.exports.size > 0;
  }

  generateLexerFix() {
    // Make cjs-module-lexer happy.
    const {exports} = this.esm;
    const body = [];

    body.push(CJS_WRAPPER[0]);
    body.push('exports.__esModule = true;');

    for (const key of exports)
      body.push(`exports${dot(key)} = 0;`);

    body.push(CJS_WRAPPER[1]);

    return body.join('\n');
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

function prepareCode(text) {
  assert(typeof text === 'string');

  let [hash, code] = stripHashbang(stripBOM(text));

  code = code.replace(/\r\n/g, '\n');
  code = code.replace(/\r/g, '\n');

  return [code, hash];
}

/*
 * Expose
 */

module.exports = Module;
