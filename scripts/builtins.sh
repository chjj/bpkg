#!/bin/bash

rl=0

if ! type perl > /dev/null 2>& 1; then
  if uname | grep -i 'darwin' > /dev/null; then
    echo 'Requires perl to start on OSX.' >& 2
    exit 1
  fi
  rl=1
fi

if test $rl -eq 1; then
  file=$(readlink -f "$0")
else
  file=$(perl -MCwd -e "print Cwd::realpath('$0')")
fi

dir=$(dirname "$file")
dir="${dir}/.."

if test -z "$1"; then
  echo 'Must provide browserify path.' >& 2
  exit 1
fi

if ! test -d "$1"; then
  echo "$1 does not exist." >& 2
  exit 1
fi

browserify=$1
modules="${browserify}/node_modules"

set -ex

bpkg -f ${modules}/assert ${dir}/lib/builtins/assert.js
bpkg -f ${modules}/buffer ${dir}/lib/builtins/buffer.js
bpkg -f ${modules}/console-browserify ${dir}/lib/builtins/console.js
# bpkg -f ${modules}/constants-browserify ${dir}/lib/builtins/constants.json
bpkg -f ${modules}/crypto-browserify ${dir}/lib/builtins/crypto.js
bpkg -f ${modules}/domain-browser ${dir}/lib/builtins/domain.js
bpkg -f ${modules}/events ${dir}/lib/builtins/events.js
bpkg -f ${modules}/stream-http ${dir}/lib/builtins/http.js
bpkg -f ${modules}/https-browserify ${dir}/lib/builtins/https.js
bpkg -f ${modules}/os-browserify ${dir}/lib/builtins/os.js
bpkg -f ${modules}/path-browserify ${dir}/lib/builtins/path.js
bpkg -f ${modules}/process ${dir}/lib/builtins/process.js
bpkg -f ${modules}/punycode ${dir}/lib/builtins/punycode.js
bpkg -f ${modules}/querystring ${dir}/lib/builtins/querystring.js
bpkg -f ${modules}/stream-browserify ${dir}/lib/builtins/stream.js
bpkg -f ${modules}/string_decoder ${dir}/lib/builtins/string_decoder.js
bpkg -f ${modules}/timers-browserify ${dir}/lib/builtins/timers.js
bpkg -f ${modules}/tty-browserify ${dir}/lib/builtins/tty.js
# bpkg -f ${modules}/node-url ${dir}/lib/builtins/url.js
bpkg -f ${modules}/url ${dir}/lib/builtins/url.js
# bpkg -f ${modules}/node-util lib/builtins/util.js
bpkg -f ${modules}/util ${dir}/lib/builtins/util.js
bpkg -f ${modules}/vm-browserify ${dir}/lib/builtins/vm.js
bpkg -f ${modules}/browserify-zlib ${dir}/lib/builtins/zlib.js
