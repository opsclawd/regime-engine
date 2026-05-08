#!/usr/bin/env sh
set -eu

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