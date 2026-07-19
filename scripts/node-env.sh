#!/usr/bin/env sh
# Git Bash on Windows may not inherit the native Node installation PATH.
if ! command -v node >/dev/null 2>&1; then
  for node_dir in "/c/Program Files/nodejs" "/c/Program Files (x86)/nodejs" "${PROGRAMFILES:+$PROGRAMFILES/nodejs}" "${ProgramFiles:+$ProgramFiles/nodejs}"; do
    if [ -x "$node_dir/node.exe" ]; then
      PATH="$node_dir:$PATH"
      export PATH
      break
    fi
  done
fi
if ! command -v npm >/dev/null 2>&1; then
  for npm_dir in "/c/Program Files/nodejs" "/c/Program Files (x86)/nodejs" "${PROGRAMFILES:+$PROGRAMFILES/nodejs}" "${ProgramFiles:+$ProgramFiles/nodejs}"; do
    if [ -x "$npm_dir/npm.cmd" ]; then
      PATH="$npm_dir:$PATH"
      export PATH
      break
    fi

  done
fi
