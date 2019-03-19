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

    -v, --version            output the version number
    -o, --output <file>      output file or directory (default: stdout)
    -e, --env <name>         set environment, node or browser (default: node)
    -n, --node               set environment to node
    -b, --browser            set environment to browser
    -x, --extensions <ext>   list of extensions (default: .js,.mjs,.json,.node)
    -f, --browser-field      force usage of package.json "browser" field
    -i, --ignore-missing     ignore missing modules during compilation
    -c, --collect-bindings   include bindings separately
    -X, --exclude-source     exclude c++ source in multi mode
    -H, --no-header          do not place header at the top of the bundle
    -l, --no-license         do not place licenses at the top of the bundle
    -d, --date <date>        set date for build (good for deterministic builds)
    -m, --multi              output module as multiple files
    -C, --convert-esm        whether to convert ESM to CJS in multi mode
    -s, --standalone         append UMD initialization code to browser bundle
    -N, --name <name>        name to use for global exposure (default: pkg.name)
    -p, --plugin <plugin>    use plugin
    -r, --requires <a,b,..>  comma-separated list of requires
    -E, --environment <k=v>  key-value pairs for process.env
    -g, --globals <k=v>      key-value pairs for global
    -h, --help               output usage information
```

## Features

- No external dependencies
- Node.js native module support for bundles
- Full browser support
- ES modules
- Babel, TypeScript, and Uglify-JS support out of the box

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

The above will deduplicate and include the dependency tree in a `node_modules`
directory below `bcrypto`. With the --collect-bindings option, all native
bindings will be built and included in the tarball. The tarball will include a
`build` and `install` script for a completely NPM-less install (the scripts are
essentially `$ npm install` behavior).

This is extremely useful for packaging your project for something _other_ than
NPM (an OS package manager, for example).

### Browser Bundles

Browser bundles are basically browserify.

``` bash
$ bpkg --browser ./node_modules/bcrypto bcrypto.js
$ wc -l bcrypto.js
51910 bcrypto.js
```

To expose with UMD (use `--name` to specify AMD and global name):

``` bash
$ bpkg --browser --standalone --name=bcrypto ./node_modules/bcrypto bcrypto.js
```

#### Plugins & requires

Babel with `@babel/polyfill`:

``` bash
$ bpkg --plugin [ babel --presets [ @babel/env ] ] \
       --requires @babel/polyfill                  \
       --browser --standalone --name=bcrypto       \
       ./node_modules/bcrypto bcrypto.js
```

Babel with `@babel/plugin-transform-runtime`:

``` bash
$ bpkg --plugin [ babel                            \
         --presets [ @babel/env ]                  \
         --plugins [ @babel/transform-runtime ]    \
       ]                                           \
       --browser --standalone --name=bcrypto       \
       ./node_modules/bcrypto bcrypto.js
```

bpkg is smart enough to properly resolve the corejs and babel-runtime requires
that `@babel/plugin-transform-runtime` adds, so no need to add these to your
dependencies.

Uglify-JS:

``` bash
$ bpkg -bp [ uglify-js --toplevel ] ./bcrypto bcrypto.js
```

Uglify-ES:

``` bash
$ bpkg -bp [ uglify-es --toplevel ] ./bcrypto bcrypto.js
```

TypeScript:

``` bash
$ bpkg -bp typescript my-script.ts my-script.js
```

Babylonia:

``` bash
$ bpkg -sbp [ babylonia --targets 'last 2 versions' ] \
       ../bcrypto bcrypto.js
```

## Plugins

Unfortunately, bpkg is not compatible with any existing plugins.
However, it presents a very simple plugin API:

``` bash
$ bpkg --plugin ./my-plugin . bundle.js
$ bpkg --plugin [ ./my-plugin --foo=bar ] . bundle.js
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
    options; // Options passed from the commandline (or directly).
  }

  // Called before initialization.
  // The root package/module is not yet loaded.
  // Mostly for altering bundle options.
  async load() {
    // This is a good place to add extensions
    // for the module resolver. Example:
    // this.bundle.addExtension('.ts');
  }

  // Called asynchronously on initialization.
  async open(pkg) {
    // This is a good place to load some
    // modules. Modules will be resolved
    // relative to the package root.
    // Example:
    // this.ts = await this.bundle.require('typescript');
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
  async final(module, code) {
    assert(typeof code === 'string');
    return code;
  }

  // Rewrite location for module resolver.
  async redirect(location, from) {
    return location;
  }

  // Only called in multi mode, allows
  // you to "rewrite" the output filename.
  async rewrite(module, path) {
    // Example:
    // return path.replace(/\.ts$/, '.js');
    return path;
  }

  // Called once the bundle is built.
  // Cleanup logic goes here.
  async close(pkg) {
    return;
  }
}

module.exports = MyPlugin;
```

Passing options can be done directly through the JS api as well as the command
line:

./build.js:

``` js
require('bpkg')({
  env: 'browser',
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

## Browserify Transforms

A browserify compatibility plugin exists. It currently only supports browserify
transforms:

``` bash
$ bpkg -p [ browserify -t [ babelify ] ]
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

- Copyright (c) 2018, Christopher Jeffrey (MIT License).

See LICENSE for more info.
