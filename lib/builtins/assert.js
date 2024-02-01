// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/* eslint no-var: "off", prefer-arrow-callback: "off" */

'use strict';

var util = require('./internal/util');
var comparisons = require('./internal/comparisons');
var isDeepEqual = comparisons.isDeepEqual;
var isDeepStrictEqual = comparisons.isDeepStrictEqual;

/*
 * Constants
 */

var kReadableOperator = {
  deepStrictEqual: 'Expected values to be strictly deep-equal:',
  strictEqual: 'Expected values to be strictly equal:',
  strictEqualObject: 'Expected "actual" to be reference-equal to "expected":',
  deepEqual: 'Expected values to be loosely deep-equal:',
  equal: 'Expected values to be loosely equal:',
  notDeepStrictEqual: 'Expected "actual" not to be strictly deep-equal to:',
  notStrictEqual: 'Expected "actual" to be strictly unequal to:',
  // eslint-disable-next-line max-len
  notStrictEqualObject: 'Expected "actual" not to be reference-equal to "expected":',
  notDeepEqual: 'Expected "actual" not to be loosely deep-equal to:',
  notEqual: 'Expected "actual" to be loosely unequal to:',
  notIdentical: 'Values identical but not reference-equal:'
};

var NO_EXCEPTION_SENTINEL = {};

/**
 * AssertionError
 */

function AssertionError(options) {
  if (!(this instanceof AssertionError)) {
    throw new TypeError('Class constructor AssertionError ' +
                        'cannot be invoked without \'new\'');
  }

  if (typeof options !== 'object' || options === null)
    throw new util.ArgError('options', options, 'Object');

  var message = null;
  var operator = 'fail';
  var start = AssertionError;

  if (options.message != null)
    message = String(options.message);

  if (typeof options.operator === 'string')
    operator = options.operator;

  if (message == null) {
    if (operator === 'fail') {
      message = 'Assertion failed.';
    } else {
      message = kReadableOperator[operator]
              + ' ' + util.stringify(options.actual)
              + ' ' + operator
              + ' ' + util.stringify(options.expected);
    }
  }

  if (typeof options.stackStartFn === 'function')
    start = options.stackStartFn;

  var err = new Error(message);

  util.setPrototypeOf(err, AssertionError.prototype);

  err.generatedMessage = options.message == null;
  err.code = 'ERR_ASSERTION';
  err.actual = options.actual;
  err.expected = options.expected;
  err.operator = operator;

  if (Object.defineProperty) {
    Object.defineProperty(err, 'name', {
      value: 'AssertionError [ERR_ASSERTION]',
      enumerable: false,
      writable: true,
      configurable: true
    });
  }

  if (Error.captureStackTrace)
    Error.captureStackTrace(err, start);

  if (Object.defineProperty) {
    err.stack;
    err.name = 'AssertionError';
  }

  // Should almost never happen.
  if (err.constructor !== AssertionError) {
    err.constructor = AssertionError;
    err.name = 'AssertionError';
  }

  return err;
}

util.inherits(AssertionError, Error);

AssertionError.prototype.name = 'AssertionError';

AssertionError.prototype.toString = function toString() {
  return this.name + ' [' + this.code + ']: ' + this.message;
};

/*
 * Assert
 */

// eslint-disable-next-line func-name-matching
var assert = function ok(value, message) {
  innerOk(ok, arguments.length, value, message);
};

assert.AssertionError = AssertionError;

assert.ok = assert;

assert.fail = function fail(actual, expected, message, operator, stackStartFn) {
  var argsLen = arguments.length;
  var internalMessage;

  if (argsLen === 0) {
    internalMessage = 'Failed';
  } else if (argsLen === 1) {
    message = actual;
    actual = undefined;
  } else {
    if (argsLen === 2)
      operator = '!=';
  }

  if (message instanceof Error)
    throw message;

  var errArgs = {
    actual: actual,
    expected: expected,
    operator: operator === undefined ? 'fail' : operator,
    stackStartFn: stackStartFn || fail
  };

  if (message !== undefined)
    errArgs.message = message;

  var err = new AssertionError(errArgs);

  if (internalMessage) {
    err.message = internalMessage;
    err.generatedMessage = true;
  }

  throw err;
};

assert.equal = function equal(actual, expected, message) {
  // eslint-disable-next-line eqeqeq
  if (actual != expected) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: '==',
      stackStartFn: equal
    });
  }
};

assert.notEqual = function notEqual(actual, expected, message) {
  // eslint-disable-next-line eqeqeq
  if (actual == expected) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: '!=',
      stackStartFn: notEqual
    });
  }
};

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!isDeepEqual(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'deepEqual',
      stackStartFn: deepEqual
    });
  }
};

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (isDeepEqual(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'notDeepEqual',
      stackStartFn: notDeepEqual
    });
  }
};

assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'deepStrictEqual',
      stackStartFn: deepStrictEqual
    });
  }
};

assert.notDeepStrictEqual = notDeepStrictEqual;

