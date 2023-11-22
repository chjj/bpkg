'use strict';

const acorn = require('acorn');
const walk = require('acorn-walk');

const Parser = acorn.Parser.extend(
  require('acorn-class-fields'),
  require('acorn-static-class-features'),
  require('acorn-private-methods')
);

walk.base.Import = (node, st, c) => {};

acorn.parse = Parser.parse.bind(Parser);
acorn.parseExpressionAt = Parser.parseExpressionAt.bind(Parser);
acorn.tokenizer = Parser.tokenizer.bind(Parser);
acorn.walk = walk;

module.exports = acorn;
