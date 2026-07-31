#!/usr/bin/env bash
set -euo pipefail

if [ "${SERVICE_TYPE:-api}" = "collector" ]; then
  echo "skipping migrations"
else
  pnpm run db:migrate
fi