function notDeepStrictEqual(actual, expected, message) {
  if (isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'notDeepStrictEqual',
      stackStartFn: notDeepStrictEqual
    });
  }
}

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (!util.equals(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'strictEqual',
      stackStartFn: strictEqual
    });
  }
};

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (util.equals(actual, expected)) {
    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'notStrictEqual',
      stackStartFn: notStrictEqual
    });
  }
};

assert.throws = function throws(promiseFn, error, message) {
  expectsError(throws, getActual(promiseFn), error, message);
};

assert.rejects = function rejects(promiseFn, error, message) {
  return new Promise(function(resolve, reject) {
    waitForActual(promiseFn).then(function(res) {
      try {
        expectsError(rejects, res, error, message);
      } catch (e) {
        reject(e);
        return;
      }
      resolve();
    }, reject);
  });
};

assert.doesNotThrow = function doesNotThrow(fn, error, message) {
  expectsNoError(doesNotThrow, getActual(fn), error, message);
};

assert.doesNotReject = function doesNotReject(fn, error, message) {
  return new Promise(function(resolve, reject) {
    waitForActual(fn).then(function(res) {
      try {
        expectsNoError(doesNotReject, res, error, message);
      } catch (e) {
        reject(e);
        return;
      }
      resolve();
    }, reject);
  });
};

assert.ifError = function ifError(err) {
  if (err !== null && err !== undefined) {
    var message = 'ifError got unwanted exception: ';

    if (typeof err === 'object' && typeof err.message === 'string') {
      if (err.message.length === 0 && err.constructor)
        message += err.constructor.name;
      else
        message += err.message;
    } else {
      message += util.stringify(err);
    }

    var newErr = new AssertionError({
      actual: err,
      expected: null,
      operator: 'ifError',
      message: message,
      stackStartFn: ifError
    });

    var origStack = err.stack;

    if (typeof origStack === 'string') {
      var tmp2 = origStack.split('\n');
      tmp2.shift();

      var tmp1 = newErr.stack.split('\n');

      for (var i = 0; i < tmp2.length; i++) {
        var pos = tmp1.indexOf(tmp2[i]);
        if (pos !== -1) {
          tmp1 = tmp1.slice(0, pos);
          break;
        }
      }

      newErr.stack = tmp1.join('\n') + '\n' + tmp2.join('\n');
    }

    throw newErr;
  }
};

assert.match = function match(string, regexp, message) {
  internalMatch(string, regexp, message, match);
};

assert.doesNotMatch = function doesNotMatch(string, regexp, message) {
  internalMatch(string, regexp, message, doesNotMatch);
};

function strict(value, message) {
  innerOk(strict, arguments.length, value, message);
}

assert.strict = util.assign(strict, assert, {
  equal: assert.strictEqual,
  deepEqual: assert.deepStrictEqual,
  notEqual: assert.notStrictEqual,
  notDeepEqual: assert.notDeepStrictEqual
});

assert.strict.strict = assert.strict;

/*
 * Helpers
 */

function innerFail(obj) {
  if (obj.message instanceof Error)
    throw obj.message;

  throw new AssertionError(obj);
}

function innerOk(fn, argLen, value, message) {
  if (!value) {
    var generatedMessage = false;

    if (argLen === 0) {
      generatedMessage = true;
      message = 'No value argument passed to `assert.ok()`';
    } else if (message == null) {
      generatedMessage = true;
      message = 'Assertion failed.';
    } else if (message instanceof Error) {
      throw message;
    }

    var err = new AssertionError({
      actual: value,
      expected: true,
      message: message,
      operator: '==',
      stackStartFn: fn
    });

    err.generatedMessage = generatedMessage;

    throw err;
  }
}

function Comparison(obj, keys, actual) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];

    if (key in obj) {
      if (actual !== undefined &&
          typeof actual[key] === 'string' &&
          (obj[key] instanceof RegExp) &&
          obj[key].test(actual[key])) {
        this[key] = actual[key];
      } else {
        this[key] = obj[key];
      }
    }
  }
}

function compareExceptionKey(actual, expected, key, message, keys) {
  if (!(key in actual) || !isDeepStrictEqual(actual[key], expected[key])) {
    if (!message) {
      var a = new Comparison(actual, keys);
      var b = new Comparison(expected, keys, actual);

      var err = new AssertionError({
        actual: a,
        expected: b,
        operator: 'deepStrictEqual',
        stackStartFn: assert.throws
      });

      err.actual = actual;
      err.expected = expected;
      err.operator = 'throws';

      throw err;
    }

    innerFail({
      actual: actual,
      expected: expected,
      message: message,
      operator: 'throws',
      stackStartFn: assert.throws
    });
  }
}

