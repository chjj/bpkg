/*!
 * utils.js - utils for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const path = require('path');
const {isIdentifer} = require('./reserved');

const {
  isAbsolute,
  parse
} = path;

/*
 * Constants
 */

const NPM_KEYS = new Set([
  '_from',
  '_id',
  '_inBundle',
  '_integrity',
  '_location',
  '_phantomChildren',
  '_requested',
  '_requiredBy',
  '_resolved',
  '_shasum',
  '_spec',
  '_where',
  '_args'
]);

/*
 * Utils
 */

function access(name, key) {
  assert(typeof name === 'string');
  assert(typeof key === 'string');

  if (isIdentifer(key))
    return `${name}.${key}`;

  return `${name}[${string(key)}]`;
}

function base64(raw) {
  assert(Buffer.isBuffer(raw));

  const str = raw.toString('base64');

  if (str.length < 64)
    return `'${str}'`;

  let out = '\'\\\n';

  for (let i = 0; i < str.length; i += 64) {
    out += str.substring(i, i + 64);
    out += '\\';
    out += '\n';
  }

  out += '\'';

  return out;
}

function cleanPackage(json) {
  if (!json || typeof json !== 'object')
    return false;

  let changed = false;

  // Get rid of all the NPM crap.
  for (const key of Object.keys(json)) {
    if (NPM_KEYS.has(key)) {
      delete json[key];
      changed = true;
    }
  }

  return changed;
}

function cmpString(a, b) {
  assert(typeof a === 'string');
  assert(typeof b === 'string');

  if (a === b)
    return 0;

  return a < b ? -1 : 1;
}

function decodeVersion(str) {
  if (typeof str !== 'string')
    return 0;

  str = str.replace(/\s+/g, '');
  str = str.replace(/^(?:~|\^|>=)/, '');
  str = str.replace(/^v/, '');

  if (!/^\d+\.\d+\.\d+/.test(str))
    return 0;

  const parts = str.split(/[^\d]/);

  return ((parts[0] & 0xff) * 0x10000
        + (parts[1] & 0xff) * 0x00100
        + (parts[2] & 0xff) * 0x00001);
}

function dot(key) {
  assert(typeof key === 'string');

  if (isIdentifer(key))
    return `.${key}`;

  return `[${string(key)}]`;
}

function encodeVersion(num) {
  assert((num >>> 0) === num);

  return [
    (num >>> 16) & 0xff,
    (num >>>  8) & 0xff,
    (num >>>  0) & 0xff
  ].join('.');
}

function indent(str, depth) {
  if (depth == null)
    depth = 0;

  assert(typeof str === 'string');
  assert((depth >>> 0) === depth);

  if (depth === 0)
    return str;

  return str.replace(/^/gm, ' '.repeat(depth * 2)).trim();
}

function multiline(str) {
  assert(typeof str === 'string');

  if (str.length < 64)
    return JSON.stringify(str);

  const lf = str.includes('\r\n') ? '\r\n' : '\n';
  const parts = str.split(lf);

  if (parts.length === 1)
    return JSON.stringify(str);

  let out = '"\\\n';

  for (let i = 0; i < parts.length; i++) {
    const eol = i === parts.length - 1 ? '' : lf;
    const part = JSON.stringify(parts[i] + eol);

    out += part.slice(1, -1) + '\\\n';
  }

  out += '"';

  return out;
}

