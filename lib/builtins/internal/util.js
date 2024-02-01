/* eslint no-var: "off" */

'use strict';

var HAS_ARRAY_BUFFER = typeof ArrayBuffer === 'function';
var HAS_SHARED_ARRAY_BUFFER = typeof SharedArrayBuffer === 'function';
var HAS_BIGINT = typeof BigInt === 'function';
var HAS_SYMBOL = typeof Symbol === 'function';
var HAS_FLOAT32_ARRAY = typeof Float32Array === 'function';
var HAS_FLOAT64_ARRAY = typeof Float64Array === 'function';
var HAS_MAP = typeof Map === 'function';
var HAS_SET = typeof Set === 'function';
var HAS_PROTO = ({ __proto__: { x: 1337 } }).x === 1337;

function assign(target) {
  if (Object.assign)
    return Object.assign.apply(Object, arguments);

  for (var i = 1; i < arguments.length; i++) {
    var obj = arguments[i];

    if (obj === null || typeof obj !== 'object')
      continue;

    var keys = getOwnKeys(obj);

    for (var j = 0; j < keys.length; j++)
      target[keys[j]] = obj[keys[j]];
  }

  return target;
}

function equals(x, y) {
  if (Object.is)
    return Object.is(x, y);

  if (x === y)
    return x !== 0 || 1 / x === 1 / y;

  return x !== x && y !== y;
}

function filter(arr, func) {
  if (arr.filter)
    return arr.filter(func);

  var out = [];

  for (var i = 0; i < arr.length; i++) {
    if (func(arr[i]))
      out.push(arr[i]);
  }

  return out;
}

function funcName(func) {
  var name;

  try {
    name = func.name;
  } catch (e) {
    ;
  }

  if (typeof name !== 'string' || name.length === 0)
    return 'Function';

  return 'Function: ' + name;
}

function getOwnKeys(obj) {
  if (Object.keys)
    return Object.keys(obj);

  var keys = [];
  var key;

  for (key in obj) {
    if (hasOwnProperty(obj, key))
      keys.push(key);
  }

  return keys;
}

function getOwnNonIndexProperties(obj, enumerable) {
  var numeric = (obj.length >>> 0) === obj.length;
  var keys = enumerable ? getOwnKeys(obj) : getOwnPropertyNames(obj);
  var i, key, symbols;
  var out = [];

  for (i = 0; i < keys.length; i++) {
    key = keys[i];

    if (numeric) {
      if (key === '0' && obj.length > 0)
        continue;

      if (/^[1-9]\d{0,14}$/.test(key) && Number(key) < obj.length)
        continue;
    }

    out.push(key);
  }

  symbols = getOwnPropertySymbols(obj);

  for (i = 0; i < symbols.length; i++) {
    key = symbols[i];
    if (!enumerable || propertyIsEnumerable(obj, key))
      out.push(key);
  }

  return out;
}

function getOwnPropertyNames(obj) {
  if (Object.getOwnPropertyNames)
    return Object.getOwnPropertyNames(obj);

  return getOwnKeys(obj);
}

function getOwnPropertySymbols(obj) {
  if (Object.getOwnPropertySymbols)
    return Object.getOwnPropertySymbols(obj);

  return [];
}

function getPrototypeOf(obj) {
  if (Object.getPrototypeOf)
    return Object.getPrototypeOf(obj);

  if (obj == null)
    return undefined;

  if (HAS_PROTO)
    return obj.__proto__;

  if (obj.constructor)
    return obj.constructor.prototype;

  return undefined;
}

function setPrototypeOf(obj, proto) {
  if (Object.setPrototypeOf)
    Object.setPrototypeOf(obj, proto);
  else if (HAS_PROTO)
    obj.__proto__ = proto;
  return obj;
}

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isAnyArrayBuffer(obj) {
  if (HAS_ARRAY_BUFFER) {
    if (obj instanceof ArrayBuffer)
      return true;
  }

  if (HAS_SHARED_ARRAY_BUFFER) {
    if (obj instanceof SharedArrayBuffer)
      return true;
  }

  return false;
}

function isArray(obj) {
  if (Array.isArray)
    return Array.isArray(obj);

  return obj instanceof Array;
}

function isArrayBufferView(obj) {
  if (!HAS_ARRAY_BUFFER)
    return false;

  if (obj == null)
    return false;

  if (ArrayBuffer.isView)
    return ArrayBuffer.isView(obj);

  return isAnyArrayBuffer(obj.buffer);
}

function isBigIntObject(obj) {
  return HAS_BIGINT && (obj instanceof BigInt);
}

function isBooleanObject(obj) {
  return obj instanceof Boolean;
}

function isBoxedPrimitive(obj) {
  if (obj === null || typeof obj !== 'object')
    return false;

  return isNumberObject(obj)
      || isStringObject(obj)
      || isBooleanObject(obj)
      || isBigIntObject(obj)
      || isSymbolObject(obj);
}

function isDate(obj) {
  return obj instanceof Date;
}

