#!/usr/bin/env bash
set -euo pipefail

if [ "${SERVICE_TYPE:-api}" = "api" ]; then
  pnpm run db:migrate
else
  echo "skipping migrations"
fi