function string(str) {
  assert(typeof str === 'string');
  str = JSON.stringify(str).slice(1, -1);
  str = str.replace(/\\"/g, '"');
  str = str.replace(/'/g, '\\\'');
  return `'${str}'`;
}

function stringify(value, indent) {
  if (indent != null) {
    assert((indent >>> 0) === indent);
    return JSON.stringify(value, null, indent);
  }

  return JSON.stringify(value);
}

function stripBOM(text) {
  assert(typeof text === 'string');

  // UTF-16 BOM (also slices UTF-8 BOM).
  if (text.charCodeAt(0) === 0xfeff)
    text = text.substring(1);

  return text;
}

function stripHashbang(code) {
  assert(typeof code === 'string');

  if (code.length < 2
      || code.charCodeAt(0) !== 0x23
      || code.charCodeAt(1) !== 0x21) {
    return ['', code];
  }

  let i = 2;
  let j = 1;

  for (; i < code.length; i++) {
    const ch = code.charCodeAt(i);

    // LF
    if (ch === 0x0a)
      break;

    // CR
    if (ch === 0x0d) {
      // CRLF
      if (i + 1 < code.length) {
        if (code.charCodeAt(i + 1) === 0x0a)
          j = 2;
      }

      break;
    }
  }

  if (i === code.length)
    return [code, ''];

  return [code.substring(0, i), code.substring(i + j)];
}

function unix(path) {
  assert(typeof path === 'string');

  if (process.platform !== 'win32')
    return path;

  if (!isAbsolute(path))
    return path.replace(/\\/g, '/');

  const {root} = parse(path);

  path = path.substring(root.length);
  path = path.replace(/\\/g, '/');
  path = '/' + path;

  return path;
}

function wrapText(text, width) {
  assert(typeof text === 'string');
  assert((width >>> 0) === width);
  assert(width > 0);

  text = stripBOM(text);

  if (/<\/\w+>/.test(text)) {
    text = text.replace(/&copy;/g, '(c)');
    text = text.replace(/<!--[\s\S]+?-->/g, '');
    text = text.replace(/<[^<>]+>/g, '');
  }

  text = text.trim();
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\r/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/\t/g, ' ');
  text = text.replace(/^ +/gm, '');
  text = text.replace(/ +$/gm, '');

  const lines = text.split('\n');

  let isLong = false;

  for (const line of lines) {
    if (line.length > width) {
      isLong = true;
      break;
    }
  }

  if (!isLong)
    return text;

  const chunks = [];
  const chunk = [];

  for (const line of lines) {
    if (line === '') {
      chunks.push(chunk.join(' '));
      chunk.length = 0;
    } else {
      chunk.push(line);
    }
  }

  if (chunk.length > 0)
    chunks.push(chunk.join(' '));

  let out = '';

  for (const chunk of chunks) {
    if (chunk.length <= width) {
      out += chunk + '\n\n';
      continue;
    }

    const parts = chunk.split(' ');
    const line = [];

    let len = 0;

    for (const part of parts) {
      if (len + part.length > width) {
        out += line.join(' ') + '\n';
        line.length = 0;
        len = 0;
      }

      line.push(part);
      len += part.length + 1;
    }

    if (line.length > 0)
      out += line.join(' ') + '\n';

    out += '\n';
  }

  return out.trim();
}

function getName(node) {
  if (node.type === 'Identifier')
    return node.name;

  if (node.type === 'Literal' && typeof node.value === 'string')
    return node.value;

  throw new Error(`Unexpected token: ${node.type}.`);
}

function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

function isTemplateLiteral(node) {
  return node.type === 'TemplateLiteral'
      && node.expressions.length === 0
      && node.quasis.length === 1
      && node.quasis[0].value.cooked != null;
}

function isString(node) {
  return isStringLiteral(node) || isTemplateLiteral(node);
}

function getString(node) {
  if (isStringLiteral(node))
    return node.value;

  if (isTemplateLiteral(node))
    return node.quasis[0].value.cooked;

  return null;
}

function getIdents(node) {
  assert(node && node.type === 'VariableDeclaration');

  const idents = [];

  for (const {id} of node.declarations)
    pushIdent(idents, id);

  return idents;
}

function pushIdent(idents, node) {
  if (node.type === 'Identifier') {
    idents.push(node.name);
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties)
      pushIdent(idents, prop);
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements)
      if (el) pushIdent(idents, el); // eslint-disable-line
  } else if (node.type === 'Property') {
    pushIdent(idents, node.value);
  } else if (node.type === 'AssignmentPattern') {
    pushIdent(idents, node.left);
  } else if (node.type === 'RestElement') {
    pushIdent(idents, node.argument);
  } else {
    throw Error(`Unexpected token: ${node.type}.`);
  }
}

/*
 * Expose
 */

exports.access = access;
exports.base64 = base64;
exports.cleanPackage = cleanPackage;
exports.cmpString = cmpString;
exports.decodeVersion = decodeVersion;
exports.dot = dot;
exports.encodeVersion = encodeVersion;
exports.indent = indent;
exports.multiline = multiline;
exports.string = string;
exports.stringify = stringify;
exports.stripBOM = stripBOM;
exports.stripHashbang = stripHashbang;
exports.unix = unix;
exports.wrapText = wrapText;
exports.getName = getName;
exports.isString = isString;
exports.getString = getString;
exports.getIdents = getIdents;