function isFloat32Array(obj) {
  return HAS_FLOAT32_ARRAY && (obj instanceof Float32Array);
}

function isFloat64Array(obj) {
  return HAS_FLOAT64_ARRAY && (obj instanceof Float64Array);
}

function isMap(obj) {
  return HAS_MAP && (obj instanceof Map);
}

function isNaN(n) {
  return n !== n;
}

function isNumberObject(obj) {
  return obj instanceof Number;
}

function isRegExp(obj) {
  return obj instanceof RegExp;
}

function isSet(obj) {
  return HAS_SET && (obj instanceof Set);
}

function isStringObject(obj) {
  return obj instanceof String;
}

function isSymbolObject(obj) {
  return HAS_SYMBOL && (obj instanceof Symbol);
}

function inherits(child, parent) {
  if (Object.setPrototypeOf) {
    Object.setPrototypeOf(child.prototype, parent.prototype);
    Object.setPrototypeOf(child, parent);
  } else if (HAS_PROTO) {
    child.prototype.__proto__ = parent.prototype;
    child.__proto__ = parent;
  } else if (Object.create) {
    child.prototype = Object.create(parent.prototype, {
      constructor: {
        value: child,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  } else {
    var Temp = function() {};
    Temp.prototype = parent.prototype;
    child.prototype = new Temp();
    child.prototype.constructor = child;
  }
}

function propertyIsEnumerable(obj, key) {
  if (!Object.getOwnPropertyDescriptor)
    return hasOwnProperty(obj, key);

  var desc = Object.getOwnPropertyDescriptor(obj, key);

  return desc != null && desc.enumerable === true;
}

function stringify(value) {
  switch (typeof value) {
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'symbol':
      return String(value);
    case 'bigint':
      return value + 'n';
    case 'string':
      if (value.length > 20)
        value = value.substring(0, 17) + '...';
      return '"' + value + '"';
    case 'object':
      if (value === null)
        return 'null';
      return '[' + toName(value) + ']';
    case 'function':
      return '[' + funcName(value) + ']';
    default:
      return '[' + (typeof value) + ']';
  }
}

function toName(obj) {
  return toString(obj).slice(8, -1);
}

function toString(obj) {
  if (obj === undefined)
    return '[object Undefined]';

  if (obj === null)
    return '[object Null]';

  return Object.prototype.toString.call(obj);
}

function ArgError(name, value, expect) {
  var msg;

  if (isArray(expect) && expect.length === 1)
    expect = expect[0];

  if (isArray(expect)) {
    var last = expect.pop();

    msg = 'The "' + name + '" argument must be one of type '
        + expect.join(', ') + ', or ' + last + '. '
        + 'Received type ' + (typeof value);
  } else {
    msg = 'The "' + name + '" argument must be of type ' + expect + '. '
        + 'Received type ' + (typeof value);
  }

  var err = new TypeError(msg);

  setPrototypeOf(err, ArgError.prototype);

  err.code = 'ERR_INVALID_ARG_TYPE';
  err.name = err.name + ' [' + err.code + ']';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, ArgError);

  err.stack;

  delete err.name;

  return err;
}

inherits(ArgError, TypeError);

function NodeError(code, msg) {
  var err = new Error(msg);

  setPrototypeOf(err, NodeError.prototype);

  err.code = code;
  err.name = err.name + ' [' + err.code + ']';

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, NodeError);

  err.stack;

  delete err.name;

  return err;
}

inherits(NodeError, Error);

/*
 * Expose
 */

exports.assign = assign;
exports.equals = equals;
exports.filter = filter;
exports.funcName = funcName;
exports.getOwnKeys = getOwnKeys;
exports.getOwnNonIndexProperties = getOwnNonIndexProperties;
exports.getOwnPropertyNames = getOwnPropertyNames;
exports.getOwnPropertySymbols = getOwnPropertySymbols;
exports.getPrototypeOf = getPrototypeOf;
exports.setPrototypeOf = setPrototypeOf;
exports.hasOwnProperty = hasOwnProperty;
exports.isAnyArrayBuffer = isAnyArrayBuffer;
exports.isArray = isArray;
exports.isArrayBufferView = isArrayBufferView;
exports.isBigIntObject = isBigIntObject;
exports.isBooleanObject = isBooleanObject;
exports.isBoxedPrimitive = isBoxedPrimitive;
exports.isDate = isDate;
exports.isFloat32Array = isFloat32Array;
exports.isFloat64Array = isFloat64Array;
exports.isMap = isMap;
exports.isNaN = isNaN;
exports.isNumberObject = isNumberObject;
exports.isRegExp = isRegExp;
exports.isSet = isSet;
exports.isStringObject = isStringObject;
exports.isSymbolObject = isSymbolObject;
exports.inherits = inherits;
exports.propertyIsEnumerable = propertyIsEnumerable;
exports.stringify = stringify;
exports.toName = toName;
exports.toString = toString;
exports.ArgError = ArgError;
exports.NodeError = NodeError;
