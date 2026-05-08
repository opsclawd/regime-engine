#!/usr/bin/env sh
set -eu

command -v rg >/dev/null 2>&1 || { echo "ripgrep (rg) is required but not found on PATH." >&2; exit 1; }

status=0
for dir in src/engine src/domain src/application; do
  if [ -d "$dir" ]; then
    if rg --line-number --fixed-strings "process.env" "$dir"; then
      status=1
    fi
  fi
done

if [ "$status" -ne 0 ]; then
  echo "Forbidden process.env usage found in inner-layer boundary folders." >&2
fi

exit "$status"