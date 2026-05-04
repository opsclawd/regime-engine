#!/usr/bin/env bash
set -euo pipefail

if [ "${SERVICE_TYPE:-}" = "collector" ]; then
  exec node --env-file-if-exists=.env dist/src/workers/geckoCollector.js
else
  exec node --env-file-if-exists=.env dist/src/server.js
fi
