/*!
 * reserved.js - reserved words for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');

/*
 * Reserved
 */

const reserved = new Set([
  /**
   * Reserved words
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#reserved_words
   *
   * These keywords cannot be used as identifiers for variables, functions,
   * classes, etc. anywhere in JavaScript source.
   */

  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',

  // The following are only reserved when they are found in strict mode code:
  'let', // (also reserved in const, let, and class declarations)
  'static',
  'yield', // (also reserved in generator function bodies)

  // The following are only reserved when they are found in module code or
  // async function bodies:
  'await',

  /**
   * Future reserved words
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#future_reserved_words
   *
   * The following are reserved as future keywords by the ECMAScript
   * specification.  They have no special functionality at present, but they
   * might at some future time, so they cannot be used as identifiers.
   */

  // These are always reserved:
  'enum',

  // The following are only reserved when they are found in strict mode code:
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',

  /**
   * Future reserved words in older standards
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#future_reserved_words_in_older_standards
   *
   * The following are reserved as future keywords by older ECMAScript
   * specifications (ECMAScript 1 till 3).
   */

  'abstract',
  'boolean',
  'byte',
  'char',
  'double',
  'final',
  'float',
  'goto',
  'int',
  'long',
  'native',
  'short',
  'synchronized',
  'throws',
  'transient',
  'volatile',

  /**
   * Identifiers with special meanings
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#identifiers_with_special_meanings
   *
   * A few identifiers have a special meaning in some contexts without being
   * reserved words of any kind.
   */

  // 'arguments', // (cannot be declared as identifier in strict mode)
  // 'as', // (import * as ns from "mod")
  // 'async',
  // 'eval', // (cannot be declared as identifier in strict mode)
  // 'from', // (import x from "mod")
  // 'get',
  // 'of',
  // 'set'

  'arguments',
  'async',
  'eval'
]);

/*
 * Helpers
 */

function isIdentifer(key) {
  assert(typeof key === 'string');

  if (!/^[$A-Za-z_][$\w]*$/.test(key))
    return false;

  return !reserved.has(key);
}

/*
 * Expose
 */

exports.isIdentifer = isIdentifer;
