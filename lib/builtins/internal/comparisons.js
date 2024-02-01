/* eslint no-var: "off" */
/* eslint prefer-arrow-callback: "off" */
/* eslint no-prototype-builtins: "off" */

'use strict';

var util = require('./util');

var kStrict = true;
var kLoose = false;

var kNoIterator = 0;
var kIsArray = 1;
var kIsSet = 2;
var kIsMap = 3;

function isDeepEqual(val1, val2) {
  return innerDeepEqual(val1, val2, kLoose);
}

function isDeepStrictEqual(val1, val2) {
  return innerDeepEqual(val1, val2, kStrict);
}

function innerDeepEqual(val1, val2, strict, memos) {
  if (val1 === val2) {
    if (val1 !== 0)
      return true;
    return strict ? util.equals(val1, val2) : true;
  }

  if (strict) {
    if (typeof val1 !== 'object')
      return typeof val1 === 'number' && util.isNaN(val1) && util.isNaN(val2);

    if (typeof val2 !== 'object' || val1 === null || val2 === null)
      return false;

    if (util.getPrototypeOf(val1) !== util.getPrototypeOf(val2))
      return false;
  } else {
    if (val1 === null || typeof val1 !== 'object') {
      if (val2 === null || typeof val2 !== 'object') {
        // eslint-disable-next-line eqeqeq
        return val1 == val2;
      }

      return false;
    }

    if (val2 === null || typeof val2 !== 'object')
      return false;
  }

  var val1Tag = util.toString(val1);
  var val2Tag = util.toString(val2);
  var keys1, keys2;

  if (val1Tag !== val2Tag)
    return false;

  if (util.isArray(val1)) {
    if (val1.length !== val2.length)
      return false;

    keys1 = util.getOwnNonIndexProperties(val1, true);
    keys2 = util.getOwnNonIndexProperties(val2, true);

    if (keys1.length !== keys2.length)
      return false;

    return keyCheck(val1, val2, strict, memos, kIsArray, keys1);
  }

  if (val1Tag === '[object Object]')
    return keyCheck(val1, val2, strict, memos, kNoIterator);

  if (util.isDate(val1)) {
    if (val1.getTime() !== val2.getTime())
      return false;
  } else if (util.isRegExp(val1)) {
    if (!areSimilarRegExps(val1, val2))
      return false;
  } else if (val1 instanceof Error) {
    if (val1.message !== val2.message || val1.name !== val2.name)
      return false;
  } else if (util.isArrayBufferView(val1)) {
    if (!strict && (util.isFloat32Array(val1) || util.isFloat64Array(val1))) {
      if (!areSimilarFloatArrays(val1, val2))
        return false;
    } else if (!areSimilarTypedArrays(val1, val2)) {
      return false;
    }

    keys1 = util.getOwnNonIndexProperties(val1, true);
    keys2 = util.getOwnNonIndexProperties(val2, true);

    if (keys1.length !== keys2.length)
      return false;

    return keyCheck(val1, val2, strict, memos, kNoIterator, keys1);
  } else if (util.isSet(val1)) {
    if (!util.isSet(val2) || val1.size !== val2.size)
      return false;

    return keyCheck(val1, val2, strict, memos, kIsSet);
  } else if (util.isMap(val1)) {
    if (!util.isMap(val2) || val1.size !== val2.size)
      return false;

    return keyCheck(val1, val2, strict, memos, kIsMap);
  } else if (util.isAnyArrayBuffer(val1)) {
    if (!areEqualArrayBuffers(val1, val2))
      return false;
  } else if (util.isBoxedPrimitive(val1) &&
             !isEqualBoxedPrimitive(val1, val2)) {
    return false;
  }

  return keyCheck(val1, val2, strict, memos, kNoIterator);
}

