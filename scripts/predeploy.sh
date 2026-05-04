#!/usr/bin/env bash
set -euo pipefail

if [ "${SERVICE_TYPE:-}" = "collector" ]; then
  echo "collector: skipping migrations"
else
  pnpm run db:migrate
fi
