/* eslint-disable no-buffer-constructor, camelcase */
/* eslint-env mocha */

'use strict';

const assert = require('assert');
const os = require('os');
const util = require('util');
const vm = require('vm');
const common = require('./util/buffer-common');
const buffer = require('../lib/builtins/buffer');
const {Buffer, SlowBuffer} = buffer;
const B = Buffer;

function isBuffer(obj) {
  return obj != null &&
         obj.constructor != null &&
         typeof obj.constructor.isBuffer === 'function' &&
         obj.constructor.isBuffer(obj);
}

describe('Buffer', () => {
  describe('base64', () => {
    it('base64: ignore whitespace', () => {
      const text = '\n   YW9ldQ==  ';
      const buf = new B(text, 'base64');
      assert.equal(buf.toString(), 'aoeu');
    });

    it('base64: strings without padding', () => {
      assert.equal((new B('YW9ldQ', 'base64').toString()), 'aoeu');
    });

    it('base64: newline in utf8 -- should not be an issue', () => {
      assert.equal(
        new B('LS0tCnRpdGxlOiBUaHJlZSBkYXNoZXMgbWFya3MgdGhlIHNwb3QKdGFnczoK', 'base64').toString('utf8'),
        '---\ntitle: Three dashes marks the spot\ntags:\n'
      );
    });

    it('base64: newline in base64 -- should get stripped', () => {
      assert.equal(
        new B('LS0tCnRpdGxlOiBUaHJlZSBkYXNoZXMgbWFya3MgdGhlIHNwb3QKdGFnczoK\nICAtIHlhbWwKICAtIGZyb250LW1hdHRlcgogIC0gZGFzaGVzCmV4cGFuZWQt', 'base64').toString('utf8'),
        '---\ntitle: Three dashes marks the spot\ntags:\n  - yaml\n  - front-matter\n  - dashes\nexpaned-'
      );
    });

    it('base64: tab characters in base64 - should get stripped', () => {
      assert.equal(
        new B('LS0tCnRpdGxlOiBUaHJlZSBkYXNoZXMgbWFya3MgdGhlIHNwb3QKdGFnczoK\t\t\t\tICAtIHlhbWwKICAtIGZyb250LW1hdHRlcgogIC0gZGFzaGVzCmV4cGFuZWQt', 'base64').toString('utf8'),
        '---\ntitle: Three dashes marks the spot\ntags:\n  - yaml\n  - front-matter\n  - dashes\nexpaned-'
      );
    });

    it('base64: invalid non-alphanumeric characters -- should be stripped', () => {
      assert.equal(
        new B('!"#$%&\'()*,.:;<=>?@[\\]^`{|}~', 'base64').toString('utf8'),
        ''
      );
    });

    it('base64: high byte', () => {
      const highByte = B.from([128]);
      assert.deepEqual(
        B.alloc(1, highByte.toString('base64'), 'base64'),
        highByte
      );
    });
  });

  describe('basic', () => {
    it('instanceof Buffer', () => {
      const buf = new B([1, 2]);
      assert.ok(buf instanceof B);
    });

    it('convert to Uint8Array in modern browsers', () => {
      const buf = new B([1, 2]);
      const uint8array = new Uint8Array(buf.buffer);
      assert.ok(uint8array instanceof Uint8Array);
      assert.equal(uint8array[0], 1);
      assert.equal(uint8array[1], 2);
    });

    it('indexes from a string', () => {
      const buf = new B('abc');
      assert.equal(buf[0], 97);
      assert.equal(buf[1], 98);
      assert.equal(buf[2], 99);
    });

    it('indexes from an array', () => {
      const buf = new B([97, 98, 99]);
      assert.equal(buf[0], 97);
      assert.equal(buf[1], 98);
      assert.equal(buf[2], 99);
    });

    it('setting index value should modify buffer contents', () => {
      const buf = new B([97, 98, 99]);
      assert.equal(buf[2], 99);
      assert.equal(buf.toString(), 'abc');

      buf[2] += 10;
      assert.equal(buf[2], 109);
      assert.equal(buf.toString(), 'abm');
    });

    it('storing negative number should cast to unsigned', () => {
      let buf = new B(1);

      buf[0] = -3;
      assert.equal(buf[0], 253);

      buf = new B(1);
      buf.writeInt8(-3, 0);
      assert.equal(buf[0], 253);
    });

    it('test that memory is copied from array-like', () => {
      const u = new Uint8Array(4);
      const b = new B(u);
      b[0] = 1;
      b[1] = 2;
      b[2] = 3;
      b[3] = 4;

      assert.equal(u[0], 0);
      assert.equal(u[1], 0);
      assert.equal(u[2], 0);
      assert.equal(u[3], 0);
    });
  });

  describe('compare', () => {
    it('buffer.compare', () => {
      const b = new B(1).fill('a');
      const c = new B(1).fill('c');
      const d = new B(2).fill('aa');

      assert.equal(b.compare(c), -1);
      assert.equal(c.compare(d), 1);
      assert.equal(d.compare(b), 1);
      assert.equal(b.compare(d), -1);

      // static method
      assert.equal(B.compare(b, c), -1);
      assert.equal(B.compare(c, d), 1);
      assert.equal(B.compare(d, b), 1);
      assert.equal(B.compare(b, d), -1);
    });

    it('buffer.compare argument validation', () => {
      assert.throws(() => {
        const b = new B(1);
        B.compare(b, 'abc');
      });

      assert.throws(() => {
        const b = new B(1);
        B.compare('abc', b);
      });

      assert.throws(() => {
        const b = new B(1);
        b.compare('abc');
      });
    });

    it('buffer.equals', () => {
      const b = new B(5).fill('abcdf');
      const c = new B(5).fill('abcdf');
      const d = new B(5).fill('abcde');
      const e = new B(6).fill('abcdef');

      assert.ok(b.equals(c));
      assert.ok(!c.equals(d));
      assert.ok(!d.equals(e));
    });

    it('buffer.equals argument validation', () => {
      assert.throws(() => {
        const b = new B(1);
        b.equals('abc');
      });
    });
  });

  describe('constructor', () => {
    it('new buffer from array', () => {
      assert.equal(
        new B([1, 2, 3]).toString(),
        '\u0001\u0002\u0003'
      );
    });

    it('new buffer from array w/ negatives', () => {
      assert.equal(
        new B([-1, -2, -3]).toString('hex'),
        'fffefd'
      );
    });

    it('new buffer from array with mixed signed input', () => {
      assert.equal(
        new B([-255, 255, -128, 128, 512, -512, 511, -511]).toString('hex'),
        '01ff80800000ff01'
      );
    });

    it('new buffer from string', () => {
      assert.equal(
        new B('hey', 'utf8').toString(),
        'hey'
      );
    });

    it('new buffer from buffer', () => {
      const b1 = new B('asdf');
      const b2 = new B(b1);
      assert.equal(b1.toString('hex'), b2.toString('hex'));
    });

    it('new buffer from ArrayBuffer', () => {
      if (typeof ArrayBuffer !== 'undefined') {
        const arraybuffer = new Uint8Array([0, 1, 2, 3]).buffer;
        const b = new B(arraybuffer);
        assert.equal(b.length, 4);
        assert.equal(b[0], 0);
        assert.equal(b[1], 1);
        assert.equal(b[2], 2);
        assert.equal(b[3], 3);
        assert.equal(b[4], undefined);
      }
    });

    it('new buffer from ArrayBuffer, shares memory', () => {
      const u = new Uint8Array([0, 1, 2, 3]);
      const arraybuffer = u.buffer;
      const b = new B(arraybuffer);
      assert.equal(b.length, 4);
      assert.equal(b[0], 0);
      assert.equal(b[1], 1);
      assert.equal(b[2], 2);
      assert.equal(b[3], 3);
      assert.equal(b[4], undefined);

      // changing the Uint8Array (and thus the ArrayBuffer), changes the Buffer
      u[0] = 10;
      assert.equal(b[0], 10);
      u[1] = 11;
      assert.equal(b[1], 11);
      u[2] = 12;
      assert.equal(b[2], 12);
      u[3] = 13;
      assert.equal(b[3], 13);
    });

    it('new buffer from Uint8Array', () => {
      if (typeof Uint8Array !== 'undefined') {
        const b1 = new Uint8Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Uint16Array', () => {
      if (typeof Uint16Array !== 'undefined') {
        const b1 = new Uint16Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Uint32Array', () => {
      if (typeof Uint32Array !== 'undefined') {
        const b1 = new Uint32Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Int16Array', () => {
      if (typeof Int16Array !== 'undefined') {
        const b1 = new Int16Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Int32Array', () => {
      if (typeof Int32Array !== 'undefined') {
        const b1 = new Int32Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Float32Array', () => {
      if (typeof Float32Array !== 'undefined') {
        const b1 = new Float32Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from Float64Array', () => {
      if (typeof Float64Array !== 'undefined') {
        const b1 = new Float64Array([0, 1, 2, 3]);
        const b2 = new B(b1);
        assert.equal(b1.length, b2.length);
        assert.equal(b1[0], 0);
        assert.equal(b1[1], 1);
        assert.equal(b1[2], 2);
        assert.equal(b1[3], 3);
        assert.equal(b1[4], undefined);
      }
    });

    it('new buffer from buffer.toJSON() output', () => {
      if (typeof JSON === 'undefined') {
        // ie6, ie7 lack support
        return;
      }
      const buf = new B('test');
      const json = JSON.stringify(buf);
      const obj = JSON.parse(json);
      const copy = new B(obj);
      assert.ok(buf.equals(copy));
    });
  });

  describe('from-string', () => {
    it('detect utf16 surrogate pairs', () => {
      const text = '\uD83D\uDE38' + '\uD83D\uDCAD' + '\uD83D\uDC4D';
      const buf = new B(text);
      assert.equal(text, buf.toString());
    });

    it('detect utf16 surrogate pairs over U+20000 until U+10FFFF', () => {
      const text = '\uD842\uDFB7' + '\uD93D\uDCAD' + '\uDBFF\uDFFF';
      const buf = new B(text);
      assert.equal(text, buf.toString());
    });

    it('replace orphaned utf16 surrogate lead code point', () => {
      const text = '\uD83D\uDE38' + '\uD83D' + '\uD83D\uDC4D';
      const buf = new B(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0xef, 0xbf, 0xbd, 0xf0, 0x9f, 0x91, 0x8d]));
    });

    it('replace orphaned utf16 surrogate trail code point', () => {
      const text = '\uD83D\uDE38' + '\uDCAD' + '\uD83D\uDC4D';
      const buf = new B(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0xef, 0xbf, 0xbd, 0xf0, 0x9f, 0x91, 0x8d]));
    });

    it('do not write partial utf16 code units', () => {
      const f = new B([0, 0, 0, 0, 0]);
      assert.equal(f.length, 5);
      const size = f.write('あいうえお', 'utf16le');
      assert.equal(size, 4);
      assert.deepEqual(f, new B([0x42, 0x30, 0x44, 0x30, 0x00]));
    });

    it('handle partial utf16 code points when encoding to utf8 the way node does', () => {
      const text = '\uD83D\uDE38' + '\uD83D\uDC4D';

      let buf = new B(8);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0xf0, 0x9f, 0x91, 0x8d]));

      buf = new B(7);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0x00, 0x00, 0x00]));

      buf = new B(6);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0x00, 0x00]));

      buf = new B(5);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8, 0x00]));

      buf = new B(4);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0xf0, 0x9f, 0x98, 0xb8]));

      buf = new B(3);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x00, 0x00, 0x00]));

      buf = new B(2);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x00, 0x00]));

      buf = new B(1);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x00]));
    });

    it('handle invalid utf16 code points when encoding to utf8 the way node does', () => {
      const text = 'a' + '\uDE38\uD83D' + 'b';

      let buf = new B(8);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0x62]));

      buf = new B(7);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd]));

      buf = new B(6);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0xef, 0xbf, 0xbd, 0x00, 0x00]));

      buf = new B(5);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0xef, 0xbf, 0xbd, 0x00]));

      buf = new B(4);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0xef, 0xbf, 0xbd]));

      buf = new B(3);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0x00, 0x00]));

      buf = new B(2);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61, 0x00]));

      buf = new B(1);
      buf.fill(0);
      buf.write(text);
      assert.deepEqual(buf, new B([0x61]));
    });
  });

  describe('is-buffer', () => {
    it('is-buffer tests', () => {
      assert.ok(isBuffer(new B(4)), 'new Buffer(4)');

      assert.ok(!isBuffer(undefined), 'undefined');
      assert.ok(!isBuffer(null), 'null');
      assert.ok(!isBuffer(''), 'empty string');
      assert.ok(!isBuffer(true), 'true');
      assert.ok(!isBuffer(false), 'false');
      assert.ok(!isBuffer(0), '0');
      assert.ok(!isBuffer(1), '1');
      assert.ok(!isBuffer(1.0), '1.0');
      assert.ok(!isBuffer('string'), 'string');
      assert.ok(!isBuffer({}), '{}');
      assert.ok(!isBuffer(function foo() {}), 'function foo() {}');
    });
  });

  describe('methods', () => {
    it('buffer.toJSON', () => {
      const data = [1, 2, 3, 4];
      assert.deepEqual(
        new B(data).toJSON(),
        { type: 'Buffer', data: [1, 2, 3, 4] }
      );
    });

    it('buffer.copy', () => {
      // copied from nodejs.org example
      const buf1 = new B(26);
      const buf2 = new B(26);

      for (let i = 0; i < 26; i++) {
        buf1[i] = i + 97; // 97 is ASCII a
        buf2[i] = 33; // ASCII !
      }

      buf1.copy(buf2, 8, 16, 20);

      assert.equal(
        buf2.toString('ascii', 0, 25),
        '!!!!!!!!qrst!!!!!!!!!!!!!'
      );
    });

    it('test offset returns are correct', () => {
      const b = new B(16);
      assert.equal(4, b.writeUInt32LE(0, 0));
      assert.equal(6, b.writeUInt16LE(0, 4));
      assert.equal(7, b.writeUInt8(0, 6));
      assert.equal(8, b.writeInt8(0, 7));
      assert.equal(16, b.writeDoubleLE(0, 8));
    });

    it('concat() a varying number of buffers', () => {
      const zero = [];
      const one = [new B('asdf')];
      const long = [];

      for (let i = 0; i < 10; i++)
        long.push(new B('asdf'));

      const flatZero = B.concat(zero);
      const flatOne = B.concat(one);
      const flatLong = B.concat(long);
      const flatLongLen = B.concat(long, 40);

      assert.equal(flatZero.length, 0);
      assert.equal(flatOne.toString(), 'asdf');
      assert.deepEqual(flatOne, one[0]);
      assert.equal(flatLong.toString(), (new Array(10 + 1).join('asdf')));
      assert.equal(flatLongLen.toString(), (new Array(10 + 1).join('asdf')));
    });

    it('concat() works on Uint8Array instances', () => {
      const result = B.concat([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
      const expected = B.from([1, 2, 3, 4]);
      assert.deepEqual(result, expected);
    });

    it('concat() works on Uint8Array instances for smaller provided totalLength', () => {
      const result = B.concat([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 3);
      const expected = B.from([1, 2, 3]);
      assert.deepEqual(result, expected);
    });

    it('fill', () => {
      const b = new B(10);
      b.fill(2);
      assert.equal(b.toString('hex'), '02020202020202020202');
    });

    it('fill (string)', () => {
      const b = new B(10);
      b.fill('abc');
      assert.equal(b.toString(), 'abcabcabca');
      b.fill('է');
      assert.equal(b.toString(), 'էէէէէ');
    });

    it('copy() empty buffer with sourceEnd=0', () => {
      const source = new B([42]);
      const destination = new B([43]);
      source.copy(destination, 0, 0, 0);
      assert.equal(destination.readUInt8(0), 43);
    });

    it('copy() after slice()', () => {
      const source = new B(200);
      const dest = new B(200);
      const expected = new B(200);
      for (let i = 0; i < 200; i++) {
        source[i] = i;
        dest[i] = 0;
      }

      source.slice(2).copy(dest);
      source.copy(expected, 0, 2);
      assert.deepEqual(dest, expected);
    });

    it('copy() ascending', () => {
      const b = new B('abcdefghij');
      b.copy(b, 0, 3, 10);
      assert.equal(b.toString(), 'defghijhij');
    });

    it('copy() descending', () => {
      const b = new B('abcdefghij');
      b.copy(b, 3, 0, 7);
      assert.equal(b.toString(), 'abcabcdefg');
    });

    it('buffer.slice sets indexes', () => {
      assert.equal((new B('hallo')).slice(0, 5).toString(), 'hallo');
    });

    it('buffer.slice out of range', () => {
      assert.equal((new B('hallo')).slice(0, 10).toString(), 'hallo');
      assert.equal((new B('hallo')).slice(10, 2).toString(), '');
    });
  });

  describe('slice', () => {
    it('modifying buffer created by .slice() modifies original memory', () => {
      const buf1 = new B(26);

      for (let i = 0; i < 26; i++)
        buf1[i] = i + 97; // 97 is ASCII a

      const buf2 = buf1.slice(0, 3);
      assert.equal(buf2.toString('ascii', 0, buf2.length), 'abc');

      buf2[0] = '!'.charCodeAt(0);
      assert.equal(buf1.toString('ascii', 0, buf2.length), '!bc');
    });

    it('modifying parent buffer modifies .slice() buffer\'s memory', () => {
      const buf1 = new B(26);

      for (let i = 0; i < 26; i++)
        buf1[i] = i + 97; // 97 is ASCII a

      const buf2 = buf1.slice(0, 3);
      assert.equal(buf2.toString('ascii', 0, buf2.length), 'abc');

      buf1[0] = '!'.charCodeAt(0);
      assert.equal(buf2.toString('ascii', 0, buf2.length), '!bc');
    });
  });

  describe('static', () => {
    it('Buffer.isEncoding', () => {
      assert.equal(B.isEncoding('HEX'), true);
      assert.equal(B.isEncoding('hex'), true);
      assert.equal(B.isEncoding('bad'), false);
    });

    it('Buffer.isBuffer', () => {
      assert.equal(B.isBuffer(new B('hey', 'utf8')), true);
      assert.equal(B.isBuffer(new B([1, 2, 3], 'utf8')), true);
      assert.equal(B.isBuffer('hey'), false);
    });
  });

  describe('to-string', () => {
    it('utf8 buffer to base64', () => {
      assert.equal(
        new B('Ձאab', 'utf8').toString('base64'),
        '1YHXkGFi'
      );
    });

    it('utf8 buffer to hex', () => {
      assert.equal(
        new B('Ձאab', 'utf8').toString('hex'),
        'd581d7906162'
      );
    });

    it('utf8 to utf8', () => {
      assert.equal(
        new B('öäüõÖÄÜÕ', 'utf8').toString('utf8'),
        'öäüõÖÄÜÕ'
      );
    });

    it('utf16le to utf16', () => {
      assert.equal(
        new B(new B('abcd', 'utf8').toString('utf16le'), 'utf16le').toString('utf8'),
        'abcd'
      );
    });

    it('utf16le to utf16 with odd byte length input', () => {
      assert.equal(
        new B(new B('abcde', 'utf8').toString('utf16le'), 'utf16le').toString('utf8'),
        'abcd'
      );
    });

    it('utf16le to hex', () => {
      assert.equal(
        new B('abcd', 'utf16le').toString('hex'),
        '6100620063006400'
      );
    });

    it('ascii buffer to base64', () => {
      assert.equal(
        new B('123456!@#$%^', 'ascii').toString('base64'),
        'MTIzNDU2IUAjJCVe'
      );
    });

    it('ascii buffer to hex', () => {
      assert.equal(
        new B('123456!@#$%^', 'ascii').toString('hex'),
        '31323334353621402324255e'
      );
    });

    it('base64 buffer to utf8', () => {
      assert.equal(
        new B('1YHXkGFi', 'base64').toString('utf8'),
        'Ձאab'
      );
    });

    it('hex buffer to utf8', () => {
      assert.equal(
        new B('d581d7906162', 'hex').toString('utf8'),
        'Ձאab'
      );
    });

    it('base64 buffer to ascii', () => {
      assert.equal(
        new B('MTIzNDU2IUAjJCVe', 'base64').toString('ascii'),
        '123456!@#$%^'
      );
    });

    it('hex buffer to ascii', () => {
      assert.equal(
        new B('31323334353621402324255e', 'hex').toString('ascii'),
        '123456!@#$%^'
      );
    });

    it('base64 buffer to binary', () => {
      assert.equal(
        new B('MTIzNDU2IUAjJCVe', 'base64').toString('binary'),
        '123456!@#$%^'
      );
    });

    it('hex buffer to binary', () => {
      assert.equal(
        new B('31323334353621402324255e', 'hex').toString('binary'),
        '123456!@#$%^'
      );
    });

    it('utf8 to binary', () => {
      assert.equal(
        new B('öäüõÖÄÜÕ', 'utf8').toString('binary'),
        'Ã¶Ã¤Ã¼ÃµÃÃÃÃ'
      );
    });

    it('utf8 replacement chars (1 byte sequence)', () => {
      assert.equal(
        new B([0x80]).toString(),
        '\uFFFD'
      );
      assert.equal(
        new B([0x7F]).toString(),
        '\u007F'
      );
    });

    it('utf8 replacement chars (2 byte sequences)', () => {
      assert.equal(
        new B([0xC7]).toString(),
        '\uFFFD'
      );
      assert.equal(
        new B([0xC7, 0xB1]).toString(),
        '\u01F1'
      );
      assert.equal(
        new B([0xC0, 0xB1]).toString(),
        '\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xC1, 0xB1]).toString(),
        '\uFFFD\uFFFD'
      );
    });

    it('utf8 replacement chars (3 byte sequences)', () => {
      assert.equal(
        new B([0xE0]).toString(),
        '\uFFFD'
      );
      assert.equal(
        new B([0xE0, 0xAC]).toString(),
        '\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xE0, 0xAC, 0xB9]).toString(),
        '\u0B39'
      );
    });

    it('utf8 replacement chars (4 byte sequences)', () => {
      assert.equal(
        new B([0xF4]).toString(),
        '\uFFFD'
      );
      assert.equal(
        new B([0xF4, 0x8F]).toString(),
        '\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xF4, 0x8F, 0x80]).toString(),
        '\uFFFD\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xF4, 0x8F, 0x80, 0x84]).toString(),
        '\uDBFC\uDC04'
      );
      assert.equal(
        new B([0xFF]).toString(),
        '\uFFFD'
      );
      assert.equal(
        new B([0xFF, 0x8F, 0x80, 0x84]).toString(),
        '\uFFFD\uFFFD\uFFFD\uFFFD'
      );
    });

    it('utf8 replacement chars on 256 random bytes', () => {
      assert.equal(
        new B([152, 130, 206, 23, 243, 238, 197, 44, 27, 86, 208, 36, 163, 184, 164, 21, 94, 242, 178, 46, 25, 26, 253, 178, 72, 147, 207, 112, 236, 68, 179, 190, 29, 83, 239, 147, 125, 55, 143, 19, 157, 68, 157, 58, 212, 224, 150, 39, 128, 24, 94, 225, 120, 121, 75, 192, 112, 19, 184, 142, 203, 36, 43, 85, 26, 147, 227, 139, 242, 186, 57, 78, 11, 102, 136, 117, 180, 210, 241, 92, 3, 215, 54, 167, 249, 1, 44, 225, 146, 86, 2, 42, 68, 21, 47, 238, 204, 153, 216, 252, 183, 66, 222, 255, 15, 202, 16, 51, 134, 1, 17, 19, 209, 76, 238, 38, 76, 19, 7, 103, 249, 5, 107, 137, 64, 62, 170, 57, 16, 85, 179, 193, 97, 86, 166, 196, 36, 148, 138, 193, 210, 69, 187, 38, 242, 97, 195, 219, 252, 244, 38, 1, 197, 18, 31, 246, 53, 47, 134, 52, 105, 72, 43, 239, 128, 203, 73, 93, 199, 75, 222, 220, 166, 34, 63, 236, 11, 212, 76, 243, 171, 110, 78, 39, 205, 204, 6, 177, 233, 212, 243, 0, 33, 41, 122, 118, 92, 252, 0, 157, 108, 120, 70, 137, 100, 223, 243, 171, 232, 66, 126, 111, 142, 33, 3, 39, 117, 27, 107, 54, 1, 217, 227, 132, 13, 166, 3, 73, 53, 127, 225, 236, 134, 219, 98, 214, 125, 148, 24, 64, 142, 111, 231, 194, 42, 150, 185, 10, 182, 163, 244, 19, 4, 59, 135, 16]).toString(),
        '\uFFFD\uFFFD\uFFFD\u0017\uFFFD\uFFFD\uFFFD\u002C\u001B\u0056\uFFFD\u0024\uFFFD\uFFFD\uFFFD\u0015\u005E\uFFFD\uFFFD\u002E\u0019\u001A\uFFFD\uFFFD\u0048\uFFFD\uFFFD\u0070\uFFFD\u0044\uFFFD\uFFFD\u001D\u0053\uFFFD\uFFFD\u007D\u0037\uFFFD\u0013\uFFFD\u0044\uFFFD\u003A\uFFFD\uFFFD\uFFFD\u0027\uFFFD\u0018\u005E\uFFFD\u0078\u0079\u004B\uFFFD\u0070\u0013\uFFFD\uFFFD\uFFFD\u0024\u002B\u0055\u001A\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\u0039\u004E\u000B\u0066\uFFFD\u0075\uFFFD\uFFFD\uFFFD\u005C\u0003\uFFFD\u0036\uFFFD\uFFFD\u0001\u002C\uFFFD\uFFFD\u0056\u0002\u002A\u0044\u0015\u002F\uFFFD\u0319\uFFFD\uFFFD\uFFFD\u0042\uFFFD\uFFFD\u000F\uFFFD\u0010\u0033\uFFFD\u0001\u0011\u0013\uFFFD\u004C\uFFFD\u0026\u004C\u0013\u0007\u0067\uFFFD\u0005\u006B\uFFFD\u0040\u003E\uFFFD\u0039\u0010\u0055\uFFFD\uFFFD\u0061\u0056\uFFFD\uFFFD\u0024\uFFFD\uFFFD\uFFFD\uFFFD\u0045\uFFFD\u0026\uFFFD\u0061\uFFFD\uFFFD\uFFFD\uFFFD\u0026\u0001\uFFFD\u0012\u001F\uFFFD\u0035\u002F\uFFFD\u0034\u0069\u0048\u002B\uFFFD\uFFFD\uFFFD\u0049\u005D\uFFFD\u004B\uFFFD\u0726\u0022\u003F\uFFFD\u000B\uFFFD\u004C\uFFFD\uFFFD\u006E\u004E\u0027\uFFFD\uFFFD\u0006\uFFFD\uFFFD\uFFFD\uFFFD\u0000\u0021\u0029\u007A\u0076\u005C\uFFFD\u0000\uFFFD\u006C\u0078\u0046\uFFFD\u0064\uFFFD\uFFFD\uFFFD\uFFFD\u0042\u007E\u006F\uFFFD\u0021\u0003\u0027\u0075\u001B\u006B\u0036\u0001\uFFFD\uFFFD\uFFFD\u000D\uFFFD\u0003\u0049\u0035\u007F\uFFFD\uFFFD\uFFFD\uFFFD\u0062\uFFFD\u007D\uFFFD\u0018\u0040\uFFFD\u006F\uFFFD\uFFFD\u002A\uFFFD\uFFFD\u000A\uFFFD\uFFFD\uFFFD\u0013\u0004\u003B\uFFFD\u0010'
      );
    });

    it('utf8 replacement chars for anything in the surrogate pair range', () => {
      assert.equal(
        new B([0xED, 0x9F, 0xBF]).toString(),
        '\uD7FF'
      );
      assert.equal(
        new B([0xED, 0xA0, 0x80]).toString(),
        '\uFFFD\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xED, 0xBE, 0x8B]).toString(),
        '\uFFFD\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xED, 0xBF, 0xBF]).toString(),
        '\uFFFD\uFFFD\uFFFD'
      );
      assert.equal(
        new B([0xEE, 0x80, 0x80]).toString(),
        '\uE000'
      );
    });

    it('utf8 don\'t replace the replacement char', () => {
      assert.equal(
        new B('\uFFFD').toString(),
        '\uFFFD'
      );
    });
  });

  describe('write-hex', () => {
    it('buffer.write("hex") should stop on invalid characters', () => {
      // Test the entire 16-bit space.
      for (let ch = 0; ch <= 0xffff; ch++) {
        // 0-9
        if (ch >= 0x30 && ch <= 0x39)
          continue;

        // A-F
        if (ch >= 0x41 && ch <= 0x46)
          continue;

        // a-f
        if (ch >= 0x61 && ch <= 0x66)
          continue;

        for (const str of [
          'abcd' + String.fromCharCode(ch) + 'ef0',
          'abcde' + String.fromCharCode(ch) + 'f0',
          'abcd' + String.fromCharCode(ch + 0) + String.fromCharCode(ch + 1) + 'f0',
          'abcde' + String.fromCharCode(ch + 0) + String.fromCharCode(ch + 1) + '0'
        ]) {
          const buf = B.alloc(4);
          assert.equal(str.length, 8);
          assert.equal(buf.write(str, 'hex'), 2);
          assert.equal(buf.toString('hex'), 'abcd0000');
          assert.equal(B.from(str, 'hex').toString('hex'), 'abcd');
        }
      }
    });

    it('buffer.write("hex") should truncate odd string lengths', () => {
      const buf = B.alloc(32);
      const charset = '0123456789abcdef';

      let str = '';

      for (let i = 0; i < 63; i++)
        str += charset[Math.random() * charset.length | 0];

      assert.equal(buf.write('abcde', 'hex'), 2);
      assert.equal(buf.toString('hex', 0, 3), 'abcd00');

      buf.fill(0);

      assert.equal(buf.write(str, 'hex'), 31);
      assert.equal(buf.toString('hex', 0, 32), str.slice(0, -1) + '00');
    });
  });

  describe('write', () => {
    it('buffer.write string should get parsed as number', () => {
      const b = new B(64);
      b.writeUInt16LE('1003', 0);
      assert.equal(b.readUInt16LE(0), 1003);
    });

    it('buffer.writeUInt8 a fractional number will get Math.floored', () => {
      // Some extra work is necessary to make this test pass with the Object implementation

      const b = new B(1);
      b.writeInt8(5.5, 0);
      assert.equal(b[0], 5);
    });

    it('writeUint8 with a negative number throws', () => {
      const buf = new B(1);

      assert.throws(() => {
        buf.writeUInt8(-3, 0);
      });
    });

    it('hex of write{Uint,Int}{8,16,32}{LE,BE}', () => {
      const hex = [
        '03', '0300', '0003', '03000000', '00000003',
        'fd', 'fdff', 'fffd', 'fdffffff', 'fffffffd'
      ];
      const reads = [3, 3, 3, 3, 3, -3, -3, -3, -3, -3];
      const xs = ['UInt', 'Int'];
      const ys = [8, 16, 32];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        for (let j = 0; j < ys.length; j++) {
          const y = ys[j];
          const endianesses = (y === 8) ? [''] : ['LE', 'BE'];
          for (let k = 0; k < endianesses.length; k++) {
            const z = endianesses[k];

            const v1 = new B(y / 8);
            const writefn = 'write' + x + y + z;
            const val = (x === 'Int') ? -3 : 3;
            v1[writefn](val, 0);
            assert.equal(
              v1.toString('hex'),
              hex.shift()
            );
            const readfn = 'read' + x + y + z;
            assert.equal(
              v1[readfn](0),
              reads.shift()
            );
          }
        }
      }
    });

    it.skip('hex of write{Uint,Int}{8,16,32}{LE,BE} with overflow', () => {
      const hex = [
        '', '03', '00', '030000', '000000',
        '', 'fd', 'ff', 'fdffff', 'ffffff'
      ];
      const reads = [
        undefined, 3, 0, NaN, 0,
        undefined, 253, -256, 16777213, -256
      ];
      const xs = ['UInt', 'Int'];
      const ys = [8, 16, 32];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        for (let j = 0; j < ys.length; j++) {
          const y = ys[j];
          const endianesses = (y === 8) ? [''] : ['LE', 'BE'];
          for (let k = 0; k < endianesses.length; k++) {
            const z = endianesses[k];

            const v1 = new B((y / 8) - 1);
            const next = new B(4);
            next.writeUInt32BE(0, 0);
            const writefn = 'write' + x + y + z;
            const val = (x === 'Int') ? -3 : 3;
            v1[writefn](val, 0, true);
            assert.equal(
              v1.toString('hex'),
              hex.shift()
            );
            // check that nothing leaked to next buffer.
            assert.equal(next.readUInt32BE(0), 0);
            // check that no bytes are read from next buffer.
            next.writeInt32BE(~0, 0);
            const readfn = 'read' + x + y + z;
            const r = reads.shift();
            if (r === r)
              assert.equal(v1[readfn](0, true), r);
          }
        }
      }
    });

    it('large values do not improperly roll over (ref #80)', () => {
      const nums = [-25589992, -633756690, -898146932];
      const out = new B(12);
      out.fill(0);
      out.writeInt32BE(nums[0], 0);
      let newNum = out.readInt32BE(0);
      assert.equal(nums[0], newNum);
      out.writeInt32BE(nums[1], 4);
      newNum = out.readInt32BE(4);
      assert.equal(nums[1], newNum);
      out.writeInt32BE(nums[2], 8);
      newNum = out.readInt32BE(8);
      assert.equal(nums[2], newNum);
    });
  });

  describe('write-infinity', () => {
    it('write/read Infinity as a float', () => {
      const buf = new B(4);
      assert.equal(buf.writeFloatBE(Infinity, 0), 4);
      assert.equal(buf.readFloatBE(0), Infinity);
    });

    it('write/read -Infinity as a float', () => {
      const buf = new B(4);
      assert.equal(buf.writeFloatBE(-Infinity, 0), 4);
      assert.equal(buf.readFloatBE(0), -Infinity);
    });

    it('write/read Infinity as a double', () => {
      const buf = new B(8);
      assert.equal(buf.writeDoubleBE(Infinity, 0), 8);
      assert.equal(buf.readDoubleBE(0), Infinity);
    });

    it('write/read -Infinity as a double', () => {
      const buf = new B(8);
      assert.equal(buf.writeDoubleBE(-Infinity, 0), 8);
      assert.equal(buf.readDoubleBE(0), -Infinity);
    });

    it('write/read float greater than max', () => {
      const buf = new B(4);
      assert.equal(buf.writeFloatBE(4e38, 0), 4);
      assert.equal(buf.readFloatBE(0), Infinity);
    });

    it('write/read float less than min', () => {
      const buf = new B(4);
      assert.equal(buf.writeFloatBE(-4e40, 0), 4);
      assert.equal(buf.readFloatBE(0), -Infinity);
    });
  });

  describe('Node Tests', () => {
    // Copyright Joyent, Inc. and other Node contributors.var Buffer = require('../../').Buffer;
    // Copyright Joyent, Inc. and other Node contributors.
    //
    // Permission is hereby granted, free of charge, to any person obtaining a
    // copy of this software and associated documentation files (the
    // "Software"), to deal in the Software without restriction, including
    // without limitation the rights to use, copy, modify, merge, publish,
    // distribute, sublicense, and/or sell copies of the Software, and to permit
    // persons to whom the Software is furnished to do so, subject to the
    // following conditions:
    //
    // The above copyright notice and this permission notice shall be included
    // in all copies or substantial portions of the Software.
    //
    // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
    // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
    // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
    // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
    // USE OR OTHER DEALINGS IN THE SOFTWARE.

    it('test-buffer-alloc', () => {
      const b = Buffer.allocUnsafe(1024);
      assert.strictEqual(1024, b.length);

      b[0] = -1;
      assert.strictEqual(b[0], 255);

      for (let i = 0; i < 1024; i++)
        b[i] = i % 256;

      for (let i = 0; i < 1024; i++)
        assert.strictEqual(i % 256, b[i]);

      const c = Buffer.allocUnsafe(512);
      assert.strictEqual(512, c.length);

      const d = Buffer.from([]);
      assert.strictEqual(0, d.length);

      // Test offset properties
      {
        const b = Buffer.alloc(128);
        assert.strictEqual(128, b.length);
        assert.strictEqual(0, b.byteOffset);
        assert.strictEqual(0, b.offset);
      }

      // Test creating a Buffer from a Uint32Array
      {
        const ui32 = new Uint32Array(4).fill(42);
        const e = Buffer.from(ui32);
        for (const [index, value] of e.entries())
          assert.strictEqual(value, ui32[index]);
      }

      // Test creating a Buffer from a Uint32Array (old constructor)
      {
        const ui32 = new Uint32Array(4).fill(42);
        const e = Buffer(ui32);
        for (const [key, value] of e.entries())
          assert.deepStrictEqual(value, ui32[key]);
      }

      if (typeof SharedArrayBuffer !== 'undefined') {
        const sab = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 4);
        const ui32 = new Uint8Array(sab).fill(42);
        const e = Buffer(sab);
        for (const [key, value] of e.entries())
          assert.deepStrictEqual(value, ui32[key]);
      }

      // Test invalid encoding for Buffer.toString
      assert.throws(() => b.toString('invalid'),
                    /Unknown encoding: invalid/);
      // invalid encoding for Buffer.write
      assert.throws(() => b.write('test string', 0, 5, 'invalid'),
                    /Unknown encoding: invalid/);
      // unsupported arguments for Buffer.write
      assert.throws(() => b.write('test', 'utf8', 0),
                    /is no longer supported/);

      // try to create 0-length buffers
      assert.doesNotThrow(() => Buffer.from(''));
      assert.doesNotThrow(() => Buffer.from('', 'ascii'));
      assert.doesNotThrow(() => Buffer.from('', 'latin1'));
      assert.doesNotThrow(() => Buffer.alloc(0));
      assert.doesNotThrow(() => Buffer.allocUnsafe(0));
      assert.doesNotThrow(() => new Buffer(''));
      assert.doesNotThrow(() => new Buffer('', 'ascii'));
      assert.doesNotThrow(() => new Buffer('', 'latin1'));
      assert.doesNotThrow(() => new Buffer('', 'binary'));
      assert.doesNotThrow(() => Buffer(0));
      assert.doesNotThrow(() => Buffer.alloc(16, Boolean(true)));

      // try to write a 0-length string beyond the end of b
      assert.throws(() => b.write('', 2048), RangeError);

      // throw when writing to negative offset
      assert.throws(() => b.write('a', -1), RangeError);

      // throw when writing past bounds from the pool
      assert.throws(() => b.write('a', 2048), RangeError);

      // throw when writing to negative offset
      assert.throws(() => b.write('a', -1), RangeError);

      // try to copy 0 bytes worth of data into an empty buffer
      b.copy(Buffer.alloc(0), 0, 0, 0);

      // try to copy 0 bytes past the end of the target buffer
      b.copy(Buffer.alloc(0), 1, 1, 1);
      b.copy(Buffer.alloc(1), 1, 1, 1);

      // try to copy 0 bytes from past the end of the source buffer
      b.copy(Buffer.alloc(1), 0, 2048, 2048);

      // testing for smart defaults and ability to pass string values as offset
      {
        const writeTest = Buffer.from('abcdes');
        writeTest.write('n', 'ascii');
        writeTest.write('o', '1', 'ascii');
        writeTest.write('d', '2', 'ascii');
        writeTest.write('e', 3, 'ascii');
        writeTest.write('j', 4, 'ascii');
        assert.strictEqual(writeTest.toString(), 'nodejs');
      }

      // Offset points to the end of the buffer
      // (see https://github.com/nodejs/node/issues/8127).
      assert.doesNotThrow(() => Buffer.alloc(1).write('', 1, 0));

      // ASCII slice test
      {
        const asciiString = 'hello world';

        for (let i = 0; i < asciiString.length; i++)
          b[i] = asciiString.charCodeAt(i);

        const asciiSlice = b.toString('ascii', 0, asciiString.length);
        assert.strictEqual(asciiString, asciiSlice);
      }

      {
        const asciiString = 'hello world';
        const offset = 100;

        assert.strictEqual(asciiString.length, b.write(asciiString, offset, 'ascii'));
        const asciiSlice = b.toString('ascii', offset, offset + asciiString.length);
        assert.strictEqual(asciiString, asciiSlice);
      }

      {
        const asciiString = 'hello world';
        const offset = 100;

        const sliceA = b.slice(offset, offset + asciiString.length);
        const sliceB = b.slice(offset, offset + asciiString.length);

        for (let i = 0; i < asciiString.length; i++)
          assert.strictEqual(sliceA[i], sliceB[i]);
      }

      // UTF-8 slice test
      {
        const utf8String = '¡hέlló wôrld!';
        const offset = 100;

        b.write(utf8String, 0, Buffer.byteLength(utf8String), 'utf8');
        let utf8Slice = b.toString('utf8', 0, Buffer.byteLength(utf8String));
        assert.strictEqual(utf8String, utf8Slice);

        assert.strictEqual(Buffer.byteLength(utf8String),
                           b.write(utf8String, offset, 'utf8'));
        utf8Slice = b.toString('utf8', offset,
                               offset + Buffer.byteLength(utf8String));
        assert.strictEqual(utf8String, utf8Slice);

        const sliceA = b.slice(offset, offset + Buffer.byteLength(utf8String));
        const sliceB = b.slice(offset, offset + Buffer.byteLength(utf8String));

        for (let i = 0; i < Buffer.byteLength(utf8String); i++)
          assert.strictEqual(sliceA[i], sliceB[i]);
      }

      {
        const slice = b.slice(100, 150);

        assert.strictEqual(50, slice.length);

        for (let i = 0; i < 50; i++)
          assert.strictEqual(b[100 + i], slice[i]);
      }

      {
        // make sure only top level parent propagates from allocPool
        const b = Buffer.allocUnsafe(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        assert.strictEqual(b.parent, c.parent);
        assert.strictEqual(b.parent, d.parent);
      }

      {
        // also from a non-pooled instance
        const b = Buffer.allocUnsafeSlow(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        assert.strictEqual(c.parent, d.parent);
      }

      {
        // Bug regression test
        const testValue = '\u00F6\u65E5\u672C\u8A9E'; // ö日本語
        const buffer = Buffer.allocUnsafe(32);
        const size = buffer.write(testValue, 0, 'utf8');
        const slice = buffer.toString('utf8', 0, size);
        assert.strictEqual(slice, testValue);
      }

      {
        // Test triple  slice
        const a = Buffer.allocUnsafe(8);
        for (let i = 0; i < 8; i++)
          a[i] = i;
        const b = a.slice(4, 8);
        assert.strictEqual(4, b[0]);
        assert.strictEqual(5, b[1]);
        assert.strictEqual(6, b[2]);
        assert.strictEqual(7, b[3]);
        const c = b.slice(2, 4);
        assert.strictEqual(6, c[0]);
        assert.strictEqual(7, c[1]);
      }

      {
        const d = Buffer.from([23, 42, 255]);
        assert.strictEqual(d.length, 3);
        assert.strictEqual(d[0], 23);
        assert.strictEqual(d[1], 42);
        assert.strictEqual(d[2], 255);
        assert.deepStrictEqual(d, Buffer.from(d));
      }

      {
        // Test for proper UTF-8 Encoding
        const e = Buffer.from('über');
        assert.deepStrictEqual(e, Buffer.from([195, 188, 98, 101, 114]));
      }

      {
        // Test for proper ascii Encoding, length should be 4
        const f = Buffer.from('über', 'ascii');
        assert.deepStrictEqual(f, Buffer.from([252, 98, 101, 114]));
      }

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
        {
          // Test for proper UTF16LE encoding, length should be 8
          const f = Buffer.from('über', encoding);
          assert.deepStrictEqual(f, Buffer.from([252, 0, 98, 0, 101, 0, 114, 0]));
        }

        {
          // Length should be 12
          const f = Buffer.from('привет', encoding);
          assert.deepStrictEqual(
            f, Buffer.from([63, 4, 64, 4, 56, 4, 50, 4, 53, 4, 66, 4])
          );
          assert.strictEqual(f.toString(encoding), 'привет');
        }

        {
          const f = Buffer.from([0, 0, 0, 0, 0]);
          assert.strictEqual(f.length, 5);
          const size = f.write('あいうえお', encoding);
          assert.strictEqual(size, 4);
          assert.deepStrictEqual(f, Buffer.from([0x42, 0x30, 0x44, 0x30, 0x00]));
        }
      });

      {
        const f = Buffer.from('\uD83D\uDC4D', 'utf-16le'); // THUMBS UP SIGN (U+1F44D)
        assert.strictEqual(f.length, 4);
        assert.deepStrictEqual(f, Buffer.from('3DD84DDC', 'hex'));
      }

      // Test construction from arrayish object
      {
        const arrayIsh = { 0: 0, 1: 1, 2: 2, 3: 3, length: 4 };
        let g = Buffer.from(arrayIsh);
        assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]));
        const strArrayIsh = { 0: '0', 1: '1', 2: '2', 3: '3', length: 4 };
        g = Buffer.from(strArrayIsh);
        assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]));
      }

      //
      // Test toString('base64')
      //
      assert.strictEqual('TWFu', (Buffer.from('Man')).toString('base64'));

      {
        // test that regular and URL-safe base64 both work
        const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff];
        assert.deepStrictEqual(Buffer.from('//++/++/++//', 'base64'),
                               Buffer.from(expected));
        assert.deepStrictEqual(Buffer.from('__--_--_--__', 'base64'),
                               Buffer.from(expected));
      }

      {
        // big example
        const quote = 'Man is distinguished, not only by his reason, but by this ' +
                      'singular passion from other animals, which is a lust ' +
                      'of the mind, that by a perseverance of delight in the ' +
                      'continued and indefatigable generation of knowledge, ' +
                      'exceeds the short vehemence of any carnal pleasure.';
        const expected = 'TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb' +
                         '24sIGJ1dCBieSB0aGlzIHNpbmd1bGFyIHBhc3Npb24gZnJvbSBvdGhlci' +
                         'BhbmltYWxzLCB3aGljaCBpcyBhIGx1c3Qgb2YgdGhlIG1pbmQsIHRoYXQ' +
                         'gYnkgYSBwZXJzZXZlcmFuY2Ugb2YgZGVsaWdodCBpbiB0aGUgY29udGlu' +
                         'dWVkIGFuZCBpbmRlZmF0aWdhYmxlIGdlbmVyYXRpb24gb2Yga25vd2xlZ' +
                         'GdlLCBleGNlZWRzIHRoZSBzaG9ydCB2ZWhlbWVuY2Ugb2YgYW55IGNhcm' +
                         '5hbCBwbGVhc3VyZS4=';
        assert.strictEqual(expected, (Buffer.from(quote)).toString('base64'));

        let b = Buffer.allocUnsafe(1024);
        let bytesWritten = b.write(expected, 0, 'base64');
        assert.strictEqual(quote.length, bytesWritten);
        assert.strictEqual(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder ignores whitespace
        const expectedWhite = `${expected.slice(0, 60)} \n` +
                              `${expected.slice(60, 120)} \n` +
                              `${expected.slice(120, 180)} \n` +
                              `${expected.slice(180, 240)} \n` +
                              `${expected.slice(240, 300)}\n` +
                              `${expected.slice(300, 360)}\n`;
        b = Buffer.allocUnsafe(1024);
        bytesWritten = b.write(expectedWhite, 0, 'base64');
        assert.strictEqual(quote.length, bytesWritten);
        assert.strictEqual(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder on the constructor works
        // even in the presence of whitespace.
        b = Buffer.from(expectedWhite, 'base64');
        assert.strictEqual(quote.length, b.length);
        assert.strictEqual(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder ignores illegal chars
        const expectedIllegal = expected.slice(0, 60) + ' \x80' +
                                expected.slice(60, 120) + ' \xff' +
                                expected.slice(120, 180) + ' \x00' +
                                expected.slice(180, 240) + ' \x98' +
                                expected.slice(240, 300) + '\x03' +
                                expected.slice(300, 360);
        b = Buffer.from(expectedIllegal, 'base64');
        assert.strictEqual(quote.length, b.length);
        assert.strictEqual(quote, b.toString('ascii', 0, quote.length));
      }

      assert.strictEqual(Buffer.from('', 'base64').toString(), '');
      assert.strictEqual(Buffer.from('K', 'base64').toString(), '');

      // multiple-of-4 with padding
      assert.strictEqual(Buffer.from('Kg==', 'base64').toString(), '*');
      assert.strictEqual(Buffer.from('Kio=', 'base64').toString(), '*'.repeat(2));
      assert.strictEqual(Buffer.from('Kioq', 'base64').toString(), '*'.repeat(3));
      assert.strictEqual(Buffer.from('KioqKg==', 'base64').toString(), '*'.repeat(4));
      assert.strictEqual(Buffer.from('KioqKio=', 'base64').toString(), '*'.repeat(5));
      assert.strictEqual(Buffer.from('KioqKioq', 'base64').toString(), '*'.repeat(6));
      assert.strictEqual(Buffer.from('KioqKioqKg==', 'base64').toString(),
                         '*'.repeat(7));
      assert.strictEqual(Buffer.from('KioqKioqKio=', 'base64').toString(),
                         '*'.repeat(8));
      assert.strictEqual(Buffer.from('KioqKioqKioq', 'base64').toString(),
                         '*'.repeat(9));
      assert.strictEqual(Buffer.from('KioqKioqKioqKg==', 'base64').toString(),
                         '*'.repeat(10));
      assert.strictEqual(Buffer.from('KioqKioqKioqKio=', 'base64').toString(),
                         '*'.repeat(11));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioq', 'base64').toString(),
                         '*'.repeat(12));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKg==', 'base64').toString(),
                         '*'.repeat(13));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKio=', 'base64').toString(),
                         '*'.repeat(14));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioq', 'base64').toString(),
                         '*'.repeat(15));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKg==', 'base64').toString(),
                         '*'.repeat(16));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKio=', 'base64').toString(),
                         '*'.repeat(17));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioq', 'base64').toString(),
                         '*'.repeat(18));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKg==',
                                     'base64').toString(),
                         '*'.repeat(19));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKio=',
                                     'base64').toString(),
                         '*'.repeat(20));

      // no padding, not a multiple of 4
      assert.strictEqual(Buffer.from('Kg', 'base64').toString(), '*');
      assert.strictEqual(Buffer.from('Kio', 'base64').toString(), '*'.repeat(2));
      assert.strictEqual(Buffer.from('KioqKg', 'base64').toString(), '*'.repeat(4));
      assert.strictEqual(Buffer.from('KioqKio', 'base64').toString(), '*'.repeat(5));
      assert.strictEqual(Buffer.from('KioqKioqKg', 'base64').toString(),
                         '*'.repeat(7));
      assert.strictEqual(Buffer.from('KioqKioqKio', 'base64').toString(),
                         '*'.repeat(8));
      assert.strictEqual(Buffer.from('KioqKioqKioqKg', 'base64').toString(),
                         '*'.repeat(10));
      assert.strictEqual(Buffer.from('KioqKioqKioqKio', 'base64').toString(),
                         '*'.repeat(11));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKg', 'base64').toString(),
                         '*'.repeat(13));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKio', 'base64').toString(),
                         '*'.repeat(14));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKg', 'base64').toString(),
                         '*'.repeat(16));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKio', 'base64').toString(),
                         '*'.repeat(17));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKg',
                                     'base64').toString(),
                         '*'.repeat(19));
      assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKio',
                                     'base64').toString(),
                         '*'.repeat(20));

      // handle padding graciously, multiple-of-4 or not
      assert.strictEqual(
        Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw==', 'base64').length,
        32
      );
      assert.strictEqual(
        Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw=', 'base64').length,
        32
      );
      assert.strictEqual(
        Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw', 'base64').length,
        32
      );
      assert.strictEqual(
        Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==', 'base64').length,
        31
      );
      assert.strictEqual(
        Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=', 'base64').length,
        31
      );
      assert.strictEqual(
        Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg', 'base64').length,
        31
      );

      {
      // This string encodes single '.' character in UTF-16
        const dot = Buffer.from('//4uAA==', 'base64');
        assert.strictEqual(dot[0], 0xff);
        assert.strictEqual(dot[1], 0xfe);
        assert.strictEqual(dot[2], 0x2e);
        assert.strictEqual(dot[3], 0x00);
        assert.strictEqual(dot.toString('base64'), '//4uAA==');
      }

      {
        // Writing base64 at a position > 0 should not mangle the result.
        //
        // https://github.com/joyent/node/issues/402
        const segments = ['TWFkbmVzcz8h', 'IFRoaXM=', 'IGlz', 'IG5vZGUuanMh'];
        const b = Buffer.allocUnsafe(64);
        let pos = 0;

        for (let i = 0; i < segments.length; ++i)
          pos += b.write(segments[i], pos, 'base64');

        assert.strictEqual(b.toString('latin1', 0, pos),
                           'Madness?! This is node.js!');
      }

      // Regression test for https://github.com/nodejs/node/issues/3496.
      assert.strictEqual(Buffer.from('=bad'.repeat(1e4), 'base64').length, 0);

      // Regression test for https://github.com/nodejs/node/issues/11987.
      assert.deepStrictEqual(Buffer.from('w0  ', 'base64'),
                             Buffer.from('w0', 'base64'));

      // Regression test for https://github.com/nodejs/node/issues/13657.
      assert.deepStrictEqual(Buffer.from(' YWJvcnVtLg', 'base64'),
                             Buffer.from('YWJvcnVtLg', 'base64'));

      {
        // Creating buffers larger than pool size.
        const l = Buffer.poolSize + 5;
        const s = 'h'.repeat(l);
        const b = Buffer.from(s);

        for (let i = 0; i < l; i++)
          assert.strictEqual('h'.charCodeAt(0), b[i]);

        const sb = b.toString();
        assert.strictEqual(sb.length, s.length);
        assert.strictEqual(sb, s);
      }

      {
        // test hex toString
        const hexb = Buffer.allocUnsafe(256);

        for (let i = 0; i < 256; i++)
          hexb[i] = i;

        const hexStr = hexb.toString('hex');

        assert.strictEqual(hexStr,
                           '000102030405060708090a0b0c0d0e0f' +
                           '101112131415161718191a1b1c1d1e1f' +
                           '202122232425262728292a2b2c2d2e2f' +
                           '303132333435363738393a3b3c3d3e3f' +
                           '404142434445464748494a4b4c4d4e4f' +
                           '505152535455565758595a5b5c5d5e5f' +
                           '606162636465666768696a6b6c6d6e6f' +
                           '707172737475767778797a7b7c7d7e7f' +
                           '808182838485868788898a8b8c8d8e8f' +
                           '909192939495969798999a9b9c9d9e9f' +
                           'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf' +
                           'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf' +
                           'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf' +
                           'd0d1d2d3d4d5d6d7d8d9dadbdcdddedf' +
                           'e0e1e2e3e4e5e6e7e8e9eaebecedeeef' +
                           'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');

        const hexb2 = Buffer.from(hexStr, 'hex');

        for (let i = 0; i < 256; i++)
          assert.strictEqual(hexb2[i], hexb[i]);
      }

      // Test single hex character is discarded.
      assert.strictEqual(Buffer.from('A', 'hex').length, 0);

      // Test that if a trailing character is discarded, rest of string is processed.
      assert.deepStrictEqual(Buffer.from('Abx', 'hex'), Buffer.from('Ab', 'hex'));

      // Test single base64 char encodes as 0.
      assert.strictEqual(Buffer.from('A', 'base64').length, 0);

      {
        // test an invalid slice end.
        const b = Buffer.from([1, 2, 3, 4, 5]);
        const b2 = b.toString('hex', 1, 10000);
        const b3 = b.toString('hex', 1, 5);
        const b4 = b.toString('hex', 1);
        assert.strictEqual(b2, b3);
        assert.strictEqual(b2, b4);
      }

      function buildBuffer(data) {
        if (Array.isArray(data)) {
          const buffer = Buffer.allocUnsafe(data.length);
          data.forEach((v, k) => {
            buffer[k] = v;
          });
          return buffer;
        }
        return null;
      }

      const x = buildBuffer([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]);

      assert.strictEqual('<Buffer 81 a3 66 6f 6f a3 62 61 72>', x.inspect());

      {
        const z = x.slice(4);
        assert.strictEqual(5, z.length);
        assert.strictEqual(0x6f, z[0]);
        assert.strictEqual(0xa3, z[1]);
        assert.strictEqual(0x62, z[2]);
        assert.strictEqual(0x61, z[3]);
        assert.strictEqual(0x72, z[4]);
      }

      {
        const z = x.slice(0);
        assert.strictEqual(z.length, x.length);
      }

      {
        const z = x.slice(0, 4);
        assert.strictEqual(4, z.length);
        assert.strictEqual(0x81, z[0]);
        assert.strictEqual(0xa3, z[1]);
      }

      {
        const z = x.slice(0, 9);
        assert.strictEqual(9, z.length);
      }

      {
        const z = x.slice(1, 4);
        assert.strictEqual(3, z.length);
        assert.strictEqual(0xa3, z[0]);
      }

      {
        const z = x.slice(2, 4);
        assert.strictEqual(2, z.length);
        assert.strictEqual(0x66, z[0]);
        assert.strictEqual(0x6f, z[1]);
      }

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
        const b = Buffer.allocUnsafe(10);
        b.write('あいうえお', encoding);
        assert.strictEqual(b.toString(encoding), 'あいうえお');
      });

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
        const b = Buffer.allocUnsafe(11);
        b.write('あいうえお', 1, encoding);
        assert.strictEqual(b.toString(encoding, 1), 'あいうえお');
      });

      {
        // latin1 encoding should write only one byte per character.
        const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        let s = String.fromCharCode(0xffff);
        b.write(s, 0, 'latin1');
        assert.strictEqual(0xff, b[0]);
        assert.strictEqual(0xad, b[1]);
        assert.strictEqual(0xbe, b[2]);
        assert.strictEqual(0xef, b[3]);
        s = String.fromCharCode(0xaaee);
        b.write(s, 0, 'latin1');
        assert.strictEqual(0xee, b[0]);
        assert.strictEqual(0xad, b[1]);
        assert.strictEqual(0xbe, b[2]);
        assert.strictEqual(0xef, b[3]);
      }

      {
        // Binary encoding should write only one byte per character.
        const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        let s = String.fromCharCode(0xffff);
        b.write(s, 0, 'latin1');
        assert.strictEqual(0xff, b[0]);
        assert.strictEqual(0xad, b[1]);
        assert.strictEqual(0xbe, b[2]);
        assert.strictEqual(0xef, b[3]);
        s = String.fromCharCode(0xaaee);
        b.write(s, 0, 'latin1');
        assert.strictEqual(0xee, b[0]);
        assert.strictEqual(0xad, b[1]);
        assert.strictEqual(0xbe, b[2]);
        assert.strictEqual(0xef, b[3]);
      }

      {
        // https://github.com/nodejs/node-v0.x-archive/pull/1210
        // Test UTF-8 string includes null character
        let buf = Buffer.from('\0');
        assert.strictEqual(buf.length, 1);
        buf = Buffer.from('\0\0');
        assert.strictEqual(buf.length, 2);
      }

      {
        const buf = Buffer.allocUnsafe(2);
        assert.strictEqual(buf.write(''), 0); // 0bytes
        assert.strictEqual(buf.write('\0'), 1); // 1byte (v8 adds null terminator)
        assert.strictEqual(buf.write('a\0'), 2); // 1byte * 2
        assert.strictEqual(buf.write('あ'), 0); // 3bytes
        assert.strictEqual(buf.write('\0あ'), 1); // 1byte + 3bytes
        assert.strictEqual(buf.write('\0\0あ'), 2); // 1byte * 2 + 3bytes
      }

      {
        const buf = Buffer.allocUnsafe(10);
        assert.strictEqual(buf.write('あいう'), 9); // 3bytes * 3 (v8 adds null term.)
        assert.strictEqual(buf.write('あいう\0'), 10); // 3bytes * 3 + 1byte
      }

      {
        // https://github.com/nodejs/node-v0.x-archive/issues/243
        // Test write() with maxLength
        const buf = Buffer.allocUnsafe(4);
        buf.fill(0xFF);
        assert.strictEqual(buf.write('abcd', 1, 2, 'utf8'), 2);
        assert.strictEqual(buf[0], 0xFF);
        assert.strictEqual(buf[1], 0x61);
        assert.strictEqual(buf[2], 0x62);
        assert.strictEqual(buf[3], 0xFF);

        buf.fill(0xFF);
        assert.strictEqual(buf.write('abcd', 1, 4), 3);
        assert.strictEqual(buf[0], 0xFF);
        assert.strictEqual(buf[1], 0x61);
        assert.strictEqual(buf[2], 0x62);
        assert.strictEqual(buf[3], 0x63);

        buf.fill(0xFF);
        assert.strictEqual(buf.write('abcd', 1, 2, 'utf8'), 2);
        assert.strictEqual(buf[0], 0xFF);
        assert.strictEqual(buf[1], 0x61);
        assert.strictEqual(buf[2], 0x62);
        assert.strictEqual(buf[3], 0xFF);

        buf.fill(0xFF);
        assert.strictEqual(buf.write('abcdef', 1, 2, 'hex'), 2);
        assert.strictEqual(buf[0], 0xFF);
        assert.strictEqual(buf[1], 0xAB);
        assert.strictEqual(buf[2], 0xCD);
        assert.strictEqual(buf[3], 0xFF);

        ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
          buf.fill(0xFF);
          assert.strictEqual(buf.write('abcd', 0, 2, encoding), 2);
          assert.strictEqual(buf[0], 0x61);
          assert.strictEqual(buf[1], 0x00);
          assert.strictEqual(buf[2], 0xFF);
          assert.strictEqual(buf[3], 0xFF);
        });
      }

      {
        // test offset returns are correct
        const b = Buffer.allocUnsafe(16);
        assert.strictEqual(4, b.writeUInt32LE(0, 0));
        assert.strictEqual(6, b.writeUInt16LE(0, 4));
        assert.strictEqual(7, b.writeUInt8(0, 6));
        assert.strictEqual(8, b.writeInt8(0, 7));
        assert.strictEqual(16, b.writeDoubleLE(0, 8));
      }

      {
        // test unmatched surrogates not producing invalid utf8 output
        // ef bf bd = utf-8 representation of unicode replacement character
        // see https://codereview.chromium.org/121173009/
        const buf = Buffer.from('ab\ud800cd', 'utf8');
        assert.strictEqual(buf[0], 0x61);
        assert.strictEqual(buf[1], 0x62);
        assert.strictEqual(buf[2], 0xef);
        assert.strictEqual(buf[3], 0xbf);
        assert.strictEqual(buf[4], 0xbd);
        assert.strictEqual(buf[5], 0x63);
        assert.strictEqual(buf[6], 0x64);
      }

      {
        // test for buffer overrun
        const buf = Buffer.from([0, 0, 0, 0, 0]); // length: 5
        const sub = buf.slice(0, 4);         // length: 4
        assert.strictEqual(sub.write('12345', 'latin1'), 4);
        assert.strictEqual(buf[4], 0);
        assert.strictEqual(sub.write('12345', 'binary'), 4);
        assert.strictEqual(buf[4], 0);
      }

      {
        // test alloc with fill option
        const buf = Buffer.alloc(5, '800A', 'hex');
        assert.strictEqual(buf[0], 128);
        assert.strictEqual(buf[1], 10);
        assert.strictEqual(buf[2], 128);
        assert.strictEqual(buf[3], 10);
        assert.strictEqual(buf[4], 128);
      }

      // Check for fractional length args, junk length args, etc.
      // https://github.com/joyent/node/issues/1758

      // Call .fill() first, stops valgrind warning about uninitialized memory reads.
      Buffer.allocUnsafe(3.3).fill().toString();
      // throws bad argument error in commit 43cb4ec
      Buffer.alloc(3.3).fill().toString();
      assert.strictEqual(Buffer.allocUnsafe(NaN).length, 0);
      assert.strictEqual(Buffer.allocUnsafe(3.3).length, 3);
      assert.strictEqual(Buffer.from({ length: 3.3 }).length, 3);
      assert.strictEqual(Buffer.from({ length: 'BAM' }).length, 0);

      // Make sure that strings are not coerced to numbers.
      assert.strictEqual(Buffer.from('99').length, 2);
      assert.strictEqual(Buffer.from('13.37').length, 5);

      // Ensure that the length argument is respected.
      ['ascii', 'utf8', 'hex', 'base64', 'latin1', 'binary'].forEach((enc) => {
        assert.strictEqual(Buffer.allocUnsafe(1).write('aaaaaa', 0, 1, enc), 1);
      });

      {
        // Regression test, guard against buffer overrun in the base64 decoder.
        const a = Buffer.allocUnsafe(3);
        const b = Buffer.from('xxx');
        a.write('aaaaaaaa', 'base64');
        assert.strictEqual(b.toString(), 'xxx');
      }

      // issue GH-3416
      Buffer.from(Buffer.allocUnsafe(0), 0, 0);

      // issue GH-5587
      assert.throws(() => Buffer.alloc(8).writeFloatLE(0, 5), RangeError);
      assert.throws(() => Buffer.alloc(16).writeDoubleLE(0, 9), RangeError);

      // attempt to overflow buffers, similar to previous bug in array buffers
      assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff),
                    RangeError);
      assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff),
                    RangeError);

      // ensure negative values can't get past offset
      assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1), RangeError);
      assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1), RangeError);

      // test for common write(U)IntLE/BE
      {
        let buf = Buffer.allocUnsafe(3);
        buf.writeUIntLE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
        assert.strictEqual(buf.readUIntLE(0, 3), 0x123456);

        buf.fill(0xFF);
        buf.writeUIntBE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
        assert.strictEqual(buf.readUIntBE(0, 3), 0x123456);

        buf.fill(0xFF);
        buf.writeIntLE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
        assert.strictEqual(buf.readIntLE(0, 3), 0x123456);

        buf.fill(0xFF);
        buf.writeIntBE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
        assert.strictEqual(buf.readIntBE(0, 3), 0x123456);

        buf.fill(0xFF);
        buf.writeIntLE(-0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xaa, 0xcb, 0xed]);
        assert.strictEqual(buf.readIntLE(0, 3), -0x123456);

        buf.fill(0xFF);
        buf.writeIntBE(-0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xaa]);
        assert.strictEqual(buf.readIntBE(0, 3), -0x123456);

        buf.fill(0xFF);
        buf.writeIntLE(-0x123400, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0xcc, 0xed]);
        assert.strictEqual(buf.readIntLE(0, 3), -0x123400);

        buf.fill(0xFF);
        buf.writeIntBE(-0x123400, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcc, 0x00]);
        assert.strictEqual(buf.readIntBE(0, 3), -0x123400);

        buf.fill(0xFF);
        buf.writeIntLE(-0x120000, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0xee]);
        assert.strictEqual(buf.readIntLE(0, 3), -0x120000);

        buf.fill(0xFF);
        buf.writeIntBE(-0x120000, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xee, 0x00, 0x00]);
        assert.strictEqual(buf.readIntBE(0, 3), -0x120000);

        buf = Buffer.allocUnsafe(5);
        buf.writeUIntLE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
        assert.strictEqual(buf.readUIntLE(0, 5), 0x1234567890);

        buf.fill(0xFF);
        buf.writeUIntBE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
        assert.strictEqual(buf.readUIntBE(0, 5), 0x1234567890);

        buf.fill(0xFF);
        buf.writeIntLE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
        assert.strictEqual(buf.readIntLE(0, 5), 0x1234567890);

        buf.fill(0xFF);
        buf.writeIntBE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
        assert.strictEqual(buf.readIntBE(0, 5), 0x1234567890);

        buf.fill(0xFF);
        buf.writeIntLE(-0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x70, 0x87, 0xa9, 0xcb, 0xed]);
        assert.strictEqual(buf.readIntLE(0, 5), -0x1234567890);

        buf.fill(0xFF);
        buf.writeIntBE(-0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xa9, 0x87, 0x70]);
        assert.strictEqual(buf.readIntBE(0, 5), -0x1234567890);

        buf.fill(0xFF);
        buf.writeIntLE(-0x0012000000, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0x00, 0xee, 0xff]);
        assert.strictEqual(buf.readIntLE(0, 5), -0x0012000000);

        buf.fill(0xFF);
        buf.writeIntBE(-0x0012000000, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0xff, 0xee, 0x00, 0x00, 0x00]);
        assert.strictEqual(buf.readIntBE(0, 5), -0x0012000000);
      }

      // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/5482:
      // should throw but not assert in C++ land.
      common.expectsError(
        () => Buffer.from('', 'buffer'),
        {
          code: 'ERR_UNKNOWN_ENCODING',
          type: TypeError,
          message: 'Unknown encoding: buffer'
        }
      );

      // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/6111.
      // Constructing a buffer from another buffer should a) work, and b) not corrupt
      // the source buffer.
      {
        const a = [...Array(128).keys()]; // [0, 1, 2, 3, ... 126, 127]
        const b = Buffer.from(a);
        const c = Buffer.from(b);
        assert.strictEqual(b.length, a.length);
        assert.strictEqual(c.length, a.length);
        for (let i = 0, k = a.length; i < k; ++i) {
          assert.strictEqual(a[i], i);
          assert.strictEqual(b[i], i);
          assert.strictEqual(c[i], i);
        }
      }

      const ps = Buffer.poolSize;
      Buffer.poolSize = 0;
      assert(Buffer.allocUnsafe(1).parent instanceof ArrayBuffer);
      Buffer.poolSize = ps;

      // Test Buffer.copy() segfault
      assert.throws(() => Buffer.allocUnsafe(10).copy(),
                    /TypeError: argument should be a Buffer/);

      const regErrorMsg =
        new RegExp('The first argument must be one of type string, Buffer, ' +
                   'ArrayBuffer, Array, or Array-like Object\\.');

      assert.throws(() => Buffer.from(), regErrorMsg);
      assert.throws(() => Buffer.from(null), regErrorMsg);

      // Test prototype getters don't throw
      assert.strictEqual(Buffer.prototype.parent, undefined);
      assert.strictEqual(Buffer.prototype.offset, undefined);
      assert.strictEqual(SlowBuffer.prototype.parent, undefined);
      assert.strictEqual(SlowBuffer.prototype.offset, undefined);

      {
        // Test that large negative Buffer length inputs don't affect the pool offset.
        // Use the fromArrayLike() variant here because it's more lenient
        // about its input and passes the length directly to allocate().
        assert.deepStrictEqual(Buffer.from({ length: -Buffer.poolSize }),
                               Buffer.from(''));
        assert.deepStrictEqual(Buffer.from({ length: -100 }),
                               Buffer.from(''));

        // Check pool offset after that by trying to write string into the pool.
        assert.doesNotThrow(() => Buffer.from('abc'));
      }

      // Test that ParseArrayIndex handles full uint32
      {
        const errMsg = common.expectsError({
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"offset" is outside of buffer bounds'
        });
        assert.throws(() => Buffer.from(new ArrayBuffer(0), -1 >>> 0), errMsg);
      }

      // ParseArrayIndex() should reject values that don't fit in a 32 bits size_t.
      common.expectsError(() => {
        const a = Buffer.alloc(1);
        const b = Buffer.alloc(1);
        a.copy(b, 0, 0x100000000, 0x100000001);
      }, { code: undefined, type: RangeError, message: 'Index out of range' });

      // Unpooled buffer (replaces SlowBuffer)
      {
        const ubuf = Buffer.allocUnsafeSlow(10);
        assert(ubuf);
        assert(ubuf.buffer);
        assert.strictEqual(ubuf.buffer.byteLength, 10);
      }

      // Regression test
      assert.doesNotThrow(() => Buffer.from(new ArrayBuffer()));

      // Test that ArrayBuffer from a different context is detected correctly
      const arrayBuf = vm.runInNewContext('new ArrayBuffer()');
      assert.doesNotThrow(() => Buffer.from(arrayBuf));
      assert.doesNotThrow(() => Buffer.from({ buffer: arrayBuf }));

      assert.throws(() => Buffer.alloc({ valueOf: () => 1 }),
                    /"size" argument must be of type number/);
      assert.throws(() => Buffer.alloc({ valueOf: () => -1 }),
                    /"size" argument must be of type number/);

      assert.strictEqual(Buffer.prototype.toLocaleString, Buffer.prototype.toString);
      {
        const buf = Buffer.from('test');
        assert.strictEqual(buf.toLocaleString(), buf.toString());
      }

      common.expectsError(() => {
        Buffer.alloc(0x1000, 'This is not correctly encoded', 'hex');
      }, {
        code: 'ERR_INVALID_ARG_VALUE',
        type: TypeError
      });

      common.expectsError(() => {
        Buffer.alloc(0x1000, 'c', 'hex');
      }, {
        code: 'ERR_INVALID_ARG_VALUE',
        type: TypeError
      });

      common.expectsError(() => {
        Buffer.alloc(1, Buffer.alloc(0));
      }, {
        code: 'ERR_INVALID_ARG_VALUE',
        type: TypeError
      });
    });

    it('test-buffer-arraybuffer', () => {
      const LENGTH = 16;

      const ab = new ArrayBuffer(LENGTH);
      const dv = new DataView(ab);
      const ui = new Uint8Array(ab);
      const buf = Buffer.from(ab);

      assert.ok(buf instanceof Buffer);
      assert.strictEqual(buf.parent, buf.buffer);
      assert.strictEqual(buf.buffer, ab);
      assert.strictEqual(buf.length, ab.byteLength);

      buf.fill(0xC);
      for (let i = 0; i < LENGTH; i++) {
        assert.strictEqual(ui[i], 0xC);
        ui[i] = 0xF;
        assert.strictEqual(buf[i], 0xF);
      }

      buf.writeUInt32LE(0xF00, 0);
      buf.writeUInt32BE(0xB47, 4);
      buf.writeDoubleLE(3.1415, 8);

      assert.strictEqual(dv.getUint32(0, true), 0xF00);
      assert.strictEqual(dv.getUint32(4), 0xB47);
      assert.strictEqual(dv.getFloat64(8, true), 3.1415);

      // Now test protecting users from doing stupid things

      assert.throws(() => {
        function AB() { }
        Object.setPrototypeOf(AB, ArrayBuffer);
        Object.setPrototypeOf(AB.prototype, ArrayBuffer.prototype);
        Buffer.from(new AB());
      }, TypeError);

      // write{Double,Float}{LE,BE} with noAssert should not crash, cf. #3766
      // XXX skip
      // const b = Buffer.allocUnsafe(1);
      // b.writeFloatLE(11.11, 0, true);
      // b.writeFloatBE(11.11, 0, true);
      // b.writeDoubleLE(11.11, 0, true);
      // b.writeDoubleBE(11.11, 0, true);

      // Test the byteOffset and length arguments
      {
        const ab = new Uint8Array(5);
        ab[0] = 1;
        ab[1] = 2;
        ab[2] = 3;
        ab[3] = 4;
        ab[4] = 5;
        const buf = Buffer.from(ab.buffer, 1, 3);
        assert.strictEqual(buf.length, 3);
        assert.strictEqual(buf[0], 2);
        assert.strictEqual(buf[1], 3);
        assert.strictEqual(buf[2], 4);
        buf[0] = 9;
        assert.strictEqual(ab[1], 9);

        common.expectsError(() => Buffer.from(ab.buffer, 6), {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"offset" is outside of buffer bounds'
        });
        common.expectsError(() => Buffer.from(ab.buffer, 3, 6), {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"length" is outside of buffer bounds'
        });
      }

      // Test the deprecated Buffer() version also
      {
        const ab = new Uint8Array(5);
        ab[0] = 1;
        ab[1] = 2;
        ab[2] = 3;
        ab[3] = 4;
        ab[4] = 5;
        const buf = Buffer(ab.buffer, 1, 3);
        assert.strictEqual(buf.length, 3);
        assert.strictEqual(buf[0], 2);
        assert.strictEqual(buf[1], 3);
        assert.strictEqual(buf[2], 4);
        buf[0] = 9;
        assert.strictEqual(ab[1], 9);

        common.expectsError(() => Buffer(ab.buffer, 6), {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"offset" is outside of buffer bounds'
        });
        common.expectsError(() => Buffer(ab.buffer, 3, 6), {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"length" is outside of buffer bounds'
        });
      }

      {
        // If byteOffset is not numeric, it defaults to 0.
        const ab = new ArrayBuffer(10);
        const expected = Buffer.from(ab, 0);
        assert.deepStrictEqual(Buffer.from(ab, 'fhqwhgads'), expected);
        assert.deepStrictEqual(Buffer.from(ab, NaN), expected);
        assert.deepStrictEqual(Buffer.from(ab, {}), expected);
        assert.deepStrictEqual(Buffer.from(ab, []), expected);

        // If byteOffset can be converted to a number, it will be.
        assert.deepStrictEqual(Buffer.from(ab, [1]), Buffer.from(ab, 1));

        // If byteOffset is Infinity, throw.
        common.expectsError(() => {
          Buffer.from(ab, Infinity);
        }, {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"offset" is outside of buffer bounds'
        });
      }

      {
        // If length is not numeric, it defaults to 0.
        const ab = new ArrayBuffer(10);
        const expected = Buffer.from(ab, 0, 0);
        assert.deepStrictEqual(Buffer.from(ab, 0, 'fhqwhgads'), expected);
        assert.deepStrictEqual(Buffer.from(ab, 0, NaN), expected);
        assert.deepStrictEqual(Buffer.from(ab, 0, {}), expected);
        assert.deepStrictEqual(Buffer.from(ab, 0, []), expected);

        // If length can be converted to a number, it will be.
        assert.deepStrictEqual(Buffer.from(ab, 0, [1]), Buffer.from(ab, 0, 1));

        // If length is Infinity, throw.
        common.expectsError(() => {
          Buffer.from(ab, 0, Infinity);
        }, {
          code: 'ERR_BUFFER_OUT_OF_BOUNDS',
          type: RangeError,
          message: '"length" is outside of buffer bounds'
        });
      }
    });

    it('test-buffer-ascii', () => {
      // ASCII conversion in node.js simply masks off the high bits,
      // it doesn't do transliteration.
      assert.strictEqual(Buffer.from('hérité').toString('ascii'), 'hC)ritC)');

      // 71 characters, 78 bytes. The ’ character is a triple-byte sequence.
      const input = 'C’est, graphiquement, la réunion d’un accent aigu ' +
                    'et d’un accent grave.';

      const expected = 'Cb\u0000\u0019est, graphiquement, la rC)union ' +
                       'db\u0000\u0019un accent aigu et db\u0000\u0019un ' +
                       'accent grave.';

      const buf = Buffer.from(input);

      for (let i = 0; i < expected.length; ++i) {
        assert.strictEqual(buf.slice(i).toString('ascii'), expected.slice(i));

        // Skip remainder of multi-byte sequence.
        if (input.charCodeAt(i) > 65535)
          i += 1;

        if (input.charCodeAt(i) > 127)
          i += 1;
      }
    });

    it('test-buffer-bad-overload', () => {
      assert.doesNotThrow(() => {
        Buffer.allocUnsafe(10);
      });

      const err = common.expectsError({
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "value" argument must not be of type number. ' +
                 'Received type number'
      });

      assert.throws(() => {
        Buffer.from(10, 'hex');
      }, err);

      assert.doesNotThrow(() => {
        Buffer.from('deadbeaf', 'hex');
      });
    });

    it('test-buffer-badhex', () => {
      // Test hex strings and bad hex strings
      {
        const buf = Buffer.alloc(4);
        assert.strictEqual(buf.length, 4);
        assert.deepStrictEqual(buf, new Buffer([0, 0, 0, 0]));
        assert.strictEqual(buf.write('abcdxx', 0, 'hex'), 2);
        assert.deepStrictEqual(buf, new Buffer([0xab, 0xcd, 0x00, 0x00]));
        assert.strictEqual(buf.toString('hex'), 'abcd0000');
        assert.strictEqual(buf.write('abcdef01', 0, 'hex'), 4);
        assert.deepStrictEqual(buf, new Buffer([0xab, 0xcd, 0xef, 0x01]));
        assert.strictEqual(buf.toString('hex'), 'abcdef01');
        // Node Buffer behavior check
        // > Buffer.from('abc def01','hex')
        // <Buffer ab>
        assert.strictEqual(buf.write('00000000', 0, 'hex'), 4);
        assert.strictEqual(buf.write('abc def01', 0, 'hex'), 1);
        assert.deepStrictEqual(buf, new Buffer([0xab, 0, 0, 0]));
        assert.strictEqual(buf.toString('hex'), 'ab000000');
        assert.deepStrictEqual(Buffer.from('abc def01', 'hex'), Buffer.from([0xab]));

        const copy = Buffer.from(buf.toString('hex'), 'hex');
        assert.strictEqual(buf.toString('hex'), copy.toString('hex'));
      }

      {
        const buf = Buffer.alloc(5);
        assert.strictEqual(buf.write('abcdxx', 1, 'hex'), 2);
        assert.strictEqual(buf.toString('hex'), '00abcd0000');
      }

      {
        const buf = Buffer.alloc(4);
        assert.deepStrictEqual(buf, new Buffer([0, 0, 0, 0]));
        assert.strictEqual(buf.write('xxabcd', 0, 'hex'), 0);
        assert.deepStrictEqual(buf, new Buffer([0, 0, 0, 0]));
        assert.strictEqual(buf.write('xxab', 1, 'hex'), 0);
        assert.deepStrictEqual(buf, new Buffer([0, 0, 0, 0]));
        assert.strictEqual(buf.write('cdxxab', 0, 'hex'), 1);
        assert.deepStrictEqual(buf, new Buffer([0xcd, 0, 0, 0]));
      }

      {
        const buf = Buffer.alloc(256);
        for (let i = 0; i < 256; i++)
          buf[i] = i;

        const hex = buf.toString('hex');
        assert.deepStrictEqual(Buffer.from(hex, 'hex'), buf);

        const badHex = `${hex.slice(0, 256)}xx${hex.slice(256, 510)}`;
        assert.deepStrictEqual(Buffer.from(badHex, 'hex'), buf.slice(0, 128));
      }
    });

    it('test-buffer-bigint64', () => {
      const buf = Buffer.allocUnsafe(8);

      ['LE', 'BE'].forEach((endianness) => {
        // Should allow simple BigInts to be written and read
        let val = 123456789n;
        buf['writeBigInt64' + endianness](val, 0);
        let rtn = buf['readBigInt64' + endianness](0);
        assert.strictEqual(val, rtn);

        // Should allow INT64_MAX to be written and read
        val = 0x7fffffffffffffffn;
        buf['writeBigInt64' + endianness](val, 0);
        rtn = buf['readBigInt64' + endianness](0);
        assert.strictEqual(val, rtn);

        // Should read and write a negative signed 64-bit integer
        val = -123456789n;
        buf['writeBigInt64' + endianness](val, 0);
        assert.strictEqual(val, buf['readBigInt64' + endianness](0));

        // Should read and write an unsigned 64-bit integer
        val = 123456789n;
        buf['writeBigUInt64' + endianness](val, 0);
        assert.strictEqual(val, buf['readBigUInt64' + endianness](0));

        // Should throw a RangeError upon INT64_MAX+1 being written
        assert.throws(() => {
          const val = 0x8000000000000000n;
          buf['writeBigInt64' + endianness](val, 0);
        }, RangeError);

        // Should throw a RangeError upon UINT64_MAX+1 being written
        assert.throws(() => {
          const val = 0x10000000000000000n;
          buf['writeBigUInt64' + endianness](val, 0);
        }, (err) => {
          assert(err instanceof RangeError);
          return true;
        });

        // Should throw a TypeError upon invalid input
        assert.throws(() => {
          buf['writeBigInt64' + endianness]('bad', 0);
        }, TypeError);

        // Should throw a TypeError upon invalid input
        assert.throws(() => {
          buf['writeBigUInt64' + endianness]('bad', 0);
        }, TypeError);
      });
    });

    it('test-buffer-bytelength', () => {
      [
        [32, 'latin1'],
        [NaN, 'utf8'],
        [{}, 'latin1'],
        []
      ].forEach((args) => {
        common.expectsError(
          () => Buffer.byteLength(...args),
          {
            code: 'ERR_INVALID_ARG_TYPE',
            type: TypeError,
            message: 'The "string" argument must be one of type string, ' +
                     `Buffer, or ArrayBuffer. Received type ${typeof args[0]}`
          }
        );
      });

      assert.strictEqual(Buffer.byteLength('', undefined, true), -1);

      assert(ArrayBuffer.isView(new Buffer(10)));
      assert(ArrayBuffer.isView(new SlowBuffer(10)));
      assert(ArrayBuffer.isView(Buffer.alloc(10)));
      assert(ArrayBuffer.isView(Buffer.allocUnsafe(10)));
      assert(ArrayBuffer.isView(Buffer.allocUnsafeSlow(10)));
      assert(ArrayBuffer.isView(Buffer.from('')));

      // buffer
      const incomplete = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96]);
      assert.strictEqual(Buffer.byteLength(incomplete), 5);
      const ascii = Buffer.from('abc');
      assert.strictEqual(Buffer.byteLength(ascii), 3);

      // ArrayBuffer
      const buffer = new ArrayBuffer(8);
      assert.strictEqual(Buffer.byteLength(buffer), 8);

      // TypedArray
      const int8 = new Int8Array(8);
      assert.strictEqual(Buffer.byteLength(int8), 8);
      const uint8 = new Uint8Array(8);
      assert.strictEqual(Buffer.byteLength(uint8), 8);
      const uintc8 = new Uint8ClampedArray(2);
      assert.strictEqual(Buffer.byteLength(uintc8), 2);
      const int16 = new Int16Array(8);
      assert.strictEqual(Buffer.byteLength(int16), 16);
      const uint16 = new Uint16Array(8);
      assert.strictEqual(Buffer.byteLength(uint16), 16);
      const int32 = new Int32Array(8);
      assert.strictEqual(Buffer.byteLength(int32), 32);
      const uint32 = new Uint32Array(8);
      assert.strictEqual(Buffer.byteLength(uint32), 32);
      const float32 = new Float32Array(8);
      assert.strictEqual(Buffer.byteLength(float32), 32);
      const float64 = new Float64Array(8);
      assert.strictEqual(Buffer.byteLength(float64), 64);

      // DataView
      const dv = new DataView(new ArrayBuffer(2));
      assert.strictEqual(Buffer.byteLength(dv), 2);

      // special case: zero length string
      assert.strictEqual(Buffer.byteLength('', 'ascii'), 0);
      assert.strictEqual(Buffer.byteLength('', 'HeX'), 0);

      // utf8
      assert.strictEqual(Buffer.byteLength('∑éllö wørl∂!', 'utf-8'), 19);
      assert.strictEqual(Buffer.byteLength('κλμνξο', 'utf8'), 12);
      assert.strictEqual(Buffer.byteLength('挵挶挷挸挹', 'utf-8'), 15);
      assert.strictEqual(Buffer.byteLength('𠝹𠱓𠱸', 'UTF8'), 12);
      // without an encoding, utf8 should be assumed
      assert.strictEqual(Buffer.byteLength('hey there'), 9);
      assert.strictEqual(Buffer.byteLength('𠱸挶νξ#xx :)'), 17);
      assert.strictEqual(Buffer.byteLength('hello world', ''), 11);
      // it should also be assumed with unrecognized encoding
      assert.strictEqual(Buffer.byteLength('hello world', 'abc'), 11);
      assert.strictEqual(Buffer.byteLength('ßœ∑≈', 'unkn0wn enc0ding'), 10);

      // base64
      assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ=', 'base64'), 11);
      assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ=', 'BASE64'), 11);
      assert.strictEqual(Buffer.byteLength('bm9kZS5qcyByb2NrcyE=', 'base64'), 14);
      assert.strictEqual(Buffer.byteLength('aGkk', 'base64'), 3);
      assert.strictEqual(
        Buffer.byteLength('bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==', 'base64'), 25
      );
      // special padding
      assert.strictEqual(Buffer.byteLength('aaa=', 'base64'), 2);
      assert.strictEqual(Buffer.byteLength('aaaa==', 'base64'), 3);

      assert.strictEqual(Buffer.byteLength('Il était tué'), 14);
      assert.strictEqual(Buffer.byteLength('Il était tué', 'utf8'), 14);

      ['ascii', 'latin1', 'binary']
        .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
        .forEach((encoding) => {
          assert.strictEqual(Buffer.byteLength('Il était tué', encoding), 12);
        });

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le']
        .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
        .forEach((encoding) => {
          assert.strictEqual(Buffer.byteLength('Il était tué', encoding), 24);
        });

      // Test that ArrayBuffer from a different context is detected correctly
      const arrayBuf = vm.runInNewContext('new ArrayBuffer()');
      assert.strictEqual(Buffer.byteLength(arrayBuf), 0);

      // Verify that invalid encodings are treated as utf8
      for (let i = 1; i < 10; i++) {
        const encoding = String(i).repeat(i);

        assert.ok(!Buffer.isEncoding(encoding));
        assert.strictEqual(Buffer.byteLength('foo', encoding),
                           Buffer.byteLength('foo', 'utf8'));
      }
    });

    it('test-buffer-compare-offset', () => {
      const a = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
      const b = Buffer.from([5, 6, 7, 8, 9, 0, 1, 2, 3, 4]);

      assert.strictEqual(-1, a.compare(b));

      // Equivalent to a.compare(b).
      assert.strictEqual(-1, a.compare(b, 0));
      assert.strictEqual(-1, a.compare(b, '0'));
      assert.strictEqual(-1, a.compare(b, undefined));

      // Equivalent to a.compare(b).
      assert.strictEqual(-1, a.compare(b, 0, undefined, 0));

      // Zero-length target, return 1
      assert.strictEqual(1, a.compare(b, 0, 0, 0));
      assert.strictEqual(1, a.compare(b, '0', '0', '0'));

      // Equivalent to Buffer.compare(a, b.slice(6, 10))
      assert.strictEqual(1, a.compare(b, 6, 10));

      // Zero-length source, return -1
      assert.strictEqual(-1, a.compare(b, 6, 10, 0, 0));

      // Zero-length source and target, return 0
      assert.strictEqual(0, a.compare(b, 0, 0, 0, 0));
      assert.strictEqual(0, a.compare(b, 1, 1, 2, 2));

      // Equivalent to Buffer.compare(a.slice(4), b.slice(0, 5))
      assert.strictEqual(1, a.compare(b, 0, 5, 4));

      // Equivalent to Buffer.compare(a.slice(1), b.slice(5))
      assert.strictEqual(1, a.compare(b, 5, undefined, 1));

      // Equivalent to Buffer.compare(a.slice(2), b.slice(2, 4))
      assert.strictEqual(-1, a.compare(b, 2, 4, 2));

      // Equivalent to Buffer.compare(a.slice(4), b.slice(0, 7))
      assert.strictEqual(-1, a.compare(b, 0, 7, 4));

      // Equivalent to Buffer.compare(a.slice(4, 6), b.slice(0, 7));
      assert.strictEqual(-1, a.compare(b, 0, 7, 4, 6));

      // zero length target
      assert.strictEqual(1, a.compare(b, 0, null));

      // coerces to targetEnd == 5
      assert.strictEqual(-1, a.compare(b, 0, { valueOf: () => 5 }));

      // zero length target
      assert.strictEqual(1, a.compare(b, Infinity, -Infinity));

      // zero length target because default for targetEnd <= targetSource
      assert.strictEqual(1, a.compare(b, '0xff'));

      const oor = common.expectsError({ code: 'ERR_INDEX_OUT_OF_RANGE' }, 7);

      assert.throws(() => a.compare(b, 0, 100, 0), oor);
      assert.throws(() => a.compare(b, 0, 1, 0, 100), oor);
      assert.throws(() => a.compare(b, -1), oor);
      assert.throws(() => a.compare(b, 0, '0xff'), oor);
      assert.throws(() => a.compare(b, 0, Infinity), oor);
      assert.throws(() => a.compare(b, 0, 1, -1), oor);
      assert.throws(() => a.compare(b, -Infinity, Infinity), oor);

      common.expectsError(() => a.compare(), {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "target" argument must be one of ' +
                 'type Buffer or Uint8Array. Received type undefined'
      });
    });

    it('test-buffer-compare', () => {
      const b = Buffer.alloc(1, 'a');
      const c = Buffer.alloc(1, 'c');
      const d = Buffer.alloc(2, 'aa');
      const e = new Uint8Array([0x61, 0x61]); // ASCII 'aa', same as d

      assert.strictEqual(b.compare(c), -1);
      assert.strictEqual(c.compare(d), 1);
      assert.strictEqual(d.compare(b), 1);
      assert.strictEqual(d.compare(e), 0);
      assert.strictEqual(b.compare(d), -1);
      assert.strictEqual(b.compare(b), 0);

      assert.strictEqual(Buffer.compare(b, c), -1);
      assert.strictEqual(Buffer.compare(c, d), 1);
      assert.strictEqual(Buffer.compare(d, b), 1);
      assert.strictEqual(Buffer.compare(b, d), -1);
      assert.strictEqual(Buffer.compare(c, c), 0);
      assert.strictEqual(Buffer.compare(e, e), 0);
      assert.strictEqual(Buffer.compare(d, e), 0);
      assert.strictEqual(Buffer.compare(d, b), 1);

      assert.strictEqual(Buffer.compare(Buffer.alloc(0), Buffer.alloc(0)), 0);
      assert.strictEqual(Buffer.compare(Buffer.alloc(0), Buffer.alloc(1)), -1);
      assert.strictEqual(Buffer.compare(Buffer.alloc(1), Buffer.alloc(0)), 1);

      const errMsg = common.expectsError({
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "buf1", "buf2" arguments must be one of ' +
                   'type Buffer or Uint8Array'
      }, 2);
      assert.throws(() => Buffer.compare(Buffer.alloc(1), 'abc'), errMsg);

      assert.throws(() => Buffer.compare('abc', Buffer.alloc(1)), errMsg);

      common.expectsError(() => Buffer.alloc(1).compare('abc'), {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "target" argument must be one of ' +
                 'type Buffer or Uint8Array. Received type string'
      });
    });

    it('test-buffer-concat', () => {
      const zero = [];
      const one = [Buffer.from('asdf')];
      const long = [];

      for (let i = 0; i < 10; i++)
        long.push(Buffer.from('asdf'));

      const flatZero = Buffer.concat(zero);
      const flatOne = Buffer.concat(one);
      const flatLong = Buffer.concat(long);
      const flatLongLen = Buffer.concat(long, 40);

      assert(flatZero.length === 0);
      assert(flatOne.toString() === 'asdf');
      // A special case where concat used to return the first item,
      // if the length is one. This check is to make sure that we don't do that.
      assert(flatOne !== one[0]);
      assert(flatLong.toString() === (new Array(10 + 1).join('asdf')));
      assert(flatLongLen.toString() === (new Array(10 + 1).join('asdf')));

      assertWrongList();
      assertWrongList(null);
      assertWrongList(Buffer.from('hello'));
      assertWrongList([42]);
      assertWrongList(['hello', 'world']);
      assertWrongList(['hello', Buffer.from('world')]);

      function assertWrongList(value) {
        assert.throws(() => {
          Buffer.concat(value);
        }, (err) => {
          return err instanceof TypeError &&
                 err.message === '"list" argument must be an Array of Buffers';
        });
      }
    });

    it('test-buffer-failed-alloc-typed-arrays', () => {
      // Test failed or zero-sized Buffer allocations not affecting typed
      // arrays.  This test exists because of a regression that occurred.
      // Because Buffer instances are allocated with the same underlying
      // allocator as TypedArrays, but Buffer's can optional be non-zero
      // filled, there was a regression that occurred when a Buffer allocated
      // failed, the internal flag specifying whether or not to zero-fill was
      // not being reset, causing TypedArrays to allocate incorrectly.
      const zeroArray = new Uint32Array(10).fill(0);
      const sizes = [1e10, 0, 0.1, -1, 'a', undefined, null, NaN];
      const allocators = [
        Buffer,
        SlowBuffer,
        Buffer.alloc,
        Buffer.allocUnsafe,
        Buffer.allocUnsafeSlow
      ];

      for (const allocator of allocators) {
        for (const size of sizes) {
          try {
            // These allocations are known to fail. If they do,
            // Uint32Array should still produce a zeroed out result.
            allocator(size);
          } catch (e) {
            assert.deepStrictEqual(new Uint32Array(10), zeroArray);
          }
        }
      }
    });

    it('test-buffer-fill', () => {
      const SIZE = 28;

      const buf1 = Buffer.allocUnsafe(SIZE);
      const buf2 = Buffer.allocUnsafe(SIZE);

      // Default encoding
      testBufs('abc');
      testBufs('\u0222aa');
      testBufs('a\u0234b\u0235c\u0236');
      testBufs('abc', 4);
      testBufs('abc', 5);
      testBufs('abc', SIZE);
      testBufs('\u0222aa', 2);
      testBufs('\u0222aa', 8);
      testBufs('a\u0234b\u0235c\u0236', 4);
      testBufs('a\u0234b\u0235c\u0236', 12);
      testBufs('abc', 4, -1);
      testBufs('abc', 4, 1);
      testBufs('abc', 5, 1);
      testBufs('\u0222aa', 2, -1);
      testBufs('\u0222aa', 8, 1);
      testBufs('a\u0234b\u0235c\u0236', 4, -1);
      testBufs('a\u0234b\u0235c\u0236', 4, 1);
      testBufs('a\u0234b\u0235c\u0236', 12, 1);

      // UTF8
      testBufs('abc', 'utf8');
      testBufs('\u0222aa', 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 'utf8');
      testBufs('abc', 4, 'utf8');
      testBufs('abc', 5, 'utf8');
      testBufs('abc', SIZE, 'utf8');
      testBufs('\u0222aa', 2, 'utf8');
      testBufs('\u0222aa', 8, 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 4, 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 12, 'utf8');
      testBufs('abc', 4, -1, 'utf8');
      testBufs('abc', 4, 1, 'utf8');
      testBufs('abc', 5, 1, 'utf8');
      testBufs('\u0222aa', 2, -1, 'utf8');
      testBufs('\u0222aa', 8, 1, 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 4, -1, 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 4, 1, 'utf8');
      testBufs('a\u0234b\u0235c\u0236', 12, 1, 'utf8');
      assert.equal(Buffer.allocUnsafe(1).fill(0).fill('\u0222')[0], 0xc8);

      // BINARY
      testBufs('abc', 'binary');
      testBufs('\u0222aa', 'binary');
      testBufs('a\u0234b\u0235c\u0236', 'binary');
      testBufs('abc', 4, 'binary');
      testBufs('abc', 5, 'binary');
      testBufs('abc', SIZE, 'binary');
      testBufs('\u0222aa', 2, 'binary');
      testBufs('\u0222aa', 8, 'binary');
      testBufs('a\u0234b\u0235c\u0236', 4, 'binary');
      testBufs('a\u0234b\u0235c\u0236', 12, 'binary');
      testBufs('abc', 4, -1, 'binary');
      testBufs('abc', 4, 1, 'binary');
      testBufs('abc', 5, 1, 'binary');
      testBufs('\u0222aa', 2, -1, 'binary');
      testBufs('\u0222aa', 8, 1, 'binary');
      testBufs('a\u0234b\u0235c\u0236', 4, -1, 'binary');
      testBufs('a\u0234b\u0235c\u0236', 4, 1, 'binary');
      testBufs('a\u0234b\u0235c\u0236', 12, 1, 'binary');

      // LATIN1
      testBufs('abc', 'latin1');
      testBufs('\u0222aa', 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 'latin1');
      testBufs('abc', 4, 'latin1');
      testBufs('abc', 5, 'latin1');
      testBufs('abc', SIZE, 'latin1');
      testBufs('\u0222aa', 2, 'latin1');
      testBufs('\u0222aa', 8, 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 4, 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 12, 'latin1');
      testBufs('abc', 4, -1, 'latin1');
      testBufs('abc', 4, 1, 'latin1');
      testBufs('abc', 5, 1, 'latin1');
      testBufs('\u0222aa', 2, -1, 'latin1');
      testBufs('\u0222aa', 8, 1, 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 4, -1, 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 4, 1, 'latin1');
      testBufs('a\u0234b\u0235c\u0236', 12, 1, 'latin1');

      // UCS2
      testBufs('abc', 'ucs2');
      testBufs('\u0222aa', 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 'ucs2');
      testBufs('abc', 4, 'ucs2');
      testBufs('abc', SIZE, 'ucs2');
      testBufs('\u0222aa', 2, 'ucs2');
      testBufs('\u0222aa', 8, 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 4, 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 12, 'ucs2');
      testBufs('abc', 4, -1, 'ucs2');
      testBufs('abc', 4, 1, 'ucs2');
      testBufs('abc', 5, 1, 'ucs2');
      testBufs('\u0222aa', 2, -1, 'ucs2');
      testBufs('\u0222aa', 8, 1, 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 4, -1, 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 4, 1, 'ucs2');
      testBufs('a\u0234b\u0235c\u0236', 12, 1, 'ucs2');
      assert.equal(Buffer.allocUnsafe(1).fill('\u0222', 'ucs2')[0],
                   os.endianness() === 'LE' ? 0x22 : 0x02);

      // HEX
      testBufs('616263', 'hex');
      testBufs('c8a26161', 'hex');
      testBufs('61c8b462c8b563c8b6', 'hex');
      testBufs('616263', 4, 'hex');
      testBufs('616263', 5, 'hex');
      testBufs('616263', SIZE, 'hex');
      testBufs('c8a26161', 2, 'hex');
      testBufs('c8a26161', 8, 'hex');
      testBufs('61c8b462c8b563c8b6', 4, 'hex');
      testBufs('61c8b462c8b563c8b6', 12, 'hex');
      testBufs('616263', 4, -1, 'hex');
      testBufs('616263', 4, 1, 'hex');
      testBufs('616263', 5, 1, 'hex');
      testBufs('c8a26161', 2, -1, 'hex');
      testBufs('c8a26161', 8, 1, 'hex');
      testBufs('61c8b462c8b563c8b6', 4, -1, 'hex');
      testBufs('61c8b462c8b563c8b6', 4, 1, 'hex');
      testBufs('61c8b462c8b563c8b6', 12, 1, 'hex');

      common.expectsError(() => {
        const buf = Buffer.allocUnsafe(SIZE);

        buf.fill('yKJh', 'hex');
      }, {
        code: 'ERR_INVALID_ARG_VALUE',
        type: TypeError
      });

      common.expectsError(() => {
        const buf = Buffer.allocUnsafe(SIZE);

        buf.fill('\u0222', 'hex');
      }, {
        code: 'ERR_INVALID_ARG_VALUE',
        type: TypeError
      });

      // BASE64
      testBufs('YWJj', 'ucs2');
      testBufs('yKJhYQ==', 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 'ucs2');
      testBufs('YWJj', 4, 'ucs2');
      testBufs('YWJj', SIZE, 'ucs2');
      testBufs('yKJhYQ==', 2, 'ucs2');
      testBufs('yKJhYQ==', 8, 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 4, 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 12, 'ucs2');
      testBufs('YWJj', 4, -1, 'ucs2');
      testBufs('YWJj', 4, 1, 'ucs2');
      testBufs('YWJj', 5, 1, 'ucs2');
      testBufs('yKJhYQ==', 2, -1, 'ucs2');
      testBufs('yKJhYQ==', 8, 1, 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 4, -1, 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 4, 1, 'ucs2');
      testBufs('Yci0Ysi1Y8i2', 12, 1, 'ucs2');

      // Buffer
      function deepStrictEqualValues(buf, arr) {
        for (const [index, value] of buf.entries())
          assert.deepStrictEqual(value, arr[index]);
      }

      const buf2Fill = Buffer.allocUnsafe(1).fill(2);
      deepStrictEqualValues(genBuffer(4, [buf2Fill]), [2, 2, 2, 2]);
      deepStrictEqualValues(genBuffer(4, [buf2Fill, 1]), [0, 2, 2, 2]);
      deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 3]), [0, 2, 2, 0]);
      deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 1]), [0, 0, 0, 0]);
      deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, -1]), [0, 0, 0, 0]);
      const hexBufFill = Buffer.allocUnsafe(2).fill(0).fill('0102', 'hex');
      deepStrictEqualValues(genBuffer(4, [hexBufFill]), [1, 2, 1, 2]);
      deepStrictEqualValues(genBuffer(4, [hexBufFill, 1]), [0, 1, 2, 1]);
      deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 3]), [0, 1, 2, 0]);
      deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 1]), [0, 0, 0, 0]);
      deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, -1]), [0, 0, 0, 0]);

      // Check exceptions
      assert.throws(() => buf1.fill(0, -1));
      assert.throws(() => buf1.fill(0, 0, buf1.length + 1));
      assert.throws(() => buf1.fill('', -1));
      assert.throws(() => buf1.fill('', 0, buf1.length + 1));
      assert.throws(() => buf1.fill('a', 0, buf1.length, 'node rocks!'));
      assert.throws(() => buf1.fill('a', 0, 0, NaN));
      assert.throws(() => buf1.fill('a', 0, 0, null));
      assert.throws(() => buf1.fill('a', 0, 0, 'foo'));

      function genBuffer(size, args) {
        const b = Buffer.allocUnsafe(size);
        return b.fill(0).fill.apply(b, args);
      }

      function bufReset() {
        buf1.fill(0);
        buf2.fill(0);
      }

      // This is mostly accurate. Except write() won't write partial bytes to the
      // string while fill() blindly copies bytes into memory. To account for that an
      // error will be thrown if not all the data can be written, and the SIZE has
      // been massaged to work with the input characters.
      function writeToFill(string, offset, end, encoding) {
        if (typeof offset === 'string') {
          encoding = offset;
          offset = 0;
          end = buf2.length;
        } else if (typeof end === 'string') {
          encoding = end;
          end = buf2.length;
        } else if (end === undefined) {
          end = buf2.length;
        }

        if (offset < 0 || end > buf2.length)
          throw new RangeError('Out of range index');

        if (end <= offset)
          return buf2;

        offset >>>= 0;
        end >>>= 0;
        assert(offset <= buf2.length);

        // Convert "end" to "length" (which write understands).
        const length = end - offset < 0 ? 0 : end - offset;

        let wasZero = false;
        do {
          const written = buf2.write(string, offset, length, encoding);
          offset += written;
          // Safety check in case write falls into infinite loop.
          if (written === 0) {
            if (wasZero)
              throw new Error('Could not write all data to Buffer');
            else
              wasZero = true;
          }
        } while (offset < buf2.length);

        // Correction for UCS2 operations.
        if (os.endianness() === 'BE' && encoding === 'ucs2') {
          for (let i = 0; i < buf2.length; i += 2) {
            const tmp = buf2[i];
            buf2[i] = buf2[i + 1];
            buf2[i + 1] = tmp;
          }
        }

        return buf2;
      }

      function testBufs(string, offset, length, encoding) {
        bufReset();
        buf1.fill.apply(buf1, arguments);
        // Swap bytes on BE archs for ucs2 encoding.
        assert.deepStrictEqual(buf1.fill.apply(buf1, arguments),
                               writeToFill.apply(null, arguments));
      }
    });

    it('test-buffer-from', () => {
      const checkString = 'test';

      const check = Buffer.from(checkString);

      class MyString extends String {
        constructor() {
          super(checkString);
        }
      }

      class MyPrimitive {
        [Symbol.toPrimitive]() {
          return checkString;
        }
      }

      class MyBadPrimitive {
        [Symbol.toPrimitive]() {
          return 1;
        }
      }

      assert.deepStrictEqual(Buffer.from(new String(checkString)), check);
      assert.deepStrictEqual(Buffer.from(new MyString()), check);
      assert.deepStrictEqual(Buffer.from(new MyPrimitive()), check);
      assert.deepStrictEqual(
        Buffer.from(vm.runInNewContext('new String(checkString)',
                                       { checkString })),
        check
      );

      [
        [{}, 'object'],
        [new Boolean(true), 'boolean'],
        [{ valueOf: () => null }, 'object'],
        [{ valueOf: () => undefined }, 'object'],
        [{ valueOf: null }, 'object'],
        [Object.create(null), 'object']
      ].forEach(([input, actualType]) => {
        const err = common.expectsError({
          code: 'ERR_INVALID_ARG_TYPE',
          type: TypeError,
          message: 'The first argument must be one of type string, Buffer, ' +
                   'ArrayBuffer, Array, or Array-like Object. Received ' +
                   `type ${actualType}`
        });
        assert.throws(() => Buffer.from(input), err);
      });

      [
        new Number(true),
        new MyBadPrimitive()
      ].forEach((input) => {
        const errMsg = common.expectsError({
          code: 'ERR_INVALID_ARG_TYPE',
          type: TypeError,
          message: 'The "value" argument must not be of type number. ' +
                   'Received type number'
        });
        assert.throws(() => Buffer.from(input), errMsg);
      });
    });

    it('test-buffer-includes', () => {
      const b = Buffer.from('abcdef');
      const buf_a = Buffer.from('a');
      const buf_bc = Buffer.from('bc');
      const buf_f = Buffer.from('f');
      const buf_z = Buffer.from('z');
      const buf_empty = Buffer.from('');

      assert(b.includes('a'));
      assert(!b.includes('a', 1));
      assert(!b.includes('a', -1));
      assert(!b.includes('a', -4));
      assert(b.includes('a', -b.length));
      assert(b.includes('a', NaN));
      assert(b.includes('a', -Infinity));
      assert(!b.includes('a', Infinity));
      assert(b.includes('bc'));
      assert(!b.includes('bc', 2));
      assert(!b.includes('bc', -1));
      assert(!b.includes('bc', -3));
      assert(b.includes('bc', -5));
      assert(b.includes('bc', NaN));
      assert(b.includes('bc', -Infinity));
      assert(!b.includes('bc', Infinity));
      assert(b.includes('f'), b.length - 1);
      assert(!b.includes('z'));
      assert(!b.includes(''));
      assert(!b.includes('', 1));
      assert(!b.includes('', b.length + 1));
      assert(!b.includes('', Infinity));
      assert(b.includes(buf_a));
      assert(!b.includes(buf_a, 1));
      assert(!b.includes(buf_a, -1));
      assert(!b.includes(buf_a, -4));
      assert(b.includes(buf_a, -b.length));
      assert(b.includes(buf_a, NaN));
      assert(b.includes(buf_a, -Infinity));
      assert(!b.includes(buf_a, Infinity));
      assert(b.includes(buf_bc));
      assert(!b.includes(buf_bc, 2));
      assert(!b.includes(buf_bc, -1));
      assert(!b.includes(buf_bc, -3));
      assert(b.includes(buf_bc, -5));
      assert(b.includes(buf_bc, NaN));
      assert(b.includes(buf_bc, -Infinity));
      assert(!b.includes(buf_bc, Infinity));
      assert(b.includes(buf_f), b.length - 1);
      assert(!b.includes(buf_z));
      assert(!b.includes(buf_empty));
      assert(!b.includes(buf_empty, 1));
      assert(!b.includes(buf_empty, b.length + 1));
      assert(!b.includes(buf_empty, Infinity));
      assert(b.includes(0x61));
      assert(!b.includes(0x61, 1));
      assert(!b.includes(0x61, -1));
      assert(!b.includes(0x61, -4));
      assert(b.includes(0x61, -b.length));
      assert(b.includes(0x61, NaN));
      assert(b.includes(0x61, -Infinity));
      assert(!b.includes(0x61, Infinity));
      assert(!b.includes(0x0));

      // test offsets
      assert(b.includes('d', 2));
      assert(b.includes('f', 5));
      assert(b.includes('f', -1));
      assert(!b.includes('f', 6));

      assert(b.includes(Buffer.from('d'), 2));
      assert(b.includes(Buffer.from('f'), 5));
      assert(b.includes(Buffer.from('f'), -1));
      assert(!b.includes(Buffer.from('f'), 6));

      assert(!Buffer.from('ff').includes(Buffer.from('f'), 1, 'ucs2'));

      // test hex encoding
      assert.strictEqual(
        Buffer.from(b.toString('hex'), 'hex')
          .includes('64', 0, 'hex'),
        true
      );
      assert.strictEqual(
        Buffer.from(b.toString('hex'), 'hex')
          .includes(Buffer.from('64', 'hex'), 0, 'hex'),
        true
      );

      // test base64 encoding
      assert.strictEqual(
        Buffer.from(b.toString('base64'), 'base64')
          .includes('ZA==', 0, 'base64'),
        true
      );
      assert.strictEqual(
        Buffer.from(b.toString('base64'), 'base64')
          .includes(Buffer.from('ZA==', 'base64'), 0, 'base64'),
        true
      );

      // test ascii encoding
      assert.strictEqual(
        Buffer.from(b.toString('ascii'), 'ascii')
          .includes('d', 0, 'ascii'),
        true
      );
      assert.strictEqual(
        Buffer.from(b.toString('ascii'), 'ascii')
          .includes(Buffer.from('d', 'ascii'), 0, 'ascii'),
        true
      );

      // test latin1 encoding
      assert.strictEqual(
        Buffer.from(b.toString('latin1'), 'latin1')
          .includes('d', 0, 'latin1'),
        true
      );
      assert.strictEqual(
        Buffer.from(b.toString('latin1'), 'latin1')
          .includes(Buffer.from('d', 'latin1'), 0, 'latin1'),
        true
      );

      // test binary encoding
      assert.strictEqual(
        Buffer.from(b.toString('binary'), 'binary')
          .includes('d', 0, 'binary'),
        true
      );
      assert.strictEqual(
        Buffer.from(b.toString('binary'), 'binary')
          .includes(Buffer.from('d', 'binary'), 0, 'binary'),
        true
      );

      // test usc2 encoding
      let twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2');

      assert(twoByteString.includes('\u0395', 4, 'ucs2'));
      assert(twoByteString.includes('\u03a3', -4, 'ucs2'));
      assert(twoByteString.includes('\u03a3', -6, 'ucs2'));
      assert(twoByteString.includes(
        Buffer.from('\u03a3', 'ucs2'), -6, 'ucs2'));
      assert(!twoByteString.includes('\u03a3', -2, 'ucs2'));

      const mixedByteStringUcs2 =
          Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395', 'ucs2');
      assert(mixedByteStringUcs2.includes('bc', 0, 'ucs2'));
      assert(mixedByteStringUcs2.includes('\u03a3', 0, 'ucs2'));
      assert(!mixedByteStringUcs2.includes('\u0396', 0, 'ucs2'));

      assert(
          6, mixedByteStringUcs2.includes(Buffer.from('bc', 'ucs2'), 0, 'ucs2'));
      assert(
          10, mixedByteStringUcs2.includes(Buffer.from('\u03a3', 'ucs2'),
          0, 'ucs2'));
      assert(
          -1, mixedByteStringUcs2.includes(Buffer.from('\u0396', 'ucs2'),
          0, 'ucs2'));

      twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2');

      // Test single char pattern
      assert(twoByteString.includes('\u039a', 0, 'ucs2'));
      assert(twoByteString.includes('\u0391', 0, 'ucs2'), 'Alpha');
      assert(twoByteString.includes('\u03a3', 0, 'ucs2'), 'First Sigma');
      assert(twoByteString.includes('\u03a3', 6, 'ucs2'), 'Second Sigma');
      assert(twoByteString.includes('\u0395', 0, 'ucs2'), 'Epsilon');
      assert(!twoByteString.includes('\u0392', 0, 'ucs2'), 'Not beta');

      // Test multi-char pattern
      assert(twoByteString.includes('\u039a\u0391', 0, 'ucs2'), 'Lambda Alpha');
      assert(twoByteString.includes('\u0391\u03a3', 0, 'ucs2'), 'Alpha Sigma');
      assert(twoByteString.includes('\u03a3\u03a3', 0, 'ucs2'), 'Sigma Sigma');
      assert(twoByteString.includes('\u03a3\u0395', 0, 'ucs2'), 'Sigma Epsilon');

      const mixedByteStringUtf8 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395');
      assert(mixedByteStringUtf8.includes('bc'));
      assert(mixedByteStringUtf8.includes('bc', 5));
      assert(mixedByteStringUtf8.includes('bc', -8));
      assert(mixedByteStringUtf8.includes('\u03a3'));
      assert(!mixedByteStringUtf8.includes('\u0396'));

      // Test complex string includes algorithms. Only trigger for long strings.
      // Long string that isn't a simple repeat of a shorter string.
      let longString = 'A';
      for (let i = 66; i < 76; i++) // from 'B' to 'K'
        longString = longString + String.fromCharCode(i) + longString;

      const longBufferString = Buffer.from(longString);

      // pattern of 15 chars, repeated every 16 chars in long
      let pattern = 'ABACABADABACABA';
      for (let i = 0; i < longBufferString.length - pattern.length; i += 7) {
        const includes = longBufferString.includes(pattern, i);
        assert(includes, 'Long ABACABA...-string at index ' + i);
      }
      assert(longBufferString.includes('AJABACA'), 'Long AJABACA, First J');
      assert(longBufferString.includes('AJABACA', 511), 'Long AJABACA, Second J');

      pattern = 'JABACABADABACABA';
      assert(longBufferString.includes(pattern), 'Long JABACABA..., First J');
      assert(longBufferString.includes(pattern, 512), 'Long JABACABA..., Second J');

      // Search for a non-ASCII string in a pure ASCII string.
      const asciiString = Buffer.from(
          'arglebargleglopglyfarglebargleglopglyfarglebargleglopglyf');
      assert(!asciiString.includes('\x2061'));
      assert(asciiString.includes('leb', 0));

      // Search in string containing many non-ASCII chars.
      const allCodePoints = [];
      for (let i = 0; i < 65536; i++)
        allCodePoints[i] = i;
      const allCharsString = String.fromCharCode.apply(String, allCodePoints);
      const allCharsBufferUtf8 = Buffer.from(allCharsString);
      const allCharsBufferUcs2 = Buffer.from(allCharsString, 'ucs2');

      // Search for string long enough to trigger complex search with ASCII pattern
      // and UC16 subject.
      assert(!allCharsBufferUtf8.includes('notfound'));
      assert(!allCharsBufferUcs2.includes('notfound'));

      // Find substrings in Utf8.
      let lengths = [1, 3, 15];  // Single char, simple and complex.
      let indices = [0x5, 0x60, 0x400, 0x680, 0x7ee, 0xFF02, 0x16610, 0x2f77b];
      for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i];
          let length = lengths[lengthIndex];

          if (index + length > 0x7F)
            length = 2 * length;

          if (index + length > 0x7FF)
            length = 3 * length;

          if (index + length > 0xFFFF)
            length = 4 * length;

          const patternBufferUtf8 = allCharsBufferUtf8.slice(index, index + length);
          assert(index, allCharsBufferUtf8.includes(patternBufferUtf8));

          const patternStringUtf8 = patternBufferUtf8.toString();
          assert(index, allCharsBufferUtf8.includes(patternStringUtf8));
        }
      }

      // Find substrings in Usc2.
      lengths = [2, 4, 16];  // Single char, simple and complex.
      indices = [0x5, 0x65, 0x105, 0x205, 0x285, 0x2005, 0x2085, 0xfff0];
      for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i] * 2;
          const length = lengths[lengthIndex];

          const patternBufferUcs2 =
              allCharsBufferUcs2.slice(index, index + length);
          assert(
              index, allCharsBufferUcs2.includes(patternBufferUcs2, 0, 'ucs2'));

          const patternStringUcs2 = patternBufferUcs2.toString('ucs2');
          assert(
              index, allCharsBufferUcs2.includes(patternStringUcs2, 0, 'ucs2'));
        }
      }

      assert.throws(() => {
        b.includes(() => { });
      });
      assert.throws(() => {
        b.includes({});
      });
      assert.throws(() => {
        b.includes([]);
      });

      // test truncation of Number arguments to uint8
      {
        const buf = Buffer.from('this is a test');
        assert.ok(buf.includes(0x6973));
        assert.ok(buf.includes(0x697320));
        assert.ok(buf.includes(0x69732069));
        assert.ok(buf.includes(0x697374657374));
        assert.ok(buf.includes(0x69737374));
        assert.ok(buf.includes(0x69737465));
        assert.ok(buf.includes(0x69737465));
        assert.ok(buf.includes(-140));
        assert.ok(buf.includes(-152));
        assert.ok(!buf.includes(0xff));
        assert.ok(!buf.includes(0xffff));
      }
    });

    it('test-buffer-indexof', () => {
      const b = Buffer.from('abcdef');
      const buf_a = Buffer.from('a');
      const buf_bc = Buffer.from('bc');
      const buf_f = Buffer.from('f');
      const buf_z = Buffer.from('z');
      const buf_empty = Buffer.from('');

      assert.equal(b.indexOf('a'), 0);
      assert.equal(b.indexOf('a', 1), -1);
      assert.equal(b.indexOf('a', -1), -1);
      assert.equal(b.indexOf('a', -4), -1);
      assert.equal(b.indexOf('a', -b.length), 0);
      assert.equal(b.indexOf('a', NaN), 0);
      assert.equal(b.indexOf('a', -Infinity), 0);
      assert.equal(b.indexOf('a', Infinity), -1);
      assert.equal(b.indexOf('bc'), 1);
      assert.equal(b.indexOf('bc', 2), -1);
      assert.equal(b.indexOf('bc', -1), -1);
      assert.equal(b.indexOf('bc', -3), -1);
      assert.equal(b.indexOf('bc', -5), 1);
      assert.equal(b.indexOf('bc', NaN), 1);
      assert.equal(b.indexOf('bc', -Infinity), 1);
      assert.equal(b.indexOf('bc', Infinity), -1);
      assert.equal(b.indexOf('f'), b.length - 1);
      assert.equal(b.indexOf('z'), -1);
      assert.equal(b.indexOf(''), -1);
      assert.equal(b.indexOf('', 1), -1);
      assert.equal(b.indexOf('', b.length + 1), -1);
      assert.equal(b.indexOf('', Infinity), -1);
      assert.equal(b.indexOf(buf_a), 0);
      assert.equal(b.indexOf(buf_a, 1), -1);
      assert.equal(b.indexOf(buf_a, -1), -1);
      assert.equal(b.indexOf(buf_a, -4), -1);
      assert.equal(b.indexOf(buf_a, -b.length), 0);
      assert.equal(b.indexOf(buf_a, NaN), 0);
      assert.equal(b.indexOf(buf_a, -Infinity), 0);
      assert.equal(b.indexOf(buf_a, Infinity), -1);
      assert.equal(b.indexOf(buf_bc), 1);
      assert.equal(b.indexOf(buf_bc, 2), -1);
      assert.equal(b.indexOf(buf_bc, -1), -1);
      assert.equal(b.indexOf(buf_bc, -3), -1);
      assert.equal(b.indexOf(buf_bc, -5), 1);
      assert.equal(b.indexOf(buf_bc, NaN), 1);
      assert.equal(b.indexOf(buf_bc, -Infinity), 1);
      assert.equal(b.indexOf(buf_bc, Infinity), -1);
      assert.equal(b.indexOf(buf_f), b.length - 1);
      assert.equal(b.indexOf(buf_z), -1);
      assert.equal(b.indexOf(buf_empty), -1);
      assert.equal(b.indexOf(buf_empty, 1), -1);
      assert.equal(b.indexOf(buf_empty, b.length + 1), -1);
      assert.equal(b.indexOf(buf_empty, Infinity), -1);
      assert.equal(b.indexOf(0x61), 0);
      assert.equal(b.indexOf(0x61, 1), -1);
      assert.equal(b.indexOf(0x61, -1), -1);
      assert.equal(b.indexOf(0x61, -4), -1);
      assert.equal(b.indexOf(0x61, -b.length), 0);
      assert.equal(b.indexOf(0x61, NaN), 0);
      assert.equal(b.indexOf(0x61, -Infinity), 0);
      assert.equal(b.indexOf(0x61, Infinity), -1);
      assert.equal(b.indexOf(0x0), -1);

      // test offsets
      assert.equal(b.indexOf('d', 2), 3);
      assert.equal(b.indexOf('f', 5), 5);
      assert.equal(b.indexOf('f', -1), 5);
      assert.equal(b.indexOf('f', 6), -1);

      assert.equal(b.indexOf(Buffer.from('d'), 2), 3);
      assert.equal(b.indexOf(Buffer.from('f'), 5), 5);
      assert.equal(b.indexOf(Buffer.from('f'), -1), 5);
      assert.equal(b.indexOf(Buffer.from('f'), 6), -1);

      assert.equal(Buffer.from('ff').indexOf(Buffer.from('f'), 1, 'ucs2'), -1);

      // test hex encoding
      assert.strictEqual(
        Buffer.from(b.toString('hex'), 'hex')
          .indexOf('64', 0, 'hex'),
        3
      );
      assert.strictEqual(
        Buffer.from(b.toString('hex'), 'hex')
          .indexOf(Buffer.from('64', 'hex'), 0, 'hex'),
        3
      );

      // test base64 encoding
      assert.strictEqual(
        Buffer.from(b.toString('base64'), 'base64')
          .indexOf('ZA==', 0, 'base64'),
        3
      );
      assert.strictEqual(
        Buffer.from(b.toString('base64'), 'base64')
          .indexOf(Buffer.from('ZA==', 'base64'), 0, 'base64'),
        3
      );

      // test ascii encoding
      assert.strictEqual(
        Buffer.from(b.toString('ascii'), 'ascii')
          .indexOf('d', 0, 'ascii'),
        3
      );
      assert.strictEqual(
        Buffer.from(b.toString('ascii'), 'ascii')
          .indexOf(Buffer.from('d', 'ascii'), 0, 'ascii'),
        3
      );

      // test latin1 encoding
      assert.strictEqual(
        Buffer.from(b.toString('latin1'), 'latin1')
          .indexOf('d', 0, 'latin1'),
        3
      );
      assert.strictEqual(
        Buffer.from(b.toString('latin1'), 'latin1')
          .indexOf(Buffer.from('d', 'latin1'), 0, 'latin1'),
        3
      );
      assert.strictEqual(
        Buffer.from('aa\u00e8aa', 'latin1')
          .indexOf('\u00e8', 'latin1'),
        2
      );
      assert.strictEqual(
        Buffer.from('\u00e8', 'latin1')
          .indexOf('\u00e8', 'latin1'),
        0
      );
      assert.strictEqual(
        Buffer.from('\u00e8', 'latin1')
          .indexOf(Buffer.from('\u00e8', 'latin1'), 'latin1'),
        0
      );

      // test binary encoding
      assert.strictEqual(
        Buffer.from(b.toString('binary'), 'binary')
          .indexOf('d', 0, 'binary'),
        3
      );
      assert.strictEqual(
        Buffer.from(b.toString('binary'), 'binary')
          .indexOf(Buffer.from('d', 'binary'), 0, 'binary'),
        3
      );
      assert.strictEqual(
        Buffer.from('aa\u00e8aa', 'binary')
          .indexOf('\u00e8', 'binary'),
        2
      );
      assert.strictEqual(
        Buffer.from('\u00e8', 'binary')
          .indexOf('\u00e8', 'binary'),
        0
      );
      assert.strictEqual(
        Buffer.from('\u00e8', 'binary')
          .indexOf(Buffer.from('\u00e8', 'binary'), 'binary'),
        0
      );

      // test optional offset with passed encoding
      assert.equal(Buffer.from('aaaa0').indexOf('30', 'hex'), 4);
      assert.equal(Buffer.from('aaaa00a').indexOf('3030', 'hex'), 4);

      {
        // test usc2 encoding
        const twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2');

        assert.equal(8, twoByteString.indexOf('\u0395', 4, 'ucs2'));
        assert.equal(6, twoByteString.indexOf('\u03a3', -4, 'ucs2'));
        assert.equal(4, twoByteString.indexOf('\u03a3', -6, 'ucs2'));
        assert.equal(4, twoByteString.indexOf(
          Buffer.from('\u03a3', 'ucs2'), -6, 'ucs2'));
        assert.equal(-1, twoByteString.indexOf('\u03a3', -2, 'ucs2'));
      }

      const mixedByteStringUcs2 =
          Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395', 'ucs2');
      assert.equal(6, mixedByteStringUcs2.indexOf('bc', 0, 'ucs2'));
      assert.equal(10, mixedByteStringUcs2.indexOf('\u03a3', 0, 'ucs2'));
      assert.equal(-1, mixedByteStringUcs2.indexOf('\u0396', 0, 'ucs2'));

      assert.equal(
          6, mixedByteStringUcs2.indexOf(Buffer.from('bc', 'ucs2'), 0, 'ucs2'));
      assert.equal(
          10, mixedByteStringUcs2.indexOf(Buffer.from('\u03a3', 'ucs2'), 0, 'ucs2'));
      assert.equal(
          -1, mixedByteStringUcs2.indexOf(Buffer.from('\u0396', 'ucs2'), 0, 'ucs2'));

      {
        const twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2');

        // Test single char pattern
        assert.equal(0, twoByteString.indexOf('\u039a', 0, 'ucs2'));
        assert.equal(2, twoByteString.indexOf('\u0391', 0, 'ucs2'), 'Alpha');
        assert.equal(4, twoByteString.indexOf('\u03a3', 0, 'ucs2'), 'First Sigma');
        assert.equal(6, twoByteString.indexOf('\u03a3', 6, 'ucs2'), 'Second Sigma');
        assert.equal(8, twoByteString.indexOf('\u0395', 0, 'ucs2'), 'Epsilon');
        assert.equal(-1, twoByteString.indexOf('\u0392', 0, 'ucs2'), 'Not beta');

        // Test multi-char pattern
        assert.equal(
            0, twoByteString.indexOf('\u039a\u0391', 0, 'ucs2'), 'Lambda Alpha');
        assert.equal(
            2, twoByteString.indexOf('\u0391\u03a3', 0, 'ucs2'), 'Alpha Sigma');
        assert.equal(
            4, twoByteString.indexOf('\u03a3\u03a3', 0, 'ucs2'), 'Sigma Sigma');
        assert.equal(
            6, twoByteString.indexOf('\u03a3\u0395', 0, 'ucs2'), 'Sigma Epsilon');
      }

      const mixedByteStringUtf8 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395');
      assert.equal(5, mixedByteStringUtf8.indexOf('bc'));
      assert.equal(5, mixedByteStringUtf8.indexOf('bc', 5));
      assert.equal(5, mixedByteStringUtf8.indexOf('bc', -8));
      assert.equal(7, mixedByteStringUtf8.indexOf('\u03a3'));
      assert.equal(-1, mixedByteStringUtf8.indexOf('\u0396'));

      // Test complex string indexOf algorithms. Only trigger for long strings.
      // Long string that isn't a simple repeat of a shorter string.
      let longString = 'A';
      for (let i = 66; i < 76; i++) // from 'B' to 'K'
        longString = longString + String.fromCharCode(i) + longString;

      const longBufferString = Buffer.from(longString);

      // pattern of 15 chars, repeated every 16 chars in long
      let pattern = 'ABACABADABACABA';
      for (let i = 0; i < longBufferString.length - pattern.length; i += 7) {
        const index = longBufferString.indexOf(pattern, i);
        assert.equal((i + 15) & ~0xf, index, 'Long ABACABA...-string at index ' + i);
      }
      assert.equal(510, longBufferString.indexOf('AJABACA'), 'Long AJABACA, First J');
      assert.equal(
          1534, longBufferString.indexOf('AJABACA', 511), 'Long AJABACA, Second J');

      pattern = 'JABACABADABACABA';
      assert.equal(
          511, longBufferString.indexOf(pattern), 'Long JABACABA..., First J');
      assert.equal(
          1535, longBufferString.indexOf(pattern, 512), 'Long JABACABA..., Second J');

      // Search for a non-ASCII string in a pure ASCII string.
      const asciiString = Buffer.from(
          'arglebargleglopglyfarglebargleglopglyfarglebargleglopglyf');
      assert.equal(-1, asciiString.indexOf('\x2061'));
      assert.equal(3, asciiString.indexOf('leb', 0));

      // Search in string containing many non-ASCII chars.
      const allCodePoints = [];
      for (let i = 0; i < 65536; i++)
        allCodePoints[i] = i;
      const allCharsString = String.fromCharCode.apply(String, allCodePoints);
      const allCharsBufferUtf8 = Buffer.from(allCharsString);
      const allCharsBufferUcs2 = Buffer.from(allCharsString, 'ucs2');

      // Search for string long enough to trigger complex search with ASCII pattern
      // and UC16 subject.
      assert.equal(-1, allCharsBufferUtf8.indexOf('notfound'));
      assert.equal(-1, allCharsBufferUcs2.indexOf('notfound'));

      // Needle is longer than haystack, but only because it's encoded as UTF-16
      assert.strictEqual(Buffer.from('aaaa').indexOf('a'.repeat(4), 'ucs2'), -1);

      assert.strictEqual(Buffer.from('aaaa').indexOf('a'.repeat(4), 'utf8'), 0);
      assert.strictEqual(Buffer.from('aaaa').indexOf('你好', 'ucs2'), -1);

      // Haystack has odd length, but the needle is UCS2.
      // assert.strictEqual(Buffer.from('aaaaa').indexOf('b', 'ucs2'), -1);

      {
        // Find substrings in Utf8.
        const lengths = [1, 3, 15];  // Single char, simple and complex.
        const indices = [0x5, 0x60, 0x400, 0x680, 0x7ee, 0xFF02, 0x16610, 0x2f77b];
        for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
          for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            let length = lengths[lengthIndex];

            if (index + length > 0x7F)
              length = 2 * length;

            if (index + length > 0x7FF)
              length = 3 * length;

            if (index + length > 0xFFFF)
              length = 4 * length;

            const patternBufferUtf8 = allCharsBufferUtf8.slice(index, index + length);
            assert.equal(index, allCharsBufferUtf8.indexOf(patternBufferUtf8));

            const patternStringUtf8 = patternBufferUtf8.toString();
            assert.equal(index, allCharsBufferUtf8.indexOf(patternStringUtf8));
          }
        }
      }

      {
        // Find substrings in Usc2.
        const lengths = [2, 4, 16];  // Single char, simple and complex.
        const indices = [0x5, 0x65, 0x105, 0x205, 0x285, 0x2005, 0x2085, 0xfff0];
        for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
          for (let i = 0; i < indices.length; i++) {
            const index = indices[i] * 2;
            const length = lengths[lengthIndex];

            const patternBufferUcs2 =
                allCharsBufferUcs2.slice(index, index + length);
            assert.equal(
                index, allCharsBufferUcs2.indexOf(patternBufferUcs2, 0, 'ucs2'));

            const patternStringUcs2 = patternBufferUcs2.toString('ucs2');
            assert.equal(
                index, allCharsBufferUcs2.indexOf(patternStringUcs2, 0, 'ucs2'));
          }
        }
      }

      assert.throws(() => {
        b.indexOf(() => { });
      });
      assert.throws(() => {
        b.indexOf({});
      });
      assert.throws(() => {
        b.indexOf([]);
      });

      // All code for handling encodings is shared between Buffer.indexOf and
      // Buffer.lastIndexOf, so only testing the separate lastIndexOf semantics.

      // Test lastIndexOf basic functionality; Buffer b contains 'abcdef'.
      // lastIndexOf string:
      assert.equal(b.lastIndexOf('a'), 0);
      assert.equal(b.lastIndexOf('a', 1), 0);
      assert.equal(b.lastIndexOf('b', 1), 1);
      assert.equal(b.lastIndexOf('c', 1), -1);
      assert.equal(b.lastIndexOf('a', -1), 0);
      assert.equal(b.lastIndexOf('a', -4), 0);
      assert.equal(b.lastIndexOf('a', -b.length), 0);
      assert.equal(b.lastIndexOf('a', -b.length - 1), -1);
      assert.equal(b.lastIndexOf('a', NaN), 0);
      assert.equal(b.lastIndexOf('a', -Infinity), -1);
      assert.equal(b.lastIndexOf('a', Infinity), 0);
      // lastIndexOf Buffer:
      assert.equal(b.lastIndexOf(buf_a), 0);
      assert.equal(b.lastIndexOf(buf_a, 1), 0);
      assert.equal(b.lastIndexOf(buf_a, -1), 0);
      assert.equal(b.lastIndexOf(buf_a, -4), 0);
      assert.equal(b.lastIndexOf(buf_a, -b.length), 0);
      assert.equal(b.lastIndexOf(buf_a, -b.length - 1), -1);
      assert.equal(b.lastIndexOf(buf_a, NaN), 0);
      assert.equal(b.lastIndexOf(buf_a, -Infinity), -1);
      assert.equal(b.lastIndexOf(buf_a, Infinity), 0);
      assert.equal(b.lastIndexOf(buf_bc), 1);
      assert.equal(b.lastIndexOf(buf_bc, 2), 1);
      assert.equal(b.lastIndexOf(buf_bc, -1), 1);
      assert.equal(b.lastIndexOf(buf_bc, -3), 1);
      assert.equal(b.lastIndexOf(buf_bc, -5), 1);
      assert.equal(b.lastIndexOf(buf_bc, -6), -1);
      assert.equal(b.lastIndexOf(buf_bc, NaN), 1);
      assert.equal(b.lastIndexOf(buf_bc, -Infinity), -1);
      assert.equal(b.lastIndexOf(buf_bc, Infinity), 1);
      assert.equal(b.lastIndexOf(buf_f), b.length - 1);
      assert.equal(b.lastIndexOf(buf_z), -1);
      assert.equal(b.lastIndexOf(buf_empty), -1);
      assert.equal(b.lastIndexOf(buf_empty, 1), -1);
      assert.equal(b.lastIndexOf(buf_empty, b.length + 1), -1);
      assert.equal(b.lastIndexOf(buf_empty, Infinity), -1);
      // lastIndexOf number:
      assert.equal(b.lastIndexOf(0x61), 0);
      assert.equal(b.lastIndexOf(0x61, 1), 0);
      assert.equal(b.lastIndexOf(0x61, -1), 0);
      assert.equal(b.lastIndexOf(0x61, -4), 0);
      assert.equal(b.lastIndexOf(0x61, -b.length), 0);
      assert.equal(b.lastIndexOf(0x61, -b.length - 1), -1);
      assert.equal(b.lastIndexOf(0x61, NaN), 0);
      assert.equal(b.lastIndexOf(0x61, -Infinity), -1);
      assert.equal(b.lastIndexOf(0x61, Infinity), 0);
      assert.equal(b.lastIndexOf(0x0), -1);

      // Test weird offset arguments.
      // Behaviour should match String.lastIndexOf:
      assert.equal(b.lastIndexOf('b', 0), -1);
      assert.equal(b.lastIndexOf('b', undefined), 1);
      assert.equal(b.lastIndexOf('b', null), -1);
      assert.equal(b.lastIndexOf('b', {}), 1);
      assert.equal(b.lastIndexOf('b', []), -1);
      assert.equal(b.lastIndexOf('b', [2]), 1);

      // Test needles longer than the haystack.
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'ucs2'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'utf8'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'latin1'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'binary'), -1);
      assert.strictEqual(b.lastIndexOf(Buffer.from('aaaaaaaaaaaaaaa')), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 2, 'ucs2'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 3, 'utf8'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 5, 'latin1'), -1);
      assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 5, 'binary'), -1);
      assert.strictEqual(b.lastIndexOf(Buffer.from('aaaaaaaaaaaaaaa'), 7), -1);

      // 你好 expands to a total of 6 bytes using UTF-8 and 4 bytes using UTF-16
      assert.strictEqual(buf_bc.lastIndexOf('你好', 'ucs2'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 'utf8'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 'latin1'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 'binary'), -1);
      assert.strictEqual(buf_bc.lastIndexOf(Buffer.from('你好')), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 2, 'ucs2'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 3, 'utf8'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 5, 'latin1'), -1);
      assert.strictEqual(buf_bc.lastIndexOf('你好', 5, 'binary'), -1);
      assert.strictEqual(buf_bc.lastIndexOf(Buffer.from('你好'), 7), -1);

      // Test lastIndexOf on a longer buffer:
      const bufferString = new Buffer('a man a plan a canal panama');
      assert.equal(15, bufferString.lastIndexOf('canal'));
      assert.equal(21, bufferString.lastIndexOf('panama'));
      assert.equal(0, bufferString.lastIndexOf('a man a plan a canal panama'));
      assert.equal(-1, bufferString.lastIndexOf('a man a plan a canal mexico'));
      assert.equal(-1, bufferString.lastIndexOf('a man a plan a canal mexico city'));
      assert.equal(-1, bufferString.lastIndexOf(Buffer.from('a'.repeat(1000))));
      assert.equal(0, bufferString.lastIndexOf('a man a plan', 4));
      assert.equal(13, bufferString.lastIndexOf('a '));
      assert.equal(13, bufferString.lastIndexOf('a ', 13));
      assert.equal(6, bufferString.lastIndexOf('a ', 12));
      assert.equal(0, bufferString.lastIndexOf('a ', 5));
      assert.equal(13, bufferString.lastIndexOf('a ', -1));
      assert.equal(0, bufferString.lastIndexOf('a ', -27));
      assert.equal(-1, bufferString.lastIndexOf('a ', -28));

      // Test lastIndexOf for the case that the first character can be found,
      // but in a part of the buffer that does not make search to search
      // due do length constraints.
      const abInUCS2 = Buffer.from('ab', 'ucs2');
      assert.strictEqual(-1, Buffer.from('µaaaa¶bbbb', 'latin1').lastIndexOf('µ'));
      assert.strictEqual(-1, Buffer.from('µaaaa¶bbbb', 'binary').lastIndexOf('µ'));
      assert.strictEqual(-1, Buffer.from('bc').lastIndexOf('ab'));
      assert.strictEqual(-1, Buffer.from('abc').lastIndexOf('qa'));
      assert.strictEqual(-1, Buffer.from('abcdef').lastIndexOf('qabc'));
      assert.strictEqual(-1, Buffer.from('bc').lastIndexOf(Buffer.from('ab')));
      assert.strictEqual(-1, Buffer.from('bc', 'ucs2').lastIndexOf('ab', 'ucs2'));
      assert.strictEqual(-1, Buffer.from('bc', 'ucs2').lastIndexOf(abInUCS2));

      assert.strictEqual(0, Buffer.from('abc').lastIndexOf('ab'));
      assert.strictEqual(0, Buffer.from('abc').lastIndexOf('ab', 1));
      assert.strictEqual(0, Buffer.from('abc').lastIndexOf('ab', 2));
      assert.strictEqual(0, Buffer.from('abc').lastIndexOf('ab', 3));

      // The above tests test the LINEAR and SINGLE-CHAR strategies.
      // Now, we test the BOYER-MOORE-HORSPOOL strategy.
      // Test lastIndexOf on a long buffer w multiple matches:
      pattern = 'JABACABADABACABA';
      assert.equal(1535, longBufferString.lastIndexOf(pattern));
      assert.equal(1535, longBufferString.lastIndexOf(pattern, 1535));
      assert.equal(511, longBufferString.lastIndexOf(pattern, 1534));

      // Finally, give it a really long input to trigger fallback from BMH to
      // regular BOYER-MOORE (which has better worst-case complexity).

      // Generate a really long Thue-Morse sequence of 'yolo' and 'swag',
      // "yolo swag swag yolo swag yolo yolo swag" ..., goes on for about 5MB.
      // This is hard to search because it all looks similar, but never repeats.

      // countBits returns the number of bits in the binary representation of n.
      function countBits(n) {
        let count;
        for (count = 0; n > 0; count++)
          n = n & (n - 1); // remove top bit
        return count;
      }

      const parts = [];

      for (let i = 0; i < 1000000; i++)
        parts.push((countBits(i) % 2 === 0) ? 'yolo' : 'swag');

      const reallyLong = new Buffer(parts.join(' '));
      assert.equal('yolo swag swag yolo', reallyLong.slice(0, 19).toString());

      // Expensive reverse searches. Stress test lastIndexOf:
      pattern = reallyLong.slice(0, 100000);  // First 1/50th of the pattern.
      assert.equal(4751360, reallyLong.lastIndexOf(pattern));
      assert.equal(3932160, reallyLong.lastIndexOf(pattern, 4000000));
      assert.equal(2949120, reallyLong.lastIndexOf(pattern, 3000000));
      pattern = reallyLong.slice(100000, 200000);  // Second 1/50th.
      assert.equal(4728480, reallyLong.lastIndexOf(pattern));
      pattern = reallyLong.slice(0, 1000000);  // First 1/5th.
      assert.equal(3932160, reallyLong.lastIndexOf(pattern));
      pattern = reallyLong.slice(0, 2000000);  // first 2/5ths.
      assert.equal(0, reallyLong.lastIndexOf(pattern));

      // test truncation of Number arguments to uint8
      {
        const buf = Buffer.from('this is a test');
        assert.strictEqual(buf.indexOf(0x6973), 3);
        assert.strictEqual(buf.indexOf(0x697320), 4);
        assert.strictEqual(buf.indexOf(0x69732069), 2);
        assert.strictEqual(buf.indexOf(0x697374657374), 0);
        assert.strictEqual(buf.indexOf(0x69737374), 0);
        assert.strictEqual(buf.indexOf(0x69737465), 11);
        assert.strictEqual(buf.indexOf(0x69737465), 11);
        assert.strictEqual(buf.indexOf(-140), 0);
        assert.strictEqual(buf.indexOf(-152), 1);
        assert.strictEqual(buf.indexOf(0xff), -1);
        assert.strictEqual(buf.indexOf(0xffff), -1);
      }
    });

    it('test-buffer-inheritance', () => {
      function T(n) {
        const ui8 = new Uint8Array(n);
        Object.setPrototypeOf(ui8, T.prototype);
        return ui8;
      }
      Object.setPrototypeOf(T.prototype, Buffer.prototype);
      Object.setPrototypeOf(T, Buffer);

      T.prototype.sum = function sum() {
        let cntr = 0;
        for (let i = 0; i < this.length; i++)
          cntr += this[i];
        return cntr;
      };

      const vals = [new T(4), T(4)];

      vals.forEach((t) => {
        assert.strictEqual(t.constructor, T);
        assert.strictEqual(Object.getPrototypeOf(t), T.prototype);
        assert.strictEqual(Object.getPrototypeOf(Object.getPrototypeOf(t)),
                           Buffer.prototype);

        t.fill(5);
        let cntr = 0;
        for (let i = 0; i < t.length; i++)
          cntr += t[i];
        assert.strictEqual(t.length * 5, cntr);

        // Check this does not throw
        t.toString();
      });
    });

    it('test-buffer-inspect', () => {
      const defaultMaxBytes = buffer.INSPECT_MAX_BYTES;
      buffer.INSPECT_MAX_BYTES = 2;

      let b = Buffer.allocUnsafe(4);
      b.fill('1234');

      let s = buffer.SlowBuffer(4);
      s.fill('1234');

      let expected = '<Buffer 31 32 ... >';

      assert.strictEqual(util.inspect(b), expected);
      assert.strictEqual(util.inspect(s), expected);

      b = Buffer.allocUnsafe(2);
      b.fill('12');

      s = buffer.SlowBuffer(2);
      s.fill('12');

      expected = '<Buffer 31 32>';

      assert.strictEqual(util.inspect(b), expected);
      assert.strictEqual(util.inspect(s), expected);

      buffer.INSPECT_MAX_BYTES = Infinity;

      assert.strictEqual(util.inspect(b), expected);
      assert.strictEqual(util.inspect(s), expected);

      // XXX skip
      // b.inspect = undefined;
      // assert.strictEqual(util.inspect(b), expected);

      buffer.INSPECT_MAX_BYTES = defaultMaxBytes;
    });

    it('test-buffer-isencoding', () => {
      [
        'hex',
        'utf8',
        'utf-8',
        'ascii',
        'latin1',
        'binary',
        'base64',
        'ucs2',
        'ucs-2',
        'utf16le',
        'utf-16le'
      ].forEach((enc) => {
        assert.strictEqual(Buffer.isEncoding(enc), true);
      });

      [
        'utf9',
        'utf-7',
        'Unicode-FTW',
        'new gnu gun',
        false,
        NaN,
        {},
        Infinity,
        [],
        1,
        0,
        -1
      ].forEach((enc) => {
        assert.strictEqual(Buffer.isEncoding(enc), false);
      });
    });

    it('test-buffer-iterator', () => {
      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      let arr;
      let b;

      // buffers should be iterable

      arr = [];

      for (b of buffer)
        arr.push(b);

      assert.deepStrictEqual(arr, [1, 2, 3, 4, 5]);

      // buffer iterators should be iterable

      arr = [];

      for (b of buffer[Symbol.iterator]())
        arr.push(b);

      assert.deepStrictEqual(arr, [1, 2, 3, 4, 5]);

      // buffer#values() should return iterator for values

      arr = [];

      for (b of buffer.values())
        arr.push(b);

      assert.deepStrictEqual(arr, [1, 2, 3, 4, 5]);

      // buffer#keys() should return iterator for keys

      arr = [];

      for (b of buffer.keys())
        arr.push(b);

      assert.deepStrictEqual(arr, [0, 1, 2, 3, 4]);

      // buffer#entries() should return iterator for entries

      arr = [];

      for (b of buffer.entries())
        arr.push(b);

      assert.deepStrictEqual(arr, [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5]
      ]);
    });

    it('test-buffer-new', () => {
      common.expectsError(() => new Buffer(42, 'utf8'), {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "string" argument must be of type string. Received type number'
      });
    });

    it('test-buffer-parent-property', () => {
      // If the length of the buffer object is zero
      assert((new Buffer(0)).parent instanceof ArrayBuffer);

      // If the length of the buffer object is equal to the underlying ArrayBuffer
      assert((new Buffer(Buffer.poolSize)).parent instanceof ArrayBuffer);

      // Same as the previous test, but with user created buffer
      const arrayBuffer = new ArrayBuffer(0);
      assert.strictEqual(new Buffer(arrayBuffer).parent, arrayBuffer);
      assert.strictEqual(new Buffer(arrayBuffer).buffer, arrayBuffer);
      assert.strictEqual(Buffer.from(arrayBuffer).parent, arrayBuffer);
      assert.strictEqual(Buffer.from(arrayBuffer).buffer, arrayBuffer);
    });

    it('test-buffer-prototype-inspect', () => {
      {
        const buf = Buffer.from('fhqwhgads');
        assert.strictEqual(util.inspect(buf), '<Buffer 66 68 71 77 68 67 61 64 73>');
      }

      {
        const buf = Buffer.from('');
        assert.strictEqual(util.inspect(buf), '<Buffer >');
      }

      {
        const buf = Buffer.from('x'.repeat(51));
        assert.ok(/^<Buffer (?:78 ){50}\.\.\. >$/.test(util.inspect(buf)));
      }
    });

    it('test-buffer-safe-unsafe', () => {
      const safe = Buffer.alloc(10);

      function isZeroFilled(buf) {
        for (let n = 0; n < buf.length; n++) {
          if (buf[n] !== 0)
            return false;
        }
        return true;
      }

      assert(isZeroFilled(safe));

      // Test that unsafe allocations doesn't affect subsequent safe allocations
      Buffer.allocUnsafe(10);
      assert(isZeroFilled(new Float64Array(10)));

      new Buffer(10);
      assert(isZeroFilled(new Float64Array(10)));

      Buffer.allocUnsafe(10);
      assert(isZeroFilled(Buffer.alloc(10)));
    });

    it('test-buffer-slice', () => {
      assert.strictEqual(0, Buffer.from('hello', 'utf8').slice(0, 0).length);
      assert.strictEqual(0, Buffer('hello', 'utf8').slice(0, 0).length);

      const buf = Buffer.from('0123456789', 'utf8');
      const expectedSameBufs = [
        [buf.slice(-10, 10), Buffer.from('0123456789', 'utf8')],
        [buf.slice(-20, 10), Buffer.from('0123456789', 'utf8')],
        [buf.slice(-20, -10), Buffer.from('', 'utf8')],
        [buf.slice(), Buffer.from('0123456789', 'utf8')],
        [buf.slice(0), Buffer.from('0123456789', 'utf8')],
        [buf.slice(0, 0), Buffer.from('', 'utf8')],
        [buf.slice(undefined), Buffer.from('0123456789', 'utf8')],
        [buf.slice('foobar'), Buffer.from('0123456789', 'utf8')],
        [buf.slice(undefined, undefined), Buffer.from('0123456789', 'utf8')],
        [buf.slice(2), Buffer.from('23456789', 'utf8')],
        [buf.slice(5), Buffer.from('56789', 'utf8')],
        [buf.slice(10), Buffer.from('', 'utf8')],
        [buf.slice(5, 8), Buffer.from('567', 'utf8')],
        [buf.slice(8, -1), Buffer.from('8', 'utf8')],
        [buf.slice(-10), Buffer.from('0123456789', 'utf8')],
        [buf.slice(0, -9), Buffer.from('0', 'utf8')],
        [buf.slice(0, -10), Buffer.from('', 'utf8')],
        [buf.slice(0, -1), Buffer.from('012345678', 'utf8')],
        [buf.slice(2, -2), Buffer.from('234567', 'utf8')],
        [buf.slice(0, 65536), Buffer.from('0123456789', 'utf8')],
        [buf.slice(65536, 0), Buffer.from('', 'utf8')],
        [buf.slice(-5, -8), Buffer.from('', 'utf8')],
        [buf.slice(-5, -3), Buffer.from('56', 'utf8')],
        [buf.slice(-10, 10), Buffer.from('0123456789', 'utf8')],
        [buf.slice('0', '1'), Buffer.from('0', 'utf8')],
        [buf.slice('-5', '10'), Buffer.from('56789', 'utf8')],
        [buf.slice('-10', '10'), Buffer.from('0123456789', 'utf8')],
        [buf.slice('-10', '-5'), Buffer.from('01234', 'utf8')],
        [buf.slice('-10', '-0'), Buffer.from('', 'utf8')],
        [buf.slice('111'), Buffer.from('', 'utf8')],
        [buf.slice('0', '-111'), Buffer.from('', 'utf8')]
      ];

      for (let i = 0, s = buf.toString(); i < buf.length; ++i) {
        expectedSameBufs.push(
          [buf.slice(i), Buffer.from(s.slice(i))],
          [buf.slice(0, i), Buffer.from(s.slice(0, i))],
          [buf.slice(-i), Buffer.from(s.slice(-i))],
          [buf.slice(0, -i), Buffer.from(s.slice(0, -i))]
        );
      }

      expectedSameBufs.forEach(([buf1, buf2]) => {
        assert.strictEqual(0, Buffer.compare(buf1, buf2));
      });

      const utf16Buf = Buffer.from('0123456789', 'utf16le');
      assert.deepStrictEqual(utf16Buf.slice(0, 6), Buffer.from('012', 'utf16le'));
      // try to slice a zero length Buffer
      // see https://github.com/joyent/node/issues/5881
      assert.doesNotThrow(() => Buffer.alloc(0).slice(0, 1));
      assert.strictEqual(Buffer.alloc(0).slice(0, 1).length, 0);

      {
        // Single argument slice
        assert.strictEqual('bcde',
                           Buffer.from('abcde', 'utf8').slice(1).toString('utf8'));
      }

      // slice(0,0).length === 0
      assert.strictEqual(0, Buffer.from('hello', 'utf8').slice(0, 0).length);

      {
        // Regression tests for https://github.com/nodejs/node/issues/9096
        const buf = Buffer.from('abcd', 'utf8');
        assert.strictEqual(buf.slice(buf.length / 3).toString('utf8'), 'bcd');
        assert.strictEqual(
          buf.slice(buf.length / 3, buf.length).toString(),
          'bcd'
        );
      }

      {
        const buf = Buffer.from('abcdefg', 'utf8');
        assert.strictEqual(buf.slice(-(-1 >>> 0) - 1).toString('utf8'),
                           buf.toString('utf8'));
      }

      {
        const buf = Buffer.from('abc', 'utf8');
        assert.strictEqual(buf.slice(-0.5).toString('utf8'), buf.toString('utf8'));
      }

      {
        const buf = Buffer.from([
          1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0,
          0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0
        ]);
        const chunk1 = Buffer.from([
          1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0
        ]);
        const chunk2 = Buffer.from([
          0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0
        ]);
        const middle = buf.length / 2;

        assert.deepStrictEqual(buf.slice(0, middle), chunk1);
        assert.deepStrictEqual(buf.slice(middle), chunk2);
      }
    });

    it('test-buffer-slow', () => {
      const ones = [1, 1, 1, 1];

      // should create a Buffer
      let sb = SlowBuffer(4);
      assert(sb instanceof Buffer);
      assert.strictEqual(sb.length, 4);
      sb.fill(1);

      for (const [key, value] of sb.entries())
        assert.deepStrictEqual(value, ones[key]);

      // underlying ArrayBuffer should have the same length
      assert.strictEqual(sb.buffer.byteLength, 4);

      // should work without new
      sb = SlowBuffer(4);
      assert(sb instanceof Buffer);
      assert.strictEqual(sb.length, 4);
      sb.fill(1);

      for (const [key, value] of sb.entries())
        assert.deepStrictEqual(value, ones[key]);

      // should work with edge cases
      assert.strictEqual(SlowBuffer(0).length, 0);

      try {
        assert.strictEqual(
          SlowBuffer(buffer.kMaxLength).length, buffer.kMaxLength);
      } catch (e) {
        // Don't match on message as it is from the JavaScript engine. V8 and
        // ChakraCore provide different messages.
        assert.strictEqual(e.name, 'RangeError');
      }

      // should work with number-coercible values
      assert.strictEqual(SlowBuffer('6').length, 6);
      assert.strictEqual(SlowBuffer(true).length, 1);

      // should create zero-length buffer if parameter is not a number
      assert.strictEqual(SlowBuffer().length, 0);
      assert.strictEqual(SlowBuffer(NaN).length, 0);
      assert.strictEqual(SlowBuffer({}).length, 0);
      assert.strictEqual(SlowBuffer('string').length, 0);

      // should throw with invalid length
      const bufferMaxSizeMsg = common.expectsError({
        code: 'ERR_INVALID_OPT_VALUE',
        type: RangeError,
        message: /^The value "[^"]*" is invalid for option "size"$/
      }, 2);
      assert.throws(() => {
        SlowBuffer(Infinity);
      }, bufferMaxSizeMsg);
      common.expectsError(() => {
        SlowBuffer(-1);
      }, {
        code: 'ERR_INVALID_OPT_VALUE',
        type: RangeError,
        message: 'The value "-1" is invalid for option "size"'
      });

      assert.throws(() => {
        SlowBuffer(buffer.kMaxLength + 1);
      }, bufferMaxSizeMsg);
    });

    it('test-buffer-swap', () => {
      // Test buffers small enough to use the JS implementation
      {
        const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
                                 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);

        assert.strictEqual(buf, buf.swap16());
        assert.deepStrictEqual(buf, Buffer.from([0x02, 0x01, 0x04, 0x03, 0x06, 0x05,
                                                 0x08, 0x07, 0x0a, 0x09, 0x0c, 0x0b,
                                                 0x0e, 0x0d, 0x10, 0x0f]));
        buf.swap16(); // restore

        assert.strictEqual(buf, buf.swap32());
        assert.deepStrictEqual(buf, Buffer.from([0x04, 0x03, 0x02, 0x01, 0x08, 0x07,
                                                 0x06, 0x05, 0x0c, 0x0b, 0x0a, 0x09,
                                                 0x10, 0x0f, 0x0e, 0x0d]));
        buf.swap32(); // restore

        assert.strictEqual(buf, buf.swap64());
        assert.deepStrictEqual(buf, Buffer.from([0x08, 0x07, 0x06, 0x05, 0x04, 0x03,
                                                 0x02, 0x01, 0x10, 0x0f, 0x0e, 0x0d,
                                                 0x0c, 0x0b, 0x0a, 0x09]));
      }

      // Operates in-place
      {
        const buf = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7]);
        buf.slice(1, 5).swap32();
        assert.deepStrictEqual(buf, Buffer.from([0x1, 0x5, 0x4, 0x3, 0x2, 0x6, 0x7]));
        buf.slice(1, 5).swap16();
        assert.deepStrictEqual(buf, Buffer.from([0x1, 0x4, 0x5, 0x2, 0x3, 0x6, 0x7]));

        // Length assertions
        const re16 = /Buffer size must be a multiple of 16-bits/;
        const re32 = /Buffer size must be a multiple of 32-bits/;
        const re64 = /Buffer size must be a multiple of 64-bits/;

        assert.throws(() => Buffer.from(buf).swap16(), re16);
        assert.throws(() => Buffer.alloc(1025).swap16(), re16);
        assert.throws(() => Buffer.from(buf).swap32(), re32);
        assert.throws(() => buf.slice(1, 3).swap32(), re32);
        assert.throws(() => Buffer.alloc(1025).swap32(), re32);
        assert.throws(() => buf.slice(1, 3).swap64(), re64);
        assert.throws(() => Buffer.alloc(1025).swap64(), re64);
      }

      {
        const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
                                 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);

        buf.slice(2, 18).swap64();

        assert.deepStrictEqual(buf, Buffer.from([0x01, 0x02, 0x0a, 0x09, 0x08, 0x07,
                                                 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
                                                 0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b,
                                                 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                                 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                                                 0x0f, 0x10]));
      }

      // Force use of native code (Buffer size above threshold limit for js impl)
      {
        const bufData = new Uint32Array(256).fill(0x04030201);
        const buf = Buffer.from(bufData.buffer, bufData.byteOffset);
        const otherBufData = new Uint32Array(256).fill(0x03040102);
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        buf.swap16();
        assert.deepStrictEqual(buf, otherBuf);
      }

      {
        const bufData = new Uint32Array(256).fill(0x04030201);
        const buf = Buffer.from(bufData.buffer);
        const otherBufData = new Uint32Array(256).fill(0x01020304);
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        buf.swap32();
        assert.deepStrictEqual(buf, otherBuf);
      }

      {
        const bufData = new Uint8Array(256 * 8);
        const otherBufData = new Uint8Array(256 * 8);
        for (let i = 0; i < bufData.length; i++) {
          bufData[i] = i % 8;
          otherBufData[otherBufData.length - i - 1] = i % 8;
        }
        const buf = Buffer.from(bufData.buffer, bufData.byteOffset);
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        buf.swap64();
        assert.deepStrictEqual(buf, otherBuf);
      }

      // Test native code with buffers that are not memory-aligned
      {
        const bufData = new Uint8Array(256 * 8);
        const otherBufData = new Uint8Array(256 * 8 - 2);

        for (let i = 0; i < bufData.length; i++)
          bufData[i] = i % 2;

        for (let i = 1; i < otherBufData.length; i++)
          otherBufData[otherBufData.length - i] = (i + 1) % 2;

        const buf = Buffer.from(bufData.buffer, bufData.byteOffset);
        // 0|1 0|1 0|1...
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        // 0|0 1|0 1|0...

        buf.slice(1, buf.length - 1).swap16();
        assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf);
      }

      {
        const bufData = new Uint8Array(256 * 8);
        const otherBufData = new Uint8Array(256 * 8 - 4);

        for (let i = 0; i < bufData.length; i++)
          bufData[i] = i % 4;

        for (let i = 1; i < otherBufData.length; i++)
          otherBufData[otherBufData.length - i] = (i + 1) % 4;

        const buf = Buffer.from(bufData.buffer, bufData.byteOffset);
        // 0|1 2 3 0|1 2 3...
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        // 0|0 3 2 1|0 3 2...

        buf.slice(1, buf.length - 3).swap32();
        assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf);
      }

      {
        const bufData = new Uint8Array(256 * 8);
        const otherBufData = new Uint8Array(256 * 8 - 8);

        for (let i = 0; i < bufData.length; i++)
          bufData[i] = i % 8;

        for (let i = 1; i < otherBufData.length; i++)
          otherBufData[otherBufData.length - i] = (i + 1) % 8;

        const buf = Buffer.from(bufData.buffer, bufData.byteOffset);
        // 0|1 2 3 4 5 6 7 0|1 2 3 4...
        const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset);
        // 0|0 7 6 5 4 3 2 1|0 7 6 5...

        buf.slice(1, buf.length - 7).swap64();
        assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf);
      }
    });

    it('test-buffer-tojson', () => {
      {
        assert.strictEqual(JSON.stringify(Buffer.alloc(0)),
                           '{"type":"Buffer","data":[]}');
        assert.strictEqual(JSON.stringify(Buffer.from([1, 2, 3, 4])),
                           '{"type":"Buffer","data":[1,2,3,4]}');
      }

      // issue GH-7849
      {
        const buf = Buffer.from('test');
        const json = JSON.stringify(buf);
        const obj = JSON.parse(json);
        const copy = Buffer.from(obj);

        assert.deepStrictEqual(buf, copy);
      }

      // GH-5110
      {
        const buffer = Buffer.from('test');
        const string = JSON.stringify(buffer);

        assert.strictEqual(string, '{"type":"Buffer","data":[116,101,115,116]}');

        const receiver = (key, value) => {
          return value && value.type === 'Buffer' ? Buffer.from(value.data) : value;
        };

        assert.deepStrictEqual(buffer, JSON.parse(string, receiver));
      }
    });

    it('test-buffer-tostring', () => {
      // utf8, ucs2, ascii, latin1, utf16le
      const encodings = ['utf8', 'utf-8', 'ucs2', 'ucs-2', 'ascii', 'latin1',
                         'binary', 'utf16le', 'utf-16le'];

      encodings
        .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
        .forEach((encoding) => {
          assert.strictEqual(Buffer.from('foo', encoding).toString(encoding), 'foo');
        });

      // base64
      ['base64', 'BASE64'].forEach((encoding) => {
        assert.strictEqual(Buffer.from('Zm9v', encoding).toString(encoding), 'Zm9v');
      });

      // hex
      ['hex', 'HEX'].forEach((encoding) => {
        assert.strictEqual(Buffer.from('666f6f', encoding).toString(encoding),
                           '666f6f');
      });

      // Invalid encodings
      for (let i = 1; i < 10; i++) {
        const encoding = String(i).repeat(i);
        const error = common.expectsError({
          code: 'ERR_UNKNOWN_ENCODING',
          type: TypeError,
          message: `Unknown encoding: ${encoding}`
        });
        assert.ok(!Buffer.isEncoding(encoding));
        assert.throws(() => Buffer.from('foo').toString(encoding), error);
      }
    });

    it('test-buffer-write', () => {
      const outsideBounds = common.expectsError({
        code: 'ERR_BUFFER_OUT_OF_BOUNDS',
        type: RangeError,
        message: 'Attempt to write outside buffer bounds'
      }, 2);

      assert.throws(() => Buffer.alloc(9).write('foo', -1), outsideBounds);
      assert.throws(() => Buffer.alloc(9).write('foo', 10), outsideBounds);

      const resultMap = new Map([
        ['utf8', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ['ucs2', Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
        ['ascii', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ['latin1', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ['binary', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ['utf16le', Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
        ['base64', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ['hex', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])]
      ]);

      // utf8, ucs2, ascii, latin1, utf16le
      const encodings = ['utf8', 'utf-8', 'ucs2', 'ucs-2', 'ascii', 'latin1',
                         'binary', 'utf16le', 'utf-16le'];

      encodings
        .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
        .forEach((encoding) => {
          const buf = Buffer.alloc(9);
          const len = Buffer.byteLength('foo', encoding);
          assert.strictEqual(buf.write('foo', 0, len, encoding), len);

          if (encoding.includes('-'))
            encoding = encoding.replace('-', '');

          assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()));
        });

      // base64
      ['base64', 'BASE64'].forEach((encoding) => {
        const buf = Buffer.alloc(9);
        const len = Buffer.byteLength('Zm9v', encoding);

        assert.strictEqual(buf.write('Zm9v', 0, len, encoding), len);
        assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()));
      });

      // hex
      ['hex', 'HEX'].forEach((encoding) => {
        const buf = Buffer.alloc(9);
        const len = Buffer.byteLength('666f6f', encoding);

        assert.strictEqual(buf.write('666f6f', 0, len, encoding), len);
        assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()));
      });

      // Invalid encodings
      for (let i = 1; i < 10; i++) {
        const encoding = String(i).repeat(i);
        const error = common.expectsError({
          code: 'ERR_UNKNOWN_ENCODING',
          type: TypeError,
          message: `Unknown encoding: ${encoding}`
        });

        assert.ok(!Buffer.isEncoding(encoding));
        assert.throws(() => Buffer.alloc(9).write('foo', encoding), error);
      }
    });

    it('test-buffer-zero-fill-cli', () => {
      function isZeroFilled(buf) {
        for (let n = 0; n < buf.length; n++) {
          if (buf[n] > 0)
            return false;
        }
        return true;
      }

      // This can be somewhat unreliable because the
      // allocated memory might just already happen to
      // contain all zeroes. The test is run multiple
      // times to improve the reliability.
      for (let i = 0; i < 50; i++) {
        const bufs = [
          Buffer.alloc(20),
          Buffer.allocUnsafe(20),
          SlowBuffer(20),
          Buffer(20),
          new SlowBuffer(20)
        ];

        for (const buf of bufs)
          assert(isZeroFilled(buf));
      }
    });

    it('test-buffer-zero-fill-reset', () => {
      function testUint8Array(ui) {
        const length = ui.length;
        for (let i = 0; i < length; i++) {
          if (ui[i] !== 0)
            return false;
        }
        return true;
      }

      for (let i = 0; i < 100; i++) {
        Buffer.alloc(0);
        const ui = new Uint8Array(65);
        assert.ok(testUint8Array(ui), `Uint8Array is not zero-filled: ${ui}`);
      }
    });

    it('test-buffer-zero-fill', () => {
      const buf1 = Buffer(100);
      const buf2 = new Buffer(100);

      for (let n = 0; n < buf1.length; n++)
        assert.strictEqual(buf1[n], 0);

      for (let n = 0; n < buf2.length; n++)
        assert.strictEqual(buf2[n], 0);
    });

    it('test-buffer', () => {
      // counter to ensure unique value is always copied
      let cntr = 0;

      const b = Buffer(1024); // safe constructor

      // console.log('b.length == %d', b.length);
      assert.strictEqual(1024, b.length);

      b[0] = -1;
      assert.strictEqual(b[0], 255);

      for (let i = 0; i < 1024; i++)
        b[i] = i % 256;

      for (let i = 0; i < 1024; i++)
        assert.strictEqual(i % 256, b[i]);

      const c = Buffer(512);
      // console.log('c.length == %d', c.length);
      assert.strictEqual(512, c.length);

      const d = new Buffer([]);
      assert.strictEqual(0, d.length);

      const ui32 = new Uint32Array(4).fill(42);
      const e = Buffer(ui32);

      for (const [key, value] of e.entries())
        assert.deepStrictEqual(value, ui32[key]);

      // First check Buffer#fill() works as expected.

      assert.throws(() => {
        Buffer(8).fill('a', -1);
      });

      assert.throws(() => {
        Buffer(8).fill('a', 0, 9);
      });

      // Make sure this doesn't hang indefinitely.
      Buffer(8).fill('');

      {
        const buf = new Buffer(64);
        buf.fill(10);
        for (let i = 0; i < buf.length; i++)
          assert.equal(buf[i], 10);

        buf.fill(11, 0, buf.length >> 1);
        for (let i = 0; i < buf.length >> 1; i++)
          assert.equal(buf[i], 11);
        for (let i = (buf.length >> 1) + 1; i < buf.length; i++)
          assert.equal(buf[i], 10);

        buf.fill('h');
        for (let i = 0; i < buf.length; i++)
          assert.equal('h'.charCodeAt(0), buf[i]);

        buf.fill(0);
        for (let i = 0; i < buf.length; i++)
          assert.equal(0, buf[i]);

        buf.fill(null);
        for (let i = 0; i < buf.length; i++)
          assert.equal(0, buf[i]);

        buf.fill(1, 16, 32);
        for (let i = 0; i < 16; i++)
          assert.equal(0, buf[i]);
        for (let i = 16; i < 32; i++)
          assert.equal(1, buf[i]);
        for (let i = 32; i < buf.length; i++)
          assert.equal(0, buf[i]);
      }

      {
        const buf = new Buffer(10);
        buf.fill('abc');
        assert.equal(buf.toString(), 'abcabcabca');
        buf.fill('է');
        assert.equal(buf.toString(), 'էէէէէ');
      }

      {
        // copy 512 bytes, from 0 to 512.
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = b.copy(c, 0, 0, 512);
        // console.log('copied %d bytes from b into c', copied);
        assert.strictEqual(512, copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(b[i], c[i]);
      }

      {
        // copy c into b, without specifying sourceEnd
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = c.copy(b, 0, 0);
        // console.log('copied %d bytes from c into b w/o sourceEnd', copied);
        assert.strictEqual(c.length, copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(c[i], b[i]);
      }

      {
        // copy c into b, without specifying sourceStart
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = c.copy(b, 0);
        // console.log('copied %d bytes from c into b w/o sourceStart', copied);
        assert.strictEqual(c.length, copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(c[i], b[i]);
      }

      {
        // copy longer buffer b to shorter c without targetStart
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = b.copy(c);
        // console.log('copied %d bytes from b into c w/o targetStart', copied);
        assert.strictEqual(c.length, copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(b[i], c[i]);
      }

      {
        // copy starting near end of b to c
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = b.copy(c, 0, b.length - Math.floor(c.length / 2));
        // console.log('copied %d bytes from end of b into beginning of c', copied);
        assert.strictEqual(Math.floor(c.length / 2), copied);

        for (let i = 0; i < Math.floor(c.length / 2); i++)
          assert.strictEqual(b[b.length - Math.floor(c.length / 2) + i], c[i]);

        for (let i = Math.floor(c.length / 2) + 1; i < c.length; i++)
          assert.strictEqual(c[c.length - 1], c[i]);
      }

      {
        // try to copy 513 bytes, and check we don't overrun c
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = b.copy(c, 0, 0, 513);
        // console.log('copied %d bytes from b trying to overrun c', copied);
        assert.strictEqual(c.length, copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(b[i], c[i]);
      }

      {
        // copy 768 bytes from b into b
        b.fill(++cntr);
        b.fill(++cntr, 256);
        const copied = b.copy(b, 0, 256, 1024);
        // console.log('copied %d bytes from b into b', copied);
        assert.strictEqual(768, copied);
        for (let i = 0; i < b.length; i++)
          assert.strictEqual(cntr, b[i]);
      }

      // copy string longer than buffer length (failure will segfault)
      const bb = Buffer(10);
      bb.fill('hello crazy world');

      // try to copy from before the beginning of b
      assert.doesNotThrow(() => {
        b.copy(c, 0, 100, 10);
      });

      // copy throws at negative sourceStart
      assert.throws(() => {
        Buffer(5).copy(Buffer(5), 0, -1);
      }, RangeError);

      {
        // check sourceEnd resets to targetEnd if former is greater than the latter
        b.fill(++cntr);
        c.fill(++cntr);
        const copied = b.copy(c, 0, 0, 1025);
        copied;
        // console.log('copied %d bytes from b into c', copied);
        for (let i = 0; i < c.length; i++)
          assert.strictEqual(b[i], c[i]);
      }

      // throw with negative sourceEnd
      // console.log('test copy at negative sourceEnd');
      assert.throws(() => {
        b.copy(c, 0, 0, -1);
      }, RangeError);

      // when sourceStart is greater than sourceEnd, zero copied
      assert.equal(b.copy(c, 0, 100, 10), 0);

      // when targetStart > targetLength, zero copied
      assert.equal(b.copy(c, 512, 0, 10), 0);

      let caught_error;

      // invalid encoding for Buffer.toString
      caught_error = null;
      try {
        b.toString('invalid');
      } catch (err) {
        caught_error = err;
      }
      assert.strictEqual('Unknown encoding: invalid', caught_error.message);

      // invalid encoding for Buffer.write
      caught_error = null;
      try {
        b.write('test string', 0, 5, 'invalid');
      } catch (err) {
        caught_error = err;
      }
      assert.strictEqual('Unknown encoding: invalid', caught_error.message);

      // try to create 0-length buffers
      new Buffer('');
      new Buffer('', 'ascii');
      new Buffer('', 'latin1');
      new Buffer('', 'binary');
      Buffer(0);

      // try to write a 0-length string beyond the end of b
      assert.throws(() => {
        b.write('', 2048);
      }, RangeError);

      // throw when writing to negative offset
      assert.throws(() => {
        b.write('a', -1);
      }, RangeError);

      // throw when writing past bounds from the pool
      assert.throws(() => {
        b.write('a', 2048);
      }, RangeError);

      // throw when writing to negative offset
      assert.throws(() => {
        b.write('a', -1);
      }, RangeError);

      // try to copy 0 bytes worth of data into an empty buffer
      b.copy(Buffer(0), 0, 0, 0);

      // try to copy 0 bytes past the end of the target buffer
      b.copy(Buffer(0), 1, 1, 1);
      b.copy(Buffer(1), 1, 1, 1);

      // try to copy 0 bytes from past the end of the source buffer
      b.copy(Buffer(1), 0, 2048, 2048);

      const rangeBuffer = new Buffer('abc');

      // if start >= buffer's length, empty string will be returned
      assert.equal(rangeBuffer.toString('ascii', 3), '');
      assert.equal(rangeBuffer.toString('ascii', Number(Infinity)), '');
      assert.equal(rangeBuffer.toString('ascii', 3.14, 3), '');
      assert.equal(rangeBuffer.toString('ascii', 'Infinity', 3), '');

      // if end <= 0, empty string will be returned
      assert.equal(rangeBuffer.toString('ascii', 1, 0), '');
      assert.equal(rangeBuffer.toString('ascii', 1, -1.2), '');
      assert.equal(rangeBuffer.toString('ascii', 1, -100), '');
      assert.equal(rangeBuffer.toString('ascii', 1, -Infinity), '');

      // if start < 0, start will be taken as zero
      assert.equal(rangeBuffer.toString('ascii', -1, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', -1.99, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', -Infinity, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '-1', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '-1.99', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '-Infinity', 3), 'abc');

      // if start is an invalid integer, start will be taken as zero
      assert.equal(rangeBuffer.toString('ascii', 'node.js', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', {}, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', [], 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', NaN, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', null, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', undefined, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', false, 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '', 3), 'abc');

      // but, if start is an integer when coerced, then it will be coerced and used.
      assert.equal(rangeBuffer.toString('ascii', '-1', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '1', 3), 'bc');
      assert.equal(rangeBuffer.toString('ascii', '-Infinity', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', '3', 3), '');
      assert.equal(rangeBuffer.toString('ascii', Number(3), 3), '');
      assert.equal(rangeBuffer.toString('ascii', '3.14', 3), '');
      assert.equal(rangeBuffer.toString('ascii', '1.99', 3), 'bc');
      assert.equal(rangeBuffer.toString('ascii', '-1.99', 3), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 1.99, 3), 'bc');
      assert.equal(rangeBuffer.toString('ascii', true, 3), 'bc');

      // if end > buffer's length, end will be taken as buffer's length
      assert.equal(rangeBuffer.toString('ascii', 0, 5), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, 6.99), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, Infinity), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, '5'), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, '6.99'), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, 'Infinity'), 'abc');

      // if end is an invalid integer, end will be taken as buffer's length
      assert.equal(rangeBuffer.toString('ascii', 0, 'node.js'), '');
      assert.equal(rangeBuffer.toString('ascii', 0, {}), '');
      assert.equal(rangeBuffer.toString('ascii', 0, NaN), '');
      assert.equal(rangeBuffer.toString('ascii', 0, undefined), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, null), '');
      assert.equal(rangeBuffer.toString('ascii', 0, []), '');
      assert.equal(rangeBuffer.toString('ascii', 0, false), '');
      assert.equal(rangeBuffer.toString('ascii', 0, ''), '');

      // but, if end is an integer when coerced, then it will be coerced and used.
      assert.equal(rangeBuffer.toString('ascii', 0, '-1'), '');
      assert.equal(rangeBuffer.toString('ascii', 0, '1'), 'a');
      assert.equal(rangeBuffer.toString('ascii', 0, '-Infinity'), '');
      assert.equal(rangeBuffer.toString('ascii', 0, '3'), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, Number(3)), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, '3.14'), 'abc');
      assert.equal(rangeBuffer.toString('ascii', 0, '1.99'), 'a');
      assert.equal(rangeBuffer.toString('ascii', 0, '-1.99'), '');
      assert.equal(rangeBuffer.toString('ascii', 0, 1.99), 'a');
      assert.equal(rangeBuffer.toString('ascii', 0, true), 'a');

      // try toString() with a object as a encoding
      assert.equal(rangeBuffer.toString({toString: () => {
        return 'ascii';
      }}), 'abc');

      // testing for smart defaults and ability to pass string values as offset
      const writeTest = new Buffer('abcdes');
      writeTest.write('n', 'ascii');
      writeTest.write('o', '1', 'ascii');
      writeTest.write('d', '2', 'ascii');
      writeTest.write('e', 3, 'ascii');
      writeTest.write('j', 4, 'ascii');
      assert.equal(writeTest.toString(), 'nodejs');

      // ASCII slice test
      {
        const asciiString = 'hello world';

        for (let i = 0; i < asciiString.length; i++)
          b[i] = asciiString.charCodeAt(i);

        const asciiSlice = b.toString('ascii', 0, asciiString.length);
        assert.equal(asciiString, asciiSlice);
      }

      {
        const asciiString = 'hello world';
        const offset = 100;

        const written = b.write(asciiString, offset, 'ascii');
        assert.equal(asciiString.length, written);
        const asciiSlice = b.toString('ascii', offset, offset + asciiString.length);
        assert.equal(asciiString, asciiSlice);
      }

      {
        const asciiString = 'hello world';
        const offset = 100;

        const sliceA = b.slice(offset, offset + asciiString.length);
        const sliceB = b.slice(offset, offset + asciiString.length);

        for (let i = 0; i < asciiString.length; i++)
          assert.equal(sliceA[i], sliceB[i]);
      }

      // UTF-8 slice test

      const utf8String = '¡hέlló wôrld!';
      const offset = 100;

      b.write(utf8String, 0, Buffer.byteLength(utf8String), 'utf8');
      let utf8Slice = b.toString('utf8', 0, Buffer.byteLength(utf8String));
      assert.equal(utf8String, utf8Slice);

      const written = b.write(utf8String, offset, 'utf8');
      assert.equal(Buffer.byteLength(utf8String), written);
      utf8Slice = b.toString('utf8', offset, offset + Buffer.byteLength(utf8String));
      assert.equal(utf8String, utf8Slice);

      const sliceA = b.slice(offset, offset + Buffer.byteLength(utf8String));
      const sliceB = b.slice(offset, offset + Buffer.byteLength(utf8String));

      for (let i = 0; i < Buffer.byteLength(utf8String); i++)
        assert.equal(sliceA[i], sliceB[i]);

      {
        const slice = b.slice(100, 150);
        assert.equal(50, slice.length);
        for (let i = 0; i < 50; i++)
          assert.equal(b[100 + i], slice[i]);
      }

      {
        // make sure only top level parent propagates from allocPool
        const b = new Buffer(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        assert.equal(b.parent, c.parent);
        assert.equal(b.parent, d.parent);
      }

      {
        // also from a non-pooled instance
        const b = new SlowBuffer(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        assert.equal(c.parent, d.parent);
      }

      {
        // Bug regression test
        const testValue = '\u00F6\u65E5\u672C\u8A9E'; // ö日本語
        const testBuffer = new Buffer(32);
        const size = testBuffer.write(testValue, 0, 'utf8');
        // console.log('bytes written to testBuffer: ' + size);
        const slice = testBuffer.toString('utf8', 0, size);
        assert.equal(slice, testValue);
      }

      {
        // Test triple  slice
        const a = new Buffer(8);
        for (let i = 0; i < 8; i++)
          a[i] = i;
        const b = a.slice(4, 8);
        assert.equal(4, b[0]);
        assert.equal(5, b[1]);
        assert.equal(6, b[2]);
        assert.equal(7, b[3]);
        const c = b.slice(2, 4);
        assert.equal(6, c[0]);
        assert.equal(7, c[1]);
      }

      {
        const d = new Buffer([23, 42, 255]);
        assert.equal(d.length, 3);
        assert.equal(d[0], 23);
        assert.equal(d[1], 42);
        assert.equal(d[2], 255);
        assert.deepStrictEqual(d, new Buffer(d));
      }

      {
        const e = new Buffer('über');
        // console.error('uber: \'%s\'', e.toString());
        assert.deepStrictEqual(e, new Buffer([195, 188, 98, 101, 114]));
      }

      {
        const f = new Buffer('über', 'ascii');
        // console.error('f.length: %d     (should be 4)', f.length);
        assert.deepStrictEqual(f, new Buffer([252, 98, 101, 114]));
      }

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
        {
          const f = new Buffer('über', encoding);
          // console.error('f.length: %d     (should be 8)', f.length);
          assert.deepStrictEqual(f, new Buffer([252, 0, 98, 0, 101, 0, 114, 0]));
        }

        {
          const f = new Buffer('привет', encoding);
          // console.error('f.length: %d     (should be 12)', f.length);
          const expected = new Buffer([63, 4, 64, 4, 56, 4, 50, 4, 53, 4, 66, 4]);
          assert.deepStrictEqual(f, expected);
          assert.equal(f.toString(encoding), 'привет');
        }

        {
          const f = new Buffer([0, 0, 0, 0, 0]);
          assert.equal(f.length, 5);
          const size = f.write('あいうえお', encoding);
          // console.error('bytes written to buffer: %d     (should be 4)', size);
          assert.equal(size, 4);
          assert.deepStrictEqual(f, new Buffer([0x42, 0x30, 0x44, 0x30, 0x00]));
        }
      });

      {
        const f = new Buffer('\uD83D\uDC4D', 'utf-16le'); // THUMBS UP SIGN (U+1F44D)
        assert.equal(f.length, 4);
        assert.deepStrictEqual(f, new Buffer('3DD84DDC', 'hex'));
      }

      const arrayIsh = {0: 0, 1: 1, 2: 2, 3: 3, length: 4};
      let g = new Buffer(arrayIsh);
      assert.deepStrictEqual(g, new Buffer([0, 1, 2, 3]));
      const strArrayIsh = {0: '0', 1: '1', 2: '2', 3: '3', length: 4};
      g = new Buffer(strArrayIsh);
      assert.deepStrictEqual(g, new Buffer([0, 1, 2, 3]));

      //
      // Test toString('base64')
      //
      assert.equal('TWFu', (new Buffer('Man')).toString('base64'));

      {
        // test that regular and URL-safe base64 both work
        const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff];
        assert.deepStrictEqual(Buffer('//++/++/++//', 'base64'), Buffer(expected));
        assert.deepStrictEqual(Buffer('__--_--_--__', 'base64'), Buffer(expected));
      }

      {
        // big example
        const quote = 'Man is distinguished, not only by his reason, but by this ' +
                      'singular passion from other animals, which is a lust ' +
                      'of the mind, that by a perseverance of delight in the ' +
                      'continued and indefatigable generation of knowledge, ' +
                      'exceeds the short vehemence of any carnal pleasure.';
        const expected = 'TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb' +
                         '24sIGJ1dCBieSB0aGlzIHNpbmd1bGFyIHBhc3Npb24gZnJvbSBvdGhlci' +
                         'BhbmltYWxzLCB3aGljaCBpcyBhIGx1c3Qgb2YgdGhlIG1pbmQsIHRoYXQ' +
                         'gYnkgYSBwZXJzZXZlcmFuY2Ugb2YgZGVsaWdodCBpbiB0aGUgY29udGlu' +
                         'dWVkIGFuZCBpbmRlZmF0aWdhYmxlIGdlbmVyYXRpb24gb2Yga25vd2xlZ' +
                         'GdlLCBleGNlZWRzIHRoZSBzaG9ydCB2ZWhlbWVuY2Ugb2YgYW55IGNhcm' +
                         '5hbCBwbGVhc3VyZS4=';
        assert.equal(expected, (new Buffer(quote)).toString('base64'));

        let b = new Buffer(1024);
        let bytesWritten = b.write(expected, 0, 'base64');
        assert.equal(quote.length, bytesWritten);
        assert.equal(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder ignores whitespace
        const expectedWhite = expected.slice(0, 60) + ' \n' +
                              expected.slice(60, 120) + ' \n' +
                              expected.slice(120, 180) + ' \n' +
                              expected.slice(180, 240) + ' \n' +
                              expected.slice(240, 300) + '\n' +
                              expected.slice(300, 360) + '\n';
        b = new Buffer(1024);
        bytesWritten = b.write(expectedWhite, 0, 'base64');
        assert.equal(quote.length, bytesWritten);
        assert.equal(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder on the constructor works
        // even in the presence of whitespace.
        b = new Buffer(expectedWhite, 'base64');
        assert.equal(quote.length, b.length);
        assert.equal(quote, b.toString('ascii', 0, quote.length));

        // check that the base64 decoder ignores illegal chars
        const expectedIllegal = expected.slice(0, 60) + ' \x80' +
                                expected.slice(60, 120) + ' \xff' +
                                expected.slice(120, 180) + ' \x00' +
                                expected.slice(180, 240) + ' \x98' +
                                expected.slice(240, 300) + '\x03' +
                                expected.slice(300, 360);
        b = new Buffer(expectedIllegal, 'base64');
        assert.equal(quote.length, b.length);
        assert.equal(quote, b.toString('ascii', 0, quote.length));
      }

      assert.equal(new Buffer('', 'base64').toString(), '');
      assert.equal(new Buffer('K', 'base64').toString(), '');

      // multiple-of-4 with padding
      assert.equal(new Buffer('Kg==', 'base64').toString(), '*');
      assert.equal(new Buffer('Kio=', 'base64').toString(), '**');
      assert.equal(new Buffer('Kioq', 'base64').toString(), '***');
      assert.equal(new Buffer('KioqKg==', 'base64').toString(), '****');
      assert.equal(new Buffer('KioqKio=', 'base64').toString(), '*****');
      assert.equal(new Buffer('KioqKioq', 'base64').toString(), '******');
      assert.equal(new Buffer('KioqKioqKg==', 'base64').toString(), '*******');
      assert.equal(new Buffer('KioqKioqKio=', 'base64').toString(), '********');
      assert.equal(new Buffer('KioqKioqKioq', 'base64').toString(), '*********');
      assert.equal(new Buffer('KioqKioqKioqKg==', 'base64').toString(),
                   '**********');
      assert.equal(new Buffer('KioqKioqKioqKio=', 'base64').toString(),
                   '***********');
      assert.equal(new Buffer('KioqKioqKioqKioq', 'base64').toString(),
                   '************');
      assert.equal(new Buffer('KioqKioqKioqKioqKg==', 'base64').toString(),
                   '*************');
      assert.equal(new Buffer('KioqKioqKioqKioqKio=', 'base64').toString(),
                   '**************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioq', 'base64').toString(),
                   '***************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKg==', 'base64').toString(),
                   '****************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKio=', 'base64').toString(),
                   '*****************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKioq', 'base64').toString(),
                   '******************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKioqKg==', 'base64').toString(),
                   '*******************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKioqKio=', 'base64').toString(),
                   '********************');

      // no padding, not a multiple of 4
      assert.equal(new Buffer('Kg', 'base64').toString(), '*');
      assert.equal(new Buffer('Kio', 'base64').toString(), '**');
      assert.equal(new Buffer('KioqKg', 'base64').toString(), '****');
      assert.equal(new Buffer('KioqKio', 'base64').toString(), '*****');
      assert.equal(new Buffer('KioqKioqKg', 'base64').toString(), '*******');
      assert.equal(new Buffer('KioqKioqKio', 'base64').toString(), '********');
      assert.equal(new Buffer('KioqKioqKioqKg', 'base64').toString(), '**********');
      assert.equal(new Buffer('KioqKioqKioqKio', 'base64').toString(), '***********');
      assert.equal(new Buffer('KioqKioqKioqKioqKg', 'base64').toString(),
                   '*************');
      assert.equal(new Buffer('KioqKioqKioqKioqKio', 'base64').toString(),
                   '**************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKg', 'base64').toString(),
                   '****************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKio', 'base64').toString(),
                   '*****************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKioqKg', 'base64').toString(),
                   '*******************');
      assert.equal(new Buffer('KioqKioqKioqKioqKioqKioqKio', 'base64').toString(),
                   '********************');

      // handle padding graciously, multiple-of-4 or not
      assert.equal(
        new Buffer('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw==', 'base64').length,
        32
      );
      assert.equal(
        new Buffer('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw=', 'base64').length,
        32
      );
      assert.equal(
        new Buffer('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw', 'base64').length,
        32
      );
      assert.equal(
        new Buffer('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==', 'base64').length,
        31
      );
      assert.equal(
        new Buffer('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=', 'base64').length,
        31
      );
      assert.equal(
        new Buffer('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg', 'base64').length,
        31
      );

      // This string encodes single '.' character in UTF-16
      const dot = new Buffer('//4uAA==', 'base64');
      assert.equal(dot[0], 0xff);
      assert.equal(dot[1], 0xfe);
      assert.equal(dot[2], 0x2e);
      assert.equal(dot[3], 0x00);
      assert.equal(dot.toString('base64'), '//4uAA==');

      {
        // Writing base64 at a position > 0 should not mangle the result.
        //
        // https://github.com/joyent/node/issues/402
        const segments = ['TWFkbmVzcz8h', 'IFRoaXM=', 'IGlz', 'IG5vZGUuanMh'];
        const b = new Buffer(64);
        let pos = 0;

        for (let i = 0; i < segments.length; ++i)
          pos += b.write(segments[i], pos, 'base64');

        assert.equal(b.toString('latin1', 0, pos), 'Madness?! This is node.js!');
        assert.equal(b.toString('binary', 0, pos), 'Madness?! This is node.js!');
      }

      // Regression test for https://github.com/nodejs/node/issues/3496.
      // assert.equal(Buffer('=bad'.repeat(1e4), 'base64').length, 0);

      {
        // Creating buffers larger than pool size.
        const l = Buffer.poolSize + 5;
        const s = 'h'.repeat(l);
        const b = new Buffer(s);

        for (let i = 0; i < l; i++)
          assert.equal('h'.charCodeAt(0), b[i]);

        const sb = b.toString();
        assert.equal(sb.length, s.length);
        assert.equal(sb, s);
      }

      {
        // Single argument slice
        const b = new Buffer('abcde');
        assert.equal('bcde', b.slice(1).toString());
      }

      // slice(0,0).length === 0
      assert.equal(0, Buffer('hello').slice(0, 0).length);

      // test hex toString
      // console.log('Create hex string from buffer');
      const hexb = new Buffer(256);
      for (let i = 0; i < 256; i++)
        hexb[i] = i;

      const hexStr = hexb.toString('hex');
      assert.equal(hexStr,
                   '000102030405060708090a0b0c0d0e0f' +
                   '101112131415161718191a1b1c1d1e1f' +
                   '202122232425262728292a2b2c2d2e2f' +
                   '303132333435363738393a3b3c3d3e3f' +
                   '404142434445464748494a4b4c4d4e4f' +
                   '505152535455565758595a5b5c5d5e5f' +
                   '606162636465666768696a6b6c6d6e6f' +
                   '707172737475767778797a7b7c7d7e7f' +
                   '808182838485868788898a8b8c8d8e8f' +
                   '909192939495969798999a9b9c9d9e9f' +
                   'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf' +
                   'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf' +
                   'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf' +
                   'd0d1d2d3d4d5d6d7d8d9dadbdcdddedf' +
                   'e0e1e2e3e4e5e6e7e8e9eaebecedeeef' +
                   'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');

      // console.log('Create buffer from hex string');
      const hexb2 = new Buffer(hexStr, 'hex');
      for (let i = 0; i < 256; i++)
        assert.equal(hexb2[i], hexb[i]);

      // Test single base64 char encodes as 0
      // assert.strictEqual(Buffer.from('A', 'base64').length, 0);

      {
        // test an invalid slice end.
        // console.log('Try to slice off the end of the buffer');
        const b = new Buffer([1, 2, 3, 4, 5]);
        const b2 = b.toString('hex', 1, 10000);
        const b3 = b.toString('hex', 1, 5);
        const b4 = b.toString('hex', 1);
        assert.equal(b2, b3);
        assert.equal(b2, b4);
      }

      function buildBuffer(data) {
        if (Array.isArray(data)) {
          const buffer = Buffer(data.length);
          data.forEach((v, k) => {
            buffer[k] = v;
          });
          return buffer;
        }
        return null;
      }

      const x = buildBuffer([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]);

      // console.log(x.inspect());
      assert.equal('<Buffer 81 a3 66 6f 6f a3 62 61 72>', x.inspect());

      {
        const z = x.slice(4);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(5, z.length);
        assert.equal(0x6f, z[0]);
        assert.equal(0xa3, z[1]);
        assert.equal(0x62, z[2]);
        assert.equal(0x61, z[3]);
        assert.equal(0x72, z[4]);
      }

      {
        const z = x.slice(0);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(z.length, x.length);
      }

      {
        const z = x.slice(0, 4);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(4, z.length);
        assert.equal(0x81, z[0]);
        assert.equal(0xa3, z[1]);
      }

      {
        const z = x.slice(0, 9);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(9, z.length);
      }

      {
        const z = x.slice(1, 4);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(3, z.length);
        assert.equal(0xa3, z[0]);
      }

      {
        const z = x.slice(2, 4);
        // console.log(z.inspect());
        // console.log(z.length);
        assert.equal(2, z.length);
        assert.equal(0x66, z[0]);
        assert.equal(0x6f, z[1]);
      }

      assert.equal(0, Buffer('hello').slice(0, 0).length);

      ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
        const b = new Buffer(10);
        b.write('あいうえお', encoding);
        assert.equal(b.toString(encoding), 'あいうえお');
      });

      {
        // latin1 encoding should write only one byte per character.
        const b = Buffer([0xde, 0xad, 0xbe, 0xef]);
        let s = String.fromCharCode(0xffff);
        b.write(s, 0, 'latin1');
        assert.equal(0xff, b[0]);
        assert.equal(0xad, b[1]);
        assert.equal(0xbe, b[2]);
        assert.equal(0xef, b[3]);
        s = String.fromCharCode(0xaaee);
        b.write(s, 0, 'latin1');
        assert.equal(0xee, b[0]);
        assert.equal(0xad, b[1]);
        assert.equal(0xbe, b[2]);
        assert.equal(0xef, b[3]);
      }

      {
        // Binary encoding should write only one byte per character.
        const b = Buffer([0xde, 0xad, 0xbe, 0xef]);
        let s = String.fromCharCode(0xffff);
        b.write(s, 0, 'binary');
        assert.equal(0xff, b[0]);
        assert.equal(0xad, b[1]);
        assert.equal(0xbe, b[2]);
        assert.equal(0xef, b[3]);
        s = String.fromCharCode(0xaaee);
        b.write(s, 0, 'binary');
        assert.equal(0xee, b[0]);
        assert.equal(0xad, b[1]);
        assert.equal(0xbe, b[2]);
        assert.equal(0xef, b[3]);
      }

      {
        // #1210 Test UTF-8 string includes null character
        let buf = new Buffer('\0');
        assert.equal(buf.length, 1);
        buf = new Buffer('\0\0');
        assert.equal(buf.length, 2);
      }

      {
        const buf = new Buffer(2);
        let written = buf.write(''); // 0byte
        assert.equal(written, 0);
        written = buf.write('\0'); // 1byte (v8 adds null terminator)
        assert.equal(written, 1);
        written = buf.write('a\0'); // 1byte * 2
        assert.equal(written, 2);
        written = buf.write('あ'); // 3bytes
        assert.equal(written, 0);
        written = buf.write('\0あ'); // 1byte + 3bytes
        assert.equal(written, 1);
        written = buf.write('\0\0あ'); // 1byte * 2 + 3bytes
        assert.equal(written, 2);
      }

      {
        const buf = new Buffer(10);
        let written = buf.write('あいう'); // 3bytes * 3 (v8 adds null terminator)
        assert.equal(written, 9);
        written = buf.write('あいう\0'); // 3bytes * 3 + 1byte
        assert.equal(written, 10);
      }

      {
        // #243 Test write() with maxLength
        const buf = new Buffer(4);
        buf.fill(0xFF);
        let written = buf.write('abcd', 1, 2, 'utf8');
        // console.log(buf);
        assert.equal(written, 2);
        assert.equal(buf[0], 0xFF);
        assert.equal(buf[1], 0x61);
        assert.equal(buf[2], 0x62);
        assert.equal(buf[3], 0xFF);

        buf.fill(0xFF);
        written = buf.write('abcd', 1, 4);
        // console.log(buf);
        assert.equal(written, 3);
        assert.equal(buf[0], 0xFF);
        assert.equal(buf[1], 0x61);
        assert.equal(buf[2], 0x62);
        assert.equal(buf[3], 0x63);

        buf.fill(0xFF);
        written = buf.write('abcd', 1, 2, 'utf8');
        // console.log(buf);
        assert.equal(written, 2);
        assert.equal(buf[0], 0xFF);
        assert.equal(buf[1], 0x61);
        assert.equal(buf[2], 0x62);
        assert.equal(buf[3], 0xFF);

        buf.fill(0xFF);
        written = buf.write('abcdef', 1, 2, 'hex');
        // console.log(buf);
        assert.equal(written, 2);
        assert.equal(buf[0], 0xFF);
        assert.equal(buf[1], 0xAB);
        assert.equal(buf[2], 0xCD);
        assert.equal(buf[3], 0xFF);

        ['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
          buf.fill(0xFF);
          written = buf.write('abcd', 0, 2, encoding);
          // console.log(buf);
          assert.equal(written, 2);
          assert.equal(buf[0], 0x61);
          assert.equal(buf[1], 0x00);
          assert.equal(buf[2], 0xFF);
          assert.equal(buf[3], 0xFF);
        });
      }

      {
        // test offset returns are correct
        const b = new Buffer(16);
        assert.equal(4, b.writeUInt32LE(0, 0));
        assert.equal(6, b.writeUInt16LE(0, 4));
        assert.equal(7, b.writeUInt8(0, 6));
        assert.equal(8, b.writeInt8(0, 7));
        assert.equal(16, b.writeDoubleLE(0, 8));
      }

      {
        // test unmatched surrogates not producing invalid utf8 output
        // ef bf bd = utf-8 representation of unicode replacement character
        // see https://codereview.chromium.org/121173009/
        const buf = new Buffer('ab\ud800cd', 'utf8');
        assert.equal(buf[0], 0x61);
        assert.equal(buf[1], 0x62);
        assert.equal(buf[2], 0xef);
        assert.equal(buf[3], 0xbf);
        assert.equal(buf[4], 0xbd);
        assert.equal(buf[5], 0x63);
        assert.equal(buf[6], 0x64);
      }

      {
        // test for buffer overrun
        const buf = new Buffer([0, 0, 0, 0, 0]); // length: 5
        const sub = buf.slice(0, 4);         // length: 4
        let written = sub.write('12345', 'latin1');
        assert.equal(written, 4);
        assert.equal(buf[4], 0);
        written = sub.write('12345', 'binary');
        assert.equal(written, 4);
        assert.equal(buf[4], 0);
      }

      // Check for fractional length args, junk length args, etc.
      // https://github.com/joyent/node/issues/1758

      // Call .fill() first, stops valgrind warning about uninitialized memory reads.
      Buffer(3.3).fill().toString(); // throws bad argument error in commit 43cb4ec
      assert.equal(Buffer(NaN).length, 0);
      assert.equal(Buffer(3.3).length, 3);
      assert.equal(Buffer({length: 3.3}).length, 3);
      assert.equal(Buffer({length: 'BAM'}).length, 0);

      // Make sure that strings are not coerced to numbers.
      assert.equal(Buffer('99').length, 2);
      assert.equal(Buffer('13.37').length, 5);

      // Ensure that the length argument is respected.
      'ascii utf8 hex base64 latin1 binary'.split(' ').forEach((enc) => {
        assert.equal(Buffer(1).write('aaaaaa', 0, 1, enc), 1);
      });

      {
        // Regression test, guard against buffer overrun in the base64 decoder.
        const a = Buffer(3);
        const b = Buffer('xxx');
        a.write('aaaaaaaa', 'base64');
        assert.equal(b.toString(), 'xxx');
      }

      // issue GH-3416
      Buffer(Buffer(0), 0, 0);

      ['hex',
        'utf8',
        'utf-8',
        'ascii',
        'latin1',
        'binary',
        'base64',
        'ucs2',
        'ucs-2',
        'utf16le',
        'utf-16le'].forEach((enc) => {
          assert.equal(Buffer.isEncoding(enc), true);
        });

      ['utf9',
        'utf-7',
        'Unicode-FTW',
        'new gnu gun'].forEach((enc) => {
          assert.equal(Buffer.isEncoding(enc), false);
        });

      // GH-5110
      {
        const testBuffer = new Buffer('test');
        const string = JSON.stringify(testBuffer);

        assert.strictEqual(string, '{"type":"Buffer","data":[116,101,115,116]}');

        assert.deepStrictEqual(testBuffer, JSON.parse(string, (key, value) => {
          return value && value.type === 'Buffer'
            ? new Buffer(value.data)
            : value;
        }));
      }

      // issue GH-7849
      {
        const buf = new Buffer('test');
        const json = JSON.stringify(buf);
        const obj = JSON.parse(json);
        const copy = new Buffer(obj);

        assert(buf.equals(copy));
      }

      // issue GH-4331
      assert.throws(() => {
        Buffer(0xFFFFFFFF);
      }, RangeError);
      assert.throws(() => {
        Buffer(0xFFFFFFFFF);
      }, RangeError);

      // issue GH-5587
      assert.throws(() => {
        const buf = new Buffer(8);
        buf.writeFloatLE(0, 5);
      }, RangeError);
      assert.throws(() => {
        const buf = new Buffer(16);
        buf.writeDoubleLE(0, 9);
      }, RangeError);

      // attempt to overflow buffers, similar to previous bug in array buffers
      assert.throws(() => {
        const buf = Buffer(8);
        buf.readFloatLE(0xffffffff);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.writeFloatLE(0.0, 0xffffffff);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.readFloatLE(0xffffffff);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.writeFloatLE(0.0, 0xffffffff);
      }, RangeError);

      // ensure negative values can't get past offset
      assert.throws(() => {
        const buf = Buffer(8);
        buf.readFloatLE(-1);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.writeFloatLE(0.0, -1);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.readFloatLE(-1);
      }, RangeError);

      assert.throws(() => {
        const buf = Buffer(8);
        buf.writeFloatLE(0.0, -1);
      }, RangeError);

      // offset checks
      {
        const buf = new Buffer(0);

        assert.throws(() => {
          buf.readUInt8(0);
        }, RangeError);
        assert.throws(() => {
          buf.readInt8(0);
        }, RangeError);
      }

      {
        const buf = new Buffer([0xFF]);

        assert.equal(buf.readUInt8(0), 255);
        assert.equal(buf.readInt8(0), -1);
      }

      [16, 32].forEach((bits) => {
        const buf = new Buffer(bits / 8 - 1);

        assert.throws(() => {
          buf['readUInt' + bits + 'BE'](0);
        }, RangeError, 'readUInt' + bits + 'BE');

        assert.throws(() => {
          buf['readUInt' + bits + 'LE'](0);
        }, RangeError, 'readUInt' + bits + 'LE');

        assert.throws(() => {
          buf['readInt' + bits + 'BE'](0);
        }, RangeError, 'readInt' + bits + 'BE()');

        assert.throws(() => {
          buf['readInt' + bits + 'LE'](0);
        }, RangeError, 'readInt' + bits + 'LE()');
      });

      [16, 32].forEach((bits) => {
        const buf = new Buffer([0xFF, 0xFF, 0xFF, 0xFF]);

        assert.equal(buf['readUInt' + bits + 'BE'](0),
                      (0xFFFFFFFF >>> (32 - bits)));

        assert.equal(buf['readUInt' + bits + 'LE'](0),
                      (0xFFFFFFFF >>> (32 - bits)));

        assert.equal(buf['readInt' + bits + 'BE'](0),
                      (0xFFFFFFFF >> (32 - bits)));

        assert.equal(buf['readInt' + bits + 'LE'](0),
                      (0xFFFFFFFF >> (32 - bits)));
      });

      // test for common read(U)IntLE/BE
      {
        const buf = new Buffer([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

        assert.strictEqual(buf.readUIntLE(0, 1), 0x01);
        assert.strictEqual(buf.readUIntBE(0, 1), 0x01);
        assert.strictEqual(buf.readUIntLE(0, 3), 0x030201);
        assert.strictEqual(buf.readUIntBE(0, 3), 0x010203);
        assert.strictEqual(buf.readUIntLE(0, 5), 0x0504030201);
        assert.strictEqual(buf.readUIntBE(0, 5), 0x0102030405);
        assert.strictEqual(buf.readUIntLE(0, 6), 0x060504030201);
        assert.strictEqual(buf.readUIntBE(0, 6), 0x010203040506);
        assert.strictEqual(buf.readIntLE(0, 1), 0x01);
        assert.strictEqual(buf.readIntBE(0, 1), 0x01);
        assert.strictEqual(buf.readIntLE(0, 3), 0x030201);
        assert.strictEqual(buf.readIntBE(0, 3), 0x010203);
        assert.strictEqual(buf.readIntLE(0, 5), 0x0504030201);
        assert.strictEqual(buf.readIntBE(0, 5), 0x0102030405);
        assert.strictEqual(buf.readIntLE(0, 6), 0x060504030201);
        assert.strictEqual(buf.readIntBE(0, 6), 0x010203040506);
      }

      // test for common write(U)IntLE/BE
      {
        let buf = Buffer(3);
        buf.writeUIntLE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
        assert.equal(buf.readUIntLE(0, 3), 0x123456);

        buf = Buffer(3);
        buf.writeUIntBE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
        assert.equal(buf.readUIntBE(0, 3), 0x123456);

        buf = Buffer(3);
        buf.writeIntLE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
        assert.equal(buf.readIntLE(0, 3), 0x123456);

        buf = Buffer(3);
        buf.writeIntBE(0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
        assert.equal(buf.readIntBE(0, 3), 0x123456);

        buf = Buffer(3);
        buf.writeIntLE(-0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xaa, 0xcb, 0xed]);
        assert.equal(buf.readIntLE(0, 3), -0x123456);

        buf = Buffer(3);
        buf.writeIntBE(-0x123456, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xaa]);
        assert.equal(buf.readIntBE(0, 3), -0x123456);

        buf = Buffer(3);
        buf.writeIntLE(-0x123400, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0xcc, 0xed]);
        assert.equal(buf.readIntLE(0, 3), -0x123400);

        buf = Buffer(3);
        buf.writeIntBE(-0x123400, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcc, 0x00]);
        assert.equal(buf.readIntBE(0, 3), -0x123400);

        buf = Buffer(3);
        buf.writeIntLE(-0x120000, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0xee]);
        assert.equal(buf.readIntLE(0, 3), -0x120000);

        buf = Buffer(3);
        buf.writeIntBE(-0x120000, 0, 3);
        assert.deepStrictEqual(buf.toJSON().data, [0xee, 0x00, 0x00]);
        assert.equal(buf.readIntBE(0, 3), -0x120000);

        buf = Buffer(5);
        buf.writeUIntLE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
        assert.equal(buf.readUIntLE(0, 5), 0x1234567890);

        buf = Buffer(5);
        buf.writeUIntBE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
        assert.equal(buf.readUIntBE(0, 5), 0x1234567890);

        buf = Buffer(5);
        buf.writeIntLE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
        assert.equal(buf.readIntLE(0, 5), 0x1234567890);

        buf = Buffer(5);
        buf.writeIntBE(0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
        assert.equal(buf.readIntBE(0, 5), 0x1234567890);

        buf = Buffer(5);
        buf.writeIntLE(-0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x70, 0x87, 0xa9, 0xcb, 0xed]);
        assert.equal(buf.readIntLE(0, 5), -0x1234567890);

        buf = Buffer(5);
        buf.writeIntBE(-0x1234567890, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xa9, 0x87, 0x70]);
        assert.equal(buf.readIntBE(0, 5), -0x1234567890);

        buf = Buffer(5);
        buf.writeIntLE(-0x0012000000, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0x00, 0xee, 0xff]);
        assert.equal(buf.readIntLE(0, 5), -0x0012000000);

        buf = Buffer(5);
        buf.writeIntBE(-0x0012000000, 0, 5);
        assert.deepStrictEqual(buf.toJSON().data, [0xff, 0xee, 0x00, 0x00, 0x00]);
        assert.equal(buf.readIntBE(0, 5), -0x0012000000);
      }

      // test Buffer slice
      {
        const buf = new Buffer('0123456789');
        assert.equal(buf.slice(-10, 10), '0123456789');
        assert.equal(buf.slice(-20, 10), '0123456789');
        assert.equal(buf.slice(-20, -10), '');
        assert.equal(buf.slice(), '0123456789');
        assert.equal(buf.slice(0), '0123456789');
        assert.equal(buf.slice(0, 0), '');
        assert.equal(buf.slice(undefined), '0123456789');
        assert.equal(buf.slice('foobar'), '0123456789');
        assert.equal(buf.slice(undefined, undefined), '0123456789');

        assert.equal(buf.slice(2), '23456789');
        assert.equal(buf.slice(5), '56789');
        assert.equal(buf.slice(10), '');
        assert.equal(buf.slice(5, 8), '567');
        assert.equal(buf.slice(8, -1), '8');
        assert.equal(buf.slice(-10), '0123456789');
        assert.equal(buf.slice(0, -9), '0');
        assert.equal(buf.slice(0, -10), '');
        assert.equal(buf.slice(0, -1), '012345678');
        assert.equal(buf.slice(2, -2), '234567');
        assert.equal(buf.slice(0, 65536), '0123456789');
        assert.equal(buf.slice(65536, 0), '');
        assert.equal(buf.slice(-5, -8), '');
        assert.equal(buf.slice(-5, -3), '56');
        assert.equal(buf.slice(-10, 10), '0123456789');
        for (let i = 0, s = buf.toString(); i < buf.length; ++i) {
          assert.equal(buf.slice(i), s.slice(i));
          assert.equal(buf.slice(0, i), s.slice(0, i));
          assert.equal(buf.slice(-i), s.slice(-i));
          assert.equal(buf.slice(0, -i), s.slice(0, -i));
        }

        const utf16Buf = new Buffer('0123456789', 'utf16le');
        assert.deepStrictEqual(utf16Buf.slice(0, 6), Buffer('012', 'utf16le'));

        assert.equal(buf.slice('0', '1'), '0');
        assert.equal(buf.slice('-5', '10'), '56789');
        assert.equal(buf.slice('-10', '10'), '0123456789');
        assert.equal(buf.slice('-10', '-5'), '01234');
        assert.equal(buf.slice('-10', '-0'), '');
        assert.equal(buf.slice('111'), '');
        assert.equal(buf.slice('0', '-111'), '');

        // try to slice a zero length Buffer
        // see https://github.com/joyent/node/issues/5881
        SlowBuffer(0).slice(0, 1);
      }

      // Regression test for #5482: should throw but not assert in C++ land.
      assert.throws(() => {
        Buffer('', 'buffer');
      }, TypeError);

      // Regression test for #6111. Constructing a buffer from another buffer
      // should a) work, and b) not corrupt the source buffer.
      {
        let a = [0];
        for (let i = 0; i < 7; ++i)
          a = a.concat(a);
        a = a.map((_, i) => i);
        const b = Buffer(a);
        const c = Buffer(b);
        assert.strictEqual(b.length, a.length);
        assert.strictEqual(c.length, a.length);
        for (let i = 0, k = a.length; i < k; ++i) {
          assert.strictEqual(a[i], i);
          assert.strictEqual(b[i], i);
          assert.strictEqual(c[i], i);
        }
      }

      assert.throws(() => {
        new Buffer((-1 >>> 0) + 1);
      }, RangeError);

      assert.throws(() => {
        SlowBuffer((-1 >>> 0) + 1);
      }, RangeError);

      // Test Compare
      {
        const b = new Buffer(1).fill('a');
        const c = new Buffer(1).fill('c');
        const d = new Buffer(2).fill('aa');

        assert.equal(b.compare(c), -1);
        assert.equal(c.compare(d), 1);
        assert.equal(d.compare(b), 1);
        assert.equal(b.compare(d), -1);
        assert.equal(b.compare(b), 0);

        assert.equal(Buffer.compare(b, c), -1);
        assert.equal(Buffer.compare(c, d), 1);
        assert.equal(Buffer.compare(d, b), 1);
        assert.equal(Buffer.compare(b, d), -1);
        assert.equal(Buffer.compare(c, c), 0);

        assert.equal(Buffer.compare(Buffer(0), Buffer(0)), 0);
        assert.equal(Buffer.compare(Buffer(0), Buffer(1)), -1);
        assert.equal(Buffer.compare(Buffer(1), Buffer(0)), 1);
      }

      assert.throws(() => {
        const b = Buffer(1);
        Buffer.compare(b, 'abc');
      });

      assert.throws(() => {
        const b = Buffer(1);
        Buffer.compare('abc', b);
      });

      assert.throws(() => {
        const b = Buffer(1);
        b.compare('abc');
      });

      // Test Equals
      {
        const b = new Buffer(5).fill('abcdf');
        const c = new Buffer(5).fill('abcdf');
        const d = new Buffer(5).fill('abcde');
        const e = new Buffer(6).fill('abcdef');

        assert.ok(b.equals(c));
        assert.ok(!c.equals(d));
        assert.ok(!d.equals(e));
        assert.ok(d.equals(d));
      }

      assert.throws(() => {
        const b = Buffer(1);
        b.equals('abc');
      });

      // Regression test for https://github.com/nodejs/node/issues/649.
      assert.throws(() => {
        Buffer(1422561062959).toString('utf8');
      });

      {
        // Test that large negative Buffer length inputs don't affect the pool offset.
        // Use the fromArrayLike() variant here because it's more lenient
        // about its input and passes the length directly to allocate().
        assert.deepStrictEqual(Buffer({ length: -Buffer.poolSize }), Buffer.from(''));
        assert.deepStrictEqual(Buffer({ length: -100 }), Buffer.from(''));

        // Check pool offset after that by trying to write string into the pool.
        assert.doesNotThrow(() => Buffer.from('abc'));
      }

      // Test failed or zero-sized Buffer allocations not affecting typed arrays
      {
        const zeroArray = new Uint32Array(10).fill(0);
        const sizes = [1e10, 0, 0.1, -1, 'a', undefined, null, NaN];
        const allocators = [
          Buffer,
          SlowBuffer,
          Buffer.alloc,
          Buffer.allocUnsafe,
          Buffer.allocUnsafeSlow
        ];

        for (const allocator of allocators) {
          for (const size of sizes) {
            try {
              allocator(size);
            } catch (e) {
              assert.deepStrictEqual(new Uint32Array(10), zeroArray);
            }
          }
        }
      }

      // Test that large negative Buffer length inputs throw errors.
      assert.throws(() => Buffer(-Buffer.poolSize), RangeError);
      assert.throws(() => Buffer(-100), RangeError);
      assert.throws(() => Buffer(-1), RangeError);

      // Verify constants
      assert.equal(0x7fffffff, buffer.kMaxLength);
      assert.equal(buffer.kMaxLength, buffer.constants.MAX_LENGTH);

      assert.equal((1 << 28) - 16, buffer.kStringMaxLength);
      assert.equal(buffer.kStringMaxLength, buffer.constants.MAX_STRING_LENGTH);
    });

    it('finalize', () => {
      common.runCallChecks();
    });
  });

  describe('Custom', () => {
    it('should read/write integers', () => {
      const vectors1 = [
        ['Int8',      1, -0x7e],
        ['Int8',      1, 0x7e],
        ['UInt8',     1, 0xde]
      ];

      const vectors2 = [
        ['Int16',     2, -0x7ead],
        ['Int16',     2, 0x7ead],
        ['Int32',     4, -0x7eadbeef],
        ['Int32',     4, 0x7eadbeef],
        ['BigInt64',  8, -0x7eadbeef01234567n],
        ['BigInt64',  8, 0x7eadbeef01234567n],
        ['UInt16',    2, 0xdead],
        ['UInt32',    4, 0xdeadbeef],
        ['BigUInt64', 8, 0xdeadbeef01234567n],
        ['Float',     4, -0x7ead],
        ['Float',     4, 0x7ead],
        ['Double',    8, -0x7eadbeef],
        ['Double',    8, 0x7eadbeef]
      ];

      const vectors3 = [
        ['Int',       1, -0x7e],
        ['Int',       1, 0x7e],
        ['Int',       2, -0x7ead],
        ['Int',       2, 0x7ead],
        ['Int',       4, -0x7eadbeef],
        ['Int',       4, 0x7eadbeef],
        ['Int',       6, -0x7eadbeefab],
        ['Int',       6, 0x7eadbeefab],
        ['UInt',      1, 0xde],
        ['UInt',      2, 0xdead],
        ['UInt',      4, 0xdeadbeef],
        ['UInt',      6, 0xdeadbeefab]
      ];

      for (const [type, size, num] of vectors1) {
        const buf = Buffer.alloc(size);
        assert.strictEqual(buf[`write${type}`](num, 0), size);
        assert.strictEqual(buf[`read${type}`](0), num);
      }

      for (const [type, size, num] of vectors2) {
        for (const endian of ['LE', 'BE']) {
          const buf = Buffer.alloc(size);
          assert.strictEqual(buf[`write${type}${endian}`](num, 0), size);
          assert.strictEqual(buf[`read${type}${endian}`](0), num);
        }
      }

      for (const [type, size, num] of vectors3) {
        for (const endian of ['LE', 'BE']) {
          const buf = Buffer.alloc(size);
          assert.strictEqual(buf[`write${type}${endian}`](num, 0, size), size);
          assert.strictEqual(buf[`read${type}${endian}`](0, size), num);
        }
      }
    });
  });
});