function keyCheck(val1, val2, strict, memos, iterationType, aKeys) {
  if (arguments.length === 5) {
    aKeys = util.getOwnKeys(val1);
    var bKeys = util.getOwnKeys(val2);

    if (aKeys.length !== bKeys.length)
      return false;
  }

  var i = 0;
  for (; i < aKeys.length; i++) {
    if (!util.hasOwnProperty(val2, aKeys[i]))
      return false;
  }

  if (strict && arguments.length === 5) {
    var symbolKeysA = util.getOwnPropertySymbols(val1);
    var symbolKeysB;

    if (symbolKeysA.length !== 0) {
      var count = 0;
      for (i = 0; i < symbolKeysA.length; i++) {
        var key = symbolKeysA[i];
        if (util.propertyIsEnumerable(val1, key)) {
          if (!util.propertyIsEnumerable(val2, key))
            return false;
          aKeys.push(key);
          count++;
        } else if (util.propertyIsEnumerable(val2, key)) {
          return false;
        }
      }

      symbolKeysB = util.getOwnPropertySymbols(val2);

      if (symbolKeysA.length !== symbolKeysB.length &&
          getEnumerables(val2, symbolKeysB).length !== count) {
        return false;
      }
    } else {
      symbolKeysB = util.getOwnPropertySymbols(val2);

      if (symbolKeysB.length !== 0 &&
          getEnumerables(val2, symbolKeysB).length !== 0) {
        return false;
      }
    }
  }

  if (aKeys.length === 0 &&
      (iterationType === kNoIterator ||
       iterationType === kIsArray && val1.length === 0 ||
       val1.size === 0)) {
    return true;
  }

  if (memos === undefined) {
    memos = {
      val1: createMap(),
      val2: createMap(),
      position: 0
    };
  } else {
    var val2MemoA = memos.val1.get(val1);

    if (val2MemoA !== undefined) {
      var val2MemoB = memos.val2.get(val2);

      if (val2MemoB !== undefined)
        return val2MemoA === val2MemoB;
    }

    memos.position++;
  }

  memos.val1.set(val1, memos.position);
  memos.val2.set(val2, memos.position);

  var areEq = objEquiv(val1, val2, strict, aKeys, memos, iterationType);

  memos.val1.delete(val1);
  memos.val2.delete(val2);

  return areEq;
}

function getEnumerables(val, keys) {
  return util.filter(keys, function(k) {
    return util.propertyIsEnumerable(val, k);
  });
}

function setHasEqualElement(set, val1, strict, memo) {
  var iter = set.keys();

  // for val2 of set
  for (;;) {
    var result = iter.next();

    if (result.done)
      break;

    var val2 = result.value;

    if (innerDeepEqual(val1, val2, strict, memo)) {
      set.delete(val2);
      return true;
    }
  }

  return false;
}

function setEquiv(a, b, strict, memo) {
  var set = null;
  var iter, result, val;

  iter = a.keys();

  // for val of a
  for (;;) {
    result = iter.next();

    if (result.done)
      break;

    val = result.value;

    if (typeof val === 'object' && val !== null) {
      if (set === null)
        set = new Set();

      set.add(val);
    } else if (!b.has(val)) {
      if (strict)
        return false;

      if (!setMightHaveLoosePrim(a, b, val))
        return false;

      if (set === null)
        set = new Set();

      set.add(val);
    }
  }

  if (set !== null) {
    iter = b.keys();

    // for val of b
    for (;;) {
      result = iter.next();

      if (result.done)
        break;

      val = result.value;

      if (typeof val === 'object' && val !== null) {
        if (!setHasEqualElement(set, val, strict, memo))
          return false;
      } else if (!strict &&
                 !a.has(val) &&
                 !setHasEqualElement(set, val, strict, memo)) {
        return false;
      }
    }

    return set.size === 0;
  }

  return true;
}

function setMightHaveLoosePrim(a, b, prim) {
  var altValue = findLooseMatchingPrimitives(prim);

  if (altValue != null)
    return altValue;

  return b.has(altValue) && !a.has(altValue);
}

function mapEquiv(a, b, strict, memo) {
  var set = null;
  var iter, result;

  iter = a.entries();

  // for [key1, item1] of a
  for (;;) {
    result = iter.next();

    if (result.done)
      break;

    var key1 = result.value[0];
    var item1 = result.value[1];

    if (typeof key1 === 'object' && key1 !== null) {
      if (set === null)
        set = new Set();
      set.add(key1);
    } else {
      var item2 = b.get(key1);

      if (item2 === undefined && !b.has(key1) ||
          !innerDeepEqual(item1, item2, strict, memo)) {
        if (strict)
          return false;

        if (!mapMightHaveLoosePrim(a, b, key1, item1, memo))
          return false;

        if (set === null)
          set = new Set();

        set.add(key1);
      }
    }
  }

  if (set !== null) {
    iter = b.entries();

    // for [key, item] of b
    for (;;) {
      result = iter.next();

      if (result.done)
        break;

      var key = result.value[0];
      var item = result.value[1];

      if (typeof key === 'object' && key !== null) {
        if (!mapHasEqualEntry(set, a, key, item, strict, memo))
          return false;
      } else if (!strict &&
                 (!a.has(key) ||
                  !innerDeepEqual(a.get(key), item, false, memo)) &&
                 !mapHasEqualEntry(set, a, key, item, false, memo)) {
        return false;
      }
    }

    return set.size === 0;
  }

  return true;
}

function mapMightHaveLoosePrim(a, b, prim, item, memo) {
  var altValue = findLooseMatchingPrimitives(prim);

  if (altValue != null)
    return altValue;

  var curB = b.get(altValue);

  if (curB === undefined && !b.has(altValue) ||
      !innerDeepEqual(item, curB, false, memo)) {
    return false;
  }

  return !a.has(altValue) && innerDeepEqual(item, curB, false, memo);
}

