# bpkg

Bundler and build tool for node.js. Similar to browserify, with a focus on
node.js.

Bpkg is a small auditable tool requiring zero external dependencies while still
including nearly full browserify functionality.

## Usage

```
$ bpkg -h

  Usage: bpkg [options] [file]

  Options:

    -v, --version           output the version number
    -e, --env <name>        set environment, node or browser (default: node)
    -n, --node              set environment to node
    -b, --browser           set environment to browser
    --extensions <a,b,..>   list of extensions (default: .js,.mjs,.json,.node)
    -f, --browser-field     force usage of package.json "browser" field
    -i, --ignore-missing    ignore missing modules during compilation
    -c, --collect-bindings  include bindings separately
    -x, --exclude-source    exclude c++ source in multi mode
    -l, --no-license        do not place licenses at the top of the bundle
    -m, --multi             output module as multiple files
    -s, --single            build a single file without transpiling modules
    -u, --minify            minify bundle or files (using uglify-es)
    --exports               expose on module.exports for browser bundles
    --global                expose globally for browser bundles
    --name <name>           name to use for global exposure (default: pkg.name)
    -p, --plugins <a,b,..>  comma separated list of plugins
    -t, --tmp <path>        path to temporary directory (default: os.tmpdir())
    -o, --output <file>     output file or directory (default: stdout)
    -h, --help              output usage information
```

## Features

- Node.js native module support for bundles
- Full browser support
- ES modules
- Uglify-ES support included

## Examples

### Bundle Mode

To compile a node.js module (including all of it's native bindings) to a single
file:

``` bash
$ bpkg ./bcrypto bcrypto.js
$ wc -l bcrypto.js
75543 bcrypto.js
```

The native modules will be encoded as base64 strings in the javascript file and
opened with `process.dlopen` when required.

To included native modules as separate files:

``` bash
$ bpkg --collect-bindings ./bcrypto bcrypto
$ ls bcrypto/
./  ../  bindings/  index.js
$ ls bcrypto/bindings/
./  ../  bcrypto.node*
```

### Multi-file Mode

To package all files in a dependency tree into a nice neat tarball:

``` bash
$ bpkg --multi --collect-bindings --output=bcrypto.tar.gz ./bcrypto
$ tar -tzf bcrypto.tar.gz
bcrypto/
bcrypto/LICENSE
bcrypto/build/
bcrypto/build/Release/
bcrypto/build/Release/bcrypto.node
bcrypto/binding.gyp
bcrypto/lib/
bcrypto/lib/aead-browser.js
bcrypto/lib/aead.js
...
```

The above will _flatten_ the dependency tree into one node_modules directory
below `bcrypto`. Only what is needed to run the library will be included
(READMEs, for example, are excluded). With the --collect-bindings option, all
native bindings will be built and included in the tarball.

This is extremely useful for packaging your project for something _other_ than
NPM (an OS package manager, for example).

### Browser Bundles

Browser bundles are basically browserify.

``` bash
$ bpkg --browser ./bcrypto bcrypto.js
$ wc -l bcrypto.js
51910 bcrypto.js
```

To expose on module.exports:

``` bash
$ bpkg --browser --exports ./bcrypto bcrypto.js
```

To expose globally:

``` bash
$ bpkg --browser --global --name=bcrypto ./bcrypto bcrypto.js
```

## Plugins

Unfortunately, bpkg is not compatible with any existing plugins.
However, it presents a very simple plugin API:

``` bash
$ bpkg --plugins ./my-plugin . bundle.js
```

./my-plugin.js:

``` js
'use strict';

class MyPlugin {
  constructor(bundle, options) {
    bundle.src; // Source entry point.
    bundle.dest; // Output file/directory.
    bundle.root; // Main package root.
    bundle.resolve; // Module resolver (async)
  }

  // Called when code is first loaded
  // (before doing anything else). A
  // good place for another language
  // compiler to hook into (typescript,
  // for example).
  async compile(module, code) {
    module.path; // Filename path.
    module.root; // Package root.
    module.resolve; // Module resolver (async).
    return code;
  }

  // Called post-compilation and
  // after default transformation.
  async transform(module, code) {
    return code;
  }

  // Called once the bundle is fully
  // created (good place for a minifier,
  // for example).
  async final(code) {
    return code;
  }
}

module.exports = async (bundler, options) => {
  return new MyPlugin(bundler, options);
};
```

Passing options can be done directly through the JS api for now:

./build.js:

``` js
const {Bundler} = require('bpkg');

const bundler = new Bundler({
  extensions: ['.js', '.mjs'],
  plugins: [require('./my-plugin'), {
    foo: 1,
    bar: 2
  }]
});

bundler.bundle('.', 'bundle.js');
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2018, Christopher Jeffrey (MIT License).

See LICENSE for more info.
