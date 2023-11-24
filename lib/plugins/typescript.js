/*!
 * typescript.js - typescript plugin for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 *
 * Resources:
 *   https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API
 *   https://www.typescriptlang.org/docs/handbook/compiler-options.html
 *   https://github.com/Microsoft/TypeScript-Handbook/blob/master/pages/Compiler%20Options.md
 */

'use strict';

/**
 * TypeScript
 */

class TypeScript {
  constructor(bundle, options) {
    this.bundle = bundle;
    this.options = options;
    this.configs = new Map();
    this.ts = null;
  }

  async load() {
    this.bundle.addExtension(['.ts', '.tsx']);
  }

  async open() {
    this.ts = await this.bundle.resolver.require('typescript');
  }

  async compile(module, code) {
    const options = this.getOptions(module);

    if (!options)
      return code;

    const {outputText, diagnostics} = this.ts.transpileModule(code, options);

    if (diagnostics.length > 0) {
      const lines = diagnostics.map(diagnostic => diagnostic.messageText);
      const msg = lines.join('\n');

      throw new Error(msg);
    }

    return outputText;
  }

  async rewrite(module, path) {
    if (path.endsWith('.ts'))
      return path.slice(0, -3) + '.js';

    if (path.endsWith('.tsx'))
      return path.slice(0, -4) + '.js';

    return path;
  }

  getConfig(module) {
    const cache = this.configs.get(module.root);

    if (cache !== undefined)
      return cache;

    const path = this.ts.findConfigFile(module.root,
                                        this.ts.sys.fileExists,
                                        'tsconfig.json');

    if (!path) {
      this.configs.set(module.root, null);
      return null;
    }

    const config = this.ts.readConfigFile(path, this.ts.sys.readFile);

    if (config.error)
      throw config.error;

    this.configs.set(module.root, config);

    return config;
  }

  parseArgs(argv) {
    const {options, errors} =
      this.ts.parseCommandLine(argv, this.ts.sys.readFile);

    if (errors.length > 0) {
      const lines = errors.map(diagnostic => diagnostic.messageText);
      const msg = lines.join('\n');

      throw new Error(msg);
    }

    return options;
  }

  getOptions(module) {
    const opts = this.options.$
      ? this.parseArgs(this.options.$)
      : Object.assign({}, this.options);

    const config = this.getConfig(module);

    if (config)
      Object.assign(opts, config.compilerOptions);

    return {
      compilerOptions: Object.assign(opts, {
        allowJs: true,
        module: this.ts.ModuleKind.CommonJS,
        rootDir: undefined
      }),
      fileName: module.filename,
      reportDiagnostics: true
    };
  }
}

/*
 * Expose
 */

module.exports = TypeScript;
