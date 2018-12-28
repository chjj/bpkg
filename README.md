# bpkg

Bundler and build tool for node.js. Similar to browserify, with a stronger
focus on node.js.

Bpkg is a small auditable tool requiring zero external dependencies while still
including nearly full browserify functionality.

## Usage

```
$ bpkg -h

  Usage: bpkg [options] [file]

  Options:

    -v, --version           output the version number
    -o, --output <file>     output file or directory (default: stdout)
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
    --tar <file>            path to tar
    -h, --help              output usage information
```

## Features

- No external dependencies
- Node.js native module support for bundles
- Full browser support
- ES modules
- Uglify-ES support included

## Why?

### Node.js Support

Very few bundlers have good node.js support. To demonstrate this, I know of no
simpler example than:

``` js
const binding = require('bindings')('my-module.node');
```

No existing bundler handles the above code properly out of the box! Why?
`bindings` is _the_ way to load native modules in node.js. It's a very common
pattern, yet nearly everything lacks support for it.

bpkg will _inline_ the native modules into a single JS file (or collect them
separately if so desired), and replace the `require('bindings')` calls
accordingly.

This is only one example. There are dozens of other instances of existing
compilers not playing well with node.js.

### Lack of bloat

Several compilers and bundlers have become very bloated over time.  bpkg
requires _zero external dependencies_. This is for security purposes and
auditability, as well as simplicity.

## Examples

### Bundle Mode

To compile a node.js module (including all of it's native bindings) to a single
file:

``` bash
$ bpkg ./node_modules/bcrypto bcrypto.js
$ wc -l bcrypto.js
75543 bcrypto.js
```

The native modules will be encoded as base64 strings in the javascript file and
opened with `process.dlopen` when required.

To included native modules as separate files:

``` bash
$ bpkg --collect-bindings ./node_modules/bcrypto bcrypto
$ ls bcrypto/
./  ../  bindings/  index.js
$ ls bcrypto/bindings/
./  ../  bcrypto.node*
```

### Multi-file Mode

To package all files in a dependency tree into a nice neat tarball:

``` bash
$ bpkg --multi --collect-bindings --output=bcrypto.tar.gz ./node_modules/bcrypto
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
$ bpkg --browser ./node_modules/bcrypto bcrypto.js
$ wc -l bcrypto.js
51910 bcrypto.js
```

To expose on module.exports:

``` bash
$ bpkg --browser --exports ./node_modules/bcrypto bcrypto.js
```

To expose globally:

``` bash
$ bpkg --browser --global --name=bcrypto ./node_modules/bcrypto bcrypto.js
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

const assert = require('assert');

class MyPlugin {
  constructor(bundle, options) {
    bundle.input; // Source entry point.
    bundle.output; // Output file/directory.
    bundle.root; // Main package root.
    bundle.resolve; // Module resolver (async)
  }

  // Called asynchronously
  // on initialization.
  async open() {
    return;
  }

  // Called when code is first loaded
  // (before doing anything else). A
  // good place for another language
  // compiler to hook into (typescript,
  // for example).
  async compile(module, code) {
    // `compile` is unique in that it
    // accepts and returns a Buffer object.
    assert(Buffer.isBuffer(code));
    module.path; // Filename path.
    module.root; // Package root.
    module.resolve; // Module resolver (async).
    return code;
  }

  // Called post-compilation and
  // after default transformation.
  async transform(module, code) {
    assert(typeof code === 'string');
    return code;
  }

  // Called once the bundle is fully
  // created (good place for a minifier,
  // for example).
  async final(code) {
    assert(typeof code === 'string');
    return code;
  }

  // Called once the bundle is built.
  // Cleanup logic goes here.
  async close() {
    return;
  }
}

module.exports = MyPlugin;
```

Passing options can be done directly through the JS api for now:

./build.js:

``` js
require('bpkg')({
  input: '.',
  output: 'bundle.js',
  extensions: ['.js', '.mjs'],
  plugins: [
    [require('./my-plugin'), {
      foo: 1,
      bar: 2
    }]
  ]
});
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2018, Christopher Jeffrey (MIT License).

See LICENSE for more info.
