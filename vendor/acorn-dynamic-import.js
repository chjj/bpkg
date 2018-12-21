/*
https://github.com/kesne/acorn-dynamic-import

MIT License

Copyright (c) 2016 Jordan Gensler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* eslint-disable no-underscore-dangle */
const tt = require('./acorn').tokTypes;

const DynamicImportKey = 'Import';

// NOTE: This allows `yield import()` to parse correctly.
tt._import.startsExpr = true;

function parseDynamicImport() {
  const node = this.startNode();
  this.next();
  if (this.type !== tt.parenL) {
    this.unexpected();
  }
  return this.finishNode(node, DynamicImportKey);
}

function parenAfter() {
  return /^(\s|\/\/.*|\/\*[^]*?\*\/)*\(/.test(this.input.slice(this.pos));
}

module.exports = function dynamicImport(Parser) {
  return class extends Parser {
    parseStatement(context, topLevel, exports) {
      if (this.type === tt._import && parenAfter.call(this)) {
        return this.parseExpressionStatement(this.startNode(), this.parseExpression());
      }
      return super.parseStatement(context, topLevel, exports);
    }

    parseExprAtom(refDestructuringErrors) {
      if (this.type === tt._import) {
        return parseDynamicImport.call(this);
      }
      return super.parseExprAtom(refDestructuringErrors);
    }
  };
};
