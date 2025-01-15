'use strict';

const js = require('bslint-extra');

module.exports = [
  js.configs.recommended,
  js.configs.bcoin,
  {
    languageOptions: {
      globals: {
        ...js.globals.node
      },
      ecmaVersion: 'latest'
    }
  },
  {
    files: [
      'bin/bpkg',
      'etc/vendor',
      '**/*.js',
      '*.js'
    ],
    languageOptions: {
      sourceType: 'commonjs'
    }
  },
  {
    files: [
      'lib/templates/{browser,node}.js'
    ],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['test/{,**/}*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...js.globals.mocha,
        register: 'readable'
      }
    },
    rules: {
      'max-len': 'off',
      'prefer-arrow-callback': 'off'
    }
  }
];
