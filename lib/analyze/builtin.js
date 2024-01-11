'use strict';

const {join} = require('path');

function _exports(specifier) {
  const path = require.resolve(specifier);
  const cp = require('child_process');
  const node = process.execPath || process.argv[0];
  const file = join(__dirname, 'exports.js');
  const args = ['--no-warnings', file, path];

  const result = cp.spawnSync(node, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });

  if (result.error)
    throw result.error;

  if (result.signal) {
    console.error('%s exited with signal %s.',
                  [node, ...args].join(' '),
                  result.signal);

    process.kill(process.pid, result.signal);
  }

  if (result.status) {
    process.stderr.write(result.stderr);

    console.error('%s exited with status %d.',
                  [node, ...args].join(' '),
                  result.status);

    process.exit(result.status);
  }

  return new Set(JSON.parse(result.stdout));
}

exports.exports = _exports;
