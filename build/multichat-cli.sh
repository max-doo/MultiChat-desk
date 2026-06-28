#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
export ELECTRON_RUN_AS_NODE=1
if [ "$(uname)" = "Darwin" ]; then
  "$DIR/MultiChat.app/Contents/MacOS/MultiChat" "$DIR/MultiChat.app/Contents/Resources/cli/index.js" "$@"
else
  "$DIR/multichat" "$DIR/resources/cli/index.js" "$@"
fi
