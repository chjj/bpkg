'use strict';

const acorn = require('acorn');
const walk = require('acorn-walk');

const Parser = acorn.Parser.extend(
  require('acorn-bigint'),
  require('acorn-export-ns-from'),
  require('acorn-dynamic-import/src/index')['default'],
  require('acorn-import-meta')
);

walk.base.Import = () => {};

walk.collect = (node) => {
  const nodes = [];

  const cb = (node, st, type) => {
    nodes.push(node);
  };

  walk.full(node, cb, null, null, null);

  return nodes;
};

acorn.parse = Parser.parse.bind(Parser);
acorn.parseExpressionAt = Parser.parseExpressionAt.bind(Parser);
acorn.tokenizer = Parser.tokenizer.bind(Parser);
acorn.walk = walk;

module.exports = acorn;
