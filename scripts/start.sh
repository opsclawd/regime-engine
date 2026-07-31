#!/usr/bin/env bash
set -euo pipefail

SERVICE_TYPE="${SERVICE_TYPE:-api}"

case "$SERVICE_TYPE" in
  api)
    exec node --env-file-if-exists=.env dist/src/server.js
    ;;
  collector)
    exec node --env-file-if-exists=.env dist/src/workers/geckoCollector.js
    ;;
  synthesis-worker)
    exec node --env-file-if-exists=.env dist/src/workers/policyInsightSynthesisWorker.js
    ;;
  *)
    echo "Error: Unknown SERVICE_TYPE '$SERVICE_TYPE'" >&2
    exit 1
    ;;
esac
