/*!
 * analyze/index.js - dependency analysis for bpkg
 * Copyright (c) 2018-2024, Christopher Jeffrey (MIT License).
 * https://github.com/chjj/bpkg
 */

'use strict';

exports.cjs = require('./cjs').analyze;
exports.esm = require('./esm').analyze;
