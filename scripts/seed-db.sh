#!/usr/bin/env bash
# Download and install the cached-data seed for local development.
# Skip the poller bootstrap and start with realistic data already in place.
#
# Usage:
#   ./scripts/seed-db.sh
#
# Refuses to overwrite an existing data/cache.db unless --force is passed.

set -euo pipefail

OUT="data/cache.db"
URL="https://github.com/MkDev11/gittensor-hub/releases/latest/download/seed.db.gz"
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ -f "$OUT" && "$FORCE" != "1" ]]; then
  echo "$OUT already exists. Pass --force to overwrite." >&2
  exit 1
fi

mkdir -p data

echo "Downloading $URL"
curl -fL --progress-bar "$URL" | gunzip > "$OUT"

SIZE_HUMAN=$(du -h "$OUT" | awk '{print $1}')
echo "Seeded $OUT ($SIZE_HUMAN). Run 'pnpm dev' to start."
