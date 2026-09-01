#!/usr/bin/env bash
# Uploads a no-traffic preview version of a Worker (CICD.md D2).
#
# Bootstrap: a version upload needs a deployed Worker, and the first deploy
# of every Worker happens on merge (deploy-dev). On a fresh account — or a
# Worker's first PR — that exact failure is tolerated with a warning; any
# other failure still fails the job.
#
# Usage: scripts/preview-upload.sh <worker-name> <wrangler versions upload args...>
set -u
NAME="$1"; shift
set +e
OUT=$(pnpm exec wrangler versions upload "$@" 2>&1)
CODE=$?
set -e
echo "$OUT"
if [ $CODE -ne 0 ]; then
  if echo "$OUT" | grep -q "does not yet exist"; then
    echo "::warning::$NAME is not deployed yet — its first preview arrives after the first merge deploys it."
    exit 0
  fi
  exit $CODE
fi
