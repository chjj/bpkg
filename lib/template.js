/*!
 * template.js - templating for bpkg
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

const assert = require('assert');
const fs = require('../vendor/bfile');
const {resolve} = require('path');

/*
 * Constants
 */

const COMMENT_RX = / *\/\*(?!\!)[\s\S]*?\*\/\n{0,2}/g;
const SYMBOL_RX = /__([0-9A-Z_]+?)__/g;

const IF_RX = new RegExp(''
  + '(?:^|\\n)'
  + '// *if +(!?)__([0-9A-Z_]+?)__\\n'
  + '([\\s\\S]+?)'
  + '// *endif'
  + '(?:\\n|$)',
  'g');

/*
 * Templating
 */

async function template(file, values) {
  assert(typeof file === 'string');
  assert(values && typeof values === 'object');

  const path = resolve(__dirname, 'templates', file);

  let text = await fs.readFile(path, 'utf8');

  text = text.replace(COMMENT_RX, '');

  text = text.replace(IF_RX, (_, negate, name, code) => {
    name = name.toLowerCase();

    let none = values[name] == null
            || values[name] === false;

    if (negate)
      none = !none;

    if (none)
      return '';

    return '\n' + code;
  });

  text = text.replace(SYMBOL_RX, (_, name) => {
    name = name.toLowerCase();
    return String(values[name]);
  });

  return text;
}

/*
 * Expose
 */

module.exports = template;