function mapHasEqualEntry(set, map, key1, item1, strict, memo) {
  var iter = set.keys();

  // for key2 of set
  for (;;) {
    var result = iter.next();

    if (result.done)
      break;

    var key2 = result.value;

    if (innerDeepEqual(key1, key2, strict, memo) &&
        innerDeepEqual(item1, map.get(key2), strict, memo)) {
      set.delete(key2);
      return true;
    }
  }

  return false;
}

function objEquiv(a, b, strict, keys, memos, iterationType) {
  var i, key;

  if (iterationType === kIsSet) {
    if (!setEquiv(a, b, strict, memos))
      return false;
  } else if (iterationType === kIsMap) {
    if (!mapEquiv(a, b, strict, memos))
      return false;
  } else if (iterationType === kIsArray) {
    for (i = 0; i < a.length; i++) {
      if (util.hasOwnProperty(a, i)) {
        if (!util.hasOwnProperty(b, i) ||
            !innerDeepEqual(a[i], b[i], strict, memos)) {
          return false;
        }
      } else if (util.hasOwnProperty(b, i)) {
        return false;
      } else {
        var keysA = util.getOwnKeys(a);

        for (; i < keysA.length; i++) {
          key = keysA[i];
          if (!util.hasOwnProperty(b, key) ||
              !innerDeepEqual(a[key], b[key], strict, memos)) {
            return false;
          }
        }

        return keysA.length === util.getOwnKeys(b).length;
      }
    }
  }

  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    if (!innerDeepEqual(a[key], b[key], strict, memos))
      return false;
  }

  return true;
}

function findLooseMatchingPrimitives(prim) {
  switch (typeof prim) {
    case 'undefined':
      return null;
    case 'object':
      return undefined;
    case 'symbol':
      return false;
    case 'string':
      prim = Number(prim);
    case 'number':
      if (util.isNaN(prim))
        return false;
  }
  return true;
}

var HAS_FLAGS = /x/i.flags === 'i';

function areSimilarRegExps(a, b) {
  if (HAS_FLAGS)
    return a.source === b.source && a.flags === b.flags;

  return a.source === b.source
      && a.global === b.global
      && a.multiline === b.multiline
      && a.lastIndex === b.lastIndex
      && a.ignoreCase === b.ignoreCase
      && a.sticky === b.sticky
      && a.unicode === b.unicode;
}

function areSimilarFloatArrays(a, b) {
  if (a.byteLength !== b.byteLength)
    return false;

  for (var offset = 0; offset < a.byteLength; offset++) {
    if (a[offset] !== b[offset])
      return false;
  }

  return true;
}

function areSimilarTypedArrays(a, b) {
  if (a.byteLength !== b.byteLength)
    return false;

  return bytesEqual(new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
                    new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
}

function areEqualArrayBuffers(buf1, buf2) {
  return buf1.byteLength === buf2.byteLength
      && bytesEqual(new Uint8Array(buf1), new Uint8Array(buf2));
}

function bytesEqual(a, b) {
  if (a.length !== b.length)
    return false;

  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }

  return true;
}

function isEqualBoxedPrimitive(val1, val2) {
  if (util.isNumberObject(val1)) {
    return util.isNumberObject(val2)
        && util.equals(val1, val2);
  }

  if (util.isStringObject(val1)) {
    return util.isStringObject(val2)
        && val1.valueOf() === val2.valueOf();
  }

  if (util.isBooleanObject(val1)) {
    return util.isBooleanObject(val2)
        && val1.valueOf() === val2.valueOf();
  }

  if (util.isBigIntObject(val1)) {
    return util.isBigIntObject(val2)
        && val1.valueOf() === val2.valueOf();
  }

  return util.isSymbolObject(val2)
      && val1.valueOf() === val2.valueOf();
}

function createMap() {
  if (typeof Map === 'function')
    return new Map();

  return new CompareMap();
}

function CompareMap() {
  this.keys = [];
  this.values = [];
}

CompareMap.prototype.get = function(key) {
  var i = this.keys.indexOf(key);
  return i !== -1 ? this.values[i] : undefined;
};

CompareMap.prototype.set = function(key, value) {
  var i = this.keys.indexOf(key);

  if (i === -1) {
    this.keys.push(key);
    this.values.push(value);
    return;
  }

  this.values[i] = value;
};

CompareMap.prototype.delete = function(key) {
  var i = this.keys.indexOf(key);

  if (i === -1)
    return;

  this.keys.splice(i, 1);
  this.values.splice(i, 1);
};

/*
 * Expose
 */

exports.isDeepEqual = isDeepEqual;
exports.isDeepStrictEqual = isDeepStrictEqual;