function expectedException(actual, expected, msg) {
  if (typeof expected !== 'function') {
    if (expected instanceof RegExp)
      return expected.test(actual);

    if (arguments.length === 2)
      throw new util.ArgError('expected', expected, ['Function', 'RegExp']);

    if (typeof actual !== 'object' || actual === null) {
      var err = new AssertionError({
        actual: actual,
        expected: expected,
        message: msg,
        operator: 'deepStrictEqual',
        stackStartFn: assert.throws
      });

      err.operator = 'throws';

      throw err;
    }

    var keys = util.getOwnKeys(expected);

    if (expected instanceof Error)
      keys.push('name', 'message');
    else if (keys.length === 0)
      throw new util.ArgError('error', expected, 'may not be an empty object');

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];

      if (typeof actual[key] === 'string' &&
          (expected[key] instanceof RegExp) &&
          expected[key].test(actual[key])) {
        continue;
      }

      compareExceptionKey(actual, expected, key, msg, keys);
    }

    return true;
  }

  if (expected.prototype !== undefined && (actual instanceof expected))
    return true;

  if (Error.isPrototypeOf) {
    // eslint-disable-next-line no-prototype-builtins
    if (Error.isPrototypeOf(expected))
      return false;
  } else {
    if (expected.prototype instanceof Error)
      return false;
  }

  return expected.call({}, actual) === true;
}

function getActual(fn) {
  if (typeof fn !== 'function')
    throw new util.ArgError('fn', fn, 'Function');

  try {
    fn();
  } catch (e) {
    return e;
  }

  return NO_EXCEPTION_SENTINEL;
}

function checkIsPromise(obj) {
  return obj !== null
      && typeof obj === 'object'
      && typeof obj.then === 'function'
      && typeof obj.catch === 'function';
}

function waitForActual(promiseFn) {
  return new Promise(function(resolve, reject) {
    try {
      var resultPromise;

      if (typeof promiseFn === 'function') {
        resultPromise = promiseFn();

        if (!checkIsPromise(resultPromise)) {
          throw new util.ArgError('promiseFn',
            resultPromise, 'instance of Promise');
        }
      } else if (checkIsPromise(promiseFn)) {
        resultPromise = promiseFn;
      } else {
        throw new util.ArgError('promiseFn',
          promiseFn, ['Function', 'Promise']);
      }

      resultPromise.then(function() {
        resolve(NO_EXCEPTION_SENTINEL);
      }, resolve);
    } catch (e) {
      reject(e);
    }
  });
}

function expectsError(stackStartFn, actual, error, message) {
  if (typeof error === 'string') {
    if (arguments.length === 4) {
      throw new util.ArgError('error', error,
        ['Object', 'Error', 'Function', 'RegExp']);
    }

    if (typeof actual === 'object' && actual !== null) {
      if (actual.message === error) {
        throw new util.NodeError(
          'ERR_AMBIGUOUS_ARGUMENT',
          'The error message "' + actual.message
          + '" is identical to the message.'
        );
      }
    } else if (actual === error) {
      throw new util.NodeError(
        'ERR_AMBIGUOUS_ARGUMENT',
        'The error "' + actual + '" is identical to the message.'
      );
    }

    message = error;
    error = undefined;
  } else if (error != null &&
             typeof error !== 'object' &&
             typeof error !== 'function') {
    throw new util.ArgError('error', error,
      ['Object', 'Error', 'Function', 'RegExp']);
  }

  if (actual === NO_EXCEPTION_SENTINEL) {
    var details = '';

    if (error && error.name)
      details += ' (' + error.name + ')';

    details += message ? ': ' + message : '.';

    var fnType = stackStartFn.name === 'rejects' ? 'rejection' : 'exception';

    innerFail({
      actual: undefined,
      expected: error,
      operator: stackStartFn.name,
      message: 'Missing expected ' + fnType + details,
      stackStartFn: stackStartFn
    });
  }

  if (error && expectedException(actual, error, message) === false)
    throw actual;
}

function expectsNoError(stackStartFn, actual, error, message) {
  if (actual === NO_EXCEPTION_SENTINEL)
    return;

  if (typeof error === 'string') {
    message = error;
    error = undefined;
  }

  if (!error || expectedException(actual, error)) {
    var details = message ? ': ' + message : '.';
    var fnType = stackStartFn.name === 'doesNotReject'
      ? 'rejection'
      : 'exception';

    innerFail({
      actual: actual,
      expected: error,
      operator: stackStartFn.name,
      message: 'Got unwanted ' + fnType + details + '\n'
             + 'Actual message: "' + (actual && actual.message) + '"',
      stackStartFn: stackStartFn
    });
  }

  throw actual;
}

function internalMatch(string, regexp, message, fn) {
  if (!(regexp instanceof RegExp))
    throw new util.ArgError('regexp', regexp, 'RegExp');

  var match = fn === assert.match;

  if (typeof string !== 'string' || regexp.test(string) !== match) {
    if (message instanceof Error)
      throw message;

    var generatedMessage = message == null;

    if (message == null) {
      if (typeof string !== 'string') {
        message = 'The "string" argument must be of type string. Received type '
                + (typeof string) + ' (' + util.stringify(string) + ')';
      } else {
        if (match)
          message = 'The input did not match the ';
        else
          message = 'The input was expected to not match the ';
        message += 'regular expression ' + regexp + '. ';
        message += 'Input:\n\n' + util.stringify(string) + '\n';
      }
    }

    var err = new AssertionError({
      actual: string,
      expected: regexp,
      message: message,
      operator: fn.name,
      stackStartFn: fn
    });

    err.generatedMessage = generatedMessage;

    throw err;
  }
}

/*
 * Expose
 */

module.exports = assert;
