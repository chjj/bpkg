/*!
 * MIT License
 *
 * Copyright (c) 2023 Sven Sauleau
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict';

const acorn = require('acorn');

const leftCurlyBrace = "{".charCodeAt(0);
const space = " ".charCodeAt(0);

const keyword = "with";

function importAttributes(Parser) {
  const { tokTypes: tt, TokenType } = acorn;

  return class extends Parser {
    constructor(...args) {
      super(...args);
      this.withToken = new TokenType(keyword);
    }

    _codeAt(i) {
      return this.input.charCodeAt(i);
    }

    _eat(t) {
      if (this.type !== t) {
        this.unexpected();
      }
      this.next();
    }

    readToken(code) {
      let i = 0;
      for (; i < keyword.length; i++) {
        if (this._codeAt(this.pos + i) !== keyword.charCodeAt(i)) {
          return super.readToken(code);
        }
      }

      // ensure that the keyword is at the correct location
      // ie `with{...` or `with {...`
      for (;; i++) {
        if (this._codeAt(this.pos + i) === leftCurlyBrace) {
          // Found '{'
          break;
        } else if (this._codeAt(this.pos + i) === space) {
          // white space is allowed between `with` and `{`, so continue.
          continue;
        } else {
          return super.readToken(code);
        }
      }

      // If we're inside a dynamic import expression we'll parse
      // the `with` keyword as a standard object property name
      // ie `import(""./foo.json", { with: { type: "json" } })`
      if (this.type.label === "{") {
        return super.readToken(code);
      }

      this.pos += keyword.length;
      return this.finishToken(this.withToken);
    }

    parseDynamicImport(node) {
      this.next(); // skip `(`

      // Parse node.source.
      node.source = this.parseMaybeAssign();

      if (this.eat(tt.comma)) {
        const expr = this.parseExpression();
        node.arguments = [expr];
      }
      this._eat(tt.parenR);
      return this.finishNode(node, "ImportExpression");
    }

    parseImport(node) {
      this.next();
      // import '...'
      if (this.type === tt.string) {
        node.specifiers = [];
        node.source = this.parseExprAtom();
      } else {
        node.specifiers = this.parseImportSpecifiers();
        this.expectContextual("from");
        node.source =
          this.type === tt.string ? this.parseExprAtom() : this.unexpected();
      }

      if (this.type === this.withToken || this.type === tt._with) {
        this.next();
        const attributes = this.parseImportAttributes();
        if (attributes) {
          node.attributes = attributes;
        }
      }
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration");
    }

    parseImportAttributes() {
      this._eat(tt.braceL);
      const attrs = this.parsewithEntries();
      this._eat(tt.braceR);
      return attrs;
    }

    parsewithEntries() {
      const attrs = [];
      const attrNames = new Set();

      do {
        if (this.type === tt.braceR) {
          break;
        }

        const node = this.startNode();

        // parse withionKey : IdentifierName, StringLiteral
        let withionKeyNode;
        if (this.type === tt.string) {
          withionKeyNode = this.parseLiteral(this.value);
        } else {
          withionKeyNode = this.parseIdent(true);
        }
        this.next();
        node.key = withionKeyNode;

        // check if we already have an entry for an attribute
        // if a duplicate entry is found, throw an error
        // for now this logic will come into play only when someone
        // declares `type` twice
        if (attrNames.has(node.key.name)) {
          this.raise(this.pos, "Duplicated key in attributes");
        }
        attrNames.add(node.key.name);

        if (this.type !== tt.string) {
          this.raise(
            this.pos,
            "Only string is supported as an attribute value"
          );
        }

        node.value = this.parseLiteral(this.value);

        attrs.push(this.finishNode(node, "ImportAttribute"));
      } while (this.eat(tt.comma));

      return attrs;
    }
  };
}

module.exports = importAttributes;
